/**
 * BUSCAR LOS PAPELES DE ALGUIEN POR SU NOMBRE, Y POR EL TIPO QUE SE LEE.
 *
 * El listado del módulo muestra dos columnas que no se podían buscar:
 *
 *   «Miembro» ..............  se resuelve de la otra tabla al leer, así que
 *                             ninguna fila contiene ese texto. Medido: «Rosa
 *                             Elena» → 0, sus apellidos → 0, el nombre entero
 *                             → 0, mientras que «Carnet» —que sí está en el
 *                             nombre del documento— daba 4.
 *
 *   «Tipo de documento» ....  está en la fila, pero el buscador no lo miraba.
 *                             «Carnet» encontraba 4 y «Carnet de identidad»,
 *                             que es el tipo tal como se lee en su propia
 *                             columna, encontraba 0.
 *
 * Cero resultados no se lee como «busque de otra forma»: se lee como «esta
 * persona no tiene papeles en carpeta», que es lo contrario de lo que pasa. Y
 * la pantalla acababa de mostrar ese nombre.
 *
 * Lo que cuida este archivo:
 *   · que se encuentre por el nombre de la persona, escrito como sea
 *   · que se encuentre por el tipo entero, que es como se lee en su columna
 *   · que NO se traiga de más: los papeles de otra persona siguen fuera
 *   · que el RUT siga sin servir para buscar, porque es un dato reservado
 *   · y que el nombre completo no rompa lo que ya se encontraba
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const registry = require('../../server/registry');
const busqueda = require('../../server/busqueda');
const sensibles = require('../../server/sensibles');

const DOCS = registry.getModule('documentos_miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la carpeta','IG-BCA','Activa')")
  .run().lastInsertRowid;
const unMiembro = (nombres, apellidos, rut) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run(nombres, apellidos, rut, iglesia).lastInsertRowid;

const rosa = unMiembro('Rosa Elena', 'Cárcamo Vidal', '13.111.222-3');
const ajena = unMiembro('Ajena', 'Que No Aparece', '14.222.333-4');

let n = 0;
const unPapel = (miembro, tipo, nombre, observaciones) => {
  n++;
  return db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo, fecha, observaciones)
     VALUES (?,?,?,?,?, '2020-04-12', ?)`
  ).run(miembro, iglesia, tipo, nombre, `papel-bca-${n}.txt`, observaciones || null).lastInsertRowid;
};

const suCarpeta = [
  unPapel(rosa, 'Carnet de identidad', 'Carnet vigente hasta 2030', 'Se le pidió al renovar.'),
  unPapel(rosa, 'Ficha de registro de miembro', 'Ficha de registro firmada'),
  unPapel(rosa, 'Certificado de bautismo', 'Certificado de bautismo original'),
];
const elAjeno = unPapel(ajena, 'Otro', 'Papel de otra persona');

const ADMIN = { id: 61, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

/** Lo que encuentra quien teclea eso en la pantalla del módulo. */
function buscando(q, usuario = ADMIN) {
  // La misma llamada que hace el motor al listar (ver server/crud.js)
  const buscada = busqueda.condicion(q, sensibles.buscablesPara(DOCS, usuario),
    sensibles.buscaTambienPara(DOCS, usuario));
  const filas = db
    .prepare(
      `SELECT id, miembro_id FROM documentos_miembros
        WHERE miembro_id IN (?, ?)${buscada ? ` AND (${buscada.sql})` : ''}`
    )
    .all(rosa, ajena, ...(buscada ? buscada.params : []));
  return { suyos: filas.filter((f) => f.miembro_id === rosa).length, ajenos: filas.filter((f) => f.miembro_id === ajena).length };
}

/* ------------------------------- por el nombre de la persona */

test('se encuentran sus papeles por su nombre', () => {
  assert.equal(buscando('Rosa Elena').suyos, 3, 'antes daba 0 de 3');
});

test('por sus apellidos, por el nombre entero y por uno solo', () => {
  for (const q of ['Cárcamo Vidal', 'Rosa Elena Cárcamo Vidal', 'Cárcamo', 'Rosa']) {
    assert.equal(buscando(q).suyos, 3, `«${q}» tendría que encontrar los tres`);
  }
});

