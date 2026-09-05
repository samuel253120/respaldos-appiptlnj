/**
 * EL PLAN DE CUOTAS Y EL MONTO DE LA DEUDA, CADA UNO POR SU LADO.
 *
 * El plan se arma UNA VEZ y después solo se agrega o se quita al final, sin
 * tocar lo que alguien corrigió a mano. La razón está escrita y es buena: hay
 * deudas con interés y créditos que se reajustan, y rearmarlo entero borraría a
 * mano lo que alguien corrigió a mano. Lo que faltaba no era rearmarlo: era
 * DECIRLO.
 *
 * MEDIDO en la v1.355.0, dos correcciones corrientes:
 *
 *   el monto: $ 300.000 → $ 900.000    la ficha decía deber $ 900.000 y el plan
 *                                      seguía con tres cuotas de $ 100.000
 *   las cuotas: 6 → 2, con la 6.ª      la ficha quedó diciendo «en 2 cuotas» y
 *   ya pagada                          el plan siguió con seis
 *
 * Las dos contestaron 200 y ningún aviso. El resumen del plan ya devolvía
 * `total` y `pactado` como dos cifras distintas: el sistema ya sabía que no
 * cuadraban, y nada las comparaba.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const plan = require('../../server/plan-de-cuotas');

after(cerrarElSistema);

const MARCA = `p${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del plan ${MARCA}`, `IG-DP${process.pid}`.slice(0, 12)).lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`Caja del plan ${MARCA}`, iglesia).lastInsertRowid;

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

const elPlan = async (api, id) => (await api('GET', `/deudas/${id}/plan`)).json;

/* ────────────────── cambiarle el monto: se pregunta ───────────────────── */

test('subirle el monto a una deuda con plan pregunta antes', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api);

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, monto: 900000 });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 200 sin una palabra (${r.texto.slice(0, 160)})`);
  /*
   * La explicación va en `error`, que es lo que se lee; `confirmar` es la LLAVE
   * con que la pantalla busca el encabezado y los botones de la pregunta (ver
   * COMO_SE_PREGUNTA en public/app.js).
   *
   * Estaba al revés hasta la v1.415.0, y esta prueba lo daba por bueno: el
   * párrafo entero iba de llave, ninguna calzaba, así que salían los botones
   * genéricos y la explicación no se veía nunca. Se destapó arreglando el otro
   * lado de la misma cuenta —el plan por el lado de la cuota, hallazgo CU-07—.
   */
  assert.equal(r.json.confirmar, 'la_deuda_no_cuadra_con_su_plan', 'una llave, no un párrafo');
  assert.match(r.json.error, /suman \$ 300\.000 y la deuda quedaría en \$ 900\.000/);
  assert.match(r.json.error, /\$ 600\.000 de menos en el plan/);
  assert.match(r.json.error, /no se rearma solo, a propósito/, 'y explica por qué no se rearma');
});

test('y al confirmar se guarda, con el plan quedando dicho', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que se corrigió ${MARCA}` });

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, monto: 900000, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));

  const p = await elPlan(api, d.id);
  assert.equal(p.resumen.total, 900000);
  assert.equal(p.resumen.pactado, 300000, 'las tres cuotas que alguien pudo haber corregido siguen ahí');
  assert.equal(p.resumen.cuadra, false, 'y el plan lo dice, para que la pantalla lo muestre');
  assert.equal(p.resumen.descuadre, 600000);
});

test('bajarle el monto a lo que ya suman las cuotas no pregunta nada', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que cuadra ${MARCA}`, monto: 300000 });
  const r = await api('PUT', `/deudas/${d.id}`, { ...d, notas: 'una coma' });
  assert.equal(r.estado, 200, 'el plan suma exactamente la deuda');
  const p = await elPlan(api, d.id);
  assert.equal(p.resumen.cuadra, true);
});

test('y a una ya descuadrada no se le vuelve a preguntar por una coma', async () => {
  /*
   * Alguien ya contestó esa pregunta. Repetirla cada vez que se le arregla algo
   * enseña a confirmar sin leer, que es lo contrario de lo que esto busca.
   */
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que ya estaba ${MARCA}` });
  await api('PUT', `/deudas/${d.id}`, { ...d, monto: 900000, igual_asi: true });

  const otra = (await api('GET', `/deudas/${d.id}`)).json;
  const r = await api('PUT', `/deudas/${d.id}`, { ...otra, notas: 'otra coma' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
});

