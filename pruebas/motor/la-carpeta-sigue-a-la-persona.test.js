/**
 * LA CARPETA DE UNA PERSONA SE VE DONDE SE VE LA PERSONA.
 *
 * Cada documento guarda a qué iglesia pertenece, y era esa columna la que
 * decidía quién podía abrirlo. Pero se rellena con la del miembro EL DÍA EN QUE
 * SE SUBE el papel y no se vuelve a mirar: dice dónde se subió, no de quién es
 * hoy la ficha.
 *
 * Medido contra el servidor, sobre una miembro con tres documentos —carnet,
 * ficha de registro y certificado de bautismo— trasladada de la Central a la
 * Norte, con dos secretarias de verdad acotadas cada una a la suya:
 *
 *                                     su ficha   su carpeta   abrir el archivo
 *   la secretaria de la que YA NO        403       3 de 3           200
 *   la secretaria de la que SÍ           200       0 de 3           403
 *
 * La primera fila entera es lo grave: el sistema le cierra la ficha de la
 * persona —correcto— y en la misma respiración le entrega su carnet de
 * identidad, el archivo y su contenido. La segunda es el reverso: quien de
 * verdad trabaja con ella no ve ni uno de sus papeles.
 *
 * Lo que cuida este archivo:
 *   · que la carpeta cambie de mano con la persona
 *   · que NO se abra de más: la de alguien de otra iglesia sigue sin verse
 *   · que valga para las DOS puertas —el listado y el archivo en sí—, porque
 *     son dos preguntas distintas y la segunda es la que de verdad entrega el
 *     documento
 *   · que la fila por fila diga lo mismo que el listado
 *   · que la columna de iglesia siga guardándose, para saber dónde se subió
 *   · y que a los otros tres módulos de documentos no les cambie nada
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const alcance = require('../../server/alcance');
const registry = require('../../server/registry');

const DOCS = registry.getModule('documentos_miembros');

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;

const CENTRAL = unaIglesia('Central de la carpeta', 'IG-CSP1');
const NORTE = unaIglesia('Norte que la recibe', 'IG-CSP2');
const SUR = unaIglesia('Sur que no tiene nada que ver', 'IG-CSP3');

const unMiembro = (nombres, apellidos, iglesia) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

let n = 0;
const unPapel = (miembro, iglesia, tipo, nombre) => {
  n++;
  return db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo, fecha)
     VALUES (?,?,?,?,?, '2020-04-12')`
  ).run(miembro, iglesia, tipo, nombre, `papel-${n}-de-la-carpeta.txt`).lastInsertRowid;
};

/* ---- la miembro que se muda: su carpeta se armó en la Central ---- */
const elba = unMiembro('Elba', 'Mella Soto', CENTRAL);
const suCarpeta = [
  unPapel(elba, CENTRAL, 'Carnet de identidad', 'Carnet vigente hasta 2030'),
  unPapel(elba, CENTRAL, 'Ficha de registro de miembro', 'Ficha de registro firmada'),
  unPapel(elba, CENTRAL, 'Certificado de bautismo', 'Certificado de bautismo original'),
];
db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(NORTE, elba);

/* ---- y una miembro de la Sur, que no le toca a nadie de la Norte ---- */
const ajena = unMiembro('Ajena', 'De La Sur', SUR);
const suyoAjeno = unPapel(ajena, SUR, 'Carnet de identidad', 'Carnet de otra iglesia');

/** Los documentos de esta gente que ese usuario alcanza a ver en el listado. */
function loQueVe(usuario, miembros) {
  const params = [];
  const donde = alcance.condiciones(DOCS, usuario, params);
  const marcas = miembros.map(() => '?').join(',');
  return db
    .prepare(`SELECT id FROM documentos_miembros WHERE miembro_id IN (${marcas})${donde ? ` AND (${donde})` : ''}`)
    .all(...miembros, ...params)
    .map((r) => r.id);
}
/** ¿Le entregan el archivo de ese documento? Es la otra puerta. */
const leDanElArchivo = (usuario, id) =>
  alcance.alcanza(DOCS, db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id), usuario);

