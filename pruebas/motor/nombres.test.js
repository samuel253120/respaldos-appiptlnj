/**
 * Cómo se nombra a cada persona en pantalla, y de qué columnas sale ese
 * nombre.
 *
 * Acá hubo un error que llegó publicado: la plantilla de presentación pasó a
 * poder pedir un recorte —«{nombres:primero}»— pero la función que decide qué
 * columnas traer de la base no reconocía esa forma, así que no traía
 * «nombres» y las etiquetas quedaban con los puros apellidos. Se veía en la
 * ficha de la iglesia, donde el pastor principal aparecía como «Rodríguez
 * Mora» a secas. Las dos últimas pruebas de este archivo son exactamente ese
 * caso.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nombres = require('../../server/nombres');
const { columnasPara } = require('../../server/crud');

test('del nombre completo se queda con el primero', () => {
  assert.equal(nombres.primerNombre('Juan Carlos Alberto'), 'Juan');
  assert.equal(nombres.primerNombre('Ana'), 'Ana');
  assert.equal(nombres.primerNombre('  María   José  '), 'María');
});

test('sin nombre no inventa nada', () => {
  for (const nada of ['', null, undefined, '   ']) assert.equal(nombres.primerNombre(nada), '');
});

test('el nombre de pantalla es el primer nombre y los dos apellidos', () => {
  assert.equal(nombres.paraMostrar('Juan Carlos Alberto', 'Pérez Soto'), 'Juan Pérez Soto');
  assert.equal(nombres.paraMostrar('Samuel', 'Rodríguez Mora'), 'Samuel Rodríguez Mora');
});

test('a quien le falta una mitad, no le sobra un espacio', () => {
  assert.equal(nombres.paraMostrar('Juan Carlos', ''), 'Juan');
  assert.equal(nombres.paraMostrar('', 'Pérez Soto'), 'Pérez Soto');
  assert.equal(nombres.paraMostrar('', ''), '');
});

test('cuando el nombre viene todo junto, se recorta a primero y dos últimos', () => {
  assert.equal(nombres.acortar('Juan Carlos Alberto Pérez Soto'), 'Juan Pérez Soto');
  assert.equal(nombres.acortar('María Fernanda De La Fuente Ramírez'), 'María Fuente Ramírez');
});

test('con tres palabras o menos no se toca', () => {
  // Recortarlo sería inventar cuál de esas palabras es apellido
  assert.equal(nombres.acortar('Ana María Soto'), 'Ana María Soto');
  assert.equal(nombres.acortar('Ana Soto'), 'Ana Soto');
  assert.equal(nombres.acortar('Ana'), 'Ana');
  assert.equal(nombres.acortar(''), '');
});

test('la plantilla sin recorte trae su columna', () => {
  const def = { name: 'prueba', display: '{nombres} {apellidos}', fields: [{ name: 'nombres' }, { name: 'apellidos' }] };
  const sql = columnasPara(def);
  assert.match(sql, /"nombres"/);
  assert.match(sql, /"apellidos"/);
});

test('la plantilla CON recorte también trae su columna', () => {
  // El error publicado: «{nombres:primero}» no calzaba, no se traía «nombres»
  // y la etiqueta quedaba con los puros apellidos.
  const def = {
    name: 'prueba_recorte',
    display: '{nombres:primero} {apellidos}',
    fields: [{ name: 'nombres' }, { name: 'apellidos' }],
  };
  const sql = columnasPara(def);
  assert.match(sql, /"nombres"/, 'la columna del campo recortado tiene que venir igual');
  assert.match(sql, /"apellidos"/);
});

test('si la plantilla pide algo que no es columna, se trae la fila entera', () => {
  const def = { name: 'prueba_rara', display: '{inventado}', fields: [{ name: 'nombres' }] };
  assert.equal(columnasPara(def), '*');
});
