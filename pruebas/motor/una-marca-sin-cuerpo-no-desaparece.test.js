/**
 * Una marca sin cuerpo se nombra, en vez de desaparecer en silencio.
 *
 * La marca guarda a qué cuerpo corresponde y puede quedarse sin él: el sistema
 * lo repara al arrancar, pero su propio aviso reconoce que hay casos que no
 * puede resolver —«la persona pertenece a varios de los cuerpos convocados, o a
 * ninguno; se dejaron como estaban»—, y una copia restaurada o una planilla
 * importada traen los suyos.
 *
 * Lo que quedaba así no se veía en NINGUNA vista por cuerpo y no se decía.
 * Medido en la v1.378.0 sobre la base cargada: el informe por cuerpo de cuatro
 * meses entregaba UNA fila, con el nombre en blanco y 25.400 marcas dentro, y
 * la hoja mensual de cualquier cuerpo salía vacía. Una fila sin nombre con
 * veinticinco mil marcas no se lee como un aviso: se lee como un cuerpo que se
 * llama así.
 *
 * No se inventa a quién pertenecen —eso sería peor—: se dice que están y que no
 * entran, que es lo que permite ir a arreglarlas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const asistencias = require('../../server/modules/asistencias');
const planilla = require('../../server/planilla-asistencia');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central SC ${marca}`, `SC-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas SC ${marca}`, iglesia).lastInsertRowid;
const laFila = () => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpo);

const gente = [];
for (let i = 0; i < 2; i++) {
  const numero = `${25000000 + (marca * 19 + i) % 900000}`;
  const id = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(`Persona${i}`, `SC ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(cuerpo, id, iglesia);
  gente.push(id);
}
const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;

/** Una actividad de este cuerpo, con marcas que se le ponen a mano. */
function conMarcas(fecha, filas) {
  const act = db.prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos)
     VALUES (?, ?, ?, ?, ?)`
  ).run(fecha, TIPO, `Reunión SC ${marca}`, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  for (const f of filas) {
    db.prepare(
      `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
       VALUES (?,?,?,?,?,?)`
    ).run(act, f.quien, f.estado, f.cuerpo === undefined ? cuerpo : f.cuerpo, fecha, iglesia);
  }
  return act;
}

// Una con su cuerpo y otra sin él, el mismo mes
conMarcas('2026-02-01', [{ quien: gente[0], estado: 'Presente' }, { quien: gente[1], estado: 'Ausente' }]);
conMarcas('2026-02-08', [{ quien: gente[0], estado: 'Presente', cuerpo: null },
  { quien: gente[1], estado: 'Presente', cuerpo: null }]);

// -------------------------------------------------------- cómo se nombran ---

test('la marca que nunca supo de qué cuerpo era se llama por lo que es', () => {
  assert.equal(asistencias.comoSeLlamaElCuerpo({ cuerpo_id: null, cuerpo: null }), '(sin cuerpo anotado)');
  assert.equal(asistencias.comoSeLlamaElCuerpo({ cuerpo_id: null, cuerpo: null }), asistencias.SIN_CUERPO);
});

test('y la que apunta a un cuerpo que ya no está se distingue de la anterior', () => {
  assert.equal(asistencias.comoSeLlamaElCuerpo({ cuerpo_id: 87, cuerpo: null }), '(cuerpo n.º 87, ya borrado)');
});

test('el cuerpo que sí tiene nombre se llama como se llama', () => {
  assert.equal(asistencias.comoSeLlamaElCuerpo({ cuerpo_id: 3, cuerpo: 'Coro' }), 'Coro');
});

// ---------------------------------------------------- el informe por cuerpo -

test('el informe por cuerpo ya no entrega una fila sin nombre', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', '/asistencias/informe?desde=2026-02-01&hasta=2026-02-28');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  const sinNombre = r.json.porCuerpo.filter((f) => !f.cuerpo);
  assert.deepEqual(sinNombre, [], 'ninguna fila del informe por cuerpo queda en blanco');

  const suelta = r.json.porCuerpo.find((f) => f.cuerpo_id === null);
  assert.ok(suelta, 'las marcas sin cuerpo siguen contándose: no se esconden');
  assert.equal(suelta.cuerpo, asistencias.SIN_CUERPO);
});

test('y las que sí tienen cuerpo siguen saliendo con el suyo', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', '/asistencias/informe?desde=2026-02-01&hasta=2026-02-28');
  const mia = r.json.porCuerpo.find((f) => f.cuerpo_id === cuerpo);
  assert.ok(mia, 'el cuerpo de la prueba está');
  assert.equal(mia.cuerpo, `Damas SC ${marca}`);
});

test('el detalle de una persona también nombra el cuerpo de cada marca', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', `/asistencias/informe?tipo=persona&miembro_id=${gente[0]}&desde=2026-02-01&hasta=2026-02-28`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.ok(r.json.marcas.length >= 2, 'sus dos marcas del mes');
  assert.deepEqual(r.json.marcas.filter((m) => !m.cuerpo), [], 'ninguna sale con el cuerpo en blanco');
  assert.ok(
    r.json.marcas.some((m) => m.cuerpo === asistencias.SIN_CUERPO),
    'la del 8 de febrero se nombra por lo que es'
  );
  assert.ok(r.json.porMiembroCuerpo.every((f) => f.cuerpo), 'y su desglose por cuerpo, igual');
});

// ------------------------------------------------------- la hoja mensual ----

test('la hoja mensual cuenta las que no puede mostrar', () => {
  const p = planilla.armar(db, laFila(), '2026-02');
  assert.equal(p.sinCuerpo, 2, 'las dos del 8 de febrero');
  assert.deepEqual(p.diasConReunion, [1], 'y en la hoja va solo el día que sí tiene cuerpo');
});

test('no se las reparte entre los integrantes ni les mueve el porcentaje', () => {
  const p = planilla.armar(db, laFila(), '2026-02');
  for (const x of p.integrantes) {
    assert.equal(x.total, 1, `${x.nombre}: solo el día 1 tiene marcas de este cuerpo`);
    assert.equal(Object.keys(x.marcas).length, 1);
  }
  assert.equal(p.porDia[1].integrantes, 2);
  assert.equal(p.porDia[8], undefined, 'el 8 no lleva totales: sus marcas no son de nadie conocido');
});

test('un mes sin ninguna marca suelta no dice nada', () => {
  conMarcas('2026-03-01', [{ quien: gente[0], estado: 'Presente' }]);
  const p = planilla.armar(db, laFila(), '2026-03');
  assert.equal(p.sinCuerpo, 0);
  assert.deepEqual(p.diasConReunion, [1]);
});

test('una VISITA sin cuerpo no cuenta como marca suelta: es otra cosa', () => {
  const act = conMarcas('2026-04-05', [{ quien: gente[0], estado: 'Presente' }]);
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id, visita)
     VALUES (?,?,'Presente',NULL,'2026-04-05',?,1)`
  ).run(act, gente[1], iglesia);
  const p = planilla.armar(db, laFila(), '2026-04');
  assert.equal(p.sinCuerpo, 0, 'una visita ya está fuera de la hoja a propósito, y se cuenta aparte');
});

