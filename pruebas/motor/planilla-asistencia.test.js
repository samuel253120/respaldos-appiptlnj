/**
 * La planilla mensual de asistencia de un cuerpo.
 *
 * Reemplaza la hoja de cálculo que la iglesia llevaba a mano, así que tiene
 * que dar los mismos números que daba esa hoja. Hay tres cosas que es fácil
 * equivocar sin que se note —y que en una planilla que se firma importan—:
 *
 *   · cuántos días tiene el mes: febrero de un año bisiesto y de uno común
 *   · qué pasa cuando el cuerpo tuvo DOS actividades el mismo día
 *   · qué pasa cuando a alguien no se le marcó nada en un día que sí hubo lista
 *
 * Y una cuarta que no es de cálculo sino de criterio: quién sale en la hoja.
 * Los retirados no, los que están en prueba sí.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const planilla = require('../../server/planilla-asistencia');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central','IG-P','Activa')").run().lastInsertRowid;
const cuerpo = db.prepare(
  "INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Ciclistas','Cuerpo',?,'Activo')"
).run(iglesia).lastInsertRowid;
const laFila = () => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpo);

let cuantosRut = 30000000;
/** Alguien del cuerpo, con el estado de integrante que se pida. */
function integrante(nombres, apellidos, estado = 'Activo') {
  const id = db.prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, genero, estado)
     VALUES (?, ?, ?, ?, 'Masculino', 'Activo')`
  ).run(iglesia, `${cuantosRut++}-0`, nombres, apellidos).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, ?, '2024-01-10', ?)`
  ).run(cuerpo, id, estado, iglesia);
  return id;
}

/** Una actividad del cuerpo ese día, con las marcas que se le pasen. */
function seReunieron(fecha, marcas) {
  const act = db.prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos)
     VALUES (?, 'Ensayo', 'Reunión', ?, ?)`
  ).run(fecha, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  for (const [miembro, estado] of marcas) {
    db.prepare(
      `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(act, miembro, estado, cuerpo, fecha, iglesia);
  }
  return act;
}

const ana = integrante('Ana', 'Alvarez');
const beto = integrante('Beto', 'Bravo');
const carla = integrante('Carla', 'Castro', 'En prueba');
const dora = integrante('Dora', 'Diaz', 'Retirado');

// --------------------------------------------------- cuántos días trae el mes

test('un mes de 30 días trae 30 columnas', () => {
  assert.equal(planilla.armar(db, laFila(), '2026-04').dias.length, 30);
});

test('uno de 31, treinta y una', () => {
  assert.equal(planilla.armar(db, laFila(), '2026-05').dias.length, 31);
});

test('febrero de un año común trae 28', () => {
  assert.equal(planilla.armar(db, laFila(), '2027-02').dias.length, 28);
});

test('y el de un año bisiesto, 29', () => {
  assert.equal(planilla.armar(db, laFila(), '2024-02').dias.length, 29);
  assert.equal(planilla.armar(db, laFila(), '2000-02').dias.length, 29, '2000 es bisiesto: divisible por 400');
  assert.equal(planilla.armar(db, laFila(), '1900-02').dias.length, 28, '1900 no lo es: divisible por 100 y no por 400');
});

test('el mes se exige bien escrito', () => {
  assert.equal(planilla.mesValido('2026-04'), true);
  assert.equal(planilla.mesValido('2026-13'), false);
  assert.equal(planilla.mesValido('2026-00'), false);
  assert.equal(planilla.mesValido('abril'), false);
  assert.equal(planilla.mesValido(''), false);
  assert.equal(planilla.mesValido(null), false);
});

// ------------------------------------------------------------ quién sale ----

test('salen los integrantes vigentes y no los retirados', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  const nombres = p.integrantes.map((x) => x.nombre);
  assert.deepEqual(nombres, ['Ana Alvarez', 'Beto Bravo', 'Carla Castro']);
  assert.ok(!nombres.includes('Dora Diaz'), 'Dora está retirada');
});

test('van numerados y ordenados por apellido', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.deepEqual(p.integrantes.map((x) => x.n), [1, 2, 3]);
});

test('el trato viene abreviado, que es lo que cabe en la columna', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.equal(p.integrantes[0].trato, 'Hno.');
});

// -------------------------------------------- los días que tuvieron reunión

test('solo son días con reunión aquellos en que se pasó lista', () => {
  seReunieron('2026-06-02', [[ana, 'Presente'], [beto, 'Ausente'], [carla, 'Justificado']]);
  seReunieron('2026-06-09', [[ana, 'Presente'], [beto, 'Presente'], [carla, 'Ausente']]);
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.deepEqual(p.diasConReunion, [2, 9]);
  assert.equal(p.dias.length, 30, 'las 30 columnas siguen estando');
});

test('un día sin reunión no lleva totales al pie', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.ok(p.porDia[2], 'el 2 sí');
  assert.equal(p.porDia[3], undefined, 'el 3 no');
});

// -------------------------------------------------------- las letras y la cuenta

test('cada estado tiene su letra', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  const a = p.integrantes.find((x) => x.nombre === 'Ana Alvarez');
  const b = p.integrantes.find((x) => x.nombre === 'Beto Bravo');
  const c = p.integrantes.find((x) => x.nombre === 'Carla Castro');
  assert.equal(a.marcas[2], 'S', 'presente');
  assert.equal(b.marcas[2], 'N', 'ausente');
  assert.equal(c.marcas[2], 'J', 'justificado');
});

