/**
 * EL TIPO DE UNA ACTIVIDAD SE COMPRUEBA CONTRA LA LISTA, NO SOLO SE OFRECE.
 *
 * El módulo de Tipos de Actividad acotaba el desplegable del navegador y nada
 * más. Por la API —o por una planilla importada— entraba cualquier texto, y un
 * informe de asistencia agrupado por tipo empezaba a mostrar filas que nadie
 * creó. Medido en la revisión del módulo, contra el sistema andando:
 *
 *   · «Tipo Que No Existe» → 201, guardado tal cual
 *   · un tipo desactivado  → 201
 *
 * Es el mismo hallazgo que se cerró en Tesorería en la v1.344.0, y la pieza
 * que lo resuelve ya existía: un campo declara `opcionesDe: { modulo, columna }`
 * y el motor lo comprueba contra la tabla donde vive su lista.
 *
 * Estas pruebas pasan POR EL MOTOR, que es lo único que la persona toca: en
 * Tesorería se descubrió tarde que comprobar la pieza suelta no basta —la
 * llamada podía faltar en crud.js sin que se cayera ninguna—.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

/** Los archivos del motor comparten UNA base y corren en paralelo. */
const MARCA = `t${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del tipo ${MARCA}`, `IG-TI${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Coro del tipo ${MARCA}`, iglesia).lastInsertRowid;

const unTipoLlamado = (nombre, activo = 1) =>
  db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, ?)').run(nombre, activo).lastInsertRowid;

/** Una actividad como la crearía quien pasa lista. */
const crear = (api, tipo, fecha = '2026-08-02') =>
  api('POST', '/asistencias', { fecha, cuerpos: [cuerpo], iglesia_id: iglesia, tipo_reunion: tipo });

/* ─────────────────────────────── lo que no entra ──────────────────────── */

test('un tipo que no está en la lista no se guarda', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, `Tipo Que No Existe ${MARCA}`);
  assert.equal(r.estado, 400, `medido en la v1.351.0: contestaba 201 (${r.texto.slice(0, 140)})`);
  assert.match(r.json.error, /no está en Tipos de Actividad/);
  assert.match(r.json.error, /créelo primero/, 'y dice cómo seguir: quien pasa lista puede crearlo en el momento');
});

test('uno que la iglesia desactivó tampoco', async () => {
  const api = await elSistemaAndando();
  const apagado = `Retiro de invierno ${MARCA}`;
  unTipoLlamado(apagado, 0);

  const r = await crear(api, apagado);
  assert.equal(r.estado, 400, 'desmarcar «En uso» dejaba de ofrecerlo y se seguía aceptando por la API');
  assert.match(r.json.error, /ya no está en uso/);
  assert.match(r.json.error, /vuelva a marcarlo «En uso»/);
});

/* ──────────────────────────────── lo que sí entra ─────────────────────── */

test('uno de la lista se guarda sin problema', async () => {
  const api = await elSistemaAndando();
  const suyo = `Escuela Dominical ${MARCA}`;
  unTipoLlamado(suyo);

  const r = await crear(api, suyo, '2026-08-09');
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.equal(r.json.tipo_reunion, suyo);
});

test('y escrito con otras mayúsculas queda como está en la lista', async () => {
  const api = await elSistemaAndando();
  const suyo = `Salida a la Cárcel ${MARCA}`;
  unTipoLlamado(suyo);

  const r = await crear(api, suyo.toUpperCase(), '2026-08-16');
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.equal(r.json.tipo_reunion, suyo,
    'el informe agrupa por el texto guardado: dos formas de escribirlo lo parten en dos');
});

/* ───────────────── lo viejo se sigue pudiendo corregir ────────────────── */

test('una actividad vieja con un tipo ya apagado se sigue pudiendo corregir', async () => {
  /*
   * Es el contrapeso de todo lo anterior, y la razón de ser de la
   * desactivación: lo ya anotado no queda huérfano. Se le cambia la hora, no
   * el tipo, así que el motor no lo mira.
   */
  const api = await elSistemaAndando();
  const suyo = `Vigilia de agosto ${MARCA}`;
  const idTipo = unTipoLlamado(suyo);

  const creada = await crear(api, suyo, '2026-08-23');
  assert.equal(creada.estado, 201, creada.texto.slice(0, 200));

  db.prepare('UPDATE tipos_actividad SET activo = 0 WHERE id = ?').run(idTipo);

  const corregida = await api('PUT', `/asistencias/${creada.json.id}`, {
    ...creada.json, hora_inicio: '20:30',
  });
  assert.equal(corregida.estado, 200,
    `la actividad de agosto no puede quedar imposible de guardar (${corregida.texto.slice(0, 140)})`);
  assert.equal(corregida.json.tipo_reunion, suyo, 'y sigue diciendo lo que decía');
});
