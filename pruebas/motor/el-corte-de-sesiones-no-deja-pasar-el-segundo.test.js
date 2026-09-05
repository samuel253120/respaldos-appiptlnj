/**
 * EL CORTE DE SESIONES DEJABA PASAR EL MISMO SEGUNDO.
 *
 * Cambiar la contraseña cierra las sesiones abiertas, que es la regla que hace
 * que robar una clave no sirva después de cambiarla. Se comparaba con
 * `payload.iat < user.sesiones_desde`, y las dos cifras son segundos enteros
 * —así viene la fecha de emisión en un pase—: un pase emitido EN EL MISMO
 * SEGUNDO del cambio no era menor, así que sobrevivía.
 *
 * MEDIDO en la v1.416.0, moviendo el corte un segundo sobre el mismo pase:
 *
 *   la clave se cambió en el mismo segundo ...  200  el pase siguió sirviendo
 *   la clave se cambió un segundo después ....  401  «Su sesión se cerró»
 *
 * La ventana era de hasta un segundo y hay que estar entrando justo en él, así
 * que el hallazgo iba como bajo.
 *
 * CAMBIAR EL «MENOR» POR UN «MENOR O IGUAL» NO ARREGLABA NADA, y se probó: con
 * eso moría el pase de quien acababa de entrar bien en ese mismo segundo. Un
 * empate no se rompe con otro signo; se rompe no usando el reloj. Los dos
 * números son segundos enteros —así viene la fecha de emisión en un pase— y
 * dentro de un segundo no hay orden que sacar.
 *
 * Así que no se compara un reloj sino un CONTADOR: cada cambio de contraseña le
 * suma uno a la tanda de la cuenta, y cada pase lleva escrito con qué número
 * nació. Sirve el que trae el número de ahora. No hay ventanas ni empates.
 *
 * Los pases de antes de la v1.423.0 no traen número y cuentan como cero: a
 * quien nunca le cambiaron la contraseña le siguen sirviendo, y a quien sí, ya
 * no. Es lo que se busca en los dos casos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const jwt = require('jsonwebtoken');
const claves = require('../../server/claves');
const { db } = require('../../server/db');
const { JWT_SECRET } = require('../../server/auth');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema, elPuerto } = require('./andando');

test.after(cerrarElSistema);

let siguiente = 0;
const CLAVE = 'SuClaveDeEntrada.2026';

async function unaCuenta() {
  const n = `${27900000 + (process.pid % 700) * 100 + (siguiente++ % 100)}`;
  const rut = `${n}-${digitoVerificador(n)}`;
  const id = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(rut, `Del Borde ${process.pid}-${siguiente}`).lastInsertRowid;
  await claves.establecer(id, CLAVE, 'usuario', null);
  return { id, rut };
}

/** Un pase de esa cuenta con la tanda que se le diga. */
const unPaseDe = (id, gen) => jwt.sign({ id, rol: 'consulta', gen }, JWT_SECRET, { expiresIn: '12h' });
/** Un pase como los de antes de la v1.423.0: sin número de tanda. */
const unPaseViejo = (id) => jwt.sign({ id, rol: 'consulta' }, JWT_SECRET, { expiresIn: '12h' });
const laTandaDe = (id) =>
  Number(db.prepare('SELECT sesiones_gen FROM usuarios WHERE id = ?').get(id).sesiones_gen || 0);

async function sirve(api, pase) {
  const r = await fetch(`http://127.0.0.1:${elPuerto()}/api/auth/me`, {
    headers: { Authorization: `Bearer ${pase}` },
  });
  return r.status;
}

test('EL DEL HALLAZGO: un cambio de contraseña deja fuera al pase de antes, sin importar el segundo', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuenta();
  const pase = unPaseDe(cuenta.id, laTandaDe(cuenta.id));
  assert.equal(await sirve(api, pase), 200, 'antes del cambio sirve');

  // En el mismo instante, que es donde el reloj no alcanzaba
  await claves.establecer(cuenta.id, 'OtraClaveDistinta.2026', 'inicial', null);
  assert.equal(await sirve(api, pase), 401,
    'antes de esto sobrevivía cuando el cambio caía en su mismo segundo');
});

