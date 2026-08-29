/**
 * EL ARCHIVO QUE SE SUBIÓ Y TODAVÍA NO ES DE NADIE.
 *
 * El archivo sube en cuanto se elige, antes de guardar la ficha —así se ve la
 * foto que uno acaba de escoger, y así funciona el campo de archivo en todo el
 * sistema—. Si el formulario se cancela, o el guardado se cae porque faltaba un
 * dato, el archivo ya está en el servidor y no pertenece a ninguna ficha. Sin
 * ficha no hay alcance que consultar, así que se entregaba a cualquiera que
 * tuviera sesión abierta.
 *
 * Medido antes: se elige el carnet de identidad de una miembro, se cierra el
 * formulario sin guardar, y la secretaria de otra iglesia se lo baja con un 200
 * y su contenido. Y se queda ahí hasta que pasa la barrida, que da siete días.
 *
 * Estaba escrito y era a propósito —en ese momento no hay ficha que consultar—,
 * y la decisión es razonable para la foto de perfil que uno está encuadrando.
 * Para un carnet abandonado a medio formulario, siete días es mucho.
 *
 * Lo que cuida este archivo:
 *   · que mientras no tenga ficha lo vea SOLO quien lo subió
 *   · que en cuanto tenga ficha mande el alcance de la ficha, y el haberlo
 *     subido deje de dar derechos
 *   · que el logo, el sello y la firma de la institución —que tampoco son de
 *     ninguna ficha— se sigan entregando como siempre
 *   · que uno sin ficha y sin constancia de quién lo subió no lo vea nadie
 *   · y que la constancia se olvide cuando ya no hace falta
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../../server/db');
// La tabla de configuración la crea su propio módulo al cargarse. Se pide acá
// para que este archivo se sostenga solo: corrido aparte, sin él, la pregunta
// por el sello se caía con «no such table» y arrastraba a la prueba siguiente.
require('../../server/ajustes');
const archivos = require('../../server/archivos');

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;

const CENTRAL = unaIglesia('Central del archivo', 'IG-ARS1');
const NORTE = unaIglesia('Norte del archivo', 'IG-ARS2');

const ANA = { id: 701, iglesias: `[${CENTRAL}]`, iglesia_id: CENTRAL, cuerpos: '[]' };
const EVA = { id: 702, iglesias: `[${CENTRAL}]`, iglesia_id: CENTRAL, cuerpos: '[]' };
const DE_LA_NORTE = { id: 703, iglesias: `[${NORTE}]`, iglesia_id: NORTE, cuerpos: '[]' };
const ADMIN = { id: 704, iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

let n = 0;
/** Un archivo de verdad en la carpeta de subidas, como lo deja la subida. */
function subido(quien) {
  n++;
  const nombre = `1788000000000-recien-${n}.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), 'CARNET QUE NADIE GUARDÓ');
  if (quien) archivos.recordarQuienSubio(nombre, quien.id);
  return nombre;
}

/* ------------------------------- mientras no tiene ficha */

test('lo ve quien lo subió', () => {
  const suyo = subido(ANA);
  assert.equal(archivos.puedeVer(suyo, ANA).ok, true);
});

test('y no lo ve nadie más, ni siquiera el administrador', () => {
  const suyo = subido(ANA);
  for (const [quien, otro] of [['Eva, de su misma iglesia', EVA], ['una de otra iglesia', DE_LA_NORTE], ['el administrador', ADMIN]]) {
    const veredicto = archivos.puedeVer(suyo, otro);
    assert.equal(veredicto.ok, false, `${quien} no tendría que verlo`);
    assert.match(veredicto.motivo, /todavía no pertenece a ninguna ficha/);
  }
});

test('uno sin constancia de quién lo subió no lo ve nadie', () => {
  // Los que quedaron sueltos antes de esto, o los que la barrida ya olvidó.
  const huerfano = subido(null);
  for (const quien of [ANA, EVA, ADMIN]) {
    assert.equal(archivos.puedeVer(huerfano, quien).ok, false);
  }
});

test('sin usuario tampoco, aunque el archivo tenga quien lo subió', () => {
  // La ruta ya pide sesión antes de llegar acá; esto es el cinturón.
  const suyo = subido(ANA);
  assert.equal(archivos.puedeVer(suyo, null).ok, false);
  assert.equal(archivos.puedeVer(suyo, undefined).ok, false);
});

/* ------------------------------- en cuanto tiene ficha, manda la ficha */

test('guardada la ficha, lo ve quien alcanza la ficha', () => {
  const suyo = subido(ANA);
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa','De la Subida',?,'Activo')")
    .run(CENTRAL).lastInsertRowid;
  db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo)
     VALUES (?,?, 'Carnet de identidad', 'Su carnet', ?)`
  ).run(miembro, CENTRAL, suyo);

  assert.equal(archivos.puedeVer(suyo, EVA).ok, true, 'Eva alcanza la ficha: ahora sí');
  assert.equal(archivos.puedeVer(suyo, ANA).ok, true);
  assert.equal(archivos.puedeVer(suyo, ADMIN).ok, true);
});

