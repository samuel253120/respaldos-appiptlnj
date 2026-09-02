/**
 * El libro de partes y la ficha de un documento, como PDF que se descarga.
 *
 * POR QUÉ, si la pantalla ya los imprime bien. Porque son dos cosas distintas:
 * imprimir es apretar el botón del navegador y aceptar lo que ese navegador
 * decida —sus márgenes, la dirección de la página arriba, el «1/3» del pie—;
 * bajar el archivo es tener el documento. Y un libro de partes es exactamente
 * lo que se manda por correo a un auditor, a un abogado o a la Superintendencia:
 * tiene que salir IGUAL siempre y tiene que poder adjuntarse.
 *
 * Es lo mismo que los dos libros de actas tienen desde la 1.100.0 y la 1.283.0,
 * y por el mismo motivo. Lo que se comparte con ellos es LA HOJA —el membrete
 * de la institución y el pie de todas las páginas, en server/pdf/hoja.js—, no
 * la redacción: qué dice cada documento de sí mismo es suyo.
 *
 * DOS PIEZAS, PORQUE SON DOS PAPELES:
 *
 *   · EL LIBRO va APAISADO. Son nueve columnas —el número, las dos fechas, el
 *     tipo, la materia, con quién, la referencia, los folios y el estado—: de
 *     pie, la materia queda en una tira de dos centímetros y el libro deja de
 *     leerse, que es lo único que un libro tiene que hacer.
 *   · LA FICHA va de pie, como cualquier ficha, y lleva lo que la tabla del
 *     libro no puede llevar: la descripción entera, las observaciones y el hilo
 *     de la respuesta.
 *
 * Y el cierre —«En este libro constan 4 documento(s)…»— no se escribe acá: son
 * las mismas palabras que muestra la pantalla, y vienen con el libro (ver
 * server/libro-en-palabras.js). Dos hojas que afirman lo mismo no pueden tener
 * dos redacciones.
 */
const path = require('path');
const { db } = require('../db');
const formato = require('../formato');
const hoja = require('./hoja');
const palabras = require('../libro-en-palabras');

const { TINTA, SUAVE, LINEA, MARCA, ALERTA } = hoja;

/** Una fecha corta, como en la tabla de la pantalla: 04-03-2026. */
function fechaCorta(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [a, m, d] = s.split('-');
  return `${d}-${m}-${a}`;
}

/** El título de una sección, con su raya. */
function titulo(doc, texto) {
  const { izq, ancho, derecha } = hoja.medidas(doc);
  doc.moveDown(0.9);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(MARCA).text(texto.toUpperCase(), izq, doc.y, { width: ancho });
  doc.moveTo(izq, doc.y + 2).lineTo(derecha, doc.y + 2).lineWidth(0.6).strokeColor(LINEA).stroke();
  doc.moveDown(0.5);
}

/* ───────────────────────────────── EL LIBRO ───────────────────────────── */

/**
 * Las columnas del libro, con el ancho que le toca a cada una.
 *
 * Son los mismos datos y en el mismo orden que la tabla de la pantalla: quien
 * mira las dos hojas tiene que estar mirando el mismo libro. Los anchos suman
 * el ancho útil de una hoja apaisada.
 */
const COLUMNAS = [
  { clave: 'numero', titulo: 'N.º', ancho: 60, negrita: true },
  { clave: 'fecha_registro', titulo: 'Registro', ancho: 46, fecha: true },
  /*
   * Los anchos están MEDIDOS, no estimados, y por dos motivos que se vieron en
   * la primera hoja que salió: «DOCUMENTO» mide 52,1 puntos en negrita a 8, así
   * que con 52 el título se partía en dos y la «O» caía encima de la raya; y la
   * suma de todo se pasaba 34 puntos del margen derecho —caber en el papel no
   * es lo mismo que caber en la caja—. Suman exactamente el ancho útil de una
   * hoja apaisada: 632 de columnas más ocho separaciones de 6.
   */
  { clave: 'fecha', titulo: 'Documento', ancho: 56, fecha: true },
  { clave: 'tipo', titulo: 'Tipo', ancho: 60 },
  { clave: 'titulo', titulo: 'Materia / Asunto', ancho: 164 },
  { clave: 'conQuien', titulo: 'De / Para', ancho: 104 },
  { clave: 'referencia', titulo: 'Referencia', ancho: 56 },
  { clave: 'folios', titulo: 'Fs.', ancho: 22, derecha: true },
  { clave: 'estado', titulo: 'Estado', ancho: 64 },
];
const ENTRE_COLUMNAS = 6;

