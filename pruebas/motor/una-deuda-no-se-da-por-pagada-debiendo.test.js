/**
 * DAR POR PAGADA UNA DEUDA QUE TODAVÍA SE DEBE.
 *
 * Cerrar una deuda es lo ÚNICO de este módulo que pide una llave propia
 * —`deudas_cerrar`, aparte en «Permisos»— y su cabecera explica bien por qué:
 * «anotar que se debe es trabajo de todos los días; declarar que ya no se debe
 * es cerrar el asunto». Se comprobaba QUIÉN lo hace. No se comprobaba lo único
 * que el sistema sabe con certeza: cuánto falta.
 *
 * MEDIDO en la v1.355.0, deuda de $ 300.000 en tres cuotas y sin un peso
 * pagado:
 *
 *   se marca «Pagada» ................ 200 · sin una palabra
 *   el plan de esa misma deuda ....... falta $ 300.000 · 0 de 3 cuotas pagadas
 *   la fila del listado .............. «Pagada» · «Falta pagar $ 300.000»
 *
 * A diferencia de todo lo demás de esta revisión, acá el error no queda a la
 * vista en ninguna cartola: la deuda desaparece de lo vigente y nadie la vuelve
 * a mirar.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const DEUDAS = require('../../server/modules/deudas');

after(cerrarElSistema);

const MARCA = `c${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del cierre ${MARCA}`, `IG-DC${process.pid}`.slice(0, 12)).lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`Caja del cierre ${MARCA}`, iglesia).lastInsertRowid;

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

const pagarTodo = async (api, deuda) => {
  const plan = (await api('GET', `/deudas/${deuda.id}/plan`)).json;
  for (const c of plan.cuotas) {
    const p = await api('POST', `/deudas/${deuda.id}/pagos`, {
      monto: c.monto, fecha: '2026-09-01', cuota_id: c.id, igual_asi: true,
    });
    assert.equal(p.estado, 201, p.texto.slice(0, 200));
  }
};

/* ───────────────────────────── se pregunta ────────────────────────────── */

test('darla por «Pagada» debiendo todo pregunta antes', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada' });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 200 sin una palabra (${r.texto.slice(0, 160)})`);
  assert.ok(r.json.confirmar, 'no es un rechazo: se puede haber pagado por fuera del sistema');
  assert.match(r.json.confirmar, /\$ 300\.000 de \$ 300\.000/, 'dice cuánto falta y de cuánto');
  assert.match(r.json.confirmar, /anótelo en el plan de cuotas/, 'y nombra el camino correcto');
  assert.match(r.json.confirmar, /«Condonada»/, 'y el otro, que es la palabra para lo perdonado');

  assert.equal(
    db.prepare('SELECT estado FROM deudas WHERE id = ?').get(d.id).estado, 'Vigente',
    'mientras no conteste, sigue vigente'
  );
});

test('debiendo una parte, también', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `Pagada a medias ${MARCA}` });
  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;
  await api('POST', `/deudas/${d.id}/pagos`, {
    monto: plan.cuotas[0].monto, fecha: '2026-09-01', cuota_id: plan.cuotas[0].id, igual_asi: true,
  });

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada' });
  assert.equal(r.estado, 400);
  assert.match(r.json.confirmar, /\$ 200\.000 de \$ 300\.000/);
});

test('y al confirmar se cierra igual: se puede haber pagado por fuera', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `Pagada por fuera ${MARCA}` });

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada', igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));
  assert.equal(r.json.estado, 'Pagada');
  assert.ok(r.json.fecha_cierre, 'y queda con la fecha en que se cerró');
});

/* ─────────────────── lo que no pregunta nada, y por qué ───────────────── */

test('«Condonada» debiendo NO pregunta: es lo que la palabra significa', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que se perdonó ${MARCA}` });

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Condonada' });
  assert.equal(r.estado, 200,
    `perdonar una deuda es cerrarla sin cobrarla: que quede plata sin pagar es el caso normal (${r.texto.slice(0, 160)})`);
});

test('una deuda pagada de verdad se cierra sin preguntar', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que sí se pagó ${MARCA}` });
  await pagarTodo(api, d);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada' });
  assert.equal(r.estado, 200, `sus pagos suman el total (${r.texto.slice(0, 200)})`);
});

test('y corregirle una coma a una que ya estaba cerrada tampoco pregunta', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `Ya estaba cerrada ${MARCA}` });
  await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada', igual_asi: true });

  const otra = (await api('GET', `/deudas/${d.id}`)).json;
  const r = await api('PUT', `/deudas/${d.id}`, { ...otra, notas: 'Una nota nueva' });
  assert.equal(r.estado, 200, 'ya alguien contestó esa pregunta: repetirla enseña a confirmar sin leer');
});

/* ─────────────── y la fila deja de contradecirse a sí misma ───────────── */

test('la columna «Falta pagar» de una deuda cerrada no dice nada', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La de la columna ${MARCA}` });
  await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada', igual_asi: true });

  const fila = (await api('GET', `/deudas?limit=100`)).json.rows.find((f) => f.id === d.id);
  assert.ok(fila, 'la deuda tiene que estar en el listado');
  assert.equal(fila.estado, 'Pagada');
  assert.equal(fila.falta, 0,
    'medido antes: la misma fila decía «Pagada» y «Falta pagar $ 300.000» una al lado de la otra');
});

test('pero el plan sigue diciendo la verdad de lo pagado', async () => {
  /*
   * Cerrar una deuda no borra lo que pasó con la plata: la columna del listado
   * contesta «¿cuánto queda por pagar?» —y de una cerrada, nada— mientras que
   * el plan guarda el detalle de lo que sí se pagó contra el total.
   */
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La del detalle ${MARCA}` });
  await api('PUT', `/deudas/${d.id}`, { ...d, estado: 'Pagada', igual_asi: true });

  const plan = (await api('GET', `/deudas/${d.id}/plan`)).json;
  assert.equal(plan.resumen.pagado, 0);
  assert.equal(plan.resumen.total, 300000);
});

test('y una deuda vigente sigue mostrando lo que falta', () => {
  const falta = DEUDAS.computed.find((c) => c.name === 'falta');
  const vigente = { id: 0, estado: 'Vigente', monto: 500000 };
  assert.equal(falta.calc(vigente, { db }), 500000, 'que es para lo que existe la columna');
});
