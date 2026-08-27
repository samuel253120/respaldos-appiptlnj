/**
 * El plazo de una solicitud y la bandeja por donde se entra a trabajarlas.
 *
 * Son dos cosas que tienen que decir LO MISMO. El recordatorio dice «esta ya
 * debía estar contestada» y la bandeja muestra «pasadas de plazo»: si cada uno
 * usara su propia regla, el sistema avisaría de una solicitud que la pantalla
 * no marca, o al revés, y ninguna de las dos volvería a creerse.
 *
 * Lo que se cuida acá:
 *
 *   · QUE EL PLAZO COMPROMETIDO MANDE. Se usaba un solo número de días, igual
 *     para todo: una ayuda de urgencia prometida para el jueves y un trámite
 *     que puede esperar un mes avisaban el mismo día. Puesta la fecha, es esa.
 *   · QUE SIN COMPROMISO SIGA VALIENDO EL PLAZO GENERAL, o las solicitudes que
 *     nadie comprometió dejarían de avisar del todo.
 *   · QUE LA BANDEJA NO ABRA NADA. Es otra puerta a las mismas solicitudes: si
 *     no pasara por el alcance, sería la forma de ver lo que no le toca a uno.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const vigia = require('../../server/avisos/vigia');
const ajustes = require('../../server/ajustes');
const solicitudes = require('../../server/modules/solicitudes');

const hoy = new Date();
const dia = (cuantos) => {
  const d = new Date(hoy);
  d.setDate(d.getDate() + cuantos);
  return d.toISOString().slice(0, 10);
};

let cuantos = 0;
const unaIglesia = (codigo) =>
  db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Del plazo ${++cuantos}`, codigo).lastInsertRowid;
const unUsuario = (nombre) =>
  db.prepare("INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, 'secretario', 1, 'x')")
    .run(nombre, `${71000000 + cuantos++}-0`).lastInsertRowid;

const IGLESIA = unaIglesia('PLAZO');
const OTRA = unaIglesia('PLAZO2');
const ANA = unUsuario('Ana la del plazo');
const LUIS = unUsuario('Luis el de al lado');

/** Una solicitud, con lo justo para que cuente. */
function unaSolicitud(campos = {}) {
  const base = {
    numero: `SOL-PLAZO-${String(++cuantos).padStart(4, '0')}-2097`,
    fecha: dia(-3), fecha_compromiso: null, fecha_respuesta: null,
    iglesia_id: IGLESIA, solicitante: 'Quien pidió', tipo: 'Otro',
    asunto: 'Un asunto', estado: 'Pendiente', responsable_id: ANA,
    ...campos,
  };
  return db.prepare(
    `INSERT INTO solicitudes (numero, fecha, fecha_compromiso, fecha_respuesta, iglesia_id,
                              solicitante, tipo, asunto, estado, responsable_id)
     VALUES (@numero, @fecha, @fecha_compromiso, @fecha_respuesta, @iglesia_id,
             @solicitante, @tipo, @asunto, @estado, @responsable_id)`
  ).run(base).lastInsertRowid;
}

/** Los avisos que le tocarían hoy a esa persona, sin guardarlos. */
function avisosDe(usuarioId) {
  const salieron = [];
  vigia.solicitudesSinRespuesta({ id: usuarioId }, (a) => salieron.push(a));
  return salieron;
}
const avisoDe = (usuarioId, id) =>
  avisosDe(usuarioId).find((a) => a.clave === `solicitud_lenta:${id}`);

ajustes.guardar('avisos_solicitud_dias', '7');

// ------------------------------------- el plazo comprometido es el que manda --

test('con la fecha comprometida pasada, avisa aunque el plazo general no se haya cumplido', () => {
  const s = unaSolicitud({ fecha: dia(-1), fecha_compromiso: dia(-1) });
  const a = avisoDe(ANA, s);
  assert.ok(a, 'entró ayer, pero se prometió para ayer: ya está atrasada');
  assert.match(a.titulo, /pasó su plazo/i);
  assert.match(a.cuerpo, /Se comprometió respuesta para el/);
});

test('con la fecha comprometida por delante, NO avisa aunque lleve semanas abierta', () => {
  const s = unaSolicitud({ fecha: dia(-40), fecha_compromiso: dia(+10) });
  assert.equal(avisoDe(ANA, s), undefined,
    'lleva 40 días, pero se prometió para dentro de 10: no está atrasada');
});

test('el día comprometido todavía no está pasado', () => {
  const s = unaSolicitud({ fecha: dia(-30), fecha_compromiso: dia(0) });
  assert.equal(avisoDe(ANA, s), undefined, 'se prometió para hoy, y hoy no terminó');
});

// --------------------------------- sin compromiso, el plazo general de siempre --

test('sin fecha comprometida sigue valiendo el número de días de Configuración', () => {
  const vieja = unaSolicitud({ fecha: dia(-30) });
  const nueva = unaSolicitud({ fecha: dia(-1) });
  assert.ok(avisoDe(ANA, vieja), 'lleva 30 días y el plazo general son 7');
  assert.equal(avisoDe(ANA, nueva), undefined, 'esta entró ayer');
  assert.match(avisoDe(ANA, vieja).titulo, /sigue sin respuesta/i);
});

test('una solicitud cerrada no avisa nunca, tenga el plazo que tenga', () => {
  for (const estado of solicitudes.CERRADOS) {
    const s = unaSolicitud({ fecha: dia(-90), fecha_compromiso: dia(-60), estado });
    assert.equal(avisoDe(ANA, s), undefined, `avisó de una ${estado}`);
  }
});

