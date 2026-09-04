/**
 * RENOMBRAR UN MOTIVO DE AUSENCIA QUE YA SE USÓ.
 *
 * El módulo frenaba el BORRADO de un motivo en uso con el argumento correcto
 * —dejaría esas marcas «sin motivo»— y dejaba el RENOMBRADO abierto, sin
 * cartel, haciendo exactamente el mismo daño: las marcas guardan el NOMBRE, así
 * que seguían diciendo el viejo.
 *
 * MEDIDO en la v1.362.0, con «Trabajo» en una marca: renombrarlo a «Trabajo o
 * estudio» contestó 200 sin una palabra; la marca siguió diciendo «Trabajo»,
 * que desde ese momento ya no se ofrecía en ninguna parte. Es el estado que el
 * rechazo del borrado se propone evitar, alcanzado por la puerta de al lado.
 *
 * Se resuelve como en Tipos de Actividad (v1.353.0) y en Categorías de
 * Tesorería (v1.349.0): se pregunta, y al confirmar el nombre nuevo se lleva
 * las marcas consigo, en la misma transacción.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

const MARCA = `n${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del renombre ${MARCA}`, `IG-MN${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Damas del renombre ${MARCA}`, iglesia).lastInsertRowid;
const miembro = db
  .prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
     VALUES (?, ?, 'Rosa Elena', 'Muñoz Díaz', 'Activo')`
  ).run(iglesia, `${process.pid}44-0`).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, estado, fecha_ingreso)
   VALUES (?, 'Miembro', ?, 'Activo', '2026-01-01')`
).run(cuerpo, miembro);
const actividad = db
  .prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
     VALUES ('2026-08-02', 'Servicio General', ?, ?)`
  ).run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

const unMotivo = (nombre, pideDetalle = 0) => {
  const id = db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, 1)')
    .run(`${nombre} ${MARCA}`, pideDetalle).lastInsertRowid;
  return db.prepare('SELECT * FROM motivos_ausencia WHERE id = ?').get(id);
};

/** Una marca justificada con ese motivo. Devuelve su id. */
async function unaMarca(api, motivo, detalle) {
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividad);
  const r = await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro, iglesia_id: iglesia,
    cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo, detalle,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 220));
  return r.json.id;
}

const laMarca = (id) => db.prepare('SELECT * FROM asistencia_detalle WHERE id = ?').get(id);
const seOfrece = async (api, nombre) =>
  (await api('GET', '/motivos_ausencia/opciones')).json.map((o) => o.id).includes(nombre);

/* ─────────────────────────────── se pregunta ──────────────────────────── */

test('renombrar un motivo que ya se usó pregunta antes', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Trabajo');
  await unaMarca(api, m.nombre);

  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: `Trabajo o estudio ${MARCA}` });
  assert.equal(r.estado, 400, `medido en la v1.362.0: contestaba 200 sin una palabra (${r.texto.slice(0, 160)})`);
  assert.ok(r.json.confirmar, 'no es un rechazo: corregir el nombre de un motivo hay que poder hacerlo');
  assert.match(r.json.confirmar, /1 marca\(s\) de asistencia/);
  assert.match(r.json.confirmar, /la fecha, la persona, el cuerpo, el estado y la explicación/,
    'y sobre todo dice qué NO se toca');

  assert.equal(db.prepare('SELECT nombre FROM motivos_ausencia WHERE id = ?').get(m.id).nombre, m.nombre,
    'mientras no conteste, no cambió nada');
});

/* ──────────────────── y al confirmar, se lleva las marcas ─────────────── */

test('al confirmar, el nombre nuevo se lleva las marcas', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Cuidando a su madre');
  const seVaALlamar = `Cuidando a un familiar ${MARCA}`;
  const id = await unaMarca(api, m.nombre);

  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: seVaALlamar, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));

  assert.equal(laMarca(id).motivo, seVaALlamar,
    'la marca seguía diciendo el nombre viejo, que ya no se ofrecía en ninguna parte');
  assert.ok(await seOfrece(api, seVaALlamar));
  assert.ok(!(await seOfrece(api, m.nombre)));
});

test('y de cada marca no se toca nada más', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Duelo familiar', 1);
  const id = await unaMarca(api, m.nombre, 'Falleció su padre');
  const antes = laMarca(id);

  await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: `Duelo ${MARCA}`, igual_asi: true });
  const despues = laMarca(id);

  assert.equal(despues.motivo, `Duelo ${MARCA}`);
  assert.equal(despues.detalle, 'Falleció su padre', 'la explicación escrita es de quien la escribió');
  assert.equal(despues.fecha, antes.fecha);
  assert.equal(despues.miembro_id, antes.miembro_id);
  assert.equal(despues.cuerpo_id, antes.cuerpo_id);
  assert.equal(despues.estado, antes.estado);
  assert.equal(despues.tomada_en, antes.tomada_en, 'ni cuándo se tomó la lista');
});

/* ───────────────────────── lo que no pregunta nada ────────────────────── */

test('uno que todavía no se ha usado se renombra sin preguntar', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Reunión de trabajo');
  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: `Compromiso laboral ${MARCA}` });
  assert.equal(r.estado, 200, 'un error de tecleo se corrige y punto');
});

test('y de uno que sí se usó se puede seguir cambiando todo lo demás', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Enfermedad');
  await unaMarca(api, m.nombre);

  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, notas: 'Con licencia o sin ella' });
  assert.equal(r.estado, 200, 'lo que rompe el informe es el nombre, y solo ése se cuida');

  // Se relee la ficha: el guardado anterior le movió la marca de versión, y el
  // motor rechaza —con razón— un guardado que viene de una copia vieja.
  const alDia = (await api('GET', `/motivos_ausencia/${m.id}`)).json;
  const conCasilla = await api('PUT', `/motivos_ausencia/${m.id}`, { ...alDia, pide_detalle: 1 });
  assert.equal(conCasilla.estado, 200, 'marcarle «Pide explicación» tampoco es renombrarlo');
});

/* ─────────────────────────────── queda anotado ────────────────────────── */

test('el arrastre queda anotado, con cuántas marcas se movieron', async () => {
  const api = await elSistemaAndando();
  const m = unMotivo('Viaje');
  await unaMarca(api, m.nombre);

  await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: `Viaje fuera ${MARCA}`, igual_asi: true });

  const linea = db
    .prepare('SELECT detalle FROM registro_cambios WHERE detalle LIKE ? ORDER BY id DESC LIMIT 1')
    .get(`%marca(s) de asistencia pasaron de «${m.nombre}»%`);
  assert.ok(linea, 'sin esto, dentro de un año nadie sabe por qué el informe cambió');
  assert.match(linea.detalle, /1 marca\(s\)/);
});
