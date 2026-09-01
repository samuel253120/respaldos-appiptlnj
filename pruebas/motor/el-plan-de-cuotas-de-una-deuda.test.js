/**
 * El plan de pagos de una deuda, y lo que deja en el libro de la plata.
 *
 * Medido antes de la 1.248.0, con las sillas del ejemplo de la corporación
 * —$ 500.000 en seis cuotas— y dos cuotas pagadas: el sistema sabía que se
 * habían gastado $ 166.666 y nada más. Ni cuánto se debía en total, ni cuántas
 * cuotas faltaban, ni cuándo vencía la próxima, ni con quién era la deuda. Lo
 * único escrito era el concepto que alguien tecleó a mano.
 *
 * Acá se prueban las tres cosas que lo arreglan: el plan que se arma solo, los
 * pagos que son movimientos de tesorería de verdad, y el desembolso —la plata
 * que entra al recibir un préstamo, que una compra a crédito no tiene—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const plan = require('../../server/plan-de-cuotas');
const puente = require('../../server/deuda-tesoreria');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const DEUDAS = getModule('deudas');
const CUOTAS = getModule('cuotas_deuda');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const caja = (nombre, { saldo = 10000000, estado = 'Activa' } = {}) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial)
            VALUES (?, 'Iglesia local', 1, 'Proyecto / Trabajo', ?, ?)`)
  .run(`${nombre} Plan ${marca()}`, estado, saldo).lastInsertRowid;

const USUARIO = { id: 1, rol: 'admin' };

/** Una deuda ya guardada, con su plan y su desembolso puestos. */
function unaDeuda(extra = {}) {
  const suya = extra.cuenta_id || caja('Caja');
  const fila = {
    direccion: 'Por pagar', clase: 'Compra a crédito', concepto: `Deuda ${marca()}`,
    monto: 500000, fecha: '2026-08-01', cuotas: 6, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'Muebles del Sur', estado: 'Vigente',
    ...extra, cuenta_id: suya, iglesia_id: 1, cuerpo_id: null,
  };
  const campos = Object.keys(fila);
  const info = db
    .prepare(`INSERT INTO deudas (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`)
    .run(...campos.map((c) => fila[c]));
  const guardada = db.prepare('SELECT * FROM deudas WHERE id = ?').get(info.lastInsertRowid);
  DEUDAS.hooks.afterSave(guardada, { user: USUARIO, db, existing: null });
  return guardada;
}

// ------------------------------------------------- cómo se reparte el monto ----

test('las cuotas suman exactamente el total, siempre', () => {
  for (const [total, cuantas] of [[500000, 6], [1000000, 3], [100, 7], [1, 1], [999999, 11]]) {
    const montos = plan.comoSeReparte(total, cuantas);
    assert.equal(montos.length, cuantas, `${total} en ${cuantas}`);
    assert.equal(montos.reduce((a, b) => a + b, 0), total, `${total} en ${cuantas} no suma`);
  }
});

test('y lo que sobra de la división va a la última, no a la primera', () => {
  const montos = plan.comoSeReparte(500000, 6);
  assert.deepEqual(montos, [83333, 83333, 83333, 83333, 83333, 83335]);
});

test('en una sola cuota, la cuota es la deuda entera', () => {
  assert.deepEqual(plan.comoSeReparte(400000, 1), [400000]);
});

// ------------------------------------------------------------- las fechas ----

test('un mes después del 31 de enero es fin de febrero, no marzo', () => {
  assert.equal(plan.elMesSiguiente('2026-01-31', 1), '2026-02-28');
  assert.equal(plan.elMesSiguiente('2024-01-31', 1), '2024-02-29');
});

test('y las cuotas se cuentan desde la primera, así que no se corren solas', () => {
  // Contándolas en cadena, después de febrero todas caerían 28
  assert.equal(plan.elMesSiguiente('2026-01-31', 2), '2026-03-31');
  assert.equal(plan.elMesSiguiente('2026-01-31', 3), '2026-04-30');
});

// ----------------------------------------------------- el plan que se arma ----

test('al guardar la deuda, el plan sale solo', () => {
  const deuda = unaDeuda();
  const cuotas = plan.lasDe(db, deuda.id);
  assert.equal(cuotas.length, 6);
  assert.deepEqual(cuotas.map((c) => c.numero), [1, 2, 3, 4, 5, 6]);
  assert.equal(cuotas.reduce((s, c) => s + c.monto, 0), 500000);
  assert.equal(cuotas[0].vence, '2026-09-30');
  assert.equal(cuotas[5].vence, '2027-02-28');
});

