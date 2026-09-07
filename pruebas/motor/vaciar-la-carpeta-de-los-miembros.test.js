/**
 * Vaciar la carpeta de documentos de los miembros: lo que se lleva y lo que no.
 *
 * La importación del sistema anterior creó cada entrada de documento con sus
 * datos pero sin el archivo —no venían en el volcado— y las dejó esperando la
 * carpeta de respaldos. Cuando esa carpeta no va a llegar, lo que queda son
 * cientos de entradas que prometen un papel que no existe, y hay que poder
 * empezar esa carpeta de cero.
 *
 * ── POR QUÉ ESTA PRUEBA CORRE EN OTRA BASE ──
 *
 * Lo que se está probando VACÍA UNA TABLA ENTERA, y los archivos del motor
 * corren en paralelo sobre UNA sola base: dieciocho de ellos escriben en
 * `documentos_miembros`. Correr esto acá les sacaría los papeles por debajo
 * mientras corren, y el fallo aparecería en un archivo que no tiene nada que
 * ver. Es exactamente lo que pasó en la v1.423.0 con los Motivos de Ausencia.
 *
 * Así que todo el escenario —sembrar, vaciar y mirar el resultado— ocurre en un
 * proceso aparte con su propia carpeta de datos, y acá solo se leen sus cifras.
 *
 * ── LO QUE SE VIGILA ──
 *
 * Que se lleve lo que tiene que llevarse, y sobre todo QUE NO SE LLEVE NADA
 * MÁS: las fichas de los miembros, las otras tres carpetas del sistema, la foto
 * de alguien, y los archivos que use otra ficha. Una puerta que borra en bloque
 * se juzga por lo que deja en pie.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

/* --------------------------------------------------------------- el ensayo */

/**
 * Siembra una carpeta como la que dejó la migración, la vacía, y cuenta lo que
 * quedó. Todo dentro de su propia carpeta de datos.
 */
