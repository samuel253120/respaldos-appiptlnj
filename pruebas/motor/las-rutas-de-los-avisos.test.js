/**
 * LAS NUEVE RUTAS DE LOS AVISOS NO TENÍAN NINGUNA PRUEBA POR HTTP.
 *
 * `avisos.js` y `navegador.js` están bien vigilados —dieciocho pruebas cada
 * uno— pero de `rutas.js` no había ni una: la campanita, las preferencias, los
 * aparatos y el aviso de prueba se llamaban solo desde el navegador. No es que
 * nadie las hubiera escrito: NO SE PODÍAN escribir, porque el sistema andando
 * de las pruebas del motor montaba solo el router del CRUD y «/api/avisos»
 * contestaba 404.
 *
 * Por ese hueco pasaron dos cosas que se encontraron a mano en la revisión del
 * subsistema: que se pudiera enganchar como aparato una dirección de la propia
 * máquina, y que el aviso de prueba se pudiera pedir cuarenta veces en dos
 * décimas de segundo.
 *
 * Lo que cuida este archivo:
 *   · que las rutas existan y estén montadas ANTES del motor
 *   · que todo lo de acá sea de UNO MISMO: nadie lee ni marca el aviso de otro
 *   · que las preferencias se guarden, y solo las que el sistema conoce
 *   · que escribir mensajes pida llave y leer los propios no
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const avisos = require('../../server/avisos/avisos');

after(cerrarElSistema);

const MARCA = `r${process.pid}`;
let cuantos = 0;
const unUsuario = (rol = 'secretario') => db
  .prepare('INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, ?, 1, ?)')
  .run(`Cuenta ${MARCA}-${++cuantos}`, `${process.pid}${cuantos}-0`, rol, 'x')
  .lastInsertRowid;

const unAviso = (usuarioId, titulo) => avisos.crear({
  usuario_id: usuarioId,
  tipo: 'solicitud_asignada',
  clave: `${MARCA}:${titulo}`,
  titulo,
  cuerpo: 'Lo que dice el aviso',
  enlace: '#/',
});

/* ------------------------------------------------- que estén montadas */

test('la campanita contesta, y no la toma el motor por un módulo', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const api = comoOtroUsuario(quien);
  const r = await api('GET', '/avisos');
  assert.equal(r.estado, 200, 'un 404 acá significa que el motor se comió la ruta');
  assert.ok(Array.isArray(r.json.ultimos));
  assert.equal(typeof r.json.sinLeer, 'number');
});

/* ------------------------------------------------- lo de uno es de uno */

test('la campanita trae lo propio y nada de lo ajeno', async () => {
  await elSistemaAndando();
  const mio = unUsuario();
  const ajeno = unUsuario();
  unAviso(mio, `Lo mío ${MARCA}`);
  unAviso(ajeno, `Lo suyo ${MARCA}`);

  const r = await comoOtroUsuario(mio)('GET', '/avisos');
  const titulos = r.json.ultimos.map((a) => a.titulo);
  assert.ok(titulos.includes(`Lo mío ${MARCA}`));
  assert.ok(!titulos.includes(`Lo suyo ${MARCA}`), 'nadie mira la campanita de otro');
});

test('el número de sin leer es el propio', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const antes = (await comoOtroUsuario(quien)('GET', '/avisos/cuantos')).json.sinLeer;
  unAviso(quien, `Uno más ${MARCA}-${cuantos}`);
  const despues = (await comoOtroUsuario(quien)('GET', '/avisos/cuantos')).json.sinLeer;
  assert.equal(despues, antes + 1);
});

test('nadie marca como leído el aviso de otro', async () => {
  await elSistemaAndando();
  const mio = unUsuario();
  const ajeno = unUsuario();
  const suyo = unAviso(mio, `Para marcar ${MARCA}-${cuantos}`);

  const r = await comoOtroUsuario(ajeno)('POST', `/avisos/${suyo.id}/leido`);
  assert.equal(r.estado, 200, 'contesta que sí, y no hace nada: no se le dice a nadie qué avisos tiene otro');
  assert.equal(db.prepare('SELECT leida FROM notificaciones WHERE id = ?').get(suyo.id).leida, 0,
    'el aviso ajeno tiene que seguir sin leer');
});

test('marcar el propio sí lo marca', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const suyo = unAviso(quien, `Para marcar bien ${MARCA}-${cuantos}`);
  await comoOtroUsuario(quien)('POST', `/avisos/${suyo.id}/leido`);
  assert.equal(db.prepare('SELECT leida FROM notificaciones WHERE id = ?').get(suyo.id).leida, 1);
});

