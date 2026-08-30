/**
 * El papel que se lleva a la reunión.
 *
 * El módulo guardaba bien y devolvía poco: un traspaso se imprimía y un
 * movimiento no; no había ninguna pantalla que armara el balance del mes —lo
 * que entró, lo que salió, por categoría, cuenta por cuenta—; y «cuánto había
 * en la cuenta del proyecto al 30 de junio» no se podía preguntar de ninguna
 * forma. El balance se terminaba armando a mano en una planilla aparte, y una
 * suma hecha a mano cada mes es una suma que alguna vez sale mal sin que nadie
 * pueda comprobarlo.
 *
 * Lo que se vigila acá: que las tres maneras de partir el total —por mes, por
 * categoría y por cuenta— sumen exactamente el total, que sigan descontando la
 * plata que solo cambió de bolsillo, y que la cartola de una cuenta empiece en
 * el saldo que de verdad tenía y termine cuadrando fila a fila.
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
const entreCuentas = require('../../server/entre-cuentas');
const { sincronizarOfrenda } = require('../../server/ofrenda-tesoreria');
const traspasos = require('../../server/modules/traspasos');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Papel UU','TES-PAP','Activa')")
  .run().lastInsertRowid;
const cuenta = (nombre, tipo, iglesiaId, saldoInicial = 0) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES (?,?,?,?,'Activa',?)`)
  .run(nombre, iglesiaId ? 'Iglesia local' : 'Corporación', tipo, iglesiaId || null, saldoInicial).lastInsertRowid;

const general = cuenta('General del Papel UU', 'General', iglesia, 50000);
const fondo = cuenta('Fondo del Papel UU', 'Fondo para la corporación', iglesia);
const corp = cuenta('Corporación del Papel UU', 'General', null);

const anotar = (cuentaId, fecha, tipo, categoria, monto, concepto) => db
  .prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES (?,?,?,?,?,?,?)`
  ).run(fecha, tipo, categoria, concepto, monto, cuentaId, iglesia).lastInsertRowid;

/*
 * Algo de un año anterior, fuera de todo lo que se va a pedir. Está para que un
 * informe que se olvidara del período no diera por casualidad las mismas cifras
 * que uno que lo respeta: sin esta fila, «todo» y «2026» serían lo mismo y una
 * prueba que compare los dos no probaría nada.
 */
anotar(general, '2025-11-05', 'Ingreso', 'Diezmos', 777000, 'Del año anterior UU');

// Enero: entran 100.000 y salen 30.000. Febrero: entran 60.000 y salen 10.000
anotar(general, '2026-01-10', 'Ingreso', 'Diezmos', 100000, 'Diezmos de enero UU');
anotar(general, '2026-01-20', 'Egreso', 'Compras', 30000, 'Compras de enero UU');
anotar(general, '2026-02-14', 'Ingreso', 'Diezmos', 60000, 'Diezmos de febrero UU');
anotar(general, '2026-02-18', 'Egreso', 'Servicios básicos', 10000, 'Luz de febrero UU');

// Y una ofrenda con su aporte, más el traspaso: plata que solo cambia de bolsillo
const servicio = db
  .prepare(
    `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_fondo, ofrenda_iglesia)
     VALUES ('2026-02-22','Servicio General',?,80000,8000,72000)`
  ).run(iglesia).lastInsertRowid;
sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicio), db);
const traspaso = db
  .prepare(
    `INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
     VALUES ('2026-02-25',?,?,8000,'Transferencia','Aporte UU',?)`
  ).run(fondo, corp, iglesia).lastInsertRowid;
traspasos.hooks.afterSave(db.prepare('SELECT * FROM traspasos WHERE id = ?').get(traspaso), { db });

const DENTRO = {
  where: 'WHERE cuenta_id IN (?, ?, ?) AND fecha >= ? AND fecha <= ?',
  params: [general, fondo, corp, '2026-01-01', '2026-12-31'],
};
const total = entreCuentas.totalesDe(db, DENTRO.where, DENTRO.params);

/* ------------------------------------------- las tres maneras de partir el total */

