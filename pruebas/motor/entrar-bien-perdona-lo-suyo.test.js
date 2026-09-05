/**
 * ENTRAR BIEN LE BORRABA LOS ERRORES A TODA LA DIRECCIÓN.
 *
 * El conteo por dirección existe por una razón que el propio portero explica:
 * frenar «a quien va probando RUT tras RUT desde un mismo lugar, que al contar
 * solo por RUT nunca llegaría al tope». Pero al entrar bien se borraban las DOS
 * llaves, la de la cuenta y la de la dirección, así que una entrada legítima
 * limpiaba de un plumazo los errores que llevaban todos los demás intentos
 * hechos desde ahí.
 *
 * Al atacante le bastaba UNA CUENTA PROPIA cualquiera —de perfil «consulta», la
 * de menos permisos— para vaciar el contador cuando quisiera. No necesitaba
 * adivinar nada.
 *
 * MEDIDO en la v1.416.0 contra un sistema andando, con el tope por dirección
 * puesto en 12 y errando siempre contra RUT distintos:
 *
 *   nadie entra bien ................  la puerta se cerró al error n.º 12
 *   alguien entra bien cada 5 .......  nunca, en 40 errores seguidos
 *
 * El arreglo no puede ser dejar de perdonar: en la iglesia todos salen por el
 * mismo wifi, y el despiste de quien no se acuerda de su clave no tiene por qué
 * pesar sobre los demás una vez que entró. Lo que se perdona es LO SUYO: la
 * cuenta que acertó se borra entera, y a la dirección se le descuentan solo los
 * errores que puso esa misma cuenta.
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
const unRut = () => {
  const n = 23700000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
};
let cuantas = 0;
const unaIp = () => `6.5.4.${(process.pid + cuantas++) % 250}`;

/** El tope por dirección con los valores de fábrica: 5 × 4 = 20. */
const TOPE_POR_DIRECCION = 20;

test('LO QUE IMPORTA: entrar bien no le borra a la dirección lo que pusieron otras cuentas', () => {
  const ip = unaIp();
  // Cuatro cuentas distintas erran una vez cada una: el barrido que hay que atajar
  const ajenas = [unRut(), unRut(), unRut(), unRut()];
  for (const r of ajenas) intentos.fallo(r, ip);
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 4,
    'la dirección lleva contados los cuatro');

  // Y el atacante entra con SU cuenta, que nunca erró
  intentos.acierto(unRut(), ip);
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 4,
    'los cuatro tienen que seguir contados: antes de esto quedaban en cero');
});

test('LO QUE NO SE PUEDE ROMPER: el despiste propio sí se perdona', () => {
  /*
   * En la iglesia todos salen por el mismo wifi. Si los errores de quien no se
   * acuerda de su clave se quedaran contra la dirección después de que entró,
   * unas cuantas personas despistadas dejarían al resto afuera.
   */
  const ip = unaIp();
  const suyo = unRut();
  for (let i = 0; i < 4; i++) intentos.fallo(suyo, ip);
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 4);

  intentos.acierto(suyo, ip);
  assert.equal(intentos.esperaQueLeFalta(suyo, ip), 0, 'su cuenta queda limpia');
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION,
    'y la dirección también: eran todos suyos');
});

test('y se descuenta lo justo cuando hay de los dos', () => {
  const ip = unaIp();
  const suyo = unRut();
  for (const r of [unRut(), unRut()]) intentos.fallo(r, ip);   // 2 ajenos
  for (let i = 0; i < 3; i++) intentos.fallo(suyo, ip);         // 3 suyos
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 5);

  intentos.acierto(suyo, ip);
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 2,
    'se van los tres suyos y se quedan los dos ajenos');
});

test('si el descuento la baja del peldaño, la dirección se abre', () => {
  const ip = unaIp();
  const suyo = unRut();
  // El dueño solo erra hasta cerrar la dirección él mismo
  for (let i = 0; i < TOPE_POR_DIRECCION; i++) intentos.fallo(suyo, ip);
  assert.ok(intentos.esperaQueLeFalta(null, ip) > 0, 'la dirección quedó cerrada');

  intentos.acierto(suyo, ip);
  assert.equal(intentos.esperaQueLeFalta(null, ip), 0,
    'lo que la cerró era todo suyo, y ya no está contado');
});

