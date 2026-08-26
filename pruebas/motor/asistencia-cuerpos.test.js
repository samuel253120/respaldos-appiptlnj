/**
 * Quién aparece al filtrar la lista de asistencia por un cuerpo.
 *
 * POR QUÉ IMPORTA. A una actividad la pueden convocar varios cuerpos, y una
 * misma persona puede estar en más de uno: la tesorera de la directiva es
 * también de Damas. En la lista aparece UNA sola vez —marcarla dos veces sería
 * absurdo y contaría doble en los informes—, y cuenta para el primero de esos
 * cuerpos. Eso está bien.
 *
 * Lo que no estaba bien es que el filtro de la pantalla mirara solo ese cuerpo.
 * Al elegir «Directiva» no aparecía la tesorera, porque ella entra por Damas.
 * Una iglesia con veintisiete integrantes en su directiva veía tres —los
 * únicos que no estaban en ningún otro cuerpo convocado— y la pantalla no daba
 * ninguna pista de dónde estaban los otros veinticuatro: ni un aviso, ni un
 * número que no cuadrara. Solo una lista corta que parecía completa.
 *
 * Por eso cada persona de la lista viaja con TODOS los cuerpos convocados a
 * los que pertenece, y no solo con aquel por el que entra.
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

/** Como filtra la pantalla: por pertenencia, no por el cuerpo de entrada. */
const alFiltrarPor = (cuerpoId) =>
  [...convocados.values()].filter((d) => (d.cuerpos || []).includes(cuerpoId)).length;

test('el cuerpo tiene sus 27 integrantes', () => {
  assert.equal(idsDeIntegrantes(db, directiva).length, 27);
});

test('EL CASO: al filtrar por la directiva aparecen los 27, no solo 3', () => {
  // Los 3 son los que no están en ningún otro cuerpo convocado. Antes eran los
  // únicos que se veían, y nada en la pantalla decía que faltaban 24.
  assert.equal(alFiltrarPor(directiva), 27);
});

test('y cada uno de los otros cuerpos sigue mostrando los suyos', () => {
  assert.equal(alFiltrarPor(damas), 12);
  assert.equal(alFiltrarPor(caballeros), 12);
});

test('nadie aparece dos veces en la lista', () => {
  // Es la razón por la que cada persona entra por un solo cuerpo: marcarla dos
  // veces contaría doble en los informes.
  assert.equal(convocados.size, 27);
});

test('quien está en dos cuerpos cuenta para uno solo', () => {
  const ficha = convocados.get(tambienEnOtro[0]);
  assert.equal(ficha.cuerpos.length, 2, 'no llegó con sus dos cuerpos');
  assert.ok([damas, caballeros].includes(ficha.cuerpo_id), 'entra por el primero de la actividad');
});

test('quien está en un solo cuerpo llega igual, con ese', () => {
  const ficha = convocados.get(soloDirectiva[0]);
  assert.deepEqual(ficha.cuerpos, [directiva]);
  assert.equal(ficha.cuerpo_id, directiva);
});

test('a un cuerpo que la actividad no convocó no se lo trae', () => {
  assert.equal(convocados.has(soloCoro), false);
  assert.equal(alFiltrarPor(coro), 0);
});
