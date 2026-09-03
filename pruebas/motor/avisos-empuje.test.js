/**
 * El envío del aviso al teléfono: qué pasa cuando sale, cuando el aparato ya
 * no está, y cuando simplemente no se pudo.
 *
 * Los tres casos terminan distinto y hay que poder distinguirlos, porque a la
 * persona se le dice una cosa distinta en cada uno:
 *
 *   · SALIÓ. No hay nada que decir.
 *
 *   · EL APARATO YA NO ESTÁ (404 o 410). El servicio del navegador avisa que
 *     esa dirección murió: se borra, y a la persona se le pide que vuelva a
 *     activar. Si no se borrara, la lista de suscripciones crecería para
 *     siempre con direcciones muertas.
 *
 *   · NO SE PUDO (todo lo demás). El aparato SIGUE enganchado: el servicio
 *     está caído, no hay salida a internet, un cortafuegos. Confundir esto
 *     con «no tiene ningún aparato» manda a la persona a activar de nuevo
 *     algo que ya estaba bien, y le esconde el motivo verdadero —que es justo
 *     lo único que el botón «mandarme uno de prueba» existe para mostrar.
 *
 * Para probarlo se levanta un servicio de mentira acá mismo, que contesta lo
 * que la prueba le pida. Va por HTTPS porque web-push no habla otra cosa.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const navegador = require('../../server/avisos/navegador');

// ---------------------------------------------------- el servicio de mentira

let servicio;
let puerto;
let comoMandarlo;
let queContesta = 201;
let recibidos = [];

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-falso-'));
  const llave = path.join(dir, 'k.pem');
  const cert = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', llave, '-out', cert,
    '-days', '2', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
    { stdio: 'ignore' });

  servicio = https.createServer({ key: fs.readFileSync(llave), cert: fs.readFileSync(cert) }, (req, res) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      recibidos.push({ url: req.url, largo: Buffer.concat(trozos).length, cabeceras: req.headers });
      res.writeHead(queContesta);
      res.end();
    });
  });
  await new Promise((listo) => servicio.listen(0, '127.0.0.1', listo));
  puerto = servicio.address().port;
  // El certificado es de mentira, así que no se le exige que valga: lo que se
  // prueba es el envío, no la cadena de confianza.
  comoMandarlo = { agent: new https.Agent({ rejectUnauthorized: false }) };
});

after(() => servicio && servicio.close());

// ------------------------------------------------------------------ utilería

let cuantosRut = 70000000;
const unUsuario = () =>
  db.prepare(`INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES ('Quien Sea', ?, 'secretario', 1, 'x')`)
    .run(`${cuantosRut++}-0`).lastInsertRowid;

/**
 * Una suscripción como la que manda un navegador de verdad, escrita derecho en
 * la tabla.
 *
 * NO PASA POR `suscribir()`, y es a propósito: desde la v1.337.0 esa función
 * rechaza las direcciones que apuntan a esta misma máquina, que es justamente
 * lo que este archivo necesita —un servicio de mentira en 127.0.0.1 al que se
 * le pueda hablar de verdad—. Lo que se prueba acá es el ENVÍO: que salga, que
 * se borre el aparato muerto, que un fallo no se lleve al de al lado. Que
 * `suscribir()` mire la dirección antes de guardarla se prueba aparte, en
 * la-direccion-del-aparato-no-la-elige-cualquiera.test.js.
 */
function unAparato(usuarioId, donde) {
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  db.prepare(
    `INSERT INTO notificacion_suscripciones (usuario_id, endpoint, p256dh, auth, aparato)
     VALUES (?, ?, ?, ?, 'La prueba')
     ON CONFLICT(endpoint) DO UPDATE SET
       usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
       fallos = 0, ultimo_error = NULL`
  ).run(usuarioId, donde, ec.getPublicKey().toString('base64url'), crypto.randomBytes(16).toString('base64url'));
}

const aviso = { titulo: 'Prueba', cuerpo: 'Cuerpo del aviso', enlace: '#/', etiqueta: 'prueba' };
const suscripcionesDe = (id) =>
  db.prepare('SELECT * FROM notificacion_suscripciones WHERE usuario_id = ?').all(id);

// ------------------------------------------------------------- sin ni un aparato