test('subirle las cuotas agrega al final y no toca las que ya estaban', () => {
  const deuda = unaDeuda({ cuotas: 3, monto: 300000 });
  // alguien corrige la primera a mano
  db.prepare('UPDATE cuotas_deuda SET monto = ?, vence = ? WHERE deuda_id = ? AND numero = 1')
    .run(120000, '2026-09-15', deuda.id);

  db.prepare('UPDATE deudas SET cuotas = 6 WHERE id = ?').run(deuda.id);
  plan.ponerLasQueFalten(db, db.prepare('SELECT * FROM deudas WHERE id = ?').get(deuda.id));

  const cuotas = plan.lasDe(db, deuda.id);
  assert.equal(cuotas.length, 6);
  assert.equal(cuotas[0].monto, 120000, 'la corregida a mano se queda como estaba');
  assert.equal(cuotas[0].vence, '2026-09-15');
});

test('bajárselas quita las últimas', () => {
  const deuda = unaDeuda({ cuotas: 6 });
  db.prepare('UPDATE deudas SET cuotas = 2 WHERE id = ?').run(deuda.id);
  const { quitadas } = plan.ponerLasQueFalten(db, db.prepare('SELECT * FROM deudas WHERE id = ?').get(deuda.id));
  assert.equal(quitadas, 4);
  assert.deepEqual(plan.lasDe(db, deuda.id).map((c) => c.numero), [1, 2]);
});

test('pero nunca una que tenga plata encima', () => {
  const deuda = unaDeuda({ cuotas: 6 });
  const cuotas = plan.lasDe(db, deuda.id);
  puente.anotarUnPago(db, deuda, { cuotaId: cuotas[4].id, fecha: '2026-08-01', monto: 10000 }, USUARIO);

  db.prepare('UPDATE deudas SET cuotas = 2 WHERE id = ?').run(deuda.id);
  plan.ponerLasQueFalten(db, db.prepare('SELECT * FROM deudas WHERE id = ?').get(deuda.id));

  const quedan = plan.lasDe(db, deuda.id).map((c) => c.numero);
  assert.ok(quedan.includes(5), `la cuota con pagos no se quita: quedaron ${quedan}`);
});

// ------------------------------------------------- lo que dice el plan ----

test('el plan dice lo pactado, lo pagado y lo que falta', () => {
  const deuda = unaDeuda();
  const cuotas = plan.lasDe(db, deuda.id);
  puente.anotarUnPago(db, deuda, { cuotaId: cuotas[0].id, fecha: '2026-08-01', monto: cuotas[0].monto }, USUARIO);
  puente.anotarUnPago(db, deuda, { cuotaId: cuotas[1].id, fecha: '2026-08-01', monto: cuotas[1].monto }, USUARIO);

  const { resumen } = plan.planDe(db, deuda);
  assert.equal(resumen.total, 500000);
  assert.equal(resumen.pagado, 166666);
  assert.equal(resumen.falta, 333334);
  assert.equal(resumen.pagadas, 2);
  assert.equal(resumen.proxima.numero, 3);
});

test('una cuota pagada a medias lo dice, y sigue siendo la próxima', () => {
  const deuda = unaDeuda();
  const cuotas = plan.lasDe(db, deuda.id);
  puente.anotarUnPago(db, deuda, { cuotaId: cuotas[0].id, fecha: '2026-08-01', monto: 30000 }, USUARIO);

  const { cuotas: filas, resumen } = plan.planDe(db, deuda);
  assert.equal(filas[0].estado, 'Pagada en parte');
  assert.equal(filas[0].pagado, 30000);
  assert.equal(filas[0].falta, 53333);
  assert.equal(resumen.proxima.numero, 1, 'sigue siendo la próxima hasta que se salde');
});

test('dos pagos de la misma cuota se suman', () => {
  const deuda = unaDeuda();
  const cuota = plan.lasDe(db, deuda.id)[0];
  puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 40000 }, USUARIO);
  puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-02', monto: 43333 }, USUARIO);

  const filas = plan.planDe(db, deuda).cuotas;
  assert.equal(filas[0].pagado, 83333);
  assert.equal(filas[0].pagos, 2);
  assert.equal(filas[0].estado, 'Pagada');
});

test('una cuota vencida y sin pagar sale atrasada', () => {
  const deuda = unaDeuda({ cuotas: 1, primera_cuota: '2020-01-31' });
  assert.equal(plan.planDe(db, deuda).cuotas[0].estado, 'Atrasada');
  assert.equal(plan.planDe(db, deuda).resumen.atrasadas, 1);
});

