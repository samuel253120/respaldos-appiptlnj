/**
 * Dos cuerpos que se llaman igual.
 *
 * Medido antes de esto, creando dos «Damas» en la misma Iglesia Central, una
 * detrás de la otra:
 *
 *   la primera .......................... 201
 *   la segunda, MISMA iglesia ........... 201, sin una palabra
 *   otra igual en OTRA iglesia .......... 201
 *   lo que ofrece el desplegable ........ «Damas» · «Damas» · «Damas»
 *   y la lista de los filtros ........... lo mismo
 *
 * Ese desplegable es por el que se elige a qué cuerpo se le anota una
 * actividad, un movimiento de tesorería, un acta o un bien. Elegir el
 * equivocado no se nota después: la plata queda en la caja de otro cuerpo y la
 * asistencia, en la lista de otro.
 *
 * Es el mismo defecto que la 1.238.0 le corrigió a las Iglesias, y se arregla
 * igual: se pregunta —solo cuando el otro está en la MISMA iglesia— y los
 * desplegables dejan de mostrarlos idénticos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const nombres = require('../../server/el-nombre-del-cuerpo');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = (comoSeLlama) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`${comoSeLlama} CN ${marca()}`, `CN${marca()}`).lastInsertRowid;
const A = iglesia('Central');
const B = iglesia('Norte');

const cuerpo = (nombre, iglesiaId = A, { tipo = 'Cuerpo', estado = 'Activo' } = {}) => db
  .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)')
  .run(nombre, tipo, iglesiaId, estado).lastInsertRowid;
const fila = (id) => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(id);

const alGuardar = (data, existing = null, confirmado = false) =>
  nombres.avisoDeCuerpoRepetido(db, data, { existing, confirmado });

// ---------------------------------------------------------- la pregunta ----

test('crear otro con el mismo nombre en la MISMA iglesia pregunta', () => {
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  const aviso = alGuardar({ nombre: como, iglesia_id: A });
  assert.equal(aviso && aviso.confirmar, 'cuerpo_con_el_mismo_nombre', 'es una pregunta, no un rechazo');
  assert.match(aviso.error, /ya tiene otro que se llama así \(un cuerpo\)/);
  assert.match(aviso.error, /Central CN/, 'y nombra la iglesia donde está el otro');
  assert.match(aviso.error, /elegir el equivocado no se nota después/i, 'y dice por qué importa');
  assert.match(aviso.error, /si es el mismo escrito dos veces, cámbiele el nombre a uno/i);
});

test('pero el mismo nombre en OTRA iglesia no pregunta nada', () => {
  /*
   * Es la mitad que decide si esto sirve o estorba: que cada congregación
   * tenga sus «Damas» y sus «Jóvenes» es lo normal. Preguntarlo ahí sería un
   * aviso en casi cada cuerpo nuevo de la organización.
   */
  const como = `Jovenes ${marca()}`;
  cuerpo(como, A);
  assert.equal(alGuardar({ nombre: como, iglesia_id: B }), null);
});

test('y se compara sin tildes ni mayúsculas', () => {
  const base = `Jóvenes ${marca()}`;
  cuerpo(base, A);
  assert.ok(alGuardar({ nombre: base.replace('ó', 'o').toUpperCase(), iglesia_id: A }),
    '«JOVENES» y «Jóvenes» son el mismo nombre para quien los lee en un desplegable');
  assert.ok(alGuardar({ nombre: `  ${base}   `, iglesia_id: A }), 'y los espacios de más tampoco cuentan');
});

test('dice cuántos son y cómo son cuando hay varios', () => {
  const como = `Coro ${marca()}`;
  cuerpo(como, A);
  cuerpo(como, A, { tipo: 'Grupo' });
  cuerpo(como, A, { estado: 'Inactivo' });
  const aviso = alGuardar({ nombre: como, iglesia_id: A });
  assert.match(aviso.error, /ya tiene 3 que se llaman así/);
  assert.match(aviso.error, /un grupo/, 'y distingue el que es grupo');
  assert.match(aviso.error, /inactivo/, 'y el que ya no funciona');
});

test('contestando que sí, se guarda', () => {
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  assert.equal(alGuardar({ nombre: como, iglesia_id: A }, null, true), null);
});

test('corregirle el teléfono a uno que ya se llamaba igual no vuelve a preguntar', () => {
  /*
   * Volver a preguntarlo cada vez no cuida el dato: enseña a apretar «Está
   * bien» sin leer. Es la misma regla que usan los otros avisos del sistema.
   */
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  const yo = fila(cuerpo(como, A));
  assert.equal(alGuardar({ descripcion: 'Otra cosa' }, yo), null);
  assert.equal(alGuardar({ nombre: como }, yo), null, 'volver a mandar el mismo nombre no lo repite');
});

