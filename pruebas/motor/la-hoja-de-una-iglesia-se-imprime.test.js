/**
 * La hoja de una iglesia y la de un pastor, que estaban escritas y no salían.
 *
 * Al revisar la impresión apareció algo que no se esperaba: el código que arma
 * la hoja de una iglesia existía y estaba completo. Dos listas de
 * public/app.js nombran a `iglesias` expresamente para que su hoja salga con su
 * historial y con su carpeta, y el historial de versiones del propio sistema lo
 * daba por hecho —«las hojas de iglesia y pastor salen con su historial y su
 * carpeta», v1.202.0—.
 *
 * No salían. Ninguno de los dos módulos estaba marcado como imprimible, así
 * que el botón no aparecía nunca y ese código no se ejecutaba jamás:
 *
 *   módulos que se imprimían ..... 15
 *   iglesias ..................... no
 *   pastores ..................... tampoco
 *
 * La hoja de una iglesia es de las que se piden en papel —para entregar una
 * congregación, para una visita, para un trámite— y había que copiarla a mano.
 *
 * Y al verla por primera vez, tres cosas que solo se ven en el papel: imprimía
 * el nombre con que el sistema archiva la fotografía, repetía un dato en la
 * hoja del pastor, y dejaba el título de una sección solo al pie de la página.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { getModule, allModules } = require('../../server/registry');

const leer = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = leer('public/app.js');
const css = leer('public/styles.css');

// ------------------------------------------------------ el botón aparece ----

test('las hojas de la iglesia y del pastor se imprimen', () => {
  assert.equal(getModule('iglesias').printable, true,
    'sin esto el botón no aparece y el código que arma la hoja no corre nunca');
  assert.equal(getModule('pastores').printable, true);
});

test('y siguen en las dos listas que les agregan su historial y su carpeta', () => {
  /*
   * Estas dos listas estaban escritas desde la 1.202.0 y no servían de nada,
   * porque nadie llegaba a la hoja. Son la mitad de lo que hace que la hoja de
   * una congregación sirva para entregarla.
   */
  for (const lista of ['HISTORIAL_EN_LA_HOJA', 'DOCUMENTOS_EN_LA_HOJA']) {
    const desde = app.indexOf(`const ${lista} = [`);
    assert.ok(desde > 0, `no está ${lista}`);
    const linea = app.slice(desde, app.indexOf(']', desde));
    assert.match(linea, /'iglesias'/, `${lista} tiene que nombrar a iglesias`);
    assert.match(linea, /'pastores'/, `${lista} tiene que nombrar a pastores`);
  }
});

test('la hoja de una iglesia pide lo que la congregación tiene hoy', () => {
  /*
   * Sin eso es la ficha a secas: cinco datos que ya se sabían. Sale de la MISMA
   * ruta que pinta el resumen de la pantalla, así que el papel y la ficha no
   * pueden decir cifras distintas —y esa ruta ya calla lo que esa persona no
   * puede ver, de modo que la hoja tampoco lo imprime—.
   */
  assert.match(app, /if \(name === 'iglesias'\) \{\s*\n\s*loQueTiene = await api\('GET', `\/iglesias\/\$\{id\}\/resumen`\)/);
  /*
   * Anclado al `sheet =`, que es la LLAMADA. Sin eso el mismo trozo aparecía en
   * la línea que DEFINE la función, con los mismos nombres de parámetros, y la
   * comprobación pasaba en verde con la llamada rota: quitarle el argumento al
   * llamador no rompía nada.
   */
  assert.match(app, /sheet = printGenerico\(m, row, \{[^}]*\bloQueTiene\b[^}]*\}\)/,
    'y llega hasta la hoja');
  const desde = app.indexOf('function printGenerico(');
  /*
   * El recorte creció con la sección de la gente de un cuerpo (1.255.0) y otra
   * vez con el plan de pagos de una deuda (1.269.0). Es una ventana para no
   * comprobar contra el archivo entero, no una medida de cuánto puede crecer la
   * hoja: se corre cuando la función crece por delante.
   */
  const trozo = app.slice(desde, desde + 8000);
  assert.match(trozo, /Lo que tiene hoy/);
  assert.match(trozo, /es lo que hay\s*\n?\s*anotado en el sistema en el momento de imprimir/,
    'quien firme la hoja tiene que saber que son cifras de hoy, no datos de la ficha');
  assert.match(trozo, /otro dueño y no se suma a la de la iglesia/,
    'la plata de sus cuerpos va aparte, como en el inventario');
});

