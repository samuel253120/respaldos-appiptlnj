/**
 * LA ÚNICA RUTA DEL MÓDULO NO SE PEDÍA EN NINGUNA PRUEBA.
 *
 * De ella depende lo que el módulo promete en su cabecera: «al registrar un
 * gasto no aparece Diezmos». Que el filtro por tipo funcione, que «Ambos» salga
 * en los dos lados, que una categoría desactivada deje de ofrecerse y que la
 * ruta pida la llave que corresponde: nada de eso lo comprobaba nadie.
 *
 * Y el módulo entero tampoco tenía pruebas propias. Hay un archivo que parece
 * suyo y no lo es —`la-categoria-que-cambio-de-nombre.test.js` trata de la
 * categoría de una IGLESIA, CENTRAL pasando a MATRIZ en las credenciales—. Lo
 * único que lo tocaba era la suite de seguridad, creando una categoría SIN
 * movimientos y borrándola: el camino feliz, no el rechazo. La única regla del
 * módulo no se ejecutaba en ninguna prueba del sistema.
 *
 * Es un módulo de ochenta renglones, y esa regla es la que sostiene que los
 * informes de años anteriores sigan cuadrando: exactamente el tamaño de cosa
 * que alguien «simplifica» en una tarde sin que nada se ponga rojo.
 *
 * Lo que cuida este archivo:
 *   · que al anotar un ingreso no se ofrezcan las de gasto, y al revés
 *   · que «Ambos» salga en los dos lados
 *   · que una desactivada deje de ofrecerse, sin tocar lo ya anotado
 *   · que la ruta pida la llave de tesorería
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

const MARCA = `o${process.pid}`;

const nuevaCategoria = (nombre, tipo) => db
  .prepare("INSERT INTO categorias_tesoreria (nombre, tipo, activo) VALUES (?, ?, 1)")
  .run(`${nombre} ${MARCA}`, tipo).lastInsertRowid;

/** Las tres de esta prueba, una de cada tipo. */
const SOLO_INGRESO = nuevaCategoria('Diezmo de la ruta', 'Ingreso');
const SOLO_EGRESO = nuevaCategoria('Luz y agua de la ruta', 'Egreso');
const LAS_DOS = nuevaCategoria('Actividad de la ruta', 'Ambos');

const comoSeLlama = (id) => db.prepare('SELECT nombre FROM categorias_tesoreria WHERE id = ?').get(id).nombre;

/** Lo que la ruta ofrece, en nombres. */
async function loQueSeOfrece(api, tipo) {
  const r = await api('GET', `/categorias_tesoreria/opciones${tipo ? `?tipo=${encodeURIComponent(tipo)}` : ''}`);
  assert.equal(r.estado, 200, `la ruta tiene que contestar: ${r.texto.slice(0, 120)}`);
  return r.json.map((o) => o.id);
}

/* ------------------------------------------------- el filtro por tipo */

test('al anotar un ingreso se ofrecen las de ingreso y las de ambos, no las de gasto', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api, 'Ingreso');
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_INGRESO)));
  assert.ok(ofrecidas.includes(comoSeLlama(LAS_DOS)), '«Ambos» sale en los dos lados');
  assert.ok(!ofrecidas.includes(comoSeLlama(SOLO_EGRESO)),
    'es lo que promete la cabecera del módulo: al registrar un gasto no aparece «Diezmos»');
});

test('y al anotar un gasto, al revés', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api, 'Egreso');
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_EGRESO)));
  assert.ok(ofrecidas.includes(comoSeLlama(LAS_DOS)));
  assert.ok(!ofrecidas.includes(comoSeLlama(SOLO_INGRESO)));
});

test('sin decir de qué tipo, se ofrecen todas', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api);
  for (const id of [SOLO_INGRESO, SOLO_EGRESO, LAS_DOS]) {
    assert.ok(ofrecidas.includes(comoSeLlama(id)), `falta ${comoSeLlama(id)}`);
  }
});

test('un tipo que no existe se ignora, y se ofrecen todas', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api, 'Lo Que Sea');
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_INGRESO)));
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_EGRESO)),
    'ante un tipo desconocido no se inventa un filtro: se ofrece la lista entera');
});

test('«Ambos» como tipo pedido trae la lista entera, no solo las de «Ambos»', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api, 'Ambos');
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_INGRESO)));
  assert.ok(ofrecidas.includes(comoSeLlama(SOLO_EGRESO)));
});

/* ------------------------------------------------- lo que se ofrece y lo que no */

test('una categoría desactivada deja de ofrecerse', async () => {
  const api = await elSistemaAndando();
  const id = nuevaCategoria('Pro-Templo del año pasado', 'Ingreso');
  assert.ok((await loQueSeOfrece(api, 'Ingreso')).includes(comoSeLlama(id)));

  db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?').run(id);
  assert.ok(!(await loQueSeOfrece(api, 'Ingreso')).includes(comoSeLlama(id)),
    'es para lo que sirve desmarcar «En uso»');
});

test('pero lo ya anotado con ella no se toca', async () => {
  const api = await elSistemaAndando();
  const id = nuevaCategoria('Ofrenda de aniversario', 'Ingreso');
  const nombre = comoSeLlama(id);
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto)
     VALUES (date('now','localtime'), 'Ingreso', ?, 'Lo del aniversario', 300000)`
  ).run(nombre);

  db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?').run(id);
  assert.ok(!(await loQueSeOfrece(api, 'Ingreso')).includes(nombre), 'no se ofrece para lo nuevo');
  assert.equal(
    db.prepare('SELECT categoria FROM tesoreria WHERE concepto = ?').get('Lo del aniversario').categoria,
    nombre,
    'y el movimiento sigue diciendo lo que decía'
  );
});

test('las opciones vienen con la forma que el desplegable espera', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', '/categorias_tesoreria/opciones?tipo=Ingreso');
  const suya = r.json.find((o) => o.id === comoSeLlama(SOLO_INGRESO));
  assert.ok(suya);
  assert.equal(suya.id, suya.label,
    'el valor es el NOMBRE, porque es el nombre lo que se guarda en el movimiento');
});

test('vienen ordenadas por nombre', async () => {
  const api = await elSistemaAndando();
  const ofrecidas = await loQueSeOfrece(api, 'Ingreso');
  const ordenadas = [...ofrecidas].sort();
  assert.deepEqual(ofrecidas, ordenadas);
});

/* ------------------------------------------------- la llave que pide */

test('la ruta pide la llave de tesorería, no la del módulo de categorías', async () => {
  await elSistemaAndando();
  /*
   * Es la llave correcta: quien va a clasificar un movimiento es quien lleva la
   * tesorería. El rol «consulta» la tiene cerrada desde la v1.203.0.
   */
  const quien = db
    .prepare("INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, 'consulta', 1, 'x')")
    .run(`Solo mira ${MARCA}`, `${process.pid}90-0`).lastInsertRowid;

  const r = await comoOtroUsuario(quien)('GET', '/categorias_tesoreria/opciones?tipo=Ingreso');
  assert.equal(r.estado, 403, 'quien no lleva la tesorería no necesita esta lista');
});
