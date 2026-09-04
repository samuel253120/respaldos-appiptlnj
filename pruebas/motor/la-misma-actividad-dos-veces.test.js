/**
 * La misma actividad, el mismo día y para el mismo cuerpo, se pregunta.
 *
 * El módulo ya pensaba lo contrario en su otra mitad: la ruta que repite una
 * actividad se salta los días que ya la tienen, y lo dice con todas sus letras
 * —«una lista duplicada es peor que no tenerla: la gente marca en una y el
 * informe cuenta las dos»—. El formulario no preguntaba nada. Medido en la
 * v1.377.0: la misma reunión, el mismo día y el mismo cuerpo, tres veces
 * seguidas, tres 201 y ni una palabra.
 *
 * Es una PREGUNTA y no un rechazo: un servicio en la mañana y otro en la tarde
 * son dos actividades de verdad del mismo día. Por eso la hora desempata, y por
 * eso confirmando se guarda igual.
 *
 * Y se compara UNA sola vez para los dos caminos (`lasQueYaEstaban`): dos
 * maneras de comparar habrían sido dos verdades. De paso, la comparación dejó
 * de mirar el JSON de los cuerpos letra por letra —«[3,10]» y «[10,3]» son la
 * misma convocatoria— y mira si comparten alguno, que es de quien se duplica
 * la lista.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central MA ${marca}`, `MA-${marca}`).lastInsertRowid;
const nuevoCuerpo = (comoSeLlama) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`${comoSeLlama} MA ${marca}`, iglesia).lastInsertRowid;
const cuerpo = nuevoCuerpo('Damas');
const otroCuerpo = nuevoCuerpo('Coro');
const terceroCuerpo = nuevoCuerpo('Jóvenes');

// Una persona, para que la actividad tenga a quién convocar
const numero = `${23000000 + (marca * 17) % 900000}`;
const persona = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run('Persona', `MA ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
   VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
).run(cuerpo, persona, iglesia);

const TIPOS = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 2').all();
const TIPO = TIPOS[0].nombre;
const OTRO_TIPO = TIPOS[1].nombre;

/** Crea una actividad y devuelve la respuesta entera. */
const crear = (api, datos, confirmando) =>
  api('POST', `/asistencias${confirmando ? '?igual_asi=true' : ''}`,
    confirmando ? { ...datos, igual_asi: true } : datos);

// ----------------------------------------------------------- la pregunta ----

test('la primera se crea sin decir nada', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, {
    fecha: '2026-05-03', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Culto MA ${marca}`,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('la segunda igual pregunta, y nombra la que ya está', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, {
    fecha: '2026-05-03', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Culto repetido MA ${marca}`,
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, 'actividad_repetida', 'la pantalla ofrece los dos botones');
  assert.match(r.json.error, new RegExp(`Culto MA ${marca}`), 'dice cómo se llama la que ya está');
  assert.match(r.json.error, /el 03-05-2026/, 'y de qué día es');
  assert.match(r.json.error, /Damas MA/, 'y con qué cuerpo');
  assert.match(r.json.error, /todavía sin lista/, 'y si ya tiene lista');
  assert.match(r.json.error, /el informe cuenta las dos/, 'y por qué importa');
});

test('la pregunta trae adónde ir, que es lo que hace que se conteste', async () => {
  const api = await elSistemaAndando();
  const yaEsta = db.prepare('SELECT id FROM asistencias WHERE nombre = ?').get(`Culto MA ${marca}`);
  const r = await crear(api, { fecha: '2026-05-03', cuerpos: [cuerpo], tipo_reunion: TIPO });
  assert.deepEqual(r.json.ir, {
    texto: '📋 Abrir la que ya existe',
    a: `#/m/asistencias/ficha/${yaEsta.id}`,
  });
});

test('preguntar no guarda nada', () => {
  const cuantas = db
    .prepare("SELECT COUNT(*) AS n FROM asistencias WHERE fecha = '2026-05-03' AND nombre LIKE ?")
    .get(`%MA ${marca}%`).n;
  assert.equal(cuantas, 1, 'la repetida no entró');
});