test('un abono sin cuota también salda deuda', () => {
  const deuda = unaDeuda();
  puente.anotarUnPago(db, deuda, { cuotaId: null, fecha: '2026-08-01', monto: 100000 }, USUARIO);
  const { resumen, a_cuenta } = plan.planDe(db, deuda);
  assert.equal(a_cuenta.pagado, 100000);
  assert.equal(resumen.falta, 400000);
});

// --------------------------------------------------------- el desembolso ----

test('una compra a crédito no mueve un peso al contraerse', () => {
  const deuda = unaDeuda({ clase: 'Compra a crédito' });
  assert.equal(puente.tieneDesembolso(deuda), false);
  assert.equal(puente.elDesembolsoDe(db, deuda.id), null);
});

test('un préstamo recibido entra a la caja, con su categoría propia', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  const mov = puente.elDesembolsoDe(db, deuda.id);
  assert.ok(mov, 'tiene que haber desembolso');
  assert.equal(mov.tipo, 'Ingreso');
  assert.equal(mov.categoria, 'Préstamos recibidos');
  assert.equal(mov.monto, 400000);
  assert.equal(mov.cuenta_id, deuda.cuenta_id);
  assert.equal(mov.desembolso, 1);
});

test('y sus pagos salen de la caja', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  const cuota = plan.lasDe(db, deuda.id)[0];
  const mov = puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 400000 }, USUARIO);
  assert.equal(mov.tipo, 'Egreso');
  assert.equal(mov.categoria, 'Pago de deudas');
  assert.equal(mov.desembolso, 0);
  assert.equal(mov.cuota_id, cuota.id);
});

test('cuando la organización presta, los signos se dan vuelta', () => {
  const deuda = unaDeuda({ direccion: 'Por cobrar', clase: 'Préstamo en dinero', monto: 200000, cuotas: 1 });
  assert.equal(puente.elDesembolsoDe(db, deuda.id).tipo, 'Egreso', 'entregar plata SALE de la caja');
  assert.equal(puente.elDesembolsoDe(db, deuda.id).categoria, 'Préstamos entregados');
  const cuota = plan.lasDe(db, deuda.id)[0];
  const cobro = puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 200000 }, USUARIO);
  assert.equal(cobro.tipo, 'Ingreso', 'que se lo devuelvan ENTRA');
  assert.equal(cobro.categoria, 'Cobro de préstamos');
});

test('corregirle el monto a la deuda corrige su desembolso', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  db.prepare('UPDATE deudas SET monto = 450000 WHERE id = ?').run(deuda.id);
  const nueva = db.prepare('SELECT * FROM deudas WHERE id = ?').get(deuda.id);
  puente.ponerElDesembolso(db, nueva, USUARIO);
  assert.equal(puente.elDesembolsoDe(db, deuda.id).monto, 450000);
});

test('y pasarla a compra a crédito le retira el movimiento', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  assert.ok(puente.elDesembolsoDe(db, deuda.id));
  db.prepare("UPDATE deudas SET clase = 'Compra a crédito' WHERE id = ?").run(deuda.id);
  puente.ponerElDesembolso(db, db.prepare('SELECT * FROM deudas WHERE id = ?').get(deuda.id), USUARIO);
  assert.equal(puente.elDesembolsoDe(db, deuda.id), null);
});

// ------------------------------------------- lo que Tesorería no deja hacer ----

test('un movimiento generado por una deuda no se edita desde Tesorería', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  const mov = puente.elDesembolsoDe(db, deuda.id);
  const problema = getModule('tesoreria').hooks.beforeSave(
    { monto: 1 }, { user: USUARIO, existing: mov, db, confirmado: false }
  );
  assert.match(String(problema), /Deudas y Compromisos/);
});

test('y no se le exige boleta: no lo adjunta nadie a mano', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 1 });
  const cuota = plan.lasDe(db, deuda.id)[0];
  const mov = puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 400000 }, USUARIO);
  const respaldo = getModule('tesoreria').computed.find((c) => c.name === 'respaldo');
  assert.equal(respaldo.calc(mov).texto, '—');
});

// -------------------------------------------------------- borrar cosas ----

test('una deuda con pagos no se borra', () => {
  const deuda = unaDeuda();
  const cuota = plan.lasDe(db, deuda.id)[0];
  puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 1000 }, USUARIO);
  const problema = DEUDAS.hooks.beforeDelete(deuda, { db, user: USUARIO });
  assert.match(String(problema), /pago\(s\) anotado\(s\)/);
});

