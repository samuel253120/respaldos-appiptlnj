/**
 * LA HOJA LARGA SE IMPRIMÍA HASTA LA PRIMERA PÁGINA, Y NADA MÁS.
 *
 * Apareció midiendo otra cosa: al agregarle a la ficha del miembro la lista de
 * su carpeta (1.196.0), una carpeta de 60 papeles salía en el papel con 12.
 * No era de la sección nueva. Medido sobre una ficha con 60 anotaciones de
 * historial y NINGÚN documento —o sea, sin nada nuevo—:
 *
 *   alto de la hoja en pantalla ......  3.372 px
 *   páginas del PDF .................  1
 *   anotaciones impresas ............  7 de 60
 *   aviso de que faltaban ...........  ninguno
 *
 * La causa: la hoja del certificado necesita medir exactamente una página, y
 * eso se consigue apretando `html, body, .content` al alto del papel con
 * `overflow: hidden`. Esa regla estaba escrita SIN ACOTAR y al final de la hoja
 * de estilos, donde le gana a todo: valía para cada cosa que el sistema
 * imprime. La ficha de una persona, la tramitación de una solicitud y el acta
 * de una reunión son largas por naturaleza, y se cortaban en silencio.
 *
 * Se arrastraba desde que se ajustó la hoja del certificado y no la agarró
 * ninguna prueba, porque las de papel miraban certificados —que son de una
 * página por definición—.
 *
 * Lo que cuida este archivo:
 *   · que la regla de la página única cuelgue de una marca y no valga para todo
 *   · que la marca se encienda solo donde se dibuja un certificado
 *   · que ninguna otra regla de impresión recorte la hoja entera
 *   · y que las tablas largas sigan sabiendo cortarse entre páginas
 *
 * Lo que este archivo NO puede ver, y por eso está en la suite de papel:
 * cuántas hojas salen de verdad y si el certificado sigue usando la página
 * entera. Eso se mide sobre el PDF (`npm run papel`).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

test('la regla de la página única cuelga de una marca, no vale para todo', () => {
  assert.match(css, /html\.hoja-de-una-pagina,\s*\n\s*html\.hoja-de-una-pagina body,\s*\n\s*html\.hoja-de-una-pagina \.content \{[^}]*overflow: hidden;/,
    'las tres cajas se aprietan solo con la marca puesta');
});

test('y no queda ninguna regla de impresión que recorte la hoja entera', () => {
  /*
   * Se revisa TODO lo que está dentro de un `@media print`: una regla que
   * ponga `overflow: hidden` sobre html, body o .content sin condición vuelve
   * a cortar cualquier hoja larga, esté escrita donde esté.
   *
   * La primera versión de esta prueba partía cada bloque por «}» y leía cada
   * pedazo con `split('{')` tomando los dos primeros trozos. En la PRIMERA
   * regla de cada bloque esos dos trozos son «@media print» y el selector, así
   * que el cuerpo nunca se miraba: metí `.content { overflow: hidden; }` justo
   * ahí y la prueba siguió pasando. Ahora las reglas se sacan con una
   * expresión que toma selector y cuerpo de a pares.
   */
  const sospechosas = [];
  const re = /@media print \{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length;
    let hondo = 1;
    for (; i < css.length && hondo > 0; i += 1) {
      if (css[i] === '{') hondo += 1;
      else if (css[i] === '}') hondo -= 1;
    }
    const bloque = css.slice(m.index + m[0].length, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, cuerpo] of bloque.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/overflow\s*:\s*hidden/.test(cuerpo)) continue;
      const partes = selector.split(',').map((x) => x.trim());
      if (partes.some((x) => x === 'html' || x === 'body' || x === '.content')) {
        sospechosas.push(selector.trim().replace(/\s+/g, ' ').slice(0, 120));
      }
    }
  }
  assert.deepEqual(sospechosas, [], `estas recortan cualquier hoja larga:\n${sospechosas.join('\n')}`);
});

test('la marca se enciende solo donde se dibuja un certificado', () => {
  assert.match(app, /classList\.toggle\(\s*\n?\s*'hoja-de-una-pagina', parts\[0\] === 'print' && parts\[1\] === 'certificados'/,
    'y se apaga sola al salir, porque es un toggle con condición y no un add suelto');
  assert.doesNotMatch(app, /classList\.add\('hoja-de-una-pagina'\)/,
    'un add sin su remove deja la marca puesta y corta la hoja siguiente');
});

test('la marca va en la raíz, que es lo que la regla necesita', () => {
  // La regla aprieta `html` también, y una clase en el body no alcanza a la raíz
  assert.match(app, /document\.documentElement\.classList\.toggle\(/);
});

test('se decide en el mismo lugar donde se sueltan los otros estilos de pantalla', () => {
  /*
   * Junto al de la credencial: son el mismo tipo de estilo —uno que solo vale
   * en una pantalla y que fuera de ella hace daño— y conviene que quien toque
   * uno vea el otro.
   */
  const desde = app.indexOf('const seDibujaLaCredencial');
  const hasta = app.indexOf('// Valores para precargar un formulario nuevo');
  assert.ok(desde > -1 && hasta > desde);
  assert.match(app.slice(desde, hasta), /hoja-de-una-pagina/);
});

test('las tablas largas siguen sabiendo cortarse entre páginas', () => {
  assert.match(css, /\.print-generic table\.tramite tr \{ break-inside: avoid; \}/,
    'una anotación partida entre dos hojas no dice nada');
  assert.match(css, /\.print-generic table\.tramite thead \{ display: table-header-group; \}/,
    'y el encabezado se repite en cada hoja, para saber qué columna es cuál');
});
