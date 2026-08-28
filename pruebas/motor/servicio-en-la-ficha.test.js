/**
 * La ficha de una persona dice cuándo predicó, coordinó o leyó el salmo.
 *
 * El coordinador, el salmista y el predicador quedan enlazados a su ficha cuando
 * son miembros: el módulo se tomó ese trabajo. Pero la ficha no mostraba nada de
 * eso, y la pregunta más natural —«¿cuándo predicó el hermano?»— no se podía
 * contestar desde donde uno la hace. Medido en la revisión del módulo: el enlace
 * estaba guardado y la pestaña no existía.
 *
 * Lo que se vigila acá es qué contesta la ruta que alimenta esa pestaña: los
 * papeles que tuvo en cada servicio —pueden ser dos en el mismo—, las veces
 * contadas sobre todo lo registrado y no sobre lo que se alcanza a listar, y que
 * no se asome un servicio de otra iglesia.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const servicios = require('../../server/modules/servicios');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const norte = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Ficha ZZ','SRV-FIC','Activa')")
  .run().lastInsertRowid;
const sur = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Ficha Sur ZZ','SRV-FI2','Activa')")
  .run().lastInsertRowid;

const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Hermano','Que Sirve ZZ',?,'Activo')")
  .run(norte).lastInsertRowid;
const otro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Hermana','Que No ZZ',?,'Activo')")
  .run(norte).lastInsertRowid;

function servicio(campos) {
  const fila = { tipo: 'Servicio General', iglesia_id: norte, ...campos };
  const claves = Object.keys(fila);
  db.prepare(`INSERT INTO servicios (${claves.join(',')}) VALUES (${claves.map(() => '?').join(',')})`)
    .run(...claves.map((k) => fila[k]));
}

// Predicó dos veces, coordinó una, leyó el salmo una, y en un servicio hizo dos cosas
servicio({
  fecha: '2030-03-03', predicador_id: miembro, coordinador_id: miembro,
  mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 16, mensaje_versiculo_final: 18,
});
servicio({ fecha: '2030-03-10', predicador_id: miembro, mensaje_libro: 'Marcos', mensaje_capitulo: 5, mensaje_versiculo_inicial: 1 });
servicio({
  fecha: '2030-03-17', salmista_id: miembro, tipo: 'Servicio Vigilia',
  salmo_libro: 'Salmos', salmo_capitulo: 23, salmo_versiculo_inicial: 1,
});
// Uno de la otra iglesia, donde también predicó: no le toca a quien solo ve el Norte
servicio({ fecha: '2030-03-24', iglesia_id: sur, predicador_id: miembro, mensaje_libro: 'Hechos', mensaje_capitulo: 9 });

/** La ruta del módulo, sacada de donde el motor la monta. */
function laRuta() {
  const rutas = {};
  servicios.extraRoutes(
    { get: (ruta, _permiso, fn) => { rutas[ruta] = fn; } },
    { db, requirePerm: () => (req, res, next) => next(), comoSeArmaElListado: () => ({ params: [], whereSql: '' }) }
  );
  return rutas['/servicios/de-persona'];
}

/** Lo que contesta, como se lo pediría la ficha. */
function loQueDice(id, usuario = { rol: 'admin' }) {
  let salida = null;
  let estado = 200;
  laRuta()(
    { query: { id: id === null ? '' : String(id) }, user: usuario },
    { json: (d) => { salida = d; return d; }, status: (c) => { estado = c; return { json: (d) => { salida = d; } }; } }
  );
  return { estado, ...salida };
}

/* ------------------------------------------------------------ qué contesta */

test('dice en qué servicios sirvió, del más nuevo al más viejo', () => {
  const d = loQueDice(miembro);
  assert.equal(d.servicios.length, 4);
  assert.deepEqual(d.servicios.map((s) => s.fecha),
    ['2030-03-24', '2030-03-17', '2030-03-10', '2030-03-03']);
});

