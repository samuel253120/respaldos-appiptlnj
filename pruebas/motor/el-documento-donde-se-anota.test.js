/**
 * EL DOCUMENTO SE ADJUNTA DONDE SE ANOTA.
 *
 * Medido antes, sobre la ficha de una miembro con catorce anotaciones:
 *
 *   la ventana «Nueva anotación» ofrecía ..  Fecha · Tipo · Descripción
 *   campo de archivo en esa ventana ......  no había
 *   el módulo tiene un campo .............  «Documento adjunto», type: file
 *   lo que decía al editar ...............  «Para adjuntar un documento a este
 *                                            registro, ábralo en su ficha completa»
 *   columna del listado que lo dijera ....  no había (6 columnas)
 *   marca en la pestaña ..................  ninguna
 *
 * Quien anota una disciplina, un acuerdo o un permiso tiene el papel en la mano
 * o la foto en el teléfono, y ese es el momento en que lo va a adjuntar. Había
 * que guardar la anotación, volver a buscarla, abrirla en su ficha completa y
 * guardar otra vez: cuatro pasos y dos guardados para lo que iba en uno. El
 * resultado previsible es que el documento no se adjunta.
 *
 * Y la otra mitad del mismo problema: aunque se adjuntara, no había forma de
 * mirar por encima cuáles anotaciones estaban respaldadas.
 *
 * Lo que cuida este archivo:
 *   · que la ventana traiga el campo, y que lo saque del propio módulo
 *   · que suba el archivo con el mismo mecanismo del motor —los tres nombres
 *     con que se buscan sus partes tienen que seguir coincidiendo—
 *   · que el archivo viaje al guardar, y que al editar llegue el que ya tenía
 *   · que la pestaña, el listado y la hoja impresa digan cuáles lo llevan
 *   · y que un historial sin ese campo no prometa un adjunto que no existe
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const registry = require('../../server/registry');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
const laVentana = app.slice(app.indexOf('function abrirAnotacion'), app.indexOf('Ficha del cuerpo: estado de cumplimiento'));

test('el trozo que se revisa es el de la ventana de anotación', () => {
  assert.ok(laVentana.length > 1500 && laVentana.length < 12000, `el recorte mide ${laVentana.length}`);
  assert.match(laVentana, /Nueva anotación/);
});

/* ------------------------------- la ventana trae el campo */

test('la ventana ofrece el documento adjunto', () => {
  // Se mira DENTRO del trozo que la condición dibuja, no el archivo entero: si
  // se buscara solo el identificador, apagar el campo dejaría su marca escrita
  // y la prueba seguiría pasando con la ventana sin campo. Eso pasó.
  const desde = laVentana.indexOf('${campoAdjunto ? `');
  assert.ok(desde > -1, 'el campo ya no cuelga del que declara el módulo');
  const hasta = laVentana.indexOf('<div class="form-error"', desde);
  assert.ok(hasta > desde, 'no se encuentra dónde termina ese trozo');
  const elBloque = laVentana.slice(desde, hasta);
  assert.match(elBloque, /id="file_anAdjunto"/, 'no hay dónde elegir el archivo');
  assert.match(elBloque, /Elegir archivo/);
});

