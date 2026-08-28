/**
 * El clic en un saldo lleva a ver esa plata.
 *
 * En el resumen, cada cuenta con su saldo se ve como un enlace y lo era: llevaba
 * al formulario de edición de la cuenta —su nombre, su responsable, su saldo
 * inicial—. Quien hace clic en «$ 65.696.114» no va a cambiarle el nombre a la
 * cuenta: va a ver de dónde salió esa cifra. Desde la 1.165.0 eso tiene dónde,
 * la cartola, y desde la 1.170.0 el clic lleva ahí.
 *
 * Lo que se vigila acá es la promesa que hace ese clic: que la cartola CIERRE en
 * la misma cifra que decía la fila. Si no, el clic lleva a otra pantalla que
 * habla de otra plata, y eso es peor que no llevar a ninguna parte.
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
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Clic QQ','TES-CLI2','Activa')")
  .run().lastInsertRowid;
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES ('General del Clic QQ','Iglesia local','General',?,'Activa',40000)`)
  .run(iglesia).lastInsertRowid;

const HOY = db.prepare("SELECT date('now','localtime') AS d").get().d;
const corrida = (dias) => db.prepare("SELECT date('now','localtime', ?) AS d").get(`${dias} days`).d;

const anotar = (fecha, tipo, monto, concepto) => db
  .prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES (?,?,'Ofrendas',?,?,?,?)`
  ).run(fecha, tipo, concepto, monto, cuenta, iglesia).lastInsertRowid;

anotar(corrida(-40), 'Ingreso', 300000, 'Lo de antes QQ');
anotar(corrida(-3), 'Egreso', 50000, 'Lo de la semana QQ');
anotar(HOY, 'Ingreso', 12000, 'Lo de hoy QQ');
anotar(corrida(60), 'Ingreso', 900000, 'Lo agendado QQ');

/** Corre una ruta de un módulo sin levantar el servidor. */
function ruta(modulo, cual) {
  let handler = null;
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; } };
  modulo.extraRoutes(router, {
    db,
    requirePerm: () => (req, res, next) => next(),
    scopeClause: () => null,
  });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (req) => {
    let cuerpo = null;
    handler(req, { json: (d) => { cuerpo = d; }, status: () => ({ json: (d) => { cuerpo = d; } }) });
    return cuerpo;
  };
}

const usuario = { id: 1, rol: 'admin' };
const resumen = ruta(tesoreria, '/tesoreria/resumen');
const cartola = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/cartola');

/* ------------------------------------- la promesa del clic */

test('la cartola cierra en la misma cifra que decía la fila', () => {
  const enLaFila = resumen({ user: usuario, query: {} })
    .porCuenta.find((c) => c.id === cuenta);
  const laCartola = cartola({ user: usuario, params: { id: String(cuenta) }, query: { hasta: HOY } });

  assert.equal(enLaFila.saldo, laCartola.saldo_final,
    'si no cierran en lo mismo, el clic lleva a una pantalla que habla de otra plata');
  assert.equal(laCartola.saldo_final, 40000 + 300000 - 50000 + 12000);
});

test('y lo agendado que la fila anuncia aparte, la cartola lo tiene adelante', () => {
  const enLaFila = resumen({ user: usuario, query: {} }).porCuenta.find((c) => c.id === cuenta);
  assert.equal(enLaFila.agendado, 900000);

  const todo = cartola({ user: usuario, params: { id: String(cuenta) }, query: {} });
  assert.equal(todo.saldo_final, enLaFila.saldo + enLaFila.agendado,
    'mirando TODO, la cartola llega hasta donde la fila dice que va a llegar');
});

test('la última fila de la cartola es su saldo final', () => {
  const c = cartola({ user: usuario, params: { id: String(cuenta) }, query: { hasta: HOY } });
  assert.equal(c.movimientos[c.movimientos.length - 1].saldo, c.saldo_final);
});

/* ------------------------------------------------------- la pantalla */

test('el clic en el saldo lleva a la cartola, no a editar la cuenta', () => {
  assert.match(app, /<li data-ir="#\/cuentas_tesoreria\/cartola\/\$\{c\.id\}"/);
  assert.doesNotMatch(app, /<li data-ir="#\/m\/cuentas_tesoreria\/edit\/\$\{c\.id\}"/,
    'ese era el destino viejo, el que llevaba al formulario');
});

test('editar la cuenta sigue a un clic desde la cartola', () => {
  assert.match(app, /id="carVolver">🏦 Ficha de la cuenta/);
  assert.match(app, /carVolver'\)\s*\n?\s*\.addEventListener\('click', \(\) => \(location\.hash = `#\/m\/cuentas_tesoreria\/edit\/\$\{cuentaId\}`\)\)/);
});

test('la cartola parte del año corriente, no de todo lo que haya', () => {
  /*
   * Con «Todo» de entrada, la cuenta general de la corporación traía 3.001
   * filas: 683 KB, 852 ms y una página de 96.495 px. Es la pantalla a la que
   * ahora se llega de un clic, así que no puede ser eso lo primero que aparece.
   * El botón «Todo» sigue estando.
   */
  assert.match(app, /desde: \(precarga && precarga\.desde\) \|\| `\$\{anio\}-01-01`/);
  assert.match(app, /hasta: \(precarga && precarga\.hasta\) \|\| `\$\{anio\}-12-31`/);
  assert.match(app, /id="carTodo"/, 'y ver todo sigue a un clic');
});
