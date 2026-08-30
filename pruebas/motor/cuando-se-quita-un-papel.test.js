/**
 * QUITAR UN PAPEL DE LA CARPETA TAMBIÉN ES UN HECHO DE LA PERSONA.
 *
 * Medido antes, sobre la ficha de una miembro recién creada:
 *
 *   al adjuntar el carnet, su historial escribe ..  «Se adjuntó "Su carnet"
 *                                                    (Carnet de identidad).»
 *   con la fecha del documento, no la del tecleo ..  12-04-2020
 *   al borrarlo, su historial pasa de ............  2 a 2 anotaciones
 *   la última línea sigue siendo .................  «Se adjuntó "Su carnet"…»
 *   en el Registro de Cambios ....................  sí queda
 *
 * La baja no se perdía: el Registro de Cambios la anotaba. Pero ese es el libro
 * del sistema, y el historial de la persona es el suyo —y desde la 1.186.0 es
 * el que sale impreso en su hoja—. Ahí quedaba diciendo que se le adjuntó un
 * carnet que hoy no está, sin una línea que lo explicara.
 *
 * Lo que cuida este archivo:
 *   · que quitar un papel deje su línea en el historial de su dueña
 *   · que esa línea diga CUÁL era y de cuándo, porque una carpeta puede tener
 *     dos que se llamen igual
 *   · que vaya con la fecha de HOY, al revés que la de adjuntar: un carnet de
 *     2020 se adjuntó en 2020, pero se quitó el día que alguien lo quitó
 *   · que el Registro de Cambios siga anotándolo como antes
 *   · y que borrar a la persona entera no escriba una línea por papel en un
 *     historial que se va con ella
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

require('../../server/ajustes'); // crea la tabla de configuración que mira `anotar`
const { db } = require('../../server/db');
const registry = require('../../server/registry');
const bitacora = require('../../server/bitacora');

const DOCS = registry.getModule('documentos_miembros');
const DOCS_IG = registry.getModule('documentos_iglesias');
const quien = { id: 1, nombre: 'Secretaria de la baja', rol: 'secretario' };
const HOY = new Date().toISOString().slice(0, 10);

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la baja','IG-BAJ1','Activa')")
  .run().lastInsertRowid;
const unMiembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

/** Adjuntar un papel: se guarda la fila y se avisa al sistema, como el motor. */
const adjuntar = (miembro, tipo, nombre, fecha) => {
  const id = db.prepare(
    'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?,?)'
  ).run(miembro, iglesia, tipo, nombre, fecha, 'papel.txt').lastInsertRowid;
  const fila = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id);
  bitacora.registrarGuardado(DOCS, { isNew: true, antes: null, despues: fila, datos: fila, user: quien });
  return fila;
};

/** Y quitarlo, avisando igual que el motor cuando alguien borra. */
const quitar = (fila, def) => {
  db.prepare(`DELETE FROM "${(def || DOCS).name}" WHERE id = ?`).run(fila.id);
  bitacora.registrarEliminado(def || DOCS, fila, quien, null);
};

const suHistorial = (miembro) => db
  .prepare('SELECT tipo, descripcion, fecha, registrado_por, origen FROM bitacora WHERE miembro_id = ? ORDER BY id')
  .all(miembro);

/* ------------------------------- la línea que faltaba */

const rosa = unMiembro('Rosa Elena', 'Cárcamo de la Baja');
const suCarnet = adjuntar(rosa, 'Carnet de identidad', 'Su carnet', '2020-04-12');

test('adjuntar deja su línea, como siempre', () => {
  assert.deepEqual(suHistorial(rosa).map((r) => r.descripcion),
    ['Se adjuntó "Su carnet" (Carnet de identidad).']);
});

test('y quitarlo deja la suya', () => {
  quitar(suCarnet);
  const lineas = suHistorial(rosa);
  assert.equal(lineas.length, 2, 'antes se quedaba en una');
  assert.equal(lineas[1].descripcion,
    'Se quitó "Su carnet" (Carnet de identidad, del 12-04-2020) de su carpeta.');
});

test('la línea dice cuál era el papel y de cuándo', () => {
  /*
   * Desde la 1.197.0 una carpeta puede tener dos papeles que se llamen igual
   * —se pregunta, pero quien confirma pasa—. Sin la fecha del documento no se
   * sabría cuál de los dos se fue.
   */
  const linea = suHistorial(rosa)[1].descripcion;
  assert.match(linea, /"Su carnet"/, 'cómo se llamaba');
  assert.match(linea, /Carnet de identidad/, 'de qué tipo era');
  assert.match(linea, /del 12-04-2020/, 'y de cuándo era el papel');
});

test('va con la fecha de hoy, no con la del documento', () => {
  const [adjuntada, quitada] = suHistorial(rosa);
  assert.equal(adjuntada.fecha, '2020-04-12', 'el carnet se adjuntó en 2020');
  assert.equal(quitada.fecha, HOY, 'pero se quitó hoy');
});

test('las dos son del mismo tipo, para que se lean como una sola historia', () => {
  assert.deepEqual(suHistorial(rosa).map((r) => r.tipo), ['Documento', 'Documento']);
});

