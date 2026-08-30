/**
 * Mover el saldo inicial de una cuenta que ya tiene movimientos.
 *
 * Todo saldo del sistema es «saldo inicial + ingresos − egresos», y el saldo
 * inicial es el único número del que no cuelga ningún movimiento: no hay una
 * fila que lo respalde ni que se pueda revisar después. Se editaba como
 * cualquier otro campo de la ficha. Medido en la cuenta general de la
 * corporación, con 3.001 movimientos anotados: cambiarlo a $99.000.000 llevó el
 * saldo de $63.830.034 a $162.830.034 sin preguntar nada.
 *
 * Se pregunta, no se bloquea —el punto de partida se escribe mal la primera vez
 * y hay que poder corregirlo—, y solo cuando hay algo que correr: en una cuenta
 * recién creada el saldo inicial ES el saldo y moverlo no descuadra nada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const cuentas = require('../../server/modules/cuentas_tesoreria');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Partida VV','TES-PAR','Activa')")
  .run().lastInsertRowid;

const nuevaCuenta = (nombre, saldoInicial) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', ?)`)
  .run(nombre, iglesia, saldoInicial).lastInsertRowid;

const conMovimientos = nuevaCuenta('Con movimientos VV', 20000000);
const reciennacida = nuevaCuenta('Recién creada VV', 20000000);

// Dos ingresos y un egreso: la cuenta queda en 20.000.000 + 500.000 − 1.900.000
db.prepare(
  `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
   VALUES ('2026-02-01','Ingreso','Ofrendas','Uno VV',300000,?,?),
          ('2026-02-02','Ingreso','Ofrendas','Dos VV',200000,?,?),
          ('2026-02-03','Egreso','Compras','Tres VV',1900000,?,?)`
).run(conMovimientos, iglesia, conMovimientos, iglesia, conMovimientos, iglesia);

// El rol como lo guarda la base ('admin'), no su etiqueta (ver ROLES en
// server/permissions.js): un rol que no existe no alcanza ninguna llave.
const usuario = { id: 1, rol: 'admin' };
const fichaDe = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);

/** Lo que contesta el módulo al intentar guardar estos cambios en una cuenta. */
function guardar(cuentaId, cambios, { confirmado = false } = {}) {
  const existing = fichaDe(cuentaId);
  return cuentas.hooks.beforeSave({ ...cambios }, {
    user: usuario, db, existing, id: cuentaId, isNew: false, confirmado,
  });
}

/* ------------------------------------------------- cuándo sí se pregunta */

test('mover el punto de partida de una cuenta con movimientos se pregunta', () => {
  const r = guardar(conMovimientos, { saldo_inicial: 99000000 });
  assert.equal(typeof r, 'object', 'se pregunta, no se rechaza a secas');
  assert.equal(r.confirmar, 'saldo_inicial_cambiado');
});

test('el aviso dice cuántos movimientos hay y a cuánto quedaría el saldo', () => {
  const r = guardar(conMovimientos, { saldo_inicial: 99000000 });
  assert.match(r.error, /3 movimientos anotados/);
  assert.match(r.error, /\$ 18\.600\.000/, 'el saldo de ahora: 20.000.000 + 500.000 − 1.900.000');
  assert.match(r.error, /\$ 97\.600\.000/, 'y al que pasaría: 99.000.000 + 500.000 − 1.900.000');
});

test('bajarlo también se pregunta, no solo subirlo', () => {
  const r = guardar(conMovimientos, { saldo_inicial: 1000 });
  assert.ok(r && r.confirmar === 'saldo_inicial_cambiado');
});

test('quien confirma manda: se guarda igual', () => {
  assert.equal(guardar(conMovimientos, { saldo_inicial: 99000000 }, { confirmado: true }), null);
});

/* ------------------------------------------------- cuándo no hay nada que preguntar */

test('en una cuenta sin un solo movimiento, el punto de partida ES el saldo', () => {
  assert.equal(guardar(reciennacida, { saldo_inicial: 99000000 }), null,
    'no hay saldos que correr: moverlo no descuadra nada');
});

test('guardar la ficha sin tocar el saldo inicial no pregunta nada', () => {
  assert.equal(guardar(conMovimientos, { responsable: 'Alguien VV' }), null);
});

test('guardarlo con el mismo número que ya tenía tampoco', () => {
  assert.equal(guardar(conMovimientos, { saldo_inicial: 20000000 }), null);
});

test('el mismo número escrito como texto no cuenta como un cambio', () => {
  assert.equal(guardar(conMovimientos, { saldo_inicial: '20000000' }), null,
    'el formulario manda texto: "20000000" y 20000000 son el mismo punto de partida');
});

test('crear una cuenta nueva con el saldo inicial que sea no pregunta nada', () => {
  const r = cuentas.hooks.beforeSave(
    { nombre: 'Otra VV', ambito: 'Iglesia local', tipo: 'Proyecto / Trabajo',
      iglesia_id: iglesia, estado: 'Activa', saldo_inicial: 5000000 },
    { user: usuario, db, existing: null, isNew: true, confirmado: false }
  );
  assert.equal(r, null, 'todavía no hay nada que correr');
});

/* ------------------------------------------------------------ la pantalla */

test('la pantalla sabe cómo preguntarlo', () => {
  assert.match(app, /saldo_inicial_cambiado:\s*\{/);
  assert.match(app, /Está moviendo el punto de partida de la cuenta/);
});
