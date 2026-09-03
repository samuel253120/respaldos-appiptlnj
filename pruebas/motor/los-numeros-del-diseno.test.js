/**
 * Los seis números del diseño deciden lo mismo en el servidor y en la pantalla.
 *
 * El diseño de un certificado tiene seis números —el tamaño del título, el del
 * texto, el margen, la intensidad del fondo, el grosor del marco y el orden en
 * la lista— y cada uno se acota a lo que se puede imprimir. Un título de 4000
 * px no rompe nada, pero deja la hoja ilegible; un margen de 300 mm no deja
 * lugar para el texto en una hoja carta.
 *
 * Esa cuenta está escrita DOS VECES, y tiene que ser así: el servidor la
 * necesita para guardar y la pantalla para dibujar. Es lo mismo que pasa con
 * las medidas del papel, que también viven en los dos lados y también están
 * atadas por una prueba.
 *
 * NO DECÍAN LO MISMO, Y LA QUE FALLABA ERA LA QUE MÁS IMPORTA. A la copia de la
 * pantalla le faltaba una línea: la que dice que VACÍO ES «EL DE FÁBRICA» Y NO
 * CERO. Una casilla de número vacía llega como texto vacío, y `Number('')` da
 * 0, que es un número finito, así que acotado sin más cae al MÍNIMO del rango.
 * El servidor sí tenía esa línea, con el comentario que explica por qué.
 *
 * Medido en la v1.309.0, vaciadas las cinco casillas de la ficha de un formato
 * —lo que hace cualquiera que va a escribir otro número: seleccionar el 18 y
 * borrarlo— y apretando «Vista previa»:
 *
 *     con la casilla en blanco   la muestra dibujaba   el servidor guardaba
 *     tamaño del título          12 px                 34 px
 *     tamaño del texto            8 px                 15 px
 *     margen de la hoja           0 mm                 18 mm
 *     grosor del marco            1 px                  3 px
 *     intensidad del fondo        5 %                  100 %
 *
 * Los cinco fallaban, y hacia el mismo lado: la muestra salía con el título
 * diminuto, la letra ilegible, sin margen, el marco al hilo y el fondo casi
 * borrado. Y la vista previa es el aparato de seguridad de este módulo: existe
 * porque un certificado se firma y se entrega, y lo que salió impreso no se
 * corrige después.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { NUMEROS, acotar } = require('../../server/modules/formatos_certificado');

/** La copia de la pantalla, sacada del archivo y puesta a funcionar de verdad. */
function laDeLaPantalla() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const trozo = /const CERT_NUMEROS = \{[\s\S]*?\};[\s\S]*?function certAcotar\([\s\S]*?\n\}/.exec(src);
  assert.ok(trozo, 'no se encontró la tabla de números de la pantalla');
  // Se ejecuta el código de verdad y no una copia escrita acá: si esta prueba
  // trajera su propia versión, no estaría comprobando la que corre
  return new Function(`${trozo[0]}\nreturn { CERT_NUMEROS, certAcotar };`)();
}

/* --------------------------------------------------------------------- */
/* Las dos tablas                                                         */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: las dos tablas dicen exactamente lo mismo', () => {
  const { CERT_NUMEROS } = laDeLaPantalla();
  assert.deepEqual(CERT_NUMEROS, NUMEROS,
    'si la pantalla y el servidor acotan distinto, la hoja que se ve no es la que sale');
});

test('y son los seis, ninguno se quedó fuera', () => {
  assert.deepEqual(Object.keys(NUMEROS).sort(), [
    'fondo_opacidad', 'grosor_marco', 'margen', 'orden', 'tamano_texto', 'tamano_titulo',
  ]);
});

test('cada uno trae su mínimo, su máximo y su valor de fábrica, y el de fábrica cae dentro', () => {
  for (const [cual, r] of Object.entries(NUMEROS)) {
    assert.equal(typeof r.min, 'number', `${cual} sin mínimo`);
    assert.equal(typeof r.max, 'number', `${cual} sin máximo`);
    assert.equal(typeof r.deFabrica, 'number', `${cual} sin valor de fábrica`);
    assert.ok(r.min < r.max, `${cual}: el mínimo tiene que ser menor que el máximo`);
    assert.ok(r.deFabrica >= r.min && r.deFabrica <= r.max,
      `${cual}: el valor de fábrica (${r.deFabrica}) tiene que caber en su propio rango`);
  }
});

/* --------------------------------------------------------------------- */
/* Y las dos cuentas deciden igual                                        */
/* --------------------------------------------------------------------- */

