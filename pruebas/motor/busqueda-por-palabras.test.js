/**
 * BUSCAR «MARÍA GONZÁLEZ» NO ENCONTRABA A MARÍA GONZÁLEZ.
 *
 * El buscador ponía lo tecleado, entero, contra cada campo por separado. Dos
 * cosas que eso no encontraba, medidas sobre las 603 fichas cargadas:
 *
 *   · «María González» daba CERO resultados. El nombre está en una columna y
 *     el apellido en otra, así que ninguna contiene el texto completo. Es la
 *     manera en que busca todo el mundo, y cero resultados no se lee como
 *     «busque de otra forma»: se lee como «esa persona no está». De ahí sale
 *     la ficha repetida.
 *
 *   · «Gonzalez» sin tilde daba CERO y «González» daba 111. Lo mismo con
 *     «Munoz» contra «Muñoz». En esa base 433 de 603 fichas —el 72%— llevan
 *     tilde o eñe en el nombre, y en el teléfono casi nadie las escribe.
 *
 * El arreglo está en el motor, así que lo aprovechan los 39 módulos y el
 * buscador de arriba.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const busqueda = require('../../server/busqueda');

const CAMPOS = ['nombres', 'apellidos', 'rut', 'telefono', 'email'];

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la búsqueda', 'IG-BUS', 'Activa')")
  .run().lastInsertRowid;

function alguien(nombres, apellidos, extra = {}) {
  return db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, rut, email) VALUES (?, ?, ?, 'Activo', ?, ?)")
    .run(nombres, apellidos, iglesia, extra.rut || null, extra.email || null)
    .lastInsertRowid;
}

/** A quiénes encuentra lo tecleado, dentro de esta iglesia. */
function encuentra(texto) {
  const c = busqueda.condicion(texto, CAMPOS);
  if (!c) return [];
  return db
    .prepare(`SELECT id FROM miembros WHERE iglesia_id = ${iglesia} AND (${c.sql})`)
    .all(...c.params)
    .map((r) => r.id);
}

const maria = alguien('María José', 'González Rojas', { rut: '14.555.666-7', email: 'mjgr@correo.cl' });
const otra = alguien('Marisol', 'González Peña');
const munoz = alguien('Ignacio', 'Muñoz Bustíos');

// ------------------------- el nombre junto con el apellido -----------------

test('escribir el nombre junto con el apellido la encuentra', () => {
  assert.deepEqual(encuentra('María González'), [maria],
    'daba cero, y cero se lee como «esa persona no está»');
});

test('y da lo mismo el orden', () => {
  assert.deepEqual(encuentra('González María'), [maria]);
});

test('cada palabra tiene que estar en alguna parte, no cualquiera de ellas', () => {
  /*
   * Con un OR bastaría con que calzara una, y «María González» traería a
   * todas las Marías y a todos los González: no habría acotado nada.
   */
  assert.deepEqual(encuentra('María González Rojas'), [maria]);
  assert.deepEqual(encuentra('María Zzzznoexiste'), [], 'una palabra que no está deja fuera la fila');
});

test('una sola palabra sigue funcionando como siempre', () => {
  const dosGonzalez = encuentra('González');
  assert.ok(dosGonzalez.includes(maria) && dosGonzalez.includes(otra));
});

test('las palabras pueden venir de campos distintos', () => {
  assert.deepEqual(encuentra('María 14.555.666-7'), [maria], 'el nombre de una columna y el RUT de otra');
  assert.deepEqual(encuentra('González mjgr@correo.cl'), [maria]);
});

test('los espacios de más no estorban', () => {
  assert.deepEqual(encuentra('   María    González   '), [maria]);
});

// ------------------------------ tildes y eñes ------------------------------

test('escrito sin tildes la encuentra igual', () => {
  assert.deepEqual(encuentra('maria gonzalez'), [maria],
    'en la base cargada, 433 de 603 fichas llevan tilde o eñe: sin esto el buscador falla en el 72%');
});

