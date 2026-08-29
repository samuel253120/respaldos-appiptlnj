/**
 * LA PESTAÑA DE DOCUMENTOS, CUANDO LA CARPETA TIENE VEINTE AÑOS ENCIMA.
 *
 * Medido sobre una ficha con 118 papeles:
 *
 *   el encabezado decía ...............  «118 documento(s)»
 *   papeles que llegaba a mostrar .....  100
 *   los otros 18 ......................  no se veían, y nada lo decía
 *   alto de la pestaña ................  7.959 px · 8,8 pantallas
 *   buscador dentro de la pestaña .....  no había
 *   filtro por tipo ...................  no había
 *
 * Con tres documentos la pestaña estaba bien resuelta. El problema aparece con
 * los años, que es lo que una carpeta acumula.
 *
 * Es el mismo hueco que tenía la pestaña del historial y se arregla igual
 * (1.185.0): un tramo, el total dicho, los que faltan a un botón de distancia,
 * y el buscador y el filtro resueltos en el SERVIDOR —en el navegador solo
 * alcanzarían el tramo cargado, y un papel de hace quince años no aparecería
 * nunca—.
 *
 * Lo que cuida este archivo:
 *   · que traiga un tramo y diga cuántos hay
 *   · que ofrezca traer los que faltan sin volver a empezar
 *   · que buscar y filtrar viajen al servidor, y vuelvan al primer tramo
 *   · que el foco no se pierda al repintar por una tecla
 *   · que «no hay ninguno» y «ninguno coincide» no digan lo mismo
 *   · y que lo que la pestaña ya hacía bien siga igual
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const registry = require('../../server/registry');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const laPestana = app.slice(app.indexOf('const DOCUMENTOS_DE_A'), app.indexOf('La tramitación de una solicitud'));

test('el trozo que se revisa es el del panel de documentos', () => {
  assert.ok(laPestana.length > 3000 && laPestana.length < 9000, `el recorte mide ${laPestana.length}`);
  assert.match(laPestana, /async function renderDocumentos/);
});

/* ------------------------------- trae un tramo, y lo dice */

test('trae de a veinticuatro, no cien de una vez', () => {
  assert.match(laPestana, /const DOCUMENTOS_DE_A = 24;/);
  assert.match(laPestana, /limit=\$\{st\.cuantas\}/, 'el tramo lo decide el estado, no un número fijo');
  assert.doesNotMatch(laPestana, /limit=100/, 'el tope mudo de 100 ya no está');
});

test('son menos que los del historial, y por una razón medida', () => {
  // La primera versión de esta prueba daba por razón que la fila del documento
  // era mucho más alta que la del historial. Se midió y era falso: 79 px contra
  // 85 px. La razón verdadera es el peso: cada fila de documento se descarga el
  // escaneo para la miniatura, y la del historial no descarga nada.
  const deA = Number(laPestana.match(/const DOCUMENTOS_DE_A = (\d+);/)[1]);
  const historial = Number(app.match(/const HISTORIAL_DE_A = (\d+);/)[1]);
  assert.ok(deA < historial, `${deA} tendría que ser menos que ${historial}`);
  assert.match(laPestana, /79 px y la línea del historial 85 px/,
    'la razón que no es —el alto— queda descartada con su medida');
  assert.match(laPestana, /4,2 MB/, 'y la que sí es queda dicha con la suya');
});

test('cuando hay más de los que trajo, lo dice y ofrece traerlos', () => {
  assert.match(laPestana, /datos\.rows\.length < datos\.total/);
  assert.match(laPestana, /Mostrando \$\{datos\.rows\.length\} de \$\{datos\.total\}/);
  assert.match(laPestana, /id="docMas"/);
  assert.match(laPestana, /docMas[\s\S]{0,200}cuantas: st\.cuantas \+ DOCUMENTOS_DE_A/,
    'el botón trae el tramo siguiente, sin volver a empezar');
});

/* ------------------------------- buscador y filtro, en el servidor */

test('la pestaña tiene buscador y filtro por tipo', () => {
  assert.match(laPestana, /id="docBuscar"/);
  assert.match(laPestana, /id="docTipo"/);
});

test('los dos viajan al servidor, no se aplican sobre lo que ya está a la vista', () => {
  assert.match(laPestana, /st\.q \? `&q=\$\{encodeURIComponent\(st\.q\)\}`/);
  assert.match(laPestana, /st\.tipo \? `&f_tipo=\$\{encodeURIComponent\(st\.tipo\)\}`/);
});