test('confirmando se guarda: dos reuniones el mismo día existen', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, {
    fecha: '2026-05-03', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Culto de la tarde MA ${marca}`,
  }, true);
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

// ------------------------------------------------- cuándo NO es la misma ----

test('otro día no es la misma', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, { fecha: '2026-05-10', cuerpos: [cuerpo], tipo_reunion: TIPO });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('otro tipo de actividad tampoco', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, { fecha: '2026-05-10', cuerpos: [cuerpo], tipo_reunion: OTRO_TIPO });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('ni otro cuerpo, si no comparten ninguno', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, { fecha: '2026-05-10', cuerpos: [otroCuerpo], tipo_reunion: TIPO });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('pero basta con que compartan UNO: de ese se duplica la lista', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, {
    fecha: '2026-05-10', cuerpos: [otroCuerpo, terceroCuerpo, cuerpo], tipo_reunion: TIPO,
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, 'actividad_repetida');
});

// ------------------------------------------------------ la hora desempata ---

test('con horas distintas no se pregunta nada: son la mañana y la tarde', async () => {
  const api = await elSistemaAndando();
  const manana = await crear(api, {
    fecha: '2026-05-17', cuerpos: [cuerpo], tipo_reunion: TIPO, hora_inicio: '10:00',
  });
  assert.equal(manana.estado, 201, manana.texto.slice(0, 200));
  const tarde = await crear(api, {
    fecha: '2026-05-17', cuerpos: [cuerpo], tipo_reunion: TIPO, hora_inicio: '19:00',
  });
  assert.equal(tarde.estado, 201, tarde.texto.slice(0, 200));
});

test('con la misma hora sí', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, {
    fecha: '2026-05-17', cuerpos: [cuerpo], tipo_reunion: TIPO, hora_inicio: '19:00',
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /a las 19:00/, 'y la nombra por su hora');
});

test('y si a una le falta la hora, no se sabe: se pregunta', async () => {
  const api = await elSistemaAndando();
  const r = await crear(api, { fecha: '2026-05-17', cuerpos: [cuerpo], tipo_reunion: TIPO });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, 'actividad_repetida');
});

// -------------------------------------------------------- también al editar -

test('mover una actividad al día en que ya está la misma pregunta igual', async () => {
  const api = await elSistemaAndando();
  const sola = (await crear(api, {
    fecha: '2026-05-24', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Se mueve MA ${marca}`,
  })).json;
  assert.ok(sola.id, 'la de partida se creó');

  const r = await api('PUT', `/asistencias/${sola.id}`, { fecha: '2026-05-10' });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, 'actividad_repetida');
  assert.equal(
    db.prepare('SELECT fecha FROM asistencias WHERE id = ?').get(sola.id).fecha, '2026-05-24',
    'y no se movió'
  );
});

test('editar una actividad sin moverla no la confunde consigo misma', async () => {
  const api = await elSistemaAndando();
  const sola = db.prepare('SELECT * FROM asistencias WHERE nombre = ?').get(`Se mueve MA ${marca}`);
  const r = await api('PUT', `/asistencias/${sola.id}`, { lugar: 'Salón grande' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(db.prepare('SELECT lugar FROM asistencias WHERE id = ?').get(sola.id).lugar, 'Salón grande');
});

// ------------------------------------- una sola verdad para los dos caminos -

test('repetir usa la MISMA pregunta, y por eso se salta el día que ya la tiene', async () => {
  const api = await elSistemaAndando();
  const base = (await crear(api, {
    fecha: '2026-03-01', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Semanal MA ${marca}`,
  })).json;
  assert.ok(base.id);

  const primera = await api('POST', `/asistencias/${base.id}/repetir`, { regla: 'semanal', hasta: '2026-03-29' });
  assert.equal(primera.estado, 200, primera.texto.slice(0, 200));
  assert.equal(primera.json.creadas, 4);
  assert.equal(primera.json.ya_estaban, 0);

  const otraVez = await api('POST', `/asistencias/${base.id}/repetir`, { regla: 'semanal', hasta: '2026-03-29' });
  assert.equal(otraVez.json.creadas, 0, 'ninguna se duplica');
  assert.equal(otraVez.json.ya_estaban, 4);
});

test('y se salta también el día donde la que está convoca los cuerpos al revés', async () => {
  const api = await elSistemaAndando();
  // La que ya está: los mismos dos cuerpos, en el otro orden. Hasta la v1.378.0
  // se comparaba el JSON letra por letra y «[a,b]» no se parecía a «[b,a]».
  const alReves = await crear(api, {
    fecha: '2026-04-12', cuerpos: [otroCuerpo, cuerpo], tipo_reunion: TIPO, nombre: `Al revés MA ${marca}`,
  });
  assert.equal(alReves.estado, 201, alReves.texto.slice(0, 200));

  const base = (await crear(api, {
    fecha: '2026-04-05', cuerpos: [cuerpo, otroCuerpo], tipo_reunion: TIPO, nombre: `Derecha MA ${marca}`,
  })).json;
  assert.ok(base.id);
  const r = await api('POST', `/asistencias/${base.id}/repetir`, { regla: 'semanal', hasta: '2026-04-19' });
  assert.equal(r.json.ya_estaban, 1, 'el 12 ya la tenía, con los cuerpos en el otro orden');
  assert.equal(r.json.creadas, 1, 'y el 19 sí se creó');
});
