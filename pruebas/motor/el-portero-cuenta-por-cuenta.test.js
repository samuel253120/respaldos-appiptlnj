/**
 * EL PORTERO CONTABA CONTRA EL TEXTO, NO CONTRA LA CUENTA.
 *
 * Para BUSCAR la cuenta, la entrada normaliza el RUT: `rutUtil.canonico()` deja
 * «5.111.111-7», «5111111-7» y «51111117» en una sola forma. Para CONTAR los
 * errores no lo hacía, y usaba el texto tal como venía. Así que la misma cuenta
 * tenía tantos cupos de cinco intentos como maneras hubiera de escribir su RUT.
 *
 * MEDIDO en la v1.416.0, contra un sistema andando: la misma cuenta escrita de
 * seis maneras, cinco intentos cada una.
 *
 *   "5.111.111-7" ...  401 401 401 401 429   cupo propio
 *   "5111111-7" .....  401 401 401 401 429   cupo propio
 *   "51111117" ......  401 401 401 401 429   cupo propio
 *   "5-111-111-7" ...  401 401 401 401 429   cupo propio
 *   ──
 *   "5.111.111-7 " ..  429 429 429 429 429   el mismo cupo
 *   "5.111.111-7\t" ..  429 429 429 429 429   el mismo cupo
 *
 * Dieciséis pruebas de contraseña donde el diseño quiere cinco. Las dos últimas
 * ya caían en el mismo cupo porque el `.trim()` las igualaba: la normalización
 * existía y se quedaba corta, que es distinto de no estar.
 *
 * Se normaliza en la LLAVE, no en cada puerta, para que lo hereden las tres que
 * cuentan: entrar, preguntar por la pregunta secreta y recuperar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const intentos = require('../../server/intentos');
const { digitoVerificador } = require('../../server/rut');

let siguiente = 0;
const unNumero = () => 22600000 + (process.pid % 700) * 100 + (siguiente++ % 100);
const unaIp = () => `9.8.7.${process.pid % 250}`;

/** Las maneras en que una misma persona escribe su RUT. */
function comoSeEscribe(n) {
  const d = digitoVerificador(String(n));
  const s = String(n);
  const conPuntos = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return [`${conPuntos}-${d}`, `${s}-${d}`, `${s}${d}`, ` ${conPuntos}-${d} `, `${conPuntos}-${d}\t`];
}

test('las cinco maneras de escribir un RUT son UNA sola llave', () => {
  const n = unNumero();
  const formas = comoSeEscribe(n);
  const llaves = new Set(formas.map((f) => intentos.comoSeLlama(f)));
  assert.equal(llaves.size, 1, `se esperaba una sola llave y salieron ${llaves.size}: ${[...llaves].join(' · ')}`);
  assert.equal([...llaves][0], `${n}-${digitoVerificador(String(n))}`.toLowerCase(),
    'y es la forma canónica, la misma con que la entrada busca la cuenta');
});

test('y por eso los cinco intentos son cinco, no cinco por grafía', () => {
  const ip = unaIp();
  const formas = comoSeEscribe(unNumero());
  assert.equal(intentos.esperaQueLeFalta(formas[0], ip), 0, 'empieza abierta');

  // Un error por cada manera de escribirlo: si cada una tuviera su cupo, cinco
  // errores repartidos así no cerrarían nada.
  for (const f of formas) intentos.fallo(f, ip);

  for (const f of formas) {
    assert.ok(intentos.esperaQueLeFalta(f, ip) > 0,
      `escrito «${f}» la puerta tiene que estar cerrada igual: antes cada grafía tenía su propio cupo`);
  }
});

test('entrar bien por una grafía abre por todas: es la misma cuenta', () => {
  const ip = unaIp();
  const formas = comoSeEscribe(unNumero());
  for (const f of formas) intentos.fallo(f, ip);
  assert.ok(intentos.esperaQueLeFalta(formas[0], ip) > 0);

  intentos.acierto(formas[2], ip);   // entra escribiéndolo sin puntos ni guion
  for (const f of formas) {
    assert.equal(intentos.esperaQueLeFalta(f, ip), 0,
      `escrito «${f}» tendría que estar abierta: quien acertó es el dueño de la cuenta`);
  }
});

