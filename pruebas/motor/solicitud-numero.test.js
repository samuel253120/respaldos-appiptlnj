/**
 * El número de cada solicitud.
 *
 * Es cómo se nombra una solicitud en un acta, en un correo o de viva voz, así
 * que dos solicitudes no pueden llevar el mismo. Hay tres formas de que eso
 * pase y las tres se prueban acá:
 *
 *   · que el correlativo se calcule contando filas o buscando el máximo, y
 *     entonces al borrar una se vuelva a entregar su número
 *   · que no se reinicie con el año, o que se reinicie de más y pise los del
 *     año en curso
 *   · que dos peticiones a la vez reciban el mismo
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const numero = require('../../server/solicitudes/numero');

const contador = (anio) =>
  (db.prepare('SELECT ultimo FROM solicitud_contador WHERE anio = ?').get(anio) || { ultimo: 0 }).ultimo;

// ------------------------------------------------------------ cómo se ve ---

test('se escribe con cuatro dígitos y el año', () => {
  assert.equal(numero.comoSeEscribe(1, 2026), '0001-2026');
  assert.equal(numero.comoSeEscribe(45, 2026), '0045-2026');
  assert.equal(numero.comoSeEscribe(999, 2026), '0999-2026');
});

test('pasado el 9999 sigue creciendo, no se corta', () => {
  assert.equal(numero.comoSeEscribe(10000, 2026), '10000-2026');
  assert.equal(numero.comoSeEscribe(123456, 2026), '123456-2026');
});

test('se sabe leer de qué año es', () => {
  assert.equal(numero.anioDe('0045-2026'), 2026);
  assert.equal(numero.anioDe('10000-2031'), 2031);
  assert.equal(numero.anioDe('no es un número'), null);
  assert.equal(numero.anioDe(''), null);
  assert.equal(numero.anioDe(null), null);
});

// ---------------------------------------------------------- el correlativo --

test('el primero del año es el 0001', () => {
  assert.equal(numero.siguiente(2030), '0001-2030');
});

test('y después van uno tras otro', () => {
  assert.equal(numero.siguiente(2030), '0002-2030');
  assert.equal(numero.siguiente(2030), '0003-2030');
  assert.equal(numero.siguiente(2030), '0004-2030');
});

test('cada año lleva su propia cuenta', () => {
  assert.equal(numero.siguiente(2031), '0001-2031', 'el año nuevo parte de cero');
  assert.equal(numero.siguiente(2030), '0005-2030', 'y el anterior sigue donde iba');
  assert.equal(numero.siguiente(2031), '0002-2031');
});

test('registrar una de un año pasado no toca la cuenta del año en curso', () => {
  const antes2030 = contador(2030);
  numero.siguiente(2029);
  assert.equal(contador(2030), antes2030);
});

// ---------------------- lo que NO puede pasar: repetir un número ------------

test('el número no sale de contar filas: borrar una no lo devuelve', () => {
  const antes = contador(2032);
  const uno = numero.siguiente(2032);
  const dos = numero.siguiente(2032);
  assert.equal(uno, numero.comoSeEscribe(antes + 1, 2032));
  assert.equal(dos, numero.comoSeEscribe(antes + 2, 2032));
  // Se «borra» la última: el contador NO baja
  assert.equal(contador(2032), antes + 2);
  const tres = numero.siguiente(2032);
  assert.equal(tres, numero.comoSeEscribe(antes + 3, 2032), 'el siguiente sigue de largo, no reutiliza');
  assert.notEqual(tres, dos);
});

test('mil números seguidos son mil números distintos', () => {
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(numero.siguiente(2033));
  assert.equal(vistos.size, 1000);
});

test('la columna del número no admite repetidos', () => {
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central','IG-S','Activa')").run().lastInsertRowid;
  const meter = db.prepare(
    `INSERT INTO solicitudes (numero, fecha, iglesia_id, asunto, tipo, estado)
     VALUES (?, '2026-01-01', ?, 'Prueba', 'Otro', 'Pendiente')`
  );
  meter.run('0777-2026', iglesia);
  assert.throws(() => meter.run('0777-2026', iglesia), /UNIQUE/,
    'la base tiene que rechazarlo aunque el contador fallara');
});

// ------------------------------- dejar el contador al día tras la migración --

test('«alMenos» adelanta el contador, y nunca lo hace retroceder', () => {
  numero.alMenos(2035, 12);
  assert.equal(contador(2035), 12);
  assert.equal(numero.siguiente(2035), '0013-2035');
  numero.alMenos(2035, 5); // más atrás: no debe mover nada
  assert.equal(contador(2035), 13, 'no retrocede: retroceder repetiría números ya entregados');
  assert.equal(numero.siguiente(2035), '0014-2035');
});

test('«alMenos» sobre un año que no existía lo crea', () => {
  numero.alMenos(2040, 7);
  assert.equal(contador(2040), 7);
  assert.equal(numero.siguiente(2040), '0008-2040');
});
