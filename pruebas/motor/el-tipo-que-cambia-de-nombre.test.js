/**
 * RENOMBRAR UN TIPO DE ACTIVIDAD QUE YA SE USÓ.
 *
 * El módulo frenaba el BORRADO de un tipo en uso con el argumento correcto
 * —dejaría esas actividades «sin tipo»— y dejaba el RENOMBRADO abierto, sin
 * cartel, haciendo exactamente el mismo daño: las actividades guardan el
 * NOMBRE, así que seguían diciendo el viejo.
 *
 * Medido en la revisión, con «Ensayo» en dos actividades: renombrarlo contestó
 * 200 sin una palabra, y las dos siguieron diciendo «Ensayo», que ya no estaba
 * en la lista.
 *
 * Se resuelve como en Categorías de Tesorería (v1.349.0): se pregunta, y al
 * confirmar el nombre nuevo se lleva las actividades consigo, en la misma
 * transacción.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

/** Los archivos del motor comparten UNA base y corren en paralelo. */
const MARCA = `r${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del renombre ${MARCA}`, `IG-TR${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Coro del renombre ${MARCA}`, iglesia).lastInsertRowid;

const unTipoLlamado = (nombre) =>
  db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 1)').run(nombre).lastInsertRowid;

const conEseTipo = (nombre) =>
  db.prepare('SELECT COUNT(*) AS c FROM asistencias WHERE tipo_reunion = ? AND iglesia_id = ?')
    .get(nombre, iglesia).c;

const unasActividades = (api, tipo, fechas) =>
  Promise.all(fechas.map((fecha) =>
    api('POST', '/asistencias', { fecha, cuerpos: [cuerpo], iglesia_id: iglesia, tipo_reunion: tipo })));

/* ─────────────────────────────── se pregunta ──────────────────────────── */

test('renombrar uno que ya se usó pregunta antes, y sin contestar no cambia nada', async () => {
  const api = await elSistemaAndando();
  const seLlamaba = `Ensayo del coro ${MARCA}`;
  const id = unTipoLlamado(seLlamaba);
  const hechas = await unasActividades(api, seLlamaba, ['2026-03-04', '2026-03-11']);
  for (const r of hechas) assert.equal(r.estado, 201, r.texto.slice(0, 160));

  const r = await api('PUT', `/tipos_actividad/${id}`, { nombre: `Ensayo general ${MARCA}` });
  assert.equal(r.estado, 400, `medido en la v1.349.0: contestaba 200 sin una palabra (${r.texto.slice(0, 140)})`);
  assert.ok(r.json.confirmar, 'no es un rechazo: es una pregunta con dos botones');
  assert.match(r.json.confirmar, /2 actividad\(es\)/, 'dice cuántas son');
  assert.match(r.json.confirmar, /la fecha, los cuerpos convocados, el lugar y las marcas/,
    'y sobre todo dice qué NO se toca');

  assert.equal(
    db.prepare('SELECT nombre FROM tipos_actividad WHERE id = ?').get(id).nombre, seLlamaba,
    'mientras no conteste, no cambió nada'
  );
  assert.equal(conEseTipo(seLlamaba), 2);
});

/* ───────────────────── y al confirmar, se lleva las actividades ───────── */

test('al confirmar, el nombre nuevo se lleva las actividades', async () => {
  const api = await elSistemaAndando();
  const seLlamaba = `Salida a visitar ${MARCA}`;
  const seVaALlamar = `Salida a visitar enfermos ${MARCA}`;
  const id = unTipoLlamado(seLlamaba);
  await unasActividades(api, seLlamaba, ['2026-04-05', '2026-04-12', '2026-04-19']);

  const r = await api('PUT', `/tipos_actividad/${id}`, { nombre: seVaALlamar, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  assert.equal(conEseTipo(seLlamaba), 0, 'ninguna se queda con el nombre viejo');
  assert.equal(conEseTipo(seVaALlamar), 3,
    'el informe por tipo sigue cuadrando en una sola línea en vez de partirse en dos');
});

test('y de cada actividad no se toca nada más', async () => {
  const api = await elSistemaAndando();
  const seLlamaba = `Vigilia de oración ${MARCA}`;
  const id = unTipoLlamado(seLlamaba);
  const creada = await api('POST', '/asistencias', {
    fecha: '2026-05-08', cuerpos: [cuerpo], iglesia_id: iglesia, tipo_reunion: seLlamaba,
    lugar: 'El templo', hora_inicio: '21:00', observaciones: 'Hasta la madrugada',
  });
  assert.equal(creada.estado, 201, creada.texto.slice(0, 160));

  await api('PUT', `/tipos_actividad/${id}`, { nombre: `Vigilia ${MARCA}`, igual_asi: true });

  const despues = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(creada.json.id);
  assert.equal(despues.tipo_reunion, `Vigilia ${MARCA}`);
  assert.equal(despues.fecha, '2026-05-08');
  assert.equal(despues.lugar, 'El templo');
  assert.equal(despues.hora_inicio, '21:00');
  assert.equal(despues.observaciones, 'Hasta la madrugada');
  assert.equal(despues.cuerpos, JSON.stringify([cuerpo]));
});

/* ───────────────────────── lo que no pregunta nada ────────────────────── */

test('uno que todavía no se ha usado se renombra sin preguntar', async () => {
  const api = await elSistemaAndando();
  const id = unTipoLlamado(`Reunión de diáconos ${MARCA}`);
  const r = await api('PUT', `/tipos_actividad/${id}`, { nombre: `Reunión de diaconía ${MARCA}` });
  assert.equal(r.estado, 200, 'un error de tecleo se corrige y punto');
});

test('y de uno que sí se usó se puede seguir cambiando todo lo demás', async () => {
  const api = await elSistemaAndando();
  const suyo = `Clase de Dorcas ${MARCA}`;
  const id = unTipoLlamado(suyo);
  await unasActividades(api, suyo, ['2026-06-06']);

  const r = await api('PUT', `/tipos_actividad/${id}`, { notas: 'Los primeros sábados' });
  assert.equal(r.estado, 200, 'lo que rompe el informe es el nombre, y solo ése se cuida');
});

/* ─────────────────────────────── queda anotado ────────────────────────── */

test('el arrastre queda anotado en el Registro de Cambios, con cuántas se movieron', async () => {
  const api = await elSistemaAndando();
  const seLlamaba = `Retiro de damas ${MARCA}`;
  const id = unTipoLlamado(seLlamaba);
  await unasActividades(api, seLlamaba, ['2026-07-04', '2026-07-11']);

  await api('PUT', `/tipos_actividad/${id}`, { nombre: `Retiro de hermanas ${MARCA}`, igual_asi: true });

  const linea = db
    .prepare("SELECT detalle FROM registro_cambios WHERE detalle LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`%actividad(es) pasaron de «${seLlamaba}»%`);
  assert.ok(linea, 'sin esto, dentro de un año nadie sabe por qué el informe cambió');
  assert.match(linea.detalle, /2 actividad\(es\)/);
  assert.match(linea.detalle, new RegExp(`Retiro de hermanas ${MARCA}`));
});

test('el módulo está entre los que vigila el Registro de Cambios', () => {
  const { MODULOS_VIGILADOS } = require('../../server/bitacora');
  assert.ok(MODULOS_VIGILADOS.includes('tipos_actividad'),
    'las actividades ya estaban; la lista con que se clasifican, no');
});
