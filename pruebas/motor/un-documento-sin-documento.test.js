/**
 * UN DOCUMENTO QUE PROMETE UN PAPEL QUE NO ESTÁ.
 *
 * El campo del archivo es obligatorio y el servidor lo exige. Lo que no
 * comprobaba es que el archivo EXISTA: la validación miraba que viniera algo,
 * no que ese algo estuviera en el disco.
 *
 * Medido contra el servidor: se guarda un documento de un miembro con el nombre
 * de un archivo inventado y contesta 201. Queda en su carpeta, con su tipo, su
 * nombre y su fecha, y su botón «Ver» contesta 404. Por la pantalla no se llega
 * —el archivo sube al elegirlo y el campo queda con el nombre que devolvió el
 * servidor—, pero cualquier cosa que hable con la API sí, y el resultado es el
 * peor de los dos posibles: una carpeta que dice tener el carnet.
 *
 * Lo que cuida este archivo:
 *   · que un archivo que no está en el disco no se pueda adjuntar
 *   · que valga para todos los campos de archivo del sistema, no solo para el
 *     documento de un miembro
 *   · que se revise SOLO lo que el guardado está cambiando, para que una ficha
 *     vieja que ya apunta a un archivo perdido se siga pudiendo corregir
 *   · y que la pregunta se haga por el mismo nombre con que después se sirve
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../../server/db');
const archivos = require('../../server/archivos');
const registry = require('../../server/registry');

const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');

/* ------------------------------- la pregunta */

test('un archivo que está en el disco existe', () => {
  const nombre = 'esta-de-verdad-en-el-disco.txt';
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), 'CARNET');
  assert.equal(archivos.existe(nombre), true);
});

test('uno inventado, no', () => {
  assert.equal(archivos.existe('jamas-existio-esto.pdf'), false);
});

test('ni un nombre vacío, nulo o que no es texto', () => {
  for (const nada of ['', null, undefined, 0, false]) {
    assert.equal(archivos.existe(nada), false, `«${String(nada)}» no es un archivo`);
  }
});

test('una carpeta no es un archivo', () => {
  const carpeta = 'una-carpeta-cualquiera';
  fs.mkdirSync(path.join(UPLOADS_DIR, carpeta), { recursive: true });
  assert.equal(archivos.existe(carpeta), false);
});

test('se pregunta por el nombre a secas, igual que al servirlo', () => {
  /*
   * La ruta que entrega un archivo se queda con la última parte del nombre
   * —`path.basename`— para no salirse nunca de la carpeta. Si acá se preguntara
   * por el nombre entero, «../data/sistema.db» daría que no existe y quedaría
   * rechazado por la razón equivocada; y peor: un nombre con carpetas que sí
   * resolviera pasaría la comprobación y después se serviría OTRO archivo.
   */
  const nombre = 'el-que-se-sirve.txt';
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), 'x');
  assert.equal(archivos.existe(`una/ruta/inventada/${nombre}`), true,
    'es el mismo archivo que la ruta entregaría');
  assert.equal(archivos.existe('../data/sistema.db'), false);

  const ruta = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(ruta, /const nombre = path\.basename\(String\(req\.params\.archivo\)\)/,
    'si la ruta dejara de recortar, las dos preguntas hablarían de archivos distintos');
});

/* ------------------------------- dónde se usa */

test('el motor lo comprueba al guardar, en cualquier campo de archivo', () => {
  const laRegla = crud.slice(crud.indexOf('Y que el archivo que se adjunta'), crud.indexOf("if (f.type !== 'date'"));
  assert.match(laRegla, /if \(f\.type !== 'file' \|\| !cambia\(f\.name\)\) continue;/);
  assert.match(laRegla, /if \(!archivos\.existe\(val\)\) \{/,
    'con su guardia: la llamada suelta seguiría escrita aunque no decidiera nada');
  // Lanza en vez de contestar HTTP desde acá: la lista la comparten las dos
  // puertas por las que se guarda una ficha desde la v1.436.0 (hallazgo MP-01).
  assert.match(laRegla, /throw new ErrorDeDatos\(/);
  assert.match(laRegla, /no está en el servidor/, 'y se dice qué pasó y qué hacer');
});

test('solo se revisa lo que el guardado está cambiando', () => {
  /*
   * Es la misma regla que ya usaban las fechas, y por el mismo motivo: una
   * ficha que ya traía un archivo perdido —de una importación vieja o de un
   * borrado a mano— se tiene que poder seguir guardando para corregirle el
   * nombre. Lo que se frena es adjuntar HOY algo que no está.
   */
  const laRegla = crud.slice(crud.indexOf('Y que el archivo que se adjunta'), crud.indexOf("if (f.type !== 'date'"));
  assert.match(laRegla, /!cambia\(f\.name\)/);
  const elAyudante = crud.slice(crud.indexOf('const cambia = (nombre)'), crud.indexOf('Y que el archivo que se adjunta'));
  assert.match(elAyudante, /if \(val === undefined\) return false;/, 'lo que no viene no cambia nada');
  assert.match(elAyudante, /if \(!existing\) return true;/, 'al crear, todo lo que viene es nuevo');
});

test('un archivo vacío lo sigue atajando la regla de obligatorio', () => {
  // No es este quien lo rechaza: el que no manda nada choca antes, con la
  // comprobación de los campos requeridos, y con su propio mensaje.
  const laRegla = crud.slice(crud.indexOf('Y que el archivo que se adjunta'), crud.indexOf("if (f.type !== 'date'"));
  assert.match(laRegla, /if \(val === null \|\| val === ''\) continue;/);
  assert.match(crud, /El campo "\$\{f\.label\}" es obligatorio/);
});

test('son varios los módulos con campo de archivo, y les vale a todos', () => {
  const conArchivo = registry.allModules()
    .filter((m) => m.fields.some((f) => f.type === 'file'))
    .map((m) => m.name);
  assert.ok(conArchivo.length >= 6, `solo ${conArchivo.length} módulos con archivo: ${conArchivo.join(', ')}`);
  for (const cual of ['documentos_miembros', 'documentos_iglesias', 'documentos_pastores', 'miembros']) {
    assert.ok(conArchivo.includes(cual), `${cual} tiene campo de archivo y también queda cubierto`);
  }
});
