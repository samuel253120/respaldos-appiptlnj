/**
 * ENTREGAR UN PRÉSTAMO TAMBIÉN PREGUNTA SI DEJA LA CAJA EN ROJO.
 *
 * El módulo cerró esta puerta a conciencia para los pagos, y lo dejó escrito en
 * la ruta que los anota: «si no, pagar desde el plan sería la manera de
 * saltarse lo que el formulario frena». La puerta que quedaba abierta era la
 * del propio formulario, y mueve MÁS plata: el desembolso —la entrega del
 * préstamo— lo escribe el guardado de la ficha, derecho en Tesorería.
 *
 * MEDIDO en la v1.355.0, contra el sistema andando, misma caja y mismo día:
 *
 *   un pago de $ 99.000.000 desde el plan ......... 400 · pregunta antes
 *   un préstamo entregado de $ 5.900.000 .......... 201 · sin preguntar nada
 *
 * La caja tenía $ 900.000 y quedó en $ -5.000.000, con un 201 y sin una
 * palabra. Los pagos van de a poco; la entrega va entera, así que es el
 * movimiento más grande que una deuda hace.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

/** Los archivos del motor comparten UNA base y corren en paralelo. */
const MARCA = `q${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia de la deuda ${MARCA}`, `IG-DQ${process.pid}`.slice(0, 12)).lastInsertRowid;

const unaCaja = (nombre, saldo) => db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', ?)`
  ).run(`${nombre} ${MARCA}`, iglesia, saldo).lastInsertRowid;

/** Una caja propia y con poco: las de la base son de todos los archivos. */
const CAJA = unaCaja('Caja con poco', 900000);

const unaDeuda = (api, extra) => api('POST', '/deudas', Object.assign({
  direccion: 'Por cobrar', clase: 'Préstamo en dinero', concepto: `Préstamo ${MARCA}`,
  monto: 100000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
  cuenta_id: CAJA, contraparte_tipo: 'Una persona', contraparte: 'Un hermano',
  estado: 'Vigente',
}, extra));

const saldoDe = (id) => db
  .prepare("SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END), 0) AS s FROM tesoreria WHERE cuenta_id = ?")
  .get(id).s;

/* ─────────────────────────────── se pregunta ──────────────────────────── */

test('prestar más de lo que hay en la caja pregunta antes', async () => {
  const api = await elSistemaAndando();
  const r = await unaDeuda(api, { monto: 5900000, concepto: `Le prestamos de más ${MARCA}` });

  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 201 (${r.texto.slice(0, 160)})`);
  assert.ok(r.json.confirmar, 'no es un rechazo: es la misma pregunta que hace un egreso corriente');
  assert.match(r.json.error, /en rojo|-|\$/, 'y dice en cuánto queda la caja');
  assert.match(r.json.error, /préstamo entregado/i, 'llamándolo por lo que es');
});

test('y mientras no conteste, la caja no se mueve', async () => {
  const api = await elSistemaAndando();
  const antes = saldoDe(CAJA);
  await unaDeuda(api, { monto: 4000000, concepto: `El que no se confirmó ${MARCA}` });
  assert.equal(saldoDe(CAJA), antes, 'la caja quedó en $ -5.000.000 en la medición anterior');
});

test('al confirmar, se guarda igual: una caja puede quedar en rojo de verdad', async () => {
  const api = await elSistemaAndando();
  const r = await unaDeuda(api, {
    monto: 3000000, concepto: `El que sí se confirmó ${MARCA}`, igual_asi: true,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  db.prepare('DELETE FROM tesoreria WHERE deuda_id = ?').run(r.json.id);
  db.prepare('DELETE FROM cuotas_deuda WHERE deuda_id = ?').run(r.json.id);
  db.prepare('DELETE FROM deudas WHERE id = ?').run(r.json.id);
});

/* ────────────────── la caja que pierde no siempre es la de la ficha ───── */

test('en un préstamo entre dos cajas se mira la que PRESTA, no la que recibe', async () => {
  /*
   * «Por pagar» con otra caja de la organización: la plata entra a la caja de
   * la ficha y sale de la otra. Mirar solo la de la ficha sería mirar la que
   * gana.
   */
  const api = await elSistemaAndando();
  const laQuePresta = unaCaja('Caja que presta poco', 50000);
  const laQueRecibe = unaCaja('Caja que recibe', 0);

  const r = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Adelanto interno ${MARCA}`,
    monto: 2000000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
    cuenta_id: laQueRecibe, contraparte_tipo: 'Otra caja de la organización',
    contraparte_cuenta_id: laQuePresta, estado: 'Vigente',
  });
  assert.equal(r.estado, 400, `la que presta tiene $ 50.000 (${r.texto.slice(0, 160)})`);
  assert.match(r.json.error, /sale de la otra caja/);
});

/* ─────────────────────────── lo que no pregunta nada ──────────────────── */

test('recibir un préstamo no pregunta: entra plata, no sale', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Nos prestan ${MARCA}`,
    monto: 9000000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una persona', contraparte: 'Un hermano',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('una compra a crédito tampoco: no mueve un peso al contraerse', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Compra a crédito', concepto: `Sillas a crédito ${MARCA}`,
    monto: 9000000, fecha: '2026-03-02', cuotas: 6, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Muebles del Sur',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 201, 'llega la cosa y queda el compromiso: la caja no se toca');
});

test('y corregirle una coma a una deuda ya guardada no vuelve a preguntar', async () => {
  /*
   * Su propio desembolso ya está en el saldo de la caja. Si la comprobación no
   * lo descontara, cualquier corrección lo contaría dos veces y preguntaría
   * por una plata que no se está moviendo de nuevo.
   */
  const api = await elSistemaAndando();
  const caja = unaCaja('Caja del que ya está', 100000);
  const creada = await api('POST', '/deudas', {
    direccion: 'Por cobrar', clase: 'Préstamo en dinero', concepto: `El que ya está ${MARCA}`,
    monto: 80000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
    cuenta_id: caja, contraparte_tipo: 'Una persona', contraparte: 'Un hermano',
    estado: 'Vigente',
  });
  assert.equal(creada.estado, 201, creada.texto.slice(0, 200));

  const r = await api('PUT', `/deudas/${creada.json.id}`, { ...creada.json, notas: 'Una nota nueva' });
  assert.equal(r.estado, 200, `no se está moviendo plata nueva (${r.texto.slice(0, 200)})`);
});
