/**
 * LA HOJA IMPRESA DE UN MIEMBRO Y LO QUE HAY EN SU CARPETA.
 *
 * La hoja llevaba sus datos y su historial. De su carpeta no llevaba nada, y
 * eso no se notaba porque el historial tiene líneas que dicen «Se adjuntó "…"»
 * y de lejos parecen una lista de papeles. No lo son. Medido sobre una carpeta
 * de tres documentos, la hoja se equivocaba en las DOS direcciones:
 *
 *   secciones de la hoja ..............  Datos · Historial
 *   sección de la carpeta .............  no había
 *   papeles nombrados en la hoja ......  3, todos dentro del historial
 *   uno de esos tres ..................  ya se había quitado de la carpeta
 *                                        (la línea del historial queda)
 *   uno de la carpeta .................  no aparecía en ninguna parte
 *                                        (entró por importación: nunca dejó línea)
 *
 * O sea: de los tres que la hoja nombraba, uno no estaba; y de los tres que
 * estaban, uno no salía. Quien entrega una congregación, prepara un traslado o
 * pregunta qué le falta a alguien por presentar, se lleva esa hoja.
 *
 * Lo que cuida este archivo:
 *   · que la hoja pida la carpeta al servidor, acotada a esa ficha y con tope
 *   · que si no se puede traer —sin permiso— la hoja salga igual, sin esa parte
 *   · que la sección vaya ANTES del historial, y diga en una línea qué es y
 *     qué no es, porque confundirla con el historial es fácil y es caro
 *   · que un papel anotado sin archivo salga marcado
 *   · que el vacío se diga, porque «qué falta» es la pregunta que trae a alguien
 *     a esta hoja
 *   · y que las dos fuentes de verdad, medidas sobre datos, no digan lo mismo:
 *     es la razón de que esta sección tenga que existir
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const registry = require('../../server/registry');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const laHoja = app.slice(app.indexOf('function printGenerico'), app.indexOf('Importación de datos desde archivos CSV'));
const laRuta = app.slice(app.indexOf('let susDocumentos = null;'), app.indexOf('const bajarPdf ='));

test('los dos trozos que se revisan son los que se creen', () => {
  // El tope es una red por si el corte se corriera y arrastrara código ajeno,
  // no una medida de cuánto puede crecer la hoja: subió en la 1.266.0 al
  // explicarse ahí por qué el encabezado dice de qué registro es, y en la
  // 1.401.0 al explicarse por qué el texto con formato se imprime pintado.
  assert.ok(laHoja.length > 3000 && laHoja.length < 24000, `la hoja mide ${laHoja.length}`);
  assert.match(laHoja, /print-sheet print-generic/);
  // Mismo caso que el tope de arriba: es una red por si el corte se corriera,
  // no una medida. Subió en la 1.269.0 al traerse también el plan de una deuda.
  assert.ok(laRuta.length > 400 && laRuta.length < 6000, `la ruta mide ${laRuta.length}`);
  assert.match(laRuta, /printGenerico/);
});

/* ------------------------------- la hoja pide la carpeta */

test('la hoja pide la carpeta de esa ficha, con tope y de lo más nuevo a lo más viejo', () => {
  assert.match(laRuta, /f_\$\{panelDocs\.campo\}=\$\{id\}/, 'acotada a esta persona, no la tabla entera');
  assert.match(laRuta, /limit=\$\{DOCUMENTOS_EN_EL_PAPEL\}/);
  assert.match(laRuta, /sort=fecha&dir=desc/);
  assert.match(app, /const DOCUMENTOS_EN_EL_PAPEL = 200;/);
});

test('solo la llevan las fichas que lo declaran, y el panel dice de qué módulo sale', () => {
  // Eran los miembros; desde la 1.202.0 también la iglesia y el pastor, que
  // son las otras dos fichas que se entregan en papel. La solicitud no: tiene
  // su propia hoja, con su propia tramitación.
  assert.match(app, /const DOCUMENTOS_EN_LA_HOJA = \['miembros', 'iglesias', 'pastores'\];/);
  assert.match(laRuta, /DOCUMENTOS_EN_LA_HOJA\.includes\(name\) \? PANEL_DOCUMENTOS\[name\] : null/,
    'el módulo y el campo salen del mismo mapa que usa la pestaña, no de un nombre escrito otra vez');
  assert.match(laRuta, /if \(panelDocs && MOD\[panelDocs\.modulo\]\)/,
    'y si esa persona no tiene el módulo a la vista, ni se pide');
});