test('dos cuentas distintas siguen siendo dos llaves distintas', () => {
  const ip = unaIp();
  const una = comoSeEscribe(unNumero())[0];
  const otra = comoSeEscribe(unNumero())[0];
  assert.notEqual(intentos.comoSeLlama(una), intentos.comoSeLlama(otra),
    'normalizar no puede terminar juntando cuentas que no son la misma');
  for (let i = 0; i < 5; i++) intentos.fallo(una, ip);
  assert.ok(intentos.esperaQueLeFalta(una, ip) > 0, 'la que erró queda cerrada');
  assert.equal(intentos.esperaQueLeFalta(otra, '5.5.5.5'), 0, 'la otra no');
});

test('el correo de las cuentas viejas se cuenta como correo, no como RUT', () => {
  /*
   * Las cuentas creadas antes de usar el RUT todavía entran con su correo
   * mientras no se les asigne uno (ver server/auth.js). `canonico` no sabe qué
   * hacer con un correo y devuelve vacío: si se usara su respuesta, todos los
   * correos del mundo caerían en la misma llave y el primero que errara dejaría
   * cerrados a los demás.
   */
  assert.equal(intentos.comoSeLlama('ANA@Iglesia.CL'), 'ana@iglesia.cl');
  assert.notEqual(intentos.comoSeLlama('ana@iglesia.cl'), intentos.comoSeLlama('luis@iglesia.cl'));

  /*
   * Y el caso que obliga a mirar el arroba antes que nada: `canonico` lee los
   * dígitos que encuentre y no le importa lo que venga después. Medido:
   *
   *   "12345678@a.cl" ........ → 1234567-8
   *   "12345678@b.cl" ........ → 1234567-8      dos cuentas, una sola llave
   *   "111111111@correo.cl" .. → 11111111-1     encima del RUT del administrador
   *
   * Sin la rama del correo, el despiste de una persona le cerraría la puerta a
   * otra, y un correo cualquiera podría cerrarle la puerta a un RUT.
   */
  assert.notEqual(intentos.comoSeLlama('12345678@a.cl'), intentos.comoSeLlama('12345678@b.cl'),
    'dos correos distintos no pueden terminar en la misma llave');
  assert.notEqual(intentos.comoSeLlama('111111111@correo.cl'), intentos.comoSeLlama('11.111.111-1'),
    'y un correo no puede caer encima del RUT de nadie');

  const ip = unaIp();
  for (let i = 0; i < 5; i++) intentos.fallo('ana@iglesia.cl', ip);
  assert.ok(intentos.esperaQueLeFalta('ana@iglesia.cl', ip) > 0);
  assert.equal(intentos.esperaQueLeFalta('luis@iglesia.cl', '4.4.4.4'), 0,
    'el error de una no puede cerrarle la puerta a la otra');
});

test('lo que no se supo normalizar se cuenta igual, tal cual', () => {
  /*
   * Un identificador que no es ni RUT ni correo —basura, o un formato que el
   * sistema no reconoce— tiene que seguir contando: dejarlo sin llave sería
   * dejar sin portero justo al que escribe cualquier cosa.
   */
  assert.equal(intentos.comoSeLlama('LoQueSea'), 'loquesea');
  assert.equal(intentos.comoSeLlama('   '), '', 'lo vacío sí se ignora: ahí cuenta solo la dirección');
  const ip = unaIp();
  for (let i = 0; i < 5; i++) intentos.fallo('LoQueSea', ip);
  assert.ok(intentos.esperaQueLeFalta('loquesea', ip) > 0, 'y da igual con qué mayúsculas se escriba');
});

test('la regla vive en la llave, así que las tres puertas la heredan', () => {
  const portero = fs.readFileSync(path.join(__dirname, '../../server/intentos.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '../../server/auth.js'), 'utf8');
  assert.match(portero, /function comoSeLlama/, 'la normalización vive en el portero');
  assert.match(portero, /const limpio = comoSeLlama\(rut\);/, 'y la usa la llave, que es por donde pasan todas');

  /*
   * Las puertas le pasan al portero lo que la persona TECLEÓ, no una versión
   * ya normalizada por ellas. `auth.js` sigue usando `canonico` para BUSCAR la
   * cuenta —eso es otra cosa y tiene que quedarse—; lo que no puede volver a
   * pasar es que cada puerta arregle el RUT por su cuenta antes de contar, que
   * es como se llega a cuatro copias de la misma regla.
   */
  const llamadas = auth.match(/intentos\.(?:fallo|acierto|esperaQueLeFalta)\([^)]*\)/g) || [];
  assert.ok(llamadas.length >= 4, `se encontraron ${llamadas.length} llamadas al portero`);
  for (const l of llamadas) {
    assert.ok(!/canonico/.test(l), `esta llamada normaliza por su cuenta: ${l}`);
  }
});
