/**
 * El título de una columna se parte en dos antes que echar la tabla de la
 * pantalla.
 *
 * Los títulos del listado llevaban `white-space: nowrap`, y eso le ponía piso
 * al ancho de la tabla: una columna no podía ser más angosta que su título
 * entero, aunque adentro dijera «Transferencia». Medido en una ventana de
 * 1024 px —un notebook corriente—, con la última columna que es la de imprimir
 * y eliminar:
 *
 *   usuarios ............ escondía 533 px · «CUERPOS QUE ADMINISTRA» (215 px)
 *   servicios ........... escondía 517 px · «TOTAL GENERAL DE ASISTENCIA» (247 px)
 *   integrantes_cuerpo .. escondía 422 px · «¿QUIÉN ENTRA AL CUERPO O GRUPO?» (284 px)
 *   traspasos ........... escondía 224 px · «FECHA DEL TRASPASO ▼» (191 px)
 *   … quince listados, 4.070 px escondidos, y en TODOS la columna más ancha
 *     era un título y no un dato.
 *
 * Con los títulos partiéndose: Traspasos cabe entero de 1024 px para arriba,
 * quedan doce listados que piden arrastre y lo escondido baja a 888 px. De
 * 1280 px para arriba el cambio además gana alto —la fila de Traspasos pasa de
 * 100 px a 68 px— porque los títulos anchos le robaban sitio a las columnas de
 * texto y las obligaban a partirse a ellas.
 *
 * Lo que pasa en el navegador se comprueba en el navegador: la prueba de humo
 * recorre los listados y mira el estilo YA CALCULADO de cada título, así que
 * agarra un `nowrap` que vuelva por donde sea. Acá se fija lo que se puede leer
 * del código, que es más rápido y dice dónde está la regla.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const leer = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const css = leer('public/styles.css');
const app = leer('public/app.js');
const humo = leer('pruebas/humo.js');

/** El bloque de una regla de la hoja de estilos, sin su comentario. */
function laRegla(selector) {
  const desde = css.indexOf(`\n${selector} {`);
  assert.ok(desde > 0, `no está la regla «${selector}»`);
  return css.slice(desde, css.indexOf('}', desde));
}

test('el título de una columna del listado se puede partir', () => {
  const regla = laRegla('table.grid th');
  assert.match(regla, /white-space:\s*normal/, 'tiene que decirlo, y no quedarse en el valor de fábrica');
  assert.doesNotMatch(regla, /white-space:\s*nowrap/);
});

test('y una palabra sola que no quepa se parte antes que salirse', () => {
  assert.match(laRegla('table.grid th'), /overflow-wrap:\s*break-word/);
});

test('la flecha del orden va pegada a la última palabra', () => {
  /*
   * Con un espacio normal, apretada la columna, la flecha se bajaba sola a la
   * línea siguiente y quedaba flotando debajo del título.
   */
  const desde = app.indexOf("const arrow = st.sort === c ?");
  assert.ok(desde > 0, 'no está la flecha del orden');
  const trozo = app.slice(desde, desde + 300);
  assert.match(trozo, /&#160;<span class="arrow">/, 'con espacio duro delante');
  assert.doesNotMatch(trozo, /\$\{esc\(lbl\)\} \$\{arrow\}/, 'y no separada por un espacio normal');
});

test('las celdas que se leen como número siguen sin partirse', () => {
  /*
   * Un RUT o un monto partido en dos líneas no se lee. Lo que se soltó son los
   * TÍTULOS, que se repiten una sola vez arriba; los datos que necesitan una
   * línea la siguen teniendo.
   */
  assert.match(css, /table\.grid td\.cifra \{[^}]*white-space: nowrap/);
  assert.match(css, /table\.grid th\.col-mini, table\.grid td\.col-mini \{[^}]*white-space: nowrap/);
});

test('la prueba de humo mira el estilo calculado, no la hoja', () => {
  /*
   * Es lo único que agarra un `nowrap` que vuelva desde una media query, desde
   * una regla más específica o desde otra hoja: leer styles.css no lo vería.
   */
  assert.match(humo, /getComputedStyle\(th\)\.whiteSpace\.startsWith\('nowrap'\)/);
  assert.match(humo, /titulosQueNoSeParten/);
});
