/**
 * En un traspaso, la plata se entrega hacia arriba.
 *
 * El módulo dice desde el primer día que su caso corriente es que cada iglesia
 * le traspase a la corporación el porcentaje que apartó. Y no se podía hacer:
 * la cuenta de la corporación no es de ninguna iglesia, así que quedaba fuera
 * del alcance de toda tesorera local. Medido:
 *
 *   el desplegable «Hacia» le ofrecía la tesorería de la corporación, con su
 *   nombre, y al guardar recibía «403 · Hacia la cuenta: cuenta de tesorería
 *   n.º 1 está fuera de lo que tiene asignado».
 *
 * Un nivel más abajo pasaba lo mismo: a una tesorera de cuerpo el desplegable
 * le ofrecía 26 cuentas y le servía 1 —la otra de su propio cuerpo—. Entregarle
 * a su iglesia lo recaudado era de los rechazados.
 *
 * La regla quedó en un solo lugar, server/entregar-hacia-arriba.js: el destino
 * puede ser una cuenta que quien anota no administra, si está MÁS ARRIBA y —de
 * tener iglesia— es la MISMA. Nunca al lado, nunca hacia abajo. Y entregar no
 * es administrar: la cuenta de arriba sigue sin poder abrirse, ni recibir un
 * movimiento a mano, ni ser el origen de nada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const arriba = require('../../server/entregar-hacia-arriba');
const traspasosMod = require('../../server/modules/traspasos');

const central = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la Entrega','IG-ENT-C','Activa')").run().lastInsertRowid;
const norte = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de la Entrega','IG-ENT-N','Activa')").run().lastInsertRowid;
const cuerpoA = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de la Entrega','Cuerpo',?,'Activo')").run(central).lastInsertRowid;
const cuerpoB = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Varones de la Entrega','Cuerpo',?,'Activo')").run(central).lastInsertRowid;

const cuenta = (nombre, iglesiaId, cuerpoId) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, ?, 'Proyecto / Trabajo', ?, ?, 'Activa', 5000000, '2020-01-01')`)
  .run(nombre, cuerpoId ? 'Cuerpo / Grupo' : (iglesiaId ? 'Iglesia local' : 'Corporación'),
       iglesiaId, cuerpoId || null).lastInsertRowid;

const laDelCuerpoA = cuenta('Caja de las Damas de la Entrega', central, cuerpoA);
const otraDelCuerpoA = cuenta('Cuotas de las Damas de la Entrega', central, cuerpoA);
const laDelCuerpoB = cuenta('Caja de los Varones de la Entrega', central, cuerpoB);
const laDeLaCentral = cuenta('Caja de la Central de la Entrega', central, null);
const laDeLaNorte = cuenta('Caja de la Norte de la Entrega', norte, null);
const laDeLaCorp = cuenta('Caja de la corporación de la Entrega', null, null);

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);

const deLaCentral = { id: 81, rol: 'tesorero', iglesias: [central], cuerpos: [] };
const delCuerpoA = { id: 82, rol: 'tesorero', iglesias: [central], cuerpos: [cuerpoA],
  permisos: JSON.stringify({ tesoreria_general: [] }) };

/** Corre el gancho como lo corre el motor. */
const guardar = (quien, origen, destino, extra = {}) => traspasosMod.hooks.beforeSave(
  { fecha: '2026-05-05', cuenta_origen_id: origen, cuenta_destino_id: destino, monto: 1000,
    forma: 'Efectivo', concepto: 'Entrega ' + Math.random().toString(36).slice(2, 8), ...extra },
  { user: quien, existing: null, db, confirmado: true }
);

// ------------------------------------------------------ la regla, sola ----