test('los tipos del desplegable salen del propio módulo', () => {
  assert.match(laPestana, /modDocs\.fields\.find\(\(f\) => f\.name === 'tipo'\)/,
    'para que no haya una lista escrita a mano que se quede vieja');
});

test('el motor acepta ese filtro porque «tipo» está declarado como filtrable', () => {
  /*
   * El motor solo admite `f_<campo>` de los campos que el módulo declara. Si
   * «tipo» se renombrara o saliera de filterFields, el filtro dejaría de acotar
   * y nadie se enteraría, porque seguiría devolviendo todo.
   */
  for (const nombre of ['documentos_miembros', 'documentos_iglesias', 'documentos_pastores', 'documentos_solicitudes']) {
    const def = registry.getModule(nombre);
    const campo = def.fields.find((f) => f.name === 'tipo');
    assert.ok(campo, `${nombre} no declara «tipo»`);
    assert.ok((campo.options || []).length > 0, `${nombre} no ofrece tipos que elegir`);
  }
  assert.ok(registry.getModule('documentos_miembros').filterFields.includes('tipo'));
});

test('buscar o filtrar vuelve al primer tramo', () => {
  assert.match(laPestana, /porTipo\.value[\s\S]{0,60}cuantas: DOCUMENTOS_DE_A/);
  assert.match(laPestana, /caja\.value\.trim\(\)[\s\S]{0,60}cuantas: DOCUMENTOS_DE_A/);
});

test('se espera a que deje de teclear', () => {
  assert.match(laPestana, /clearTimeout\(espera\)/);
  assert.match(laPestana, /setTimeout\([\s\S]{0,160}, 280\)/, 'el mismo respiro que el resto del sistema');
});

test('el foco vuelve al buscador después de repintar', () => {
  assert.match(laPestana, /if \(st\.foco\)[\s\S]{0,120}caja\.focus\(\)/);
  assert.match(laPestana, /setSelectionRange\(caja\.value\.length, caja\.value\.length\)/, 'y el cursor al final');
});

test('el encabezado dice «tantos de tantos» cuando hay algo puesto', () => {
  assert.match(laPestana, /const acotado = !!\(st\.q \|\| st\.tipo\)/);
  assert.match(laPestana, /\$\{datos\.total\} de \$\{deTodas\}/);
  assert.match(laPestana, /if \(!acotado\) st\.deTodas = datos\.total/,
    'el total sin acotar se arrastra, para no volver a preguntarlo en cada tecla');
});

test('«no hay ninguno» y «ninguno coincide» no dicen lo mismo', () => {
  assert.match(laPestana, /Ningún documento coincide con lo que buscó/);
  assert.match(laPestana, /Todavía no se ha adjuntado ningún documento/);
  assert.match(laPestana, /acotado\s*\n?\s*\? 'Ningún documento coincide/);
});

/* ------------------------------- lo que ya funcionaba, sin tocar */

test('los cuatro paneles siguen usando la misma pestaña', () => {
  const mapa = app.slice(app.indexOf('const PANEL_DOCUMENTOS'), app.indexOf('const PANEL_HISTORIAL'));
  for (const quien of ['miembros', 'iglesias', 'pastores', 'solicitudes']) {
    assert.match(mapa, new RegExp(`${quien}: \\{`), `falta el panel de ${quien}`);
  }
});

test('sigue mostrando la miniatura, el tipo, la fecha y las observaciones', () => {
  assert.match(laPestana, /esImagen\(d\.archivo\)/, 'una foto se ve como foto');
  assert.match(laPestana, /badge \$\{badgeClass\(d\.tipo\)\}/);
  assert.match(laPestana, /d\.fecha \? fechaCorta\(d\.fecha\) : ''/);
  assert.match(laPestana, /d\.observaciones \? ' — ' \+ esc\(d\.observaciones\) : ''/);
});

test('y se sigue pudiendo agregar, abrir el archivo y entrar a corregirlo', () => {
  assert.match(laPestana, /id="btnDocNuevo"/);
  assert.match(laPestana, /modDocs\.perms\.create \?/, 'el botón solo para quien puede crear');
  assert.match(laPestana, /href="\/uploads\/\$\{esc\(d\.archivo\)\}"/);
  assert.match(laPestana, /if \(ev\.target\.closest\('a'\)\) return;/, '«Ver» abre el archivo y no la ficha');
  assert.match(laPestana, /location\.hash = `#\/m\/\$\{panel\.modulo\}\/edit\/\$\{li\.dataset\.id\}`/);
});

test('si la pestaña no se puede traer, no deja un cuadro roto', () => {
  assert.match(laPestana, /catch \(e\) \{\s*contenedor\.innerHTML = '';/);
});
