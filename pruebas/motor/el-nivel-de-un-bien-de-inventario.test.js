/**
 * El nivel de un bien: de la corporación, de una iglesia o de un cuerpo.
 *
 * El módulo no tenía campo de nivel: se deducía de si «Cuerpo / Grupo» venía
 * vacío o lleno, y el propio rótulo del campo tenía que explicarlo —«Cuerpo /
 * Grupo (vacío = inventario general de la iglesia)»—. Eso alcanzaba para dos
 * niveles y dejaba fuera el tercero, porque «Iglesia» era obligatorio: medido,
 * guardar un artículo de la corporación contestaba
 *
 *   400 · {"error":"El campo \"Iglesia\" es obligatorio"}
 *
 * Un bien de la organización —lo de las asambleas, un vehículo— había que
 * colgárselo a alguna congregación, y ahí quedaba contado como suyo.
 *
 * Y de paso: nadie comprobaba que el cuerpo elegido fuera de la iglesia
 * elegida. Medido, un artículo con «Iglesia Central» y un cuerpo de la Iglesia
 * Norte entró con un 201 y quedaba contado en dos partes de la organización a
 * la vez. Ahora la iglesia se COPIA del cuerpo, como en las cuentas: no hay
 * nada que elegir.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { db } = require('../../server/db');
require('../../server/registry');
const inventarios = require('../../server/modules/inventarios');
const { elNivelDeCadaArticuloDeInventario } = require('../../server/migraciones');

const iglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(nombre, codigo).lastInsertRowid;
const central = iglesia('Central del Inventario', 'IG-INV-C');
const norte = iglesia('Norte del Inventario', 'IG-INV-N');

let n = 0;
const cuerpo = (iglesiaId) => db
  .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES (?, ?, 'Cuerpo', 'Activo')")
  .run(`Cuerpo ${++n} del Inventario`, iglesiaId).lastInsertRowid;

const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };
/** Corre el gancho como lo corre el motor, y devuelve [aviso, datos]. */
const guardar = (datos, existing = null) => {
  const data = { ...datos };
  const aviso = inventarios.hooks.beforeSave(data, { user: admin, existing, db, isNew: !existing, id: null, confirmado: true });
  return [aviso, data];
};

// ------------------------------------------------- los tres niveles ----

test('un bien de la corporación se anota sin iglesia y sin cuerpo', () => {
  const [aviso, data] = guardar({ articulo: 'Camioneta', ambito: 'Corporación', cantidad: 1 });
  assert.equal(aviso, null, 'ya no hace falta colgárselo a una congregación');
  assert.equal(data.iglesia_id, null);
  assert.equal(data.cuerpo_id, null);
});

test('un bien de una iglesia necesita su iglesia', () => {
  const [aviso, data] = guardar({ articulo: 'Bancas', ambito: 'Iglesia local', iglesia_id: central, cantidad: 24 });
  assert.equal(aviso, null);
  assert.equal(data.iglesia_id, central);
  assert.equal(data.cuerpo_id, null);
});

test('y sin ella se frena, diciendo qué falta', () => {
  const [aviso] = guardar({ articulo: 'Bancas', ambito: 'Iglesia local', cantidad: 24 });
  assert.match(String(aviso), /de qué iglesia/i);
});

test('un bien de un cuerpo necesita su cuerpo', () => {
  const suyo = cuerpo(central);
  const [aviso, data] = guardar({ articulo: 'Teclado', ambito: 'Cuerpo / Grupo', cuerpo_id: suyo, cantidad: 1 });
  assert.equal(aviso, null);
  assert.equal(data.cuerpo_id, suyo);
});

test('y sin él se frena, diciendo qué falta', () => {
  const [aviso] = guardar({ articulo: 'Teclado', ambito: 'Cuerpo / Grupo', iglesia_id: central, cantidad: 1 });
  assert.match(String(aviso), /de qué cuerpo o grupo/i);
});

test('un nivel que no es ninguno de los tres no se guarda', () => {
  for (const raro of ['Zona', '', null, 'corporación']) {
    const [aviso] = guardar({ articulo: 'Raro', ambito: raro, iglesia_id: central, cantidad: 1 });
    assert.match(String(aviso), /nivel del artículo/i, `«${raro}» no debería pasar`);
  }
});

// ------------------------ la iglesia de un bien de cuerpo la pone el cuerpo ----

test('la iglesia de un bien de cuerpo se copia del cuerpo', () => {
  const delNorte = cuerpo(norte);
  const [aviso, data] = guardar({
    articulo: 'Amplificador', ambito: 'Cuerpo / Grupo',
    iglesia_id: central, cuerpo_id: delNorte, cantidad: 1,
  });
  assert.equal(aviso, null);
  assert.equal(data.iglesia_id, norte,
    'se anotó «Central» y el cuerpo es del Norte: manda el cuerpo, que es de quien es la cosa');
});

