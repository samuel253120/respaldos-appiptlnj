/**
 * El histórico admitiendo la misma elección dos veces.
 *
 * Medido sobre un mismo cuerpo, una detrás de otra y sin una palabra:
 *
 *   «2020 – 2022» del 01-01-2020 al 31-12-2022 ....... 201
 *   «2021 – 2023» del 01-01-2021 al 31-12-2023 ....... 201  (se pisan dos años)
 *   otra «2020 – 2022» con las mismas fechas ......... 201
 *   período escrito «   » ............................ 201
 *
 * La 1.257.0 ya preguntaba por los períodos que se pisan, pero solo entre las
 * que están en carrera: preguntaba «¿quién dirige hoy?», y una directiva cerrada
 * a mano no dirige. El histórico es otra pregunta —qué pasó— y ahí dos períodos
 * que se pisan son un problema aunque los dos estén cerrados: la historia queda
 * diciendo que el cuerpo tuvo dos directivas a la vez, y eso es lo que se lee
 * años después.
 *
 * Y el duplicado exacto no es un traslape: es la misma elección anotada dos
 * veces —dos personas cargando el histórico, alguien que guardó dos veces— así
 * que se dice distinto, porque no hay ninguna fecha que corregir.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const enEjercicio = require('../../server/directiva-en-ejercicio');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/**
 * Un cuerpo con una persona adentro, para poder ponerle jefe a sus directivas.
 *
 * El jefe hace falta: sin él salta antes la pregunta de la 1.258.0 —«queda sin
 * primer jefe»— y estas comprobaciones medirían ésa en vez de la del histórico.
 * Contestarla con «igual así» tampoco serviría: el «igual así» es uno solo para
 * todo el guardado, así que taparía también la pregunta que se quiere ver.
 */
function unCuerpo() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia hist ${m}`, `HIST${m}`).lastInsertRowid;
  const id = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo hist ${m}`, iglesia).lastInsertRowid;
  const jefe = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Jefa', ?, ?, 'Activo')")
    .run(`Delhist ${m}`, iglesia).lastInsertRowid;
  db.prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado,
                                              fecha_ingreso, iglesia_id)
              VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', '2010-01-01', ?)`).run(id, jefe, iglesia);
  return { id, iglesia, m, jefe };
}

/** Una directiva por la API, contestando lo que salga. */
const anotar = (api, c, d) => api('POST', '/directivas', {
  cuerpo_id: c.id, estado: 'Finalizada', primer_jefe_id: c.jefe, igual_asi: true, ...d,
});
/** Lo mismo, sin contestar nada, para poder ver qué pregunta. */
const anotarSinConfirmar = (api, c, d) => api('POST', '/directivas', {
  cuerpo_id: c.id, estado: 'Finalizada', primer_jefe_id: c.jefe, ...d,
});

// ------------------------------------------ el histórico que se contradice ----

