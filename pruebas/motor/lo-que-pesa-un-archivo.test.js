/**
 * UN ARCHIVO CHICO NO PESA CERO.
 *
 * Medido: se adjunta a una anotación un acuerdo de dos líneas —88 bytes— y el
 * campo queda diciendo «📎 acuerdo-consistorio.txt 0 KB». Se acaba de subir el
 * archivo y la pantalla dice que no pesa nada, que es justo lo que se lee
 * cuando algo no llegó a subir.
 *
 * No es solo la ventana de anotación: la misma función escribe el peso en el
 * campo de archivo de cualquier ficha, en el panel de espacio —lo que pesa en
 * promedio cada archivo subido— y en la lista de respaldos.
 *
 * Lo que cuida este archivo:
 *   · que lo que no llega a un kilo se diga en bytes
 *   · que uno solo sea «1 byte» y no «1 bytes»
 *   · que los kilos y los megas sigan escribiéndose como antes, con la coma
 *     decimal que se usa acá
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const tamanoLegible = (() => {
  const desde = app.indexOf('function tamanoLegible');
  assert.ok(desde > -1, 'la pantalla tiene que saber decir cuánto pesa un archivo');
  const hasta = app.indexOf('\n}', desde) + 2;
  // eslint-disable-next-line no-eval
  return eval(`(${app.slice(desde, hasta)})`);
})();

test('lo que no llega a un kilo se dice en bytes', () => {
  assert.equal(tamanoLegible(88), '88 bytes', 'antes decía «0 KB», que se lee como que no subió nada');
  assert.equal(tamanoLegible(512), '512 bytes');
  assert.equal(tamanoLegible(1023), '1023 bytes');
});

test('uno solo es un byte', () => {
  assert.equal(tamanoLegible(1), '1 byte');
});

test('un archivo vacío de verdad sí dice cero', () => {
  assert.equal(tamanoLegible(0), '0 bytes', 'y se distingue de los 88 bytes que sí subieron');
});

test('los kilos siguen igual', () => {
  assert.equal(tamanoLegible(1024), '1 KB');
  assert.equal(tamanoLegible(20480), '20 KB');
  assert.equal(tamanoLegible(1024 * 1024 - 1), '1024 KB');
});

test('y los megas, con la coma decimal que se usa acá', () => {
  assert.equal(tamanoLegible(1024 * 1024), '1,0 MB');
  assert.equal(tamanoLegible(5 * 1024 * 1024), '5,0 MB');
  assert.equal(tamanoLegible(2.5 * 1024 * 1024), '2,5 MB');
});

test('la usan el campo de archivo, el panel de espacio y los respaldos', () => {
  // Si alguna de las tres dejara de usarla, ese sitio volvería a su formato y
  // el sistema diría el peso de dos maneras distintas.
  const elCampo = app.slice(app.indexOf('function initFileField'), app.indexOf('function collectForm'));
  // Los DOS sitios desde donde ese campo escribe un peso: al elegir el archivo
  // y al reencuadrar una foto ya guardada. Pedir «que aparezca en el trozo» se
  // conformaría con uno de los dos, y el otro podría irse sin que nada avise.
  assert.match(elCampo, /tamanoLegible\(archivo\.size\)/, 'al reencuadrar una foto guardada');
  const alElegir = elCampo.slice(elCampo.indexOf("fileInput.addEventListener('change'"));
  assert.match(alElegir, /tamanoLegible\(original\.size\)/, 'al elegir el archivo, que es donde se vio');
  assert.match(alElegir, /de \$\{tamanoLegible\(ajustada\.antes\)\} a \$\{tamanoLegible\(ajustada\.despues\)\}/,
    'y al decir cuánto se achicó una foto de teléfono');
  assert.match(app, /Documentos y fotos<\/span><b>\$\{fmtNumero\(info\.cuantos\)\} archivo\(s\) · \$\{tamanoLegible\(info\.archivos\)\}/);
  assert.match(app, /pesan <b>\$\{tamanoLegible\(d\.promedio_documento\)\}<\/b> cada uno/,
    'el promedio de un archivo subido es el que más cerca está de caer bajo el kilo');
});