test('un cuerpo que no existe se frena en vez de dejar el bien colgando', () => {
  const [aviso] = guardar({ articulo: 'Fantasma', ambito: 'Cuerpo / Grupo', cuerpo_id: 999999, cantidad: 1 });
  assert.match(String(aviso), /no existe/i);
});

// ------------------------------------- cambiar de nivel limpia lo de antes ----

test('subir un bien de un cuerpo a su iglesia le suelta el cuerpo', () => {
  const suyo = cuerpo(central);
  const existing = { articulo: 'Atril', ambito: 'Cuerpo / Grupo', iglesia_id: central, cuerpo_id: suyo, cantidad: 1 };
  const [aviso, data] = guardar({ ambito: 'Iglesia local' }, existing);
  assert.equal(aviso, null);
  assert.equal(data.cuerpo_id, null, 'si no, seguiría diciendo que es de un cuerpo');
  assert.equal(data.iglesia_id, undefined, 'la iglesia que ya tenía se queda como está');
});

test('y subirlo a la corporación le suelta las dos', () => {
  const suyo = cuerpo(central);
  const existing = { articulo: 'Carpa', ambito: 'Cuerpo / Grupo', iglesia_id: central, cuerpo_id: suyo, cantidad: 1 };
  const [aviso, data] = guardar({ ambito: 'Corporación' }, existing);
  assert.equal(aviso, null);
  assert.equal(data.iglesia_id, null);
  assert.equal(data.cuerpo_id, null);
});

test('bajar un bien de la corporación a un cuerpo le pone la iglesia de ese cuerpo', () => {
  const delNorte = cuerpo(norte);
  const existing = { articulo: 'Toldo', ambito: 'Corporación', iglesia_id: null, cuerpo_id: null, cantidad: 1 };
  const [aviso, data] = guardar({ ambito: 'Cuerpo / Grupo', cuerpo_id: delNorte }, existing);
  assert.equal(aviso, null);
  assert.equal(data.iglesia_id, norte);
});

test('corregirle el nombre a un artículo no le toca el nivel', () => {
  const existing = { articulo: 'Bancas', ambito: 'Iglesia local', iglesia_id: central, cuerpo_id: null, cantidad: 24 };
  const [aviso, data] = guardar({ articulo: 'Bancas de madera' }, existing);
  assert.equal(aviso, null);
  assert.equal(data.iglesia_id, undefined, 'no se reescribe lo que el guardado no trae');
});

// ------------------------------------------------ lo que declara el módulo ----

test('el nivel se ofrece con sus tres opciones y se puede filtrar por él', () => {
  const { getModule } = require('../../server/registry');
  const def = getModule('inventarios');
  const nivel = def.fields.find((f) => f.name === 'ambito');

  assert.ok(nivel, 'no está el campo de nivel');
  assert.deepEqual(nivel.options, ['Corporación', 'Iglesia local', 'Cuerpo / Grupo']);
  assert.equal(nivel.required, true);
  assert.ok(def.filterFields.includes('ambito'), 'sin filtro no sirve de nada tener el nivel');
  assert.ok(def.listFields.includes('ambito'), 'y se tiene que ver sin abrir la ficha');
});

test('la iglesia y el cuerpo se piden solo en el nivel que los usa', () => {
  const { getModule } = require('../../server/registry');
  const def = getModule('inventarios');
  const campo = (n) => def.fields.find((f) => f.name === n);

  assert.deepEqual(campo('iglesia_id').showIf, { field: 'ambito', in: ['Iglesia local', 'Cuerpo / Grupo'] });
  assert.deepEqual(campo('cuerpo_id').showIf, { field: 'ambito', equals: 'Cuerpo / Grupo' });
  assert.ok(!campo('iglesia_id').required,
    'obligatorio a secas era lo que impedía anotar un bien de la corporación');
});

test('el rótulo del cuerpo ya no tiene que explicar el nivel', () => {
  const { getModule } = require('../../server/registry');
  const campo = getModule('inventarios').fields.find((f) => f.name === 'cuerpo_id');
  assert.equal(campo.label, 'Cuerpo / Grupo');
  assert.doesNotMatch(campo.label, /vacío/i, 'lo explicaba el rótulo porque no había campo que lo dijera');
});

// ------------------------------------ lo que ya estaba anotado, al día ----

