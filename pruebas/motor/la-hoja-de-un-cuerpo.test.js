/**
 * La hoja de un cuerpo o grupo, que no salía.
 *
 * Dieciocho módulos del sistema se imprimían y Cuerpos / Grupos no estaba entre
 * ellos, teniendo impresos TRES DE SUS PROPIOS HIJOS:
 *
 *   la directiva del cuerpo ................... sí
 *   sus actas de reunión ...................... sí
 *   las evaluaciones de su gente .............. sí
 *   la ficha de la iglesia · la del pastor .... sí, desde la 1.235.0
 *   la hoja del cuerpo ........................ no · no hay botón
 *
 * Es el mismo hallazgo de la 1.235.0, que destapó que la hoja de la iglesia y
 * la del pastor estaban escritas y completas y no salían porque sus módulos no
 * llevaban `printable: true`: sin esa línea el botón no aparece y el código que
 * arma la hoja no se ejecuta jamás.
 *
 * Y como la de la iglesia, no sale con los datos a secas: sale con LO QUE TIENE
 * HOY —su gente, con su estado y desde cuándo—, que es la pregunta con la que
 * se pide en papel.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { getModule, allModules } = require('../../server/registry');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

test('el módulo está marcado como imprimible', () => {
  assert.equal(getModule('cuerpos').printable, true,
    'sin esta línea el botón no aparece y el código que arma la hoja no corre nunca');
});

test('y sus tres hijos, que ya se imprimían, siguen imprimiéndose', () => {
  /*
   * Eran la prueba de que el hueco era del cuerpo y no del sistema: lo que
   * cuelga de él salía en papel y él no.
   */
  for (const hijo of ['directivas', 'actas_reuniones', 'evaluaciones_integrantes']) {
    assert.equal(getModule(hijo).printable, true, hijo);
  }
});

test('la hoja se pide por la MISMA ruta que pinta el panel de su ficha', () => {
  /*
   * Armada aparte, un día el papel diría una cosa y la pantalla otra. Y esa
   * ruta ya pide el permiso de Integrantes de Cuerpos, así que la hoja hereda
   * la comprobación en vez de estrenar una propia.
   */
  const desde = app.indexOf('async function viewPrint(');
  const trozo = app.slice(desde, app.indexOf('\n}', app.indexOf('let sheet;', desde)));
  /*
   * El `.catch` se exige EN LA MISMA LÍNEA. Pedirlo suelto no probaba nada:
   * el trozo tiene otros cinco —las ayudas, el historial, la carpeta— y
   * quitarle el suyo a esta línea no hacía fallar la prueba. Se vio al
   * romperlo a propósito.
   */
  assert.match(trozo,
    /suGente = await api\('GET', `\/cuerpos\/\$\{id\}\/integrantes`\)\.catch\(\(\) => null\)/,
    'lo que no se pueda traer no puede impedir imprimir, que es la regla de las ayudas');
});

test('y lo que la hoja lleva de más llega con nombre, no por posición', () => {
  /*
   * Eran cinco cosas en fila y la sexta habría dejado una llamada de siete
   * argumentos donde nadie puede ver cuál es cuál. Van SIETE desde la 1.269.0
   * —el plan de pagos de una deuda—, que es justamente lo que esta prueba
   * cuida: la lista puede crecer mientras cada cosa siga llegando con nombre.
   */
  assert.match(app, /printGenerico\(m, row, \{ [\w, ]+ \}\)/,
    'con nombre y no por posición');
  assert.match(app, /printGenerico\(m, row, \{[^}]*\bsuGente\b[^}]*\bsuPlan\b[^}]*\}\)/,
    'y las dos últimas que se agregaron siguen ahí');
  assert.match(app, /function printGenerico\(m, row, extras = \{\}\)/);
});