test('LA OTRA QUE IMPORTA: una casilla en blanco vale el de fábrica, no cero', () => {
  /**
   * Es la línea que faltaba. Se prueba con las tres formas en que llega un
   * vacío: la casilla del navegador manda texto vacío, la base guarda nulo, y
   * un campo que no viene llega sin definir.
   */
  const { certAcotar } = laDeLaPantalla();
  for (const [cual, r] of Object.entries(NUMEROS)) {
    for (const vacio of ['', null, undefined]) {
      assert.equal(acotar(cual, vacio), r.deFabrica,
        `el servidor: ${cual} en blanco tiene que valer ${r.deFabrica}`);
      assert.equal(certAcotar(cual, vacio), r.deFabrica,
        `la pantalla: ${cual} en blanco tiene que valer ${r.deFabrica}, y no el mínimo ${r.min}`);
    }
  }
});

test('y en concreto, la hoja que se veía no es la que se guardaba', () => {
  /**
   * Los cinco números de la medición, escritos como salieron. Si esta prueba
   * fallara habría que volver a medir antes de cambiarla.
   */
  const { certAcotar } = laDeLaPantalla();
  const loQueSeVeia = { tamano_titulo: 12, tamano_texto: 8, margen: 0, grosor_marco: 1, fondo_opacidad: 5 };
  const loQueSeGuarda = { tamano_titulo: 34, tamano_texto: 15, margen: 18, grosor_marco: 3, fondo_opacidad: 100 };
  for (const cual of Object.keys(loQueSeVeia)) {
    assert.equal(certAcotar(cual, ''), loQueSeGuarda[cual],
      `${cual}: la muestra dibujaba ${loQueSeVeia[cual]} y se guardaba ${loQueSeGuarda[cual]}`);
    assert.notEqual(certAcotar(cual, ''), loQueSeVeia[cual],
      `${cual} volvió a caer al mínimo: es el error de la v1.309.0`);
  }
});

test('lo que no es número también vale el de fábrica', () => {
  const { certAcotar } = laDeLaPantalla();
  for (const raro of ['abc', 'muchos', '12px', NaN, {}]) {
    assert.equal(acotar('margen', raro), 18, `el servidor, con ${JSON.stringify(raro)}`);
    assert.equal(certAcotar('margen', raro), 18, `la pantalla, con ${JSON.stringify(raro)}`);
  }
});

test('un cero escrito a mano SÍ es un cero: el margen de 0 mm es legítimo', () => {
  /**
   * La otra mitad, y la que hace que el arreglo no cambie una cosa por otra.
   * Un margen de 0 mm lo elige quien imprime en papel con orla, y tiene que
   * poder elegirlo: lo que no vale es que un vacío se lea como cero.
   */
  const { certAcotar } = laDeLaPantalla();
  for (const cero of [0, '0']) {
    assert.equal(acotar('margen', cero), 0, 'el servidor');
    assert.equal(certAcotar('margen', cero), 0, 'la pantalla');
  }
});

test('lo que se pasa del rango se acota, en los dos lados por igual', () => {
  const { certAcotar } = laDeLaPantalla();
  const casos = [
    ['tamano_titulo', 500, 96], ['tamano_titulo', 1, 12],
    ['margen', 300, 40], ['margen', -50, 0],
    ['grosor_marco', 400, 12], ['grosor_marco', 0, 1],
    ['fondo_opacidad', 0, 5], ['fondo_opacidad', 1000, 100],
    ['orden', 99999, 9999],
  ];
  for (const [cual, pedido, esperado] of casos) {
    assert.equal(acotar(cual, pedido), esperado, `el servidor: ${cual} con ${pedido}`);
    assert.equal(certAcotar(cual, pedido), esperado, `la pantalla: ${cual} con ${pedido}`);
  }
});

test('y los dos redondean, que si no la hoja se dibuja con decimales', () => {
  const { certAcotar } = laDeLaPantalla();
  assert.equal(acotar('tamano_titulo', 34.6), 35);
  assert.equal(certAcotar('tamano_titulo', 34.6), 35);
});

/* --------------------------------------------------------------------- */
/* Que la hoja de verdad las use                                          */
/* --------------------------------------------------------------------- */

test('la hoja se dibuja con esa tabla y no con números sueltos', () => {
  /**
   * Sin esto la tabla podría estar perfecta y la hoja seguir acotando por su
   * cuenta, que es exactamente como estaba.
   */
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const desde = src.indexOf('const estiloHoja = [');
  const trozo = src.slice(desde, src.indexOf('].join(', desde));
  for (const cual of ['tamano_titulo', 'tamano_texto', 'margen', 'grosor_marco', 'fondo_opacidad']) {
    assert.ok(trozo.includes(`entre(f.${cual}, '${cual}')`),
      `la hoja tiene que acotar ${cual} con la tabla`);
  }
  assert.ok(!/entre\(f\.\w+, \d+, \d+, \d+\)/.test(trozo),
    'no puede quedar ningún número suelto: es lo que dejaba a las dos copias diciendo cosas distintas');
});
