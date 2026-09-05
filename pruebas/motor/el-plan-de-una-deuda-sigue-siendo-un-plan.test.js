/**
 * EL PLAN DE UNA DEUDA SE DESCUADRABA EN SILENCIO.
 *
 * Las cuotas de una deuda son el otro satélite de esta familia, y el módulo
 * dice bien por qué se pueden corregir una por una: «algunas deudas llevan
 * interés y hay créditos que se reajustan». Lo que faltaba era que corregir no
 * dejara el plan diciendo cualquier cosa.
 *
 * MEDIDO en la v1.414.0, sobre una deuda de $ 600.000 en seis cuotas de
 * $ 100.000:
 *
 *   ponerle $ 1 a la primera cuota ....  200   el plan suma $ 500.001
 *   agregar otra cuota número 1 .......  201   dos «cuota 1», siete en total
 *   una cuota de $ 0 ..................  201   entra
 *   una que vence el 10-01-2020 .......  201   seis años antes de la deuda
 *   ──
 *   borrar una cuota con pagos ........  400   lo dice y lo impide
 *
 * La última fila es la que enseña dónde estaba la línea: el módulo ya cuidaba
 * la plata pagada, y lo que no cuidaba era el plan. El plan es lo que se lleva
 * a la reunión para decir cuánto falta y cuándo vence lo próximo.
 *
 * Las tres reglas no se resuelven igual, y ésa es la parte que importa. Dos
 * números de cuota repetidos y una cuota que vence antes de contraerse la deuda
 * son errores: se rechazan. Que el plan no cuadre con la deuda NO lo es —es
 * exactamente lo que pasa cuando se reajusta un crédito— así que se pregunta,
 * con los dos números puestos.
 *
 * Y la cuota de $ 0 no necesitó regla propia: un mes de gracia bien hecho —$ 0
 * en una cuota y el doble en la siguiente— cuadra, y pasa sin preguntar nada.
 * Una cuota de $ 0 agregada al final no cuadra, y por eso se mira también
 * CUÁNTAS cuotas quedan: esa no mueve la suma.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const plan = require('../../server/plan-de-cuotas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central PD ${marca}`, `PD-${marca}`).lastInsertRowid;

/** Una deuda de $ 600.000 en seis cuotas de $ 100.000, con su plan ya armado. */
async function unaDeuda(api, { monto = 600000, cuotas = 6 } = {}) {
  const cuenta = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', 900000)`
  ).run(`Caja ${++n} PD ${marca}`, iglesia).lastInsertRowid;
  const r = await api('POST', '/deudas', {
    concepto: `Sillas del templo ${n} PD ${marca}`, iglesia_id: iglesia, monto, cuotas,
    fecha: '2026-01-10', primera_cuota: '2026-02-10', cuenta_id: cuenta,
    contraparte_tipo: 'Una institución', institucion: 'Mueblería del Sur',
  });
  assert.equal(r.estado, 201, r.texto);
  const suyas = plan.lasDe(db, r.json.id);
  assert.equal(suyas.length, cuotas, 'el plan nace armado');
  return { deuda: r.json, cuotas: suyas };
}

const elPlan = (deudaId) => {
  const q = plan.lasDe(db, deudaId);
  return { cuantas: q.length, suma: q.reduce((t, c) => t + Number(c.monto || 0), 0) };
};

// ------------------------------------------------ el plan tiene que cuadrar ----

test('corregirle el monto a una cuota pregunta, con los dos números puestos', async () => {
  const api = await elSistemaAndando();
  const { deuda, cuotas } = await unaDeuda(api);

  const r = await api('PUT', `/cuotas_deuda/${cuotas[0].id}`, { monto: 1 });
  assert.equal(r.estado, 400, `antes de esto contestaba 200: ${r.texto}`);
  assert.equal(r.json.confirmar, 'el_plan_no_cuadra_con_la_deuda', 'se pregunta, no se cierra la puerta');
  assert.match(r.json.error, /\$ 500\.001/, 'lo que sumaría el plan');
  assert.match(r.json.error, /\$ 600\.000/, 'y lo que la deuda dice deber');
  assert.match(r.json.error, /\$ 99\.999 de menos/, 'y la diferencia, que es lo que hay que mirar');
  assert.match(r.json.error, /reajust/, 'y por qué esto puede estar bien');

  assert.deepEqual(elPlan(deuda.id), { cuantas: 6, suma: 600000 }, 'mientras no se confirme, el plan no se mueve');
});

