/**
 * El acta de reunión, como PDF que se descarga.
 *
 * POR QUÉ EN EL SERVIDOR Y NO EN LA PANTALLA. Hasta la 1.100.0 el acta se
 * llevaba con el botón «Imprimir», que abre el diálogo del navegador y deja
 * que uno elija «Guardar como PDF». En un computador funciona; en un teléfono
 * es un trámite, y lo que sale depende del navegador de cada uno —los márgenes,
 * si pone o no la dirección de la página arriba, si respeta los colores—. Un
 * acta es un documento que se archiva y se manda, así que conviene que salga
 * IGUAL siempre y que se baje de una.
 *
 * Se arma con pdfkit, que escribe el PDF directamente. La otra manera sería
 * traer un navegador entero al servidor para que imprima el HTML, y son
 * cientos de megas para esto.
 *
 * QUÉ LLEVA. Todo lo que tiene el acta, no un resumen: el membrete de la
 * institución, sus datos, la lista de asistencia enlazada —quién fue, quién se
 * justificó con su motivo y quién no fue—, la agenda, el desarrollo y los
 * acuerdos con su formato, las firmas y un pie en cada página que dice cuándo
 * se emitió y quién lo emitió. Si el acta tiene un documento adjunto, se dice
 * cuál es: el PDF no lo puede meter adentro, pero sí dejar constancia.
 */
const path = require('path');
const { db } = require('../db');
const ajustes = require('../ajustes');
const formato = require('../formato');
const nombres = require('../nombres');
const textoRico = require('./textorico-a-pdf');
/*
 * El membrete, el pie y los colores son de la INSTITUCIÓN y no de esta hoja:
 * viven en server/pdf/hoja.js desde la v1.291.0, cuando la oficina de partes
 * pidió los suyos y hubo que elegir entre copiarlos o compartirlos.
 */
const hoja = require('./hoja');

const { TINTA, SUAVE, LINEA, MARCA } = hoja;
// El color de lo que todavía no está firmado: el mismo con que las hojas de
// este sistema marcan lo que está a medio camino.
const SIN_FIRMAR = hoja.ALERTA;

/** La gente de un cuerpo en una actividad, separada por cómo asistió. */
function laAsistencia(actaFila) {
  if (!actaFila.asistencia_id || !actaFila.cuerpo_id) return null;
  const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(actaFila.asistencia_id);
  if (!actividad) return null;

  const filas = db
    .prepare(
      `SELECT d.estado, d.motivo, d.detalle, m.nombres, m.apellidos
         FROM asistencia_detalle d
         JOIN miembros m ON m.id = d.miembro_id
        WHERE d.asistencia_id = ? AND d.cuerpo_id = ?
        ORDER BY m.apellidos, m.nombres`
    )
    .all(actividad.id, actaFila.cuerpo_id);
  if (!filas.length) return null;

  const como = (f) => ({
    nombre: nombres.paraMostrar(f.nombres, f.apellidos),
    motivo: f.motivo || null,
    detalle: f.detalle || null,
  });
  return {
    actividad,
    presentes: filas.filter((f) => f.estado === 'Presente').map(como),
    justificados: filas.filter((f) => f.estado === 'Justificado').map(como),
    ausentes: filas.filter((f) => f.estado === 'Ausente').map(como),
  };
}

/** Los asistentes que se escribieron a mano, en las actas antiguas. */
function asistentesEscritosAMano(actaFila) {
  let ids = [];
  try {
    ids = JSON.parse(actaFila.asistentes || '[]').map(Number).filter(Boolean);
  } catch (e) {
    return [];
  }
  if (!ids.length) return [];
  return db
    .prepare(`SELECT nombres, apellidos FROM miembros WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY apellidos, nombres`)
    .all(...ids)
    .map((m) => nombres.paraMostrar(m.nombres, m.apellidos));
}

/**
 * Escribe el acta en un documento PDF y lo devuelve como flujo.
 *
 * `quien` es la persona que lo pidió: su nombre va al pie, porque un documento
 * que se entrega y no dice quién lo sacó no se puede preguntar después.
 */
