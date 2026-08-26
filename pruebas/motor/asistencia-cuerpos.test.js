/**
 * La asistencia se lleva POR CUERPO, no por persona.
 *
 * POR QUÉ IMPORTA. A una actividad la pueden convocar varios cuerpos, y una
 * misma persona puede estar en más de uno. Cada cuerpo pasa su propia lista y
 * las dos respuestas pueden no coincidir, sin que ninguna esté equivocada:
 * alguien de Damas y de la Directiva le avisa a la Directiva que no va a poder
 * ir —y la Directiva lo anota justificado— pero a Damas no le avisa nada, y
 * Damas lo anota ausente. Las dos cosas son ciertas el mismo día.
 *
 * Antes había UNA marca por persona y actividad. El sistema elegía un cuerpo
 * —el primero de los convocados— y los demás se quedaban sin nada: al filtrar
 * por «Directiva» esa persona no aparecía, y si aparecía y se la marcaba, la
 * marca le pisaba la del otro cuerpo. El informe ya prometía abrir el
 * porcentaje por cuerpo («en uno puede andar al día y en otro no») pero los
 * datos no daban para eso.
 *
 * Lo que se cuida acá es que cada par persona-cuerpo sea una asistencia
 * independiente: que aparezca en las dos listas, que se pueda marcar distinto
 * en cada una, y que marcar en una no toque la otra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { idsDeIntegrantes } = require('../../server/integrantes');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Con varios cuerpos', 'IG-VC', 'Activa')")
  .run().lastInsertRowid;

const unCuerpo = (nombre) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(nombre, iglesia).lastInsertRowid;

const damas = unCuerpo('Damas');
const caballeros = unCuerpo('Caballeros');
const directiva = unCuerpo('Directiva');
const coro = unCuerpo('Coro');   // no convocado a la actividad

let n = 0;
function alguienEn(...cuerpos) {
  n++;
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(`Vc${n}`, `Uerpos${n}`, iglesia).lastInsertRowid;
  for (const c of cuerpos) {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
       VALUES (?, ?, ?, 'Activo', '2024-01-01')`
    ).run(c, miembro, iglesia);
  }
  return miembro;
}

/* La directiva tiene 27: 3 que solo están ahí y 24 que además están en otro
   cuerpo convocado. Es el reparto que tenía la iglesia donde se vio esto. */
const soloDirectiva = [alguienEn(directiva), alguienEn(directiva), alguienEn(directiva)];
const tambienEnOtro = [];
for (let i = 0; i < 24; i++) {
  tambienEnOtro.push(alguienEn(directiva, i % 2 ? damas : caballeros));
}
const soloCoro = alguienEn(coro);

const actividad = db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-08-26', 'Culto', ?, ?)")
  .run(iglesia, JSON.stringify([damas, caballeros, directiva])).lastInsertRowid;

const { integrantesConvocados } = require('../../server/modules/asistencias');
const convocados = integrantesConvocados(
  db.prepare('SELECT * FROM asistencias WHERE id = ?').get(actividad), db, null
);

/** Como filtra la pantalla: cada fila es de un cuerpo. */
const alFiltrarPor = (cuerpoId) =>
  [...convocados.values()].filter((d) => d.cuerpo_id === cuerpoId).length;

test('el cuerpo tiene sus 27 integrantes', () => {
  assert.equal(idsDeIntegrantes(db, directiva).length, 27);
});

test('EL CASO: al filtrar por la directiva aparecen los 27, no solo 3', () => {
  assert.equal(alFiltrarPor(directiva), 27);
});

test('y cada uno de los otros cuerpos sigue mostrando los suyos', () => {
  assert.equal(alFiltrarPor(damas), 12);
  assert.equal(alFiltrarPor(caballeros), 12);
});

