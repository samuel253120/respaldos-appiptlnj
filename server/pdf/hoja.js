/**
 * La hoja: lo que todo papel de esta institución tiene igual.
 *
 * El membrete con el logo y los datos, los colores, y el pie que va en todas
 * las páginas diciendo cuándo se emitió, quién lo emitió y en cuál de cuántas
 * páginas va. Eso no es del acta ni del libro de partes: es de la institución,
 * y se ve igual salga el papel de donde salga.
 *
 * POR QUÉ ESTÁ ACÁ. Vivía dentro de server/pdf/acta.js, que fue el primero que
 * lo necesitó. Cuando la oficina de partes pidió su libro y su ficha en PDF
 * —v1.291.0— había dos caminos: copiar el membrete y el pie, o sacarlos afuera.
 * Copiados, el día que cambie el logo o el pie legal habría que acordarse de
 * arreglarlo en dos lados, y no se acuerda nadie: este sistema ya tuvo que
 * arreglar tres veces una regla copiada. Se sacaron afuera.
 *
 * Lo que NO está acá es la redacción de cada documento —qué títulos lleva, qué
 * dice de sí mismo—: eso es propio de cada uno y se escribe entero en su
 * archivo. Lo que se comparte es la hoja, no las palabras.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { UPLOADS_DIR } = require('../db');
const ajustes = require('../ajustes');
const formato = require('../formato');

const TINTA = '#111827';
const SUAVE = '#6b7280';
const LINEA = '#d1d5db';
const MARCA = '#16265c'; // el azul del emblema
/*
 * El color de lo que no está firmado o de lo que falta. Es el mismo de las
 * hojas de la pantalla (.acta-sin-firmar y .libro-falta en public/styles.css):
 * un documento a medio camino se tiene que ver igual salga por donde salga.
 */
const ALERTA = '#9f1239';

/** El logo que corresponde: el que se subió, o el que trae el sistema. */
function rutaDelLogo() {
  const suyo = ajustes.obtener('iglesia_logo');
  if (suyo) {
    const ruta = path.join(UPLOADS_DIR, path.basename(suyo));
    if (fs.existsSync(ruta)) return ruta;
  }
  const dedefecto = path.join(__dirname, '..', '..', 'public', 'img', 'logo.png');
  return fs.existsSync(dedefecto) ? dedefecto : null;
}

/** Los datos de contacto en una línea, saltándose los que estén en blanco. */
function contactoDeLaInstitucion() {
  return [
    ajustes.obtener('iglesia_direccion'),
    ajustes.obtener('iglesia_telefono'),
    ajustes.obtener('iglesia_rut'),
  ].map((x) => (x || '').trim()).filter(Boolean).join(' · ');
}

/**
 * Una hoja nueva, con sus márgenes y sus datos.
 *
 * `apaisada` es para lo que no cabe de pie: el libro de partes tiene nueve
 * columnas, y de pie la materia de cada documento queda en una tira de dos
 * centímetros.
 */
function abrirHoja({ titulo, asunto, apaisada = false }) {
  return new PDFDocument({
    size: 'LETTER',
    layout: apaisada ? 'landscape' : 'portrait',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    info: {
      Title: titulo,
      Author: ajustes.obtener('iglesia_nombre') || 'Sistema de Gestión de Iglesias',
      Subject: asunto,
    },
    // El pie se dibuja a mano en cada página (ver más abajo), así que pdfkit no
    // debe agregar la página nueva por su cuenta antes de que se pinte.
    bufferPages: true,
  });
}

/** Los tres números con que se dibuja todo lo demás. */
function medidas(doc) {
  const izq = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  return { izq, ancho, derecha: izq + ancho };
}

/** El membrete: logo, nombre, lema, contacto y la raya de abajo. */
function membrete(doc) {
  const { izq, ancho, derecha } = medidas(doc);
  const logo = rutaDelLogo();
  const arribaDelTodo = doc.y;
  if (logo) {
    try {
      doc.image(logo, izq, arribaDelTodo, { fit: [52, 52] });
    } catch (e) { /* un logo ilegible no puede impedir que salga el documento */ }
  }
  const xTexto = izq + (logo ? 66 : 0);
  const anchoTexto = ancho - (logo ? 66 : 0);

  doc.font('Helvetica-Bold').fontSize(13).fillColor(MARCA)
    .text((ajustes.obtener('iglesia_nombre') || '').toUpperCase(), xTexto, arribaDelTodo + 2, { width: anchoTexto });
  const lema = (ajustes.obtener('iglesia_lema') || '').trim();
  if (lema) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(SUAVE).text(lema, { width: anchoTexto });
  }
  const contacto = contactoDeLaInstitucion();
  if (contacto) {
    doc.font('Helvetica').fontSize(8.5).fillColor(SUAVE).text(contacto, { width: anchoTexto });
  }
  const legal = (ajustes.obtener('documento_pie_texto') || '').trim();
  if (legal) {
    doc.font('Helvetica').fontSize(8.5).fillColor(SUAVE).text(legal, { width: anchoTexto });
  }

  doc.y = Math.max(doc.y, arribaDelTodo + (logo ? 56 : 0)) + 10;
  doc.moveTo(izq, doc.y).lineTo(derecha, doc.y).lineWidth(1.4).strokeColor(MARCA).stroke();
  doc.moveDown(1);
}

/**
 * El pie, en todas las páginas.
 *
 * Se dibuja al final y recorriendo las páginas ya escritas: hacerlo al vuelo
 * obligaría a saber cuántas páginas van a ser antes de escribirlas, y el
 * «página 2 de 5» necesita el total.
 */
function pieEnTodasLasPaginas(doc, { quien }) {
  // El día de la iglesia: un informe impreso el domingo por la noche decía
  // «Emitido el lunes», y eso va en papel (ver fechas.hoy)
  const pie = `Emitido el ${formato.fechaLarga(require('../fechas').hoy())}`
    + (quien ? ` por ${quien}` : '');
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const { izq, ancho, derecha } = medidas(doc);
    /*
     * El pie va POR DEBAJO del margen inferior, que es donde corresponde. Para
     * pdfkit eso es texto que no cabe, así que abre una página nueva… y como se
     * hace en un bucle, abría una por cada pie: el acta salía con seis páginas
     * en vez de dos, tres de ellas con nada más que el pie. Se le baja el
     * margen a cero mientras se dibuja y se le devuelve después.
     */
    const margenAbajo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margenAbajo + 18;
    doc.moveTo(izq, y - 8).lineTo(derecha, y - 8).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(SUAVE)
      .text(pie, izq, y, { width: ancho - 90, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(SUAVE)
      .text(`Página ${i + 1} de ${rango.count}`, derecha - 90, y, { width: 90, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margenAbajo;
  }
}

module.exports = {
  TINTA, SUAVE, LINEA, MARCA, ALERTA,
  rutaDelLogo, contactoDeLaInstitucion, abrirHoja, medidas, membrete, pieEnTodasLasPaginas,
};
