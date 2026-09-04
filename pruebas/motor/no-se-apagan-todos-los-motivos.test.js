/**
 * NO SE PUEDEN APAGAR TODOS LOS MOTIVOS DE AUSENCIA.
 *
 * Desmarcar «En uso» es la salida que el propio módulo recomienda en vez de
 * borrar, y no había ningún piso. Acá el caso pesa MÁS que en Tipos de
 * Actividad y en Categorías de Tesorería, y por una razón precisa: el motivo es
 * OBLIGATORIO cuando alguien queda justificado, y no hay valor de fábrica al
 * que caer. Con la lista en cero no se guarda mal: NO SE GUARDA.
 *
 * MEDIDO en la v1.362.0, sobre una instalación nueva con sus seis motivos:
 *
 *   desactivados uno por uno ............ 6 · ninguno dijo nada
 *   lo que ofrece el desplegable ........ 0
 *   justificar a alguien ................ 400 «Indique el motivo de cada justificación»
 *   marcarlo «Ausente» a secas .......... 200
 *
 * La única salida que quedaba es la última, y pierde justamente lo que se
 * quería anotar: que la persona SÍ avisó.
 *
 * Se prueba sobre una lista PROPIA, no sobre la de la base: los archivos del
 * motor corren en paralelo y apagar de verdad los motivos de todos dejaría a
 * los demás sin poder justificar nada. Se apaga todo lo que hay, se hacen las
 * comprobaciones y se deja como estaba.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const motivos = require('../../server/modules/motivos_ausencia');

const MARCA = `k${process.pid}`;

const unMotivo = (nombre) => {
  const id = db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, 0, 1)')
    .run(`${nombre} ${MARCA}`).lastInsertRowid;
  return db.prepare('SELECT * FROM motivos_ausencia WHERE id = ?').get(id);
};

/** Deja encendidos solo los que se le digan, corre lo suyo y devuelve todo. */
function conSoloEstosEncendidos(cuales, hacer) {
  const encendidos = db.prepare('SELECT id FROM motivos_ausencia WHERE activo = 1').all().map((f) => f.id);
  const apagar = db.prepare('UPDATE motivos_ausencia SET activo = 0 WHERE id = ?');
  const prender = db.prepare('UPDATE motivos_ausencia SET activo = 1 WHERE id = ?');
  db.transaction(() => { for (const id of encendidos) apagar.run(id); }).immediate();
  try {
    for (const id of cuales) prender.run(id);
    return hacer();
  } finally {
    db.transaction(() => {
      for (const id of cuales) apagar.run(id);
      for (const id of encendidos) prender.run(id);
    }).immediate();
  }
}

/* ─────────────────────────────── el piso ──────────────────────────────── */

test('desmarcar «En uso» en el último motivo se frena', () => {
  const unico = unMotivo('Enfermedad única');
  const freno = conSoloEstosEncendidos([unico.id], () =>
    motivos.hooks.beforeSave({ activo: 0 }, { db, isNew: false, existing: { ...unico, activo: 1 } }));

  assert.equal(typeof freno, 'string', 'medido en la v1.362.0: los seis se apagaron sin que nadie dijera nada');
  assert.match(freno, /no quedaría ningún motivo en uso/);
  assert.match(freno, /no se podría justificar ninguna ausencia/,
    'y dice lo que de verdad se pierde, que acá es más que en los módulos hermanos');
  assert.match(freno, /Deje al menos uno en uso, o cree antes el que va a usar/);
});

test('y borrar el último, también', () => {
  const unico = unMotivo('Trabajo único');
  const freno = conSoloEstosEncendidos([unico.id], () =>
    motivos.hooks.beforeDelete({ ...unico, activo: 1 }, { db }));

  assert.equal(typeof freno, 'string', 'es la otra puerta al mismo estado');
  assert.match(freno, /no quedaría ningún motivo en uso/);
});

/* ─────────────────── lo que NO se frena, que es lo que hay que poder ──── */

test('apagar uno de dos no se frena', () => {
  const uno = unMotivo('Viaje de los dos');
  const otro = unMotivo('Duelo de los dos');
  const paso = conSoloEstosEncendidos([uno.id, otro.id], () =>
    motivos.hooks.beforeSave({ activo: 0 }, { db, isNew: false, existing: { ...uno, activo: 1 } }));

  assert.equal(paso, null, 'una iglesia tiene todo el derecho a dejar de usar un motivo');
});

test('crear uno nuevo tampoco: es la salida que el reparo propone', () => {
  const unico = unMotivo('Emergencia única');
  const paso = conSoloEstosEncendidos([unico.id], () =>
    motivos.hooks.beforeSave({ nombre: `Otro nuevo ${MARCA}`, activo: 1 }, { db, isNew: true, existing: null }));

  assert.equal(paso, null);
});

test('y marcarle «Pide explicación» al último tampoco', () => {
  const unico = unMotivo('Otro motivo único');
  const paso = conSoloEstosEncendidos([unico.id], () =>
    motivos.hooks.beforeSave({ pide_detalle: 1 }, { db, isNew: false, existing: { ...unico, activo: 1 } }));

  assert.equal(paso, null, 'no se está apagando nada');
});

test('borrar uno de dos tampoco', () => {
  const uno = unMotivo('Estudio de los dos');
  const otro = unMotivo('Salida de los dos');
  const paso = conSoloEstosEncendidos([uno.id, otro.id], () =>
    motivos.hooks.beforeDelete({ ...uno, activo: 1 }, { db }));

  assert.equal(paso, null);
});

/* ───────────────── y la lista vuelve a quedar como estaba ─────────────── */

test('la comprobación no deja la lista de la base tocada', () => {
  const unico = unMotivo('Prueba del vaivén');
  const antes = db.prepare('SELECT COUNT(*) AS c FROM motivos_ausencia WHERE activo = 1').get().c;
  conSoloEstosEncendidos([unico.id], () => null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM motivos_ausencia WHERE activo = 1').get().c, antes,
    'los archivos del motor comparten una base: dejarla apagada sería dejar a los demás sin nada'
  );
});