// ------------------------------------ lo que solo se ve mirando el papel ----

test('ninguna hoja imprime el nombre con que el sistema archiva un archivo', () => {
  /*
   * La primera línea de los datos de la iglesia, arriba del nombre de la
   * congregación, decía «Fotografía del templo · 1756…-a3f9c2-templo.jpg». Es
   * ruido interno en un papel que se entrega y se firma.
   */
  const desde = app.indexOf('function printGenerico(');
  const trozo = app.slice(desde, app.indexOf('\n}\n', desde));
  assert.match(trozo, /if \(f\.type === 'file'\)/, 'un archivo no puede caer en el `esc(v)` de siempre');
  assert.match(trozo, /img class="foto-papel"/, 'una fotografía se imprime como fotografía');
  assert.match(trozo, /Adjunto: \$\{esc\(nombreArchivo\(v\)\)\}/,
    'y un documento se nombra como se llama de verdad');
});

test('y le pasaba a todas las hojas genéricas que llevan un archivo', () => {
  /*
   * No era solo la de la iglesia: se cuenta acá para que el día que alguien
   * quite el arreglo se vea de cuántas hojas se trata.
   */
  const conArchivo = allModules().filter((m) =>
    m.printable && (m.fields || []).some((f) => f.type === 'file' && f.enElPapel !== false));
  assert.ok(conArchivo.length >= 5,
    `esperaba varias hojas imprimibles con campo de archivo, encontré ${conArchivo.length}`);
  assert.ok(conArchivo.some((m) => m.name === 'iglesias'));
  assert.ok(conArchivo.some((m) => m.name === 'pastores'));
});

test('la hoja del pastor no dice dos veces si tiene ficha de miembro', () => {
  /*
   * Salían seguidas: «Su ficha de miembro · Elena Díaz Díaz» y «Ficha de
   * miembro · Registrado». En la pantalla la segunda dice de un vistazo si la
   * ficha está enlazada, que es lo que hay que arreglar cuando no lo está; en
   * un papel que alguien firma, el mismo dato dicho dos veces hace dudar de
   * cuál manda.
   */
  const insignia = (getModule('pastores').computed || []).find((c) => c.name === 'ficha_miembro');
  assert.ok(insignia, 'la insignia de la pantalla tiene que seguir existiendo');
  assert.equal(insignia.enElPapel, false);
  assert.ok((getModule('pastores').fields || []).some((f) => f.name === 'miembro_id'),
    'y el dato de verdad —a qué ficha de miembro apunta— sigue saliendo');
});

test('un título de sección no se queda solo al pie de una página', () => {
  /*
   * «Historial» y su línea de resumen cerraban la primera página y la tabla
   * empezaba en la segunda: quien da vuelta la hoja se encuentra una tabla sin
   * encabezado, y quien ve el pie de la primera cree que el historial está
   * vacío.
   */
  const desde = css.indexOf('.print-generic table.tramite tr { break-inside: avoid; }');
  assert.ok(desde > 0, 'no está el bloque de impresión de la hoja genérica');
  const trozo = css.slice(desde, css.indexOf('}\n\n', desde));
  assert.match(trozo, /h2\.print-h2 \{ break-after: avoid/);
  assert.match(trozo, /h2\.print-h2 \+ \.sub \{ break-before: avoid/,
    'y su línea de resumen viaja con él, o el título se queda solo igual');
});

test('la fotografía del papel tiene un tamaño puesto', () => {
  /*
   * Una foto de teléfono en su tamaño natural empujaría el resto de la hoja a
   * la página siguiente.
   */
  assert.match(css, /\.print-generic img\.foto-papel \{[\s\S]{0,160}max-height: \d+px/);
});