test('dos períodos cerrados que se pisan se preguntan', async () => {
  /*
   * Los dos están fuera de carrera, así que la pregunta de «quién dirige hoy» no
   * los miraba. El problema no es quién dirige: es que la historia dice que el
   * cuerpo tuvo dos directivas a la vez.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  await anotar(api, c, { periodo: '2020 – 2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });

  const r = await anotarSinConfirmar(api, c,
    { periodo: '2021 – 2023', fecha_inicio: '2021-01-01', fecha_termino: '2023-12-31' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa');
  assert.match(r.json.error, /se pisa con éste/);
  assert.match(r.json.error, /no se podr[áa] decir cu[áa]l dirig[íi]a/,
    'el aviso tiene que decir qué se pierde en el histórico, no solo en el hoy');
});

test('y las que se dan la mano no se pisan', async () => {
  /*
   * Un período que termina el 31-12 y el siguiente que empieza el 01-01 es lo
   * normal, y no puede preguntar nada: si preguntara, preguntaría en cada
   * directiva que se anota.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  await anotar(api, c, { periodo: '2020 – 2021', fecha_inicio: '2020-01-01', fecha_termino: '2021-12-31' });

  const r = await anotarSinConfirmar(api, c,
    { periodo: '2022 – 2023', fecha_inicio: '2022-01-01', fecha_termino: '2023-12-31' });
  assert.equal(r.estado, 201);
});

// --------------------------------------------------- el duplicado exacto ----

test('la misma elección anotada dos veces se dice distinto', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  await anotar(api, c, { periodo: '2020 – 2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });

  const r = await anotarSinConfirmar(api, c,
    { periodo: '2020 – 2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /exactamente el mismo período/,
    'no es un traslape: es la misma elección dos veces');
  assert.match(r.json.error, /corrija la que ya está en vez de anotar otra/,
    'y lo que hay que hacer es otro');
  assert.doesNotMatch(r.json.error, /p[óo]ngale de fecha de término/,
    'proponer una fecha acá daría un período de menos de un día');
});

test('con las mismas fechas y el período escrito de otra manera, también', async () => {
  /*
   * Lo que hace que dos directivas sean la misma son sus FECHAS, no cómo se
   * escribió el período: «2020 – 2022» y «Bienio 2020-2022» son el mismo tiempo.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  await anotar(api, c, { periodo: '2020 – 2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });

  const r = await anotarSinConfirmar(api, c,
    { periodo: 'Bienio 2020-2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });
  assert.match(r.json.error, /exactamente el mismo período/);
});

test('dos sin fecha de término, con el mismo inicio, también son la misma', () => {
  assert.equal(enEjercicio.elMismoPeriodo(
    { fecha_inicio: '2015-01-01', fecha_termino: null },
    { fecha_inicio: '2015-01-01', fecha_termino: null }), true);
  assert.equal(enEjercicio.elMismoPeriodo(
    { fecha_inicio: '2015-01-01', fecha_termino: null },
    { fecha_inicio: '2015-01-01', fecha_termino: '2016-12-31' }), false,
    'una abierta y una cerrada el mismo día no cubren lo mismo');
  assert.equal(enEjercicio.elMismoPeriodo(
    { fecha_inicio: null, fecha_termino: null }, { fecha_inicio: null, fecha_termino: null }), false,
    'sin fecha de inicio no hay período que comparar');
});

test('contestada la pregunta entra, porque una elección anulada y repetida existe', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  await anotar(api, c, { periodo: '2020 – 2022', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });
  const r = await anotar(api, c,
    { periodo: '2020 – 2022 (repetida)', fecha_inicio: '2020-01-01', fecha_termino: '2022-12-31' });
  assert.equal(r.estado, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM directivas WHERE cuerpo_id = ?').get(c.id).n, 2);
});

// ------------------------------------------- un período que diga algo ----

test('el período no se puede guardar en blanco', async () => {
  /*
   * Es obligatorio desde siempre, pero la comprobación miraba `=== ''` y unos
   * espacios pasaban: el histórico quedaba con una fila sin nombre. No es de
   * este módulo —vale para todos los campos obligatorios de texto del sistema—
   * y por eso se arregló en el motor.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const r = await anotar(api, c,
    { periodo: '   ', fecha_inicio: '2013-01-01', fecha_termino: '2013-12-31' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /"Período" es obligatorio/);
});

test('y ningún campo obligatorio del sistema se llena con espacios', async () => {
  /*
   * Se comprueba sobre otro módulo cualquiera, para que quede claro que el
   * arreglo es del motor y no de las directivas.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/iglesias', { nombre: '   ', codigo: `ESP${marca()}`, estado: 'Activa' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /obligatorio/);
});

test('pero un período escrito a mano sigue siendo libre', async () => {
  /*
   * «2026 – 2027», «2026-2027» y «Bienio 2026» son todas maneras razonables de
   * escribirlo, y quien lo escribe sabe lo que hace. Lo que identifica una
   * directiva son sus fechas; el período es cómo la llama la gente.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const r = await anotar(api, c,
    { periodo: 'Bienio de la reconstrucción', fecha_inicio: '2014-01-01', fecha_termino: '2015-12-31' });
  assert.equal(r.estado, 201);
});

test('el panel no deja un hueco donde iba el período', () => {
  /*
   * Las que ya están guardadas en blanco de antes se siguen viendo: el arreglo
   * de más arriba impide escribir otras, no reescribe las que hay.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderDirectivasCuerpo(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /esc\(d\.periodo \|\| 'Sin período escrito'\)/);
});

// ------------------------------------------------- lo que no cambió ----

test('el período sigue siendo obligatorio y de texto libre', () => {
  const campo = (getModule('directivas').fields || []).find((f) => f.name === 'periodo');
  assert.equal(campo.required, true);
  assert.equal(campo.type, 'text');
  assert.ok(!campo.options, 'no se le inventa una lista de períodos: cada organización los nombra como quiere');
});

test('la pregunta del traslape sigue mirando las que están en carrera', async () => {
  /*
   * Ampliar el alcance al histórico no puede haber apagado lo que la 1.257.0
   * atajaba: la electa que se pisa con la que gobierna.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const hoy = require('../../server/fechas').hoy();
  const anios = (cuantos) => {
    const d = new Date(`${hoy}T12:00:00`);
    d.setFullYear(d.getFullYear() + cuantos);
    return d.toISOString().slice(0, 10);
  };
  await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la de hoy', fecha_inicio: anios(-1), fecha_termino: anios(2),
    estado: 'Vigente', primer_jefe_id: c.jefe, igual_asi: true,
  });
  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la electa', fecha_inicio: anios(1), fecha_termino: anios(3),
    estado: 'Vigente', primer_jefe_id: c.jefe,
  });
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa');
  assert.match(r.json.error, /p[óo]ngale de fecha de término el/,
    'y ahí sí se propone la fecha, porque hay una que corregir');
});
