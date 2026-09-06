/**
 * LA PESTAÑA DEL HISTORIAL, CUANDO LA FICHA TIENE VEINTE AÑOS ENCIMA.
 *
 * Medido sobre una ficha con 211 anotaciones:
 *
 *   el encabezado decía ...............  «211 registro(s)»
 *   anotaciones que llegaba a mostrar .  200
 *   las 11 más antiguas ...............  no se veían, y nada lo decía
 *   alto de la pestaña ................  17.109 px · 19 pantallas
 *   buscador dentro de la pestaña .....  no había
 *   filtro por tipo ...................  no había
 *   paginación ........................  no había
 *
 * Con catorce anotaciones la pestaña estaba bien resuelta. El problema aparece
 * con el tiempo, que es justo lo que un historial acumula: diecinueve pantallas
 * de desplazamiento en las que había que ir leyendo a ojo hasta topar con lo que
 * se buscaba. Y las once que no se veían eran las MÁS ANTIGUAS, que en un
 * historial son las que cuestan más de reconstruir por otro lado.
 *
 * Lo que cuida este archivo:
 *   · que la pestaña traiga un tramo y diga cuántas hay, en vez de cortar
 *   · que ofrezca traer las que faltan
 *   · que tenga buscador y filtro por tipo, y que los resuelva el servidor —o
 *     no alcanzarían más allá del tramo que está a la vista—
 *   · que buscar o filtrar vuelva al primer tramo
 *   · que el foco no se pierda al repintar por una tecla
 *   · y que «no hay nada» y «nada coincide» no digan lo mismo
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const registry = require('../../server/registry');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const laPestana = app.slice(app.indexOf('const HISTORIAL_DE_A'), app.indexOf('function abrirAnotacion'));

test('el trozo que se revisa es el de la pestaña, y no la página entera', () => {
  assert.ok(laPestana.length > 1500, 'no se encontró el trozo que pinta el historial');
  assert.match(laPestana, /async function renderHistorial/);
});

/* ------------------------------- trae un tramo, y lo dice */

test('trae de a cincuenta, no doscientas de una vez', () => {
  assert.match(laPestana, /const HISTORIAL_DE_A = 50;/);
  assert.match(laPestana, /limit=\$\{st\.cuantas\}/, 'el tramo lo decide el estado, no un número fijo');
  assert.doesNotMatch(laPestana, /limit=200/, 'el tope mudo de 200 ya no está');
});

test('cuando hay más de las que trajo, lo dice y ofrece traerlas', () => {
  assert.match(laPestana, /datos\.rows\.length < datos\.total/,
    'la condición del pie: se muestra cuando falta algo por ver');
  assert.match(laPestana, /Mostrando \$\{datos\.rows\.length\} de \$\{datos\.total\}/);
  assert.match(laPestana, /id="histMas"/);
  assert.match(laPestana, /histMas[\s\S]{0,200}cuantas: st\.cuantas \+ HISTORIAL_DE_A/,
    'y el botón trae el tramo siguiente, sin volver a empezar');
});

/* ------------------------------- buscador y filtro, resueltos en el servidor */

test('la pestaña tiene buscador y filtro por tipo', () => {
  assert.match(laPestana, /id="histBuscar"/);
  assert.match(laPestana, /id="histTipo"/);
});

test('los dos viajan al servidor, no se aplican sobre lo que ya está a la vista', () => {
  // Filtrar en el navegador solo alcanzaría el tramo cargado: buscar algo de
  // hace quince años no lo encontraría nunca.
  assert.match(laPestana, /st\.q \? `&q=\$\{encodeURIComponent\(st\.q\)\}`/);
  assert.match(laPestana, /st\.tipo \? `&f_tipo=\$\{encodeURIComponent\(st\.tipo\)\}`/);
});

test('los tipos del desplegable salen del propio módulo', () => {
  assert.match(laPestana, /modHist\.fields\.find\(\(f\) => f\.name === 'tipo'\)/,
    'para que no haya una lista escrita a mano que se quede vieja');
});