/** Lo que ocupan las columnas con sus separaciones: tiene que caber en la caja. */
const ANCHO_DE_LA_TABLA = COLUMNAS.reduce((n, c) => n + c.ancho, 0)
  + ENTRE_COLUMNAS * (COLUMNAS.length - 1);

/** Lo que va en cada celda de una fila del libro. */
function celdas(fila) {
  const conQuien = fila.flujo === 'Emitido' ? fila.destinatario : fila.remitente;
  const rotulo = fila.flujo === 'Emitido' ? 'Para: ' : 'De: ';
  return {
    numero: fila.numero || '—',
    fecha_registro: fechaCorta(fila.fecha_registro),
    fecha: fechaCorta(fila.fecha),
    tipo: fila.tipo || '',
    titulo: fila.titulo || '',
    conQuien: conQuien ? rotulo + conQuien : '',
    referencia: fila.referencia || '',
    folios: fila.folios == null ? '' : String(fila.folios),
    estado: fila.estado || '',
  };
}

/** La fila de títulos, que se repite en cada página: una tabla sin encabezado no es una tabla. */
function encabezadoDeLaTabla(doc, izq) {
  const y = doc.y;
  let x = izq;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(SUAVE);
  for (const c of COLUMNAS) {
    doc.text(c.titulo.toUpperCase(), x, y, { width: c.ancho, align: c.derecha ? 'right' : 'left' });
    x += c.ancho + ENTRE_COLUMNAS;
  }
  const abajo = y + 11;
  doc.moveTo(izq, abajo).lineTo(x - ENTRE_COLUMNAS, abajo).lineWidth(0.8).strokeColor(MARCA).stroke();
  doc.y = abajo + 4;
}

