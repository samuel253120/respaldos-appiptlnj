/**
 * Un campo de referencia avisa sobre el campo que lleva el dato.
 *
 * Cuando la lista es larga, un campo de referencia no se dibuja como un
 * desplegable sino como un BUSCADOR: una caja con un campo de texto a la vista
 * —donde se escribe— y el número elegido en un campo oculto, que es el que
 * lleva el nombre del campo. Lo que dependa de ese campo lo escucha por su
 * nombre: `[name="cuenta_origen_id"]`.
 *
 * El buscador avisaba de «cambió» sobre la CAJA DE TEXTO, que es la hermana del
 * campo oculto y no su madre. El aviso subía por otra rama y no llegaba nunca.
 * Con pocas opciones —cuando sí era un desplegable— funcionaba, que es lo que
 * lo hacía difícil de ver.
 *
 * Costó dos cosas. Los selectores que dependen de otro campo tuvieron que
 * ponerse a escuchar el formulario ENTERO para rodearlo, y su comentario deja
 * escrito el rodeo. Y el saldo de la cuenta de origen de un traspaso —una
 * función escrita, completa, que consulta el saldo, lo pinta en rojo si es
 * negativo y hasta contempla a quien no alcanza la llave de los montos— tenía
 * su hueco en pantalla SIEMPRE VACÍO. Comprobado disparando el aviso a mano
 * sobre el campo oculto: apareció al instante, «Saldo disponible hoy:
 * $ -600.001».
 *
 * Lo que pasa en el navegador se comprueba en el navegador: la prueba de humo
 * abre el formulario de un traspaso, elige una cuenta y exige que el saldo
 * aparezca. Acá se fija lo que se puede leer del código, que es dónde va el
 * aviso: si vuelve a la caja de texto, esto lo dice antes de que nadie note que
 * un aviso dejó de aparecer.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const humo = fs.readFileSync(path.join(__dirname, '../humo.js'), 'utf8');

/** El cuerpo de una función de public/app.js, para mirarla sola. */
function laFuncion(nombre) {
  const desde = app.indexOf(`function ${nombre}(`);
  assert.ok(desde > 0, `no está la función ${nombre}`);
  const hasta = app.indexOf('\n}', desde);
  return app.slice(desde, hasta);
}

test('el buscador de referencias avisa sobre el campo oculto, no sobre el de texto', () => {
  const buscador = laFuncion('initRefBuscador');
  assert.match(buscador, /oculto\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/,
    'el aviso tiene que salir del campo que lleva el dato y el nombre');
  assert.doesNotMatch(buscador, /texto\.dispatchEvent\(new Event\('change'/,
    'sobre la caja de texto, el aviso sube por otra rama y no llega al campo');
});

test('y vaciarlo también avisa', () => {
  /*
   * Sin esto, lo que dependa del campo se queda mostrando lo del registro que
   * ya no está elegido: el saldo de una cuenta que se acaba de quitar.
   */
  const buscador = laFuncion('initRefBuscador');
  const alQuitar = buscador.slice(buscador.indexOf("quitar.addEventListener('click'"));
  assert.match(alQuitar, /oculto\.dispatchEvent/, 'el botón de vaciar avisa igual que el de elegir');
});

test('el otro buscador del sistema ya lo hacía bien, y sigue igual', () => {
  /*
   * `initSelectBuscable` —el de los libros de la Biblia— avisa sobre el campo
   * oculto desde siempre. Eran dos buscadores hermanos haciendo lo mismo de dos
   * maneras distintas, y solo uno funcionaba.
   */
  assert.match(laFuncion('initSelectBuscable'), /oculto\.dispatchEvent/);
});

test('el saldo de la cuenta de origen se cuelga de la caja, no del campo oculto', () => {
  /*
   * El campo oculto vive DENTRO de la caja del buscador. Colgando el aviso de
   * él, el saldo quedaba arriba de la casilla donde se escribe, metido entre
   * medio de sus partes.
   */
  const fn = laFuncion('mostrarSaldoOrigen');
  assert.match(fn, /select\.closest\('\.refbuscar'\) \|\| select/);
  assert.match(fn, /caja\.parentNode\.insertBefore\(marca, caja\.nextSibling\)/);
});

test('y el saldo se comprueba de verdad en la prueba de humo', () => {
  /*
   * Esto es lo que pasa en el navegador y no se puede comprobar leyendo código:
   * que el aviso llegue. Si esa comprobación se cae de la prueba de humo, este
   * archivo se queda mirando texto y no protege nada.
   */
  assert.match(humo, /#\/m\/traspasos\/new/);
  assert.match(humo, /el saldo de la cuenta de origen no aparece al elegirla/);
  assert.match(humo, /el saldo de la cuenta de origen no queda debajo de su campo/);
});

test('los selectores dependientes siguen escuchando el formulario, que es su rodeo', () => {
  /*
   * No se les quita: escuchar el formulario cubre además el caso del
   * desplegable corriente, y su comentario explica por qué está así. Lo que se
   * fija acá es que el rodeo siga en pie, porque ahora que el aviso sale del
   * campo correcto podría parecer que sobra.
   */
  const desde = app.indexOf('function initSelectoresDependientes(');
  const dependientes = app.slice(desde, desde + 3500);
  assert.match(dependientes, /form\.addEventListener\('change'/);
  assert.match(dependientes, /el aviso de «cambió» se dispara en la CAJA/,
    'el comentario que explica el rodeo es lo que evita que alguien lo quite sin saber');
});
