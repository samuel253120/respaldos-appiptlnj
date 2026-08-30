/**
 * La cartola es la hoja que se compara con la del banco: su saldo final tiene
 * que ser el que está en el banco.
 *
 * Este sistema tiene una idea muy clara de qué es un saldo —«lo que hay hoy, no
 * lo que va a haber»— y la respetan el listado de cuentas, la ficha, el panel y
 * el informe de Tesorería. La respetaba todo, menos la cartola.
 *
 * Medido sobre la tesorería general de una iglesia con un servicio programado
 * para el 30 de noviembre y una ofrenda de $ 900.000:
 *
 *   saldo en el listado de cuentas ........  $ 0
 *   ficha de la cuenta ....................  $ 0, y aparte «agendado $ 810.000»
 *   cartola del año, saldo final ..........  $ 810.000
 *
 * Dos pantallas de la misma cuenta, el mismo día, con $ 810.000 de diferencia,
 * y las dos filas de noviembre corriendo el saldo hacia arriba sin marca
 * alguna. Como la cartola abre por año, basta un servicio programado más
 * adelante para que el número de abajo deje de cuadrar con nada.
 *
 * No se sacan de la hoja: quien programó ese servicio quiere poder verlo. Se
 * MARCAN y se dejan fuera del saldo, que es lo que ya hace el resto del sistema
 * con lo agendado (ver server/saldos.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De lo que Viene','IG-VIEN','Activa')").run().lastInsertRowid;
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
            VALUES ('General de lo que Viene', 'Iglesia local', 'General', ?, 'Activa', 50000, '2020-01-01')`)
  .run(iglesia).lastInsertRowid;

const anotar = (fecha, tipo, monto, concepto) => db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
            VALUES (?, ?, 'Ofrendas', ?, ?, ?, ?)`)
  .run(fecha, tipo, concepto, monto, cuenta, iglesia).lastInsertRowid;

const hoy = new Date();
const dia = (n) => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);
const ANIO = hoy.getFullYear();

/*
 * Lo que ya ocurrió, y lo que está anotado para más adelante. Se anotan A
 * PROPÓSITO en desorden —lo agendado primero, y lo más viejo al final—: el
 * saldo corre por FECHA y no por el orden en que se escribieron, y una prueba
 * que los inserte ya ordenados no distingue las dos cosas.
 */
const futuro1 = anotar(dia(30), 'Ingreso', 900000, 'Ofrenda del servicio programado');
anotar(dia(-10), 'Egreso', 100000, 'Cuenta de la luz');
const futuro2 = anotar(dia(30), 'Egreso', 90000, 'Aporte a la corporación (10%)');
anotar(dia(-40), 'Ingreso', 300000, 'Ofrenda de hace un mes');

/** Corre una ruta del módulo sin levantar el servidor. */
function ruta(cual) {
  let handler = null;
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; } };
  cuentasMod.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next(), scopeClause: () => null });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (req) => {
    let cuerpo = null; let codigo = 200;
    handler(req, { json: (d) => { cuerpo = d; }, status: (c) => { codigo = c; return { json: (d) => { cuerpo = d; } }; } });
    return { codigo, d: cuerpo };
  };
}
const cartola = ruta('/cuentas_tesoreria/:id(\\d+)/cartola');
const estado = ruta('/cuentas_tesoreria/:id(\\d+)/estado');
const usuario = { id: 1, rol: 'admin' };
const laDelAnio = () => cartola({ user: usuario, params: { id: String(cuenta) }, query: { desde: `${ANIO - 1}-01-01`, hasta: `${ANIO + 1}-12-31` } }).d;

// ------------------------------------------------ las dos pantallas, iguales ----

test('el saldo final de la cartola es el mismo que el de la ficha', () => {
  const d = laDelAnio();
  const e = estado({ user: usuario, params: { id: String(cuenta) }, query: {} }).d;
  assert.equal(d.saldo_final, 250000, '50.000 de partida + 300.000 − 100.000');
  assert.equal(d.saldo_final, e.saldo,
    'dos pantallas de la misma cuenta, el mismo día, no pueden decir cifras distintas');
});

test('y lo anotado para más adelante se dice aparte, con su fecha', () => {
  const d = laDelAnio();
  assert.equal(d.agendado, 810000, '900.000 que entran menos 90.000 que salen');
  assert.equal(d.movimientos_agendados, 2);
  assert.equal(d.agendado_desde, dia(30));
  const e = estado({ user: usuario, params: { id: String(cuenta) }, query: {} }).d;
  assert.equal(d.agendado, e.agendado, 'y coincide con lo que dice la ficha');
});

