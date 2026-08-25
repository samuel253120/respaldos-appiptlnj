/**
 * El acta y su asistencia: qué se ofrece y qué se conserva.
 *
 * POR QUÉ EXISTE. El acta traía un campo «Asistentes» donde se elegía miembro
 * por miembro, y ofrecía a TODA la gente de la iglesia y no a la del cuerpo del
 * acta: levantando un acta de Ciclistas aparecía la congregación completa. Se
 * vio en el sistema andando.
 *
 * En vez de acotar esa lista se retiró el campo, porque sobra: la asistencia
 * enlazada dice lo mismo y más —quién faltó y quién se excusó, con su motivo— y
 * sale de una lista que alguien ya pasó. Dos maneras de anotar lo mismo
 * terminan discrepando, y entonces no se sabe cuál vale.
 *
 * Lo que estas pruebas cuidan es la parte delicada de ese retiro: QUE NO SE
 * BORRE NADA. El campo se sacó de lo que se ofrece, no de lo que se guardó, y
 * un acta antigua con su lista escrita a mano tiene que conservarla y seguir
 * imprimiéndola. Sin esto, un «ya no lo usamos» se convierte con el tiempo en
 * un «se perdió».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { getModule } = require('../../server/registry');
const { db } = require('../../server/db');

const acta = getModule('actas_reuniones');
const campo = (n) => acta.fields.find((f) => f.name === n);

// ─────────────────────────────── lo que ya no se ofrece, pero sigue estando ───

test('el campo de asistentes escritos a mano ya no se ofrece', () => {
  const f = campo('asistentes');
  assert.ok(f, 'el campo tiene que SEGUIR declarado: es lo que conserva la columna');
  assert.equal(f.oculto, true, 'pero oculto, para que no salga en el formulario');
});

test('y su columna sigue en la base, con lo que hubiera guardado', () => {
  // Que el campo esté oculto no puede llevarse la columna por delante: ahí
  // están los asistentes de las actas que se levantaron antes.
  const columnas = db.prepare('PRAGMA table_info(actas_reuniones)').all().map((c) => c.name);
  assert.ok(columnas.includes('asistentes'), 'la columna tiene que seguir');
});

test('lo guardado antes se sigue leyendo, aunque el campo esté oculto', () => {
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Para el acta','IG-ACTA','Activa')")
    .run().lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro','Coro',?,'Activo')")
    .run(iglesia).lastInsertRowid;
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Ana','Del Coro',?,'Activo')")
    .run(iglesia).lastInsertRowid;
  const id = db
    .prepare(
      `INSERT INTO actas_reuniones (numero_acta, fecha, iglesia_id, cuerpo_id, asistentes, estado)
       VALUES ('001-2020','2020-03-01',?,?,?,'Firmada')`
    )
    .run(iglesia, cuerpo, JSON.stringify([miembro])).lastInsertRowid;

  const { expandRow } = require('../../server/crud');
  const fila = db.prepare('SELECT * FROM actas_reuniones WHERE id = ?').get(id);
  const leida = expandRow ? expandRow(acta, fila, null) : fila;
  assert.deepEqual(
    typeof leida.asistentes === 'string' ? JSON.parse(leida.asistentes) : leida.asistentes,
    [miembro],
    'el acta antigua conserva a su gente'
  );
});

// ──────────────────────────────────────────── lo que sí se ofrece ahora ───

test('el acta enlaza su asistencia, y solo la de su propio cuerpo', () => {
  const f = campo('asistencia_id');
  assert.ok(f, 'el campo del enlace tiene que existir');
  assert.equal(f.type, 'ref');
  assert.equal(f.ref, 'asistencias');
  // La lista se pide acotada al cuerpo del acta, no completa: de eso depende
  // que al levantar un acta de Ciclistas no salgan las actividades de todos.
  assert.match(f.optionsRoute, /\/asistencias\/de-cuerpo/);
  assert.match(f.optionsRoute, /\{cuerpo_id\}/, 'y acotada por el cuerpo del formulario');
});

test('el enlace no es obligatorio: hay reuniones de las que no se pasó lista', () => {
  assert.notEqual(campo('asistencia_id').required, true);
});