test('y queda dicho que la anotó el sistema, y quién estaba detrás', () => {
  const quitada = suHistorial(rosa)[1];
  assert.equal(quitada.origen, 'Automático');
  assert.equal(quitada.registrado_por, 'Secretaria de la baja');
});

test('un papel sin fecha no deja un hueco en la línea', () => {
  const juana = unMiembro('Juana', 'Paillán de la Baja');
  const suyo = adjuntar(juana, 'Certificado de bautismo', 'Bautismo sin fecha', null);
  quitar(suyo);
  assert.equal(suHistorial(juana)[1].descripcion,
    'Se quitó "Bautismo sin fecha" (Certificado de bautismo) de su carpeta.');
});

/* ------------------------------- lo que no cambió */

test('el Registro de Cambios lo sigue anotando', () => {
  const dolores = unMiembro('Dolores', 'Antileo de la Baja');
  const suyo = adjuntar(dolores, 'Carta de traslado', 'Carta a la Norte', '2026-07-01');
  const antes = db.prepare("SELECT count(*) c FROM registro_cambios WHERE accion = 'Eliminación'").get().c;
  quitar(suyo);
  const despues = db.prepare("SELECT count(*) c FROM registro_cambios WHERE accion = 'Eliminación'").get().c;
  assert.equal(despues, antes + 1, 'el libro del sistema no perdió nada con esto');
});

test('la carpeta de una iglesia no escribe en el historial de nadie', () => {
  /*
   * `registrarEliminado` es de TODOS los módulos: la línea nueva tiene que
   * salir solo cuando lo que se quitó es un papel de la carpeta de una persona.
   */
  const marta = unMiembro('Marta', 'Huenchún de la Baja');
  const antes = suHistorial(marta).length;
  const dePapel = db.prepare(
    'INSERT INTO documentos_iglesias (iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?)'
  ).run(iglesia, 'Otro', 'Escritura del templo', '2019-05-05', 'esc.txt').lastInsertRowid;
  const fila = db.prepare('SELECT * FROM documentos_iglesias WHERE id = ?').get(dePapel);
  quitar(fila, DOCS_IG);
  assert.equal(suHistorial(marta).length, antes);
  assert.equal(db.prepare("SELECT count(*) c FROM bitacora WHERE descripcion LIKE '%Escritura del templo%'").get().c, 0);
});

test('y borrar otra cosa que también cuelga de una persona tampoco escribe esa línea', () => {
  /*
   * Varios módulos tienen columna `miembro_id`: los certificados, las ayudas
   * sociales, las solicitudes. Si la línea colgara de tener esa columna y no
   * del módulo, borrar un certificado escribiría «Se quitó … de su carpeta» en
   * el historial de su titular, que es una frase falsa: de la carpeta no se
   * quitó nada.
   *
   * (Esta prueba se agregó porque una rotura no cayó en nada: cambiar la
   * condición del módulo por «tiene miembro_id» no ponía roja ninguna prueba,
   * y sin embargo cambia lo que el sistema escribe.)
   */
  const raquel = unMiembro('Raquel', 'Millán de la Baja');
  const CERTS = registry.getModule('certificados');
  const id = db.prepare(
    'INSERT INTO certificados (miembro_id, iglesia_id, tipo, numero, nombre_titular, fecha_emision)'
    + " VALUES (?,?,'Membresía','CERT-BAJA-1','Raquel Millán de la Baja','2026-03-03')"
  ).run(raquel, iglesia).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM certificados WHERE id = ?').get(id);
  quitar(fila, CERTS);
  const suyas = suHistorial(raquel).map((r) => r.descripcion);
  assert.equal(suyas.filter((d) => /de su carpeta/.test(d)).length, 0, `escribió: ${JSON.stringify(suyas)}`);
});

test('no se escribe en el historial de un miembro que ya no existe', () => {
  /*
   * Es lo que pasa cuando se borra a la persona entera: su carpeta se va con
   * ella. El motor anota el borrado del miembro con lo que se llevó consigo, y
   * no una línea por papel; y aunque llegara una, no habría dónde escribirla.
   */
  const efimera = unMiembro('Efímera', 'Que Se Va');
  const suyo = adjuntar(efimera, 'Carnet de identidad', 'Carnet de la que se va', '2020-04-12');
  db.prepare('DELETE FROM miembros WHERE id = ?').run(efimera);
  quitar(suyo);
  // Se cuenta la línea de la BAJA y no todas las suyas: la de haberlo adjuntado
  // se escribió antes de que la ficha desapareciera y sigue ahí, que es lo
  // correcto. La primera versión de esta prueba contaba todas y fallaba por eso.
  const suyas = db.prepare('SELECT descripcion FROM bitacora WHERE miembro_id = ?').all(efimera);
  assert.equal(suyas.filter((r) => /^Se quitó/.test(r.descripcion)).length, 0);
});

test('y cada carpeta escribe solo en el historial de su dueña', () => {
  const una = unMiembro('Una', 'Sola de la Baja');
  const otra = unMiembro('Otra', 'Distinta de la Baja');
  const suyo = adjuntar(una, 'Carnet de identidad', 'Carnet de una sola', '2021-02-02');
  quitar(suyo);
  assert.equal(suHistorial(otra).length, 0);
  assert.equal(suHistorial(una).length, 2);
});
