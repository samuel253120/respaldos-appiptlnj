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
const { tiposDeActividad, listasDeAsistenciaComoDatos } = require('../../server/migraciones');

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

/* ─────────── la lista y las actividades, diciendo lo mismo (v1.351.0) ─── */

/*
 * Justo antes corre `listasDeAsistenciaComoDatos`, que mete en la lista
 * cualquier nombre que las actividades estén usando —incluidos los viejos, en
 * una base vieja—. Renombrar solo las actividades dejaba las dos migraciones
 * contando historias distintas: una entrada en la lista que ya no usa nadie,
 * ofrecida en el desplegable, y la actividad diciendo otra cosa.
 */

const enLaLista = (nombre) =>
  db.prepare('SELECT id, nombre FROM tipos_actividad WHERE lower(nombre) = lower(?)').get(nombre);

const ponerEnLaLista = (nombre) => {
  if (!enLaLista(nombre)) db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 1)').run(nombre);
};

test('el nombre viejo sale de la lista cuando ya no lo usa ninguna actividad', () => {
  ponerEnLaLista('Culto general');
  const id = nuevaActividad('Culto general');

  comoSiSeReiniciara();

  assert.equal(comoQuedo(id), 'Servicio General');
  assert.ok(!enLaLista('Culto general'),
    'quedaba ofrecida en el desplegable un tipo que ya no usaba ninguna actividad');
  assert.ok(enLaLista('Servicio General'), 'y el nombre nuevo tiene que estar');
});

test('si el nombre nuevo no estaba en la lista, se repone antes de renombrar', () => {
  /*
   * Si la iglesia borró «Servicio General» alguna vez, renombrar a secas
   * dejaría la actividad apuntando a un tipo que no está en ninguna parte:
   * exactamente lo que la regla del módulo se niega a hacer al borrar.
   */
  const habia = enLaLista('Servicio General');
  if (habia) db.prepare('DELETE FROM tipos_actividad WHERE id = ?').run(habia.id);

  const id = nuevaActividad('Culto general');
  comoSiSeReiniciara();

  assert.ok(enLaLista('Servicio General'), 'se repone: ninguna actividad queda apuntando a la nada');
  assert.equal(comoQuedo(id), 'Servicio General');
});

test('pero el viejo NO sale si algo lo sigue usando, aunque esté escrito distinto', () => {
  /*
   * El renombrado compara el nombre exacto, así que una actividad guardada
   * como «culto general» no se mueve. Retirar la entrada de la lista dejaría
   * a esa actividad diciendo algo que no está en ninguna parte.
   */
  ponerEnLaLista('Culto general');
  const conMayuscula = nuevaActividad('Culto general');
  const conMinuscula = nuevaActividad('culto general');

  comoSiSeReiniciara();

  assert.equal(comoQuedo(conMayuscula), 'Servicio General');
  assert.equal(comoQuedo(conMinuscula), 'culto general', 'a ésa no la alcanzó el renombrado');
  assert.ok(enLaLista('Culto general'), 'así que su tipo tiene que seguir en la lista');

  db.prepare('DELETE FROM asistencias WHERE id = ?').run(conMinuscula);
  const suelta = enLaLista('Culto general');
  if (suelta) db.prepare('DELETE FROM tipos_actividad WHERE id = ?').run(suelta.id);
});

test('al terminar, todo tipo que una actividad diga está en la lista', () => {
  /*
   * Es la promesa de las dos migraciones juntas, y la que hace innecesaria la
   * parte que ponía «Otros»: si todo nombre en uso está en la lista, no queda
   * ningún nombre suelto que limpiar.
   *
   * Se mira solo lo de esta iglesia: los archivos del motor comparten una base
   * y otro puede estar a mitad de camino con sus propios datos.
   */
  listasDeAsistenciaComoDatos();   // la que mete en la lista lo que se usa
  comoSiSeReiniciara();            // la que pone al día los nombres viejos
  const enUso = db
    .prepare("SELECT DISTINCT tipo_reunion AS t FROM asistencias WHERE iglesia_id = ? AND tipo_reunion != ''")
    .all(iglesia).map((f) => f.t);
  assert.ok(enUso.length, 'la prueba no sirve si no hay ninguna actividad');
  for (const t of enUso) assert.ok(enLaLista(t), `«${t}» quedó fuera de la lista`);
});