/* ──────────── bajar las cuotas cuando la última tiene plata ───────────── */

test('no se puede bajar el plan por debajo de una cuota ya pagada', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que achica ${MARCA}`, monto: 600000, cuotas: 6 });
  const p = await elPlan(api, d.id);
  const paga = await api('POST', `/deudas/${d.id}/pagos`, {
    monto: 100000, fecha: '2026-09-01', cuota_id: p.cuotas[5].id, igual_asi: true,
  });
  assert.equal(paga.estado, 201, paga.texto.slice(0, 200));

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, cuotas: 2 });
  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 200 sin una palabra (${r.texto.slice(0, 160)})`);
  assert.ok(!r.json.confirmar, 'no es una pregunta: no hay manera de quitar una cuota con plata encima');
  assert.match(r.json.error, /la cuota 6 ya tiene pagos/);
  assert.match(r.json.error, /Retire primero ese pago/);

  const despues = (await api('GET', `/deudas/${d.id}`)).json;
  assert.equal(despues.cuotas, 6, 'la ficha quedaba diciendo «en 2 cuotas» con un plan de seis');
});

test('pero bajarlo hasta donde no hay pagos sí se puede', async () => {
  const api = await elSistemaAndando();
  const d = await unaDeuda(api, { concepto: `La que sí achica ${MARCA}`, monto: 600000, cuotas: 6 });
  const p = await elPlan(api, d.id);
  await api('POST', `/deudas/${d.id}/pagos`, {
    monto: 100000, fecha: '2026-09-01', cuota_id: p.cuotas[1].id, igual_asi: true,
  });

  const r = await api('PUT', `/deudas/${d.id}`, { ...d, cuotas: 2, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 220));
  assert.equal((await elPlan(api, d.id)).cuotas.length, 2);
});

/* ────────── el aviso dice lo mismo que después queda escrito ──────────── */

test('lo que se avisa es lo que después queda escrito', async () => {
  /*
   * `elPactadoQueQuedara` y `ponerLasQueFalten` son dos copias de la misma
   * cuenta —una avisa antes, la otra escribe— y las copias se separan. Esta
   * prueba existe para que no puedan.
   */
  const api = await elSistemaAndando();
  for (const [cuotasAntes, cuotasDespues, monto] of [[3, 3, 900000], [3, 6, 600000], [6, 2, 600000], [2, 5, 700000]]) {
    const d = await unaDeuda(api, {
      concepto: `Espejo ${cuotasAntes}-${cuotasDespues} ${MARCA}`, cuotas: cuotasAntes, monto: 300000,
    });
    const avisado = plan.elPactadoQueQuedara(db, { id: d.id, monto, cuotas: cuotasDespues });
    const r = await api('PUT', `/deudas/${d.id}`, { ...d, monto, cuotas: cuotasDespues, igual_asi: true });
    assert.equal(r.estado, 200, r.texto.slice(0, 200));
    assert.equal((await elPlan(api, d.id)).resumen.pactado, avisado,
      `de ${cuotasAntes} a ${cuotasDespues} cuotas con monto ${monto}: el aviso y lo escrito no coinciden`);
  }
});

/* ─────────────────── y la pantalla del plan lo muestra ────────────────── */

test('la pantalla del plan avisa cuando las cuotas no suman la deuda', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const suya = app.slice(app.indexOf('async function renderPlanDeCuotas'));
  assert.match(suya.slice(0, 4000), /r\.cuadra === false/,
    'el aviso tiene que salir en la misma pantalla donde se ven las cuotas');
  assert.match(suya.slice(0, 4000), /Las cuotas no suman la deuda/);
});