const GUION = `
const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require(process.argv[1]);
const vaciar = require(process.argv[2]);

const escribir = (nombre) => {
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), 'papel');
  return nombre;
};
const conArchivo = escribir('carnet-de-rosa.pdf');
const compartido = escribir('foto-y-documento.jpg');

const ig = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La del ensayo','ENS','Activa')")
  .run().lastInsertRowid;
const miembro = (n) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, 'Del Ensayo', ?, 'Activo')")
  .run(n, ig).lastInsertRowid;
const rosa = miembro('Rosa');
const ana = miembro('Ana');

// La foto de Rosa es EL MISMO archivo que uno de sus documentos.
db.prepare('UPDATE miembros SET foto = ? WHERE id = ?').run(compartido, rosa);

const doc = db.prepare(
  'INSERT INTO documentos_miembros (miembro_id, tipo, nombre, archivo, iglesia_id, observaciones) VALUES (?,?,?,?,?,?)'
);
const marca = 'Documento del sistema anterior. El archivo se adjunta cuando llegue la carpeta de respaldos.';
doc.run(rosa, 'Carnet de identidad', 'Carnet de Rosa', conArchivo, ig, null);
doc.run(rosa, 'Otro', 'La foto de Rosa', compartido, ig, null);
doc.run(ana, 'Ficha de registro de miembro', 'Ficha de Ana', null, ig, marca);
doc.run(ana, 'Carta de traslado', 'Traslado de Ana', 'este-no-esta.pdf', ig, null);

// Las otras carpetas del sistema, que NO se tocan.
const pastor = db.prepare("INSERT INTO pastores (nombres, apellidos, cargo, iglesia_id, estado) VALUES ('Elias','Del Ensayo','Pastor Presbítero',?,'Activo')")
  .run(ig).lastInsertRowid;
db.prepare('INSERT INTO documentos_pastores (pastor_id, tipo, nombre, archivo, iglesia_id) VALUES (?,?,?,?,?)')
  .run(pastor, 'Otro', 'Papel del pastor', escribir('del-pastor.pdf'), ig);
db.prepare('INSERT INTO documentos_iglesias (iglesia_id, tipo, nombre, archivo) VALUES (?,?,?,?)')
  .run(ig, 'Otro', 'Papel de la iglesia', escribir('de-la-iglesia.pdf'));

// La lista de archivos pendientes de la importación, de dos módulos distintos.
db.exec('CREATE TABLE IF NOT EXISTS importacion_archivos (id INTEGER PRIMARY KEY, modulo_destino TEXT, id_destino INTEGER, campo TEXT, ruta_origen TEXT, nombre TEXT, tipo TEXT, tamano INTEGER, resuelto INTEGER DEFAULT 0, lote TEXT)');
const pend = db.prepare("INSERT INTO importacion_archivos (modulo_destino,id_destino,campo,ruta_origen,resuelto) VALUES (?,?,'archivo','/vieja/carpeta/x.pdf',0)");
pend.run('documentos_miembros', 3);
pend.run('documentos_miembros', 4);
pend.run('documentos_iglesias', 1);

const antes = vaciar.loQueHayEnLaCarpeta(db);
const hecho = vaciar.vaciarLaCarpeta(db, { usuario: { id: 1, nombre: 'La del ensayo' } });

const n = (sql) => db.prepare(sql).get().n;
const enDisco = (a) => fs.existsSync(path.join(UPLOADS_DIR, a));
const linea = db.prepare("SELECT modulo, accion, registro, detalle, usuario FROM registro_cambios ORDER BY id DESC LIMIT 1").get();

process.stdout.write(JSON.stringify({
  antes,
  hecho,
  despues: {
    documentos_miembros: n('SELECT COUNT(*) n FROM documentos_miembros'),
    miembros: n('SELECT COUNT(*) n FROM miembros'),
    fotoDeRosa: db.prepare('SELECT foto FROM miembros WHERE id = ?').get(rosa).foto,
    documentos_pastores: n('SELECT COUNT(*) n FROM documentos_pastores'),
    documentos_iglesias: n('SELECT COUNT(*) n FROM documentos_iglesias'),
    pendientesDeMiembros: n("SELECT COUNT(*) n FROM importacion_archivos WHERE modulo_destino='documentos_miembros'"),
    pendientesDeIglesias: n("SELECT COUNT(*) n FROM importacion_archivos WHERE modulo_destino='documentos_iglesias'"),
    elCompartidoSigue: enDisco(compartido),
    elPropioSigue: enDisco(conArchivo),
    elDelPastorSigue: enDisco('del-pastor.pdf'),
    elDeLaIglesiaSigue: enDisco('de-la-iglesia.pdf'),
  },
  linea,
}));
`;

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'vaciar-carpeta-'));
let r;
try {
  const salida = execFileSync(
    process.execPath,
    ['-e', GUION, require.resolve('../../server/db'), require.resolve('../../server/vaciar-la-carpeta-de-miembros')],
    {
      encoding: 'utf8',
      env: { ...process.env, DATA_DIR: carpeta, PRUEBAS_DEL_MOTOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  r = JSON.parse(salida.slice(salida.indexOf('{')));
} finally {
  fs.rmSync(carpeta, { recursive: true, force: true });
}

// ------------------------------------------- lo que se mira antes ----------

test('antes de vaciar se dice qué hay, separando las tres clases', () => {
  /*
   * No es lo mismo perder una entrada vacía que una que sí tiene su escaneo, y
   * quien va a apretar el botón tiene derecho a ver esa diferencia.
   */
  assert.equal(r.antes.entradas, 4);
  assert.equal(r.antes.conSuArchivo, 2, 'las que tienen el archivo de verdad en el disco');
  assert.equal(r.antes.prometenUnoQueNoEsta, 1, 'tiene nombre de archivo, pero el archivo no está');
  assert.equal(r.antes.sinArchivo, 1, 'la que la migración dejó en blanco');
  assert.equal(r.antes.deLaMigracion, 1, 'y se reconoce por su observación');
  assert.equal(r.antes.esperandoLaCarpeta, 2, 'sus pendientes, sin contar los de otra carpeta');
  assert.equal(r.antes.personas, 2);
  assert.equal(r.antes.miembros, 2, 'lo que NO se toca también se dice, con su número');
});

// --------------------------------------------- lo que se lleva -------------

test('la carpeta queda vacía', () => {
  assert.equal(r.despues.documentos_miembros, 0);
  assert.equal(r.hecho.entradas, 4);
});

test('y suelta los pendientes de una carpeta que no va a llegar', () => {
  assert.equal(r.despues.pendientesDeMiembros, 0);
  assert.equal(r.hecho.pendientesSoltados, 2);
});

// ------------------------------- LO QUE NO SE LLEVA, que es lo que importa --

test('las fichas de los miembros quedan enteras', () => {
  assert.equal(r.despues.miembros, 2, 'esto es lo que la corporación pidió que no se tocara');
});

test('las otras tres carpetas del sistema no se tocan', () => {
  assert.equal(r.despues.documentos_pastores, 1);
  assert.equal(r.despues.documentos_iglesias, 1);
  assert.equal(r.despues.pendientesDeIglesias, 1, 'ni sus pendientes');
  assert.ok(r.despues.elDelPastorSigue, 'ni sus archivos');
  assert.ok(r.despues.elDeLaIglesiaSigue);
});

test('un archivo que usa otra ficha no se borra del disco', () => {
  /*
   * La foto de Rosa y uno de sus documentos son el MISMO archivo. Borrar la
   * carpeta le dejaría la ficha sin foto, y una foto rota no se nota hasta que
   * alguien abre la ficha. De esto responde server/archivos.js, que es el mismo
   * cuidado que se tiene al borrar un documento de a uno.
   */
  assert.ok(r.despues.elCompartidoSigue, 'lo sigue usando la foto del miembro');
  assert.equal(r.despues.fotoDeRosa, 'foto-y-documento.jpg', 'y la ficha lo sigue nombrando');
  assert.equal(r.despues.elPropioSigue, false, 'el que solo usaba el documento sí se fue');
  assert.equal(r.hecho.borradosDelDisco, 1, 'uno de los dos, no los dos');
});

// -------------------------------------------- y queda anotado --------------

test('queda una línea en el Registro de Cambios', () => {
  assert.equal(r.linea.modulo, 'Documentos de Miembros');
  assert.equal(r.linea.accion, 'Eliminación');
  assert.equal(r.linea.usuario, 'La del ensayo', 'con el nombre de quien lo hizo');
  assert.match(r.linea.detalle, /4 entrada\(s\)/, 'y con lo que se llevó');
  assert.match(r.linea.detalle, /1 archivo\(s\) borrado/);
  assert.match(r.linea.detalle, /no se tocaron/);
});

// ------------------------------------------- las dos trabas de la puerta ---

test('la puerta pide modo mantenimiento y la palabra escrita', () => {
  /*
   * Las dos se midieron contra un servidor de verdad. Acá se vigila que sigan
   * escritas, y que la palabra sea OTRA que la de la limpieza total: quien ya
   * escribió BORRAR una vez no puede vaciar la carpeta sin darse cuenta.
   */
  const web = fs.readFileSync(path.join(__dirname, '../../server/importacion/web.js'), 'utf8');
  const puerta = web.slice(web.indexOf("router.post('/limpieza/documentos-miembros'"));
  assert.ok(puerta.includes("ajustes.activo('mantenimiento_activo')"), 'pide modo mantenimiento');
  assert.ok(puerta.includes("!== 'VACIAR'"), 'y la palabra VACIAR, no BORRAR');
});
