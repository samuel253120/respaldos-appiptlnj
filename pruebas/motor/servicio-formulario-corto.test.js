/**
 * Nueve secciones para veintitrés campos: tres pantallas de teléfono.
 *
 * El registro se llena al terminar el culto, casi siempre en el teléfono.
 * Medido en un teléfono de 390 px: el formulario medía 2.836 px —3,36 pantallas
 * de las de 844— y estaba partido en nueve secciones, CUATRO de ellas con un
 * solo campo. «Coordinador» era una sección, «Salmista» era otra, «Predicador»
 * otra: cada encabezado se llevaba lo que ocupan dos campos.
 *
 * Lo que se junta es lo que se vive junto: quién leyó el salmo con qué salmo
 * leyó, quién predicó con qué pasaje, y las dos horas, que se llenan en el mismo
 * momento. Y el capítulo con sus dos versículos van en una sola fila, que en el
 * computador ya era así y en el teléfono se llevaba tres.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
require('../../server/registry');
const servicios = require('../../server/modules/servicios');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

/** Las secciones del formulario, como las arma la pantalla: una empieza donde se declara. */
function secciones() {
  const salida = [];
  for (const f of servicios.fields) {
    if (f.oculto) continue;
    if (f.seccion) salida.push({ titulo: f.seccion, campos: [] });
    if (salida.length) salida[salida.length - 1].campos.push(f.name);
  }
  return salida;
}

const laDe = (campo) => secciones().find((s) => s.campos.includes(campo));

/* --------------------------------------------------------- menos encabezados */

test('el formulario tiene seis secciones, no nueve', () => {
  assert.equal(secciones().length, 6);
});

test('y ninguna de un solo campo, salvo la caja de observaciones', () => {
  const solitarias = secciones().filter((s) => s.campos.length === 1);
  assert.deepEqual(solitarias.map((s) => s.titulo), ['Observaciones']);
});

test('las secciones de una sola persona ya no existen', () => {
  const titulos = secciones().map((s) => s.titulo);
  for (const ida of ['Coordinador', 'Salmista', 'Predicador', 'Cierre']) {
    assert.ok(!titulos.includes(ida), `«${ida}» seguía siendo una sección propia`);
  }
});

/* ------------------------------------------------------- lo que va junto, junto */

test('las dos horas se llenan juntas y van juntas', () => {
  assert.equal(laDe('hora_inicio').titulo, laDe('hora_termino').titulo);
  assert.equal(laDe('fecha').titulo, laDe('hora_termino').titulo);
});

test('quien coordinó va con el resto de lo que es el servicio', () => {
  assert.equal(laDe('coordinador').titulo, laDe('fecha').titulo);
});

test('quién leyó el salmo va con qué salmo leyó', () => {
  const suya = laDe('salmista');
  assert.equal(laDe('salmo_libro').titulo, suya.titulo);
  assert.equal(laDe('salmo_versiculo_final').titulo, suya.titulo);
});

test('y quién predicó, con su pasaje', () => {
  const suya = laDe('predicador');
  assert.equal(laDe('mensaje_libro').titulo, suya.titulo);
  assert.equal(laDe('mensaje_versiculo_final').titulo, suya.titulo);
});

test('el salmo y el mensaje siguen siendo dos cosas distintas', () => {
  assert.notEqual(laDe('salmista').titulo, laDe('predicador').titulo);
});

/* ------------------------------------------------- tres números, una sola fila */

test('el capítulo y los dos versículos se piden en tercios', () => {
  for (const pasaje of ['salmo', 'mensaje']) {
    for (const parte of ['capitulo', 'versiculo_inicial', 'versiculo_final']) {
      const campo = servicios.fields.find((f) => f.name === `${pasaje}_${parte}`);
      assert.equal(campo.ancho, 'tercio', `${campo.name} no se pidió en tercios`);
    }
  }
});

test('y el libro sigue ocupando la fila entera: es un buscador', () => {
  assert.equal(servicios.fields.find((f) => f.name === 'salmo_libro').ancho, 'completo');
  assert.equal(servicios.fields.find((f) => f.name === 'mensaje_libro').ancho, 'completo');
});

test('la pantalla sabe dibujar un tercio', () => {
  assert.match(app, /f\.ancho === 'tercio' \? ' tercio' : ''/);
});

test('y en el teléfono tres tercios caben en una fila', () => {
  // Una sola columna para todo, salvo lo que se pidió en tercios
  const enElTelefono = css.slice(css.indexOf('@media (max-width: 900px)'));
  assert.match(enElTelefono.slice(0, 900), /\.form-grid \{ grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(enElTelefono.slice(0, 900), /\.form-grid > \* \{ grid-column: 1 \/ -1; \}/);
  assert.match(enElTelefono.slice(0, 900), /\.form-grid > \.tercio \{ grid-column: span 1; \}/);
});

/* ----------------------------------------------------- nada se perdió por el camino */

test('no se fue ningún campo en la mudanza', () => {
  const enAlgunaSeccion = new Set(secciones().flatMap((s) => s.campos));
  const visibles = servicios.fields.filter((f) => !f.oculto).map((f) => f.name);
  assert.deepEqual(visibles.filter((n) => !enAlgunaSeccion.has(n)), [],
    'un campo declarado antes de la primera sección no se dibuja en ninguna');
  assert.equal(visibles.length, 23 + 3, 'los 23 de la revisión más los tres que trajeron S-01 y S-09');
});
