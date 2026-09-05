/**
 * EL AVISO CALLABA Y EL CRONÓMETRO HABLABA.
 *
 * La entrada se cuida de contestar lo mismo exista o no la cuenta —«Credenciales
 * incorrectas» en los dos casos, y hay una prueba que lo vigila—. Pero cuando el
 * RUT no existe no hay contraseña que comprobar y la respuesta salía de
 * inmediato; cuando existe, bcrypt se toma sus 82 milisegundos.
 *
 * MEDIDO en la v1.416.0 contra un sistema andando, un solo intento por RUT con
 * la misma clave equivocada:
 *
 *   5.111.111-7  con cuenta ....  168 ms      5.111.112-5  sin cuenta ....  3 ms
 *   6.222.222-0  con cuenta ....   81 ms      6.222.223-9  sin cuenta ....  2 ms
 *   7.333.333-4  con cuenta ....   81 ms      7.333.334-2  sin cuenta ....  2 ms
 *   8.444.444-8  con cuenta ....   83 ms      8.444.445-6  sin cuenta ....  3 ms
 *
 * Con una lista de RUT —que en Chile no son secretos— se sabía en un rato
 * cuáles tienen cuenta en el sistema, sin acertar ninguna contraseña. Es el
 * paso de reconocimiento de los otros hallazgos de esta revisión. La v1.316.0
 * cerró exactamente esta filtración en la puerta de al lado, la de
 * recuperación; en la principal quedó abierta por otro camino.
 *
 * Ahora se compara SIEMPRE: contra la huella de verdad si la hay, y contra una
 * de relleno si no. Medido después del arreglo: 82 ms por los dos caminos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const cifrado = require('../../server/cifrado');
const { db } = require('../../server/db');
const claves = require('../../server/claves');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let siguiente = 0;
const unRut = () => {
  const n = 24800000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
};

test('hay una huella de relleno, y es una huella de verdad', () => {
  assert.ok(cifrado.HUELLA_DE_RELLENO, 'tiene que existir');
  assert.match(cifrado.HUELLA_DE_RELLENO, /^\$2[aby]\$\d\d\$/,
    'una huella de bcrypt, no un texto cualquiera: comparar contra algo que no lo sea no cuesta lo mismo');
});

test('y comparar contra ella cuesta lo mismo que contra una de verdad', async () => {
  const deVerdad = await cifrado.cifrar('UnaClaveCualquiera.9');
  const reloj = async (huella) => {
    const t = process.hrtime.bigint();
    await cifrado.coincide('NoEsLaClave.9', huella);
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  await reloj(deVerdad); // calentar
  const conRelleno = await reloj(cifrado.HUELLA_DE_RELLENO);
  const conLaDeVerdad = await reloj(deVerdad);
  assert.ok(conRelleno > 20,
    `comparar con la de relleno tomó ${conRelleno.toFixed(0)} ms: tiene que costar lo que cuesta bcrypt`);
  assert.ok(conRelleno > conLaDeVerdad * 0.4,
    `${conRelleno.toFixed(0)} ms contra ${conLaDeVerdad.toFixed(0)} ms: no pueden separarse tanto`);
});

test('LA DE FONDO: la entrada tarda lo mismo exista o no la cuenta', async () => {
  /*
   * Se mide con holgura a propósito: estos archivos corren en paralelo sobre la
   * misma máquina y los tiempos bailan. Lo que se comprueba es que el camino
   * del RUT que no existe PASE por bcrypt, no que tarde un número exacto. Antes
   * tomaba 2 ms, así que cualquier umbral por encima de la decena lo destapa.
   */
  const api = await elSistemaAndando();
  const conCuenta = unRut();
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, estado) VALUES ('Quien','Entra','Activo')").run().lastInsertRowid;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, miembro_id) VALUES ('Quien Entra', ?, 'consulta', 1, ?)"
  ).run(conCuenta, miembro).lastInsertRowid;
  await claves.establecer(usuario, 'ClaveLarga.2026.Suya', 'usuario');
  const sinCuenta = unRut();

  const reloj = async (rut) => {
    const t = process.hrtime.bigint();
    const r = await api('POST', '/auth/login', { rut, password: 'NoEsLaClave.9' });
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, estado: r.estado, dice: r.json && r.json.error };
  };
  await reloj(unRut()); // calentar

  const con = await reloj(conCuenta);
  const sin = await reloj(sinCuenta);

  assert.equal(con.estado, 401, con.dice);
  assert.equal(sin.estado, 401, sin.dice);
  assert.equal(con.dice, sin.dice, 'el texto ya era el mismo, y tiene que seguir siéndolo');

  assert.ok(sin.ms > 20,
    `el RUT sin cuenta se contestó en ${sin.ms.toFixed(0)} ms: antes eran 2 ms y eso decía que no existía`);
  assert.ok(sin.ms > con.ms * 0.4,
    `con cuenta ${con.ms.toFixed(0)} ms, sin cuenta ${sin.ms.toFixed(0)} ms: no pueden separarse tanto`);
});

test('la entrada compara siempre, y no se sale antes de hacerlo', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../../server/auth.js'), 'utf8');
  const login = auth.slice(auth.indexOf("router.post('/login'"), auth.indexOf("router.post('/salir'"));
  assert.match(login, /const huella = \(user && user\.password\) \|\| cifrado\.HUELLA_DE_RELLENO;/,
    'compara contra la huella de verdad si la hay, y contra la de relleno si no');
  assert.match(login, /const acierta = await cifrado\.coincide\(password, huella\);/);
  assert.ok(login.indexOf('const acierta') < login.indexOf('if (!user || !user.password || !acierta)'),
    'la comparación va ANTES de decidir: si se decide primero, el camino corto vuelve');
  assert.ok(!/!\(await cifrado\.coincide\(password, user\.password\)\)/.test(login),
    'y ya no se compara dentro de la condición, que es donde estaba el atajo');
});