test('y haberlo subido deja de dar derechos cuando la ficha no es suya', () => {
  /*
   * Es la mitad que importa: si el que subió el archivo lo siguiera viendo
   * para siempre, bastaría subir un papel y adjuntarlo a la ficha de otra
   * iglesia para quedarse con una llave permanente.
   */
  const suyo = subido(ANA);
  const deLaNorte = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Ajena','De La Norte',?,'Activo')")
    .run(NORTE).lastInsertRowid;
  db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo)
     VALUES (?,?, 'Otro', 'De la Norte', ?)`
  ).run(deLaNorte, NORTE, suyo);

  assert.equal(archivos.puedeVer(suyo, ANA).ok, false, 'lo subió, pero la ficha no es de su iglesia');
  assert.equal(archivos.puedeVer(suyo, DE_LA_NORTE).ok, true);
});

/* ------------------------------- lo de la institución sigue igual */

test('el logo, el sello y la firma se siguen entregando a quien tenga sesión', () => {
  /*
   * No pertenecen a ninguna ficha —viven en la configuración— y no son de
   * nadie en particular: salen en las credenciales, en las actas y en los
   * documentos que imprime medio sistema. Sin esta excepción, el sello dejaría
   * de verse para todos menos para quien lo cargó, y la pantalla de
   * Configuración amanecería con un hueco.
   */
  const sello = subido(ADMIN);
  assert.equal(archivos.puedeVer(sello, EVA).ok, false, 'todavía no está en la configuración');
  db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('credencial_sello', ?)").run(sello);
  assert.equal(archivos.puedeVer(sello, EVA).ok, true);
  assert.equal(archivos.puedeVer(sello, DE_LA_NORTE).ok, true, 'el sello es de la institución, no de una iglesia');
});

test('si no se puede preguntar por la configuración, no se entrega', () => {
  /*
   * La pregunta «¿la usa la configuración?» existía para decidir si se BORRA un
   * archivo, y ante la duda contestaba que sí, para no borrar nada por error.
   * Reusarla acá habría dado vuelta el modo de fallo: un problema al consultar
   * la base abriría el archivo a todo el mundo. Por eso acá va la suya, que
   * ante la duda no entrega. Se descubrió al romper esto a propósito.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/archivos.js'), 'utf8');
  const suya = src.slice(src.indexOf('function esDeLaInstitucion'), src.indexOf('/** Borra un archivo del disco'));
  assert.match(suya, /catch \(e\) \{\s*return false;/, 'ante la duda, no se entrega');
  const paraBorrar = src.slice(src.indexOf('function loUsaLaConfiguracion'), src.indexOf('function esDeLaInstitucion'));
  assert.match(paraBorrar, /return true;/, 'y la de borrar sigue diciendo que sí, para no borrar de más');
  // Solo el cuerpo de `puedeVer`: hasta el `}` que la cierra al margen. Un
  // recorte más largo se lleva por delante a las funciones vecinas —una de
  // ellas se llama justamente `loUsaLaConfiguracion`— y la prueba miente.
  const desde = src.indexOf('function puedeVer');
  const mirar = src.slice(desde, src.indexOf('\n}', desde) + 2);
  assert.ok(mirar.length < 1800, `el recorte de puedeVer mide ${mirar.length}`);
  assert.match(mirar, /esDeLaInstitucion\(archivo\)/);
  assert.doesNotMatch(mirar, /loUsaLaConfiguracion/, 'la de borrar no puede decidir quién mira');
});

/* ------------------------------- la constancia se olvida sola */

/*
 * Estas dos no corren la barrida de verdad. La carpeta de subidas es una sola y
 * estas pruebas van en paralelo con las demás: una barrida que borre lo que no
 * reclama nadie se lleva por delante los archivos de otro archivo de pruebas y
 * los suyos, y las dos partes empiezan a fallar sin razón aparente. Pasó.
 */
test('borrado el archivo con su ficha, se olvida quién lo subió', () => {
  const suyo = subido(ANA);
  assert.equal(archivos.quienLoSubio(suyo), ANA.id);
  const def = require('../../server/registry').getModule('documentos_miembros');
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Nora','Que Se Borra',?,'Activo')")
    .run(CENTRAL).lastInsertRowid;
  const fila = db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo)
     VALUES (?,?, 'Otro', 'Se va a borrar', ?) RETURNING *`
  ).get(miembro, CENTRAL, suyo);
  db.prepare('DELETE FROM documentos_miembros WHERE id = ?').run(fila.id);

  assert.equal(archivos.borrarLosDe(def, fila), 1, 'el archivo se va con su ficha');
  assert.equal(fs.existsSync(path.join(UPLOADS_DIR, suyo)), false);
  assert.equal(archivos.quienLoSubio(suyo), null, 'la fila no puede sobrevivir al archivo');
});

