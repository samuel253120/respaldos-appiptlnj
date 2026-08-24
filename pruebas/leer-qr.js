/**
 * Leer el código QR del papel, y no del HTML que lo pintó.
 *
 * Que el QR «esté» en la pantalla no dice nada: lo que importa es si el
 * teléfono de quien recibe la credencial impresa lo va a poder leer. Eso solo
 * se sabe rasterizando el PDF a la resolución a la que se imprime de verdad y
 * pasándole encima un lector, que es lo que hace este archivo.
 *
 * Trae tres cosas, en el orden en que se usan:
 *
 *   rasterizar(pdf, ppp)     el PDF convertido en píxeles, a 300 puntos por
 *                            pulgada, que es la resolución de una impresora
 *                            de oficina corriente;
 *   desenfocar(img, mm)      la misma imagen con la tinta corrida los
 *                            milímetros que se le pidan, para imitar lo que
 *                            hace una impresora de inyección sobre papel
 *                            común: el punto de tinta se expande y los
 *                            módulos del QR se comen el blanco que los separa;
 *   leer(img)                lo que dice el QR —y de qué tamaño salió sobre
 *                            el papel—, o null si no se pudo leer.
 *
 * Lo usa pruebas/credencial-impresa.js. Necesita tres dependencias de
 * desarrollo —pdfjs-dist para interpretar el PDF, @napi-rs/canvas para
 * dibujarlo y jsqr para leerlo—; ninguna viaja a producción.
 */

/** Puntos PostScript por pulgada: la unidad interna de cualquier PDF. */
const PUNTOS_POR_PULGADA = 72;
/** Milímetros por pulgada. */
const MM_POR_PULGADA = 25.4;

/**
 * El PDF, convertido en píxeles.
 *
 * Devuelve la página que se le pida (la primera, salvo que se diga otra) como
 * un mapa de píxeles RGBA, más el tamaño y la resolución con que se dibujó,
 * porque quien la reciba va a necesitar convertir píxeles a milímetros.
 */
async function rasterizar(rutaDelPdf, ppp = 300, cualPagina = 1) {
  const fs = require('fs');
  const canvas = require('@napi-rs/canvas');

  // pdf.js espera correr en un navegador y da por sentado que existen estas
  // tres cosas. En Node no existen, así que se las prestamos las del canvas.
  for (const prestado of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (!globalThis[prestado] && canvas[prestado]) globalThis[prestado] = canvas[prestado];
  }
  // La versión «legacy» es la que está pensada para correr fuera del navegador.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const documento = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(rutaDelPdf)),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pagina = await documento.getPage(cualPagina);

  // El PDF viene en puntos de 1/72": para llegar a 300 ppp hay que ampliarlo
  const marco = pagina.getViewport({ scale: ppp / PUNTOS_POR_PULGADA });
  const lienzo = canvas.createCanvas(Math.ceil(marco.width), Math.ceil(marco.height));
  const pincel = lienzo.getContext('2d');
  // El papel es blanco: sin esto el fondo queda transparente y el lector,
  // que solo mira los canales de color, ve todo negro.
  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, lienzo.width, lienzo.height);
  await pagina.render({ canvasContext: pincel, canvas: lienzo, viewport: marco }).promise;

  const pixeles = pincel.getImageData(0, 0, lienzo.width, lienzo.height);
  const cuantasPaginas = documento.numPages;
  await documento.cleanup();
  return {
    ancho: pixeles.width,
    alto: pixeles.height,
    datos: pixeles.data,
    ppp,
    paginas: cuantasPaginas,
    /** Guardarla en disco, para poder mirarla con los ojos cuando algo falla. */
    guardar: (ruta) => fs.writeFileSync(ruta, lienzo.toBuffer('image/png')),
  };
}

/**
 * La tinta corrida, en milímetros.
 *
 * Una impresora de inyección no deja el punto donde lo puso: el papel absorbe
 * la tinta y la mancha se expande alrededor. En un QR eso es lo que mata la
 * lectura, porque los módulos negros invaden el blanco que los separa.
 *
 * Se imita con tres pasadas de desenfoque de caja, que juntas se parecen
 * bastante a una campana de Gauss y cuestan mucho menos de calcular. El radio
 * se pide en milímetros —que es como se habla de sangrado de tinta— y se pasa
 * a píxeles con la resolución de la imagen.
 */
function desenfocar(imagen, milimetros = 0.12) {
  const radio = Math.max(1, Math.round((milimetros / MM_POR_PULGADA) * imagen.ppp));
  let datos = Uint8ClampedArray.from(imagen.datos);
  for (let pasada = 0; pasada < 3; pasada++) {
    datos = unaPasadaDeCaja(datos, imagen.ancho, imagen.alto, radio, true);
    datos = unaPasadaDeCaja(datos, imagen.ancho, imagen.alto, radio, false);
  }
  return { ...imagen, datos, guardarComo: null, radio_px: radio, radio_mm: milimetros };
}

