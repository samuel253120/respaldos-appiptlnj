/**
 * El certificado, en un archivo que se puede mandar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTA HOJA, Y QUÉ NO ES. Conviene decirlo primero, porque es la
 * decisión que explica todo lo demás.
 *
 * ES la CONSTANCIA del certificado, en el papel de la institución: el mismo
 * membrete, el mismo pie y la misma tipografía que el acta y que el libro de
 * partes. Dice todo lo que el certificado dice —su número, a nombre de quién,
 * de qué es, lo que certifica, sus fechas, quién lo firma y si está anulado—,
 * y sirve para lo que hacía falta: adjuntarla a un correo cuando alguien pide
 * una copia, o llevarla a un trámite.
 *
 * NO ES una copia de la hoja ceremonial —la de la orla, los colores y las tres
 * disposiciones—. Esa se imprime desde la pantalla, y ahí está bien hecha: la
 * suite del papel la mide sobre el PDF de verdad, en las tres maquetas y en los
 * dos tamaños de papel.
 *
 * POR QUÉ NO SE COPIÓ LA HOJA CEREMONIAL. Se pensó y se descartó, y el motivo
 * no es que costara trabajo:
 *
 *   · SU ASPECTO LO ELIGE LA IGLESIA, y lo puede cambiar cualquier día desde
 *     «Formatos de Certificado»: los colores, las tres tipografías, el tamaño
 *     del título y del texto, el margen, el marco y su grosor, la imagen de
 *     fondo con su opacidad, la disposición y el tamaño del papel. Un segundo
 *     dibujante tendría que respetar TODO eso igual que el primero.
 *   · Y NADA PODRÍA COMPROBAR QUE LOS DOS DIBUJAN LO MISMO. Comparar un dibujo
 *     hecho con pdfkit contra uno hecho por el navegador no se puede hacer
 *     midiendo: quedaría una segunda hoja que se va separando de la primera sin
 *     que nadie se entere, y el día que se separara lo notaría quien recibe el
 *     papel.
 *
 * Un certificado impreso que no se parece al que se mandó por correo es peor
 * que no poder mandarlo. Así que esta hoja no se le parece A PROPÓSITO, y lo
 * dice de sí misma en su propio encabezado.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const hoja = require('./hoja');
const { db } = require('../db');
const ajustes = require('../ajustes');
const formato = require('../formato');
const palabras = require('../certificado-en-palabras');

const { TINTA, SUAVE, LINEA, MARCA, ALERTA } = hoja;

/** El estado de lo que ya no vale. Es el mismo del módulo. */
const ANULADO = 'Anulado';

/** Un rótulo de sección, con su rayita. */
function titulo(doc, texto) {
  const { izq, ancho } = hoja.medidas(doc);
  doc.moveDown(0.9);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MARCA)
    .text(texto.toUpperCase(), izq, doc.y, { width: ancho, characterSpacing: 0.6 });
  doc.moveTo(izq, doc.y + 2).lineTo(izq + ancho, doc.y + 2).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.moveDown(0.6);
}

/** Cómo se llama el archivo que se baja. */
function nombreDelCertificado(fila) {
  const trozo = String(fila.numero || fila.id || '').replace(/[^\w.-]+/g, '-');
  return `certificado-${trozo || 'sin-numero'}.pdf`;
}

/**
 * La constancia de un certificado.
 *
 * `quien` es quien la está bajando, y sale en el pie de todas las páginas: una
 * constancia que circula tiene que decir quién la sacó del sistema.
 */