test('sin aparatos no manda nada, y no es un fallo', async () => {
  const nadie = unUsuario();
  const r = await navegador.empujar(nadie, aviso, comoMandarlo);
  assert.deepEqual(r, { mandados: 0, borrados: 0, fallados: 0, porque: null });
});

// ------------------------------------------------------------------- cuando sale

test('con el servicio contestando bien, sale', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/ok`);
  queContesta = 201;
  recibidos = [];

  const r = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r.mandados, 1);
  assert.equal(r.fallados, 0);
  assert.equal(r.borrados, 0);
  assert.equal(recibidos.length, 1, 'el servicio recibió el envío');
  assert.ok(recibidos[0].largo > 0, 'y con carga adentro');
});

test('lo que viaja va cifrado: el título no se lee en el camino', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/secreto`);
  queContesta = 201;
  recibidos = [];

  await navegador.empujar(quien, { ...aviso, titulo: 'PALABRASECRETA' }, comoMandarlo);
  const crudo = JSON.stringify(recibidos);
  assert.ok(!crudo.includes('PALABRASECRETA'), 'el servicio del navegador no puede leer el aviso');
  assert.equal(recibidos[0].cabeceras['content-encoding'], 'aes128gcm');
});

test('un envío bueno deja la suscripción limpia y con la fecha de uso', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/limpia`);
  db.prepare("UPDATE notificacion_suscripciones SET fallos = 4, ultimo_error = 'lo de antes' WHERE usuario_id = ?").run(quien);
  queContesta = 201;

  await navegador.empujar(quien, aviso, comoMandarlo);
  const s = suscripcionesDe(quien)[0];
  assert.equal(s.fallos, 0, 'se le borra la cuenta de fallos');
  assert.equal(s.ultimo_error, null);
  assert.ok(s.usada_en, 'queda anotado cuándo se usó');
});

// --------------------------------------------------- cuando el aparato ya no está

for (const codigo of [404, 410]) {
  test(`con ${codigo} la suscripción se borra: ese aparato ya no existe`, async () => {
    const quien = unUsuario();
    unAparato(quien, `https://127.0.0.1:${puerto}/push/muerta-${codigo}`);
    queContesta = codigo;

    const r = await navegador.empujar(quien, aviso, comoMandarlo);
    assert.equal(r.borrados, 1);
    assert.equal(r.mandados, 0);
    assert.equal(r.fallados, 0, 'no es un fallo: es un aparato que se fue');
    assert.equal(suscripcionesDe(quien).length, 0, 'no queda arrastrándose');
  });
}

// ------------------------------------------------------------- cuando no se pudo

test('si el servicio contesta un error, el aparato NO se borra', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/caido`);
  queContesta = 500;

  const r = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r.mandados, 0);
  assert.equal(r.borrados, 0, 'un servicio caído no es una suscripción muerta');
  assert.equal(r.fallados, 1);
  assert.ok(r.porque, 'y se dice por qué');
  assert.equal(suscripcionesDe(quien).length, 1, 'el aparato sigue enganchado');
});

test('si no hay nadie escuchando, tampoco se borra, y el motivo queda anotado', async () => {
  const quien = unUsuario();
  // Un puerto donde no hay nada: el caso de quedarse sin internet.
  unAparato(quien, 'https://127.0.0.1:1/push/nadie');

  const r = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r.mandados, 0);
  assert.equal(r.borrados, 0);
  assert.equal(r.fallados, 1);
  assert.ok(/ECONNREFUSED|connect/i.test(r.porque), `el motivo dice algo útil: ${r.porque}`);

  const s = suscripcionesDe(quien)[0];
  assert.ok(s, 'sigue enganchado');
  assert.equal(s.fallos, 1, 'se le cuenta el fallo');
  assert.ok(s.ultimo_error, 'y se guarda para poder mirarlo después');
});

test('los fallos se van sumando mientras siga sin poder', async () => {
  const quien = unUsuario();
  unAparato(quien, 'https://127.0.0.1:1/push/insistente');
  await navegador.empujar(quien, aviso, comoMandarlo);
  await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(suscripcionesDe(quien)[0].fallos, 2);
});

// ----------------------------------------------------------- con varios aparatos

test('con varios aparatos, cada uno corre su suerte', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/varios-bueno`);
  unAparato(quien, 'https://127.0.0.1:1/push/varios-malo');
  queContesta = 201;

  const r = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r.mandados, 1, 'al que sí se pudo, le llegó');
  assert.equal(r.fallados, 1, 'y el otro se cuenta aparte');
  assert.equal(suscripcionesDe(quien).length, 2, 'ninguno se borró');
});

