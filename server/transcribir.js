/**
 * Traer al sistema el texto de un documento adjunto.
 *
 * POR QUÉ EXISTE. Un acta se puede registrar de dos maneras: escribiéndola en
 * el sistema, con formato, o adjuntando el documento. Las dos valen, pero la
 * segunda deja el acta como un archivo cerrado: no se busca, no se lee en el
 * teléfono sin bajarlo, y el día que ese archivo se pierda no queda nada. Y
 * volver a escribir a mano lo que ya está escrito no lo hace nadie.
 *
 * Así que cuando el documento TRAE TEXTO, se puede traer.
 *
 * LO QUE ESTO NO PUEDE HACER, y conviene decirlo antes de que decepcione: un
 * acta escaneada no trae texto. Un escaneo es una FOTOGRAFÍA del papel metida
 * dentro de un PDF, y adentro no hay letras que copiar sino píxeles. Leerlas
 * es otro oficio —reconocimiento óptico— que necesita otras herramientas y se
 * equivoca lo suyo con la letra manuscrita y los timbres. Y justamente el acta
 * firmada suele ser un escaneo. Por eso, cuando el documento no trae texto, se
 * dice con todas sus letras en vez de devolver un campo vacío que parezca que
 * el sistema falló.
 *
 * De qué se puede traer:
 *
 *   · .docx  — un Word de hoy. Es el mejor caso: mammoth entiende su formato y
 *              devuelve HTML, así que la negrita, las listas y los títulos
 *              llegan tal cual.
 *   · .pdf   — si trae texto (un PDF exportado desde Word lo trae; un escaneo
 *              no). Se rearman los párrafos por los saltos de línea del propio
 *              PDF, porque el texto viene suelto, trozo por trozo.
 *   · .doc   — el Word viejo, de los noventa. Es un formato binario cerrado que
 *              no se lee sin herramientas aparte; no se transcribe. Se dice y
 *              se sugiere volver a guardarlo como .docx, que es un botón.
 *   · .txt   — texto pelado, se parte en párrafos.
 *
 * TODO LO QUE SALE DE ACÁ PASA POR EL SANEADOR (server/textorico.js). No es
 * una formalidad: mammoth devuelve HTML, y un .docx es un archivo que trae
 * alguien de afuera. Lo que se guarda tiene que estar tan limpio como lo que
 * se escribe a mano en el editor, ni más ni menos.
 */
const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('./db');
const textorico = require('./textorico');
const tiposDeArchivo = require('./tiposdearchivo');

/**
 * Tope de lo que se transcribe.
 *
 * No es una limitación real —un acta son unas pocas páginas— sino un freno por
 * si alguien adjunta un libro: leer un PDF de mil páginas dejaría el servidor
 * ocupado y a los demás esperando.
 */
const TOPE_DE_PAGINAS = 60;
const TOPE_DE_BYTES = 25 * 1024 * 1024;

