/**
 * LA PRUEBA NO SE EXTIENDE HASTA EL AÑO 85.359, NI SE EVALÚA ANTES DE EMPEZAR.
 *
 * Cuando el informe no se aprueba, la prueba se extiende y el plazo nuevo se
 * calcula sumando los meses que se escriban. Ese número no tenía techo ni piso,
 * y la fecha de la evaluación no se comparaba con nada. Medido en la v1.399.0:
 *
 *   meses = 1.200 ....  201 · plazo 20-05-2126
 *   meses = 999.999 ..  201 · plazo «+085359-08»   ← ni siquiera es una fecha
 *   meses = −6 .......  201 · lo guarda y no lo aplica
 *   meses = 0,5 ......  201 · plazo el mismo día de la evaluación
 *   evaluar el 10-01-2006 a quien entró el 01-03-2026
 *                       201 · plazo 10-04-2006, vencido hace veinte años
 *
 * «+085359-08» es lo que devuelve el calendario cuando el año pasa de 9999, y
 * se guardaba tal cual en la columna del plazo del integrante: cualquier
 * comparación que lo mire después no tiene con qué.
 *
 * El rango es el mismo que el del cuerpo —«Meses de período de prueba», de 1 a
 * 60 y entero— porque es la misma cosa medida dos veces. Y lo de la fecha va
 * en el gancho y no con `noAntesDe`, porque la fecha contra la que hay que
 * mirar vive en otro módulo: la ficha del integrante.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const evaluaciones = require('../../server/modules/evaluaciones_integrantes');
const cuerpos = require('../../server/modules/cuerpos');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central MX ${marca}`, `MX-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas MX ${marca}`, iglesia).lastInsertRowid;

function enPrueba(ingreso = '2026-03-01') {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve MX ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', ?, '2026-06-01', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve MX ${marca}`, ingreso, iglesia).lastInsertRowid;
}

const campo = () => evaluaciones.fields.find((f) => f.name === 'meses_extension');

// ------------------------------------------------- los meses ----

test('el rango de la extensión es el mismo que el del cuerpo', () => {
  // Es la misma cosa medida dos veces: cuánto dura una prueba. Que difieran
  // sería poder extenderla más de lo que el propio cuerpo admite al definirla.
  const delCuerpo = cuerpos.fields.find((f) => f.name === 'meses_prueba');
  assert.equal(campo().max, delCuerpo.max, 'el mismo techo');
  assert.equal(campo().max, 60);
  assert.equal(campo().entero, true, 'medio mes no quiere decir nada');
  assert.equal(campo().min, 1, 'extender cero meses no es extender');
});

test('por la puerta: lo que se pasa del rango se rechaza diciendo el límite', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const conMeses = (meses) => api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', evaluado_por: 'X',
    resultado: 'No aprobado (se extiende la prueba)', meses_extension: meses,
  });

  const bien = await conMeses(3);
  assert.equal(bien.estado, 201, bien.texto);
  assert.equal(db.prepare('SELECT fecha_fin_prueba f FROM integrantes_cuerpo WHERE id = ?').get(ficha).f,
    '2026-08-20');

  for (const [meses, dice] of [[0, /mayor que cero/], [-6, /mayor que cero/],
    [61, /no puede pasar de 60/], [1200, /no puede pasar de 60/], [999999, /no puede pasar de 60/]]) {
    const r = await conMeses(meses);
    assert.equal(r.estado, 400, `${meses} tenía que rechazarse`);
    assert.match(r.json.error, dice);
    assert.match(r.json.error, /Meses que se extiende la prueba/, 'y el aviso dice de qué campo habla');
  }
});

test('y medio mes tampoco, ni con el rango en regla', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const r = await api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', evaluado_por: 'X',
    resultado: 'No aprobado (se extiende la prueba)', meses_extension: 3.5,
  });
  assert.equal(r.estado, 400, '3,5 está dentro del rango y sigue sin querer decir nada');
  assert.match(r.json.error, /Meses que se extiende la prueba/);
});

test('en blanco se sigue pudiendo: son los meses que define el cuerpo', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const r = await api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', evaluado_por: 'X',
    resultado: 'No aprobado (se extiende la prueba)',
  });
  assert.equal(r.estado, 201, r.texto);
  assert.ok(db.prepare('SELECT fecha_fin_prueba f FROM integrantes_cuerpo WHERE id = ?').get(ficha).f,
    'y le queda un plazo, el del cuerpo');
});

test('la ficha nunca queda con un plazo que no es una fecha', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  await api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', evaluado_por: 'X',
    resultado: 'No aprobado (se extiende la prueba)', meses_extension: 999999,
  });
  const { f } = db.prepare('SELECT fecha_fin_prueba f FROM integrantes_cuerpo WHERE id = ?').get(ficha);
  assert.match(String(f), /^\d{4}-\d{2}-\d{2}$/, `el plazo quedó en «${f}»`);
});

// ------------------------------------------------- la fecha ----

test('nadie se evalúa antes de entrar al cuerpo', () => {
  const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(enPrueba('2026-03-01'));
  const aviso = evaluaciones.hooks.beforeSave(
    { integrante_id: ficha.id, fecha: '2006-01-10', resultado: 'Aprobado', evaluado_por: 'X' },
    { existing: null, db },
  );
  assert.match(String(aviso), /10-01-2006/, 'dice la fecha que se escribió');
  assert.match(String(aviso), /01-03-2026/, 'y la del ingreso, que es contra la que se compara');
  assert.match(String(aviso), /antes de que empiece/);
  assert.match(String(aviso), /revise el año/i, 'que es lo que casi siempre pasa');
});

test('el día que entró sí, y cualquiera después', () => {
  const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(enPrueba('2026-03-01'));
  const evaluar = (fecha) => evaluaciones.hooks.beforeSave(
    { integrante_id: ficha.id, fecha, resultado: 'Aprobado', evaluado_por: 'X' },
    { existing: null, db },
  );
  assert.equal(evaluar('2026-03-01'), null, 'el mismo día no es antes');
  assert.equal(evaluar('2026-05-20'), null);
  assert.ok(evaluar('2026-02-28'), 'el día anterior sí se frena');
});