/**
 * QUÉ CLASE DE ACTA ES ÉSTA.
 *
 * El PDF se escribió para las actas de reunión de un cuerpo. Las de asamblea son
 * el mismo documento con distinto dueño y necesitan el mismo PDF, así que en vez
 * de un segundo generador —que habría que arreglar dos veces— acá van las pocas
 * cosas que cambian: cómo se llama, de quién es, y cómo se llama la sesión en
 * los títulos y en el sello. Todo lo demás lo comparten.
 *
 * Los rótulos siguen los del propio módulo: el acta de un cuerpo acuerda
 * «compromisos» y la de una asamblea, «resoluciones».
 */
const CLASES = {
  actas_reuniones: {
    titulo: 'ACTA DE REUNIÓN',
    asunto: 'Acta de reunión de cuerpo',
    sesion: 'la reunión',
    desarrollo: 'Desarrollo de la reunión',
    acuerdos: 'Acuerdos y compromisos',
    // De quién es: de su iglesia y de su cuerpo
    deQuien: (fila) => [
      fila.iglesia_id && (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(fila.iglesia_id) || {}).nombre,
      fila.cuerpo_id && (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(fila.cuerpo_id) || {}).nombre,
    ].filter(Boolean).join(' — '),
    conAsistencia: true,
  },
  actas_asambleas: {
    titulo: 'ACTA DE ASAMBLEA',
    asunto: 'Acta de asamblea general',
    sesion: 'la asamblea',
    desarrollo: 'Desarrollo de la asamblea',
    acuerdos: 'Acuerdos y resoluciones',
    // De la congregación entera, que es de quien es una asamblea general
    deQuien: (fila) => (fila.iglesia_id
      ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(fila.iglesia_id) || {}).nombre || ''
      : ''),
    conAsistencia: false,
  },
};