/** El texto plano, en párrafos, como HTML de los que el editor entiende. */
function comoParrafos(texto) {
  const escapar = (t) => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(texto)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapar(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Cuántas palabras trae, para poder decir si valió la pena. */
const cuantasPalabras = (html) =>
  String(html || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

/**
 * El texto de un PDF.
 *
 * pdfjs entrega el texto en trozos sueltos, con una marca cuando el trozo
 * termina en salto de línea. Sin usar esa marca sale todo pegado en una sola
 * parrafada —«ACTA N.º 7Cuerpo: CoroEn Concepción…»—, que es peor que no
 * traerlo. Así que se rearma: salto de línea donde el PDF lo dice, y párrafo
 * nuevo donde hay una línea en blanco.
 */
async function delPdf(ruta) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const datos = new Uint8Array(fs.readFileSync(ruta));
  // La tarea de carga se guarda aparte: es ella la que sabe soltar lo que
  // reservó, no el documento (en pdfjs el documento no tiene `destroy`).
  const tarea = pdfjs.getDocument({ data: datos, useSystemFonts: true });
  const doc = await tarea.promise;

  const paginas = Math.min(doc.numPages, TOPE_DE_PAGINAS);
  let texto = '';
  for (let n = 1; n <= paginas; n++) {
    const pagina = await doc.getPage(n);
    const contenido = await pagina.getTextContent();
    for (const trozo of contenido.items) {
      texto += trozo.str || '';
      if (trozo.hasEOL) texto += '\n';
    }
    texto += '\n\n'; // una página termina, y lo que sigue es otro párrafo
  }
  const cuantasPaginas = doc.numPages;
  await tarea.destroy();

  return {
    texto: comoParrafos(texto),
    paginas: cuantasPaginas,
    recortado: cuantasPaginas > paginas,
  };
}

/**
 * El texto de un .docx, con su formato.
 *
 * Los títulos de Word se bajan a los dos niveles que el editor del sistema
 * maneja. Sin esto, un «Título 1» —que es como empieza cualquier acta— lo
 * botaba el saneador por no estar en su lista, y el título quedaba como una
 * línea suelta indistinguible del resto del texto. No es un capricho de
 * formato: en un acta, «ACUERDOS» dejando de ser un título cambia cómo se lee.
 */
async function delDocx(ruta) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.convertToHtml({ path: ruta }, {
    styleMap: [
      "p[style-name='Title'] => h3:fresh",
      'p[style-name=\'Heading 1\'] => h3:fresh',
      'p[style-name=\'Heading 2\'] => h4:fresh',
    ],
  });
  // Y los que mammoth ya numeró por su cuenta
  const bajados = String(value || '')
    .replace(/<(\/?)h1\b/gi, '<$1h3')
    .replace(/<(\/?)h2\b/gi, '<$1h4')
    .replace(/<(\/?)h[5-6]\b/gi, '<$1h4');
  return { texto: bajados };
}

/**
 * Trae el texto de un archivo ya subido, saneado y listo para el editor.
 *
 * Devuelve `{ texto, palabras, de }`, o `{ error }` con una explicación que se
 * le pueda mostrar a la persona tal cual.
 */
async function delArchivo(nombreDelArchivo) {
  // Nunca salir de la carpeta de archivos subidos, venga de donde venga el nombre
  const nombre = path.basename(String(nombreDelArchivo || ''));
  if (!nombre) return { error: 'No se indicó ningún archivo.' };
  const ruta = path.join(UPLOADS_DIR, nombre);
  if (!fs.existsSync(ruta)) {
    return { error: 'El archivo adjunto ya no está en el servidor.' };
  }
  if (fs.statSync(ruta).size > TOPE_DE_BYTES) {
    return { error: 'El documento es demasiado grande para transcribirlo. Adjunte solo el acta.' };
  }

  const extension = tiposDeArchivo.extensionDe(nombre);
  let leido;
  try {
    if (extension === 'docx') leido = await delDocx(ruta);
    else if (extension === 'pdf') leido = await delPdf(ruta);
    else if (extension === 'txt') leido = { texto: comoParrafos(fs.readFileSync(ruta, 'utf8')) };
    else if (extension === 'doc') {
      return {
        error: 'Ese es un documento de Word antiguo (.doc), que el sistema no puede leer. '
          + 'Ábralo en Word y guárdelo como .docx, o péguelo acá mismo.',
      };
    } else {
      return {
        error: `De un archivo .${extension} no se puede traer texto. `
          + 'Se puede desde un Word (.docx), un PDF con texto o un archivo de texto (.txt).',
      };
    }
  } catch (e) {
    return { error: `No se pudo leer el documento: ${e.message}` };
  }

  const limpio = textorico.limpiar(leido.texto);
  const palabras = cuantasPalabras(limpio);

  /*
   * Un PDF escaneado se lee sin error y devuelve nada, que es lo peor: parece
   * que el sistema falló en silencio. Se distingue y se explica.
   */
  if (!limpio || palabras < 5) {
    if (extension === 'pdf') {
      return {
        error: 'Ese PDF no trae texto: por dentro es una imagen, como pasa cuando el acta se '
          + 'escanea. El sistema no puede leer letras de una fotografía. El documento queda '
          + 'adjunto igual; si quiere el acta también escrita, hay que redactarla acá.',
      };
    }
    return { error: 'El documento no trae texto que se pueda traer.' };
  }

  const de = { docx: 'un documento de Word', pdf: 'un PDF', txt: 'un archivo de texto' }[extension];
  return {
    texto: limpio,
    palabras,
    de,
    recortado: !!leido.recortado,
    paginas: leido.paginas,
  };
}

module.exports = { delArchivo, comoParrafos, TOPE_DE_PAGINAS };