test('la regla dice hacia arriba y misma iglesia, y nada más', () => {
  const casos = [
    ['de un cuerpo a su iglesia', laDelCuerpoA, laDeLaCentral, true],
    ['de un cuerpo a la corporación', laDelCuerpoA, laDeLaCorp, true],
    ['de una iglesia a la corporación', laDeLaCentral, laDeLaCorp, true],
    ['de un cuerpo a otra iglesia', laDelCuerpoA, laDeLaNorte, false],
    ['de un cuerpo al cuerpo de al lado', laDelCuerpoA, laDelCuerpoB, false],
    ['de una iglesia a otra iglesia', laDeLaCentral, laDeLaNorte, false],
    ['de una iglesia hacia abajo, a un cuerpo', laDeLaCentral, laDelCuerpoA, false],
    ['de la corporación hacia abajo', laDeLaCorp, laDeLaCentral, false],
    ['entre dos cuentas del mismo cuerpo', laDelCuerpoA, otraDelCuerpoA, false],
  ];
  for (const [rot, o, d, esperado] of casos) {
    assert.equal(arriba.admiteComoDestino(fila(o), fila(d)), esperado, rot);
  }
});

test('el nivel de una cuenta lo dicen sus propias columnas', () => {
  assert.equal(arriba.nivelDe(fila(laDelCuerpoA)), 'cuerpo');
  assert.equal(arriba.nivelDe(fila(laDeLaCentral)), 'iglesia');
  assert.equal(arriba.nivelDe(fila(laDeLaCorp)), 'corporacion');
  assert.deepEqual(arriba.NIVELES, ['cuerpo', 'iglesia', 'corporacion'],
    'de abajo hacia arriba: de ese orden depende qué es «más arriba»');
});

// --------------------------------------------------- lo que ahora entra ----

test('EL CASO PRINCIPAL: la tesorera de una iglesia le entrega a la corporación', () => {
  assert.equal(guardar(deLaCentral, laDeLaCentral, laDeLaCorp), null,
    'antes: «403 · cuenta de tesorería n.º 1 está fuera de lo que tiene asignado»');
});

test('y la tesorera de un cuerpo le entrega a su iglesia', () => {
  assert.equal(guardar(delCuerpoA, laDelCuerpoA, laDeLaCentral), null,
    'antes era uno de los veinticuatro rechazos de veintiséis');
});

test('entre las dos cuentas de su propio cuerpo sigue pudiendo, como siempre', () => {
  assert.equal(guardar(delCuerpoA, laDelCuerpoA, otraDelCuerpoA), null);
});

// ------------------------------------------------- lo que sigue cerrado ----

test('hacia el cuerpo de al lado, no', () => {
  const r = guardar(delCuerpoA, laDelCuerpoA, laDelCuerpoB);
  assert.match(String(r), /no está entre las que administra/);
  assert.match(String(r), /entrega hacia arriba/, 'y dice por qué, no solo que no');
});

test('hacia otra congregación, tampoco', () => {
  assert.match(String(guardar(deLaCentral, laDeLaCentral, laDeLaNorte)), /no está entre las que administra/);
});

test('y sacar DE una cuenta de arriba sigue estando prohibido: entregar no es administrar', () => {
  assert.match(String(guardar(deLaCentral, laDeLaCorp, laDeLaCentral)), /no está entre las que administra/);
  assert.match(String(guardar(delCuerpoA, laDeLaCentral, laDelCuerpoA)), /no está entre las que administra/);
});

test('la excepción vale solo para el DESTINO de un traspaso, no para el motor entero', () => {
  /*
   * El motor comprueba toda referencia contra el alcance de quien guarda. Este
   * campo se salta esa comprobación porque el módulo hace la suya, y es el
   * único: si mañana otro se declara así sin escribir la suya, quedaría abierto.
   */
  const campos = getModule('traspasos').fields.filter((f) => f.alcanceLoDecideElModulo);
  assert.deepEqual(campos.map((f) => f.name), ['cuenta_destino_id']);

  const motor = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(motor, /if \(f\.alcanceLoDecideElModulo\) continue;/);
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/traspasos.js'), 'utf8');
  assert.match(modulo, /admiteComoDestino\(origen, destino\)/,
    'el módulo que se salta la comprobación del motor tiene que hacer la suya');
});