test('quien está en dos cuerpos aparece una vez EN CADA UNO', () => {
  // No es duplicar: son dos asistencias distintas, una por cuerpo.
  const suyas = [...convocados.values()].filter((d) => d.miembro_id === tambienEnOtro[0]);
  assert.equal(suyas.length, 2);
  const suyos = suyas.map((d) => d.cuerpo_id);
  assert.ok(suyos.includes(directiva), 'le falta la directiva');
  assert.ok(suyos.some((c) => c === damas || c === caballeros), 'le falta su otro cuerpo');
});

test('quien está en uno solo aparece una sola vez', () => {
  const suyas = [...convocados.values()].filter((d) => d.miembro_id === soloDirectiva[0]);
  assert.equal(suyas.length, 1);
  assert.equal(suyas[0].cuerpo_id, directiva);
});

test('la lista trae una fila por cada par persona-cuerpo', () => {
  // 3 que solo están en la directiva + 24 que están en dos = 3 + 48
  assert.equal(convocados.size, 51);
});

test('a un cuerpo que la actividad no convocó no se lo trae', () => {
  assert.equal(alFiltrarPor(coro), 0);
  assert.equal([...convocados.values()].some((d) => d.miembro_id === soloCoro), false);
});

/* ── Las dos marcas son independientes ─────────────────────────────── */

const marcar = (miembroId, cuerpoId, estado, motivo = null) =>
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, cuerpo_id, estado, motivo, fecha, iglesia_id)
     VALUES (?, ?, ?, ?, ?, '2026-08-26', ?)`
  ).run(actividad, miembroId, cuerpoId, estado, motivo, iglesia);

const marcaDe = (miembroId, cuerpoId) =>
  db.prepare('SELECT estado, motivo FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ? AND cuerpo_id = ?')
    .get(actividad, miembroId, cuerpoId);

test('EL CASO DE LA IGLESIA: justificado en un cuerpo y ausente en el otro', () => {
  // A la directiva le avisó que no iba a poder ir; a Damas no le avisó nada.
  const quien = tambienEnOtro[0];
  const otro = [...convocados.values()]
    .find((d) => d.miembro_id === quien && d.cuerpo_id !== directiva).cuerpo_id;
  marcar(quien, directiva, 'Justificado', 'Trabajo');
  marcar(quien, otro, 'Ausente');

  assert.equal(marcaDe(quien, directiva).estado, 'Justificado');
  assert.equal(marcaDe(quien, directiva).motivo, 'Trabajo');
  assert.equal(marcaDe(quien, otro).estado, 'Ausente');
});

test('y cada cuerpo lo cuenta en lo suyo', () => {
  const cuenta = (cuerpoId, estado) => db
    .prepare('SELECT COUNT(*) c FROM asistencia_detalle WHERE asistencia_id = ? AND cuerpo_id = ? AND estado = ?')
    .get(actividad, cuerpoId, estado).c;
  const otro = [...convocados.values()]
    .find((d) => d.miembro_id === tambienEnOtro[0] && d.cuerpo_id !== directiva).cuerpo_id;
  assert.equal(cuenta(directiva, 'Justificado'), 1);
  assert.equal(cuenta(directiva, 'Ausente'), 0);
  assert.equal(cuenta(otro, 'Ausente'), 1);
  assert.equal(cuenta(otro, 'Justificado'), 0);
});

test('el módulo no admite dos marcas de la misma persona en el mismo cuerpo', () => {
  // Una por cuerpo, no una por persona: el límite se corrió, no se quitó.
  const def = require('../../server/modules/asistencia_detalle');
  const quien = tambienEnOtro[0];
  const error = def.hooks.beforeSave(
    { asistencia_id: actividad, miembro_id: quien, cuerpo_id: directiva, estado: 'Presente' },
    { id: null, existing: null, db }
  );
  assert.match(String(error), /ya tiene su marca en este cuerpo/);
});

test('pero sí admite la de la misma persona en otro cuerpo', () => {
  const def = require('../../server/modules/asistencia_detalle');
  const quien = soloDirectiva[0];
  const error = def.hooks.beforeSave(
    { asistencia_id: actividad, miembro_id: quien, cuerpo_id: caballeros, estado: 'Presente' },
    { id: null, existing: null, db }
  );
  assert.equal(error, null);
});