test('si la carpeta no se puede traer, la hoja se imprime igual sin esa parte', () => {
  /*
   * Es la regla que ya siguen las ayudas y el historial: lo que no se pueda
   * traer no impide imprimir. Quien puede ver la ficha de alguien pero no sus
   * documentos —se puede: el permiso es por módulo— tiene que poder imprimirla.
   */
  const desde = laRuta.indexOf('susDocumentos = await api(');
  assert.ok(desde > -1);
  const trozo = laRuta.slice(desde, desde + 320);
  assert.match(trozo, /\.catch\(\(\) => null\)/);
  assert.match(laHoja, /const carpeta = susDocumentos \? `/,
    'y sin datos la sección entera no se dibuja, en vez de salir vacía');
});

/* ------------------------------- lo que la sección dice */

test('la sección existe y se llama por lo que es', () => {
  assert.match(laHoja, /<h2 class="print-h2">Documentos en carpeta<\/h2>/);
});

test('va antes del historial, no después', () => {
  // Es una lista corta y de hecho; el historial es largo y se lee al final.
  const cuerpo = laHoja.slice(laHoja.indexOf('${entregas}'));
  const carpeta = cuerpo.indexOf('${carpeta}');
  const historial = cuerpo.indexOf('${historial}');
  assert.ok(carpeta > -1 && historial > -1, 'las dos secciones tienen que estar en la hoja');
  assert.ok(carpeta < historial, 'la carpeta va antes que el historial');
});

test('dice en una línea qué es esta lista y qué no es', () => {
  assert.match(laHoja, /Es lo que hay hoy en el sistema; el historial de más abajo cuenta lo que se fue adjuntando/,
    'sin esta línea, «Se adjuntó "su carnet"» quince líneas más abajo se lee como que el carnet está');
});

test('cuando hay más de los que caben, lo dice en vez de cortar callado', () => {
  assert.match(laHoja, /papeles\.length < cuantosPapeles/);
  assert.match(laHoja, /Se imprimen los \$\{papeles\.length\} más recientes, de \$\{cuantosPapeles\}/);
});

test('una carpeta vacía lo dice', () => {
  assert.match(laHoja, /'Sin documentos en carpeta\.'/,
    'no decir nada se lee como que la sección no se pudo traer');
});

test('un papel anotado sin archivo sale marcado', () => {
  /*
   * Los hay: los que entraron por importación y los que se cargaron antes de
   * que el sistema exigiera el archivo (1.193.0). En una hoja que se firma no
   * da lo mismo un documento que está en el sistema que uno que solo está
   * anotado.
   */
  assert.match(laHoja, /\$\{d\.archivo \? '' : ' <i>— anotado, sin archivo en el sistema<\/i>'\}/);
});

test('la tabla lleva las columnas que sirven en papel', () => {
  /*
   * Eran cuatro hasta la 1.200.0, cuando el documento pudo decir hasta cuándo
   * vale: la vigencia entra en la hoja porque quien la lee está buscando
   * justamente qué hay que renovar.
   */
  const desde = laHoja.indexOf('<h2 class="print-h2">Documentos en carpeta</h2>');
  const hasta = laHoja.indexOf('Y su historial, debajo de todo');
  const seccion = laHoja.slice(desde, hasta);
  assert.match(seccion, /<th>Fecha<\/th><th>Tipo de documento<\/th><th>Nombre<\/th>\$\{algunoVence\s*\n?\s*\? '<th>Vence<\/th>' : ''\}<th>Observaciones<\/th>/,
    'y la de vencimiento va entre las dos últimas, cuando la hay');
  assert.match(seccion, /estaVencido\(d\.vence\) \? ' <b>\(vencido\)<\/b>' : ''/,
    'y lo vencido se marca: comparar diez fechas contra hoy a ojo es lo que la hoja tiene que ahorrar');
  /*
   * La columna solo cuando alguno vence: la carpeta de un miembro tiene esa
   * fecha, la de una iglesia y la de un pastor no, y una columna entera de
   * rayas en una hoja que alguien firma es peso muerto.
   */
  assert.match(app, /const algunoVence = papeles\.some\(\(d\) => d\.vence\);/);
  assert.match(seccion, /fechaCorta\(d\.fecha\)/, 'la fecha del documento, escrita como se escribe');
  assert.doesNotMatch(seccion, /d\.archivo\}<\/td>/,
    'el nombre del archivo en el servidor no le dice nada a quien lee la hoja');
});

test('todo lo que sale del registro va escapado', () => {
  const desde = laHoja.indexOf('<h2 class="print-h2">Documentos en carpeta</h2>');
  const hasta = laHoja.indexOf('Y su historial, debajo de todo');
  const seccion = laHoja.slice(desde, hasta);
  for (const campo of ['d.tipo', 'd.nombre', 'd.observaciones']) {
    assert.match(seccion, new RegExp(`esc\\(${campo.replace('.', '\\.')} \\|\\| ''\\)`), `${campo} sin escapar`);
  }
});

test('la hoja recibe la carpeta como un dato más, sin cambiarle nada a las otras', () => {
  /*
   * Se comprueba que la carpeta esté entre lo que recibe y entre lo que se le
   * pasa, no que sea el ÚLTIMO de la lista: cuando la 1.235.0 le agregó a la
   * hoja de una iglesia lo que la congregación tiene, esta prueba se cayó por
   * un argumento nuevo detrás, sin que nada de la carpeta hubiera cambiado.
   */
  /*
   * Desde la 1.255.0 lo que la hoja lleva de más llega CON NOMBRE y no por
   * posición: eran cinco cosas en fila y la sexta —la gente de un cuerpo—
   * habría dejado una llamada de siete argumentos. Lo que esta prueba mide
   * sigue siendo lo mismo: que la carpeta esté entre lo que recibe y entre lo
   * que se le pasa.
   */
  assert.match(app, /function printGenerico\(m, row, extras = \{\}\)/);
  assert.match(app, /const \{[^}]*\bsusDocumentos\b[^}]*\} = extras;/);
  assert.match(app, /sheet = printGenerico\(m, row, \{[^}]*\bsusDocumentos\b/);
  // Las hojas que no son la genérica no la reciben ni la necesitan
  for (const otra of ['printSolicitud', 'printCertificado', 'printActa', 'printServicio', 'printMovimiento']) {
    assert.doesNotMatch(app, new RegExp(`${otra}\\([^)]*susDocumentos`), `${otra} no tiene por qué recibirla`);
  }
});

/* ------------------------------- y la razón de fondo, medida sobre datos */

/*
 * Las líneas del historial NO se escriben a mano acá: las escribe el sistema,
 * con la misma llamada que hace el motor al guardar. Si se pusieran a mano, la
 * prueba diría lo que yo quiero que diga y no lo que el sistema hace.
 */
const bitacora = require('../../server/bitacora');
const DOCS = registry.getModule('documentos_miembros');
const quien = { id: 1, nombre: 'Secretaria de la hoja', rol: 'secretario' };

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la hoja','IG-HOJ1','Activa')")
  .run().lastInsertRowid;
const rosa = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa Elena','Cárcamo de la Hoja',?,'Activo')")
  .run(iglesia).lastInsertRowid;

/** Adjuntar un papel: se guarda la fila y se avisa al sistema, como el motor. */
const adjuntar = (tipo, nombre, fecha, archivo) => {
  const id = db.prepare(
    'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?,?)'
  ).run(rosa, iglesia, tipo, nombre, fecha, archivo).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id);
  bitacora.registrarGuardado(DOCS, { isNew: true, antes: null, despues: fila, datos: fila, user: quien });
  return id;
};

/** Y quitarlo, avisando igual que el motor cuando alguien borra. */
const quitar = (id) => {
  const fila = db.prepare('SELECT * FROM documentos_miembros WHERE id = ?').get(id);
  db.prepare('DELETE FROM documentos_miembros WHERE id = ?').run(id);
  bitacora.registrarEliminado(DOCS, fila, quien, null);
};

const carnet = adjuntar('Carnet de identidad', 'Carnet vigente hasta 2030', '2020-04-12', 'carnet-hoja.txt');
adjuntar('Ficha de registro de miembro', 'Ficha de registro firmada', '2015-03-08', 'ficha-hoja.txt');
const carta = adjuntar('Carta de traslado', 'Carta de traslado a la Norte', '2026-07-01', 'carta-hoja.txt');

// De esos tres, uno se quita de la carpeta
quitar(carta);

// Y uno entra por importación: la fila se crea sin pasar por el guardado del
// motor, que es exactamente lo que hace una carga masiva
db.prepare('INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?,?)')
  .run(rosa, iglesia, 'Certificado de bautismo',
    'Certificado de bautismo (original en la carpeta física)', '2001-11-18', null);

const enLaCarpeta = () => db.prepare(
  'SELECT nombre FROM documentos_miembros WHERE miembro_id = ? ORDER BY fecha DESC'
).all(rosa).map((r) => r.nombre);

const nombradosPorElHistorial = () => db.prepare(
  "SELECT descripcion FROM bitacora WHERE miembro_id = ? AND descripcion LIKE 'Se adjuntó%'"
).all(rosa).map((r) => (r.descripcion.match(/"([^"]+)"/) || [])[1]);

test('el sistema escribe la línea del historial al adjuntar', () => {
  // Si esto fallara, las tres pruebas que siguen no medirían nada
  assert.deepEqual([...nombradosPorElHistorial()].sort(), [
    'Carnet vigente hasta 2030',
    'Carta de traslado a la Norte',
    'Ficha de registro firmada',
  ], 'las escribe el sistema, no esta prueba');
});

test('el historial nombra un papel que ya no está en la carpeta', () => {
  assert.ok(nombradosPorElHistorial().includes('Carta de traslado a la Norte'),
    'quitarlo no borra su línea: lo que pasó, pasó');
  assert.ok(!enLaCarpeta().includes('Carta de traslado a la Norte'), 'pero de la carpeta se fue');
});

test('y la carpeta tiene uno que el historial no nombra en ninguna parte', () => {
  const cual = 'Certificado de bautismo (original en la carpeta física)';
  assert.ok(enLaCarpeta().includes(cual));
  assert.ok(!nombradosPorElHistorial().includes(cual), 'entró por importación: nunca dejó línea');
});

test('así que una hoja armada con el historial se equivoca en las dos direcciones', () => {
  const carpeta = enLaCarpeta();
  const historial = nombradosPorElHistorial();
  const deMas = historial.filter((n) => !carpeta.includes(n));    // los que nombraría y no están
  const deMenos = carpeta.filter((n) => !historial.includes(n));  // los que están y no nombraría
  assert.deepEqual(deMas, ['Carta de traslado a la Norte']);
  assert.deepEqual(deMenos, ['Certificado de bautismo (original en la carpeta física)']);
  // tres y tres, y aun así ninguna lista es la otra: contar no basta
  assert.equal(carpeta.length, 3);
  assert.equal(historial.length, 3);
  assert.notDeepEqual([...carpeta].sort(), [...historial].sort());
});

test('la que la hoja usa ahora es la de la carpeta, y trae lo que hay hoy', () => {
  assert.equal(DOCS.defaultSort.field, 'fecha');
  assert.ok(DOCS.fields.some((f) => f.name === 'miembro_id'), 'se acota por el miembro');
  assert.deepEqual(enLaCarpeta(), [
    'Carnet vigente hasta 2030',
    'Ficha de registro firmada',
    'Certificado de bautismo (original en la carpeta física)',
  ], 'de lo más nuevo a lo más viejo, y sin el que se quitó');
  assert.ok(carnet, 'el carnet sigue siendo el mismo registro');
});
