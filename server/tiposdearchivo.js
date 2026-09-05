/**
 * Qué archivos se aceptan y cómo se entregan.
 *
 * Hasta ahora entraba cualquier cosa. Eso tiene una consecuencia que no se ve
 * a simple vista: si alguien sube una página web —un archivo `.html` con
 * instrucciones adentro—, el sistema se la entregaba al siguiente que la
 * abriera **como página del propio sistema**, con la sesión de esa persona
 * abierta. Quien pueda adjuntar un documento no debería poder hacer eso.
 *
 * Se cierra por tres lados a la vez, porque cada uno solo tapa un pedazo:
 *
 *   1. **Al subir** se aceptan únicamente los formatos que la iglesia usa de
 *      verdad: fotos, PDF, documentos de oficina y texto. Lo demás se
 *      rechaza con un mensaje que dice qué sí se puede.
 *   2. **Al subir, otra vez**: una foto tiene que ser una foto. Se miran los
 *      primeros bytes del archivo, que son distintos en cada formato, para
 *      que llamarle `foto.jpg` a una página web no sirva de nada.
 *   3. **Al entregar** el tipo lo pone el sistema desde esta misma lista, no
 *      se deduce del nombre; se agrega `nosniff` para que el navegador no
 *      adivine por su cuenta; y solo las fotos y los PDF se muestran en
 *      pantalla. Todo lo demás se baja como archivo, sin abrirse.
 *
 * Los archivos que ya estaban subidos antes de esto se siguen entregando: si
 * su formato no está en la lista, se bajan como archivo y no se abren.
 */

/** Lo que se acepta, y con qué tipo se entrega cada uno. */
const PERMITIDOS = {
  // Fotos y escaneos
  jpg: { tipo: 'image/jpeg', enPantalla: true },
  jpeg: { tipo: 'image/jpeg', enPantalla: true },
  png: { tipo: 'image/png', enPantalla: true },
  gif: { tipo: 'image/gif', enPantalla: true },
  webp: { tipo: 'image/webp', enPantalla: true },
  bmp: { tipo: 'image/bmp', enPantalla: true },
  heic: { tipo: 'image/heic', enPantalla: true },
  heif: { tipo: 'image/heif', enPantalla: true },
  // Documentos
  pdf: { tipo: 'application/pdf', enPantalla: true },
  doc: { tipo: 'application/msword' },
  docx: { tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xls: { tipo: 'application/vnd.ms-excel' },
  xlsx: { tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ppt: { tipo: 'application/vnd.ms-powerpoint' },
  pptx: { tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  odt: { tipo: 'application/vnd.oasis.opendocument.text' },
  ods: { tipo: 'application/vnd.oasis.opendocument.spreadsheet' },
  rtf: { tipo: 'application/rtf' },
  txt: { tipo: 'text/plain' },
  csv: { tipo: 'text/csv' },
};

/** Cómo se le explica a quien sube algo que no corresponde. */
const SE_ACEPTAN = 'fotos (JPG, PNG, GIF, WEBP, HEIC), PDF, documentos de Word, Excel o PowerPoint, y texto (TXT, CSV, RTF)';

/** La extensión de un nombre de archivo, en minúsculas y sin el punto. */
function extensionDe(nombre) {
  const corte = String(nombre || '').lastIndexOf('.');
  if (corte < 0) return '';
  return String(nombre).slice(corte + 1).toLowerCase();
}

/**
 * Los primeros bytes de cada formato, que no dependen del nombre.
 *
 * Solo están los que se pueden mostrar en pantalla, que son justamente los
 * que hay que asegurar: si un archivo se va a abrir en el navegador, tiene
 * que ser de verdad lo que dice ser. Los que se bajan sin abrirse no
 * necesitan esta comprobación, y pedírsela dejaría fuera formatos de oficina
 * legítimos que varían entre versiones.
 */
const FIRMAS = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF8
  bmp: [[0x42, 0x4d]], // BM
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF (y "WEBP" en el byte 8)
  heic: [[0x66, 0x74, 0x79, 0x70]], // ftyp, en el byte 4
  heif: [[0x66, 0x74, 0x79, 0x70]],
};

/** ¿Los primeros bytes corresponden a lo que dice la extensión? */
function contenidoCalza(extension, buffer) {
  const firmas = FIRMAS[extension];
  if (!firmas || !buffer || !buffer.length) return true; // sin firma que revisar
  const desde = extension === 'heic' || extension === 'heif' ? 4 : 0;
  const calza = firmas.some((firma) => firma.every((byte, i) => buffer[desde + i] === byte));
  if (!calza) return false;
  if (extension === 'webp') return buffer.slice(8, 12).toString('latin1') === 'WEBP';
  return true;
}

/**
 * ¿Se puede aceptar este archivo? Devuelve { ok } y, cuando no, el motivo
 * escrito para quien lo lea.
 */
function seAcepta(nombre, buffer) {
  const extension = extensionDe(nombre);
  if (!extension || !PERMITIDOS[extension]) {
    return {
      ok: false,
      motivo:
        `No se pueden subir archivos ${extension ? `«.${extension}»` : 'sin extensión'}. ` +
        `Se aceptan ${SE_ACEPTAN}.`,
    };
  }
  if (!contenidoCalza(extension, buffer)) {
    return {
      ok: false,
      motivo:
        `El archivo dice ser «.${extension}» pero su contenido no lo es. ` +
        'Vuelva a guardarlo en su formato o conviértalo a PDF.',
    };
  }
  return { ok: true };
}

/**
 * Con qué cabeceras se entrega un archivo ya guardado.
 *
 * El tipo sale de esta lista y nunca del nombre; `nosniff` le prohíbe al
 * navegador adivinar otro; y lo que no sea foto ni PDF se baja en vez de
 * abrirse. Un formato que no esté en la lista —algo subido antes de esta
 * revisión— se entrega igual, pero como archivo que se baja.
 */
function comoSeEntrega(nombre) {
  const permitido = PERMITIDOS[extensionDe(nombre)];
  return {
    'Content-Type': permitido ? permitido.tipo : 'application/octet-stream',
    'Content-Disposition': permitido && permitido.enPantalla ? 'inline' : 'attachment',
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * ¿Este archivo es una IMAGEN, de verdad?
 *
 * Hace falta donde un ajuste dice guardar una imagen —el logo, el sello, la
 * firma— porque ese ajuste es un texto libre y nada comprobaba lo que se le
 * ponía. Medido en la v1.423.0: apuntando «iglesia_logo» al nombre de un
 * documento subido a una ficha, «/api/configuracion/logo» —que no pide sesión,
 * porque el logo tiene que verse en la pantalla de acceso— lo entregaba entero
 * y sin sesión, mientras el mismo archivo contestaba 401 por «/uploads»
 * (hallazgo CO-02).
 *
 * Se pregunta por las dos cosas, como al subir: que la extensión sea de las que
 * se muestran como imagen, y que los primeros bytes lo confirmen. Con lo
 * primero solo, llamarle «logo.png» a un PDF bastaría.
 */
function esUnaImagen(nombre, buffer) {
  const extension = extensionDe(nombre);
  const permitido = PERMITIDOS[extension];
  if (!permitido || !/^image\//.test(permitido.tipo)) return false;
  return contenidoCalza(extension, buffer);
}

module.exports = { seAcepta, comoSeEntrega, extensionDe, esUnaImagen, PERMITIDOS, SE_ACEPTAN };
