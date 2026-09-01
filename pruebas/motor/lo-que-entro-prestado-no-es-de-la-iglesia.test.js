/**
 * Un préstamo no es un ingreso de la iglesia.
 *
 * Medido antes de esto, siguiendo un caso real de la corporación: un hermano
 * presta $ 400.000 y se le devuelve dentro del mismo mes.
 *
 *   el balance de la reunión decía ...... entraron $ 1.400.000
 *                                         salieron $ 1.400.000
 *   la iglesia había reunido y gastado ... $ 1.000.000
 *
 * Un 40 % de más en las dos cifras que la tesorera lee en voz alta. Salía
 * cuadrado —cada peso de más estaba las dos veces, como ingreso y como egreso—
 * y no decía la verdad: esa plata era de otro y había que devolverla.
 *
 * Y la caja de un cuerpo con un préstamo de $ 150.000 decía tener $ 150.000,
 * teniendo cero y debiendo todo, que es la diferencia entre un cuerpo que tiene
 * con qué y uno que no.
 *
 * Lo que se cuida acá: que lo prestado salga de las dos cifras corrientes y se
 * diga en su propia línea, que «lo que se debe hoy» no lleve el período —esa
 * pregunta se contesta hoy, no en agosto—, y que NO SE RESTE DOS VECES cuando
 * el préstamo es entre dos cajas de la propia casa, que ya se descuenta como
 * traslado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { totalesDe } = require('../../server/entre-cuentas');
const { OTRA_CAJA, POR_PAGAR, POR_COBRAR } = require('../../server/modules/deudas');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
const MES = '2026-08';

/** Una iglesia con dos cajas propias. */
function unaIglesia() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia prestada ${m}`, `PRST${m}`).lastInsertRowid;
  const caja = (nombre) => db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
              VALUES (?, 'Iglesia local', 'General', ?, 'Activa', 0)`)
    .run(`${nombre} ${m}`, iglesia).lastInsertRowid;
  return { m, iglesia, caja: caja('Caja'), otra: caja('Otra caja') };
}

