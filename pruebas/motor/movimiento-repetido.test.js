/**
 * El mismo movimiento anotado dos veces.
 *
 * Dos personas de la misma oficina anotan la compra del domingo, o alguien la
 * anota dos veces sin darse cuenta. El sistema guardaba las dos sin decir nada
 * y la cuenta quedaba con el doble descontado. Medido: el egreso «Sillas para
 * el salón» de $250.000, guardado dos veces idéntico, dejaba la cuenta $500.000
 * abajo, y el descuadre no se ve hasta que se cuenta la plata.
 *
 * Se pregunta, no se bloquea: dos compras iguales el mismo día existen. Lo que
 * se vigila acá es qué cuenta como «el mismo» —la cuenta, el día, el tipo, el
 * monto y el concepto, este último sin tildes ni mayúsculas, porque nadie
 * escribe dos veces igual— y que corregir uno que ya está guardado no vuelva a
 * preguntar lo que alguien ya contestó.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const tesoreria = require('../../server/modules/tesoreria');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Sillas WW','TES-SIL','Activa')")
  .run().lastInsertRowid;
const cuentaDe = (nombre) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES (?, 'Iglesia local', 'General', ?, 'Activa', 9000000)`)
  .run(nombre, iglesia).lastInsertRowid;
const cuenta = cuentaDe('General de las Sillas WW');
const otraCuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES ('Proyecto de las Sillas WW', 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', 9000000)`)
  .run(iglesia).lastInsertRowid;

const DIA = '2026-03-15';
const CONCEPTO = 'Sillas para el salón';

const yaAnotado = db
  .prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, metodo)
     VALUES (?, 'Egreso', 'Compras', ?, 250000, ?, ?, 'Efectivo')`
  )
  .run(DIA, CONCEPTO, cuenta, iglesia).lastInsertRowid;

// El rol como lo guarda la base ('admin'), no su etiqueta (ver ROLES en
// server/permissions.js): un rol que no existe no alcanza ninguna llave.
const usuario = { id: 1, rol: 'admin' };

/** Lo que contesta el módulo al intentar guardar este movimiento. */
function guardar(datos, { existing = null, confirmado = false } = {}) {
  return tesoreria.hooks.beforeSave({ ...datos }, { user: usuario, db, existing, confirmado, isNew: !existing });
}

/*
 * Con su boleta adjunta, a propósito. Desde la 1.166.0 un egreso grande sin
 * respaldo también se pregunta, y acá lo que se está probando es OTRA pregunta:
 * si estos movimientos fueran sin comprobante, un «no se pregunta nada» no
 * distinguiría entre «no está repetido» y «se preguntó por la boleta».
 */
const nuevo = (extra = {}) => ({
  fecha: DIA, tipo: 'Egreso', categoria: 'Compras', concepto: CONCEPTO,
  monto: 250000, cuenta_id: cuenta, metodo: 'Efectivo', comprobante: 'boleta-sillas.pdf', ...extra,
});

/* ------------------------------------------------------ lo que sí es el mismo */

test('el mismo egreso, otra vez, se pregunta antes de guardarse', () => {
  const r = guardar(nuevo());
  assert.equal(typeof r, 'object', 'se pregunta, no se rechaza a secas');
  assert.equal(r.confirmar, 'movimiento_ya_anotado');
  assert.match(r.error, /250\.000/);
  assert.match(r.error, /descuenta el doble/);
});

test('escrito de otra manera es el mismo gasto igual', () => {
  const r = guardar(nuevo({ concepto: '  sillas PARA el SALON  ' }));
  assert.ok(r && r.confirmar === 'movimiento_ya_anotado',
    'sin tildes, sin mayúsculas y sin espacios de más: nadie escribe dos veces igual');
});

test('quien confirma manda: se guarda igual', () => {
  assert.equal(guardar(nuevo(), { confirmado: true }), null);
});

/* -------------------------------------------------- lo que NO es el mismo */

test('un peso de diferencia es otro gasto', () => {
  assert.equal(guardar(nuevo({ monto: 250001 })), null);
});

test('el mismo monto y concepto, pero entrando en vez de saliendo, es otra cosa', () => {
  assert.equal(guardar(nuevo({ tipo: 'Ingreso', categoria: 'Ofrendas' })), null);
});

test('otro día es otro gasto', () => {
  assert.equal(guardar(nuevo({ fecha: '2026-03-16' })), null);
});

test('la misma compra en otra cuenta es otra compra', () => {
  assert.equal(guardar(nuevo({ cuenta_id: otraCuenta })), null,
    'cada cuenta lleva su propio libro');
});

test('otro concepto, aunque calce todo lo demás', () => {
  assert.equal(guardar(nuevo({ concepto: 'Mesas para el salón' })), null);
});

/* ------------------------------------------------ corregir lo que ya está */

test('corregirlo sin cambiarle nada no se pregunta a sí mismo', () => {
  const suyo = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(yaAnotado);
  assert.equal(guardar(nuevo(), { existing: suyo }), null);
});

test('y con un gemelo legítimo al lado, tampoco vuelve a preguntar', () => {
  /*
   * Alguien ya dijo que eran dos compras distintas y las dos están guardadas.
   * Volver a preguntarlo cada vez que se le arregla una coma a una de ellas es
   * ruido, y el ruido enseña a confirmar sin leer.
   */
  const gemelo = db
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, metodo)
       VALUES (?, 'Egreso', 'Compras', ?, 250000, ?, ?, 'Efectivo')`
    )
    .run(DIA, CONCEPTO, cuenta, iglesia).lastInsertRowid;
  const suyo = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(yaAnotado);

  assert.equal(guardar(nuevo({ notas: 'Se pagó en dos cuotas' }), { existing: suyo }), null,
    'no cambió nada de lo que lo hace «el mismo»');

  // Pero si al corregirlo se le pone el monto del otro, ahí sí son dos iguales
  const distinto = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(yaAnotado);
  db.prepare('UPDATE tesoreria SET monto = 111000 WHERE id = ?').run(yaAnotado);
  const conOtroMonto = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(yaAnotado);
  const r = guardar(nuevo(), { existing: conOtroMonto });
  assert.ok(r && r.confirmar === 'movimiento_ya_anotado',
    'cambiarle el monto al que quedaba distinto lo deja igual al gemelo: hay que preguntar');

  db.prepare('UPDATE tesoreria SET monto = ? WHERE id = ?').run(distinto.monto, yaAnotado);
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(gemelo);
});

/* ------------------------------------------------------------ el aviso */

test('el aviso dice con qué distinguir uno del otro', () => {
  const r = guardar(nuevo());
  assert.match(r.error, /anotado el \d{2}-\d{2}-\d{4}/, 'cuándo se anotó el que ya estaba');
  assert.match(r.error, /Si es este mismo, abra ese/, 'y qué hacer si es el mismo');
});

test('la pantalla sabe cómo preguntarlo', () => {
  assert.match(app, /movimiento_ya_anotado:\s*\{/);
  assert.match(app, /Puede que este movimiento ya esté anotado/);
});
