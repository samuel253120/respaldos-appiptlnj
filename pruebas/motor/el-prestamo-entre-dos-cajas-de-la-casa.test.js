/**
 * Cuando una parte de la organización le presta a otra.
 *
 * La corporación contestó que sí, que las cajas se prestan entre sí: la
 * corporación le adelanta a una iglesia, una iglesia le presta a un cuerpo para
 * comprar sillas. No había manera de anotarlo —«Con quién es» ofrecía solo una
 * persona o una institución— así que se escribía el nombre de la otra caja en
 * el campo de institución, y entonces pasaba esto:
 *
 *   la caja que RECIBE, antes ......... $  50.000
 *   la caja que PRESTA, antes ......... $ 100.000
 *   se anota el préstamo de $ 400.000
 *   la caja que RECIBE, después ....... $ 450.000
 *   la caja que PRESTA, después ....... $ 100.000  ← no se movió
 *
 * La que prestó seguía mostrando una plata que ya no tenía, y el total de la
 * organización subía $ 400.000 que nadie le había entregado a nadie.
 *
 * Un préstamo entre dos partes de la misma casa no hace entrar plata: la cambia
 * de bolsillo. Así que cada movimiento de una deuda interna lleva SU ESPEJO en
 * la otra caja, con el signo contrario, y los dos marcados como traslado —que
 * es el mecanismo que el sistema ya tenía para el aporte de una ofrenda y para
 * los dos lados de un traspaso, ver server/entre-cuentas.js—.
 *
 * Lo que más se cuida acá es que NADA SE CUENTE DOS VECES: las dos filas llevan
 * la misma deuda y la misma cuota, así que cualquier suma que las tome a las
 * dos daría la deuda por saldada con la mitad.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const deudaTesoreria = require('../../server/deuda-tesoreria');
const { OTRA_CAJA, UNA_PERSONA, POR_PAGAR } = require('../../server/modules/deudas');
const { planDe } = require('../../server/plan-de-cuotas');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia con dos cajas: la que presta y la que recibe. */
function dosCajas({ saldoPresta = 100000, saldoRecibe = 50000 } = {}) {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia presta ${m}`, `PRES${m}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo presta ${m}`, iglesia).lastInsertRowid;
  const caja = (nombre, saldo, cuerpoId) => db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
              VALUES (?, ?, 'General', ?, ?, 'Activa', ?)`)
    .run(nombre, cuerpoId ? 'Cuerpo' : 'Iglesia local', iglesia, cuerpoId || null, saldo).lastInsertRowid;

  return {
    m, iglesia, cuerpo,
    presta: caja(`Caja que presta ${m}`, saldoPresta, null),
    recibe: caja(`Caja que recibe ${m}`, saldoRecibe, cuerpo),
  };
}

