/**
 * UN PARÁMETRO ESCRITO QUE NO LLEGABA NUNCA.
 *
 * La planilla de un cuerpo cobra con un clic y toma el monto de la cuota del
 * cuerpo, que es lo correcto y lo cómodo. Y `registrarPago` siempre supo
 * recibir un monto —la línea estaba escrita: `Number(monto) > 0 ? ... : la
 * cuota del cuerpo`— pero la ruta nunca se lo pasaba. Tampoco la fecha ni la
 * forma de pago.
 *
 * Así que quien pagó de más o de menos —una cuota atrasada saldada con un
 * abono, un aporte voluntario mayor— solo podía anotarlo abriendo la ficha
 * suelta. Eso empujaba a la otra puerta justamente cuando el caso se sale de lo
 * corriente, que es cuando más falta hace que quede constancia.
 *
 * MEDIDO en la v1.415.0, por la planilla, sobre un cuerpo cuya cuota es de
 * $ 5.000: mandar `monto: 8000` contestó 200 y anotó $ 5.000.
 *
 * Y con el monto viajando, la pregunta que ya existía por la otra puerta tiene
 * que existir por ésta: la regla del monto se mudó a server/cuotas.js, escrita
 * una sola vez, y las dos la piden. Es la tercera vez en esta revisión —después
 * de `aQuienNoSeLeCobra` y de `avisoSiElMesEstaMuyAdelante`— y por eso ya no se
 * discute: la regla vive en el sitio compartido desde el principio.
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
  .run(`Central PM ${marca}`, `PM-${marca}`).lastInsertRowid;

function unCuerpo({ cuota = 5000 } = {}) {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, ?)`
  ).run(`Damas ${++n} PM ${marca}`, iglesia, cuota).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} PM ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga PM ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga PM ${marca}`, iglesia).lastInsertRowid;
}

const enLaCaja = (cuerpo) => db.prepare(
  "SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE cuerpo_id = ? AND tipo = 'Ingreso'"
).get(cuerpo).t;

test('sin monto sigue mandando la cuota del cuerpo: cobrar es un clic', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '07' });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.monto, 5000);
  assert.equal(enLaCaja(cuerpo), 5000, 'y su movimiento entra por lo mismo');
});

test('con monto, se anota lo que se manda', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '07', monto: 8000 });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.monto, 8000, 'antes de esto contestaba 200 y anotaba $ 5.000');
  assert.equal(enLaCaja(cuerpo), 8000, 'y el movimiento lleva la misma plata, no la de la ficha del cuerpo');
});

test('y la fecha y la forma de pago también, si vienen', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`, {
    integrante_id: unaFicha(cuerpo), anio: 2026, mes: '08',
    fecha_pago: '2026-08-20', metodo: 'Transferencia',
  });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.fecha_pago, '2026-08-20');
  assert.equal(r.json.metodo, 'Transferencia');

  const sinNada = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '08' });
  assert.equal(sinNada.json.metodo, 'Efectivo', 'y sin ellas, lo de siempre');
  assert.equal(sinNada.json.fecha_pago, require('../../server/fechas').hoy());
});

test('un monto disparatado se pregunta también por esta puerta', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const ficha = unaFicha(cuerpo);
  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 99000000 });
  assert.equal(r.estado, 400, `dejar entrar el monto sin la pregunta sería abrir el agujero: ${r.texto}`);
  assert.equal(r.json.confirmar, 'el_monto_no_calza_con_la_cuota');
  assert.match(r.json.error, /\$ 5\.000/, 'con los dos números, igual que por la otra puerta');
  assert.equal(enLaCaja(cuerpo), 0);

  const igual = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 99000000, igual_asi: true });
  assert.equal(igual.estado, 200, `y quien confirma, guarda: ${igual.texto}`);
  assert.equal(enLaCaja(cuerpo), 99000000);
});

test('las dos puertas preguntan lo mismo, con el mismo texto', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cuota: 5000 });
  const porFicha = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '07', monto: 60000, fecha_pago: '2026-07-05' });
  const porPlanilla = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '07', monto: 60000 });
  assert.equal(porFicha.estado, 400, porFicha.texto);
  assert.equal(porPlanilla.estado, 400, porPlanilla.texto);
  assert.equal(porFicha.json.error, porPlanilla.json.error,
    'dos avisos distintos para la misma regla es la señal de que está escrita dos veces');
  assert.equal(porFicha.json.confirmar, porPlanilla.json.confirmar);
});

test('la regla del monto está escrita una sola vez, y las dos puertas la piden', () => {
  const compartido = fs.readFileSync(path.join(__dirname, '../../server/cuotas.js'), 'utf8');
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuotas_cuerpo.js'), 'utf8');
  assert.match(compartido, /function avisoSiElMontoNoCalza/, 'la regla vive en el sitio compartido');
  assert.match(modulo, /avisoSiElMontoNoCalza\(db, ficha\.cuerpo_id, data\.monto\)/, 'y el módulo la pide');
  assert.ok(!/CUANTAS_CUOTAS_YA_SON_MUCHAS/.test(modulo), 'sin su propia copia del tope');
});

test('y la regla, sola, cuenta bien las cuotas', () => {
  const cuerpo = unCuerpo({ cuota: 5000 });
  assert.equal(cuotas.avisoSiElMontoNoCalza(db, cuerpo, 5000), null, 'una cuota');
  assert.equal(cuotas.avisoSiElMontoNoCalza(db, cuerpo, 45000), null, 'nueve, que es pagar casi el año');
  assert.match(String(cuotas.avisoSiElMontoNoCalza(db, cuerpo, 50000).error), /10 cuotas/,
    'diez: el cero de más queda justo adentro');
  assert.equal(cuotas.avisoSiElMontoNoCalza(db, unCuerpo({ cuota: 0 }), 99000000), null,
    'y donde no hay cuota declarada no hay con qué comparar');
});

test('la ruta le pasa a `registrarPago` lo que siempre supo recibir', () => {
  const cuerpos = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  const desde = cuerpos.indexOf("router.post('/cuerpos/:id(\\\\d+)/cuotas'");
  assert.ok(desde > 0, 'se encontró la ruta');
  const ruta = cuerpos.slice(desde, cuerpos.indexOf('\n    });', desde));
  for (const cual of ['monto:', 'fecha:', 'metodo:', 'confirmado:']) {
    assert.ok(ruta.includes(cual), `la ruta no le pasa ${cual}`);
  }
});

test('y la planilla le manda a la pantalla CUÁL es cada cuota', async () => {
  /*
   * Sin el `id` la casilla sabía cuánto decía y no sabía de qué cuota hablaba:
   * al tocarla mandaba un PUT a «/cuotas_cuerpo/undefined» y contestaba 404.
   * Lo destapó el navegador, no la prueba: la primera versión de la
   * comprobación de abajo miraba la forma de la pantalla y daba por hecho que
   * el dato llegaba.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const puesta = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '07' });
  assert.equal(puesta.estado, 200, puesta.texto);

  const pl = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2026`);
  const suyo = pl.json.filas[0].meses['07'];
  assert.equal(suyo.id, puesta.json.id, 'el número de la cuota, que es con lo que se la corrige');
  assert.equal(suyo.monto, 5000, 'y lo que ya venía');
  assert.ok(suyo.fecha);
});

test('la planilla deja corregir el monto de una cuota ya anotada, sin ir a su ficha', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderCuotasCuerpo');
  assert.ok(desde > 0);
  const pantalla = app.slice(desde, app.indexOf('async function renderPlanDeCuotas'));

  assert.match(pantalla, /class="mes pagado\$\{d\.puede_cobrar \? ' se-corrige' : ''\}/,
    'y solo a quien puede cobrar: a los demás la casilla no se ofrece');
  assert.match(pantalla, /data-cuota="\$\{pago\.id\}"/, 'la casilla sabe qué cuota es');
  assert.match(pantalla, /td\.mes\.pagado\.se-corrige/, 'y hay quien la escuche');
  assert.match(pantalla, /guardarPreguntando\(`\/cuotas_cuerpo\/\$\{celda\.dataset\.cuota\}`, \{ monto \}, 'PUT'\)/,
    'por la ficha de la cuota: es una corrección, no un cobro, y así pasa por las mismas reglas');
  assert.match(pantalla, /Cuánto se pagó/, 'preguntando cuánto, como en el plan de una deuda');
});

test('y el ayudante que pregunta sabe mandar un PUT, no solo un POST', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function guardarPreguntando');
  const suyo = app.slice(desde, app.indexOf('\n}', desde) + 2);
  assert.match(suyo, /metodo = 'POST'/, 'y por omisión sigue siendo POST: quien ya lo usaba no cambia');
  assert.equal((suyo.match(/api\(metodo, ruta/g) || []).length, 2,
    'las dos veces —la primera y la confirmada— con el mismo método');
});

test('el estilo de la casilla que se corrige existe: sin él nada dice que se puede tocar', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const reglas = css.match(/table\.grid\.cuotas td\.pagado\.se-corrige[^{]*\{/g) || [];
  const base = reglas.filter((r) => !r.includes(':hover'));
  assert.equal(base.length, 1, `reglas base encontradas: ${JSON.stringify(reglas)}`);
});