test('los artículos que ya estaban anotados estrenan el nivel que tenían de hecho', () => {
  /*
   * La columna nace vacía, y un artículo sin nivel no se podría guardar ni
   * aparecería con el filtro puesto. El nivel no hay que adivinarlo: está
   * escrito en sus propias columnas —tiene cuerpo, tiene solo iglesia, o no
   * tiene ninguna de las dos—.
   *
   * Se corre sobre una COPIA de la base y no sobre la de las pruebas: los
   * archivos de motor comparten una sola y corren en paralelo, así que una
   * puesta al día que pasa por TODAS las filas pisaría lo que otro archivo
   * está sembrando en ese mismo momento.
   */
  const copia = path.join(os.tmpdir(), `inventario-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    const suIglesia = otra
      .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los Viejos','IG-VIE','Activa')")
      .run().lastInsertRowid;
    const suCuerpo = otra
      .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES ('Coro de los Viejos', ?, 'Cuerpo', 'Activo')")
      .run(suIglesia).lastInsertRowid;

    // Tres artículos como los dejaba el módulo antes: sin nivel escrito
    const viejo = (articulo, iglesiaId, cuerpoId) => otra
      .prepare('INSERT INTO inventarios (articulo, cantidad, iglesia_id, cuerpo_id) VALUES (?, 1, ?, ?)')
      .run(articulo, iglesiaId, cuerpoId).lastInsertRowid;
    const deCuerpo = viejo('Teclado viejo', suIglesia, suCuerpo);
    const deIglesia = viejo('Bancas viejas', suIglesia, null);
    const huerfano = viejo('Carpa sin dueño', null, null);

    const nivelDe = (id) => otra.prepare('SELECT ambito FROM inventarios WHERE id = ?').get(id).ambito;
    assert.equal(nivelDe(deCuerpo), null, 'antes de pasarla, ninguno tiene nivel');

    otra.prepare("DELETE FROM migraciones WHERE nombre = 'el nivel de cada artículo de inventario'").run();
    elNivelDeCadaArticuloDeInventario(otra);

    assert.equal(nivelDe(deCuerpo), 'Cuerpo / Grupo');
    assert.equal(nivelDe(deIglesia), 'Iglesia local');
    assert.equal(nivelDe(huerfano), 'Corporación',
      'no debería existir —«Iglesia» era obligatorio— pero pudo entrar por Importar, y sin nivel no se abre');

    assert.ok(
      otra.prepare("SELECT nombre FROM migraciones WHERE nombre = 'el nivel de cada artículo de inventario'").get(),
      'queda marcada como aplicada, para no volver a pasarla'
    );
  } finally {
    otra.close();
    for (const s2 of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s2); } catch (e) { /* no estaba */ } }
  }
});

test('y no le toca el nivel a los que ya lo tienen', () => {
  /*
   * Los tres van a propósito CON LAS COLUMNAS EN CONTRA de su nivel: uno dice
   * «Corporación» con iglesia y cuerpo puestos, otro dice «Iglesia local» con
   * un cuerpo, y el tercero dice «Cuerpo / Grupo» con solo una iglesia. Si la
   * puesta al día dejara de mirar si el nivel ya está escrito, a cada uno le
   * pondría el que dictan sus columnas y los tres cambiarían.
   *
   * La primera versión de esta prueba usaba un solo artículo de «Corporación»,
   * y no servía: quitada la comprobación, el último paso deja TODO en
   * «Corporación» y ese artículo terminaba con el mismo valor de casualidad.
   * La rotura no caía sobre nada.
   */
  const copia = path.join(os.tmpdir(), `inventario2-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    const suIglesia = otra
      .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los Nuevos','IG-NUE','Activa')")
      .run().lastInsertRowid;
    const suCuerpo = otra
      .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES ('Coro de los Nuevos', ?, 'Cuerpo', 'Activo')")
      .run(suIglesia).lastInsertRowid;

    const yaConNivel = (articulo, nivel, iglesiaId, cuerpoId) => otra
      .prepare('INSERT INTO inventarios (articulo, cantidad, ambito, iglesia_id, cuerpo_id) VALUES (?, 1, ?, ?, ?)')
      .run(articulo, nivel, iglesiaId, cuerpoId).lastInsertRowid;
    const puestos = [
      [yaConNivel('Camioneta', 'Corporación', suIglesia, suCuerpo), 'Corporación'],
      [yaConNivel('Bancas', 'Iglesia local', suIglesia, suCuerpo), 'Iglesia local'],
      [yaConNivel('Teclado', 'Cuerpo / Grupo', suIglesia, null), 'Cuerpo / Grupo'],
    ];

    otra.prepare("DELETE FROM migraciones WHERE nombre = 'el nivel de cada artículo de inventario'").run();
    elNivelDeCadaArticuloDeInventario(otra);

    for (const [id, nivel] of puestos) {
      assert.equal(
        otra.prepare('SELECT ambito FROM inventarios WHERE id = ?').get(id).ambito, nivel,
        'lo escrito manda: la puesta al día es para lo que no tiene nivel, no para corregir el que tiene'
      );
    }
  } finally {
    otra.close();
    for (const s2 of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s2); } catch (e) { /* no estaba */ } }
  }
});