test('y escrito con tildes cuando el dato no las lleva, también', () => {
  const sinTilde = alguien('Ines', 'Perez Soto');
  assert.deepEqual(encuentra('Inés Pérez'), [sinTilde], 'el arreglo tiene que valer para los dos lados');
});

test('la eñe cuenta como ene: «Munoz» encuentra a «Muñoz»', () => {
  assert.deepEqual(encuentra('Munoz'), [munoz]);
  assert.deepEqual(encuentra('Muñoz'), [munoz]);
});

test('la diéresis también', () => {
  const pinguino = alguien('Agüero', 'Nahuelpán Cheuquián');
  assert.deepEqual(encuentra('aguero nahuelpan'), [pinguino]);
});

test('mayúsculas y minúsculas dan lo mismo', () => {
  for (const t of ['MARÍA GONZÁLEZ', 'maría gonzález', 'MARIA GONZALEZ', 'mArIa GoNzAlEz']) {
    assert.deepEqual(encuentra(t), [maria], `se le escapó «${t}»`);
  }
});

// ------------------------------- los bordes --------------------------------

test('sin texto no filtra nada: la condición no existe', () => {
  for (const t of ['', '   ', null, undefined]) {
    assert.equal(busqueda.condicion(t, CAMPOS), null, `«${t}» tendría que dejar el listado como está`);
  }
});

test('sin campos que mirar tampoco', () => {
  assert.equal(busqueda.condicion('María', []), null);
  assert.equal(busqueda.condicion('María', null), null);
});

test('un párrafo pegado no arma una consulta enorme', () => {
  const parrafo = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce';
  const c = busqueda.condicion(parrafo, CAMPOS);
  assert.equal(c.params.length, busqueda.PALABRAS_QUE_SE_MIRAN,
    'cada palabra suma una condición: quien pega de más igual quiere ver algo, no un rechazo');
  assert.equal(busqueda.palabrasDe(parrafo).length, 6);
});

test('un dato que ya trae comillas o comodines no rompe la consulta', () => {
  const raro = alguien("O'Higgins 100%", 'Del_Valle "Chico"');
  assert.deepEqual(encuentra("o'higgins"), [raro], 'las comillas van como parámetro, no pegadas al SQL');
  assert.ok(encuentra('Del_Valle').includes(raro));
});

// --------------------- puesto donde de verdad se busca ---------------------

test('el listado de cualquier módulo busca por acá', () => {
  const crud = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/crud.js'), 'utf8'
  );
  // Con lo que el módulo agregue a lo buscable: desde la 1.155.0 un módulo puede
  // sumar lo que no es una columna —la cita bíblica de un servicio—, y el
  // listado tiene que pasárselo (ver `buscaTambien` en server/registry.js)
  assert.match(crud, /busqueda\.condicion\(req\.query\.q, sensibles\.buscablesPara\(def, req\.user\), def\.buscaTambien\)/);
  assert.ok(!/const like = buscables\.map/.test(crud), 'quedó el camino viejo, que es el que fallaba');
});

test('y el buscador de arriba también, que si no parece roto', () => {
  const buscador = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/buscador.js'), 'utf8'
  );
  assert.match(buscador, /busqueda\.condicion\(q, buscables, def\.buscaTambien\)/,
    'el buscador de arriba y el listado tienen que encontrar lo mismo, con lo agregado incluido');
  assert.ok(!/const like = buscables\.map/.test(buscador));
});

test('sigue buscando solo por los campos que la persona alcanza', () => {
  /*
   * Un teléfono que no se le muestra a alguien tampoco puede servirle para
   * encontrar a su dueño: si sirviera, bastaría con probar números para
   * averiguar de quién es cada uno.
   */
  const soloNombre = busqueda.condicion('María', ['nombres']);
  const conTodo = busqueda.condicion('María', CAMPOS);
  assert.ok(!soloNombre.sql.includes('telefono'), 'no puede colarse un campo que no le tocaba');
  assert.ok(conTodo.sql.includes('telefono'));
});
