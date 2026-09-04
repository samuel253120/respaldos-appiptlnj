/**
 * Pasarle lista a una actividad que todavía no ocurre se pregunta.
 *
 * Que una actividad se pueda PROGRAMAR con fecha adelante está bien y es a
 * propósito: el campo lo declara así, y la agenda del año se arma en enero.
 * Pasarle lista es otra cosa. Medido en la v1.379.0 sobre una actividad a
 * setenta y dos días: 200, «guardadas: 2», sin una palabra, y la marca entró al
 * informe como cualquier otra.
 *
 * Es una pregunta y no un rechazo, porque adelantar una justificación que ya
 * avisaron es legítimo —«no puedo ir el domingo, estoy de viaje» se anota
 * cuando se sabe, no cuando pasa—. Lo que no puede es entrar sin que nadie lo
 * mire.
 *
 * Y va DESPUÉS de todo lo que se rechaza: confirmar algo que después se va a
 * rechazar igual es hacer contestar dos veces.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const { hoy } = require('../../server/fechas');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central FU ${marca}`, `FU-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas FU ${marca}`, iglesia).lastInsertRowid;

const numero = `${27000000 + (marca * 23) % 900000}`;
const persona = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run('Persona', `FU ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
   VALUES (?,?,'Miembro','Activo','2020-01-01',?)`
).run(cuerpo, persona, iglesia);
const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;

/** Una fecha corrida tantos días desde hoy, en la zona del sistema. */
function aDiasDeHoy(dias) {
  const [a, m, d] = hoy().split('-').map(Number);
  const cuando = new Date(a, m - 1, d + dias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${cuando.getFullYear()}-${dos(cuando.getMonth() + 1)}-${dos(cuando.getDate())}`;
}

/** Una actividad de este cuerpo ese día, puesta derecho en la base. */
const actividadDel = (fecha, nombre) => db.prepare(
  `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos) VALUES (?,?,?,?,?)`
).run(fecha, TIPO, `${nombre} FU ${marca}`, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

const laMarca = (estado = 'Presente', extra = {}) => ({
  marcas: [{ miembro_id: persona, no_miembro_id: null, cuerpo_id: cuerpo, estado, ...extra }],
});
const cuantasMarcas = (id) =>
  db.prepare('SELECT COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ?').get(id).n;

const laDeManana = actividadDel(aDiasDeHoy(30), 'La que viene');
const laDeHoy = actividadDel(hoy(), 'La de hoy');
const laDeAyer = actividadDel(aDiasDeHoy(-7), 'La de la semana pasada');

// ------------------------------------------------------------ la pregunta ---

test('pasarle lista a una actividad que no ha llegado pregunta antes', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', `/asistencias/${laDeManana}/lista`, laMarca());
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, 'lista_de_actividad_futura', 'la pantalla ofrece los dos botones');
  assert.match(r.json.error, /que todavía no llega/);
  assert.match(r.json.error, /el informe la cuenta igual que las demás/, 'y dice qué cuesta');
});

test('y preguntar no guarda nada', () => {
  assert.equal(cuantasMarcas(laDeManana), 0);
});

test('confirmando se guarda: adelantar una justificación avisada es legítimo', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', `/asistencias/${laDeManana}/lista?igual_asi=true`, laMarca());
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(cuantasMarcas(laDeManana), 1);
});

test('y se puede confirmar por el cuerpo de la petición, no solo por la dirección', async () => {
  const api = await elSistemaAndando();
  const otra = actividadDel(aDiasDeHoy(45), 'Otra que viene');
  const r = await api('POST', `/asistencias/${otra}/lista`, { ...laMarca(), igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(cuantasMarcas(otra), 1);
});

// ------------------------------------------------------- cuándo no pregunta -

test('la de HOY no pregunta nada: es la lista de siempre', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', `/asistencias/${laDeHoy}/lista`, laMarca());
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(cuantasMarcas(laDeHoy), 1);
});

test('ni una de la semana pasada, que es lo corriente', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', `/asistencias/${laDeAyer}/lista`, laMarca('Ausente'));
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(cuantasMarcas(laDeAyer), 1);
});

// ------------------------------------ la pregunta va después de lo que niega

test('un estado inventado se rechaza antes de preguntar por la fecha', async () => {
  const api = await elSistemaAndando();
  const otra = actividadDel(aDiasDeHoy(60), 'Con un estado que no existe');
  const r = await api('POST', `/asistencias/${otra}/lista`, laMarca('Estuvo un rato'));
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /Estado no válido/);
  assert.equal(r.json.confirmar, undefined, 'no se hace confirmar algo que se va a rechazar igual');
  assert.equal(cuantasMarcas(otra), 0);
});

test('y a quien no está convocado tampoco se le marca por adelantado', async () => {
  const api = await elSistemaAndando();
  const otra = actividadDel(aDiasDeHoy(60), 'Con alguien de otro lado');
  const r = await api('POST', `/asistencias/${otra}/lista`, {
    marcas: [{ miembro_id: persona, no_miembro_id: null, cuerpo_id: 999999, estado: 'Presente' }],
  });
  assert.equal(r.estado, 403, r.texto.slice(0, 200));
  assert.equal(r.json.confirmar, undefined);
  assert.equal(cuantasMarcas(otra), 0);
});

// ---------------------------------------------------- lo que dice la pantalla

test('la lista se abre diciendo que la actividad todavía no ocurre', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', `/asistencias/${laDeManana}/lista`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(r.json.actividad.futura, true, 'para avisar ANTES de marcar');
});

test('y la de hoy se abre como cualquier otra', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', `/asistencias/${laDeHoy}/lista`);
  assert.equal(r.json.actividad.futura, false);
});

test('el «hoy» lo pone el servidor, no el reloj del teléfono', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../server/modules/asistencias.js'), 'utf8');
  /*
   * Con `toISOString()` —que devuelve siempre la hora universal— en Chile,
   * entre las 20:00 y la medianoche, la reunión de esta noche sería «del día
   * siguiente» y la pantalla pediría confirmar la lista de un culto que se está
   * pasando en ese momento. `hoy()` mira la zona configurada.
   */
  assert.ok(app.includes("require('../fechas').hoy()"), 'el GET pregunta la fecha con hoy()');
  assert.ok(
    !/futura[\s\S]{0,200}toISOString/.test(app),
    'y no con toISOString(), que no mira la zona horaria de la iglesia'
  );
});

test('la pantalla avisa y pide decirlo una sola vez, porque se guarda sola', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.ok(app.includes('datos.actividad.futura'), 'el aviso sale de lo que dice el servidor');
  assert.ok(app.includes('id="plFuturaOk"'), 'con su botón para contestar');
  assert.ok(
    app.includes('vaIgualAunqueSeaFutura ? \'?igual_asi=true\' : \'\''),
    'y desde ahí todos los guardados la llevan: esta pantalla se guarda sola cada tres segundos'
  );
});