const deLaNorte = { id: 81, iglesias: `[${NORTE}]`, iglesia_id: NORTE, cuerpos: '[]' };
const deLaCentral = { id: 82, iglesias: `[${CENTRAL}]`, iglesia_id: CENTRAL, cuerpos: '[]' };
const administrador = { id: 83, iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

/* ------------------------------- la carpeta cambia de mano */

test('la secretaria de su nueva iglesia ve su carpeta entera', () => {
  const ve = loQueVe(deLaNorte, [elba]);
  assert.equal(ve.length, 3, 'antes veía 0 de 3: la carpeta se quedaba en la iglesia anterior');
  assert.deepEqual(ve.sort(), [...suCarpeta].sort());
});

test('la de su iglesia anterior deja de verla, que es lo que corresponde', () => {
  assert.deepEqual(loQueVe(deLaCentral, [elba]), [],
    'antes le seguía viendo los tres, incluido el carnet');
});

test('el administrador sin iglesias asignadas sigue viéndolo todo', () => {
  assert.equal(loQueVe(administrador, [elba, ajena]).length, 4);
});

/* ------------------------------- y no se abre de más */

test('la carpeta de alguien de otra iglesia sigue sin verse', () => {
  assert.deepEqual(loQueVe(deLaNorte, [ajena]), [],
    'la regla acerca lo de su gente, no lo de todos');
});

test('un documento sin miembro no lo alcanza nadie', () => {
  // No debería existir —el campo es obligatorio— pero una importación torcida
  // o una fila vieja podrían dejarlo, y un papel sin dueño no puede quedar
  // abierto por descarte.
  const suelto = db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo)
     VALUES (NULL, ?, 'Otro', 'Sin dueño', 'suelto.txt')`
  ).run(CENTRAL).lastInsertRowid;
  const params = [];
  const donde = alcance.condiciones(DOCS, deLaCentral, params);
  const ve = db.prepare(`SELECT id FROM documentos_miembros WHERE id = ?${donde ? ` AND (${donde})` : ''}`)
    .all(suelto, ...params);
  assert.equal(ve.length, 0);
  assert.equal(leDanElArchivo(deLaCentral, suelto), false);
});

/* ------------------------------- las dos puertas dicen lo mismo */

test('el archivo se entrega con la misma regla que el listado', () => {
  /*
   * Son dos preguntas distintas y la segunda es la que de verdad entrega el
   * documento: `server/archivos.js` no mira el listado, mira fila por fila. Si
   * dijeran cosas distintas, se vería en la carpeta un papel que después no se
   * deja abrir, o —lo que pasaba— no se vería uno que sí se entrega.
   */
  for (const id of suCarpeta) {
    assert.equal(leDanElArchivo(deLaNorte, id), true, 'la nueva iglesia tiene que poder abrirlo');
    assert.equal(leDanElArchivo(deLaCentral, id), false, 'la anterior ya no');
  }
  assert.equal(leDanElArchivo(deLaNorte, suyoAjeno), false);
  assert.equal(leDanElArchivo(administrador, suyoAjeno), true);
});

test('y es la misma función que usa el servidor de archivos', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../server/archivos.js'), 'utf8');
  // Con su guardia: la llamada suelta seguiría escrita aunque no llegara a
  // decidir nada, y esta prueba pasaría con el archivo abierto de par en par.
  assert.match(src, /if \(!alcance\.alcanza\(dueno\.def, dueno\.fila, usuario\)\) \{/,
    'si dejara de preguntarle al alcance, el arreglo valdría solo para el listado');
  assert.match(src, /return \{ ok: false, motivo:/, 'y negarlo con su motivo escrito');
});

/* ------------------------------- lo que se dejó igual */

test('la columna de iglesia se sigue guardando: dice dónde se subió', () => {
  const papel = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(suCarpeta[0]);
  assert.equal(papel.iglesia_id, CENTRAL,
    'no se mueve con la persona, y está bien: es el dato de dónde se subió, con el que se filtra');
  const miembro = db.prepare('SELECT iglesia_id FROM miembros WHERE id = ?').get(elba);
  assert.equal(miembro.iglesia_id, NORTE, 'la ficha sí se movió');
});

test('el módulo hereda la iglesia del miembro al crear, como antes', () => {
  const nuevo = { miembro_id: elba, tipo: 'Otro', nombre: 'Recién subido', archivo: 'x.txt' };
  DOCS.hooks.beforeSave(nuevo, { isNew: true, existing: null, db });
  assert.equal(nuevo.iglesia_id, NORTE, 'la del miembro de hoy');
  assert.ok(nuevo.fecha, 'y la fecha de hoy si no se puso una');
});

test('a los otros tres módulos de documentos no les cambia nada', () => {
  // El de una solicitud ya se veía donde se ve la solicitud. Los de una iglesia
  // y los de un pastor cuelgan de fichas que no se trasladan, así que su
  // columna propia es la correcta y se dejan como están.
  assert.deepEqual(registry.getModule('documentos_solicitudes').alcance,
    { comoSuPadre: { modulo: 'solicitudes', campo: 'solicitud_id' } });
  for (const nombre of ['documentos_iglesias', 'documentos_pastores']) {
    assert.ok(!registry.getModule(nombre).alcance, `${nombre} no debería tener alcance propio todavía`);
  }
});
