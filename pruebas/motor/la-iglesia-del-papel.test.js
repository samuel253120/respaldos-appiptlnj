/**
 * LA IGLESIA DE UN DOCUMENTO NO SE ESCRIBE A MANO.
 *
 * El formulario ofrecía el campo «Iglesia» abierto. En blanco se heredaba del
 * miembro —correcto— y escrito se guardaba lo que fuera. Medido contra el
 * servidor, con una miembro de la Central:
 *
 *   guardado con la iglesia de OTRA ......  201 · quedaba con la otra
 *   dejado en blanco .....................  quedaba con la del miembro
 *   corregido a mano a una tercera .......  200 · quedaba con la tercera
 *
 * Hasta la 1.191.0 esa columna decidía además quién podía abrir el archivo, así
 * que una equivocación al llenar el formulario mandaba el carnet de alguien a
 * otra iglesia. Hoy el alcance va por la ficha de la persona y esto es solo un
 * dato descuadrado, pero un dato que nadie elige a mano no tiene por qué ser
 * editable.
 *
 * ── Y lo que la columna sigue significando ──
 *
 * No es «la iglesia de la persona hoy»: es en qué iglesia se archivó el papel.
 * Cuando alguien se traslada, su carpeta se va con ella (1.191.0) y esta
 * columna se queda diciendo dónde se armó. Por eso NO se recalcula en cada
 * guardado: arreglarle una coma a la observación de una miembro trasladada le
 * movería la iglesia al papel y se perdería el dato.
 *
 * Lo que cuida este archivo:
 *   · que el campo esté declarado de solo lectura, y que el motor lo descarte
 *   · que al crear salga siempre del miembro, se mande lo que se mande
 *   · que al corregir un papel guardado no se mueva
 *   · que sí se archive de nuevo cuando el papel cambia de dueño
 *   · que un papel importado sin iglesia se complete al guardarlo
 *   · y que a los otros tres módulos de documentos no les cambie nada
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const registry = require('../../server/registry');

const DOCS = registry.getModule('documentos_miembros');
const guardar = (data, opciones) => DOCS.hooks.beforeSave(data, {
  user: { id: 1, rol: 'admin' }, isNew: true, id: null, existing: null, db, confirmado: true, ...opciones,
});

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;
const CENTRAL = unaIglesia('Central del papel', 'IG-PAP9');
const NORTE = unaIglesia('Norte del papel', 'IG-PAP8');
const SUR = unaIglesia('Sur del papel', 'IG-PAP7');

const unMiembro = (nombres, apellidos, iglesia) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

const elba = unMiembro('Elba', 'Mella del Papel', CENTRAL);
const juana = unMiembro('Juana', 'Paillán del Papel', NORTE);

/* ------------------------------- el campo no se escribe */

test('el campo está declarado de solo lectura', () => {
  const campo = DOCS.fields.find((f) => f.name === 'iglesia_id');
  assert.ok(campo, 'el campo tiene que seguir existiendo: la columna se sigue usando');
  assert.equal(campo.readonly, true);
  assert.ok(!campo.soloAlCrear,
    'ni siquiera al crear: al crear es cuando alguien se equivoca de iglesia en el formulario');
  assert.ok(campo.help && /del miembro/.test(campo.help), 'y se dice de dónde sale');
});

test('el motor descarta lo que llegue en un campo de solo lectura', () => {
  /*
   * Es la regla general del motor y es la que hace que el campo cerrado sirva
   * de verdad: sin ella, marcarlo de solo lectura solo lo pintaría gris en la
   * pantalla y el dato seguiría entrando por la API.
   */
  const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(crud, /if \(f\.readonly && !\(f\.soloAlCrear && isNew\)\) continue;/);
});

/* ------------------------------- de dónde sale */

test('al crear, la iglesia sale del miembro', () => {
  const datos = { miembro_id: elba, tipo: 'Carnet de identidad', nombre: 'Carnet de Elba', archivo: 'c.txt' };
  assert.equal(guardar(datos), null);
  assert.equal(datos.iglesia_id, CENTRAL);
});

