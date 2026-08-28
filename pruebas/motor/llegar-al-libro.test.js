/**
 * Llegar al libro sin pasar por cuarenta y una cuentas.
 *
 * Entre las tarjetas y la tabla va el saldo de cada cuenta, abierto de entrada
 * en el computador. Con doce cuerpos —cada uno con su tesorería y su cuenta de
 * cuotas— son cuarenta y una filas antes de ver un solo movimiento: medido, la
 * primera fila del libro empezaba a los 1.950 px en una pantalla de 950. Y de
 * esas cuarenta y una, CUATRO tenían plata; las otras treinta y siete decían
 * «$ 0» una tras otra.
 *
 * Una cuenta en cero y sin nada agendado no dice nada que no diga el silencio,
 * así que se pliegan aparte. No se esconden —siguen a un clic y se dice cuántas
 * son— porque una cuenta que no aparece en ninguna parte es una cuenta que
 * alguien va a volver a crear.
 *
 * ── QUÉ PRUEBA ESTO Y QUÉ NO ──
 *
 * Todo el arreglo es de pantalla: no cambió una sola línea del servidor. Acá no
 * hay navegador que mida un alto, así que lo que sigue son vistazos al código
 * —que las tres piezas estén y digan lo que tienen que decir— y no una prueba
 * de que el libro empiece arriba. Eso se comprobó midiéndolo: 1.950 px → 770 px
 * en una pantalla de 950, con 6 cuentas a la vista de 41 y las otras 35 a un
 * clic. El barrido móvil lo vuelve a mirar a 390 px en cada versión.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

/* ------------------------------------------------------------ la regla */

/**
 * La misma regla que aplica la pantalla, sacada del propio código.
 *
 * Se lee de app.js en vez de copiarla acá: una regla escrita dos veces es una
 * regla que un día dice dos cosas distintas, y la prueba se quedaría celebrando
 * la copia mientras la pantalla hace otra cosa.
 */
const tieneAlgo = (() => {
  const linea = app.match(/const tieneAlgo = (\(c\) => [^;]+);/);
  assert.ok(linea, 'la pantalla tiene que declarar qué cuenta «tiene algo»');
  // eslint-disable-next-line no-eval
  return eval(linea[1]);
})();

test('una cuenta con plata tiene algo que mostrar', () => {
  assert.equal(tieneAlgo({ saldo: 52370665, agendado: 0 }), true);
  assert.equal(tieneAlgo({ saldo: -1000, agendado: 0 }), true, 'en rojo también, y sobre todo');
});

test('una cuenta en cero pero con algo agendado, también', () => {
  assert.equal(tieneAlgo({ saldo: 0, agendado: 765432 }), true,
    'esa plata llega el día que llega: esconderla sería peor');
});

test('una cuenta en cero y sin nada agendado, no', () => {
  assert.equal(tieneAlgo({ saldo: 0, agendado: 0 }), false);
  assert.equal(tieneAlgo({ saldo: null, agendado: null }), false, 'ni cuando vienen vacíos');
});

/* ------------------------------------------------------- las tres piezas */

test('el listado se parte en las que tienen algo y las que están en cero', () => {
  assert.match(app, /const conAlgo = cuentas\.filter\(tieneAlgo\);/);
  assert.match(app, /const enCero = cuentas\.filter\(\(c\) => !tieneAlgo\(c\)\);/);
});

test('las dos listas se pintan con la misma fila, no con dos copias', () => {
  assert.match(app, /const filaDeCuenta = \(c\) =>/);
  assert.match(app, /conAlgo\.map\(filaDeCuenta\)/);
  assert.match(app, /enCero\.map\(filaDeCuenta\)/);
});

test('las que están en cero no se esconden: se dice cuántas son y se abren', () => {
  /*
   * Se exige la condición junto al bloque, no el bloque a secas: se probó
   * cambiando el `enCero.length ?` por un `false ?` y ninguna prueba se caía,
   * porque el texto seguía escrito ahí mientras la pantalla ya no lo pintaba.
   */
  assert.match(app, /\$\{enCero\.length \? `\s*<details class="saldos-en-cero">/);
  assert.match(app, /Ver las \$\{fmtNumero\(enCero\.length\)\}/);
  assert.match(css, /\.saldos-en-cero \{/);
  assert.match(css, /\.saldos-en-cero\[open\] > summary::before \{ content: "▾"; \}/);
});

test('el rótulo dice cuántas se están viendo de cuántas', () => {
  assert.match(app, /\$\{fmtNumero\(conAlgo\.length\)\} de \$\{fmtNumero\(cuentas\.length\)\} cuentas/);
});

test('si todas están en cero, se dice, en vez de dejar un hueco', () => {
  assert.match(app, /Todas las cuentas están en cero\./);
});

test('el botón de las plegadas alcanza para el dedo', () => {
  // La regla de la 1.140.0: lo que se toca no puede medir menos que un dedo
  assert.match(css, /\.saldos-en-cero > summary \{[^}]*min-height: 28px/);
});

test('y se puede abrir con el teclado, como el listado que lo contiene', () => {
  assert.match(css, /\.saldos-en-cero > summary:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
});