test('los meses suman exactamente el total', () => {
  const meses = entreCuentas.porMesDe(db, DENTRO.where, DENTRO.params);
  assert.deepEqual(meses.map((m) => m.mes), ['2026-01', '2026-02']);
  const suma = meses.reduce((a, m) => ({ i: a.i + m.ingresos, e: a.e + m.egresos }), { i: 0, e: 0 });
  assert.equal(suma.i, total.ingresos);
  assert.equal(suma.e, total.egresos);
});

test('las categorías suman exactamente el total', () => {
  const cats = entreCuentas.porCategoriaDe(db, DENTRO.where, DENTRO.params);
  const suma = cats.reduce((a, c) => (c.tipo === 'Ingreso'
    ? { ...a, i: a.i + c.total } : { ...a, e: a.e + c.total }), { i: 0, e: 0 });
  assert.equal(suma.i, total.ingresos);
  assert.equal(suma.e, total.egresos);
});

test('las cuentas suman exactamente el total', () => {
  const ctas = entreCuentas.porCuentaDe(db, DENTRO.where, DENTRO.params);
  const suma = ctas.reduce((a, c) => ({ i: a.i + c.ingresos, e: a.e + c.egresos }), { i: 0, e: 0 });
  assert.equal(suma.i, total.ingresos);
  assert.equal(suma.e, total.egresos);
});

test('y las tres descuentan la plata que solo cambió de bolsillo', () => {
  // Entró de verdad: 100.000 + 60.000 + 80.000 de ofrenda = 240.000
  assert.equal(total.ingresos, 240000, 'sin descontar serían 256.000: el aporte entra dos veces');
  assert.equal(total.movido, 16000, 'el aporte al fondo y el traspaso, $8.000 cada uno');
  const febrero = entreCuentas.porMesDe(db, DENTRO.where, DENTRO.params).find((m) => m.mes === '2026-02');
  assert.equal(febrero.ingresos, 140000, '60.000 de diezmos y 80.000 de ofrenda');
  assert.equal(febrero.movido, 16000, 'los dos traslados son de febrero');
});

test('cada cuenta aparece con su nombre y su nivel', () => {
  const ctas = entreCuentas.porCuentaDe(db, DENTRO.where, DENTRO.params);
  const suya = ctas.find((c) => c.id === general);
  assert.equal(suya.nombre, 'General del Papel UU');
  assert.equal(suya.ambito, 'Iglesia local');
  assert.ok(suya.movimientos > 0);
});

/* --------------------------------------------------------------- la cartola */

/** Corre una ruta del módulo de cuentas sin levantar el servidor. */
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
    let cuerpo = null; let codigo = 200;
    handler(req, {
      json: (d) => { cuerpo = d; },
      status: (c) => { codigo = c; return { json: (d) => { cuerpo = d; } }; },
    });
    return { codigo, d: cuerpo };
  };
}

const cartola = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/cartola');
/*
 * El rol como lo guarda la base, no como se lee en pantalla.
 *
 * Decía 'Administrador', que es la ETIQUETA del rol; el valor es 'admin' (ver
 * ROLES en server/permissions.js). Nada se quejaba porque estas pruebas
 * reemplazan `requirePerm` por un pasar de largo, así que las rutas nunca le
 * preguntaban nada a este usuario. Desde la 1.212.0 sí: la cartola le pregunta
 * si alcanza la llave de los montos, y un rol que no existe no alcanza ninguna.
 */
const usuario = { id: 1, rol: 'admin' };

test('la cartola de febrero empieza en el saldo que de verdad había', () => {
  const { d } = cartola({ user: usuario, params: { id: String(general) }, query: { desde: '2026-02-01', hasta: '2026-02-28' } });
  /*
   * Saldo inicial 50.000, más los 777.000 de noviembre de 2025, más lo de enero
   * —entraron 100.000 y salieron 30.000—. El saldo anterior alcanza TODO lo de
   * antes del período, no el mes anterior: una cartola que solo mirara para
   * atrás un mes empezaría en una cifra que no existió nunca.
   */
  assert.equal(d.saldo_anterior, 897000, 'y esto contesta «cuánto había al 31 de enero»');
});