test('sin pagos sí, y se lleva su plan y su desembolso', () => {
  const deuda = unaDeuda({ clase: 'Préstamo en dinero', monto: 400000, cuotas: 3 });
  assert.ok(puente.elDesembolsoDe(db, deuda.id));
  assert.equal(DEUDAS.hooks.beforeDelete(deuda, { db, user: USUARIO }), null);
  assert.equal(puente.elDesembolsoDe(db, deuda.id), null);
  assert.equal(plan.lasDe(db, deuda.id).length, 0);
});

test('una cuota con pagos tampoco se borra', () => {
  const deuda = unaDeuda();
  const cuota = plan.lasDe(db, deuda.id)[0];
  puente.anotarUnPago(db, deuda, { cuotaId: cuota.id, fecha: '2026-08-01', monto: 1000 }, USUARIO);
  const problema = CUOTAS.hooks.beforeDelete(db.prepare('SELECT * FROM cuotas_deuda WHERE id = ?').get(cuota.id), { db });
  assert.match(String(problema), /pago\(s\) anotado\(s\)/);
});

// ---------------------------------------------------- el sistema andando ----

test('la planilla llega armada al navegador', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Sillas');
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: suya, direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Sillas para el templo', monto: 500000, cuotas: 6, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'Muebles del Sur',
  });
  assert.equal(r.estado, 201, r.texto);

  const p = await api('GET', `/deudas/${r.json.id}/plan`);
  assert.equal(p.estado, 200, p.texto);
  assert.equal(p.json.cuotas.length, 6);
  assert.equal(p.json.resumen.falta, 500000);
  assert.equal(p.json.desembolso, null, 'una compra a crédito no tiene desembolso');
});

test('pagar una cuota deja su movimiento en la caja de la deuda', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Pagos');
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: suya, direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Sillas', monto: 300000, cuotas: 3, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'Muebles',
  });
  const p = await api('GET', `/deudas/${r.json.id}/plan`);
  const cuota = p.json.cuotas[0];

  const pago = await api('POST', `/deudas/${r.json.id}/pagos`, { cuota_id: cuota.id, monto: cuota.monto, fecha: '2026-08-01' });
  assert.equal(pago.estado, 201, pago.texto);
  const mov = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(pago.json.movimiento_id);
  assert.equal(mov.cuenta_id, suya);
  assert.equal(mov.deuda_id, r.json.id);
  assert.equal(mov.cuota_id, cuota.id);

  const p2 = await api('GET', `/deudas/${r.json.id}/plan`);
  assert.equal(p2.json.resumen.pagado, cuota.monto);
  assert.equal(p2.json.cuotas[0].estado, 'Pagada');
});

test('un pago mal anotado se retira, y se va su movimiento', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Retirar');
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: suya, direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Algo', monto: 100000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'Alguien',
  });
  const p = await api('GET', `/deudas/${r.json.id}/plan`);
  const pago = await api('POST', `/deudas/${r.json.id}/pagos`, { cuota_id: p.json.cuotas[0].id, monto: 50000, fecha: '2026-08-01' });

  const quitar = await api('DELETE', `/deudas/${r.json.id}/pagos/${pago.json.movimiento_id}`);
  assert.equal(quitar.estado, 200, quitar.texto);
  assert.equal(db.prepare('SELECT id FROM tesoreria WHERE id = ?').get(pago.json.movimiento_id), undefined);
  assert.equal((await api('GET', `/deudas/${r.json.id}/plan`)).json.resumen.pagado, 0);
});

test('un pago que deja la caja en rojo pregunta antes', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Poca plata', { saldo: 1000 });
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: suya, direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Cara', monto: 900000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'Alguien',
  });
  const p = await api('GET', `/deudas/${r.json.id}/plan`);
  const cuota = p.json.cuotas[0];

  const sinConfirmar = await api('POST', `/deudas/${r.json.id}/pagos`, { cuota_id: cuota.id, monto: 900000, fecha: '2026-08-01' });
  assert.equal(sinConfirmar.estado, 400, sinConfirmar.texto);
  assert.equal(sinConfirmar.json.confirmar, 'saldo_negativo');

  const confirmando = await api('POST', `/deudas/${r.json.id}/pagos`, { cuota_id: cuota.id, monto: 900000, fecha: '2026-08-01', igual_asi: true });
  assert.equal(confirmando.estado, 201, confirmando.texto);
});

test('la cuota de otra deuda no se paga desde ésta', async () => {
  const api = await elSistemaAndando();
  const una = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: caja('Una'), direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Una', monto: 100000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'A',
  });
  const otra = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: caja('Otra'), direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Otra', monto: 100000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'B',
  });
  const suya = (await api('GET', `/deudas/${otra.json.id}/plan`)).json.cuotas[0];
  const r = await api('POST', `/deudas/${una.json.id}/pagos`, { cuota_id: suya.id, monto: 1000, fecha: '2026-08-01' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no es de esta deuda/);
});