test('la barrida olvida la anotación del que ya tiene ficha, sin borrarlo', () => {
  const suyo = subido(ANA);
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Elba','Con Ficha',?,'Activo')")
    .run(CENTRAL).lastInsertRowid;
  db.prepare(
    `INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, archivo)
     VALUES (?,?, 'Otro', 'Con ficha', ?)`
  ).run(miembro, CENTRAL, suyo);
  // Se le envejece la fecha para que la barrida llegue a mirarlo, y se corre en
  // seco: en seco no borra ningún archivo, ni el suyo ni el de nadie.
  const hace = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(UPLOADS_DIR, suyo), hace, hace);

  archivos.limpiarHuerfanos({ diasDeGracia: 1, deVerdad: false });
  assert.equal(archivos.quienLoSubio(suyo), null, 'con ficha, quién lo subió deja de decidir nada');
  assert.equal(fs.existsSync(path.join(UPLOADS_DIR, suyo)), true, 'y el archivo no se toca: tiene ficha');
  assert.equal(archivos.puedeVer(suyo, EVA).ok, true, 'se sigue viendo por su ficha');
});

/* ------------------------------- la subida deja dicho quién fue */

test('la subida anota quién fue, o esto no sirve de nada', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(src, /archivos\.recordarQuienSubio\(req\.file\.filename, req\.user && req\.user\.id\);/,
    'sin esta línea ningún archivo tendría dueño y no se vería ni el propio');
  const laRuta = src.slice(src.indexOf("app.post('/api/upload'"), src.indexOf("app.get('/uploads/:archivo'"));
  assert.match(laRuta, /recordarQuienSubio/, 'y va en la ruta de subida, no en cualquier parte');
});

test('la tabla donde se anota se crea sola', () => {
  const hay = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'archivos_subidos'").get();
  assert.ok(hay, 'sin la tabla, quien sube un archivo no vería ni el suyo');
});