// ------------------------------------------------ y lo que dibuja la pantalla

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/** `pintarPlanilla` de app.js, sacada del propio archivo y puesta a andar. */
const pintarPlanilla = (() => {
  const desde = app.indexOf('function pintarPlanilla(d) {');
  assert.ok(desde > 0, 'app.js tiene que traer pintarPlanilla');
  let abiertas = 0;
  let hasta = desde;
  for (; hasta < app.length; hasta++) {
    if (app[hasta] === '{') abiertas++;
    else if (app[hasta] === '}' && --abiertas === 0) { hasta++; break; }
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'membreteDelDocumento', 'pieDelDocumento',
    `${app.slice(desde, hasta)}; return pintarPlanilla;`)(esc, () => '', () => '');
})();

test('la hoja lo dice al pie, con cuántas son', () => {
  const html = pintarPlanilla(planilla.armar(db, laFila(), '2026-02'));
  assert.match(html, /<b>2 marca\(s\)<\/b> de actividades de este cuerpo quedaron sin cuerpo/);
});

test('y no lo dice cuando no hay ninguna', () => {
  const html = pintarPlanilla(planilla.armar(db, laFila(), '2026-03'));
  assert.ok(!html.includes('quedaron sin cuerpo'), 'no se avisa de lo que no pasa');
});