test('S + J + N da exactamente el total de reuniones', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  for (const x of p.integrantes) {
    assert.equal(x.total, 2, `${x.nombre}: T. tiene que ser los días con reunión`);
    assert.equal(x.presentes + x.justificados + x.ausentes, x.total, x.nombre);
  }
});

test('los justificados van aparte: ni asistencia ni inasistencia', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  const c = p.integrantes.find((x) => x.nombre === 'Carla Castro');
  assert.equal(c.justificados, 1);
  assert.equal(c.presentes, 0, 'justificar no es asistir');
  assert.equal(c.ausentes, 1, 'y su falta del día 9 es la única inasistencia');
  assert.equal(c.pct_justificado, 50);
  assert.equal(c.pct_presente, 0);
  assert.equal(c.pct_ausente, 50);
});

test('los porcentajes se reparten el 100 %', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  for (const x of p.integrantes) {
    assert.ok(Math.abs(x.pct_presente + x.pct_justificado + x.pct_ausente - 100) <= 2, x.nombre);
  }
});

// ------------------------------- lo que se equivoca sin que nadie lo note ----

test('a quien no se le marcó nada en un día con lista, se le cuenta la falta', () => {
  const eva = integrante('Eva', 'Espinoza');
  // Eva entra al cuerpo hoy: no tiene marca en ninguna de las dos reuniones
  const p = planilla.armar(db, laFila(), '2026-06');
  const e = p.integrantes.find((x) => x.nombre === 'Eva Espinoza');
  assert.equal(e.marcas[2], 'N');
  assert.equal(e.marcas[9], 'N');
  assert.equal(e.ausentes, 2, 'la lista se pasó y no estaba');
  assert.equal(e.total, 2);
  db.prepare('DELETE FROM integrantes_cuerpo WHERE miembro_id = ?').run(eva);
});

test('dos actividades el mismo día son UNA columna, con lo mejor de las dos', () => {
  // El día 16 hay ensayo en la mañana y salida en la tarde
  seReunieron('2026-06-16', [[ana, 'Ausente'], [beto, 'Justificado'], [carla, 'Ausente']]);
  seReunieron('2026-06-16', [[ana, 'Presente'], [beto, 'Ausente'], [carla, 'Justificado']]);
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.deepEqual(p.diasConReunion, [2, 9, 16], 'el 16 aparece una sola vez');
  const a = p.integrantes.find((x) => x.nombre === 'Ana Alvarez');
  const b = p.integrantes.find((x) => x.nombre === 'Beto Bravo');
  const c = p.integrantes.find((x) => x.nombre === 'Carla Castro');
  assert.equal(a.marcas[16], 'S', 'estuvo en una de las dos: estuvo');
  assert.equal(b.marcas[16], 'J', 'justificó en una y faltó en la otra: justificó');
  assert.equal(c.marcas[16], 'J', 'justificar gana sobre faltar');
  assert.equal(a.total, 3, 'y el día 16 se cuenta UNA vez en el total');
});

// ------------------------------------------------------------- el pie -------

test('los totales del día cuadran con su columna', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  for (const dia of p.diasConReunion) {
    const x = p.porDia[dia];
    const cuenta = (l) => p.integrantes.filter((y) => y.marcas[dia] === l).length;
    assert.equal(x.presentes, cuenta('S'), `día ${dia}`);
    assert.equal(x.justificados, cuenta('J'), `día ${dia}`);
    assert.equal(x.ausentes, cuenta('N'), `día ${dia}`);
    assert.equal(x.integrantes, p.integrantes.length, `día ${dia}`);
    assert.equal(x.presentes + x.justificados + x.ausentes, x.integrantes, `día ${dia}`);
  }
});

// ---------------------------------------------- un cuerpo que no tiene nada --

test('un cuerpo sin gente entrega una planilla vacía, no un error', () => {
  const solo = db.prepare(
    "INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Recién creado','Cuerpo',?,'Activo')"
  ).run(iglesia).lastInsertRowid;
  const p = planilla.armar(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(solo), '2026-06');
  assert.deepEqual(p.integrantes, []);
  assert.deepEqual(p.diasConReunion, []);
  assert.equal(p.dias.length, 30, 'las columnas del mes están igual');
});

test('un mes en que no se reunieron deja a todos en cero, sin dividir por cero', () => {
  const p = planilla.armar(db, laFila(), '2026-07');
  assert.deepEqual(p.diasConReunion, []);
  for (const x of p.integrantes) {
    assert.equal(x.total, 0);
    assert.equal(x.pct_presente, 0);
    assert.equal(x.pct_justificado, 0);
    assert.equal(x.pct_ausente, 0);
  }
});

test('las marcas de OTRO cuerpo no entran en esta planilla', () => {
  const otro = db.prepare(
    "INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro','Cuerpo',?,'Activo')"
  ).run(iglesia).lastInsertRowid;
  const act = db.prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos)
     VALUES ('2026-08-04', 'Ensayo', 'Ensayo del coro', ?, ?)`
  ).run(iglesia, JSON.stringify([otro])).lastInsertRowid;
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
     VALUES (?, ?, 'Presente', ?, '2026-08-04', ?)`
  ).run(act, ana, otro, iglesia);

  const p = planilla.armar(db, laFila(), '2026-08');
  assert.deepEqual(p.diasConReunion, [], 'esa reunión fue del Coro, no de este cuerpo');
});