test('que uno esté muerto no impide que al otro le llegue', async () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/vivo`);
  queContesta = 201;
  const r1 = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r1.mandados, 1);

  // Ahora el servicio empieza a contestar 410 para todos
  unAparato(quien, `https://127.0.0.1:${puerto}/push/tambien-vivo`);
  queContesta = 410;
  const r2 = await navegador.empujar(quien, aviso, comoMandarlo);
  assert.equal(r2.borrados, 2);
  assert.equal(suscripcionesDe(quien).length, 0);
});

// -------------------------------------------------------- enganchar y desenganchar

test('la misma dirección no se guarda dos veces: la tabla no lo permite', async () => {
  const quien = unUsuario();
  const donde = `https://127.0.0.1:${puerto}/push/repetida`;
  unAparato(quien, donde);
  unAparato(quien, donde);
  assert.equal(navegador.cuantosAparatos(quien), 1);
});

test('una suscripción incompleta no se guarda', () => {
  const quien = unUsuario();
  assert.ok(!navegador.suscribir(quien, { endpoint: 'https://x.cl/a' }, 'sin llaves'));
  assert.ok(!navegador.suscribir(quien, null, 'nada'));
  assert.equal(navegador.cuantosAparatos(quien), 0);
});

test('apagarlos todos deja la cuenta sin ningún aparato', () => {
  const quien = unUsuario();
  unAparato(quien, `https://127.0.0.1:${puerto}/push/todos-1`);
  unAparato(quien, `https://127.0.0.1:${puerto}/push/todos-2`);
  unAparato(quien, `https://127.0.0.1:${puerto}/push/todos-3`);
  assert.equal(navegador.cuantosAparatos(quien), 3);
  assert.equal(navegador.desuscribirTodos(quien), 3, 'dice cuántos apagó');
  assert.equal(navegador.cuantosAparatos(quien), 0);
});

test('apagarlos todos no toca los de otra persona', () => {
  // Es la única forma de sacar un aparato huérfano —uno activado en un
  // computador que ya no se usa, o en una dirección anterior del sistema—, y
  // por eso mismo tiene que estar bien acotada: se apagan los de quien lo
  // pide, y de nadie más.
  const mio = unUsuario();
  const ajeno = unUsuario();
  unAparato(mio, `https://127.0.0.1:${puerto}/push/mio`);
  unAparato(ajeno, `https://127.0.0.1:${puerto}/push/ajeno`);
  navegador.desuscribirTodos(mio);
  assert.equal(navegador.cuantosAparatos(mio), 0);
  assert.equal(navegador.cuantosAparatos(ajeno), 1, 'el de la otra persona sigue puesto');
});

test('apagar todo sin tener ninguno no es un error', () => {
  assert.equal(navegador.desuscribirTodos(unUsuario()), 0);
});

test('desenganchar saca solo el aparato de uno', () => {
  const mio = unUsuario();
  const ajeno = unUsuario();
  const donde = `https://127.0.0.1:${puerto}/push/de-otro`;
  unAparato(ajeno, donde);
  navegador.desuscribir(mio, donde);
  assert.equal(navegador.cuantosAparatos(ajeno), 1, 'nadie desengancha el aparato de otro');
  navegador.desuscribir(ajeno, donde);
  assert.equal(navegador.cuantosAparatos(ajeno), 0);
});

test('la llave pública existe y tiene la forma que espera el navegador', () => {
  const llave = navegador.llavePublica();
  assert.ok(llave, 'sin ella el navegador no puede suscribirse');
  // Un punto de curva P-256 sin comprimir son 65 bytes; en base64url, 87 letras.
  assert.equal(llave.length, 87);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(llave), 'va en base64url, sin +, / ni =');
  assert.equal(Buffer.from(llave, 'base64url').length, 65);
  assert.equal(navegador.llavePublica(), llave, 'y no cambia de una vez a otra');
});