test('el aviso es de quien la lleva, y de nadie más', () => {
  const s = unaSolicitud({ fecha: dia(-30), responsable_id: LUIS });
  assert.ok(avisoDe(LUIS, s), 'a Luis sí');
  assert.equal(avisoDe(ANA, s), undefined, 'a Ana no: no es suya');
});

// ------------------------------------------------------------- la bandeja ---

/** Llama a la ruta de la bandeja como lo haría el servidor. */
function bandeja(usuario, consulta = {}) {
  let atender = null;
  const router = {
    get(ruta, permiso, mano) { if (ruta === '/solicitudes/bandeja') atender = mano; },
    post() {},
  };
  solicitudes.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next() });
  assert.ok(atender, 'la ruta de la bandeja tiene que estar registrada');
  let salida = null;
  atender({ user: usuario, query: consulta }, { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

const YO = { id: ANA, rol: 'admin' };

test('la bandeja trae todas sus cuentas, siempre', () => {
  const d = bandeja(YO);
  assert.deepEqual(Object.keys(d.cuentas).sort(),
    ['abiertas', 'cerradas', 'huerfanas', 'mias', 'vencidas']);
  assert.equal(d.caja, 'mias', 'se abre en lo que uno lleva');
});

test('«las que llevo yo» son las abiertas a mi nombre', () => {
  const mia = unaSolicitud({ responsable_id: ANA, estado: 'En revisión' });
  const suya = unaSolicitud({ responsable_id: LUIS, estado: 'En revisión' });
  const cerrada = unaSolicitud({ responsable_id: ANA, estado: 'Completada', fecha_respuesta: dia(-1) });
  const ids = bandeja(YO, { caja: 'mias' }).filas.map((f) => f.id);
  assert.ok(ids.includes(mia));
  assert.ok(!ids.includes(suya), 'la de Luis no es mía');
  assert.ok(!ids.includes(cerrada), 'una cerrada ya no está en trámite');
});

test('«pasadas de plazo» dice lo mismo que el recordatorio', () => {
  const vencida = unaSolicitud({ fecha: dia(-2), fecha_compromiso: dia(-2), responsable_id: ANA });
  const aTiempo = unaSolicitud({ fecha: dia(-2), fecha_compromiso: dia(+5), responsable_id: ANA });
  const ids = bandeja(YO, { caja: 'vencidas' }).filas.map((f) => f.id);
  assert.ok(ids.includes(vencida), 'la que el aviso marca, la bandeja la muestra');
  assert.ok(!!avisoDe(ANA, vencida), 'y el aviso la marca');
  assert.ok(!ids.includes(aTiempo));
  assert.equal(avisoDe(ANA, aTiempo), undefined);
});

test('«todas las abiertas» incluye las de otros, y ninguna cerrada', () => {
  const deOtro = unaSolicitud({ responsable_id: LUIS, estado: 'Pendiente' });
  const d = bandeja(YO, { caja: 'abiertas' });
  assert.ok(d.filas.map((f) => f.id).includes(deOtro), 'es la vista de quien coordina');
  assert.ok(d.filas.every((f) => !solicitudes.CERRADOS.includes(f.estado)));
});

test('«cerradas» son las resueltas del último mes, y no las de antes', () => {
  const reciente = unaSolicitud({ estado: 'Completada', fecha_respuesta: dia(-5) });
  const antigua = unaSolicitud({ estado: 'Completada', fecha: dia(-200), fecha_respuesta: dia(-200) });
  const ids = bandeja(YO, { caja: 'cerradas' }).filas.map((f) => f.id);
  assert.ok(ids.includes(reciente));
  assert.ok(!ids.includes(antigua), 'lo de hace medio año no es lo que se rinde este mes');
});

test('filtrando por iglesia no se cuela la de al lado', () => {
  const aca = unaSolicitud({ estado: 'Pendiente' });
  const alla = unaSolicitud({ estado: 'Pendiente', iglesia_id: OTRA });
  const ids = bandeja(YO, { caja: 'abiertas', iglesia_id: IGLESIA }).filas.map((f) => f.id);
  assert.ok(ids.includes(aca));
  assert.ok(!ids.includes(alla));
});

test('LA BANDEJA NO ABRE NADA: pasa por el mismo alcance que el listado', () => {
  const deOtraIglesia = unaSolicitud({ estado: 'Pendiente', iglesia_id: OTRA, responsable_id: LUIS });
  const acotado = { id: LUIS, rol: 'secretario', iglesias: [IGLESIA] };
  const d = bandeja(acotado, { caja: 'abiertas' });
  assert.ok(!d.filas.map((f) => f.id).includes(deOtraIglesia),
    'quien solo administra una iglesia no ve por acá las de otra');
  assert.ok(d.filas.every((f) => Number(f.iglesia_id) === IGLESIA));
});

test('cada fila trae de qué iglesia es y quién la lleva, para poder mirarlas juntas', () => {
  const suya = unaSolicitud({ estado: 'Pendiente', responsable_id: LUIS });
  const f = bandeja(YO, { caja: 'abiertas', iglesia_id: IGLESIA }).filas.find((x) => x.id === suya);
  assert.ok(f, 'la solicitud recién creada tiene que estar');
  assert.equal(f.responsable, 'Luis el de al lado', 'sin el nombre, la bandeja de quien coordina no sirve');
  assert.ok(String(f.iglesia || '').startsWith('Del plazo'), `dijo «${f.iglesia}»`);
});
