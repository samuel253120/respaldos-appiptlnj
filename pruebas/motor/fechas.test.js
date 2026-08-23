/**
 * Que una fecha sea una fecha, y que además tenga sentido.
 *
 * Cuarenta y nueve campos del sistema son de tipo fecha y no había una sola
 * comprobación. Se midió lo que dejaba pasar: un nacimiento en 2099, otro en
 * 1820, un 30 de febrero, un «texto que no es fecha» guardado tal cual en una
 * columna de fecha, un bautismo en 2030 y un ingreso a la iglesia veinte años
 * anterior al nacimiento.
 *
 * Las tres últimas importan más que las otras porque el calendario del
 * navegador sí las deja escribir: no hacen falta mañas, basta equivocarse de
 * año. Y la consecuencia peor es callada: la edad se calcula del nacimiento y
 * se descarta si no da un número entre 0 y 130, así que un 2106 en vez de un
 * 2016 borra la edad de esa persona sin que nada avise.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fechas = require('../../server/fechas');

const campo = (extra = {}) => ({ name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', ...extra });

/** Un año corrido desde hoy, para no escribir fechas fijas que caduquen. */
function dentroDe(anios, dias = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + anios);
  d.setDate(d.getDate() + dias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// -------------------------------------------------- que sea una fecha ----

test('un texto cualquiera no es una fecha por guardarse en esa columna', () => {
  const problema = fechas.revisar(campo(), 'texto que no es fecha');
  assert.ok(problema);
  assert.match(problema, /no trae una fecha válida/);
});

test('el 30 de febrero tiene la forma correcta y no es un día', () => {
  assert.ok(fechas.revisar(campo(), '2010-02-30'));
  assert.equal(fechas.normalizar('2010-02-30'), null);
});

test('el 29 de febrero sí existe en año bisiesto, y no en los otros', () => {
  assert.equal(fechas.normalizar('2024-02-29'), '2024-02-29');
  assert.equal(fechas.normalizar('2023-02-29'), null);
});

test('el mes 13 y el día 32 no pasan', () => {
  assert.equal(fechas.normalizar('2020-13-01'), null);
  assert.equal(fechas.normalizar('2020-01-32'), null);
});

test('una fecha con hora pegada se acepta por su parte de fecha', () => {
  assert.equal(fechas.normalizar('2020-05-04 13:45:00'), '2020-05-04');
});

// ------------------------------------------------------------ el piso ----

test('nada anterior a 1900, y el aviso apunta al año', () => {
  const problema = fechas.revisar(campo(), '1820-01-01');
  assert.match(problema, /Revise el año/);
  assert.match(problema, /1900/);
});

test('1900 mismo sí entra', () => {
  assert.equal(fechas.revisar(campo(), '1900-01-01'), null);
});

// ----------------------------------------------------------- el techo ----

test('un nacimiento en 2099 no entra: acá se anota lo que ya ocurrió', () => {
  const problema = fechas.revisar(campo(), '2099-12-31');
  assert.match(problema, /todavía no llega/);
});

test('mañana tampoco, en un campo que anota lo que pasó', () => {
  assert.ok(fechas.revisar(campo(), dentroDe(0, 1)));
});

test('hoy sí: un pago o un bautismo de hoy es lo más corriente que hay', () => {
  assert.equal(fechas.revisar(campo(), fechas.hoy()), null);
});

test('un campo que admite futuro deja programar el domingo', () => {
  const actividad = { name: 'fecha', label: 'Fecha', type: 'date', futuro: true };
  assert.equal(fechas.revisar(actividad, dentroDe(0, 7)), null);
});

test('pero al que admite futuro igual se le pone techo, y 2099 lo pasa', () => {
  const actividad = { name: 'fecha', label: 'Fecha', type: 'date', futuro: true };
  const problema = fechas.revisar(actividad, '2099-01-01');
  assert.match(problema, /años adelante/);
});

test('dentro del plazo de un campo con futuro, entra', () => {
  const credencial = { name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', futuro: true };
  assert.equal(fechas.revisar(credencial, dentroDe(5)), null);
});

// ------------------------------------------------------- la coherencia ----

const fichaDeMiembro = {
  fields: [
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date' },
    { name: 'fecha_bautismo', label: 'Fecha de bautismo', type: 'date', noAntesDe: 'fecha_nacimiento' },
    { name: 'fecha_ingreso', label: 'Fecha de ingreso a la iglesia', type: 'date', noAntesDe: 'fecha_nacimiento' },
  ],
};

test('nadie se bautiza antes de nacer', () => {
  const problema = fechas.revisarCoherencia(fichaDeMiembro, {
    fecha_nacimiento: '2010-01-01', fecha_bautismo: '2005-01-01',
  }, null);
  assert.match(problema, /Fecha de bautismo/);
  assert.match(problema, /Fecha de nacimiento/);
});

test('ni entra a la iglesia veinte años antes de nacer', () => {
  assert.ok(fechas.revisarCoherencia(fichaDeMiembro, {
    fecha_nacimiento: '2010-01-01', fecha_ingreso: '1990-01-01',
  }, null));
});

test('el mismo día está bien: alguien bautizado el día que nació', () => {
  assert.equal(fechas.revisarCoherencia(fichaDeMiembro, {
    fecha_nacimiento: '2010-01-01', fecha_bautismo: '2010-01-01',
  }, null), null);
});

test('si falta una de las dos, no hay nada que comparar', () => {
  assert.equal(fechas.revisarCoherencia(fichaDeMiembro, { fecha_bautismo: '2005-01-01' }, null), null);
  assert.equal(fechas.revisarCoherencia(fichaDeMiembro, { fecha_nacimiento: '2010-01-01' }, null), null);
});

test('se mira la ficha como VA A QUEDAR, no la que estaba guardada', () => {
  // Estaba mal y se están corrigiendo las dos fechas en el mismo guardado:
  // lo que hay que revisar es el resultado, no una mezcla del antes y el
  // después. Si se mirara lo guardado, esta corrección no se podría hacer.
  const guardado = { fecha_nacimiento: '2010-01-01', fecha_bautismo: '2005-01-01' };
  const arreglo = { fecha_nacimiento: '1990-01-01', fecha_bautismo: '2005-01-01' };
  assert.equal(fechas.revisarCoherencia(fichaDeMiembro, arreglo, guardado), null);
});

test('corregir solo una y dejar la otra mal sí se avisa', () => {
  const guardado = { fecha_nacimiento: '2010-01-01', fecha_bautismo: '2005-01-01' };
  assert.ok(fechas.revisarCoherencia(fichaDeMiembro, { fecha_bautismo: '2008-01-01' }, guardado));
});

// ------------------------------------------------------- cómo lo dice ----

test('el aviso escribe la fecha como se lee en Chile, no como la guarda', () => {
  const problema = fechas.revisar(campo(), '2099-12-31');
  assert.match(problema, /31-12-2099/);
  assert.doesNotMatch(problema, /2099-12-31/);
});

test('el aviso nombra el campo, para saber cuál de las seis fechas es', () => {
  const problema = fechas.revisar({ name: 'fecha_bautismo', label: 'Fecha de bautismo', type: 'date' }, '2099-01-01');
  assert.match(problema, /Fecha de bautismo/);
});