test('la hoja dice quiénes lo componen, y no solo cuántos son', () => {
  /*
   * Un «49 integrantes» a secas no sirve para entregar un cuerpo, igual que un
   * «3 entregas» no servía en la ficha de una persona.
   */
  const desde = app.indexOf('const susIntegrantes = suGente ?');
  assert.ok(desde > 0, 'la sección tiene que existir');
  const trozo = app.slice(desde, desde + 2000);
  assert.match(trozo, /Quiénes lo componen/);
  assert.match(trozo, /Desde<\/th>/, 'y desde cuándo pertenece cada uno');
  assert.match(trozo, /dirige el cuerpo/, 'y quién lo dirige, que es lo primero que se busca');
  assert.match(trozo, /no inscrito\(a\) en la membresía/);
});

test('los retirados no salen, y el RUT tampoco', () => {
  /*
   * La hoja dice quiénes lo componen HOY, y su número ya está dicho arriba. El
   * RUT es un dato reservado con su propia llave, y una hoja impresa es
   * justamente por donde se escapa.
   */
  const desde = app.indexOf('const gente = ((suGente && suGente.integrantes) || [])');
  const trozo = app.slice(desde, app.indexOf('</table>` : \'\'}` : \'\';', desde));
  assert.match(trozo, /\.filter\(\(g\) => g\.estado !== 'Retirado'\)/);
  assert.doesNotMatch(trozo, /g\.rut/, 'la ruta lo trae, y la hoja no lo imprime');
});

test('y la hoja se pinta de verdad, que es lo que faltaba', () => {
  /*
   * La sección puede estar escrita y no ponerse en la página: es exactamente
   * lo que le pasaba a la hoja entera antes de la 1.235.0.
   */
  // Dentro de `printGenerico`, que no es la única función que arma una hoja
  // con esa clase: la constancia de un bien ajeno usa la misma.
  const laFuncion = app.indexOf('function printGenerico(');
  const trozo = app.slice(laFuncion, app.indexOf('\n}', app.indexOf('<div class="doc-pie">', laFuncion)));
  assert.match(trozo, /\$\{susIntegrantes\}/);
  assert.ok(trozo.indexOf('${susIntegrantes}') > trozo.indexOf('${loSuyo}'),
    'las cifras primero y el detalle después, como en la hoja de una persona');
});

test('las cifras del cuerpo van en el mismo cuadro que las de la iglesia', () => {
  /*
   * Contestan la misma pregunta —qué hay hoy, al momento de imprimir— y esta
   * hoja ya dice el día arriba. Dos cuadros para lo mismo es peor.
   */
  const desde = app.indexOf('if (suGente && suGente.resumen) {');
  const trozo = app.slice(desde, desde + 1400);
  assert.match(trozo, /cifras\.push/);
  assert.match(trozo, /Cuota mensual/);
  assert.match(trozo, /sin monto definido/, 'y dice cuando falta, como el panel y el cumplimiento');
});

test('la suite de impresos revisa esta hoja', () => {
  /*
   * Lo único que prueba de verdad que la hoja sale es imprimirla en un
   * navegador. Sin esta línea, todo lo de arriba comprueba el código y no el
   * papel.
   */
  const impresos = fs.readFileSync(path.join(__dirname, '../documentos-impresos.js'), 'utf8');
  assert.match(impresos, /nombre: 'la hoja de un cuerpo', modulo: 'cuerpos'/);
  assert.match(impresos, /la hoja de un cuerpo dice quiénes lo componen/);
});

test('y siguen siendo los mismos módulos imprimibles, más éste', () => {
  /*
   * Marcar imprimible un módulo es abrirle una hoja a datos que quizá no
   * deberían salir en papel. Que la lista se mueva sin que nadie se entere es
   * lo que esta prueba atrapa.
   */
  const cuales = allModules().filter((m) => m.printable).map((m) => m.name).sort();
  assert.deepEqual(cuales, [
    'actas_asambleas', 'actas_reuniones', 'asistencias', 'certificados', 'credenciales',
    'cuerpos', 'deudas', 'directivas', 'documentos', 'evaluaciones_integrantes', 'iglesias',
    'inventarios', 'miembros', 'no_miembros', 'pastores', 'servicios', 'solicitudes',
    'tesoreria', 'traspasos',
  ]);
});