test('el motor acepta ese filtro porque «tipo» es un campo declarado', () => {
  /*
   * El motor solo admite `f_<campo>` de campos que el módulo declara: los demás
   * los ignora en silencio. Si «tipo» se renombrara, el filtro de la pestaña
   * dejaría de acotar y nadie se enteraría, porque seguiría devolviendo todo.
   */
  for (const nombre of ['bitacora', 'historial_iglesias', 'historial_pastores', 'historial_solicitudes']) {
    const def = registry.getModule(nombre);
    const campo = def.fields.find((f) => f.name === 'tipo');
    assert.ok(campo, `${nombre} no declara «tipo»`);
    assert.ok((campo.options || []).length > 0, `${nombre} no ofrece tipos que elegir`);
  }
});

/* ------------------------------- lo que pasa al buscar */

test('buscar o filtrar vuelve al primer tramo', () => {
  // Pedir «las 150 primeras» de una búsqueda recién escrita no tiene sentido.
  assert.match(laPestana, /porTipo\.value[\s\S]{0,60}cuantas: HISTORIAL_DE_A/);
  assert.match(laPestana, /caja\.value\.trim\(\)[\s\S]{0,60}cuantas: HISTORIAL_DE_A/);
});

test('se espera a que deje de teclear, como el buscador del listado', () => {
  assert.match(laPestana, /clearTimeout\(espera\)/);
  assert.match(laPestana, /setTimeout\([\s\S]{0,160}, 280\)/,
    'buscar en cada tecla sería una consulta por letra');
});

test('el foco vuelve al buscador después de repintar', () => {
  assert.match(laPestana, /if \(st\.foco\)[\s\S]{0,120}caja\.focus\(\)/,
    'si no, habría que volver a pinchar la caja después de cada letra');
  assert.match(laPestana, /setSelectionRange\(caja\.value\.length, caja\.value\.length\)/,
    'y el cursor al final, no al principio');
});

test('el encabezado dice «tantas de tantas» cuando hay algo puesto', () => {
  assert.match(laPestana, /const acotado = !!\(st\.q \|\| st\.tipo\)/);
  assert.match(laPestana, /\$\{datos\.total\} de \$\{deTodas\}/);
  assert.match(laPestana, /if \(!acotado\) st\.deTodas = datos\.total/,
    'el total sin acotar se arrastra, para no volver a preguntarlo en cada tecla');
});

test('«no hay nada» y «nada coincide» no dicen lo mismo', () => {
  assert.match(laPestana, /Ninguna anotación coincide con lo que buscó/);
  assert.match(laPestana, /Sin registros en el historial todavía/);
  assert.match(laPestana, /acotado\s*\n?\s*\? 'Ninguna anotación coincide/,
    'y se elige según si hay filtros puestos');
});

/* ------------------------------- lo que ya funcionaba, sin tocar */

test('los cuatro historiales siguen usando la misma pestaña', () => {
  const mapa = app.slice(app.indexOf('const PANEL_HISTORIAL'), app.indexOf('/** Documentos adjuntos a una ficha'));
  for (const quien of ['miembros', 'iglesias', 'pastores', 'solicitudes']) {
    assert.match(mapa, new RegExp(`${quien}: \\{`), `falta el panel de ${quien}`);
  }
  assert.match(mapa, /ordenPor: 'id'/, 'el de una solicitud se sigue ordenando por orden de anotación');
  /*
   * Hasta la v1.433.0 acá se exigía además `automaticasFijas: true` en el panel
   * de una solicitud: era la única pestaña de las cuatro que escondía el lápiz
   * sobre una anotación del sistema, porque su módulo era el único que se
   * negaba a corregirlas. Desde la v1.434.0 la regla es una sola para las
   * cuatro —se corrige dejando escrito lo que decía, y no se elimina— y la
   * decide el ORIGEN de la fila, no en qué pestaña se está parado, así que la
   * pestaña dejó de tener reglas propias (hallazgo SA-05). Lo que hoy se
   * vigila está en lo-que-anoto-el-sistema-se-corrige-pero-no-se-borra.test.js.
   */
  assert.doesNotMatch(mapa, /automaticasFijas/,
    'una pestaña no puede tener su propia regla sobre lo que anotó el sistema');
});

test('lo que se anotó y quién lo hizo se siguen mostrando', () => {
  assert.match(laPestana, /corregida a mano/, 'lo de BM-03');
  assert.match(laPestana, /automático\$\{loHizo \? ' · por ' \+ loHizo : ''\}/, 'lo de BM-04');
});
