/**
 * LA MIGRACIÓN QUE BORRABA LOS TIPOS QUE LA IGLESIA AGREGABA.
 *
 * `tiposDeActividad()` se escribió cuando la lista de clases de reunión vivía
 * dentro del programa. Tenía los doce nombres de entonces escritos a mano y a
 * toda actividad cuyo tipo no estuviera ahí le ponía «Otros». Cuando la lista
 * pasó a ser un dato que mantiene la iglesia, nadie volvió a mirarla: siguió
 * corriendo, y sin dejar constancia, así que corría ENTERA EN CADA ARRANQUE.
 *
 * Medido en la revisión del módulo, sobre una instalación nueva: la iglesia
 * agrega «Escuela Dominical», pasa lista cuatro domingos, se reinicia el
 * servidor, y los cuatro domingos amanecen como «Otros» —mientras el tipo
 * sigue ofreciéndose en el desplegable, como si nada—.
 *
 * No hacía falta que nadie se equivocara. Bastaba con reiniciar.
 *
 * Ninguna prueba del sistema llamaba a esta migración. Con una sola —la
 * primera de este archivo— el hallazgo habría salido solo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { tiposDeActividad } = require('../../server/migraciones');

/** Los archivos del motor comparten UNA base y corren en paralelo. */
const MARCA = `m${process.pid}`;
const CONSTANCIA = 'tipos_de_actividad_con_los_nombres_nuevos';

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia de la migración ${MARCA}`, `IG-TA${process.pid}`.slice(0, 12)).lastInsertRowid;

/*
 * `cuerpos` guarda una lista en JSON y hay consultas que la recorren con
 * json_each: dejarla en blanco no es «sin cuerpos», es un JSON roto, y como
 * los archivos del motor comparten UNA base, eso rompe las consultas de los
 * demás. Se convoca a un cuerpo de verdad.
 */
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, iglesia_id, estado) VALUES (?, ?, 'Activo')")
  .run(`Damas de la migración ${MARCA}`, iglesia).lastInsertRowid;

const nuevaActividad = (tipo, fecha = '2026-08-09') =>
  db.prepare('INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?, ?, ?, ?)')
    .run(fecha, tipo, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

const comoQuedo = (id) => db.prepare('SELECT tipo_reunion FROM asistencias WHERE id = ?').get(id).tipo_reunion;

/** Se la hace correr de nuevo a propósito: es lo que hacía en cada arranque. */
const comoSiSeReiniciara = () => {
  db.prepare('DELETE FROM migraciones WHERE nombre = ?').run(CONSTANCIA);
  tiposDeActividad();
};

/* ─────────────────────────── lo que la iglesia agrega ─────────────────── */

test('un tipo que la iglesia agregó sigue en sus actividades después de la migración', () => {
  const suyo = `Escuela Dominical ${MARCA}`;
  db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 1)').run(suyo);
  const domingos = ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23'].map((f) => nuevaActividad(suyo, f));

  comoSiSeReiniciara();

  for (const id of domingos) {
    assert.equal(comoQuedo(id), suyo,
      'es el caso exacto que se midió: cuatro domingos de Escuela Dominical amanecían como «Otros»');
  }
});

test('y tampoco se toca uno que la iglesia desactivó', () => {
  const guardado = `Retiro espiritual ${MARCA}`;
  db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 0)').run(guardado);
  const id = nuevaActividad(guardado);

  comoSiSeReiniciara();

  assert.equal(comoQuedo(id), guardado,
    'desactivado quiere decir «no se ofrece para lo nuevo», no «bórrenlo de lo viejo»');
});

test('ni uno que no esté en la lista por ninguna parte', () => {
  /*
   * Es el caso que descolocaba: la migración de más arriba mete en la lista
   * cualquier nombre en uso, así que este estado dura poco. Aun así, mientras
   * dure, la actividad tiene que seguir diciendo lo que decía: la migración no
   * es quien decide qué tipos existen.
   */
  const id = nuevaActividad(`Tipo Que No Existe ${MARCA}`);
  comoSiSeReiniciara();
  assert.equal(comoQuedo(id), `Tipo Que No Existe ${MARCA}`);
});

/* ──────────────────────── lo que la migración sí hace ─────────────────── */

test('los nombres viejos del sistema sí pasan a los nuevos', () => {
  /*
   * Para esto se escribió, y sigue sirviendo: una iglesia que restaure un
   * respaldo anterior a la lista administrable no tiene por qué quedarse con
   * «Culto general» y «Servicio General» diciendo lo mismo.
   */
  const id = nuevaActividad('Culto general');
  comoSiSeReiniciara();
  assert.equal(comoQuedo(id), 'Servicio General');
});

/* ─────────────────────────────── la constancia ────────────────────────── */

test('deja constancia de que corrió', () => {
  comoSiSeReiniciara();
  assert.ok(db.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(CONSTANCIA),
    'sin constancia volvía a correr entera en cada arranque, para siempre');
});

test('y no vuelve a correr', () => {
  comoSiSeReiniciara();                 // corre y deja constancia
  const id = nuevaActividad('Culto general');
  tiposDeActividad();                   // el arranque siguiente
  assert.equal(comoQuedo(id), 'Culto general',
    'la segunda vez no toca nada: por eso es una migración y no una regla');
});