/** Lo que la iglesia sí reunió y sí gastó, escrito a mano. */
function loCorriente(c, cuenta) {
  const anotar = (tipo, monto, dia) => db
    .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
              VALUES (?, ?, 'Diezmos', ?, ?, ?, ?)`)
    .run(`${MES}-${dia}`, tipo, `Lo corriente ${c.m}`, monto, cuenta, c.iglesia);
  anotar('Ingreso', 1000000, '10');
  anotar('Egreso', 1000000, '20');
}

/** El recorte del período y de esa caja, como lo arma la pantalla. */
const loQueSeMira = (c, cuenta) => ({
  whereSql: 'WHERE cuenta_id = ? AND fecha >= ? AND fecha <= ?',
  params: [cuenta, `${MES}-01`, `${MES}-31`],
});

const totales = (c, cuenta) => {
  const { whereSql, params } = loQueSeMira(c, cuenta);
  return totalesDe(db, whereSql, params);
};

const unPrestamo = (c, extra = {}) => ({
  cuenta_id: c.caja, direccion: POR_PAGAR, clase: 'Préstamo en dinero',
  concepto: `Préstamo ${c.m}`, monto: 400000, fecha: `${MES}-05`,
  cuotas: 1, primera_cuota: `${MES}-28`,
  contraparte_tipo: 'Una persona', contraparte: 'Un hermano',
  estado: 'Vigente', igual_asi: true, ...extra,
});

// ------------------------------------------- lo prestado sale de las dos cifras ----

test('lo que entró prestado no se cuenta como ingreso de la iglesia', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.caja);

  const antes = totales(c, c.caja);
  assert.equal(antes.ingresos, 1000000, 'el escenario: la iglesia reunió un millón');

  const r = await api('POST', '/deudas', unPrestamo(c));
  assert.equal(r.estado, 201);

  const t = totales(c, c.caja);
  assert.equal(t.ingresos, 1000000, 'sigue siendo un millón: los $ 400.000 son de otro');
  assert.equal(t.prestado_recibido, 400000, 'y se dicen en su propia línea');
});

test('y devolverlo no se cuenta como gasto', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.caja);
  const id = (await api('POST', '/deudas', unPrestamo(c))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ?').all(id)[0];

  await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: `${MES}-28`, monto: 400000, metodo: 'Transferencia',
  });

  const t = totales(c, c.caja);
  assert.equal(t.egresos, 1000000, 'la iglesia gastó un millón, no un millón cuatrocientos');
  assert.equal(t.prestado_devuelto, 400000);
  assert.equal(t.balance, 0, 'y el balance sigue cuadrando');
});

test('un préstamo que la iglesia ENTREGA tampoco es un gasto suyo', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.caja);

  const r = await api('POST', '/deudas', unPrestamo(c, { direccion: POR_COBRAR }));
  assert.equal(r.estado, 201);

  const t = totales(c, c.caja);
  assert.equal(t.egresos, 1000000, 'esa plata sigue siendo de la iglesia: la tiene otro');
  assert.equal(t.prestado_entregado, 400000);
});

// ------------------------------------------------------- lo que se debe hoy ----

/** El resumen tal como lo pide la pantalla, acotado a esta iglesia. */
const resumenDe = async (api, c, mas = '') =>
  (await api('GET', `/tesoreria/resumen?desde=${MES}-01&hasta=${MES}-31&f_iglesia_id=${c.iglesia}${mas}`)).json;

test('«lo que se debe hoy» sale del estado de las deudas, no del período', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  await api('POST', '/deudas', unPrestamo(c, { fecha: '2019-01-05', primera_cuota: '2019-02-05' }));

  const r = await resumenDe(api, c);
  assert.equal(r.se_debe, 400000,
    'una deuda de 2019 que sigue viva se debe hoy, aunque se esté mirando agosto de 2026');
  assert.equal(r.le_deben, 0);
});

test('lo que se va pagando deja de deberse', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  const id = (await api('POST', '/deudas', unPrestamo(c, { cuotas: 2 }))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(id)[0];

  await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: `${MES}-28`, monto: 200000, metodo: 'Transferencia',
  });
  assert.equal((await resumenDe(api, c)).se_debe, 200000,
    'no es una cifra guardada: sale de restarle a la deuda lo que suman sus pagos');
});

test('una deuda cerrada ya no se debe', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  const id = (await api('POST', '/deudas', unPrestamo(c))).json.id;
  assert.equal((await resumenDe(api, c)).se_debe, 400000);

  await api('PUT', `/deudas/${id}`, { estado: 'Condonada', igual_asi: true });
  assert.equal((await resumenDe(api, c)).se_debe, 0,
    'condonada o pagada, el compromiso terminó');
});

test('y la cifra respeta el recorte de la pantalla en que está puesta', async () => {
  const api = await elSistemaAndando();
  const a = unaIglesia();
  const b = unaIglesia();
  await api('POST', '/deudas', unPrestamo(a));
  await api('POST', '/deudas', unPrestamo(b));

  assert.equal((await resumenDe(api, a)).se_debe, 400000,
    'mirando una iglesia, la deuda de la otra no es asunto de esa pantalla');
  assert.equal((await resumenDe(api, a, `&f_cuenta_id=${a.otra}`)).se_debe, 0,
    'y filtrando por la caja de al lado, tampoco la suya');
});

// ---------------------------------------------- cuánto del saldo es prestado ----

test('la caja dice cuánto de su saldo hay que devolver', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  await api('POST', '/deudas', unPrestamo(c, { monto: 150000 }));

  const r = await resumenDe(api, c);
  const suya = r.porCuenta.find((x) => x.id === Number(c.caja));
  const laOtra = r.porCuenta.find((x) => x.id === Number(c.otra));
  assert.equal(suya.prestado, 150000,
    'un cuerpo con $ 150.000 prestados decía tener $ 150.000, teniendo cero');
  assert.equal(laOtra.prestado, 0, 'y la caja de al lado no debe nada');
});

test('lo que la iglesia prestó no cuenta como deuda suya', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  await api('POST', '/deudas', unPrestamo(c, { direccion: POR_COBRAR }));

  const r = await resumenDe(api, c);
  assert.equal(r.porCuenta.find((x) => x.id === Number(c.caja)).prestado, 0,
    'esa plata no hay que devolverla: hay que cobrarla');
  assert.equal(r.le_deben, 400000);
});

// -------------------------------------------------- y nada se resta dos veces ----

test('un préstamo entre dos cajas de la casa no se cuenta como prestado', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.caja);
  await api('POST', '/deudas', unPrestamo(c, {
    contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.otra, contraparte: null,
  }));

  // Mirando LAS DOS cajas: los dos lados están a la vista
  const t = totalesDe(db, 'WHERE cuenta_id IN (?, ?) AND fecha >= ? AND fecha <= ?',
    [c.caja, c.otra, `${MES}-01`, `${MES}-31`]);
  assert.equal(t.movido, 400000, 'esa plata solo cambió de bolsillo');
  assert.equal(t.prestado_recibido, 0,
    'y no se resta dos veces: ya salió como traslado');
  assert.equal(t.ingresos, 1000000);
});

test('pero mirando una sola de las dos cajas, a esa caja sí le entró prestada', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.caja);
  await api('POST', '/deudas', unPrestamo(c, {
    contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.otra, contraparte: null,
  }));

  const t = totales(c, c.caja);
  assert.equal(t.movido, 0, 'el otro lado quedó fuera de lo que se está mirando');
  assert.equal(t.prestado_recibido, 400000, 'y a esta caja esa plata le entró prestada');
  assert.equal(t.ingresos, 1000000, 'sin inflarle los ingresos');
});

test('y mirando la caja que PRESTÓ, esa plata salió prestada, no gastada', async () => {
  /*
   * El otro lado del mismo préstamo interno. Desde la caja que puso la plata,
   * el movimiento es su ESPEJO, y hubo un filtro que los descartaba: con él,
   * esa salida no aparecía como préstamo entregado y se quedaba sumando en los
   * egresos corrientes de esa caja, como si la iglesia se hubiera gastado la
   * plata que en realidad prestó.
   */
  const api = await elSistemaAndando();
  const c = unaIglesia();
  loCorriente(c, c.otra);
  await api('POST', '/deudas', unPrestamo(c, {
    contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.otra, contraparte: null,
  }));

  const t = totales(c, c.otra);
  assert.equal(t.prestado_entregado, 400000, 'de esta caja salieron prestados');
  assert.equal(t.egresos, 1000000, 'y no se le suman a lo que la iglesia gastó');
});

test('lo que falta de un préstamo interno no se cuenta con los dos lados', async () => {
  /*
   * Acá sí importa descartar el espejo: «lo que falta pagar» suma los pagos de
   * la deuda SIN acotar por caja, así que las dos filas del par están a la
   * vista. Sumándolas, un abono de la mitad daría la deuda por saldada.
   */
  const api = await elSistemaAndando();
  const c = unaIglesia();
  const id = (await api('POST', '/deudas', unPrestamo(c, {
    cuotas: 2, contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.otra, contraparte: null,
  }))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(id)[0];
  await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: `${MES}-28`, monto: 200000, metodo: 'Transferencia',
  });

  assert.equal((await resumenDe(api, c)).se_debe, 200000,
    'pagó la mitad: debe la mitad, no cero');
});

test('los espejos no se cuentan dos veces', async () => {
  const api = await elSistemaAndando();
  const c = unaIglesia();
  const id = (await api('POST', '/deudas', unPrestamo(c, {
    contraparte_tipo: OTRA_CAJA, contraparte_cuenta_id: c.otra, contraparte: null,
  }))).json.id;
  const cuota = db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ?').all(id)[0];
  await api('POST', `/deudas/${id}/pagos`, {
    cuota_id: cuota.id, fecha: `${MES}-28`, monto: 400000, metodo: 'Transferencia',
  });

  const t = totales(c, c.caja);
  assert.equal(t.prestado_devuelto, 400000,
    'las dos filas del par llevan la misma deuda: sumándolas darían $ 800.000');
});