function generarLibro(libro, { quien } = {}) {
  const cual = libro.flujo === 'Recibido' ? 'Documentos recibidos'
    : libro.flujo === 'Emitido' ? 'Documentos emitidos'
      : libro.flujo === 'Interno o de archivo' ? 'Archivo interno'
        : 'Entradas y salidas';
  const cuando = libro.anio ? `Año ${libro.anio}` : 'Todos los años';

  const doc = hoja.abrirHoja({
    titulo: `Libro de la Oficina de Partes · ${libro.iglesia}${libro.anio ? ` · ${libro.anio}` : ''}`,
    asunto: 'Libro de la oficina de partes',
    apaisada: true,
  });
  const { izq, ancho, derecha } = hoja.medidas(doc);
  hoja.membrete(doc);

  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA)
    .text('LIBRO DE LA OFICINA DE PARTES', izq, doc.y, { width: ancho, align: 'center' });
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(10.5).fillColor(SUAVE)
    .text([libro.iglesia, cual, cuando].filter(Boolean).join('  ·  '), { width: ancho, align: 'center' });
  doc.moveDown(1);

  if (!libro.filas.length) {
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(SUAVE)
      .text('El libro no tiene documentos con esos filtros.', izq, doc.y, { width: ancho, align: 'center' });
  } else {
    encabezadoDeLaTabla(doc, izq);

    for (const fila of libro.filas) {
      const c = celdas(fila);
      // Cuánto ocupa la fila: manda la celda más alta, que casi siempre es la
      // materia. Se mide ANTES de escribir, porque si no cabe hay que pasar de
      // página con su encabezado y no partir la fila en dos.
      doc.font('Helvetica').fontSize(8.5);
      const alto = Math.max(...COLUMNAS.map((col) =>
        doc.heightOfString(String(c[col.clave] || ' '), { width: col.ancho })));

      if (doc.y + alto + 6 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        encabezadoDeLaTabla(doc, izq);
      }

      const y = doc.y;
      let x = izq;
      for (const col of COLUMNAS) {
        doc.font(col.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(TINTA)
          .text(String(c[col.clave] || ''), x, y, { width: col.ancho, align: col.derecha ? 'right' : 'left' });
        x += col.ancho + ENTRE_COLUMNAS;
      }
      doc.y = y + alto + 3;
      doc.moveTo(izq, doc.y - 1).lineTo(derecha, doc.y - 1).lineWidth(0.3).strokeColor(LINEA).stroke();
    }
  }

  // ── El cierre, con las mismas palabras que la pantalla ─────────────────
  const dice = libro.enPalabras || palabras.enPalabras(libro);
  doc.moveDown(1);
  if (doc.y + 120 > doc.page.height - doc.page.margins.bottom) doc.addPage();

  doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
    .text(palabras.sinMarcas(dice.cierre), izq, doc.y, { width: ancho });

  if (dice.falta) {
    /*
     * Lo que falta va en un recuadro con BORDE y no con fondo: los navegadores
     * no imprimen los fondos, y en la hoja de la pantalla esto se resolvió
     * igual. Que las dos salgan parecidas no es capricho: son el mismo libro.
     */
    doc.moveDown(0.6);
    const arriba = doc.y;
    const dentro = ancho - 24;
    doc.font('Helvetica-Bold').fontSize(9.5);
    let alto = doc.heightOfString(dice.falta.titulo, { width: dentro });
    doc.font('Helvetica').fontSize(9.5);
    for (const l of dice.falta.lineas) alto += doc.heightOfString(`•  ${palabras.sinMarcas(l)}`, { width: dentro }) + 1;
    doc.font('Helvetica-Oblique').fontSize(8.5);
    alto += doc.heightOfString(dice.falta.nota, { width: dentro }) + 18;

    doc.lineWidth(1.2).strokeColor(ALERTA).roundedRect(izq, arriba, ancho, alto, 3).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ALERTA)
      .text(dice.falta.titulo, izq + 12, arriba + 7, { width: dentro });
    doc.font('Helvetica').fontSize(9.5).fillColor(ALERTA);
    for (const l of dice.falta.lineas) doc.text(`•  ${palabras.sinMarcas(l)}`, izq + 12, doc.y + 1, { width: dentro });
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(ALERTA)
      .text(dice.falta.nota, izq + 12, doc.y + 2, { width: dentro });
    doc.y = arriba + alto;
  }

  // ── Las dos firmas, las mismas de la hoja impresa ──────────────────────
  const ALTO_DE_LAS_FIRMAS = 74;
  doc.moveDown(1.2);
  if (doc.y + ALTO_DE_LAS_FIRMAS > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const yFirmas = doc.y + 24;
  const anchoFirma = (ancho - 60) / 2;
  [['Secretaría', 'Firma y timbre'], ['Pastor(a) / Encargado(a)', 'Firma']]
    .forEach(([quienFirma, rotulo], i) => {
      const x = izq + i * (anchoFirma + 60);
      doc.moveTo(x, yFirmas).lineTo(x + anchoFirma, yFirmas).lineWidth(0.8).strokeColor(TINTA).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
        .text(quienFirma, x, yFirmas + 6, { width: anchoFirma, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(SUAVE)
        .text(rotulo, x, doc.y, { width: anchoFirma, align: 'center' });
    });

  hoja.pieEnTodasLasPaginas(doc, { quien });
  doc.end();
  return doc;
}

/* ───────────────────────────── LA FICHA DE UNO ────────────────────────── */

/** A qué contesta este documento y quién lo contesta: el hilo, en la hoja. */
function elHilo(fila) {
  const columnas = 'id, numero, titulo, fecha_registro, estado';
  const contesta = fila.responde_a
    ? db.prepare(`SELECT ${columnas} FROM documentos WHERE id = ?`).get(fila.responde_a)
    : null;
  const loContestan = db
    .prepare(`SELECT ${columnas} FROM documentos WHERE responde_a = ? ORDER BY COALESCE(fecha_registro, fecha), id`)
    .all(fila.id);
  return { contesta, loContestan };
}

function generarDocumento(fila, { quien } = {}) {
  const iglesia = fila.iglesia_id
    ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(fila.iglesia_id) || {}).nombre || ''
    : '';
  const esInterno = fila.flujo === 'Interno o de archivo';
  const encabezado = fila.numero
    ? `DOCUMENTO N.º ${fila.numero}`
    : 'DOCUMENTO DE ARCHIVO INTERNO';

  const doc = hoja.abrirHoja({
    titulo: fila.numero ? `Documento N.º ${fila.numero}` : `Documento ${fila.id}`,
    asunto: 'Ficha de la oficina de partes',
  });
  const { izq, ancho } = hoja.medidas(doc);
  hoja.membrete(doc);

  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA)
    .text(encabezado, izq, doc.y, { width: ancho, align: 'center' });
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(10.5).fillColor(SUAVE)
    .text([iglesia, fila.flujo].filter(Boolean).join('  ·  '), { width: ancho, align: 'center' });
  doc.moveDown(1);

  const dato = (etiqueta, valor) => {
    if (valor === null || valor === undefined || String(valor).trim() === '') return;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SUAVE)
      .text(etiqueta.toUpperCase(), izq, y, { width: 128 });
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(valor), izq + 136, y, { width: ancho - 136 });
    doc.moveDown(0.35);
  };

  dato('Materia / Asunto', fila.titulo);
  dato('Tipo', fila.tipo);
  // Las dos fechas, que no son la misma y por eso se dicen las dos: la del
  // documento es la que trae escrita quien lo firmó; la de registro es cuándo
  // pasó por la oficina, y es la que cuenta para un plazo.
  dato('Fecha del documento', fila.fecha ? formato.fechaLarga(fila.fecha) : '');
  if (!esInterno) dato('Fecha de registro', fila.fecha_registro ? formato.fechaLarga(fila.fecha_registro) : '');
  dato('Remitente', fila.remitente);
  dato('Destinatario', fila.destinatario);
  dato('Con quién es', fila.contraparte);
  dato('Recibido por', fila.recibido_por);
  dato('Firmado por', fila.firmado_por);
  dato('Medio', fila.medio);
  dato('N.º de origen', fila.referencia);
  dato('Folios', fila.folios == null ? '' : `${fila.folios} hoja(s)`);
  dato('Derivado a', fila.derivado_a);
  dato('Plazo para responder', fila.plazo ? formato.fechaLarga(fila.plazo) : '');
  dato('Estado', fila.estado);
  dato('Etiquetas', fila.etiquetas);
  if (fila.archivo) dato('Documento escaneado', path.basename(String(fila.archivo)));

  if ((fila.descripcion || '').trim()) {
    titulo(doc, 'Descripción');
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(fila.descripcion), izq, doc.y, { width: ancho });
  }
  if ((fila.observaciones || '').trim()) {
    titulo(doc, 'Observaciones');
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(fila.observaciones), izq, doc.y, { width: ancho });
  }

  /*
   * EL HILO. Es lo que un papel suelto no puede decir de sí mismo y esta hoja
   * sí: a qué contesta y qué lo contestó. Sin esto, la ficha impresa de un
   * oficio no dice si alguna vez se respondió, que es la pregunta que un libro
   * de partes existe para contestar.
   */
  const hilo = elHilo(fila);
  if (hilo.contesta || hilo.loContestan.length) {
    titulo(doc, 'El hilo');
    const comoSeLlama = (o) => `${o.numero || 's/n'} · ${o.titulo || 'Sin título'}`
      + (o.fecha_registro ? ` (registrado el ${formato.fechaLarga(o.fecha_registro)})` : '');
    if (hilo.contesta) {
      doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
        .text(`Contesta a: ${comoSeLlama(hilo.contesta)} — en estado «${hilo.contesta.estado || ''}».`,
          izq, doc.y, { width: ancho });
    }
    for (const o of hilo.loContestan) {
      doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
        .text(`Le responde: ${comoSeLlama(o)}.`, izq, doc.y, { width: ancho });
    }
  }

  hoja.pieEnTodasLasPaginas(doc, { quien });
  doc.end();
  return doc;
}

/* ─────────────────────────── cómo se llaman los archivos ──────────────── */

const limpio = (x) => String(x || '').replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]+/g, '-').replace(/\s+/g, ' ').trim();

function nombreDelLibro(libro) {
  const parte = libro.flujo === 'Recibido' ? ' recibidos'
    : libro.flujo === 'Emitido' ? ' emitidos'
      : libro.flujo === 'Interno o de archivo' ? ' archivo interno' : '';
  return `Libro de partes ${limpio(libro.iglesia)}${parte}${libro.anio ? ` ${libro.anio}` : ''}.pdf`
    .replace(/\s+/g, ' ');
}

function nombreDelDocumento(fila) {
  const numero = limpio(fila.numero || `n ${fila.id}`);
  const fecha = (fila.fecha_registro || fila.fecha || '').slice(0, 10);
  return `Documento ${numero}${fecha ? ` ${fecha}` : ''}.pdf`.replace(/\s+/g, ' ').trim();
}

module.exports = { generarLibro, generarDocumento, nombreDelLibro, nombreDelDocumento };
