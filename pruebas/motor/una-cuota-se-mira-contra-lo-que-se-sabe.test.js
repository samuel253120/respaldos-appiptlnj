/**
 * $ 99.000.000 DE CUOTA EN UN CUERPO QUE COBRA $ 5.000.
 *
 * El cuerpo declara cuánto es su cuota —el sistema ya la usa para proponer el
 * monto en la planilla— y al registrar un pago a mano ese número no se miraba.
 * La fecha del pago no se comparaba con nada de la persona que paga. Y el año
 * se revisaba contra 1900-2200, que para una cuota mensual no revisa nada.
 *
 * MEDIDO en la v1.412.0, sobre un cuerpo cuya cuota es de $ 5.000 y alguien que
 * entró el 10-01-2026:
 *
 *   un pago de $ 99.000.000 ...  201   quedó en la caja del cuerpo
 *   un pago del 05-01-2020 ....  201   seis años antes de entrar al cuerpo
 *   la cuota de 12/2030 .......  201   un mes que faltaba cuatro años
 *   ──
 *   un pago negativo ..........  400   «no puede ser negativo»
 *   un pago del 05-01-2030 ....  400   «todavía no llega»
 *   el mes 13, el año 1800 ....  400   los dos, con su explicación
 *
 * Los rechazos de abajo son la parte interesante: el módulo YA sabía hacer
 * esto, y lo que faltaba era pedirlo donde importa. La caja de ese cuerpo
 * terminó con $ 99.075.000.
 *
 * Las tres reglas no son iguales y no se resuelven igual. El monto se
 * PREGUNTA: pagar varios meses juntos se hace, y quien tecleó un cero de más
 * necesita verlo, no que le cierren la puerta. Las otras dos se rechazan: una
 * cuota pagada antes de entrar al cuerpo y un mes a cuatro años no son casos
 * raros, son errores.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const cuotas = require('../../server/cuotas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central MI ${marca}`, `MI-${marca}`).lastInsertRowid;

function unCuerpo({ cuota = 5000 } = {}) {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, ?)`
  ).run(`Damas ${++n} MI ${marca}`, iglesia, cuota).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} MI ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo, ingreso = '2026-01-10') {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga MI ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', ?, ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga MI ${marca}`, ingreso, iglesia).lastInsertRowid;
}

const enLaCaja = (cuerpo) => db.prepare(
  "SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE cuerpo_id = ? AND tipo = 'Ingreso'"
).get(cuerpo).t;

const unPago = (ficha, extra = {}) => ({
  integrante_id: ficha, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05', ...extra,
});

// -------------------------------------------- el monto, contra la cuota ----

test('un monto de diez cuotas o más se pregunta, y el aviso pone los dos números', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const r = await api('POST', '/cuotas_cuerpo', unPago(unaFicha(cuerpo), { monto: 99000000 }));
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.equal(r.json.confirmar, 'el_monto_no_calza_con_la_cuota', 'se pregunta, no se cierra la puerta');
  assert.match(r.json.error, /\$ 99\.000\.000/, 'lo que se está anotando');
  assert.match(r.json.error, /\$ 5\.000/, 'y contra qué, que es lo que hace entender');
  assert.match(r.json.error, /19800 cuotas/, 'dicho en cuotas, que es como se piensa');
  assert.equal(enLaCaja(cuerpo), 0, 'y mientras no se confirme, no entra a la caja');
});

test('el cero de más queda justo adentro: son diez veces la cuota', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const conCero = await api('POST', '/cuotas_cuerpo', unPago(unaFicha(cuerpo), { monto: 50000 }));
  assert.equal(conCero.estado, 400, `$ 50.000 es el error de tecleo de siempre: ${conCero.texto}`);
  assert.equal(conCero.json.confirmar, 'el_monto_no_calza_con_la_cuota');
});

test('pagar tres meses juntos no molesta a nadie', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const r = await api('POST', '/cuotas_cuerpo', unPago(unaFicha(cuerpo), { monto: 15000 }));
  assert.equal(r.estado, 201, r.texto);
  assert.equal(enLaCaja(cuerpo), 15000);
});

test('quien confirma, guarda: la plata entra tal cual', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const r = await api('POST', '/cuotas_cuerpo', unPago(unaFicha(cuerpo), { monto: 99000000, igual_asi: true }));
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.monto, 99000000);
  assert.equal(enLaCaja(cuerpo), 99000000, 'la pregunta es una pregunta, no un tope');
});

test('donde el cuerpo no declaró su cuota no hay con qué comparar, y no se inventa un tope', async () => {
  /*
   * Un cuerpo puede cobrar sin haber escrito todavía de cuánto es —la planilla
   * lo dice con su propio aviso—. Ahí la única regla que queda es la de siempre:
   * mayor que cero.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 0 });
  const r = await api('POST', '/cuotas_cuerpo', unPago(unaFicha(cuerpo), { monto: 99000000 }));
  assert.equal(r.estado, 201, r.texto);
});

// ------------------------------------- la fecha, contra la de su ingreso ----

test('no se pudo pagar antes de entrar al cuerpo, y el aviso da las dos salidas', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo, '2026-01-10');
  const persona = db.prepare('SELECT persona FROM integrantes_cuerpo WHERE id = ?').get(ficha).persona;

  const r = await api('POST', '/cuotas_cuerpo',
    unPago(ficha, { mes: '01', fecha_pago: '2020-01-05' }));
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.ok(r.json.error.includes(persona), 'nombra a quien pagó, no su número');
  assert.match(r.json.error, /10-01-2026/, 'cuándo entró, que es contra lo que se compara');
  assert.match(r.json.error, /05-01-2020/, 'y la fecha que se escribió');
  assert.match(r.json.error, /ficha de integrante/, 'y dice dónde se arregla si la mala es la otra');
  assert.equal(enLaCaja(cuerpo), 0);
});

test('el mismo día en que entró sí se puede', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const r = await api('POST', '/cuotas_cuerpo',
    unPago(unaFicha(cuerpo, '2026-01-10'), { mes: '01', fecha_pago: '2026-01-10' }));
  assert.equal(r.estado, 201, `el borde no se pasa de rosca: ${r.texto}`);
});

test('corregir una cuota vieja sigue siendo posible aunque después se mueva la fecha de ingreso', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo, '2026-01-10');
  const puesta = await api('POST', '/cuotas_cuerpo', unPago(ficha));
  assert.equal(puesta.estado, 201, puesta.texto);

  db.prepare("UPDATE integrantes_cuerpo SET fecha_ingreso = '2026-09-01' WHERE id = ?").run(ficha);

  const corregida = await api('PUT', `/cuotas_cuerpo/${puesta.json.id}`, unPago(ficha, { monto: 6000 }));
  assert.equal(corregida.estado, 200,
    `la regla es del alta: si no, la cuota quedaría atascada justo cuando hay que arreglarla — ${corregida.texto}`);
});

// ------------------------------------------- el mes, contra el calendario ----

test('el mes que se paga no puede estar a años de distancia', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const r = await api('POST', '/cuotas_cuerpo',
    unPago(unaFicha(cuerpo), { anio: 2030, mes: '12', fecha_pago: '2026-07-05' }));
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.match(r.json.error, /diciembre de 2030/, 'dice qué mes es el que se está registrando');
  assert.match(r.json.error, /faltan \d+ meses/);
  assert.match(r.json.error, /un año adelantado/, 'y hasta dónde sí se puede');
});

test('pagar adelantado sí se puede, hasta el año', async () => {
  const api = await elSistemaAndando();
  const { hoy } = require('../../server/fechas');
  const enMeses = (a, m) => a * 12 + (m - 1);
  const ahora = enMeses(Number(hoy().slice(0, 4)), Number(hoy().slice(5, 7)));
  const dentroDe = (meses) => ({
    anio: Math.floor((ahora + meses) / 12),
    mes: String(((ahora + meses) % 12) + 1).padStart(2, '0'),
  });

  const cuerpo = unCuerpo();
  const justo = await api('POST', '/cuotas_cuerpo',
    unPago(unaFicha(cuerpo), { ...dentroDe(12), fecha_pago: hoy() }));
  assert.equal(justo.estado, 201, `doce meses adelante entra: ${justo.texto}`);

  const unoMas = await api('POST', '/cuotas_cuerpo',
    unPago(unaFicha(cuerpo), { ...dentroDe(13), fecha_pago: hoy() }));
  assert.equal(unoMas.estado, 400, `y trece no: ${unoMas.texto}`);
  assert.match(unoMas.json.error, /faltan 13 meses/, 'y dice cuántos son');
});

test('la regla del mes está escrita una sola vez, y las dos puertas la piden', async () => {
  /*
   * Es la lección de CU-01, y acá había otra vez dos revisiones del año, una en
   * cada puerta, las dos con el mismo 1900-2200 que no revisa nada. Desde la
   * planilla se llega a un año adelante con dos clics en el botón del año.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const porFicha = unaFicha(cuerpo);
  const porPlanilla = unaFicha(cuerpo);

  const f = await api('POST', '/cuotas_cuerpo',
    unPago(porFicha, { anio: 2030, mes: '12', fecha_pago: '2026-07-05' }));
  const p = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: porPlanilla, anio: 2030, mes: '12' });
  assert.equal(f.estado, 400, f.texto);
  assert.equal(p.estado, 400, `la planilla también: ${p.texto}`);
  assert.equal(f.json.error, p.json.error, 'y con el mismo texto, porque es la misma regla');

  const compartido = fs.readFileSync(path.join(__dirname, '../../server/cuotas.js'), 'utf8');
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuotas_cuerpo.js'), 'utf8');
  assert.match(compartido, /function avisoSiElMesEstaMuyAdelante/, 'la regla vive en el sitio compartido');
  assert.match(modulo, /avisoSiElMesEstaMuyAdelante\(anio, mes\)/, 'y el módulo la pide, no la copia');
  assert.ok(!/MESES_QUE_SE_PUEDEN_ADELANTAR/.test(modulo), 'sin su propia copia del tope');
});

test('y la regla, sola, cuenta bien los meses', () => {
  const { hoy } = require('../../server/fechas');
  const [a, m] = [Number(hoy().slice(0, 4)), Number(hoy().slice(5, 7))];
  assert.equal(cuotas.avisoSiElMesEstaMuyAdelante(a, String(m).padStart(2, '0')), null, 'este mes');
  assert.equal(cuotas.avisoSiElMesEstaMuyAdelante(a - 3, '01'), null, 'y los de atrás, que son los normales');
  assert.equal(cuotas.avisoSiElMesEstaMuyAdelante(a + 1, String(m).padStart(2, '0')), null, 'el año justo');
  assert.match(String(cuotas.avisoSiElMesEstaMuyAdelante(a + 2, '01')), /adelantado/, 'dos años no');
});

// ------------------------------------------------------------ la pantalla ----

test('la pregunta del monto tiene su encabezado y sus botones en pantalla', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'));
  const suya = tabla.slice(tabla.indexOf('el_monto_no_calza_con_la_cuota'));
  assert.ok(suya.indexOf('},') > 0);
  const entrada = suya.slice(0, suya.indexOf('},') + 2);
  assert.match(entrada, /titulo:/);
  assert.match(entrada, /volver:/);
  assert.match(entrada, /seguir:/);
  assert.ok(!/Revise este monto'[\s\S]*Está bien, guardar así/.test(entrada),
    'con sus propios botones: los de la cuenta en rojo hablan de otra cosa');
});