test('pero RENOMBRARLO para que choque con otro sí pregunta', () => {
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  const yo = fila(cuerpo(`Otro ${marca()}`, A));
  assert.ok(alGuardar({ nombre: como }, yo));
});

test('y MUDARLO a una iglesia donde ya hay uno así, también', () => {
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  const yo = fila(cuerpo(como, B));
  assert.ok(alGuardar({ iglesia_id: A }, yo),
    'el cuerpo no cambia de nombre, pero llega a una iglesia donde ese nombre ya está');
});

test('no se compara consigo mismo', () => {
  /*
   * Por dos caminos distintos, y los dos hacen falta.
   *
   * Por arriba: el guardado que no toca ni el nombre ni la iglesia sale antes
   * de mirar nada. Y por dentro: «los que se llaman igual QUE ÉSTE» son los
   * otros, y eso es parte del contrato de esa función, que se pide también
   * desde fuera. Comprobarlo solo por el primer camino dejaba el segundo sin
   * probar —se vio al romperlo a propósito: quitar la exclusión no hacía
   * fallar ninguna prueba— y una función que se llama «los OTROS» tiene que
   * cumplirlo por su cuenta.
   */
  const como = `Damas ${marca()}`;
  const yo = fila(cuerpo(como, A));
  assert.equal(alGuardar({ nombre: como, iglesia_id: A }, yo), null);

  assert.deepEqual(nombres.losQueSeLlamanIgual(db, como, A, yo.id), [],
    'preguntando por él mismo, no hay ningún otro');
  const otro = cuerpo(como, A);
  assert.deepEqual(nombres.losQueSeLlamanIgual(db, como, A, yo.id).map((o) => o.id), [otro],
    'y con otro al lado sale el otro, no los dos');
});

test('un cuerpo sin iglesia no se compara con nada', () => {
  assert.equal(alGuardar({ nombre: 'Damas', iglesia_id: null }), null);
});

// ------------------------------------------- y el desplegable los separa ----

const ofrecer = (ids) => nombres.conLoQueLosDistingue(
  ids.map((id) => ({ id, label: fila(id).nombre })), db
).map((o) => o.label);

test('a los repetidos se les agrega su iglesia', () => {
  const como = `Damas ${marca()}`;
  const uno = cuerpo(como, A);
  const dos = cuerpo(como, B);
  const salen = ofrecer([uno, dos]);
  assert.match(salen[0], /· Central CN/);
  assert.match(salen[1], /· Norte CN/);
  assert.notEqual(salen[0], salen[1], 'que es de lo que se trata: que no salgan idénticos');
});

test('y su tipo cuando lo que cambia es eso', () => {
  const como = `Aseo ${marca()}`;
  const uno = cuerpo(como, A, { tipo: 'Cuerpo' });
  const dos = cuerpo(como, A, { tipo: 'Grupo' });
  const salen = ofrecer([uno, dos]);
  assert.match(salen[0], /· Cuerpo$/);
  assert.match(salen[1], /· Grupo$/);
  assert.ok(!salen[0].includes('Central'), 'la iglesia no se agrega si es la misma: no distingue nada');
});

test('las dos cosas cuando cambian las dos', () => {
  const como = `Mixto ${marca()}`;
  const uno = cuerpo(como, A, { tipo: 'Cuerpo' });
  const dos = cuerpo(como, B, { tipo: 'Grupo' });
  const salen = ofrecer([uno, dos]);
  assert.match(salen[0], /· Central CN.* · Cuerpo$/);
  assert.match(salen[1], /· Norte CN.* · Grupo$/);
});

test('y a los que NO se repiten no se les agrega nada', () => {
  const uno = cuerpo(`Solitario ${marca()}`, A);
  assert.equal(ofrecer([uno])[0], fila(uno).nombre);
});

test('a dos iguales en todo no se les inventa una diferencia', () => {
  /*
   * Misma iglesia y mismo tipo: no hay nada que los separe, y agregarles la
   * iglesia los dejaría igual de indistinguibles pero más largos. La pregunta
   * del guardado ya avisó de que esto iba a pasar.
   */
  const como = `Gemelos ${marca()}`;
  const uno = cuerpo(como, A);
  const dos = cuerpo(como, A);
  assert.deepEqual(ofrecer([uno, dos]), [como, como]);
});

test('la comparación del desplegable ignora tildes, como la de la pregunta', () => {
  const uno = cuerpo(`Jóvenes ${marca()}`, A);
  const dos = cuerpo(fila(uno).nombre.replace('ó', 'o'), B);
  const salen = ofrecer([uno, dos]);
  assert.match(salen[0], /· Central CN/, 'si no, «Jóvenes» y «Jovenes» saldrían sin distinguirse');
  assert.match(salen[1], /· Norte CN/);
});