function generarCertificado(fila, { quien } = {}) {
  const iglesia = fila.iglesia_id
    ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(fila.iglesia_id) || {}).nombre || ''
    : '';
  const oficiante = fila.oficiante_id
    ? (() => {
      const p = db.prepare('SELECT nombres, apellidos FROM pastores WHERE id = ?').get(fila.oficiante_id);
      return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '';
    })()
    : '';
  const institucion = ajustes.obtener('iglesia_nombre') || '';

  /*
   * El formato es de donde sale lo que el certificado DICE. Puede no estar
   * —le cambiaron el nombre al formato, lo borraron— y entonces esta hoja tiene
   * que decirlo, igual que lo dice la hoja de la pantalla desde la v1.293.0: un
   * papel al que le falta lo que certifica no puede salir callado.
   */
  const suFormato = fila.tipo
    ? db.prepare('SELECT * FROM formatos_certificado WHERE nombre = ?').get(fila.tipo)
    : null;

  const datos = palabras.losDatos(fila, { iglesia, institucion, oficiante });
  const dice = palabras.rellenar(fila.texto || (suFormato && suFormato.texto) || '', datos);
  const suTitulo = palabras.rellenar(
    (suFormato && suFormato.titulo) || `Certificado de ${fila.tipo || ''}`, datos
  );

  const doc = hoja.abrirHoja({
    titulo: fila.numero ? `Certificado N.º ${fila.numero}` : `Certificado ${fila.id}`,
    asunto: 'Constancia de un certificado emitido',
  });
  const { izq, ancho } = hoja.medidas(doc);
  hoja.membrete(doc);

  /*
   * EL ENCABEZADO DICE QUÉ ES ESTA HOJA, y es lo primero que se lee.
   *
   * Quien la recibe por correo tiene que saber de inmediato que está mirando la
   * constancia de un certificado y no el certificado ceremonial: si no lo
   * dijera, el día que alguien comparara las dos hojas pensaría que una de las
   * dos es falsa.
   */
  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA)
    .text('CONSTANCIA DE CERTIFICADO EMITIDO', izq, doc.y, { width: ancho, align: 'center' });
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(10.5).fillColor(SUAVE)
    .text([fila.numero ? `N.º ${fila.numero}` : 'Sin número', iglesia].filter(Boolean).join('  ·  '),
      { width: ancho, align: 'center' });
  doc.moveDown(1);

  /* El sello de lo que ya no vale, arriba y no al pie: es lo primero que hay
     que saber de este papel, y por eso va antes que lo que certifica */
  if (fila.estado === ANULADO) {
    const alto = 34;
    const y = doc.y;
    doc.rect(izq, y, ancho, alto).lineWidth(1.4).strokeColor(ALERTA).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ALERTA)
      .text('ANULADO', izq, y + 7, { width: ancho, align: 'center', characterSpacing: 3 });
    doc.font('Helvetica').fontSize(9).fillColor(ALERTA)
      .text(
        `Este certificado fue anulado${fila.fecha_anulacion ? ` el ${formato.fechaLarga(fila.fecha_anulacion)}` : ''} y no tiene validez.`,
        izq, y + 21, { width: ancho, align: 'center' }
      );
    doc.y = y + alto + 12;
  }

  const dato = (etiqueta, valor) => {
    if (valor === null || valor === undefined || String(valor).trim() === '') return;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SUAVE)
      .text(etiqueta.toUpperCase(), izq, y, { width: 128 });
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(valor), izq + 136, y, { width: ancho - 136 });
    doc.moveDown(0.35);
  };

  dato('Tipo', fila.tipo);
  dato('Otorgado a', fila.nombre_titular);
  dato('RUT', fila.rut);
  dato('Fecha del evento', fila.fecha_evento ? formato.fechaLarga(fila.fecha_evento) : '');
  dato('Fecha de emisión', fila.fecha_emision ? formato.fechaLarga(fila.fecha_emision) : '');
  dato('Ciudad', fila.ciudad);
  dato('Oficiante', oficiante);
  dato('Estado', fila.estado);

  /* Los datos de las otras dos hojas, cada uno con el rótulo que usan ellas */
  dato('Otro cónyuge', fila.conyuge);
  dato('Fecha de nacimiento', fila.fecha_nacimiento ? formato.fechaLarga(fila.fecha_nacimiento) : '');
  dato('Padre', fila.padre);
  dato('Madre', fila.madre);
  dato('Padrinos', [
    [fila.padrino_1, fila.madrina_1].filter(Boolean).join(' y '),
    [fila.padrino_2, fila.madrina_2].filter(Boolean).join(' y '),
  ].filter(Boolean).join('; '));

  /* ── Lo que certifica ── */
  titulo(doc, suTitulo);
  if (dice.trim()) {
    doc.font('Helvetica').fontSize(11).fillColor(TINTA)
      .text(dice, izq, doc.y, { width: ancho, align: 'justify', lineGap: 2 });
  } else {
    /* El mismo aviso que la hoja de la pantalla, y por el mismo motivo */
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ALERTA)
      .text('FALTA EL TEXTO DE ESTE CERTIFICADO', izq, doc.y, { width: ancho });
    doc.font('Helvetica').fontSize(9.5).fillColor(ALERTA).text(
      suFormato
        ? `El formato «${fila.tipo}» no tiene texto escrito.`
        : `No se encontró el formato «${fila.tipo || ''}»: puede que le hayan cambiado el nombre.`,
      { width: ancho }
    );
  }

  if ((fila.notas || '').trim()) {
    titulo(doc, 'Notas internas');
    doc.font('Helvetica').fontSize(10).fillColor(SUAVE)
      .text(String(fila.notas), izq, doc.y, { width: ancho });
  }

  /*
   * Y AL PIE, QUÉ ES ESTA HOJA. Va escrito y no sobreentendido: sin esta frase,
   * quien la recibe no tiene cómo saber que el certificado firmado es otro
   * papel, y podría presentarla creyendo que es el original.
   */
  doc.moveDown(1.6);
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(SUAVE).text(
    'Esta hoja es la constancia que el sistema guarda de un certificado emitido. '
    + 'El certificado firmado y sellado es el documento en papel que la iglesia entrega; '
    + 'esta constancia deja por escrito qué dice y cuándo se emitió.',
    izq, doc.y, { width: ancho, align: 'justify' }
  );

  hoja.pieEnTodasLasPaginas(doc, { quien });
  doc.end();
  return doc;
}

module.exports = { generarCertificado, nombreDelCertificado };