test('el campo sale del propio módulo, no de una lista escrita a mano', () => {
  // Si se escribiera acá, el día en que un historial cambiara su campo la
  // ventana seguiría ofreciendo uno que ya no existe.
  assert.match(laVentana, /MOD\[panel\.modulo\]\.fields\.find\(\(f\) => f\.name === 'adjunto' && f\.type === 'file'\)/);
  assert.match(laVentana, /\$\{campoAdjunto \?/, 'y solo se dibuja si el módulo lo tiene');
  assert.match(laVentana, /esc\(campoAdjunto\.label\)/, 'con el nombre que le puso el módulo');
});

test('el que no tiene ese campo no promete un adjunto que no existe', () => {
  const conAdjunto = ['bitacora', 'historial_iglesias', 'historial_pastores'];
  for (const nombre of conAdjunto) {
    const campo = registry.getModule(nombre).fields.find((f) => f.name === 'adjunto');
    assert.ok(campo && campo.type === 'file', `${nombre} debería tener su adjunto`);
  }
  const solicitudes = registry.getModule('historial_solicitudes').fields.find((f) => f.name === 'adjunto');
  assert.ok(!solicitudes, 'el historial de una solicitud no lo tiene, y por eso la ventana no lo dibuja ahí');
});

test('la nota que mandaba a otra parte ya no está', () => {
  assert.doesNotMatch(app, /Para adjuntar un documento a este registro/,
    'era el síntoma: la ventana reconocía que no servía para esto');
});

/* ------------------------------- se sube con el mecanismo del motor */

test('el archivo lo sube la misma función que usa el formulario de una ficha', () => {
  assert.match(laVentana, /if \(campoAdjunto\) initFileField\(\{ name: 'anAdjunto' \}\)/,
    'con su condición: la llamada suelta seguiría escrita aunque no llegara a hacerse');
  const subidor = app.slice(app.indexOf('function initFileField'), app.indexOf('function collectForm'));
  // En el trozo que corre AL ELEGIR el archivo. Esa función sube desde dos
  // sitios —también al reencuadrar una foto—, así que mirar el archivo entero
  // no distinguiría entre los dos: se quedaría contenta con el otro.
  const alElegir = subidor.slice(subidor.indexOf("fileInput.addEventListener('change'"));
  assert.match(alElegir, /api\('POST', '\/upload', fd, true\)/,
    'sube apenas se elige el archivo, como en cualquier otra ficha');
});

test('los tres nombres con que esa función busca sus partes coinciden con los de la ventana', () => {
  /*
   * `initFileField` busca por identificador —`ff_`, `file_` y `fname_` más el
   * nombre del campo—. Si alguno se renombrara de un lado y no del otro, la
   * ventana dibujaría el campo, no pasaría nada al elegir un archivo y nadie
   * se enteraría hasta que alguien intentara adjuntar algo de verdad.
   */
  const subidor = app.slice(app.indexOf('function initFileField'), app.indexOf('function collectForm'));
  for (const trozo of ["'file_' + f.name", "'ff_' + f.name", "'fname_' + f.name"]) {
    assert.ok(subidor.includes(trozo), `initFileField ya no busca con ${trozo}`);
  }
  for (const id of ['ff_anAdjunto', 'file_anAdjunto', 'fname_anAdjunto']) {
    assert.ok(laVentana.includes(`id="${id}"`), `la ventana ya no dibuja ${id}`);
  }
});

/* ------------------------------- y viaja con lo demás */

test('el archivo viaja al guardar', () => {
  assert.match(laVentana, /if \(campoAdjunto\) datos\.adjunto = fondo\.querySelector\('#ff_anAdjunto input\[type=hidden\]'\)\.value/,
    'sin esto se sube el archivo y la anotación se guarda sin él');
});

test('al editar, el campo llega con el que ya tenía', () => {
  // En el campo que después se manda —el oculto—, no solo en el enlace que se
  // muestra: guardar sin tocar nada no puede borrarle el documento.
  assert.match(laVentana, /name="anAdjunto" value="\$\{esc\(valor\('adjunto', ''\)\)\}"/);
  assert.match(laVentana, /uploads\/\$\{esc\(valor\('adjunto', ''\)\)\}/,
    'y se puede abrir desde ahí mismo, sin salir de la ventana');
});

/* ------------------------------- quiénes lo llevan, de un vistazo */

test('la pestaña dice cuáles traen documento, y deja abrirlo', () => {
  const laPestana = app.slice(app.indexOf('const HISTORIAL_DE_A'), app.indexOf('function abrirAnotacion'));
  assert.match(laPestana, /r\.adjunto \? `<div class="hadj">/);
  assert.match(laPestana, /href="\/uploads\/\$\{esc\(r\.adjunto\)\}"/);
  assert.match(laPestana, /nombreArchivo\(r\.adjunto\)/, 'con su nombre, no con el que le puso el servidor');
  assert.match(css, /\.historial \.hadj a \{/, 'y con su estilo, para que se vea que es un enlace');
});

test('el listado lleva su columna, y el motor la esconde sola cuando nadie tiene', () => {
  const def = registry.getModule('bitacora');
  assert.ok(def.listFields.includes('adjunto'), 'no hay columna que diga cuáles están respaldadas');
  // El motor ya sabe que una columna de archivo vacía no se dibuja: es la
  // misma regla con que una columna de fotos desaparece si nadie tiene foto.
  assert.match(app, /f\.type !== 'file' \|\| data\.rows\.some\(\(r\) => r\[c\]\)/);
  assert.match(app, /if \(f && f\.type === 'file'\) clases\.push\('col-mini'\)/,
    'y angosta, para no comerle el sitio a la descripción');
});

test('la hoja impresa nombra el documento que respalda la anotación', () => {
  const laHoja = app.slice(app.indexOf('function printGenerico'), app.indexOf('Importación de datos desde archivos CSV'));
  assert.match(laHoja, /h\.adjunto[\s\S]{0,120}con documento adjunto/,
    'en una constancia importa saber que la línea tiene un papel detrás');
  assert.match(laHoja, /nombreArchivo\(h\.adjunto\)/);
});

/* ------------------------------- lo que ya estaba, sin tocar */

test('la ventana sigue guardando lo de siempre', () => {
  for (const campo of ['anFecha', 'anTipo', 'anDesc']) {
    assert.ok(laVentana.includes(`#${campo}`), `se perdió ${campo}`);
  }
  assert.match(laVentana, /Escriba la descripción\./, 'la descripción sigue siendo obligatoria');
  assert.match(laVentana, /aviso-auto/, 'y el aviso de lo que anotó el sistema sigue estando');
});

test('los otros dos historiales tienen el mismo campo y su columna queda para su turno', () => {
  // La ventana ya les sirve —el campo lo saca de cada módulo—, pero la columna
  // del listado se agrega donde toca, en la revisión de cada uno. Se deja
  // dicho acá para que no parezca olvido.
  for (const nombre of ['historial_iglesias', 'historial_pastores']) {
    const def = registry.getModule(nombre);
    assert.ok(def.fields.some((f) => f.name === 'adjunto'), `${nombre} tiene el campo`);
    assert.ok(!def.listFields.includes('adjunto'), `${nombre} todavía no lo lleva en su listado`);
  }
});