test('«marcar todos» marca los de uno y deja quietos los de los demás', async () => {
  await elSistemaAndando();
  const mio = unUsuario();
  const ajeno = unUsuario();
  unAviso(mio, `Mío A ${MARCA}-${cuantos}`);
  unAviso(mio, `Mío B ${MARCA}-${cuantos}`);
  const delOtro = unAviso(ajeno, `Del otro ${MARCA}-${cuantos}`);

  const r = await comoOtroUsuario(mio)('POST', '/avisos/leidos');
  assert.equal(r.estado, 200);
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(mio).c, 0);
  assert.equal(db.prepare('SELECT leida FROM notificaciones WHERE id = ?').get(delOtro.id).leida, 0);
});

/* ------------------------------------------------- las preferencias */

test('las preferencias se leen con lo que hace falta para encenderlas', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const r = await comoOtroUsuario(quien)('GET', '/avisos/preferencias');
  assert.equal(r.estado, 200);
  assert.ok(Array.isArray(r.json.tipos) && r.json.tipos.length);
  assert.ok(r.json.canales.sistema && r.json.canales.navegador);
  assert.ok(r.json.llavePublica, 'sin la llave pública el navegador no puede suscribirse');
  assert.equal(r.json.aparatos, 0);
});

test('el tipo que no se puede apagar viene marcado, para no ofrecer una casilla que no obedece', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const r = await comoOtroUsuario(quien)('GET', '/avisos/preferencias');
  const mensaje = r.json.tipos.find((t) => t.clave === 'mensaje');
  assert.ok(mensaje);
  assert.equal(mensaje.siempre, true);
});

test('se guarda lo que se elige, y solo lo que el sistema conoce', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const api = comoOtroUsuario(quien);
  const r = await api('PUT', '/avisos/preferencias', {
    preferencias: {
      cumpleanos_hoy: { sistema: false, navegador: false },
      un_tipo_inventado: { sistema: true, navegador: true },
    },
  });
  assert.equal(r.estado, 200);
  assert.equal(r.json.preferencias.cumpleanos_hoy.sistema, false, 'lo elegido manda');

  const guardadas = JSON.parse(db.prepare('SELECT avisos FROM usuarios WHERE id = ?').get(quien).avisos);
  assert.ok(!('un_tipo_inventado' in guardadas),
    'si mañana se quita un tipo, no puede quedar basura arrastrándose en cada ficha');
});

test('un tipo apagado deja de dejar avisos', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  await comoOtroUsuario(quien)('PUT', '/avisos/preferencias', {
    preferencias: { solicitud_asignada: { sistema: false, navegador: false } },
  });
  assert.equal(unAviso(quien, `Ya no quiero ${MARCA}-${cuantos}`), null);
});

/* ------------------------------------------------- los aparatos */

test('un aparato incompleto se rechaza con su motivo', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const r = await comoOtroUsuario(quien)('POST', '/avisos/aparato', { suscripcion: { endpoint: 'https://fcm.googleapis.com/x' } });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no viene completa/);
});

test('y una dirección que no es de un servicio de avisos, con el suyo', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const r = await comoOtroUsuario(quien)('POST', '/avisos/aparato', {
    suscripcion: { endpoint: 'https://127.0.0.1:9/x', keys: { p256dh: 'a', auth: 'b' } },
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /red interna|https/,
    'los dos motivos se dicen distinto porque se arreglan distinto');
});

test('apagar los aparatos de uno no toca los de nadie más', async () => {
  await elSistemaAndando();
  const mio = unUsuario();
  const ajeno = unUsuario();
  const meter = (id, donde) => db.prepare(
    "INSERT INTO notificacion_suscripciones (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, 'a', 'b')"
  ).run(id, donde);
  meter(mio, `https://fcm.googleapis.com/${MARCA}-mio`);
  meter(ajeno, `https://fcm.googleapis.com/${MARCA}-ajeno`);

  const r = await comoOtroUsuario(mio)('POST', '/avisos/aparato/apagar', { todos: true });
  assert.equal(r.estado, 200);
  assert.equal(r.json.aparatos, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM notificacion_suscripciones WHERE usuario_id = ?').get(ajeno).c, 1);
});

test('sin ningún aparato, el aviso de prueba lo dice en vez de callarse', async () => {
  await elSistemaAndando();
  const quien = unUsuario();
  const r = await comoOtroUsuario(quien)('POST', '/avisos/probar', {});
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /ningún aparato/,
    'los tres motivos se arreglan distinto: decir «no hay aparato» cuando sí lo hay manda a activar algo que ya estaba bien');
});

/* ------------------------------------------------- los mensajes piden llave */

test('leer los mensajes que le escribieron a uno no pide llave', async () => {
  await elSistemaAndando();
  const quien = unUsuario('consulta');
  const r = await comoOtroUsuario(quien)('GET', '/avisos/recibidos');
  assert.equal(r.estado, 200, 'acá no se le escribe a nadie: se lee lo propio');
});

test('pero escribirlos sí', async () => {
  await elSistemaAndando();
  const quien = unUsuario('consulta');
  const r = await comoOtroUsuario(quien)('GET', '/avisos/mensajes/destinatarios');
  assert.equal(r.estado, 403);
  assert.match(r.json.error, /permiso/);
});