test('escrito con tildes o sin ellas, en mayúsculas o en minúsculas', () => {
  for (const q of ['CÁRCAMO', 'carcamo', 'CARCAMO', 'cárcamo vidal']) {
    assert.equal(buscando(q).suyos, 3, `«${q}» tendría que encontrar los tres`);
  }
});

test('y en cualquier orden, porque se parte en palabras', () => {
  assert.equal(buscando('Vidal Rosa').suyos, 3);
});

test('pero no se trae los de otra persona', () => {
  assert.equal(buscando('Rosa Elena').ajenos, 0, 'la regla acerca lo suyo, no lo de todos');
  assert.equal(buscando('Que No Aparece').suyos, 0);
  assert.equal(buscando('Que No Aparece').ajenos, 1);
});

/* ------------------------------- por el tipo, tal como se lee */

test('se encuentra por el tipo escrito entero', () => {
  assert.equal(buscando('Carnet de identidad').suyos, 1, 'antes daba 0: el tipo no se miraba');
  assert.equal(buscando('Certificado de bautismo').suyos, 1);
  assert.equal(buscando('Ficha de registro de miembro').suyos, 1);
});

test('y por una palabra suelta del tipo, como antes', () => {
  assert.equal(buscando('Carnet').suyos, 1);
  assert.equal(buscando('bautismo').suyos, 1);
});

test('lo que ya se buscaba se sigue buscando', () => {
  assert.equal(buscando('vigente hasta 2030').suyos, 1, 'el nombre del documento');
  assert.equal(buscando('al renovar').suyos, 1, 'las observaciones');
});

/* ------------------------------- lo que no puede pasar */

test('el RUT no sirve para buscar, y es a propósito', () => {
  /*
   * Es un campo reservado de la ficha del miembro —grupo «miembros_identidad»—:
   * quien no alcanza ese dato tampoco puede dar con alguien buscándolo. El
   * nombre no lo es, y además es lo que esta misma pantalla ya muestra en su
   * columna.
   *
   * Y esta prueba es lo único que lo vigila, así que no se puede borrar. El
   * motor revisa al arrancar que un trozo de `buscaTambien` no use campos
   * reservados, pero mira los grupos DEL PROPIO MÓDULO, y este no tiene
   * ninguno: un trozo que se asome a una columna reservada de OTRA tabla pasa
   * sin que el servidor se queje. Comprobado: agregarle `m.rut` al trozo no
   * impide arrancar; lo único que se pone rojo es esta prueba.
   */
  assert.equal(buscando('13.111.222-3').suyos, 0);
  assert.equal(buscando('13111222').suyos, 0);
  const enElTrozo = DOCS.buscaTambien.map((t) => t.sql).join(' ');
  assert.doesNotMatch(enElTrozo, /\brut\b/i, 'el trozo no puede mirar el RUT');
});

test('el trozo se arma con la tabla nombrada, y sin nada reservado', () => {
  assert.equal(DOCS.buscaTambien.length, 1);
  const t = DOCS.buscaTambien[0];
  assert.match(t.sql, /documentos_miembros\.miembro_id/,
    'nombrada: el día que «miembros» tenga una columna así, la subconsulta miraría la suya');
  assert.match(t.sql, /nombres.*apellidos/, 'el nombre completo, no el que se muestra');
  assert.equal(t.reservado, null, 'no toca ningún grupo reservado, así que no necesita llave');
});

test('el tipo está entre lo que el buscador mira', () => {
  assert.ok(DOCS.searchFields.includes('tipo'));
  for (const antes of ['nombre', 'observaciones']) {
    assert.ok(DOCS.searchFields.includes(antes), `${antes} tiene que seguir estando`);
  }
});

test('los otros tres módulos de documentos quedan para su turno', () => {
  // Tienen el mismo hueco: su columna de persona o de iglesia tampoco se busca.
  // Se dejan fuera a propósito, no por olvido, y esto lo deja dicho.
  for (const nombre of ['documentos_iglesias', 'documentos_pastores', 'documentos_solicitudes']) {
    const def = registry.getModule(nombre);
    assert.equal((def.buscaTambien || []).length, 0, `${nombre} todavía no busca por el nombre de su dueño`);
  }
});
