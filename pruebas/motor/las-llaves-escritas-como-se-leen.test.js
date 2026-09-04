/**
 * Los permisos, escritos como se leen y no como los guarda la base.
 *
 * El Registro de Cambios abre diciendo que existe para dos cosas: el dinero y
 * las llaves. La mitad del dinero se leía bien —la plata con su signo, las
 * fechas como se leen acá, un enlace con el nombre de aquello a lo que
 * apunta— y la de las llaves era la única línea que había que descifrar.
 * Medido en la v1.370.0, al cambiarle las excepciones a una cuenta:
 *
 *     Excepciones para esta persona: {"tesoreria_montos":[],"miembros_rut":[]}
 *       → {"tesoreria_montos":[],"miembros_rut":[],"tesoreria":["view"]}
 *
 * Y dice algo que importa: a esa persona se le acaba de abrir Tesorería.
 *
 * Lo que se vigila acá: que la línea salga en palabras, que anote la
 * DIFERENCIA y no las dos listas enteras —un perfil concede sobre los cuarenta
 * y tantos módulos del sistema—, y que guardar una ficha sin tocarle los
 * permisos no anote un cambio que no ocurrió.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const bitacora = require('../../server/bitacora');
const { comoSeLeenLosPermisos, elCambioDeLosPermisos } = bitacora;

/* ------------------------------------------------- lo que dice cada cosa */

test('un permiso se lee con el nombre de la llave y lo que deja hacer', () => {
  const dice = comoSeLeenLosPermisos('{"tesoreria":["view","create","edit"]}');
  assert.match(dice, /Tesorería: ver, crear y editar/);
  assert.ok(!dice.includes('{'), 'nada de JSON');
  assert.ok(!dice.includes('view'), 'ni de inglés');
});

test('una llave cerrada dice que no deja hacer nada, y ninguna dice «(ninguno)»', () => {
  assert.match(comoSeLeenLosPermisos('{"tesoreria_montos":[]}'), /Montos del dinero: nada/);
  assert.equal(comoSeLeenLosPermisos(null), '(ninguno)');
  assert.equal(comoSeLeenLosPermisos('{}'), '(ninguno)');
});

test('lo que no se puede leer no rompe la línea', () => {
  // Una columna vieja puede traer cualquier cosa, y un registro que revienta
  // al leerse es peor que uno feo.
  assert.equal(comoSeLeenLosPermisos('no es json'), '(ninguno)');
});

/* ------------------------------------------------------- la diferencia */

test('conceder, cerrar y quitar la excepción se dicen distinto, porque son distintos', () => {
  assert.deepEqual(elCambioDeLosPermisos('{}', '{"tesoreria":["view"]}'),
    ['se le concede Tesorería (ver)']);
  assert.deepEqual(elCambioDeLosPermisos('{}', '{"tesoreria_montos":[]}'),
    ['se le cierra Montos del dinero']);
  assert.deepEqual(elCambioDeLosPermisos('{"tesoreria":["view"]}', '{}'),
    ['Tesorería: se le quita la excepción y vuelve a valer su perfil'],
    'quitar la excepción no es cerrarla: vuelve a valer lo que le dé su perfil');
});

test('y cambiarle las acciones a una llave dice las dos, en palabras', () => {
  assert.deepEqual(elCambioDeLosPermisos('{"tesoreria":["view"]}', '{"tesoreria":["view","edit"]}'),
    ['Tesorería: ver → ver y editar']);
});

test('las llaves que no se movieron no salen', () => {
  const dice = elCambioDeLosPermisos(
    '{"tesoreria_montos":[],"miembros_identidad":[]}',
    '{"tesoreria_montos":[],"miembros_identidad":[],"tesoreria":["view"]}'
  );
  assert.deepEqual(dice, ['se le concede Tesorería (ver)'],
    'las dos que siguen igual no tienen por qué repetirse');
});

test('el mismo permiso escrito en otro orden no es un cambio', () => {
  assert.deepEqual(elCambioDeLosPermisos('{"a":["view","edit"],"b":[]}', '{"b":[],"a":["edit","view"]}'), [],
    'el formulario los manda en el orden en que los dibujó, no en el que quedaron guardados');
});

