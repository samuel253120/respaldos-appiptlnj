/**
 * LA HOJA DEL MIEMBRO SALE CON SU HISTORIAL.
 *
 * Medido antes: la hoja impresa de una miembro con catorce anotaciones llevaba
 * sus datos y «Lo que se le ha entregado», y de su historial no decía nada. El
 * módulo declaraba `printable: false` y pedir la hoja de una anotación daba 404.
 *
 * Y las tres veces que se necesita en papel son las mismas de siempre: cuando
 * se entrega una congregación y hay que dejar dicho quién es cada quien, cuando
 * se resuelve un caso de disciplina o de reconocimiento y hay que llevarlo a la
 * reunión, y cuando alguien pide su constancia. Se copiaba a mano de la
 * pantalla.
 *
 * No se imprime una anotación suelta —una línea en una hoja con membrete no es
 * nada—: lo que hace falta en papel es la historia de la persona, en su ficha.
 *
 * Lo que cuida este archivo:
 *   · que la hoja del miembro traiga su historial, con quién dejó cada línea
 *   · que una anotación del sistema corregida a mano lo diga EN EL PAPEL, con
 *     lo que decía antes: en una constancia que alguien firma, un texto
 *     reescrito que se presenta como registro del sistema no puede pasar callado
 *   · que cuando no cabe todo lo diga, como hace la pestaña en pantalla
 *   · que si el historial no se puede traer la hoja se imprima igual
 *   · y que el módulo siga sin imprimirse por su cuenta
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
const laHoja = app.slice(app.indexOf('function printGenerico'), app.indexOf('Importación de datos desde archivos CSV'));

test('el trozo que se revisa es el de la hoja genérica', () => {
  /*
    * El techo subió en la 1.255.0: la hoja genérica estrenó la sección de la
    * gente de un cuerpo. Es una guardia de que el recorte SEA la función y no
    * medio archivo, no una medida de cuánto puede crecer.
    */
  // El tope es una red por si el corte se corriera y arrastrara código ajeno,
  // no una medida de cuánto puede crecer la hoja: subió en la 1.266.0 al
  // explicarse ahí por qué el encabezado dice de qué registro es, y en la
  // 1.401.0 al explicarse por qué el texto con formato se imprime pintado.
  assert.ok(laHoja.length > 1000 && laHoja.length < 24000, `el recorte mide ${laHoja.length}`);
  assert.match(laHoja, /print-sheet print-generic/);
});

/* ------------------------------- la hoja la lleva */

test('las tres fichas que se entregan en papel llevan su historial en la hoja', () => {
  // La del miembro desde la 1.185.0; la de una iglesia y la de un pastor desde
  // la 1.202.0, que es cuando les tocó.
  assert.match(app, /const HISTORIAL_EN_LA_HOJA = \['miembros', 'iglesias', 'pastores'\]/);
});

test('se pide con el campo del panel y con tope', () => {
  const laRuta = app.slice(app.indexOf('let suHistorial = null;'), app.indexOf('let sheet;'));
  assert.match(laRuta, /HISTORIAL_EN_LA_HOJA\.includes\(name\)/);
  assert.match(laRuta, /f_\$\{panelHist\.campo\}=\$\{id\}&limit=\$\{HISTORIAL_EN_EL_PAPEL\}/);
  assert.match(laRuta, /sort=fecha&dir=desc/, 'de lo más nuevo a lo más viejo, como en pantalla');
  assert.match(app, /const HISTORIAL_EN_EL_PAPEL = 200;/);
});