test('el pase de la tanda de ahora sí sirve: la regla no se pasó de rosca', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuenta();
  await claves.establecer(cuenta.id, 'YaLaCambiaron.2026', 'inicial', null);
  assert.equal(await sirve(api, unPaseDe(cuenta.id, laTandaDe(cuenta.id))), 200,
    'quien entró después del cambio tiene que poder trabajar');
});

test('y cada cambio corre la tanda otra vez', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuenta();
  const primera = laTandaDe(cuenta.id);
  const pase = unPaseDe(cuenta.id, primera);
  await claves.establecer(cuenta.id, 'UnaMas.2026.X', 'inicial', null);
  assert.equal(laTandaDe(cuenta.id), primera + 1, 'el contador sube de a uno');
  assert.equal(await sirve(api, pase), 401);
  assert.equal(await sirve(api, unPaseDe(cuenta.id, primera + 1)), 200);
});

test('un pase de antes de la v1.423.0 sirve mientras no le hayan cambiado la clave', async () => {
  /*
   * Los pases viejos no traen número y cuentan como cero. A una cuenta que
   * nunca pasó por un cambio le siguen sirviendo —no hay que echar a nadie por
   * publicar una versión— y a una que sí, ya no.
   */
  const api = await elSistemaAndando();
  const n = `${28900000 + (process.pid % 700) * 100 + (siguiente++ % 100)}`;
  const sinCambios = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(`${n}-${digitoVerificador(n)}`, `Nunca Cambió ${process.pid}`).lastInsertRowid;
  assert.equal(laTandaDe(sinCambios), 0, 'nace en cero');
  assert.equal(await sirve(api, unPaseViejo(sinCambios)), 200, 'su pase viejo sigue sirviendo');

  await claves.establecer(sinCambios, 'AhoraSiLaCambio.2026', 'inicial', null);
  assert.equal(await sirve(api, unPaseViejo(sinCambios)), 401, 'y en cuanto se la cambian, ya no');
});

test('LO QUE NO SE PUEDE ROMPER: quien cambia su propia contraseña no queda afuera', async () => {
  /*
   * El pase que se le entrega se emite en el mismo segundo del corte, así que
   * con «menor o igual» no serviría. Va fechado un segundo más adelante, a
   * propósito. Sin eso, el arreglo dejaría afuera justamente a quien hizo lo
   * correcto.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuenta();

  const entrada = await fetch(`http://127.0.0.1:${elPuerto()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut: cuenta.rut, password: CLAVE }),
  });
  const suSesion = await entrada.json();
  assert.equal(entrada.status, 200, JSON.stringify(suSesion));

  const cambio = await fetch(`http://127.0.0.1:${elPuerto()}/api/auth/cambiar-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${suSesion.token}` },
    body: JSON.stringify({ actual: CLAVE, nueva: 'LaNuevaQueElla.2026' }),
  });
  const resultado = await cambio.json();
  assert.equal(cambio.status, 200, JSON.stringify(resultado));
  assert.ok(resultado.token, 'se le entrega un pase nuevo en el acto');
  assert.equal(await sirve(api, resultado.token), 200,
    'y ese pase tiene que servir: si no, cambiar la contraseña la dejaría afuera');
  assert.equal(await sirve(api, suSesion.token), 401, 'y el viejo ya no');
});

test('el guardia compara la tanda, y los pases la llevan', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../../server/auth.js'), 'utf8');
  assert.match(auth, /Number\(payload\.gen \|\| 0\) !== Number\(user\.sesiones_gen \|\| 0\)/,
    'el guardia compara la tanda, no el reloj');
  assert.ok(!/payload\.iat [<>]/.test(auth),
    'y ya no se decide con la fecha de emisión: es un reloj de segundos y no rompe empates');
  assert.equal((auth.match(/gen: Number\(/g) || []).length, 2,
    'los dos pases que se emiten —al entrar y al cambiar la contraseña— llevan su tanda');
});