// ------------------------------------------------- de quién es lo anotado ----

test('un traspaso es de quien lo SACA: su nivel lo decide la cuenta de origen', () => {
  /*
   * Miraba las dos cuentas, y con eso la tesorera del cuerpo anotaba una
   * entrega que después no veía: el destino era de nivel general y el listado
   * se la escondía.
   */
  const tesorerias = require('../../server/tesorerias');
  assert.deepEqual(tesorerias.LIBROS.traspasos.cuentas, ['cuenta_origen_id']);

  const suyo = { cuenta_origen_id: laDelCuerpoA, cuenta_destino_id: laDeLaCentral };
  assert.equal(tesorerias.alcanza(getModule('traspasos'), suyo, delCuerpoA, db), true,
    'la entrega que ella misma anotó tiene que quedarle a la vista');
  const ajeno = { cuenta_origen_id: laDeLaCentral, cuenta_destino_id: laDeLaCorp };
  assert.equal(tesorerias.alcanza(getModule('traspasos'), ajeno, delCuerpoA, db), false,
    'y lo que sale del nivel general, no');
});

// ------------------------------------------ el desplegable y el guardado ----

test('el desplegable ofrece lo suyo y lo de más arriba, y nada suelto', () => {
  /*
   * Contado antes de esto: a una tesorera de iglesia el desplegable le ofrecía
   * 38 cuentas y le servían 36; a una de cuerpo le ofrecía 26 y le servía 1.
   * Un desplegable que promete lo que el guardado rechaza hace perder el
   * trabajo ya hecho y no explica por qué.
   */
  const params = [];
  const cond = arriba.condicionDeDestinos(delCuerpoA, db, params);
  assert.ok(cond, 'a una tesorera de cuerpo hay que ofrecerle algo de más arriba');
  const ofrecidas = db.prepare(`SELECT id FROM cuentas_tesoreria WHERE ${cond}`).all(...params).map((c) => c.id);
  assert.ok(ofrecidas.includes(laDeLaCentral), 'la cuenta de su iglesia');
  assert.ok(ofrecidas.includes(laDeLaCorp), 'y la de la corporación');
  assert.ok(!ofrecidas.includes(laDeLaNorte), 'pero no la de otra congregación');
  assert.ok(!ofrecidas.includes(laDelCuerpoB), 'ni la del cuerpo de al lado');
});

test('a quien no está acotado a nada no se le agrega ninguna condición', () => {
  /*
   * `condiciones` devuelve null para quien alcanza todo, y ahí «lo suyo» es
   * todo: pegarle solo la de hacia arriba lo dejaría con la cuenta de la
   * corporación como único destino, que es lo contrario de lo que se quiere.
   */
  const sinAcotar = { id: 84, rol: 'admin', iglesias: [], cuerpos: [] };
  assert.equal(arriba.condicionDeDestinos(sinAcotar, db, []), null);

  const ruta = fs.readFileSync(path.join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');
  assert.match(ruta, /if \(suyas\) where\.push\(haciaArriba \? `\(\$\{suyas\} OR \$\{haciaArriba\}\)` : `\(\$\{suyas\}\)`\);/,
    'sin condición de alcance no se agrega ninguna');
});

test('la ruta de destinos usa la condición completa del listado, no una copia', () => {
  const ruta = fs.readFileSync(path.join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');
  const trozo = ruta.slice(ruta.indexOf("router.get('/cuentas_tesoreria/destinos'"));
  assert.match(trozo.slice(0, 900), /alcance'\)\s*\.condiciones\(module\.exports, req\.user, params\)|condiciones\(module\.exports, req\.user, params\)/,
    'la iglesia, el cuerpo y el nivel salen de un solo lugar');
  assert.match(trozo.slice(0, 900), /condicionDeDestinos\(req\.user, db, params\)/);
});
