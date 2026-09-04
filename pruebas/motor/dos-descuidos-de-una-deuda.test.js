/**
 * DOS DESCUIDOS QUE EL SISTEMA TENÍA A LA VISTA Y NO NOMBRABA.
 *
 * Los dos son la misma omisión que el resto de la revisión del módulo, en su
 * versión chica: el sistema tiene los dos números al lado y no los compara.
 *
 * MEDIDO en la v1.355.0:
 *
 *   pagar $ 900.000 de una deuda de $ 100.000 ......... 201
 *     y el plan quedaba contradiciéndose en la misma pantalla: arriba «falta
 *     $ 0», abajo «cuota 1: Pendiente, pagado $ 0»
 *
 *   comprometer el pago para el 31-12-2026, con seis
 *   cuotas mensuales desde el 05-10-2026 ............. 201
 *     y la última cuota vencía el 05-03-2027, tres meses después del plazo que
 *     la propia ficha decía
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

const MARCA = `d${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del descuido ${MARCA}`, `IG-DD${process.pid}`.slice(0, 12)).lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`Caja del descuido ${MARCA}`, iglesia).lastInsertRowid;

const unaDeuda = async (api, extra) => {
  const r = await api('POST', '/deudas', Object.assign({
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Deuda ${MARCA}`,
    monto: 100000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente',
  }, extra));
  assert.equal(r.estado, 201, r.texto.slice(0, 220));
  return r.json;
};

/* ───────────────────────── pagar más de lo que falta ──────────────────── */

test('pagar mucho más de lo que se debe pregunta antes', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La del cero de más ${MARCA}` });

  const r = await api('POST', `/deudas/${d.id}/pagos`, { monto: 900000, fecha: '2026-09-01' });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 201 (${r.texto.slice(0, 160)})`);
  assert.ok(r.json.confirmar);
  assert.match(r.json.confirmar, /faltan \$ 100\.000 y este pago es de \$ 900\.000/);
  assert.match(r.json.confirmar, /\$ 800\.000 de más/);
  assert.match(r.json.confirmar, /si se le fue un dígito/);
});

test('y mientras no conteste, no se anota nada', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que no se pagó ${MARCA}` });
  await api('POST', `/deudas/${d.id}/pagos`, { monto: 900000, fecha: '2026-09-01' });

  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;
  assert.equal(plan.resumen.pagado, 0, 'el plan quedaba diciendo pagado $ 900.000 y falta $ 0');
});

test('al confirmar se anota igual: hubo intereses, o se pagó de más', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La de los intereses ${MARCA}` });

  const r = await api('POST', `/deudas/${d.id}/pagos`, {
    monto: 120000, fecha: '2026-09-01', igual_asi: true,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

test('pagar una deuda ya saldada también pregunta, y con sus palabras', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La ya saldada ${MARCA}` });
  await api('POST', `/deudas/${d.id}/pagos`, { monto: 100000, fecha: '2026-09-01', igual_asi: true });

  const r = await api('POST', `/deudas/${d.id}/pagos`, { monto: 5000, fecha: '2026-09-02' });
  assert.equal(r.estado, 400);
  assert.match(r.json.confirmar, /ya está saldada/);
});

test('un pago que cabe en lo que falta no pregunta nada', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que se paga bien ${MARCA}`, monto: 300000, cuotas: 3 });
  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;

  const r = await api('POST', `/deudas/${d.id}/pagos`, {
    monto: plan.cuotas[0].monto, fecha: '2026-09-01', cuota_id: plan.cuotas[0].id,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
});

/* ────────────── la fecha comprometida y la última cuota ───────────────── */

test('la fecha comprometida no puede caer antes de la última cuota', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `El plazo corto ${MARCA}`,
    monto: 600000, fecha: '2026-03-02', fecha_vencimiento: '2026-12-31',
    cuotas: 6, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 201 sin una palabra (${r.texto.slice(0, 160)})`);
  assert.match(r.json.error, /cae antes de la última cuota/);
  assert.match(r.json.error, /Corra el plazo|acorte el plan/, 'y dice los dos arreglos posibles');
});

test('con el plazo después de la última cuota, entra', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/deudas', {
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `El plazo largo ${MARCA}`,
    monto: 600000, fecha: '2026-03-02', fecha_vencimiento: '2027-04-30',
    cuotas: 6, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 220));
});

test('y sin plazo —«cuando se pueda»— no hay nada que comparar', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `Sin plazo ${MARCA}`, monto: 600000, cuotas: 6 });
  assert.ok(d.id, 'seis cuotas y ninguna fecha comprometida: es un caso corriente');
});

test('al corregir, se mira la última cuota de verdad y no la calculada', async () => {
  /*
   * Cada cuota se puede corregir a mano —hay deudas con interés y créditos que
   * se reajustan—, así que una vez armado el plan lo que vale es lo que dicen
   * sus cuotas.
   */
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La corrida a mano ${MARCA}`, monto: 200000, cuotas: 2 });
  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;
  db.prepare('UPDATE cuotas_deuda SET vence = ? WHERE id = ?').run('2027-08-05', plan.cuotas[1].id);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, fecha_vencimiento: '2027-01-31' });
  assert.equal(r.estado, 400, 'la segunda cuota quedó en agosto de 2027');
  assert.match(r.json.error, /05-08-2027/);
});
