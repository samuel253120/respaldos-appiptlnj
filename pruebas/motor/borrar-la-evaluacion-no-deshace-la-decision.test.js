/**
 * BORRAR EL ACTA DE LA DECISIÓN NO DESHACE LA DECISIÓN.
 *
 * Una evaluación no es una anotación cualquiera: es lo que MOVIÓ la ficha del
 * integrante. Borrarla no la devuelve —ni debería, porque la persona pasó a
 * oficial o salió del cuerpo de verdad— así que lo que queda es un estado sin
 * nada que lo explique.
 *
 * Medido en la v1.399.0:
 *
 *   se aprueba ................  201 · la ficha queda «Activo», oficial el 20-05
 *   se borra la evaluación ....  200, sin preguntar
 *   la ficha después ..........  «Activo», oficial el 20-05
 *
 * La persona es integrante oficial y ya no existe ningún papel que diga por
 * qué. Es el mismo patrón que esta serie de revisiones cerró en las actas y en
 * los certificados: se deshace el hecho y su consecuencia se queda, callada.
 *
 * Se pregunta y no se prohíbe, por lo mismo que en las actas: una anotada por
 * error tiene que poder sacarse. Lo que hace falta es que quien la borre sepa
 * las dos cosas que no son evidentes.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const evaluaciones = require('../../server/modules/evaluaciones_integrantes');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central BE ${marca}`, `BE-${marca}`).lastInsertRowid;

function unaEvaluacionAprobada() {
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas ${++n} BE ${marca}`, iglesia).lastInsertRowid;
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve BE ${marca}`, iglesia).lastInsertRowid;
  const ficha = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_oficial, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-03-01', '2026-05-20', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve BE ${marca}`, iglesia).lastInsertRowid;
  const fila = {
    id: 1000 + n, integrante_id: ficha, fecha: '2026-05-20',
    resultado: 'Aprobado', cuerpo_id: cuerpo, iglesia_id: iglesia,
  };
  return { fila, ficha, cuerpo, miembro };
}

test('borrar una evaluación pregunta antes', () => {
  const { fila } = unaEvaluacionAprobada();
  const aviso = evaluaciones.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.ok(aviso, 'antes contestaba 200 sin decir nada');
  assert.equal(aviso.confirmar, 'evaluacion_que_se_borra');
});

test('el aviso dice cuál es, qué se queda como está y por dónde se cambia', () => {
  const { fila } = unaEvaluacionAprobada();
  const { error } = evaluaciones.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.match(error, /20-05-2026/, 'cuál evaluación es');
  assert.match(error, new RegExp(`Quien${n} Sirve BE ${marca}`), 'de quién');
  assert.match(error, /«Aprobado»/, 'qué decía');
  assert.match(error, /NO deshace/, 'lo que no va a pasar');
  assert.match(error, /sigue «Activo»/, 'y en qué queda la ficha');
  assert.match(error, /integrante oficial desde el 20-05-2026/);
  assert.match(error, /ficha de integrante/, 'por dónde se cambia el estado');
  assert.match(error, /corríjala en vez de borrarla/, 'y la otra salida');
});

test('contestando que sí, se borra', () => {
  const { fila } = unaEvaluacionAprobada();
  assert.equal(evaluaciones.hooks.beforeDelete(fila, { db, confirmado: true }), null);
});

test('el aviso se basta solo, porque los botones son los del navegador', () => {
  /*
   * Escrito después de equivocarse, y lo atajó una prueba que ya existía.
   *
   * Al cerrar este hallazgo se le puso a la pregunta una entrada en la tabla
   * `COMO_SE_PREGUNTA` de la pantalla, con su título y sus dos botones. Esa
   * tabla NO se lee en los borrados: la lee `preguntarSiIgualVa`, que solo
   * corre al guardar, y un borrado va por `borrarPreguntando`, que usa la caja
   * del navegador. Era código muerto, y es exactamente el error que
   * pruebas/motor/borrar-un-documento-del-libro.test.js vigila desde que se
   * cometió la primera vez con el acta.
   *
   * La consecuencia para el aviso es esta: todo lo que haya que decir tiene que
   * estar en el mensaje del servidor, porque no hay título ni rótulos donde
   * apoyarse.
   */
  const { fila } = unaEvaluacionAprobada();
  const { error } = evaluaciones.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.ok(error.length > 200, `el aviso se explica solo: mide ${error.length} caracteres`);
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA'), app.indexOf('const como = COMO_SE_PREGUNTA'));
  assert.ok(!tabla.includes('evaluacion_que_se_borra'),
    'una clave de borrado en esa tabla no se lee nunca');
});

test('y por la puerta: sin confirmar no se borra, confirmando sí', async () => {
  const api = await elSistemaAndando();
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas ${++n} BE ${marca}`, iglesia).lastInsertRowid;
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve BE ${marca}`, iglesia).lastInsertRowid;
  const ficha = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', '2026-03-01', '2026-06-01', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve BE ${marca}`, iglesia).lastInsertRowid;

  const ev = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'La directiva' });
  assert.equal(ev.estado, 201, ev.texto);

  const sinConfirmar = await api('DELETE', `/evaluaciones_integrantes/${ev.json.id}`);
  assert.equal(sinConfirmar.estado, 400);
  assert.equal(sinConfirmar.json.confirmar, 'evaluacion_que_se_borra');
  assert.ok(db.prepare('SELECT id FROM evaluaciones_integrantes WHERE id = ?').get(ev.json.id),
    'y no se borró');

  const confirmando = await api('DELETE', `/evaluaciones_integrantes/${ev.json.id}?igual_asi=true`);
  assert.equal(confirmando.estado, 200, confirmando.texto);
  assert.equal(db.prepare('SELECT id FROM evaluaciones_integrantes WHERE id = ?').get(ev.json.id), undefined);

  // Y la ficha se quedó como el aviso dijo que se iba a quedar
  const quedo = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(ficha);
  assert.equal(quedo.estado, 'Activo');
  assert.equal(quedo.fecha_oficial, '2026-05-20');
});
