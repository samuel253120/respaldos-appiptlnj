/**
 * Los avisos: a quién le llegan, cuáles y cuántas veces.
 *
 * Hay tres formas de que un sistema de avisos se vuelva inútil, y las tres se
 * prueban acá porque ninguna hace ruido cuando pasa:
 *
 *   · QUE REPITA. El vigía se asoma todos los días. Sin la clave que dice de
 *     qué es cada aviso, la misma credencial avisaría cada mañana hasta
 *     vencer, y en una semana nadie mira la campanita.
 *
 *   · QUE AVISE DE MÁS. Si por omisión sonara el teléfono con todo, la primera
 *     reacción de cualquiera sería apagarlos, y entonces tampoco se entera de
 *     lo que sí importaba.
 *
 *   · QUE SE LE ESCAPE A QUIEN NO ES. Los avisos son de una persona. Que el
 *     aviso de un traslado le llegue a otro no es una molestia: es contarle a
 *     alguien algo que no le tocaba saber.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const avisos = require('../../server/avisos/avisos');

let cuantosRut = 50000000;
function unUsuario(nombre, rol = 'secretario', activo = 1) {
  return db
    .prepare(`INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, ?, ?, 'x')`)
    .run(nombre, `${cuantosRut++}-0`, rol, activo).lastInsertRowid;
}
const suyos = (id) => db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY id').all(id);

const ana = unUsuario('Ana');
const luis = unUsuario('Luis', 'tesorero');
const jefe = unUsuario('La Administradora', 'admin');

// ------------------------------------------------------- de quién es cada uno

test('un aviso es de una persona, y de nadie más', () => {
  avisos.crear({ usuario_id: ana, tipo: 'solicitud_asignada', titulo: 'Para Ana' });
  assert.equal(suyos(ana).length, 1);
  assert.equal(suyos(luis).length, 0, 'a Luis no le llegó nada');
});

test('a un usuario desactivado no se le deja nada', () => {
  const ida = unUsuario('Se Fue', 'secretario', 0);
  assert.equal(avisos.crear({ usuario_id: ida, tipo: 'solicitud_asignada', titulo: 'x' }), null);
  assert.equal(suyos(ida).length, 0);
});

test('a un usuario que no existe tampoco, y sin reventar', () => {
  assert.equal(avisos.crear({ usuario_id: 999999, tipo: 'solicitud_asignada', titulo: 'x' }), null);
});

// --------------------------------------------------------------- que repita --

test('el mismo asunto no avisa dos veces mientras siga sin leerse', () => {
  const antes = suyos(ana).length;
  for (let i = 0; i < 5; i++) {
    avisos.crear({ usuario_id: ana, tipo: 'credencial_por_vencer', clave: 'credencial_vence:7', titulo: `Intento ${i}` });
  }
  assert.equal(suyos(ana).length, antes + 1, 'cinco intentos, un aviso');
});

test('pero una vez leído, sí puede volver a avisar', () => {
  const suyo = db.prepare("SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = 'credencial_vence:7'").get(ana);
  avisos.marcarLeida(ana, suyo.id);
  const antes = suyos(ana).length;
  avisos.crear({ usuario_id: ana, tipo: 'credencial_por_vencer', clave: 'credencial_vence:7', titulo: 'El mes siguiente' });
  assert.equal(suyos(ana).length, antes + 1, 'lo que sigue siendo verdad se puede recordar');
});

test('dos asuntos distintos son dos avisos', () => {
  const antes = suyos(ana).length;
  avisos.crear({ usuario_id: ana, tipo: 'credencial_por_vencer', clave: 'credencial_vence:8', titulo: 'Otra credencial' });
  avisos.crear({ usuario_id: ana, tipo: 'credencial_por_vencer', clave: 'credencial_vence:9', titulo: 'Y otra' });
  assert.equal(suyos(ana).length, antes + 2);
});

test('un aviso sin clave no se agrupa con nada', () => {
  const antes = suyos(luis).length;
  avisos.crear({ usuario_id: luis, tipo: 'solicitud_asignada', titulo: 'Uno' });
  avisos.crear({ usuario_id: luis, tipo: 'solicitud_asignada', titulo: 'Uno' });
  assert.equal(suyos(luis).length, antes + 2, 'sin clave, cada uno es un hecho distinto');
});

// --------------------------------------------------------- lo que trae puesto

test('de fábrica llegan todos al sistema', () => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ana);
  const p = avisos.preferenciasDe(u);
  for (const tipo of Object.keys(avisos.TIPOS)) assert.equal(p[tipo].sistema, true, tipo);
});

test('y al teléfono solo lo urgente', () => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ana);
  const p = avisos.preferenciasDe(u);
  assert.equal(p.solicitud_asignada.navegador, true, 'un traslado interrumpe');
  assert.equal(p.cumpleanos_hoy.navegador, false, 'un cumpleaños no');
  assert.equal(p.credencial_por_vencer.navegador, false);
  assert.equal(p.cuotas_atrasadas.navegador, false);
});

test('lo que la persona elija manda sobre lo de fábrica', () => {
  db.prepare('UPDATE usuarios SET avisos = ? WHERE id = ?')
    .run(JSON.stringify({ cumpleanos_hoy: { sistema: true, navegador: true }, solicitud_asignada: { sistema: false, navegador: false } }), ana);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ana);
  const p = avisos.preferenciasDe(u);
  assert.equal(p.cumpleanos_hoy.navegador, true, 'lo encendió');
  assert.equal(p.solicitud_asignada.sistema, false, 'lo apagó');
  assert.equal(p.credencial_por_vencer.sistema, true, 'y lo que no tocó sigue como venía');
});

test('un tipo apagado ya no genera aviso', () => {
  const antes = suyos(ana).length;
  assert.equal(avisos.crear({ usuario_id: ana, tipo: 'solicitud_asignada', titulo: 'No debería entrar' }), null);
  assert.equal(suyos(ana).length, antes);
});

test('unas preferencias estropeadas no dejan a nadie sin avisos', () => {
  db.prepare('UPDATE usuarios SET avisos = ? WHERE id = ?').run('{esto no es JSON', luis);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(luis);
  const p = avisos.preferenciasDe(u);
  assert.equal(p.solicitud_asignada.sistema, true, 'se vuelve a lo de fábrica en vez de romperse');
});

// ------------------------------------------------- los que son del que manda

test('los avisos del administrador no le llegan a los demás', () => {
  assert.equal(avisos.quiere(db.prepare('SELECT * FROM usuarios WHERE id=?').get(luis), 'respaldo_atrasado', 'sistema'), false);
  assert.equal(avisos.quiere(db.prepare('SELECT * FROM usuarios WHERE id=?').get(jefe), 'respaldo_atrasado', 'sistema'), true);
  assert.equal(avisos.crear({ usuario_id: luis, tipo: 'respaldo_atrasado', titulo: 'Baje el respaldo' }), null);
  assert.ok(avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', titulo: 'Baje el respaldo' }));
});

test('un tipo que no existe no crea nada', () => {
  assert.equal(avisos.crear({ usuario_id: jefe, tipo: 'inventado', titulo: 'x' }), null);
});

// ----------------------------------------------------------- leer y limpiar --

test('la campanita cuenta solo lo no leído', () => {
  const antes = avisos.paraLaCampanita(jefe).sinLeer;
  avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', clave: 'otro', titulo: 'Otro más' });
  assert.equal(avisos.paraLaCampanita(jefe).sinLeer, antes + 1);
  avisos.marcarTodasLeidas(jefe);
  assert.equal(avisos.paraLaCampanita(jefe).sinLeer, 0);
});

test('nadie marca como leído el aviso de otro', () => {
  const suyo = avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', clave: 'zzz', titulo: 'Del jefe' });
  assert.equal(avisos.marcarLeida(luis, suyo.id), 0, 'Luis no puede tocarlo');
  assert.equal(db.prepare('SELECT leida FROM notificaciones WHERE id = ?').get(suyo.id).leida, 0);
  assert.equal(avisos.marcarLeida(jefe, suyo.id), 1, 'su dueño sí');
});

test('los leídos hace mucho se borran; los no leídos no se tocan', () => {
  const viejo = avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', clave: 'viejo', titulo: 'De hace mucho' });
  db.prepare("UPDATE notificaciones SET leida = 1, leida_en = date('now','localtime','-200 days') WHERE id = ?").run(viejo.id);
  const sinLeer = avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', clave: 'nuevo', titulo: 'De ahora' });
  avisos.limpiarLosViejos(90);
  assert.equal(db.prepare('SELECT id FROM notificaciones WHERE id = ?').get(viejo.id), undefined);
  assert.ok(db.prepare('SELECT id FROM notificaciones WHERE id = ?').get(sinLeer.id), 'el que no se leyó sigue ahí');
});

test('un aviso leído RECIÉN no se borra', () => {
  const hoy = avisos.crear({ usuario_id: jefe, tipo: 'respaldo_atrasado', clave: 'de-hoy', titulo: 'Leído hoy' });
  avisos.marcarLeida(jefe, hoy.id);
  avisos.limpiarLosViejos(90);
  assert.ok(db.prepare('SELECT id FROM notificaciones WHERE id = ?').get(hoy.id));
});