test('y qué hizo en cada uno', () => {
  const porFecha = Object.fromEntries(loQueDice(miembro).servicios.map((s) => [s.fecha, s.papeles]));
  assert.deepEqual(porFecha['2030-03-10'], ['Predicó']);
  assert.deepEqual(porFecha['2030-03-17'], ['Leyó el salmo']);
});

test('en el mismo servicio puede haber hecho dos cosas', () => {
  const uno = loQueDice(miembro).servicios.find((s) => s.fecha === '2030-03-03');
  assert.deepEqual(uno.papeles, ['Predicó', 'Coordinó']);
});

test('el pasaje viene armado, como se lee', () => {
  const uno = loQueDice(miembro).servicios.find((s) => s.fecha === '2030-03-03');
  assert.equal(uno.cita_mensaje, 'Juan 3:16-18');
  const salmo = loQueDice(miembro).servicios.find((s) => s.fecha === '2030-03-17');
  assert.equal(salmo.cita_salmo, 'Salmos 23:1');
});

test('las veces se cuentan por papel', () => {
  const v = loQueDice(miembro).veces;
  assert.equal(v.servicios, 4);
  assert.equal(v.predico, 3);
  assert.equal(v.coordino, 1);
  assert.equal(v.leyo, 1);
});

test('quien no ha servido en ninguno lo dice sin inventar nada', () => {
  const d = loQueDice(otro);
  assert.equal(d.servicios.length, 0);
  assert.deepEqual(d.veces, { servicios: 0, predico: 0, coordino: 0, leyo: 0 });
});

test('sin decir de quién, no se contesta', () => {
  assert.equal(loQueDice(null).estado, 400);
});

/* ------------------------------------------------------------- el alcance */

test('no se asoma un servicio de una iglesia que no le toca', () => {
  const soloDelNorte = { rol: 'secretario', iglesias: JSON.stringify([norte]) };
  const d = loQueDice(miembro, soloDelNorte);
  assert.equal(d.servicios.length, 3, 'se coló uno de la otra iglesia');
  assert.ok(!d.servicios.some((s) => s.fecha === '2030-03-24'));
});

test('y las veces tampoco cuentan lo que no se ve', () => {
  const soloDelNorte = { rol: 'secretario', iglesias: JSON.stringify([norte]) };
  const v = loQueDice(miembro, soloDelNorte).veces;
  assert.equal(v.servicios, 3);
  assert.equal(v.predico, 2, 'contó el de la otra iglesia');
});

/* ------------------------------------------------------------- la pestaña */

test('la ficha del miembro tiene su pestaña de servicios', () => {
  assert.match(app, /sumar\('servicios', 'Servicios', '🕊️', \(c\) => renderServiciosDeLaPersona\(id, c\)\)/);
  assert.match(app, /function renderServiciosDeLaPersona/);
});

test('la pestaña pide lo suyo y muestra los papeles', () => {
  const trozo = app.slice(app.indexOf('async function renderServiciosDeLaPersona'));
  assert.match(trozo.slice(0, 4000), /\/servicios\/de-persona\?id=\$\{personaId\}/);
  assert.match(trozo.slice(0, 4000), /x\.papeles\.map/);
});

test('las veces se dicen solo de los papeles que tuvo', () => {
  // «Leyó el salmo 0 veces» no dice nada: los papeles en cero no se escriben
  const trozo = app.slice(app.indexOf('async function renderServiciosDeLaPersona'));
  assert.match(trozo.slice(0, 4000), /v\.predico \?/);
  assert.match(trozo.slice(0, 4000), /v\.leyo \?/);
});

test('el pasaje se muestra junto al papel que corresponde', () => {
  // El del mensaje si predicó, el del salmo si lo leyó: al revés sería decir
  // que predicó sobre un salmo que leyó otro
  const trozo = app.slice(app.indexOf('async function renderServiciosDeLaPersona'));
  assert.match(trozo.slice(0, 4000), /x\.papeles\.includes\('Predicó'\) \? x\.cita_mensaje/);
  assert.match(trozo.slice(0, 4000), /x\.papeles\.includes\('Leyó el salmo'\) \? x\.cita_salmo/);
});