test('«Entró» y «Salió» tampoco cuentan lo que no ha llegado', () => {
  const d = laDelAnio();
  assert.equal(d.ingresos, 300000, 'no 1.200.000');
  assert.equal(d.egresos, 100000, 'no 190.000');
});

// --------------------------------------------------- las filas, en la hoja ----

test('las filas de más adelante siguen en la hoja: no se esconden', () => {
  const d = laDelAnio();
  assert.equal(d.movimientos.length, 4, 'quien programó ese servicio quiere poder verlo');
  assert.deepEqual(d.movimientos.map((m) => m.id).sort((a, b) => a - b),
    [...new Set(d.movimientos.map((m) => m.id))].sort((a, b) => a - b));
});

test('pero van marcadas, y sin saldo', () => {
  const d = laDelAnio();
  const porVenir = d.movimientos.filter((m) => m.agendado);
  const ocurridos = d.movimientos.filter((m) => !m.agendado);
  assert.deepEqual(porVenir.map((m) => m.id).sort((a, b) => a - b), [futuro1, futuro2].sort((a, b) => a - b));
  for (const m of porVenir) {
    assert.equal(m.saldo, null, 'ese saldo no existió nunca: escribirlo era lo que descuadraba la hoja');
    assert.ok(Number(m.monto) > 0, 'el monto sí se muestra: es lo que se va a recibir');
  }
  assert.equal(ocurridos[ocurridos.length - 1].saldo, 250000,
    'y el saldo que corre fila a fila se detiene en la última que ya ocurrió');
});

test('el saldo corre bien hasta ahí, sin saltarse ninguna', () => {
  const d = laDelAnio();
  let corriendo = d.saldo_anterior;
  for (const m of d.movimientos.filter((x) => !x.agendado)) {
    corriendo += m.tipo === 'Ingreso' ? Number(m.monto) : -Number(m.monto);
    assert.equal(m.saldo, corriendo, `la fila ${m.id} no cuadra`);
  }
  assert.equal(corriendo, d.saldo_final);
});

// ---------------------------------------------------------- los períodos ----

test('un período que no alcanza lo agendado no tiene nada que decir aparte', () => {
  const d = cartola({ user: usuario, params: { id: String(cuenta) }, query: { desde: dia(-60), hasta: dia(-5) } }).d;
  assert.equal(d.agendado, 0);
  assert.equal(d.movimientos_agendados, 0);
  assert.equal(d.agendado_desde, null);
  assert.equal(d.saldo_final, 250000);
});

test('el saldo anterior tampoco arrastra plata que no ha llegado', () => {
  /*
   * Una cartola pedida sobre un período que arranca más adelante: todo lo
   * «anterior» a esa fecha incluye lo agendado de en medio. Sin el corte, la
   * hoja empezaría contando plata que todavía no está.
   */
  const d = cartola({ user: usuario, params: { id: String(cuenta) }, query: { desde: dia(60), hasta: dia(90) } }).d;
  assert.equal(d.saldo_anterior, 250000, 'y no 1.060.000');
});

// ------------------------------------------------------------- la pantalla ----

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

test('la hoja lo dice: la insignia, la tarjeta y el pie', () => {
  const hoja = app.match(/async function viewCartolaCuenta[\s\S]*?\n\}/)[0];
  assert.match(hoja, /badge agendado/, 'la fila lleva su insignia');
  assert.match(hoja, /Agendado\$\{d\.agendado_desde/, 'y la tarjeta dice desde cuándo');
  assert.match(hoja, /El saldo es lo que hay hoy/, 'y el pie lo explica');
  assert.match(hoja, /Number\(mv\.agendado\)\n\s*\? '<span class="mut">—<\/span>'/,
    'a lo que no ocurrió no se le pinta saldo');
});

test('el concepto se parte en dos líneas, o las columnas de plata se van de la pantalla', () => {
  /*
   * La cartola usa la clase de los informes de asistencia, que deja todas las
   * celdas en una sola línea porque ahí son cortas. Acá el concepto es lo más
   * largo de la hoja y estiraba la tabla a 1.247 px dentro de una caja de 994:
   * medido en una ventana de 1.280, la columna «Saldo» terminaba en el píxel
   * 1.508. Con esto la tabla mide 994 y la columna termina en 1.255.
   */
  assert.match(css, /table\.grid\.informe\.cartola td\[data-label="Concepto"\] \{ white-space: normal; \}/);
  // Y con las tres clases, no con dos: escrito `table.cartola td[...]` empata
  // en especificidad con la regla de los informes y pierde por ir más arriba
  assert.doesNotMatch(css, /\n\s*table\.cartola td\[data-label="Concepto"\]/);
});
