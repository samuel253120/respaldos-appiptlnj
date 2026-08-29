/**
 * ENCONTRAR A ALGUIEN POR SU TELÉFONO, ESCRITO COMO SEA.
 *
 * Medido sobre una ficha con el teléfono guardado «+56 9 5000 0000»:
 * buscarlo tal cual daba 1, «+56950000000» daba CERO y los ocho dígitos del
 * número daban CERO también. Y así es justo como lo copia quien lo tiene en el
 * celular o lo lee de un papel: nadie reproduce los espacios de quien lo
 * anotó.
 *
 * El RUT y los montos ya se encontraban escritos de cualquier forma, con una
 * regla que compara además «de corrido», sin lo que separa el número. Al
 * teléfono no le faltaba una regla nueva: le faltaba que esa supiera que un
 * número también se separa con espacios, con un signo más y con paréntesis.
 *
 * Y de paso este archivo cuida lo que esa generalización podía romper: pegar
 * los campos y después quitarles los espacios los corría uno contra otro.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const busqueda = require('../../server/busqueda');
const noMiembros = require('../../server/modules/no_miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Teléfonos', 'IG-TEL', 'Activa')")
  .run().lastInsertRowid;
const ficha = (nombres, telefono, rut) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, telefono, rut, iglesia_id) VALUES (?,?,?,?,?)')
  .run(nombres, 'De Teléfono', telefono || null, rut || null, iglesia).lastInsertRowid;

const conEspacios = ficha('Marisol', '+56 9 5000 0000');
const deCorrido = ficha('Fabiola', '+56987654321');
const conGuiones = ficha('Ignacia', '9-8888-7777');

/** Buscar como busca el sistema: los mismos campos y la misma condición. */
function buscar(q) {
  const c = busqueda.condicion(q, noMiembros.searchFields, []);
  if (!c) return [];
  return db
    .prepare(`SELECT id, nombres FROM no_miembros WHERE iglesia_id = ? AND (${c.sql})`)
    .all(iglesia, ...c.params)
    .map((f) => f.id);
}

/* ------------------------------------- el teléfono, escrito como sea */

test('guardado con espacios, se encuentra tal cual', () => {
  assert.deepEqual(buscar('+56 9 5000 0000'), [conEspacios]);
});

test('guardado con espacios, se encuentra escrito de corrido', () => {
  assert.deepEqual(buscar('+56950000000'), [conEspacios], 'antes daba CERO');
});

test('y por los ocho dígitos del número, sin el código de país', () => {
  assert.deepEqual(buscar('50000000'), [conEspacios], 'antes daba CERO');
});

test('guardado de corrido, se encuentra escrito con espacios', () => {
  assert.deepEqual(buscar('+56 9 8765 4321'), [deCorrido],
    'las dos formas tienen que calzar en los dos sentidos');
});

test('guardado con guiones, se encuentra sin ellos', () => {
  assert.deepEqual(buscar('988887777'), [conGuiones]);
});

test('los últimos cuatro siguen encontrando', () => {
  assert.deepEqual(buscar('4321'), [deCorrido], 'lo que ya funcionaba no se rompe');
});

/* ------------------------------- lo que ya se encontraba, sin tocar */

test('el RUT sigue encontrándose de todas sus formas', () => {
  const conRut = ficha('Rut', null, '21000000-3');
  for (const q of ['21000000-3', '21.000.000-3', '210000003', '21000000']) {
    assert.deepEqual(buscar(q), [conRut], `no la encontró buscando «${q}»`);
  }
});

test('un texto no se compara de corrido', () => {
  assert.equal(busqueda.seComparaDeCorrido('Marisol'), false);
  assert.equal(busqueda.seComparaDeCorrido('+56911112222'), true);
  assert.equal(busqueda.seComparaDeCorrido('250.000'), true);
});

test('el código de país entre paréntesis, que es como viene en una tarjeta', () => {
  /*
   * Esta salió probando el sistema andando, no escribiendo pruebas. De las
   * seis formas de teclear el mismo teléfono, cinco lo encontraban y esta no:
   * «(56) 9 5000 0000». La búsqueda parte lo tecleado en palabras, y la
   * palabra «(56)» empieza por un paréntesis; preguntando sobre el texto
   * crudo no parecía un número, así que se comparaba letra por letra contra
   * los campos —donde ese paréntesis no está— y la ficha se perdía entera por
   * culpa de una de sus tres palabras.
   *
   * Se arregló preguntando sobre lo tecleado ya limpio: si lo que queda son
   * dígitos, es un número. Así no hay que enumerar por dónde puede empezar.
   */
  assert.equal(busqueda.seComparaDeCorrido('(56)'), true, 'antes daba false y arrastraba la búsqueda');
  assert.deepEqual(buscar('(56) 9 5000 0000'), [conEspacios], 'antes daba CERO');
  assert.deepEqual(buscar('(56)9-5000.0000'), [conEspacios]);
});

test('un dígito solo sigue sin compararse de corrido', () => {
  assert.equal(busqueda.seComparaDeCorrido('3'), false,
    'un dígito nunca se escribió con separadores: compararlo de corrido solo agrega falsos calces');
  assert.equal(busqueda.seComparaDeCorrido('-'), false, 'y lo que al limpiarlo no deja nada, tampoco');
});

/* ---------------------- lo que la generalización podía romper */

test('los campos no se corren uno contra otro al quitarles los espacios', () => {
  /*
   * Si se limpiara el texto ya pegado, el espacio que separa dos campos se
   * iría con los demás y sus valores quedarían corridos: un RUT «12345678»
   * seguido de un teléfono «9000» daría «123456789000», y buscar «789000»
   * encontraría una ficha donde ese número no está. Con dos separadores era
   * improbable; con los espacios adentro dejaba de serlo.
   */
  const pegada = ficha('Pegada', '9000', '12345678-5');
  assert.deepEqual(buscar('789000'), [], 'ese número no está en ninguno de sus dos campos');
  assert.deepEqual(buscar('12345678'), [pegada], 'pero cada campo suyo sí se encuentra');
  assert.deepEqual(buscar('9000'), [pegada]);
});

test('la limpieza se hace campo por campo, no sobre el texto pegado', () => {
  const sql = busqueda.textoDeCorrido(['rut', 'telefono'], []);
  assert.match(sql, /\|\| ' ' \|\|/, 'los campos se pegan con un espacio DESPUÉS de limpiarlos');
  const trozos = sql.split("|| ' ' ||");
  assert.equal(trozos.length, 2);
  for (const t of trozos) assert.match(t, /replace\([\s\S]*' ',''\)/, 'y cada uno viene ya sin espacios');
});
