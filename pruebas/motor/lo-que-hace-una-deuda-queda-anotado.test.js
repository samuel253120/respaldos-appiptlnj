/**
 * LO QUE HACE UNA DEUDA QUEDA EN EL REGISTRO DE CAMBIOS.
 *
 * La lista de módulos vigilados abre con el rótulo «El dinero»: tesorería,
 * cuentas, traspasos, cuotas de cuerpo, ayudas sociales, y desde la v1.346.0
 * también las categorías. Las deudas no estaban. Tampoco sus cuotas, ni sus
 * pagos —que se anotan por una ruta propia y no pasan por el guardado de
 * Tesorería—.
 *
 * MEDIDO en la v1.355.0, al final de la revisión y sobre la misma base:
 *
 *   9 deudas creadas, corregidas y cerradas ........ 0 líneas
 *   14 movimientos de tesorería que dejaron ........ 0 líneas ($ 4.600.000)
 *   1 movimiento escrito a mano en Tesorería ....... 1 línea
 *
 * Los mismos $ 100.000: por una puerta dejaban constancia y por la otra no. Y
 * las dos operaciones que más importan —dar una deuda por pagada y condonarla—
 * pasaban las dos por la puerta que no anotaba.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { MODULOS_VIGILADOS } = require('../../server/bitacora');

after(cerrarElSistema);

const MARCA = `g${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del rastro ${MARCA}`, `IG-DG${process.pid}`.slice(0, 12)).lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`Caja del rastro ${MARCA}`, iglesia).lastInsertRowid;

const unaDeuda = async (api, extra) => {
  const r = await api('POST', '/deudas', Object.assign({
    direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Deuda ${MARCA}`,
    monto: 300000, fecha: '2026-03-02', cuotas: 3, primera_cuota: '2026-10-05',
    cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
    estado: 'Vigente',
  }, extra));
  assert.equal(r.estado, 201, r.texto.slice(0, 220));
  return r.json;
};

/** Las líneas del registro que hablan de esta deuda. */
const lineasDe = (concepto) => db
  .prepare("SELECT * FROM registro_cambios WHERE registro = ? ORDER BY id")
  .all(concepto);

/* ─────────────────────────── el módulo está en la lista ───────────────── */

test('las deudas y sus cuotas están entre los módulos vigilados', () => {
  assert.ok(MODULOS_VIGILADOS.includes('deudas'), 'es el módulo del dinero que faltaba');
  assert.ok(MODULOS_VIGILADOS.includes('cuotas_deuda'),
    'corregirle el monto a una cuota cambia lo que la iglesia se comprometió a pagar');
});

/* ─────────────────────── crear, corregir y cerrar ─────────────────────── */

test('crear una deuda deja su línea', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se crea ${MARCA}`;
  await unaDeuda(api, { concepto });

  const lineas = lineasDe(concepto);
  assert.equal(lineas.length, 1, `medido en la v1.355.0: nueve deudas dejaron cero líneas`);
  assert.equal(lineas[0].accion, 'Creación');
  assert.equal(lineas[0].modulo, 'Deudas y Compromisos');
});

test('darla por pagada, también', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se cierra ${MARCA}`;
  const d = await unaDeuda(api, { concepto });

  await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada', igual_asi: true });
  const lineas = lineasDe(concepto);
  assert.ok(lineas.length >= 2, 'la creación y el cierre');
  const cierre = lineas[lineas.length - 1];
  assert.equal(cierre.accion, 'Cambio');
  assert.match(cierre.detalle || '', /Pagada/,
    'si dentro de un año alguien pregunta quién decidió que ya no se debía, tiene que estar acá');
});

test('y condonarla', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se perdona ${MARCA}`;
  const d = await unaDeuda(api, { concepto });

  await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Condonada' });
  assert.match(lineasDe(concepto).map((l) => l.detalle).join(' '), /Condonada/);
});

/* ──────────────── los pagos, que van por su propia ruta ───────────────── */

test('anotar un pago deja su línea, con cuánto y a qué cuota', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se paga ${MARCA}`;
  const d = await unaDeuda(api, { concepto });
  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;

  const r = await api('POST', `/deudas/${d.id}/pagos`, {
    monto: 100000, fecha: '2026-09-01', cuota_id: plan.cuotas[0].id, igual_asi: true,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));

  const detalles = lineasDe(concepto).map((l) => l.detalle || '').join(' | ');
  assert.match(detalles, /Anotó un pago de \$ 100\.000/,
    'esta ruta escribe el movimiento derecho, sin pasar por el guardado de Tesorería');
  assert.match(detalles, /a la cuota 1/);
});

test('y retirarlo también: ahí reaparece plata en una caja', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se despaga ${MARCA}`;
  const d = await unaDeuda(api, { concepto });
  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;
  const pago = await api('POST', `/deudas/${d.id}/pagos`, {
    monto: 100000, fecha: '2026-09-01', cuota_id: plan.cuotas[0].id, igual_asi: true,
  });

  const r = await api('DELETE', `/deudas/${d.id}/pagos/${pago.json.movimiento_id}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.match(lineasDe(concepto).map((l) => l.detalle || '').join(' | '),
    /Retiró un pago de \$ 100\.000/,
    'de las dos, ésta es la que más falta hace poder consultar después');
});

test('un abono sin cuota se anota diciendo que fue a cuenta', async () => {
  const api = await elSistemaAndando();
  const concepto = `La del abono ${MARCA}`;
  const d = await unaDeuda(api, { concepto });

  await api('POST', `/deudas/${d.id}/pagos`, { monto: 50000, fecha: '2026-09-01', igual_asi: true });
  assert.match(lineasDe(concepto).map((l) => l.detalle || '').join(' | '), /a cuenta/);
});

/* ───────────────────────── borrar sigue anotándose ────────────────────── */

test('borrar una deuda sin pagos deja su línea, como todo lo que se borra', async () => {
  const api = await elSistemaAndando();
  const concepto = `La que se borra ${MARCA}`;
  const d = await unaDeuda(api, { concepto });

  const r = await api('DELETE', `/deudas/${d.id}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.ok(lineasDe(concepto).some((l) => l.accion === 'Eliminación'));
});