test('el saldo corre fila a fila y la última cuadra con el saldo final', () => {
  const { d } = cartola({ user: usuario, params: { id: String(general) }, query: { desde: '2026-02-01', hasta: '2026-02-28' } });
  assert.ok(d.movimientos.length >= 3);
  const ultimo = d.movimientos[d.movimientos.length - 1];
  assert.equal(ultimo.saldo, d.saldo_final);
  assert.equal(d.saldo_final, d.saldo_anterior + d.ingresos - d.egresos);

  // Y cada fila es la anterior más o menos lo suyo
  let corriendo = d.saldo_anterior;
  for (const mv of d.movimientos) {
    corriendo += mv.tipo === 'Ingreso' ? Number(mv.monto) : -Number(mv.monto);
    assert.equal(mv.saldo, corriendo, `la fila ${mv.id} no sigue a la anterior`);
  }
});

test('sin período, la cartola parte del saldo inicial de la cuenta', () => {
  const { d } = cartola({ user: usuario, params: { id: String(general) }, query: {} });
  assert.equal(d.saldo_anterior, 50000, 'el saldo inicial, sin nada anterior que sumarle');
  assert.equal(d.saldo_inicial, 50000);
});

test('la cartola incluye los traslados: es el libro de la cuenta, no el balance', () => {
  const { d } = cartola({ user: usuario, params: { id: String(fondo) }, query: {} });
  assert.ok(d.movimientos.some((mv) => Number(mv.entre_cuentas) === 1),
    'la cartola se compara con la del banco, y en el banco esos movimientos están');
});

test('una cuenta que no existe da 404, no una cartola vacía', () => {
  const { codigo, d } = cartola({ user: usuario, params: { id: '999999' }, query: {} });
  assert.equal(codigo, 404);
  assert.match(d.error, /no encontrada/i);
});

/* ------------------------------------------------------------- el informe */

const informe = ruta(tesoreria, '/tesoreria/informe');

test('el informe trae las cuatro cosas con las que se arma un balance', () => {
  const { d } = informe({ user: usuario, query: { desde: '2026-01-01', hasta: '2026-12-31' } });
  assert.ok(d.resumen && d.porMes && d.porCategoria && d.porCuenta);
  assert.equal(d.desde, '2026-01-01');
  assert.equal(d.hasta, '2026-12-31');
});

test('el informe y el resumen de la pantalla dicen lo mismo del mismo período', () => {
  const req = { user: usuario, query: { desde: '2026-01-01', hasta: '2026-12-31' } };
  const { d: inf } = informe(req);
  const { d: res } = ruta(tesoreria, '/tesoreria/resumen')(req);
  assert.equal(inf.resumen.ingresos, res.ingresos, 'la hoja impresa no puede discrepar de la pantalla');
  assert.equal(inf.resumen.egresos, res.egresos);
  assert.equal(inf.resumen.movido, res.movido);
});

test('el informe respeta el período: lo del año anterior no entra', () => {
  const { d } = informe({ user: usuario, query: { desde: '2026-01-01', hasta: '2026-12-31' } });
  assert.ok(!d.porMes.some((m) => m.mes.startsWith('2025')), 'noviembre de 2025 quedó fuera');
  const { d: todo } = informe({ user: usuario, query: {} });
  assert.ok(todo.porMes.some((m) => m.mes === '2025-11'), 'y sin período, sí está');
  assert.equal(todo.resumen.ingresos - d.resumen.ingresos, 777000);
});

/* ------------------------------------------------------------ la pantalla */

test('un movimiento ahora se puede imprimir, como ya se imprimía un traspaso', () => {
  assert.equal(tesoreria.printable, true);
  assert.match(app, /function printMovimiento\(/);
  assert.match(app, /name === 'tesoreria'\) sheet = printMovimiento/);
  assert.match(app, /Comprobante de \$\{esEgreso \? 'egreso' : 'ingreso'\}/);
});

test('las dos pantallas nuevas existen y se llega a ellas', () => {
  assert.match(app, /function viewBalanceTesoreria\(/);
  assert.match(app, /function viewCartolaCuenta\(/);
  assert.match(app, /id="btnBalance"/, 'el botón en el listado de Tesorería');
  assert.match(app, /id="btnCartola"/, 'el botón en la ficha de la cuenta');
  assert.match(app, /#\/tesoreria\/balance/);
  assert.match(app, /#\/cuentas_tesoreria\/cartola\//);
});
