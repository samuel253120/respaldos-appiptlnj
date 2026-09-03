/**
 * LA LISTA DE APARATOS ERA UN LUGAR DONDE CUALQUIERA ESCRIBÍA ADÓNDE IR.
 *
 * Para recibir avisos en el teléfono, el navegador manda una «suscripción»: una
 * dirección que le dio el servicio de avisos de ese navegador. El servidor la
 * guardaba tal cual, sin mirarla, y después le escribe ahí todos los días.
 *
 * MEDIDO en la v1.335.0, con una cuenta de rol «consulta» —el más bajo que
 * existe— contra el sistema andando: enganchando direcciones de la propia
 * máquina y pidiendo el aviso de prueba, la respuesta distinguía un puerto
 * abierto de uno cerrado en 5 a 8 milésimas de segundo, y decía cuál era cuál
 * en el texto del error que devolvía la ruta.
 *
 *   127.0.0.1:4399 →  8 ms · abierto      127.0.0.1:4397 → 5 ms · cerrado
 *   127.0.0.1:4315 →  6 ms · abierto      127.0.0.1:22   → 6 ms · cerrado
 *
 * Y no había tope por ninguna punta: 500 aparatos enganchados a una cuenta en
 * 1,4 s, y 40 avisos de prueba pedidos en 0,2 s sin que nada frenara. Como
 * `empujar()` le manda a todos los aparatos a la vez, un solo aviso con 300
 * aparatos dejó la campanita del resto de la gente en 429 ms, contra 2 ms de
 * mediana en calma.
 *
 * Lo que cuida este archivo:
 *   · que la dirección tenga que ser https y de afuera
 *   · que una cuenta no pueda acumular aparatos sin fin
 *   · y que al llegar al tope no se le cierre la puerta a nadie: se suelta el
 *     que lleva más tiempo sin usarse
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const navegador = require('../../server/avisos/navegador');

let cuantosRut = 60000000;
const unUsuario = () =>
  db.prepare("INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES ('Quien Engancha', ?, 'consulta', 1, 'x')")
    .run(`${cuantosRut++}-0`).lastInsertRowid;

/** Llaves como las que da cualquier navegador. */
function llaves() {
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  return { p256dh: ec.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

const MARCA = `d${process.pid}`;
const enganchar = (usuarioId, donde) => navegador.suscribir(usuarioId, { endpoint: donde, keys: llaves() }, 'La prueba');

/* ------------------------------------------------- lo que no puede entrar */

test('la dirección de esta misma máquina no se guarda', () => {
  const quien = unUsuario();
  for (const donde of [
    'https://127.0.0.1:4399/interno',
    'https://127.0.0.1/x',
    'https://localhost:8080/x',
    'https://el-servidor.localhost/x',
    'https://impresora.local/x',
    'https://[::1]:9000/x',
  ]) {
    assert.equal(enganchar(quien, donde), null, `no puede aceptarse: ${donde}`);
  }
  assert.equal(navegador.cuantosAparatos(quien), 0, 'y no quedó ninguna guardada');
});

test('ni la de una red privada, que es donde vive lo de la oficina', () => {
  const quien = unUsuario();
  for (const donde of [
    'https://10.0.0.5/x',            // la red privada grande
    'https://172.16.4.1/x',          // la mediana
    'https://172.31.255.254/x',      // el otro extremo de la mediana
    'https://192.168.1.1/x',         // el router de siempre
    'https://169.254.169.254/x',     // la que usan los servidores en la nube para sus secretos
    'https://100.64.0.1/x',          // la del proveedor
    'https://[fd00::1]/x',           // privada en IPv6
    'https://[fe80::1]/x',           // del enlace, en IPv6
    'https://[::ffff:127.0.0.1]/x',  // una IPv4 disfrazada de IPv6
  ]) {
    assert.equal(enganchar(quien, donde), null, `no puede aceptarse: ${donde}`);
  }
  assert.equal(navegador.cuantosAparatos(quien), 0);
});

test('ni una que no vaya cifrada, ni una que no sea una dirección', () => {
  const quien = unUsuario();
  for (const donde of [
    'http://push.example.com/x',     // sin cifrar
    'file:///etc/passwd',
    'ftp://push.example.com/x',
    'no soy una dirección',
    '',
    `https://push.example.com/${'x'.repeat(3000)}`,   // más larga de lo que cabe
  ]) {
    assert.equal(enganchar(quien, donde), null, `no puede aceptarse: ${donde}`);
  }
  assert.equal(navegador.cuantosAparatos(quien), 0);
});

test('y sin llaves tampoco, que eso ya estaba', () => {
  const quien = unUsuario();
  assert.equal(navegador.suscribir(quien, { endpoint: 'https://push.example.com/a' }, 'sin llaves'), null);
  assert.equal(navegador.suscribir(quien, null, 'nada'), null);
  assert.equal(navegador.cuantosAparatos(quien), 0);
});

/* ------------------------------------------------- lo que sí entra */

test('la de un servicio de avisos de verdad se guarda sin problema', () => {
  const quien = unUsuario();
  /*
   * No se comprueba contra una lista de servicios conocidos, a propósito: esa
   * lista envejece y el día que salga un navegador nuevo sus avisos dejarían de
   * funcionar sin que nadie entienda por qué. Éstas son las cuatro de hoy.
   */
  for (const donde of [
    `https://fcm.googleapis.com/fcm/send/${MARCA}-1`,
    `https://updates.push.services.mozilla.com/wpush/v2/${MARCA}-2`,
    `https://web.push.apple.com/${MARCA}-3`,
    `https://par02p.notify.windows.com/w/?token=${MARCA}-4`,
  ]) {
    assert.ok(enganchar(quien, donde), `tiene que aceptarse: ${donde}`);
  }
  assert.equal(navegador.cuantosAparatos(quien), 4);
});

test('la misma dirección dos veces sigue siendo un aparato', () => {
  const quien = unUsuario();
  const donde = `https://fcm.googleapis.com/fcm/send/${MARCA}-repetida`;
  assert.ok(enganchar(quien, donde));
  assert.ok(enganchar(quien, donde));
  assert.equal(navegador.cuantosAparatos(quien), 1);
});

/* ------------------------------------------------- el tope de aparatos */

test('una cuenta no acumula aparatos sin fin', () => {
  const quien = unUsuario();
  for (let i = 0; i < 40; i++) enganchar(quien, `https://fcm.googleapis.com/fcm/send/${MARCA}-tope-${i}`);
  assert.equal(navegador.cuantosAparatos(quien), navegador.CUANTOS_APARATOS,
    `se midieron 500 en 1,4 s; el tope son ${navegador.CUANTOS_APARATOS}`);
});

test('al llegar al tope se suelta el más viejo, y el recién puesto queda', () => {
  /*
   * Rechazar dejaría a alguien con diez suscripciones viejas sin poder
   * enganchar el teléfono que tiene en la mano, y la única salida sería
   * «apagarlos todos», que es un botón que nadie encuentra cuando lo necesita.
   */
  const quien = unUsuario();
  const primera = `https://fcm.googleapis.com/fcm/send/${MARCA}-la-primera`;
  enganchar(quien, primera);
  for (let i = 0; i < navegador.CUANTOS_APARATOS; i++) {
    enganchar(quien, `https://fcm.googleapis.com/fcm/send/${MARCA}-despues-${i}`);
  }

  const suyas = db.prepare('SELECT endpoint FROM notificacion_suscripciones WHERE usuario_id = ?').all(quien);
  assert.equal(suyas.length, navegador.CUANTOS_APARATOS);
  assert.ok(!suyas.some((s) => s.endpoint === primera), 'la más vieja se soltó');
  assert.ok(
    suyas.some((s) => s.endpoint.endsWith(`-despues-${navegador.CUANTOS_APARATOS - 1}`)),
    'y la que se acaba de enganchar quedó: es la que la persona tiene delante'
  );
});

test('el tope es por persona, no del sistema entero', () => {
  const mio = unUsuario();
  const ajeno = unUsuario();
  for (let i = 0; i < 30; i++) enganchar(mio, `https://fcm.googleapis.com/fcm/send/${MARCA}-mio-${i}`);
  enganchar(ajeno, `https://fcm.googleapis.com/fcm/send/${MARCA}-ajeno`);
  assert.equal(navegador.cuantosAparatos(mio), navegador.CUANTOS_APARATOS);
  assert.equal(navegador.cuantosAparatos(ajeno), 1, 'a nadie le sueltan un aparato por lo que hace otro');
});

/* ------------------------------------------------- la comprobación, a solas */

test('sirveComoDireccion se exporta, para que la ruta pueda explicar el rechazo', () => {
  assert.equal(typeof navegador.sirveComoDireccion, 'function');
  assert.equal(navegador.sirveComoDireccion('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(navegador.sirveComoDireccion('https://127.0.0.1/abc'), false);
});
