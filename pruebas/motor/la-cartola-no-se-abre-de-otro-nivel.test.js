/**
 * Las dos rutas propias de una cuenta aplican el alcance entero, no la mitad.
 *
 * La plata de la organización se lleva en dos niveles y se permiten aparte:
 * la GENERAL —la corporación y cada iglesia local— y la de cada CUERPO. Es lo
 * que deja que la tesorera de un cuerpo lleve su caja sin ver el libro de la
 * iglesia, y está resuelto en un solo lugar (server/tesorerias.js), colgado del
 * alcance para que lo tomen todos los listados, fichas, planillas y guardados.
 *
 * Las dos rutas propias de la cuenta —su estado y su cartola— no pasaban por
 * ahí: comprobaban a mano `alcanzaIglesia(req.user, cuenta.iglesia_id)`, que es
 * la mitad del alcance —falta el cuerpo— y nada del nivel. Y una cuenta de la
 * corporación tiene `iglesia_id = null`, así que esa comprobación con null la
 * pasa cualquiera.
 *
 * Medido con una tesorera de cuerpo: el listado le mostraba 33 de 41 cuentas,
 * todas de su nivel; la ficha de la general de la corporación le contestaba
 * 403; su estado le devolvía el saldo —$ 56.231.187— con sus últimos diez
 * movimientos; y su cartola, 1.168 filas del año con el saldo corriendo fila a
 * fila. La puerta cerrada y la ventana de al lado abierta.
 *
 * El arreglo no es otra comprobación escrita a mano: es `registroSuyo`, que
 * existe desde la auditoría de aislamiento de la 1.98.0 —donde se encontraron
 * diez rutas propias en esta misma situación— y aplica el alcance completo en
 * una línea. Lo que se vigila acá es que las tres puertas de una cuenta —el
 * listado, la ficha y sus dos rutas— digan siempre lo mismo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const alcance = require('../../server/alcance');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');
const tesoreriaMod = require('../../server/modules/tesoreria');

/* ---------------------------------------------------------------- el mundo */

const igA = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Nivel A','IG-NIV-A','Activa')").run().lastInsertRowid;
const igB = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Nivel B','IG-NIV-B','Activa')").run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Jóvenes del Nivel A','Cuerpo',?,'Activo')")
  .run(igA).lastInsertRowid;

const abrir = (nombre, ambito, tipo, iglesiaId, cuerpoId, saldoInicial = 0) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
            VALUES (?,?,?,?,?,'Activa',?)`)
  .run(nombre, ambito, tipo, iglesiaId, cuerpoId, saldoInicial).lastInsertRowid;

const deLaCorporacion = abrir('General de la corporación del Nivel', 'Corporación', 'General', null, null, 900000);
const deLaIglesiaA = abrir('General del Nivel A', 'General', 'General', igA, null, 500000);
const deLaIglesiaB = abrir('General del Nivel B', 'General', 'General', igB, null, 300000);
const delCuerpo = abrir('Caja de los Jóvenes del Nivel A', 'Cuerpo / Grupo', 'General', igA, cuerpo, 70000);

const anotar = (cuentaId, iglesiaId, cuerpoId, monto) => db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, cuerpo_id)
            VALUES ('2026-04-10','Ingreso','Ofrendas','Lo del nivel',?,?,?,?)`)
  .run(monto, cuentaId, iglesiaId, cuerpoId);
anotar(deLaCorporacion, null, null, 100000);
anotar(deLaIglesiaA, igA, null, 40000);
anotar(deLaIglesiaB, igB, null, 20000);
anotar(delCuerpo, igA, cuerpo, 6000);

/* --------------------------------------------------------------- la gente */

/** El rol como lo guarda la base ('admin'), no su etiqueta. */
const todoPoderoso = { id: 1, rol: 'admin' };
/** Ve las dos tesorerías, pero solo la iglesia A. */
const deUnaIglesia = { id: 2, rol: 'tesorero', iglesias: JSON.stringify([igA]) };
/** Ve todas las iglesias, pero solo la tesorería de los cuerpos. */
const deLosCuerpos = { id: 3, rol: 'tesorero', permisos: JSON.stringify({ tesoreria_general: [] }) };

/** Corre una ruta de un módulo sin levantar el servidor. */
function ruta(modulo, cual) {
  let handler = null;
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; } };
  modulo.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next(), scopeClause: () => null });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (req) => {
    let cuerpo = null; let codigo = 200;
    handler(req, { json: (d) => { cuerpo = d; }, status: (c) => { codigo = c; return { json: (d) => { cuerpo = d; } }; } });
    return { codigo, d: cuerpo };
  };
}

const estado = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/estado');
const cartola = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/cartola');
const resumen = ruta(tesoreriaMod, '/tesoreria/resumen');

/** Lo que cada puerta contesta por una cuenta. */
const puertas = (user, cuentaId) => ({
  ficha: alcance.alcanza(getModule('cuentas_tesoreria'), db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId), user) ? 200 : 403,
  estado: estado({ user, params: { id: String(cuentaId) }, query: {} }).codigo,
  cartola: cartola({ user, params: { id: String(cuentaId) }, query: {} }).codigo,
});