test('la hoja se imprime igual si el historial no se puede traer', () => {
  const laRuta = app.slice(app.indexOf('let suHistorial = null;'), app.indexOf('let sheet;'));
  assert.match(laRuta, /MOD\[panelHist\.modulo\]/,
    'sin permiso sobre la bitácora, ni se pide: es la misma guardia que usan las ayudas');
  assert.match(laRuta, /\.catch\(\(\) => null\)/,
    'y si la petición falla, se sigue sin esa parte en vez de quedarse sin hoja');
  assert.match(laHoja, /const historial = suHistorial \? `/,
    'sin historial, el trozo es vacío y la hoja sale con lo demás');
});

/* ------------------------------- qué dice cada línea */

test('cada línea dice la fecha, qué pasó y quién la dejó', () => {
  assert.match(laHoja, /<th>Fecha<\/th><th>Qué pasó<\/th><th>Registrado por<\/th>/);
  assert.match(laHoja, /esc\(h\.registrado_por \|\| ''\)/,
    'el nombre llega al papel, que es lo que se saldó en BM-04');
  assert.match(laHoja, /<b>\$\{esc\(h\.tipo \|\| ''\)\}\.<\/b>/);
});

test('una anotación corregida a mano lo dice en el papel, con lo que decía', () => {
  assert.match(laHoja, /h\.texto_original[\s\S]{0,220}el sistema había anotado/,
    'una constancia no puede presentar como registro del sistema un texto reescrito');
  assert.match(laHoja, /corregida a mano\$\{h\.corregido_por \? ' por ' \+ esc\(h\.corregido_por\) : ''\}/);
});

test('cuando no cabe todo, la hoja lo dice', () => {
  assert.match(laHoja, /filas\.length < cuantas/);
  assert.match(laHoja, /Se imprimen las \$\{filas\.length\} anotaciones más recientes, de \$\{cuantas\}/);
  assert.match(laHoja, /El resto está en su ficha/);
});

test('y cuando cabe entero, dice cuántas son y desde cuándo', () => {
  assert.match(laHoja, /\$\{cuantas\} anotación\(es\), desde el/);
  assert.match(laHoja, /filas\[filas\.length - 1\]\.fecha/,
    'la más antigua es la última, porque vienen de la más nueva a la más vieja');
});

test('una ficha sin anotaciones no deja una tabla vacía', () => {
  assert.match(laHoja, /'Sin anotaciones todavía\.'/);
  assert.match(laHoja, /\$\{filas\.length \? `\n?\s*<table class="grid tramite">/,
    'la tabla solo se dibuja si hay algo que poner en ella');
});

/* ------------------------------- dónde va, y cómo se corta en papel */

test('va al final, debajo de los datos y de lo entregado', () => {
  /*
   * Esta prueba exigía que `${historial}` viniera pegado a `${entregas}`, y en
   * la 1.196.0 se metió entre los dos la lista de la carpeta. Lo que decía la
   * prueba y lo que quería decir no eran lo mismo: lo que importa es que el
   * historial sea LO ÚLTIMO —es lo que más ocupa y lo que se lee al final—, no
   * quién viene justo antes. Se afloja lo que no importaba y se aprieta lo que
   * sí: nada se dibuja entre el historial y el pie de la hoja.
   */
  assert.match(laHoja, /\$\{historial\}\s*\n\s*<div class="doc-pie">/,
    'es lo último que se lee y lo que más ocupa');
  const cuerpo = laHoja.slice(laHoja.indexOf('${membreteDelDocumento()}'));
  assert.ok(cuerpo.indexOf('${entregas}') < cuerpo.indexOf('${historial}'),
    'y lo entregado sigue yendo por encima');
});

test('reusa la tabla que ya sabe cortarse entre páginas', () => {
  assert.match(laHoja, /class="grid tramite"/);
  assert.match(css, /\.print-generic table\.tramite tr \{ break-inside: avoid; \}/,
    'para que una anotación no quede partida entre dos hojas');
});

/* ------------------------------- lo que NO se hizo, y por qué */

test('el módulo sigue sin imprimirse por su cuenta', () => {
  const def = registry.getModule('bitacora');
  assert.ok(!def.printable,
    'una anotación suelta en una hoja con membrete no es una constancia de nada: '
    + 'lo que hace falta en papel es la historia de la persona, y va en su ficha');
});

test('el historial de una iglesia y el de un pastor ya no quedan para su turno', () => {
  /*
   * Esta prueba decía lo contrario: que se dejaban fuera a propósito, no por
   * olvido. Les tocó en la 1.202.0 y ahora dice lo que hay. El mapa de paneles
   * sigue siendo el mismo de donde salen el módulo y el campo, para que no
   * haya dos listas que un día digan cosas distintas.
   */
  assert.match(app, /const HISTORIAL_EN_LA_HOJA = \['miembros', 'iglesias', 'pastores'\];/);
  const mapa = app.slice(app.indexOf('const PANEL_HISTORIAL'), app.indexOf('/** Documentos adjuntos a una ficha'));
  assert.match(mapa, /iglesias: \{ modulo: 'historial_iglesias', campo: 'iglesia_id'/);
  assert.match(mapa, /pastores: \{ modulo: 'historial_pastores', campo: 'pastor_id'/);
});

test('la hoja de una solicitud sigue imprimiendo su tramitación por su lado', () => {
  // Esa ya la imprimía, con su propio impresor: no se toca ni se duplica.
  assert.match(app, /function printSolicitud/);
  const suHoja = app.slice(app.indexOf('function printSolicitud'), app.indexOf('function printGenerico'));
  assert.match(suHoja, /<h3>Tramitación<\/h3>/);
});