function generar(actaFila, { quien, modulo = 'actas_reuniones' } = {}) {
  const ES = CLASES[modulo] || CLASES.actas_reuniones;
  const doc = hoja.abrirHoja({
    titulo: `${ES.titulo.charAt(0) + ES.titulo.slice(1).toLowerCase()} N.º ${actaFila.numero_acta || ''}`,
    asunto: ES.asunto,
  });
  const { izq, ancho, derecha } = hoja.medidas(doc);
  hoja.membrete(doc);

  // ── Título ─────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA)
    .text(`${ES.titulo} N.º ${actaFila.numero_acta || ''}`, izq, doc.y, { width: ancho, align: 'center' });

  const bajada = ES.deQuien(actaFila);
  if (bajada) {
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10.5).fillColor(SUAVE)
      .text(bajada, { width: ancho, align: 'center' });
  }
  /*
   * ── El sello de que esto no es el documento final ────────────────────
   *
   * El PDF ya decía el estado en su tabla de datos, pero dicho ahí se lee
   * igual que el lugar o la hora. Un borrador impreso circula —se lleva a una
   * reunión, se archiva, se muestra—, y quien lo recibe tiene que verlo de una
   * mirada, no buscándolo entre los campos. Va en un recuadro, para que sea lo
   * mismo que muestra la hoja de la pantalla: los dos caminos para sacar la
   * misma acta del sistema tienen que decir lo mismo.
   */
  if (actaFila.estado !== 'Firmada') {
    const que = String(actaFila.estado || 'Borrador').toUpperCase();
    const porque = actaFila.estado === 'Aprobada'
      ? `Aprobada en ${ES.sesion} y todavía sin firmar: no es el documento definitivo.`
      : 'Documento de trabajo: no ha sido aprobado ni firmado.';
    doc.moveDown(0.8);
    const arriba = doc.y;
    // Se mide primero el alto que va a ocupar el texto y después se dibuja el
    // marco: al revés habría que adivinarlo, y una frase larga se saldría.
    const altoTitulo = doc.font('Helvetica-Bold').fontSize(10).heightOfString(que, { width: ancho - 24 });
    const altoTexto = doc.font('Helvetica').fontSize(9.5).heightOfString(porque, { width: ancho - 24 });
    const alto = altoTitulo + altoTexto + 16;
    doc.lineWidth(1.4).strokeColor(SIN_FIRMAR).roundedRect(izq, arriba, ancho, alto, 3).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(SIN_FIRMAR)
      .text(que, izq + 12, arriba + 7, { width: ancho - 24, align: 'center', characterSpacing: 2 });
    doc.font('Helvetica').fontSize(9.5).fillColor(SIN_FIRMAR)
      .text(porque, izq + 12, doc.y + 1, { width: ancho - 24, align: 'center' });
    doc.y = arriba + alto;
  }

  doc.moveDown(1);

  // ── Los datos, en dos columnas de etiqueta y valor ────────────────────
  const dato = (etiqueta, valor) => {
    if (valor === null || valor === undefined || String(valor).trim() === '') return;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SUAVE)
      .text(etiqueta.toUpperCase(), izq, y, { width: 128 });
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(valor), izq + 136, y, { width: ancho - 136 });
    doc.moveDown(0.35);
  };

  dato('Fecha', actaFila.fecha ? formato.fechaLarga(actaFila.fecha) : '');
  dato('Lugar', actaFila.lugar);
  const hora = [actaFila.hora_inicio, actaFila.hora_fin].filter(Boolean).join(' a ');
  dato('Hora', hora);
  dato('Tipo', actaFila.tipo);
  dato('Presidida por', actaFila.presidida_por);
  dato('Secretario(a)', actaFila.secretario);
  /*
   * Lo propio de una asamblea. Va junto a los demás datos y NO reemplaza al
   * recuadro de más arriba: el quórum decide si lo que se acordó vale, así que
   * se dice en los dos lados, igual que en la hoja de la pantalla.
   */
  if (modulo === 'actas_asambleas') {
    const cuantos = actaFila.total_asistentes;
    const gente = cuantos === null || cuantos === undefined || cuantos === ''
      ? 'No se anotó cuántos asistieron'
      : `${cuantos} asistentes`;
    dato('Asistentes / Quórum', `${gente} — ${actaFila.hubo_quorum ? 'hubo quórum' : 'sin quórum'}`);
  }
  dato('Estado', actaFila.estado);
  // Quién la firmó y cuándo, desde la 1.272.0. Un acta sin firmar no los trae
  // y `dato` se salta solo lo que viene vacío.
  dato('Firmada por', actaFila.firmada_por
    ? actaFila.firmada_por + (actaFila.fecha_firma ? ` · ${formato.fechaLarga(actaFila.fecha_firma)}` : '')
    : '');
  if (actaFila.documento) dato('Documento adjunto', path.basename(String(actaFila.documento)));

  // ── La asistencia enlazada ────────────────────────────────────────────
  const titulo = (t) => {
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(MARCA).text(t.toUpperCase(), izq, doc.y, { width: ancho });
    doc.moveTo(izq, doc.y + 2).lineTo(derecha, doc.y + 2).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.moveDown(0.5);
  };

  const asistencia = ES.conAsistencia ? laAsistencia(actaFila) : null;
  if (asistencia) {
    titulo('Asistencia');
    doc.font('Helvetica').fontSize(9.5).fillColor(SUAVE).text(
      `${asistencia.actividad.tipo_reunion || 'Actividad'} del `
      + `${formato.fechaLarga(asistencia.actividad.fecha)}`
      + (asistencia.actividad.lugar ? ` · ${asistencia.actividad.lugar}` : ''),
      izq, doc.y, { width: ancho }
    );
    doc.moveDown(0.5);

    const grupo = (rotulo, gente, conMotivo) => {
      if (!gente.length) return;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SUAVE)
        .text(`${rotulo} (${gente.length})`.toUpperCase(), izq, y, { width: 128 });
      const texto = gente
        .map((p) => p.nombre + (conMotivo && p.motivo ? ` (${p.motivo}${p.detalle ? `: ${p.detalle}` : ''})` : ''))
        .join(' · ');
      doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
        .text(texto, izq + 136, y, { width: ancho - 136 });
      doc.moveDown(0.4);
    };
    grupo('Asistieron', asistencia.presentes);
    grupo('Se justificaron', asistencia.justificados, true);
    grupo('No asistieron', asistencia.ausentes);
  }

  // Y los que se escribieron a mano, en las actas de antes
  const aMano = asistentesEscritosAMano(actaFila);
  if (aMano.length) {
    titulo('Asistentes');
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA).text(aMano.join(' · '), izq, doc.y, { width: ancho });
  }

  // ── El acta propiamente tal ───────────────────────────────────────────
  if ((actaFila.agenda || '').trim()) {
    titulo('Agenda / Orden del día');
    doc.font('Helvetica').fontSize(10.5).fillColor(TINTA)
      .text(String(actaFila.agenda), izq, doc.y, { width: ancho });
  }
  if ((actaFila.desarrollo || '').trim()) {
    titulo(ES.desarrollo);
    textoRico.dibujar(doc, actaFila.desarrollo);
  }
  if ((actaFila.acuerdos || '').trim()) {
    titulo(ES.acuerdos);
    textoRico.dibujar(doc, actaFila.acuerdos);
  }

  // ── Firmas ────────────────────────────────────────────────────────────
  /*
   * Las firmas no se parten nunca, pero tampoco se llevan una hoja entera si
   * caben: se mide lo que ocupan —la separación, la raya y sus dos líneas— y
   * solo se pasa de página cuando de verdad no entran. Antes se pedían 90
   * puntos con una separación de tres líneas, y un acta que terminaba cerca
   * del pie mandaba las firmas solas a una segunda página en blanco.
   */
  const ALTO_DE_LAS_FIRMAS = 78;
  doc.moveDown(1.5);
  if (doc.y + ALTO_DE_LAS_FIRMAS > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const yFirmas = doc.y + 24;
  const anchoFirma = (ancho - 40) / 2;
  const sinFirmar = actaFila.estado !== 'Firmada';
  [[actaFila.presidida_por || '', 'Preside'], [actaFila.secretario || '', 'Secretario(a)']]
    .forEach(([quienFirma, cargo], i) => {
      const x = izq + i * (anchoFirma + 40);
      doc.moveTo(x, yFirmas).lineTo(x + anchoFirma, yFirmas).lineWidth(0.8).strokeColor(TINTA).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
        .text(quienFirma, x, yFirmas + 6, { width: anchoFirma, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(SUAVE)
        .text(cargo, x, doc.y, { width: anchoFirma, align: 'center' });
      // Dos rayas a secas es lo que hacía que un borrador impreso pareciera
      // firmado: si no lo está, la raya lo dice.
      if (sinFirmar) {
        doc.font('Helvetica').fontSize(8.5).fillColor(SIN_FIRMAR)
          .text('Pendiente de firma', x, doc.y + 1, { width: anchoFirma, align: 'center' });
      }
    });

  // ── El pie, en todas las páginas, que es de la institución y no del acta ──
  hoja.pieEnTodasLasPaginas(doc, { quien });

  doc.end();
  return doc;
}

/** Cómo se va a llamar el archivo que baja. */
function nombreDelArchivo(actaFila, modulo = 'actas_reuniones') {
  const numero = String(actaFila.numero_acta || actaFila.id).replace(/[^\w.-]+/g, '-');
  const fecha = (actaFila.fecha || '').slice(0, 10);
  // «Acta de asamblea 003-2026.pdf»: en una carpeta de descargas conviene que se
  // distinga de las de reunión sin tener que abrirla
  const que = modulo === 'actas_asambleas' ? 'Acta de asamblea' : 'Acta';
  return `${que} ${numero}${fecha ? ` ${fecha}` : ''}.pdf`.replace(/\s+/g, ' ').trim();
}

module.exports = { generar, nombreDelArchivo };
