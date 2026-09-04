/**
 * LOS PAGOS DE UNA DEUDA SIGUEN A SU DEUDA, COMO EL DESEMBOLSO.
 *
 * Al guardar, el módulo ponía al día el DESEMBOLSO —su monto, su fecha, su caja
 * y su signo— y no volvía a mirar los PAGOS, que también son movimientos suyos.
 *
 * MEDIDO en la v1.355.0, con un préstamo de $ 200.000 y un pago de $ 100.000
 * anotado; tres correcciones corrientes dejaban el libro diciendo algo que no
 * pasó:
 *
 *   «Por pagar» → «Por cobrar»   el desembolso se daba vuelta y el pago no: los
 *                                dos quedaban Egreso, y la caja perdía $ 300.000
 *                                por un préstamo de $ 200.000
 *   se muda de caja              el desembolso se mudaba, el pago se quedaba
 *   deja de ser entre dos cajas  el espejo del desembolso se retiraba y el del
 *                                pago se quedaba: $ 200.000 de ingreso fantasma
 *                                en la otra caja, para siempre
 *
 * Las tres son de las que se hacen a la semana de anotar algo: me equivoqué de
 * caja, era al revés, la deuda no era con la corporación.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

const MARCA = `s${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del arrastre ${MARCA}`, `IG-DS${process.pid}`.slice(0, 12)).lastInsertRowid;

const unaCaja = (nombre) => db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`${nombre} ${MARCA}`, iglesia).lastInsertRowid;

const CAJA = unaCaja('Caja de la deuda');

/** Una deuda con un pago ya anotado. Devuelve la ficha. */
async function unaDeudaConUnPago(api, extra) {
  const d = await api('POST', '/deudas', Object.assign({
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Deuda ${MARCA}`,
    monto: 200000, fecha: '2026-03-02', cuotas: 2, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente', igual_asi: true,
  }, extra));
  assert.equal(d.estado, 201, d.texto.slice(0, 220));
  const plan = (await api('GET', `/deudas/${d.json.id}/plan`)).json;
  const p = await api('POST', `/deudas/${d.json.id}/pagos`, {
    monto: 100000, fecha: '2026-09-01', cuota_id: plan.cuotas[0].id, igual_asi: true,
  });
  assert.equal(p.estado, 201, p.texto.slice(0, 220));
  return d.json;
}

const movimientosDe = (deudaId) =>
  db.prepare('SELECT * FROM tesoreria WHERE deuda_id = ? ORDER BY desembolso DESC, id').all(deudaId);
const elPagoDe = (deudaId) =>
  db.prepare('SELECT * FROM tesoreria WHERE deuda_id = ? AND desembolso = 0 AND (espejo_de IS NULL OR espejo_de = id)').get(deudaId);

/* ─────────────────────── darle vuelta la dirección ────────────────────── */

test('dar vuelta una deuda con pagos pregunta antes', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeudaConUnPago(api);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, direccion: 'Por cobrar' });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 200 sin una palabra (${r.texto.slice(0, 160)})`);
  assert.ok(r.json.confirmar, 'no es un rechazo: dar vuelta una deuda mal anotada hay que poder hacerlo');
  assert.match(r.json.confirmar, /1 pago\(s\) por \$ 100\.000/);
  assert.match(r.json.confirmar, /la fecha, el monto, el método/, 'y dice qué NO se toca');

  assert.equal(elPagoDe(d.id).tipo, 'Egreso', 'mientras no conteste, no cambió nada');
});

test('y al confirmar, el pago se da vuelta con ella', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeudaConUnPago(api);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, direccion: 'Por cobrar', igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));

  const movs = movimientosDe(d.id);
  const desembolso = movs.find((m) => m.desembolso);
  const pago = movs.find((m) => !m.desembolso);
  assert.equal(desembolso.tipo, 'Egreso', 'lo prestamos nosotros: sale');
  assert.equal(pago.tipo, 'Ingreso', 'y lo que nos devuelven, entra');
  assert.notEqual(desembolso.tipo, pago.tipo,
    'medido antes: los dos quedaban Egreso y la caja perdía $ 300.000 por un préstamo de $ 200.000');
  assert.equal(pago.categoria, 'Cobro de préstamos', 'y con la categoría del lado nuevo');
});

/* ───────────────────────────── mudarse de caja ────────────────────────── */

test('al mudar la deuda de caja, sus pagos se mudan con ella', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeudaConUnPago(api);
  const otra = unaCaja('Caja nueva de la deuda');

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, cuenta_id: otra });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));

  for (const m of movimientosDe(d.id)) {
    assert.equal(m.cuenta_id, otra,
      'medido antes: el desembolso se mudaba y el pago se quedaba cargándole el egreso a la caja vieja');
    assert.equal(m.iglesia_id, iglesia, 'con la iglesia de la caja nueva');
  }
});

/* ────────────────── dejar de ser una deuda entre dos cajas ────────────── */

test('si la deuda deja de ser entre dos cajas, el espejo del pago también se retira', async () => {
  const api = await elSistemaAndando();
  const otra = unaCaja('La que presta');
  const d = await unaDeudaConUnPago(api, {
    concepto: `Adelanto interno ${MARCA}`,
    contraparte_tipo: 'Otra caja de la organización', contraparte_cuenta_id: otra,
    institucion: null,
  });

  assert.equal(movimientosDe(d.id).length, 4, 'con los dos lados puestos son cuatro filas');

  const r = await api('PUT', `/deudas/${d.id}`, {
    ...d, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur', contraparte_cuenta_id: null,
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));

  const quedan = movimientosDe(d.id);
  assert.equal(quedan.length, 2,
    'medido antes: quedaban tres, y la de más eran $ 200.000 de ingreso fantasma en la otra caja');
  for (const m of quedan) {
    assert.equal(m.cuenta_id, CAJA);
    assert.equal(m.espejo_de, null, 'y ninguno queda marcado como mitad de un par');
  }
});

/* ───────────────────── lo que NO se toca de cada pago ─────────────────── */

test('de cada pago no se toca lo que dice de sí mismo', async () => {
  /*
   * La fecha, el monto, el método y a qué cuota se imputó son el HECHO: lo que
   * de verdad se pagó ese día. No cambian porque la ficha se corrija; lo que
   * cambia es dónde y de qué lado queda anotado.
   */
  const api = await elSistemaAndando();
  const d = await unaDeudaConUnPago(api);
  const antes = elPagoDe(d.id);

  await api('PUT', `/deudas/${d.id}`, { ...d, direccion: 'Por cobrar', igual_asi: true });
  const despues = elPagoDe(d.id);

  assert.equal(despues.fecha, antes.fecha);
  assert.equal(despues.monto, antes.monto);
  assert.equal(despues.metodo, antes.metodo);
  assert.equal(despues.cuota_id, antes.cuota_id);
  assert.equal(despues.concepto, antes.concepto);
});

test('y una deuda sin pagos se da vuelta sin preguntar nada', async () => {
  const api = await elSistemaAndando();
  const d = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Recién creada ${MARCA}`,
    monto: 200000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente',
  });
  assert.equal(d.estado, 201, d.texto.slice(0, 220));

  const r = await api('PUT', `/deudas/${d.json.id}`, { ...d.json, direccion: 'Por cobrar' });
  assert.equal(r.estado, 200, 'es corregir un error de tecleo, no reescribir plata anotada');
});