test('las DOS puertas de la lista piden lo mismo', () => {
  /*
   * La ruta propia del módulo —la que piden los formularios— y la genérica del
   * motor —la que piden los filtros—. Mostrar la iglesia en una y no en la
   * otra dejaría el desplegable de los filtros con dos opciones idénticas.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  const cuantas = (modulo.match(/conLoQueLosDistingue\(/g) || []).length;
  assert.equal(cuantas, 2, `se pide ${cuantas} vez(ces), y tienen que ser dos`);
  assert.ok(getModule('cuerpos').comoSeOfrecen, 'y la genérica sale por `comoSeOfrecen`');
});

test('la pregunta de las iglesias sigue usando la misma comparación', () => {
  const iglesias = fs.readFileSync(path.join(__dirname, '../../server/modules/iglesias.js'), 'utf8');
  const cuerpos = fs.readFileSync(path.join(__dirname, '../../server/el-nombre-del-cuerpo.js'), 'utf8');
  assert.match(iglesias, /require\('\.\.\/mismo-nombre'\)/);
  assert.match(cuerpos, /require\('\.\/mismo-nombre'\)/);
});

// ------------------------------------------ y el orden de las preguntas ----

test('el nombre repetido se pregunta ANTES que la cuota sin monto', () => {
  /*
   * El «igual_asi» es uno solo para todo el guardado, así que el orden decide
   * cuál se llega a ver. Va delante la que cuesta más deshacer —un cuerpo
   * duplicado hay que borrarlo; un monto sin poner se pone— y además la de la
   * cuota se dice en otros dos lugares y ésta no se dice en ninguno.
   */
  const como = `Damas ${marca()}`;
  cuerpo(como, A);
  const yo = fila(cuerpo(`Otro ${marca()}`, A, { tipo: 'Cuerpo' }));
  db.prepare('UPDATE cuerpos SET cobra_cuota = 0 WHERE id = ?').run(yo.id);

  const aviso = getModule('cuerpos').hooks.beforeSave(
    { nombre: como, cobra_cuota: 1 },
    { id: yo.id, existing: fila(yo.id), isNew: false, db, confirmado: false }
  );
  assert.equal(aviso.confirmar, 'cuerpo_con_el_mismo_nombre');
});

// ------------------------------------ y andando de verdad ----

const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: se pregunta una vez y el desplegable los separa', async () => {
  const api = await elSistemaAndando();
  const m = `repetido-${process.pid}`;

  const central = (await api('POST', '/iglesias', {
    nombre: `Central del nombre ${m}`, codigo: `RPA${process.pid}`, estado: 'Activa',
  })).json;
  const norte = (await api('POST', '/iglesias', {
    nombre: `Norte del nombre ${m}`, codigo: `RPB${process.pid}`, estado: 'Activa',
  })).json;
  assert.ok(central && central.id && norte && norte.id);

  const como = `Damas ${m}`;
  const uno = await api('POST', '/cuerpos', { nombre: como, tipo: 'Cuerpo', iglesia_id: central.id, estado: 'Activo' });
  assert.equal(uno.estado, 201, `guardia: el primero tiene que entrar: ${uno.texto.slice(0, 200)}`);

  const dos = await api('POST', '/cuerpos', { nombre: como, tipo: 'Cuerpo', iglesia_id: central.id, estado: 'Activo' });
  assert.equal(dos.estado, 400, `el segundo en la misma iglesia tenía que preguntar: ${dos.texto.slice(0, 200)}`);
  assert.equal(dos.json.confirmar, 'cuerpo_con_el_mismo_nombre');

  const enOtra = await api('POST', '/cuerpos', { nombre: como, tipo: 'Cuerpo', iglesia_id: norte.id, estado: 'Activo' });
  assert.equal(enOtra.estado, 201, `en otra iglesia no se pregunta: ${enOtra.texto.slice(0, 200)}`);

  const igualAsi = await api('POST', '/cuerpos',
    { nombre: como, tipo: 'Cuerpo', iglesia_id: central.id, estado: 'Activo', igual_asi: true });
  assert.equal(igualAsi.estado, 201, 'y contestando que sí, entra');

  // Y ahora los tres tienen que distinguirse en las dos listas
  const deLaRuta = ((await api('GET', '/cuerpos/activos')).json || []).filter((o) => o.label.includes(m));
  const deLosFiltros = ((await api('GET', '/cuerpos/options')).json || []).filter((o) => o.label.includes(m));
  assert.equal(deLaRuta.length, 3, JSON.stringify(deLaRuta));
  for (const lista of [deLaRuta, deLosFiltros]) {
    const conIglesia = lista.filter((o) => /· (Central|Norte) del nombre/.test(o.label));
    assert.equal(conIglesia.length, 3, `los tres tienen que llevar su iglesia al lado: ${JSON.stringify(lista)}`);
    assert.ok(lista.some((o) => o.label.includes('Norte del nombre')), 'y el de la otra iglesia se distingue');
  }
});