test('y se abre también cuando queda algo contado, pero por debajo del peldaño', () => {
  /*
   * El caso de en medio, que es el que de verdad ejercita la regla: con el
   * descuento la dirección no llega a cero —quedan errores de otros— pero sí
   * baja del tope que la cerró. El cierre lo puso esta cuenta y ya no está
   * contado, así que tiene que levantarse.
   */
  const ip = unaIp();
  const suyo = unRut();
  for (const r of [unRut(), unRut(), unRut()]) intentos.fallo(r, ip);   // 3 ajenos
  for (let i = 0; i < TOPE_POR_DIRECCION - 1; i++) intentos.fallo(suyo, ip);
  assert.ok(intentos.esperaQueLeFalta(null, ip) > 0, 'entre todos la cerraron');

  intentos.acierto(suyo, ip);
  assert.equal(intentos.intentosQueLeQuedan(null, ip), TOPE_POR_DIRECCION - 3,
    'quedan contados los tres ajenos');
  assert.equal(intentos.esperaQueLeFalta(null, ip), 0,
    'y el cierre se levanta: lo que lo provocó ya no está contado');
});

test('pero si la cerraron otras cuentas, entrar bien no la abre', () => {
  const ip = unaIp();
  for (let i = 0; i < TOPE_POR_DIRECCION; i++) intentos.fallo(unRut(), ip);
  assert.ok(intentos.esperaQueLeFalta(null, ip) > 0, 'la dirección quedó cerrada');

  intentos.acierto(unRut(), ip);
  assert.ok(intentos.esperaQueLeFalta(null, ip) > 0,
    'sigue cerrada: es exactamente el caso que el conteo por dirección existe para atajar');
});

test('el barrido topa aunque entre bien todo el rato', () => {
  /*
   * La medición del informe, en chico: RUT siempre distintos y una entrada
   * buena cada cinco. Antes no se cerraba nunca.
   */
  const ip = unaIp();
  const suyo = unRut();
  let errores = 0, cerrada = false;
  for (let i = 0; i < 60 && !cerrada; i++) {
    intentos.fallo(unRut(), ip);
    errores++;
    if (i % 5 === 4) intentos.acierto(suyo, ip);
    cerrada = intentos.esperaQueLeFalta(null, ip) > 0;
  }
  assert.ok(cerrada, 'en 60 errores la puerta tiene que haberse cerrado');
  assert.ok(errores <= TOPE_POR_DIRECCION + 1,
    `se cerró al error ${errores}, y el tope es ${TOPE_POR_DIRECCION}`);
});

test('la cuenta que acertó se borra entera, no se le descuenta', () => {
  const ip = unaIp();
  const suyo = unRut();
  for (let i = 0; i < 4; i++) intentos.fallo(suyo, ip);
  intentos.acierto(suyo, ip);
  assert.equal(intentos.intentosQueLeQuedan(suyo, `9.9.9.${process.pid % 200}`), 5,
    'vuelve a tener sus cinco intentos: quien acertó es el dueño');
});

test('la regla está escrita en el portero, y dice por qué', () => {
  const portero = fs.readFileSync(path.join(__dirname, '../../server/intentos.js'), 'utf8');
  const suyo = portero.slice(portero.indexOf('function acierto'), portero.indexOf('/** Cuántos le quedan'));
  assert.ok(!/for \(const llave of llaves\(rut, ip\)\) registro\.delete/.test(suyo),
    'ya no borra las dos llaves de un plumazo');
  assert.match(suyo, /compartida\.fallos - losSuyos/, 'descuenta solo lo de esa cuenta');
  assert.match(portero, /AU-04|SE LE PERDONA LO SUYO/, 'y queda escrito de dónde salió');
});
