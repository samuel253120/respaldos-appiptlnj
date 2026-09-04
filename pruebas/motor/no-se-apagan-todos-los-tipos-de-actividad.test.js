/**
 * NO SE PUEDEN APAGAR TODOS LOS TIPOS DE ACTIVIDAD.
 *
 * Desmarcar «En uso» es la salida que el propio módulo recomienda en vez de
 * borrar, y está bien. Pero no había ningún piso: se podían apagar todos.
 *
 * MEDIDO en la v1.349.0, contra el sistema andando: se desactivaron los quince
 * tipos, uno por uno, y ninguno dijo nada; la ruta que los ofrece pasó a
 * devolver cero; y una actividad nueva se guardó igual —201— con el valor de
 * fábrica escrito en el código. Con la lista en cero quien pasa lista se
 * encuentra un desplegable vacío, y la actividad se guarda de todos modos con
 * un nombre que no está en ninguna lista viva.
 *
 * Se prueba sobre una lista PROPIA, no sobre la de la base: los archivos del
 * motor corren en paralelo y apagar de verdad los tipos de todos dejaría a los
 * demás sin poder crear ninguna actividad. Se apaga todo lo que hay, se hacen
 * las comprobaciones y se deja como estaba.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const tipos = require('../../server/modules/tipos_actividad');

const MARCA = `a${process.pid}`;

const unTipo = (nombre) => {
  const id = db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 1)').run(nombre).lastInsertRowid;
  return db.prepare('SELECT * FROM tipos_actividad WHERE id = ?').get(id);
};

/** Deja encendidos solo los que se le digan, corre lo suyo y devuelve todo. */
function conSoloEstosEncendidos(cuales, hacer) {
  const encendidos = db.prepare('SELECT id FROM tipos_actividad WHERE activo = 1').all().map((f) => f.id);
  const apagar = db.prepare('UPDATE tipos_actividad SET activo = 0 WHERE id = ?');
  const prender = db.prepare('UPDATE tipos_actividad SET activo = 1 WHERE id = ?');
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

test('desmarcar «En uso» en el último tipo se frena', () => {
  const unico = unTipo(`Servicio único ${MARCA}`);
  const freno = conSoloEstosEncendidos([unico.id], () =>
    tipos.hooks.beforeSave({ activo: 0 }, { db, isNew: false, existing: { ...unico, activo: 1 } }));

  assert.equal(typeof freno, 'string', 'medido en la v1.349.0: los quince se apagaron sin que nadie dijera nada');
  assert.match(freno, /no quedaría ningún tipo de actividad en uso/);
  assert.match(freno, /Deje al menos uno en uso, o cree antes el que va a usar/,
    'el reparo tiene que decir cómo seguir');
});

test('y borrar el último, también', () => {
  const unico = unTipo(`Ensayo único ${MARCA}`);
  const freno = conSoloEstosEncendidos([unico.id], () =>
    tipos.hooks.beforeDelete({ ...unico, activo: 1 }, { db }));

  assert.equal(typeof freno, 'string', 'es la otra puerta al mismo estado');
  assert.match(freno, /no quedaría ningún tipo de actividad en uso/);
});

/* ─────────────────────── lo que NO se frena, que es lo que hay que poder */

test('apagar uno de dos no se frena: es exactamente lo que hay que poder hacer', () => {
  const uno = unTipo(`Vigilia de las dos ${MARCA}`);
  const otro = unTipo(`Ensayo de las dos ${MARCA}`);
  const paso = conSoloEstosEncendidos([uno.id, otro.id], () =>
    tipos.hooks.beforeSave({ activo: 0 }, { db, isNew: false, existing: { ...uno, activo: 1 } }));

  assert.equal(paso, null, 'una iglesia tiene todo el derecho a dejar de usar un tipo');
});

test('crear uno nuevo tampoco se frena: es la salida que el reparo propone', () => {
  const unico = unTipo(`Reunión única ${MARCA}`);
  const paso = conSoloEstosEncendidos([unico.id], () =>
    tipos.hooks.beforeSave({ nombre: `Escuela nueva ${MARCA}`, activo: 1 }, { db, isNew: true, existing: null }));

  assert.equal(paso, null);
});

test('y cambiarle la nota al último tampoco: lo que importa es que siga en uso', () => {
  const unico = unTipo(`Oración única ${MARCA}`);
  const paso = conSoloEstosEncendidos([unico.id], () =>
    tipos.hooks.beforeSave({ notas: 'Los martes' }, { db, isNew: false, existing: { ...unico, activo: 1 } }));

  assert.equal(paso, null, 'no se está apagando nada');
});

test('borrar uno de dos tampoco', () => {
  const uno = unTipo(`Salida de las dos ${MARCA}`);
  const otro = unTipo(`Gira de las dos ${MARCA}`);
  const paso = conSoloEstosEncendidos([uno.id, otro.id], () =>
    tipos.hooks.beforeDelete({ ...uno, activo: 1 }, { db }));

  assert.equal(paso, null);
});

/* ───────────────── y la lista vuelve a quedar como estaba ─────────────── */

test('la comprobación no deja la lista de la base tocada', () => {
  const unico = unTipo(`Prueba del vaivén ${MARCA}`);
  const antes = db.prepare('SELECT COUNT(*) AS c FROM tipos_actividad WHERE activo = 1').get().c;
  conSoloEstosEncendidos([unico.id], () => null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM tipos_actividad WHERE activo = 1').get().c, antes,
    'los archivos del motor comparten una base: dejarla apagada sería dejar a los demás sin nada'
  );
});