/* ------------------------------------- la línea que queda de verdad anotada */

const usuarios = getModule('usuarios');
const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Llaves LL','LL-LLA','Activa')")
  .run().lastInsertRowid;

/** Guarda un cambio como lo guarda el motor y devuelve la línea que quedó. */
function laLineaDe(antes, despues) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  const fila = { id: 90910, nombre: 'Ayudante LL', rut: '9-9', iglesia_id: iglesia, permisos: despues };
  bitacora.registrarGuardado(usuarios, {
    isNew: false,
    antes: { ...fila, permisos: antes },
    despues: fila,
    datos: { permisos: despues },
    user: { id: 1, nombre: 'Administrador' },
  });
  return db
    .prepare('SELECT detalle FROM registro_cambios WHERE id > ? AND iglesia_id = ? ORDER BY id DESC LIMIT 1')
    .get(desde, iglesia);
}

test('la línea del registro sale en palabras, sin una llave de JSON', () => {
  const linea = laLineaDe('{"tesoreria_montos":[]}', '{"tesoreria_montos":[],"tesoreria":["view"]}');
  assert.ok(linea, 'no quedó anotada ninguna línea');
  assert.match(linea.detalle, /Excepciones para esta persona: se le concede Tesorería \(ver\)/);
  assert.ok(!/[{}[\]"]/.test(linea.detalle), `salió con JSON adentro: ${linea.detalle}`);
});

test('guardar sin tocar los permisos no anota nada', () => {
  const mismos = '{"tesoreria_montos":[],"tesoreria":["view"]}';
  const antes = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  laLineaDe(mismos, '{"tesoreria":["view"],"tesoreria_montos":[]}');
  const despues = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  assert.equal(despues, antes, 'un cambio que no ocurrió es justo lo que hace que un registro se deje de leer');
});

test('y al borrar una cuenta queda escrito lo que podía hacer', () => {
  /*
   * El listado dice quién era y con qué rol; lo que distingue a una cuenta de
   * otra del mismo rol son sus excepciones, y de eso no quedaba nada. Es lo
   * único que hace pasar los permisos por la traducción al borrarse, así que
   * si alguien saca el campo de `camposAlBorrar` esto lo dice.
   */
  assert.ok(usuarios.camposAlBorrar.includes('permisos'));
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  bitacora.registrarEliminado(usuarios, {
    id: 90911, nombre: 'Ayudante LL que se va', rut: '9-9', rol: 'tesorero', iglesia_id: iglesia,
    permisos: '{"tesoreria_montos":[],"tesoreria":["view","edit"]}',
  }, { id: 1, nombre: 'Administrador' });
  const linea = db
    .prepare('SELECT detalle FROM registro_cambios WHERE id > ? AND iglesia_id = ? ORDER BY id DESC LIMIT 1')
    .get(desde, iglesia);
  assert.ok(linea, 'el borrado de una cuenta no quedó anotado');
  assert.match(linea.detalle, /Excepciones para esta persona: Montos del dinero: nada · Tesorería: ver y editar/);
  assert.ok(!/[{}[\]"]/.test(linea.detalle), `salió con JSON adentro: ${linea.detalle}`);
});

test('y la línea no crece con el tamaño del perfil: solo dice lo que se movió', () => {
  /*
   * Un perfil concede sobre los cuarenta y tantos módulos del sistema. Con las
   * dos listas enteras, cambiar un permiso dejaba una línea de varios miles de
   * letras donde había que buscar a ojo qué se movió.
   */
  const muchos = {};
  for (const m of require('../../server/registry').allModules()) muchos[m.name] = ['view'];
  const antes = JSON.stringify(muchos);
  const despues = JSON.stringify({ ...muchos, tesoreria: ['view', 'edit'] });
  const linea = laLineaDe(antes, despues);
  assert.match(linea.detalle, /Tesorería: ver → ver y editar/);
  assert.ok(linea.detalle.length < 100,
    `la línea mide ${linea.detalle.length} y las dos listas medirían ${antes.length + despues.length}`);
});
