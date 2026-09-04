/**
 * EL INFORME DE UNA IMPORTACIÓN TIENE QUE DECIR CUÁNTOS PROBLEMAS HAY Y DÓNDE.
 *
 * Dos cosas medidas en la v1.386.0, las dos del lado de la pantalla:
 *
 *   · **La lista se cortaba en cien y no lo decía.** Con un archivo de 260
 *     filas todas malas, el informe decía «260 fila(s) con problemas:» y
 *     listaba cien, la última «Fila 100», sin ninguna señal de que siguiera.
 *     Quien corregía los cien que veía volvía a subir el archivo convencido de
 *     haber terminado y se encontraba con ciento sesenta más.
 *
 *   · **«Fila 4» no era la fila 4 de la planilla.** El servidor numera por el
 *     lugar dentro de lo que recibió —no puede saber otra cosa— y quien
 *     corrige está mirando el archivo, donde la fila de encabezados cuenta y
 *     las líneas en blanco también. Medido con un archivo de seis líneas con
 *     una en blanco al medio: la fila mala era la línea 6 y el informe la
 *     llamaba «Fila 4», o sea mandaba a corregir la que no era.
 *
 * Las tres funciones se prueban tal como están escritas en public/app.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

function delArchivo(nombre) {
  const desde = app.indexOf('function leerCSV');
  const hasta = app.indexOf('/** Sugiere a qué campo');
  assert.ok(desde > 0 && hasta > desde, 'no se encontró el trozo del lector de planillas');
  return new Function(`${app.slice(desde, hasta)}; return ${nombre};`)();
}
const leerCSV = delArchivo('leerCSV');
const comoSeNombraLaFila = delArchivo('comoSeNombraLaFila');
const losProblemasQueNoCaben = delArchivo('losProblemasQueNoCaben');

// ------------------------------------------ en qué línea del archivo está

const ARCHIVO = [
  'RUT;Nombres;Apellidos',      // 1
  '11.111.111-1;Ana;Pérez',     // 2
  '22.222.222-2;Luis;Soto',     // 3
  '',                           // 4, en blanco
  '33.333.333-3;Eva;Díaz',      // 5
  'no-es-un-rut;Juan;Rojas',    // 6, la mala
].join('\n');

test('cada fila se lleva la línea del archivo en la que empieza', () => {
  const { filas, lineas } = leerCSV(ARCHIVO);
  assert.equal(filas.length, 5, 'el encabezado y cuatro filas; la línea en blanco se bota');
  assert.deepEqual(lineas, [1, 2, 3, 5, 6]);
});

test('y el informe la nombra por esa línea, no por su lugar en el envío', () => {
  const { lineas } = leerCSV(ARCHIVO);
  const lineasArchivo = lineas.slice(1);   // el encabezado no se manda
  // el servidor llama «Fila 4» a la cuarta que recibió, que es la línea 6
  assert.equal(comoSeNombraLaFila(4, lineasArchivo), 'Línea 6');
  assert.equal(comoSeNombraLaFila(1, lineasArchivo), 'Línea 2');
});

test('un salto de línea dentro de unas comillas cuenta como línea del archivo', () => {
  const conSalto = 'Nombre;Notas\nAna;"vive\nen el sur"\nLuis;nada\n';
  const { filas, lineas } = leerCSV(conSalto);
  assert.equal(filas.length, 3);
  assert.equal(filas[1][1], 'vive\nen el sur', 'el dato no se parte');
  assert.deepEqual(lineas, [1, 2, 4], 'la de Luis empieza en la cuarta línea del archivo');
});

test('sin saber las líneas, se dice el número que mandó el servidor', () => {
  assert.equal(comoSeNombraLaFila(7, null), 'Fila 7');
  assert.equal(comoSeNombraLaFila(7, []), 'Fila 7');
});

// -------------------------------------------- la lista que viene recortada

test('si la lista viene recortada, se dice cuántos faltan', () => {
  const dice = losProblemasQueNoCaben({ conError: 260, errores: new Array(100).fill({}) });
  assert.match(dice, /100/, 'cuántos se muestran');
  assert.match(dice, /160/, 'y cuántos faltan');
});

test('si caben todos, no se dice nada', () => {
  assert.equal(losProblemasQueNoCaben({ conError: 3, errores: [{}, {}, {}] }), '');
  assert.equal(losProblemasQueNoCaben({ conError: 0, errores: [] }), '');
});

test('el informe pinta esa línea debajo de la lista', () => {
  assert.match(app, /losProblemasQueNoCaben\(r\)/,
    'si la pantalla no la llama, la función es un adorno');
  assert.match(app, /class="mas-problemas"/);
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  assert.match(css, /\.mas-problemas\s*\{/, 'y tiene que tener su estilo, o pasa inadvertida');
});