test('y si igual llegara otra, se pisa con la del miembro', () => {
  // El motor ya la habría descartado; esto es el segundo cerrojo, por si el
  // dato llega por otro camino (una importación, una ruta propia de un módulo).
  const datos = { miembro_id: elba, tipo: 'Carta de traslado', nombre: 'Carta', archivo: 'c.txt', iglesia_id: SUR };
  guardar(datos);
  assert.equal(datos.iglesia_id, CENTRAL, 'la del miembro manda');
});

/* ------------------------------- y lo que sigue significando */

const suCarnet = (() => {
  const id = db.prepare(
    'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?,?)'
  ).run(elba, CENTRAL, 'Carnet de identidad', 'Carnet de Elba', '2020-04-12', 'carnet.txt').lastInsertRowid;
  return db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id);
})();

test('cuando la miembro se traslada, su papel sigue diciendo dónde se archivó', () => {
  db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(NORTE, elba);
  const papel = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(suCarnet.id);
  assert.equal(papel.iglesia_id, CENTRAL, 'la columna no se mueve sola');
  assert.equal(db.prepare('SELECT iglesia_id FROM miembros WHERE id = ?').get(elba).iglesia_id, NORTE,
    'pero la ficha sí se movió');
});

test('y corregirle una observación no lo mueve tampoco', () => {
  /*
   * Es el caso que obliga a que la regla NO sea «recalcular siempre»: la
   * miembro está en la Norte, el papel se archivó en la Central, y arreglarle
   * una coma no puede reescribir dónde se archivó.
   */
  const existing = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(suCarnet.id);
  const datos = { observaciones: 'Se le pidió al renovar.' };
  guardar(datos, { isNew: false, id: suCarnet.id, existing });
  assert.equal(datos.iglesia_id, undefined, 'no se toca');
  assert.equal(existing.iglesia_id, CENTRAL);
});

test('pero si el papel cambia de dueña, se archiva en la carpeta nueva', () => {
  const existing = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(suCarnet.id);
  const datos = { miembro_id: juana };
  guardar(datos, { isNew: false, id: suCarnet.id, existing });
  assert.equal(datos.iglesia_id, NORTE, 'la de su dueña nueva');
});

test('un papel importado sin iglesia se completa al guardarlo', () => {
  /*
   * Los hay: una carga masiva no pasa por el formulario. Se aprovecha el
   * guardado para dejarlo completo, en vez de arrastrar una columna vacía que
   * después deja el papel fuera de cualquier filtro por iglesia.
   */
  const id = db.prepare(
    'INSERT INTO documentos_miembros (miembro_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?)'
  ).run(juana, 'Certificado de bautismo', 'Bautismo importado', '2001-11-18', 'b.txt').lastInsertRowid;
  const existing = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id);
  assert.equal(existing.iglesia_id, null, 'así entró');
  const datos = { observaciones: 'Revisado.' };
  guardar(datos, { isNew: false, id, existing });
  assert.equal(datos.iglesia_id, NORTE, 'la de su dueña');
});

/* ------------------------------- lo que no se tocó */

test('a los otros tres módulos de documentos no les cambia nada', () => {
  /*
   * En la carpeta de una iglesia, `iglesia_id` no es un dato heredado: es el
   * dueño del papel, y ahí sí se elige. Lo mismo el pastor y la solicitud en
   * los suyos.
   */
  for (const nombre of ['documentos_iglesias', 'documentos_pastores', 'documentos_solicitudes']) {
    const def = registry.getModule(nombre);
    const dueno = def.fields.find((f) => ['iglesia_id', 'pastor_id', 'solicitud_id'].includes(f.name));
    assert.ok(dueno, `${nombre} no declara a su dueño`);
    assert.ok(!dueno.readonly, `${nombre}: a su dueño se le elige`);
  }
});

test('la columna se sigue guardando y se sigue pudiendo filtrar por ella', () => {
  const papel = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(suCarnet.id);
  assert.ok(papel.iglesia_id, 'la columna no quedó vacía');
  assert.ok(DOCS.fields.some((f) => f.name === 'iglesia_id'),
    'y el campo sigue declarado: si se sacara, el motor dejaría de crear la columna');
});
