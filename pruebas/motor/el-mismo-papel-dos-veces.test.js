/**
 * EL MISMO PAPEL, GUARDADO DOS VECES.
 *
 * Medido antes, sobre una carpeta recién abierta, mandando tres veces el mismo
 * documento —el mismo tipo, el mismo nombre, la misma fecha—:
 *
 *   el primero .....................  201
 *   el mismo otra vez ..............  201, sin decir nada
 *   el mismo en mayúsculas .........  201, sin decir nada
 *   la carpeta quedó con ...........  3 carnets iguales
 *
 * Pasa solo: dos personas escanean el mismo carnet, o alguien vuelve a subirlo
 * porque no encontró el primero. Una carpeta con el mismo papel repetido no
 * pierde nada, pero deja de contestar la pregunta para la que existe: cuál es
 * el carnet bueno, cuál es la carta de traslado que vale.
 *
 * El sistema ya sabe hacer esta pregunta bien en Tesorería, en Traspasos y en
 * las fichas repetidas de Miembros: no rechaza, avisa de lo que ya existe y
 * deja seguir si de verdad son dos. Acá se hace igual, con los mismos
 * ayudantes de `server/repetido.js`.
 *
 * Lo que cuida este archivo:
 *   · qué hace que dos papeles sean «el mismo» —y qué NO, que es la fecha—
 *   · que pregunte en vez de bloquear, y que quien confirma pase
 *   · que corregirle una observación a uno guardado no vuelva a preguntar
 *   · que el aviso diga con qué distinguir el que ya está
 *   · y que lo que el hook ya hacía —heredar la iglesia, poner la fecha de
 *     hoy— siga funcionando igual
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const registry = require('../../server/registry');

const DOCS = registry.getModule('documentos_miembros');
const guardar = (data, opciones) => DOCS.hooks.beforeSave(data, {
  user: { id: 1, rol: 'admin' }, isNew: true, id: null, existing: null, db, confirmado: false, ...opciones,
});

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del papel','IG-PAP1','Activa')")
  .run().lastInsertRowid;
const unMiembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

const rosa = unMiembro('Rosa Elena', 'Cárcamo del Papel');
const juana = unMiembro('Juana', 'Paillán del Papel');

const unPapel = (miembro, tipo, nombre, fecha, archivo) => db.prepare(
  'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo, created_at)'
  + " VALUES (?,?,?,?,?,?, '2026-08-20 10:00:00')"
).run(miembro, iglesia, tipo, nombre, fecha, archivo).lastInsertRowid;

// La carpeta de Rosa, con un carnet ya guardado
const suCarnet = unPapel(rosa, 'Carnet de identidad', 'Carnet vigente hasta 2030', '2020-04-12', 'carnet.txt');

/* ------------------------------- qué hace que dos sean el mismo */

test('el mismo papel, otra vez, se pregunta', () => {
  const aviso = guardar({
    miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030', fecha: '2020-04-12',
  });
  assert.ok(aviso, 'no dijo nada');
  assert.equal(aviso.confirmar, 'documento_ya_en_la_carpeta');
});

test('escrito distinto pero igual a la vista, también', () => {
  for (const comoLoEscribio of [
    'CARNET VIGENTE HASTA 2030',
    '  carnet   vigente hasta 2030  ',
    'Cárnet vigente hasta 2030',
  ]) {
    const aviso = guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: comoLoEscribio });
    assert.ok(aviso && aviso.confirmar, `pasó sin preguntar: «${comoLoEscribio}»`);
  }
});

test('y aunque la fecha sea otra, porque la fecha no es lo que los hace el mismo', () => {
  /*
   * Los dos casos que se quieren atrapar —dos personas escaneando el mismo
   * carnet, alguien volviéndolo a subir— son casi siempre en días distintos y
   * con la fecha tecleada distinto o en blanco. Exigir que coincida dejaría
   * pasar justo lo que se busca.
   */
  const otraFecha = guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030', fecha: '2024-01-30' });
  assert.ok(otraFecha && otraFecha.confirmar);
  const sinFecha = guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030' });
  assert.ok(sinFecha && sinFecha.confirmar);
});

test('el mismo papel de OTRA persona no tiene nada que ver', () => {
  assert.equal(guardar({
    miembro_id: juana, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030', fecha: '2020-04-12',
  }), null, 'la carpeta es de cada quien');
});