test('un pago sin monto no se anota', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: caja('Sin monto'), direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Algo', monto: 100000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'A',
  });
  const sin = await api('POST', `/deudas/${r.json.id}/pagos`, { monto: 0, fecha: '2026-08-01' });
  assert.equal(sin.estado, 400);
  assert.match(sin.json.error, /cuánto se pagó/);
});

test('en una caja cerrada no se anotan pagos', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Se cierra');
  const r = await api('POST', '/deudas', {
    fecha: '2026-08-01', cuenta_id: suya, direccion: 'Por pagar', clase: 'Compra a crédito',
    concepto: 'Algo', monto: 100000, cuotas: 1, primera_cuota: '2026-09-30',
    contraparte_tipo: 'Una institución', institucion: 'A',
  });
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(suya);
  const pago = await api('POST', `/deudas/${r.json.id}/pagos`, { monto: 1000, fecha: '2026-08-01' });
  assert.equal(pago.estado, 400);
  assert.match(pago.json.error, /cerrada/i);
});

// ------------------------------------------------------ las categorías ----

test('las cuatro categorías de las deudas quedaron sembradas', () => {
  /*
   * Las puestas al día las corre el servidor al arrancar, no el motor, así que
   * acá se llama a la suya derecho — como hace la prueba del nivel de un bien
   * de inventario con la suya.
   */
  require('../../server/migraciones').categoriasDeLasDeudas();
  for (const nombre of ['Préstamos recibidos', 'Pago de deudas', 'Préstamos entregados', 'Cobro de préstamos']) {
    const fila = db.prepare('SELECT * FROM categorias_tesoreria WHERE nombre = ?').get(nombre);
    assert.ok(fila, `falta la categoría «${nombre}»`);
    assert.equal(fila.activo, 1);
  }
});

// ------------------------------------------- lo que muestra el listado ----

test('la ficha dice cuánto falta y cuál es la próxima cuota', () => {
  const deuda = unaDeuda();
  const cuotas = plan.lasDe(db, deuda.id);
  const falta = () => DEUDAS.computed.find((c) => c.name === 'falta').calc(deuda, { db });
  const proxima = () => DEUDAS.computed.find((c) => c.name === 'proxima').calc(deuda, { db });

  assert.equal(falta(), 500000, 'sin pagos, falta la deuda entera');
  assert.match(proxima().texto, /^1 de 6/);

  /*
   * Y con plata encima tiene que BAJAR. Sin este pago la prueba pasaba igual
   * devolviendo el monto de la deuda a secas: se vio al romper el cálculo a
   * propósito y ver que no se caía nada.
   */
  puente.anotarUnPago(db, deuda, { cuotaId: cuotas[0].id, fecha: '2026-08-01', monto: cuotas[0].monto }, USUARIO);
  assert.equal(falta(), 500000 - cuotas[0].monto);
  assert.match(proxima().texto, /^2 de 6/);
});

test('y una deuda cerrada deja de anunciar la próxima', () => {
  const deuda = unaDeuda({ estado: 'Pagada' });
  assert.equal(DEUDAS.computed.find((c) => c.name === 'proxima').calc(deuda, { db }), null);
});

// ------------------------------------------ cómo lo pinta la pantalla ----

test('la deuda se abre en su ficha, con la pestaña del plan', () => {
  const pantalla = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(pantalla, /const CON_FICHA = \[[^\]]*'deudas'/, 'la deuda se abre en su ficha, no en el formulario');
  assert.match(pantalla, /sumar\('plan', 'Plan de cuotas'/);
  assert.match(pantalla, /async function renderPlanDeCuotas\(deudaId, caja\)/);
});

test('y una cifra calculada sale de la cabecera con su rótulo y sus puntos', () => {
  /*
   * «303334» al lado del nombre de un acreedor no se lee como «falta pagar
   * $ 303.334». Se vio al mirar la ficha por primera vez. Los calculados de
   * texto se quedan como estaban: «3 entregas» ya se explica solo.
   */
  const pantalla = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(pantalla, /f\.computed && f\.type === 'money'/);
  assert.match(pantalla, /\$\{esc\(f\.label\)\} · \$\{fmtMoney\(v\)\}/);
});

test('el pago desde la planilla sabe preguntar lo que el servidor pregunta', () => {
  const pantalla = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(pantalla, /async function guardarPreguntando\(ruta, cuerpo\)/);
  assert.match(pantalla, /igual_asi: true/);
});
