/**
 * El egreso que deja la cuenta en rojo.
 *
 * La tesorería cuadra: los saldos se calculan bien, los traspasos mueven las
 * dos cuentas y deshacerlos las devuelve al peso. Lo que no revisaba era si el
 * número tiene sentido. Con setenta mil pesos en la cuenta se guardaba un
 * egreso de nueve millones y el saldo pasaba a decir −8.930.000, sin que nada
 * lo mencionara.
 *
 * El caso corriente no es el fraude, es el cero de más. Por eso esto pregunta
 * en vez de bloquear: una cuenta puede quedar en rojo de verdad, y el sistema
 * no está para discutirle eso a quien lleva la caja. Lo que no puede es dejar
 * pasar en silencio un egreso ciento veintisiete veces más grande que el saldo.
 *
 * Estas pruebas escriben en la base, así que corren sobre la descartable que
 * prepara `npm run motor`.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const saldos = require('../../server/saldos');

let cuenta;

before(() => {
  const info = db
    .prepare(
      `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, estado, saldo_inicial)
       VALUES ('Cuenta de prueba', 'Iglesia local', 'General', 'Activa', 0)`
    )
    .run();
  cuenta = info.lastInsertRowid;
  const mov = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id) VALUES (?, ?, 'Diezmos', ?, ?, ?)`
  );
  mov.run('2026-08-01', 'Ingreso', 'entra', 100000, cuenta);
  mov.run('2026-08-02', 'Egreso', 'sale', 30000, cuenta);
});

test('el saldo que quedaría es el que hay más lo que entra', () => {
  assert.equal(saldos.saldoResultante(cuenta, { tipo: 'Ingreso', monto: 5000 }), 75000);
});

test('y el que hay menos lo que sale', () => {
  assert.equal(saldos.saldoResultante(cuenta, { tipo: 'Egreso', monto: 5000 }), 65000);
});

test('un egreso que cabe no pregunta nada', () => {
  assert.equal(saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 20000 }), null);
});

test('gastar justo lo que hay tampoco: cero no es rojo', () => {
  assert.equal(saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 70000 }), null);
});

test('un peso más que el saldo sí pregunta', () => {
  assert.ok(saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 70001 }));
});

test('el cero de más pregunta, y dice los tres números que hacen falta', () => {
  const aviso = saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 9000000 });
  assert.equal(aviso.confirmar, 'saldo_negativo', 'tiene que ser una pregunta, no un rechazo');
  assert.match(aviso.error, /-8\.930\.000/, 'en cuánto quedaría');
  assert.match(aviso.error, /70\.000/, 'cuánto hay');
  assert.match(aviso.error, /9\.000\.000/, 'cuánto se saca');
  assert.match(aviso.error, /Cuenta de prueba/, 'de qué cuenta se trata');
});

test('un ingreso nunca pregunta, por grande que sea', () => {
  assert.equal(saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Ingreso', monto: 9000000 }), null);
});

test('corregir un egreso que ya estaba no lo cuenta dos veces', () => {
  // El egreso de 30.000 ya está descontado. Al subirlo a 65.000, lo que hay
  // que mirar es el saldo CON el nuevo, no con los dos sumados: si se contaran
  // los dos, un cambio inocente aparecería como sobregiro.
  const guardado = db.prepare("SELECT id FROM tesoreria WHERE concepto = 'sale'").get();
  assert.equal(
    saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 65000, excluirMovimiento: guardado.id }),
    null
  );
  assert.ok(
    saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 101000, excluirMovimiento: guardado.id }),
    'pero pasarse del saldo sí pregunta igual'
  );
});

test('el saldo inicial de la cuenta también cuenta', () => {
  const info = db
    .prepare(
      `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, estado, saldo_inicial)
       VALUES ('Con saldo inicial', 'Iglesia local', 'Proyecto o trabajo', 'Activa', 50000)`
    )
    .run();
  assert.equal(saldos.saldoResultante(info.lastInsertRowid, { tipo: 'Egreso', monto: 10000 }), 40000);
  assert.equal(saldos.avisoSiQuedaEnRojo(info.lastInsertRowid, { tipo: 'Egreso', monto: 50000 }), null);
  assert.ok(saldos.avisoSiQuedaEnRojo(info.lastInsertRowid, { tipo: 'Egreso', monto: 50001 }));
});

test('una cuenta que no existe no inventa un saldo', () => {
  assert.equal(saldos.saldoResultante(999999, { tipo: 'Egreso', monto: 1 }), null);
  assert.equal(saldos.avisoSiQuedaEnRojo(999999, { tipo: 'Egreso', monto: 1 }), null);
});

test('el aviso dice qué es lo que deja la cuenta en rojo', () => {
  const traspaso = saldos.avisoSiQuedaEnRojo(cuenta, { tipo: 'Egreso', monto: 9000000, queEs: 'Este traspaso' });
  assert.match(traspaso.error, /^Este traspaso/);
});