/**
 * Una pasada de promedio en una sola dirección.
 *
 * Se hace por filas y después por columnas —que da el mismo resultado que
 * promediar el cuadrado entero— porque así el trabajo crece con el ancho más
 * el alto en vez de con su producto.
 */
function unaPasadaDeCaja(datos, ancho, alto, radio, porFilas) {
  const salida = new Uint8ClampedArray(datos.length);
  const largo = porFilas ? ancho : alto;
  const cuantas = porFilas ? alto : ancho;
  const paso = porFilas ? 4 : ancho * 4;
  const salto = porFilas ? ancho * 4 : 4;

  for (let linea = 0; linea < cuantas; linea++) {
    const inicio = linea * salto;
    for (let canal = 0; canal < 4; canal++) {
      let suma = 0;
      let cuenta = 0;
      // Se arranca con la ventana puesta sobre el borde izquierdo
      for (let i = 0; i <= radio && i < largo; i++) { suma += datos[inicio + i * paso + canal]; cuenta++; }
      for (let i = 0; i < largo; i++) {
        salida[inicio + i * paso + canal] = suma / cuenta;
        // La ventana avanza un lugar: entra uno por delante y sale uno por detrás
        const entra = i + radio + 1;
        const sale = i - radio;
        if (entra < largo) { suma += datos[inicio + entra * paso + canal]; cuenta++; }
        if (sale >= 0) { suma -= datos[inicio + sale * paso + canal]; cuenta--; }
      }
    }
  }
  return salida;
}

/**
 * Lo que dice el QR, o null si no se pudo leer.
 *
 * El lector busca el código en toda la imagen, así que sirve tanto para la
 * hoja completa como para un recorte.
 *
 * Además de lo que dice, devuelve de qué tamaño salió impreso. Eso vale la
 * pena: el punto 17.2 exige que cada módulo mida 0,25 mm o más, y hasta aquí
 * esa medida salía de lo que decía el servidor que iba a imprimir. Midiéndola
 * sobre la tinta se comprueba lo que de verdad quedó en el papel.
 */
function leer(imagen) {
  const jsQR = require('jsqr');
  const hallazgo = jsQR(imagen.datos, imagen.ancho, imagen.alto, { inversionAttempts: 'dontInvert' });
  if (!hallazgo) return null;

  const enMm = (px) => (px / imagen.ppp) * MM_POR_PULGADA;
  const e = hallazgo.location;
  const lado = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // Se mide por los dos lados de arriba y de abajo y se promedia, porque el
  // cuadrado nunca sale perfecto y así una esquina mal puesta no manda sola.
  const ancho_px = (lado(e.topLeftCorner, e.topRightCorner) + lado(e.bottomLeftCorner, e.bottomRightCorner)) / 2;
  // Cuántos módulos tiene el código según su versión: 21 el más chico, y de
  // ahí en adelante de cuatro en cuatro.
  const modulos = hallazgo.version * 4 + 17;

  return {
    texto: hallazgo.data,
    modulos,
    ancho_mm: enMm(ancho_px),
    mm_por_modulo: enMm(ancho_px) / modulos,
  };
}

/**
 * Un pedazo de la imagen, en milímetros desde la esquina superior izquierda.
 *
 * Un QR de 12 mm dentro de una hoja Carta es una mancha de 144 píxeles perdida
 * en 8 millones: recortar la zona antes de leer hace la lectura más rápida y,
 * sobre todo, más parecida a lo que hace una persona, que acerca el teléfono
 * al código en vez de fotografiar la hoja entera.
 */
function recortar(imagen, izquierda_mm, arriba_mm, ancho_mm, alto_mm) {
  const aPx = (mm) => Math.round((mm / MM_POR_PULGADA) * imagen.ppp);
  const x0 = Math.max(0, aPx(izquierda_mm));
  const y0 = Math.max(0, aPx(arriba_mm));
  const ancho = Math.min(aPx(ancho_mm), imagen.ancho - x0);
  const alto = Math.min(aPx(alto_mm), imagen.alto - y0);
  const datos = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    const desde = ((y0 + y) * imagen.ancho + x0) * 4;
    datos.set(imagen.datos.subarray(desde, desde + ancho * 4), y * ancho * 4);
  }
  return { ...imagen, ancho, alto, datos, guardar: null };
}

module.exports = { rasterizar, desenfocar, leer, recortar, MM_POR_PULGADA };