test('quien confirma, guarda: el reajuste es un caso de verdad', async () => {
  const api = await elSistemaAndando();
  const { deuda, cuotas } = await unaDeuda(api);
  const r = await api('PUT', `/cuotas_deuda/${cuotas[0].id}`, { monto: 130000, igual_asi: true });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(elPlan(deuda.id).suma, 630000);
});

test('agregar una cuota de $ 0 al final no mueve la suma, y aun así se pregunta', async () => {
  /*
   * Es la razón de mirar también CUÁNTAS quedan: mirando solo la plata, esta
   * cuota entraba sin decir nada y dejaba siete cuotas donde la ficha dice seis.
   */
  const api = await elSistemaAndando();
  const { deuda } = await unaDeuda(api);
  const r = await api('POST', '/cuotas_deuda',
    { deuda_id: deuda.id, numero: 7, monto: 0, vence: '2026-09-10' });
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.match(r.json.error, /quedarían 7 cuotas y la ficha dice 6/);
  assert.equal(r.json.confirmar, 'el_plan_no_cuadra_con_la_deuda');
});

test('un mes de gracia bien hecho no molesta a nadie', async () => {
  /*
   * $ 0 en una cuota y el doble en la siguiente: el plan sigue sumando lo mismo
   * y siendo el mismo número de cuotas. Por eso la cuota de $ 0 no necesitó
   * regla propia —a diferencia de la cuota de un cuerpo, que es un PAGO y ahí
   * un cero es siempre mentira (hallazgo CU-04)—. Acá es un COMPROMISO, y un
   * mes sin compromiso existe.
   */
  const api = await elSistemaAndando();
  const { deuda, cuotas } = await unaDeuda(api);
  const gracia = await api('PUT', `/cuotas_deuda/${cuotas[0].id}`, { monto: 0, igual_asi: true });
  assert.equal(gracia.estado, 200, gracia.texto);
  const doble = await api('PUT', `/cuotas_deuda/${cuotas[1].id}`, { monto: 200000 });
  assert.equal(doble.estado, 200, `y ésta cuadra el plan, así que no pregunta nada: ${doble.texto}`);
  assert.deepEqual(elPlan(deuda.id), { cuantas: 6, suma: 600000 });
});

test('y armar el plan no pasa por esta pregunta: nace cuadrado', async () => {
  const api = await elSistemaAndando();
  const { deuda } = await unaDeuda(api, { monto: 500000, cuotas: 6 });
  assert.deepEqual(elPlan(deuda.id), { cuantas: 6, suma: 500000 },
    'lo que sobra de la división va a la última, y suma exacto');
});

// ------------------------------------------------- los dos que sí son errores ----

test('dos «cuota 1» en el mismo plan no, y el aviso dice qué hacer', async () => {
  const api = await elSistemaAndando();
  const { deuda } = await unaDeuda(api);
  const r = await api('POST', '/cuotas_deuda',
    { deuda_id: deuda.id, numero: 1, monto: 100000, vence: '2026-02-10' });
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.ok(!r.json.confirmar, 'esto no se confirma: dos cuotas número 1 no son un caso, son un error');
  assert.ok(r.json.error.includes(deuda.concepto), 'nombra la deuda');
  assert.match(r.json.error, /ya tiene una cuota 1/);
  assert.match(r.json.error, /póngale el que sigue/, 'y dice qué hacer en su lugar');
  assert.equal(elPlan(deuda.id).cuantas, 6);
});

test('el mismo número en OTRA deuda sí: cada plan lleva su cuota 1', async () => {
  const api = await elSistemaAndando();
  const una = await unaDeuda(api);
  const otra = await unaDeuda(api);
  assert.equal(plan.lasDe(db, una.deuda.id)[0].numero, 1);
  assert.equal(plan.lasDe(db, otra.deuda.id)[0].numero, 1,
    'la regla es por deuda, no del sistema entero');
});

test('renumerar una cuota al número que sigue se puede', async () => {
  const api = await elSistemaAndando();
  const { cuotas } = await unaDeuda(api);
  const r = await api('PUT', `/cuotas_deuda/${cuotas[5].id}`, { numero: 7, igual_asi: true });
  assert.equal(r.estado, 200, `corregir sigue siendo posible: ${r.texto}`);
});

test('una cuota no vence antes de contraerse la deuda, y el aviso da las dos salidas', async () => {
  const api = await elSistemaAndando();
  const { deuda } = await unaDeuda(api);
  const r = await api('POST', '/cuotas_deuda',
    { deuda_id: deuda.id, numero: 7, monto: 100000, vence: '2020-01-10' });
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.ok(!r.json.confirmar, 'tampoco se confirma');
  assert.match(r.json.error, /se contrajo el 10-01-2026/);
  assert.match(r.json.error, /vencer el 10-01-2020/);
  assert.match(r.json.error, /o la de la deuda si es esa la que está mal/,
    'porque puede ser la otra fecha la equivocada');
});

