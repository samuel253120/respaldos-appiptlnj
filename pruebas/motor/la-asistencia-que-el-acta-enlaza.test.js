/**
 * Un acta enlaza la lista de la reunión a la que ese cuerpo fue.
 *
 * El desplegable ofrece correctamente solo las actividades a las que el cuerpo
 * fue convocado, y la pantalla avisa al elegirla —«X no estaba convocado a esa
 * actividad. Revise si es la reunión que corresponde»—. Pero la regla vivía
 * solo ahí. Medido en la v1.275.0:
 *
 *   la actividad n.º 1 convoca a los cuerpos 10 y 3 ....... —
 *   el desplegable le ofrece al cuerpo 14 ................. 0 actividades
 *   guardar un acta del cuerpo 14 con esa asistencia ...... 201
 *
 * El daño es acotado y conviene decirlo entero: como no hay marcas de
 * asistencia de ese cuerpo en esa actividad, el acta impresa no muestra ninguna
 * lista. Queda un enlace que no dice nada y que afirma, en silencio, que el
 * acta se levantó de una reunión a la que el cuerpo no fue.
 *
 * Se pregunta y no se rechaza porque hay un caso legítimo: el cuerpo asistió
 * igual y la lista de convocados quedó incompleta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia con dos cuerpos y una actividad que convoca solo a uno. */
function unaActividad() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `ASI${m}`).lastInsertRowid;
  const cuerpo = (cual) => db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`${cual} ${m}`, iglesia).lastInsertRowid;
  const convocado = cuerpo('Damas');
  const ajeno = cuerpo('Ciclistas');
  const actividad = db.prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, cuerpos, iglesia_id) VALUES (?, ?, ?, ?)`
  ).run('2026-03-15', 'Servicio General', JSON.stringify([convocado]), iglesia).lastInsertRowid;
  return { m, iglesia, convocado, ajeno, actividad };
}

const unActa = (api, e, cuerpoId, cambios) => api('POST', '/actas_reuniones', {
  numero_acta: `${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-03-15', cuerpo_id: cuerpoId, agenda: 'Punto único', ...cambios,
});

// -------------------------------------------------------------------------

test('enlazar la reunión de otro cuerpo se pregunta', async () => {
  const api = await elSistemaAndando();
  const e = unaActividad();
  const r = await unActa(api, e, e.ajeno, { asistencia_id: e.actividad });

  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'asistencia_de_otra_reunion');
  assert.match(r.json.error, /no convocó a/i);
  assert.match(r.json.error, /Ciclistas/, 'dice a qué cuerpo no convocó');
});

test('el aviso dice cuál es la actividad y qué se pierde', async () => {
  /*
   * Sin decir cuál, hay que salir del formulario a mirarla; y sin decir que el
   * acta no va a mostrar ninguna lista, la pregunta parece un formalismo.
   */
  const api = await elSistemaAndando();
  const e = unaActividad();
  const r = await unActa(api, e, e.ajeno, { asistencia_id: e.actividad });
  assert.match(r.json.error, /Servicio General/);
  assert.match(r.json.error, /15-03-2026/);
  assert.match(r.json.error, /no va a mostrar ninguna lista/i);
});

test('y ofrece el caso en que sí es correcto', async () => {
  const api = await elSistemaAndando();
  const e = unaActividad();
  const r = await unActa(api, e, e.ajeno, { asistencia_id: e.actividad });
  assert.match(r.json.error, /asistió igual, confirme/i,
    'que la lista de convocados quede incompleta es un caso real');
});

test('confirmando, entra', async () => {
  const api = await elSistemaAndando();
  const e = unaActividad();
  const r = await unActa(api, e, e.ajeno, { asistencia_id: e.actividad, igual_asi: true });
  assert.equal(r.estado, 201, 'pregunta, no impide');
});

test('el cuerpo que sí fue convocado no molesta a nadie', async () => {
  const api = await elSistemaAndando();
  const e = unaActividad();
  const r = await unActa(api, e, e.convocado, { asistencia_id: e.actividad });
  assert.equal(r.estado, 201);
});

test('una actividad que convoca a varios sirve para todos ellos', async () => {
  /*
   * Es a propósito y está escrito en el módulo: el coro puede haber cantado en
   * un aniversario junto a cinco cuerpos más, y esa actividad sirve igual para
   * el acta del coro.
   */
  const api = await elSistemaAndando();
  const e = unaActividad();
  db.prepare('UPDATE asistencias SET cuerpos = ? WHERE id = ?')
    .run(JSON.stringify([e.convocado, e.ajeno]), e.actividad);
  assert.equal((await unActa(api, e, e.ajeno, { asistencia_id: e.actividad })).estado, 201);
});

test('un acta sin asistencia enlazada no se pregunta nada', async () => {
  const api = await elSistemaAndando();
  const e = unaActividad();
  assert.equal((await unActa(api, e, e.ajeno)).estado, 201);
});

test('la lectura de los cuerpos convocados sale del módulo que los guarda', () => {
  /*
   * El campo es una lista de ids guardada como texto, y quien decide cómo se
   * lee es el módulo de Asistencia. Copiando esa lectura al libro de actas, el
   * día que cambie el formato quedarían dos maneras de leerlo y una estaría mal.
   */
  const asistencias = require('../../server/modules/asistencias');
  assert.equal(typeof asistencias.idsDeCuerpos, 'function');
  assert.deepEqual(asistencias.idsDeCuerpos('[4,2]'), [4, 2]);
  assert.deepEqual(asistencias.idsDeCuerpos(null), []);
});

test('la pantalla sabe ponerle título a esta pregunta', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /asistencia_de_otra_reunion:\s*\{/);
});