// ----------------------------------------------------- las tres, de acuerdo ----

test('la tesorera de cuerpo no entra a la cuenta de la corporación por ninguna puerta', () => {
  const r = puertas(deLosCuerpos, deLaCorporacion);
  assert.deepEqual(r, { ficha: 403, estado: 403, cartola: 403 },
    'la cuenta de la corporación tiene iglesia_id = null, y esa era la rendija');
});

test('tampoco a la de una iglesia local', () => {
  assert.deepEqual(puertas(deLosCuerpos, deLaIglesiaA), { ficha: 403, estado: 403, cartola: 403 });
});

test('y sí a la de su cuerpo, con su saldo y su cartola', () => {
  assert.deepEqual(puertas(deLosCuerpos, delCuerpo), { ficha: 200, estado: 200, cartola: 200 });
  const { d } = estado({ user: deLosCuerpos, params: { id: String(delCuerpo) }, query: {} });
  assert.equal(d.saldo, 76000, '70.000 de partida + 6.000');
});

test('quien está asignado a una iglesia no mira la caja de la otra', () => {
  assert.deepEqual(puertas(deUnaIglesia, deLaIglesiaB), { ficha: 403, estado: 403, cartola: 403 });
  assert.deepEqual(puertas(deUnaIglesia, deLaIglesiaA), { ficha: 200, estado: 200, cartola: 200 });
});

test('y al administrador no se le cerró nada', () => {
  for (const cuenta of [deLaCorporacion, deLaIglesiaA, deLaIglesiaB, delCuerpo]) {
    assert.deepEqual(puertas(todoPoderoso, cuenta), { ficha: 200, estado: 200, cartola: 200 });
  }
});

test('una cuenta que no existe se distingue de una que no le corresponde', () => {
  const noHay = estado({ user: todoPoderoso, params: { id: '999999' }, query: {} });
  assert.equal(noHay.codigo, 404);
  assert.match(noHay.d.error, /no se encontró/,
    'y concuerda: «Esa cuenta no encontrado» le quedaba mal a la mitad de los módulos');
  const noEsSuya = estado({ user: deLosCuerpos, params: { id: String(deLaCorporacion) }, query: {} });
  assert.equal(noEsSuya.codigo, 403);
  assert.match(noEsSuya.d.error, /fuera de lo que tiene asignado/,
    'a quien se topa con esto no le sirve un «no existe»: lo que tiene que hacer es pedir que se lo asignen');
});

// ------------------------------------------ el resumen dice las mismas cuentas ----

/** Las cuentas que esta persona ve en su listado, por el mismo camino que el listado. */
function suListado(user) {
  const params = [];
  const donde = alcance.condiciones(getModule('cuentas_tesoreria'), user, params);
  return db.prepare(`SELECT id FROM cuentas_tesoreria ${donde ? `WHERE ${donde}` : ''}`).all(...params).map((c) => c.id);
}

test('el resumen de Tesorería devuelve exactamente las cuentas que esa persona ve', () => {
  for (const [quien, user] of [['administrador', todoPoderoso], ['de una iglesia', deUnaIglesia], ['de los cuerpos', deLosCuerpos]]) {
    const suyas = suListado(user).sort((a, b) => a - b);
    const { d } = resumen({ user, query: {} });
    const enElResumen = (d.porCuenta || []).map((c) => c.id).sort((a, b) => a - b);
    assert.deepEqual(enElResumen, suyas,
      `${quien}: el resumen y el listado tienen que decir las mismas cuentas`);
  }
});

test('el recorte se aplica a la CUENTA y no al movimiento que se le pega al lado', () => {
  /*
   * La consulta une cuentas_tesoreria con tesoreria, y las dos tienen una
   * columna `iglesia_id`. Las condiciones del alcance vienen con los nombres de
   * columna a secas, así que pegadas al WHERE se ataban al MOVIMIENTO: a un
   * tesorero de una sola iglesia, que ve varias cuentas, el resumen le devolvía
   * cero. Por eso el recorte va en una subconsulta sobre la tabla sola.
   */
  const { d } = resumen({ user: deUnaIglesia, query: {} });
  assert.ok((d.porCuenta || []).length > 0, 'ver menos no es ver nada');
  assert.ok(d.porCuenta.some((c) => c.id === deLaIglesiaA), 'su propia caja tiene que estar');
  const suya = d.porCuenta.find((c) => c.id === deLaIglesiaA);
  assert.equal(suya.saldo, 540000, '500.000 de partida + 40.000: la cifra sigue siendo la correcta');
});

// -------------------------------------------------------- y no vuelve a mano ----

const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');

test('las dos rutas piden el alcance en una línea, no lo escriben a mano', () => {
  const cuantas = (modulo.match(/registroSuyo\(req, res, 'cuentas_tesoreria'/g) || []).length;
  assert.equal(cuantas, 2, 'el estado y la cartola');
  // Sin los comentarios: el de la cartola cuenta cómo era antes y NOMBRA la
  // comprobación vieja, que es justo lo que se está buscando acá
  const sinComentarios = modulo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(sinComentarios, /alcanzaIglesia/,
    'esa comprobación es la mitad del alcance —falta el cuerpo— y nada del nivel de tesorería');
});