test('el mismo día en que se contrajo sí', async () => {
  const api = await elSistemaAndando();
  const { cuotas } = await unaDeuda(api);
  const r = await api('PUT', `/cuotas_deuda/${cuotas[0].id}`, { vence: '2026-01-10' });
  assert.equal(r.estado, 200, `el borde no se pasa de rosca: ${r.texto}`);
});

// --------------------------------------------------------- lo que ya cuidaba ----

test('lo que el módulo ya hacía bien sigue igual: una cuota con pagos no se borra', async () => {
  const api = await elSistemaAndando();
  const { deuda, cuotas } = await unaDeuda(api);
  const pago = await api('POST', `/deudas/${deuda.id}/pagos`,
    { cuota_id: cuotas[0].id, monto: 100000 });
  assert.equal(pago.estado < 300, true, pago.texto);
  const r = await api('DELETE', `/cuotas_deuda/${cuotas[0].id}`);
  assert.equal(r.estado, 400, r.texto);
  assert.match(r.json.error, /pago\(s\) anotado\(s\)/);
});

// ------------------------------------------------------------- las dos caras ----

test('la deuda ya preguntaba por su lado, y ahora su explicación se lee', async () => {
  /*
   * Estaba al revés: el texto largo iba en `confirmar` —que es la LLAVE con que
   * la pantalla busca el encabezado y los botones— y la frase corta en `error`.
   * Ninguna llave calzaba con ese párrafo, así que salían los botones genéricos
   * y la explicación entera no se veía nunca.
   */
  const api = await elSistemaAndando();
  const { deuda } = await unaDeuda(api);
  const r = await api('PUT', `/deudas/${deuda.id}`, { monto: 700000 });
  assert.equal(r.estado, 400, r.texto);
  assert.equal(r.json.confirmar, 'la_deuda_no_cuadra_con_su_plan', 'una llave, no un párrafo');
  assert.match(r.json.error, /\$ 600\.000/, 'y la explicación va donde se lee');
  assert.match(r.json.error, /\$ 700\.000/);
  assert.match(r.json.error, /\$ 100\.000 de menos/);
});

test('las dos preguntas tienen su encabezado y sus botones en pantalla', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'));
  for (const llave of ['el_plan_no_cuadra_con_la_deuda', 'la_deuda_no_cuadra_con_su_plan']) {
    const desde = tabla.indexOf(`${llave}: {`);
    assert.ok(desde > 0, `falta la entrada de ${llave}`);
    const entrada = tabla.slice(desde, tabla.indexOf('},', desde) + 2);
    assert.match(entrada, /titulo:/);
    assert.match(entrada, /volver:/);
    assert.match(entrada, /seguir:/);
  }
  // Y los botones dicen cosas distintas, porque son dos decisiones distintas
  const deLaCuota = tabla.slice(tabla.indexOf('el_plan_no_cuadra_con_la_deuda: {'));
  const deLaDeuda = tabla.slice(tabla.indexOf('la_deuda_no_cuadra_con_su_plan: {'));
  assert.notEqual(
    deLaCuota.slice(0, deLaCuota.indexOf('},')).match(/volver: '([^']*)'/)[1],
    deLaDeuda.slice(0, deLaDeuda.indexOf('},')).match(/volver: '([^']*)'/)[1],
    'en una se vuelve a corregir la cuota y en la otra el monto de la deuda');
});

// ------------------------------------------------------------ la cuenta sola ----

test('la cuenta de cómo quedaría el plan, sola', async () => {
  const api = await elSistemaAndando();
  const { deuda, cuotas } = await unaDeuda(api);
  assert.deepEqual(plan.comoQuedariaElPlan(db, deuda.id, { id: cuotas[0].id, monto: 100000 }),
    { cuantas: 6, suma: 600000 }, 'guardar lo mismo no cambia nada');
  assert.deepEqual(plan.comoQuedariaElPlan(db, deuda.id, { id: cuotas[0].id, monto: 1 }),
    { cuantas: 6, suma: 500001 }, 'corregir una reemplaza su monto, no lo suma dos veces');
  assert.deepEqual(plan.comoQuedariaElPlan(db, deuda.id, { monto: 50000 }),
    { cuantas: 7, suma: 650000 }, 'y una nueva se agrega');
});