test('otro tipo, u otro nombre, son otro papel', () => {
  assert.equal(guardar({ miembro_id: rosa, tipo: 'Carta de traslado', nombre: 'Carnet vigente hasta 2030' }), null);
  assert.equal(guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet renovado 2035' }), null);
});

/* ------------------------------- pregunta, no bloquea */

test('quien confirma pasa', () => {
  assert.equal(guardar(
    { miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030' },
    { confirmado: true }
  ), null, 'dos papeles iguales de verdad existen');
});

test('el aviso viene como pregunta y no como rechazo', () => {
  const aviso = guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030' });
  assert.equal(typeof aviso, 'object', 'un texto a secas el motor lo pinta como error rojo, sin botón de seguir');
  assert.ok(aviso.error && aviso.confirmar, 'el motor necesita las dos cosas para ofrecer los dos botones');
});

test('y dice con qué distinguir el que ya está', () => {
  const aviso = guardar({ miembro_id: rosa, tipo: 'Carnet de identidad', nombre: 'Carnet vigente hasta 2030' });
  assert.match(aviso.error, /Carnet vigente hasta 2030/, 'cómo se llama el que ya está');
  assert.match(aviso.error, /Carnet de identidad/, 'de qué tipo es');
  assert.match(aviso.error, /12-04-2020/, 'de cuándo es: es lo que permite contestar la pregunta');
  assert.match(aviso.error, /guardado el 20-08-2026/, 'y cuándo entró a la carpeta');
  assert.match(aviso.error, /ábralo en vez de subirlo de nuevo/, 'qué hacer si es el mismo');
  assert.match(aviso.error, /Si de verdad son dos, confirme/, 'y qué hacer si no');
});

test('un papel anotado sin archivo se distingue en el aviso', () => {
  const dolores = unMiembro('Dolores', 'Antileo del Papel');
  unPapel(dolores, 'Certificado de bautismo', 'Certificado de bautismo', '2001-11-18', null);
  const aviso = guardar({ miembro_id: dolores, tipo: 'Certificado de bautismo', nombre: 'Certificado de bautismo' });
  assert.match(aviso.error, /anotado sin archivo/,
    'porque es justamente el que alguien va a querer completar con su foto');
});

/* ------------------------------- al corregir uno que ya está */

test('corregirle una observación a uno guardado no vuelve a preguntar', () => {
  /*
   * El repetido ya estaba antes de abrir la ficha y alguien ya dijo que eran
   * dos. Volver a preguntarlo cada vez enseña a confirmar sin leer, que es lo
   * contrario de lo que la pregunta busca.
   */
  const gemelo = unPapel(rosa, 'Carnet de identidad', 'Carnet vigente hasta 2030', '2020-04-12', 'otro.txt');
  const existing = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(gemelo);
  assert.equal(guardar(
    { observaciones: 'Se le pidió al renovar.' },
    { isNew: false, id: gemelo, existing }
  ), null);
  db.prepare('DELETE FROM documentos_miembros WHERE id = ?').run(gemelo);
});

test('pero renombrarlo como uno que ya está, sí', () => {
  const otro = unPapel(rosa, 'Carnet de identidad', 'Carnet renovado 2035', '2024-01-30', 'nuevo.txt');
  const existing = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(otro);
  const aviso = guardar(
    { nombre: 'Carnet vigente hasta 2030' },
    { isNew: false, id: otro, existing }
  );
  assert.ok(aviso && aviso.confirmar, 'ese guardado sí cambia lo que lo hace «el mismo»');
  assert.doesNotMatch(aviso.error, /Carnet renovado 2035/, 'y no se avisa contra sí mismo');
  db.prepare('DELETE FROM documentos_miembros WHERE id = ?').run(otro);
});

/* ------------------------------- lo que el hook ya hacía */

test('la iglesia se sigue heredando del miembro', () => {
  const datos = { miembro_id: rosa, tipo: 'Carta de traslado', nombre: 'Carta de traslado a la Norte' };
  assert.equal(guardar(datos), null);
  assert.equal(datos.iglesia_id, iglesia);
});

test('y un documento sin fecha se sigue guardando con la de hoy', () => {
  const datos = { miembro_id: rosa, tipo: 'Carta de traslado', nombre: 'Otra carta distinta' };
  guardar(datos);
  assert.equal(datos.fecha, new Date().toISOString().slice(0, 10));
});

test('la carpeta de Rosa quedó como se esperaba, y no se guardó nada de más', () => {
  // El hook no guarda: solo contesta. Lo que hay es lo que puso esta prueba.
  const suya = db.prepare('SELECT nombre FROM documentos_miembros WHERE miembro_id = ? ORDER BY id').all(rosa);
  assert.deepEqual(suya.map((r) => r.nombre), ['Carnet vigente hasta 2030']);
  assert.ok(suCarnet, 'el carnet del principio sigue siendo el mismo registro');
});