/** El saldo de una caja: su saldo inicial más lo que le entró menos lo que salió. */
function saldo(cuentaId) {
  const c = db.prepare('SELECT saldo_inicial FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  const s = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END), 0) AS m
         FROM tesoreria WHERE cuenta_id = ?`
    )
    .get(cuentaId);
  return Number(c.saldo_inicial || 0) + Number(s.m || 0);
}

const unPrestamoInterno = (c, extra = {}) => ({
  cuenta_id: c.recibe, direccion: POR_PAGAR, clase: 'Préstamo en dinero',
  concepto: `Préstamo interno ${c.m}`, monto: 400000, fecha: '2026-08-01',
  cuotas: 2, primera_cuota: '2026-09-01',
  contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.presta,
  estado: 'Vigente', igual_asi: true, ...extra,
});

const movimientosDe = (deudaId) =>
  db.prepare('SELECT * FROM tesoreria WHERE deuda_id = ? ORDER BY id').all(deudaId);

// ------------------------------------------------- la plata se mueve en las dos ----

test('un préstamo entre dos cajas mueve las dos, no una', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();

  const r = await api('POST', '/deudas', unPrestamoInterno(c));
  assert.equal(r.estado, 201);
  assert.equal(saldo(c.recibe), 450000, 'a la que recibe le entraron los $ 400.000');
  assert.equal(saldo(c.presta), -300000,
    'y de la que presta salieron: seguía mostrando una plata que ya no tenía');
});

test('los dos movimientos van marcados como traslado, y emparejados', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;

  const movs = movimientosDe(id);
  assert.equal(movs.length, 2, 'uno por caja');
  assert.ok(movs.every((mv) => mv.entre_cuentas === 1),
    'sin la marca, el resumen los sumaría como plata que entró y salió de verdad');
  assert.equal(movs[0].espejo_de, movs[0].id, 'el original se apunta a sí mismo');
  assert.equal(movs[1].espejo_de, movs[0].id, 'y el espejo apunta al original');
  assert.notEqual(movs[0].tipo, movs[1].tipo, 'con el signo contrario');
  assert.equal(movs[0].monto, movs[1].monto);
});

test('una deuda con una persona sigue moviendo una sola caja', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const r = await api('POST', '/deudas', unPrestamoInterno(c, {
    contraparte_tipo: UNA_PERSONA, contraparte: 'Un hermano', contraparte_cuenta_id: null,
  }));
  assert.equal(r.estado, 201);

  const movs = movimientosDe(r.json.id);
  assert.equal(movs.length, 1, 'esa plata sí entró a la organización: no hay otro lado que mover');
  assert.equal(saldo(c.presta), 100000, 'la otra caja no se toca');
});

// -------------------------------------------------------- lo que no se permite ----

test('una caja no se presta a sí misma', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const r = await api('POST', '/deudas', unPrestamoInterno(c, { contraparte_cuenta_id: c.recibe }));

  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no se presta a sí misma/,
    'dejarlo pasar deja dos movimientos que se anulan sobre el mismo saldo');
});

test('hay que decir cuál es la otra caja', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const r = await api('POST', '/deudas', unPrestamoInterno(c, { contraparte_cuenta_id: null }));

  assert.equal(r.estado, 400);
  assert.match(r.json.error, /con qué caja/);
});

test('y tiene que existir, aunque de eso se encargue el motor', async () => {
  /*
   * Esta la protege el MOTOR, que rechaza toda referencia rota antes de llegar
   * al gancho del módulo. Se comprueba igual —lo que importa es que no se
   * guarde— y queda dicho de quién es el trabajo: el gancho tenía una línea
   * que lo comprobaba otra vez y no defendía nada.
   */
  const api = await elSistemaAndando();
  const c = dosCajas();
  const r = await api('POST', '/deudas', unPrestamoInterno(c, { contraparte_cuenta_id: 99999999 }));

  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no existe cuenta de tesorer/, 'y con el mensaje del motor, que dice cuál');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM deudas WHERE concepto = ?')
    .get(`Préstamo interno ${c.m}`).n, 0, 'no se guardó nada');
});

// ------------------------------------------------------ pagar, corregir, borrar ----

test('pagar una cuota devuelve la plata a la caja que prestó', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(id)[0];

  const r = await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: '2026-09-01', monto: 200000, metodo: 'Transferencia',
  });
  assert.equal(r.estado, 201);
  assert.equal(saldo(c.recibe), 250000, 'de la que debía salieron los $ 200.000');
  assert.equal(saldo(c.presta), -100000, 'y a la que prestó le volvieron');
});

test('lo pagado se cuenta UNA vez, no dos', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(id)[0];
  await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: '2026-09-01', monto: 200000, metodo: 'Transferencia',
  });

  const deuda = db.prepare('SELECT * FROM deudas WHERE id = ?').get(id);
  const { resumen } = planDe(db, deuda);
  assert.equal(resumen.falta, 200000,
    'las dos filas llevan la misma cuota: sumándolas, la deuda se daría por saldada con la mitad');
  assert.equal(deudaTesoreria.losPagosDe(db, id).length, 1, 'y es un pago, no dos');
});

test('retirar el pago se lleva los dos movimientos', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(id)[0];
  const pago = (await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: '2026-09-01', monto: 200000, metodo: 'Transferencia',
  })).json;

  const r = await api('DELETE', `/deudas/${id}/pagos/${pago.movimiento_id || pago.id}`);
  assert.equal(r.estado, 200);
  assert.equal(saldo(c.recibe), 450000, 'vuelve a deber todo');
  assert.equal(saldo(c.presta), -300000);
});

test('borrar la deuda se lleva el espejo del desembolso', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;

  const r = await api('DELETE', `/deudas/${id}?igual_asi=1`);
  assert.equal(r.estado, 200);
  assert.equal(movimientosDe(id).length, 0,
    'un movimiento de un par no se va solo: quedaría moviéndole el saldo a una caja por una deuda que ya no existe');
  assert.equal(saldo(c.presta), 100000, 'la caja que prestó vuelve a donde estaba');
  assert.equal(saldo(c.recibe), 50000);
});

test('cambiarle la contraparte a una persona retira el espejo', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;

  const r = await api('PUT', `/deudas/${id}`, {
    contraparte_tipo: UNA_PERSONA, contraparte: 'Un hermano', igual_asi: true,
  });
  assert.equal(r.estado, 200);
  assert.equal(movimientosDe(id).length, 1, 'ya no hay otro lado que mover');
  assert.equal(saldo(c.presta), 100000, 'y la caja que había prestado vuelve a su saldo');
  assert.equal(db.prepare('SELECT entre_cuentas FROM tesoreria WHERE deuda_id = ?').get(id).entre_cuentas, 0,
    'ni sigue marcada como traslado: esa plata sí entró a la organización');
});

test('corregirle el monto corrige los dos lados', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;

  const r = await api('PUT', `/deudas/${id}`, { monto: 300000, igual_asi: true });
  assert.equal(r.estado, 200);
  const movs = movimientosDe(id);
  assert.deepEqual(movs.map((mv) => mv.monto), [300000, 300000],
    'si solo se corrigiera uno, las dos cajas dirían cosas distintas de la misma plata');
  assert.equal(saldo(c.recibe), 350000);
  assert.equal(saldo(c.presta), -200000);
});

// ------------------------------------------------- y cómo se lee en la pantalla ----

test('«Con quién» dice el nombre de la otra caja', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;

  const r = await api('GET', `/deudas/${id}`);
  assert.equal(r.estado, 200);
  assert.ok(String(r.json.quien).includes(`Caja que presta ${c.m}`),
    'quien mira una lista de deudas pregunta «¿con quién?», y acá la respuesta es una caja');
});

test('el nombre de la caja no se guarda copiado', async () => {
  const api = await elSistemaAndando();
  const c = dosCajas();
  const id = (await api('POST', '/deudas', unPrestamoInterno(c))).json.id;
  db.prepare('UPDATE cuentas_tesoreria SET nombre = ? WHERE id = ?').run(`Renombrada ${c.m}`, c.presta);

  const r = await api('GET', `/deudas/${id}`);
  assert.ok(String(r.json.quien).includes(`Renombrada ${c.m}`),
    'una caja que se renombra se renombra en todas partes: por eso es una referencia y no un texto');
});
