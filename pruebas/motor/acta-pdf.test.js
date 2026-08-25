/**
 * El acta como PDF: que el texto con formato llegue entero.
 *
 * POR QUÉ SE PRUEBA EL CONVERSOR Y NO EL PDF. Comprobar el archivo terminado
 * —abrirlo, rasterizarlo, mirar los píxeles— es lento y frágil. Lo que de
 * verdad puede fallar es el paso de antes: entender el HTML del editor y
 * partirlo en bloques y trozos. Si eso está bien, dibujarlo es mecánico.
 *
 * Y lo que se cuida es una cosa concreta: QUE NO SE PIERDA TEXTO. En un acta
 * que se archiva y se firma, perder una negrita es un detalle; perder un
 * párrafo, un punto de una lista o el «no» de una frase es otra cosa. Por eso
 * casi todas las pruebas de acá preguntan por el contenido antes que por el
 * formato.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { enBloques, texto } = require('../../server/pdf/textorico-a-pdf');

/** Todo el texto de un HTML, ya pasado por el conversor. */
const todoElTexto = (html) =>
  enBloques(html).map((b) => b.trozos.map((t) => t.texto).join('')).join(' ').replace(/\s+/g, ' ').trim();

// ───────────────────────────────────────────────── no se pierde nada ───

test('un párrafo suelto llega entero', () => {
  assert.equal(todoElTexto('<p>Se abre la reunión a las 19:30 horas.</p>'), 'Se abre la reunión a las 19:30 horas.');
});

test('varios párrafos son varios bloques, y ninguno se pierde', () => {
  const b = enBloques('<p>Primero.</p><p>Segundo.</p><p>Tercero.</p>');
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => x.trozos.map((t) => t.texto).join('')), ['Primero.', 'Segundo.', 'Tercero.']);
});

test('el texto de adentro de una negrita no desaparece con la etiqueta', () => {
  // El riesgo real: quedarse con el formato y botar el contenido.
  assert.equal(todoElTexto('<p>Se acordó <b>comprar</b> dos micrófonos.</p>'), 'Se acordó comprar dos micrófonos.');
});

test('una lista conserva todos sus puntos', () => {
  const b = enBloques('<ul><li>Uno</li><li>Dos</li><li>Tres</li></ul>');
  assert.equal(b.length, 3, 'tres puntos, tres bloques');
  assert.deepEqual(b.map((x) => x.trozos.map((t) => t.texto).join('')), ['Uno', 'Dos', 'Tres']);
});

test('una lista numerada se numera sola, y en orden', () => {
  const b = enBloques('<ol><li>Primero</li><li>Segundo</li><li>Tercero</li></ol>');
  assert.deepEqual(b.map((x) => x.marca), ['1.', '2.', '3.']);
});

test('una lista con viñetas lleva viñeta, no número', () => {
  assert.deepEqual(enBloques('<ul><li>Uno</li><li>Dos</li></ul>').map((x) => x.marca), ['•', '•']);
});

test('las listas anidadas se sangran, cada una a su nivel', () => {
  const b = enBloques('<ul><li>Afuera</li><ul><li>Adentro</li></ul></ul>');
  const adentro = b.find((x) => x.trozos.map((t) => t.texto).join('') === 'Adentro');
  const afuera = b.find((x) => x.trozos.map((t) => t.texto).join('') === 'Afuera');
  assert.ok(adentro.nivel > afuera.nivel, 'la de adentro va más adentro');
});

// ───────────────────────────────────────────────────────── el formato ───

test('la negrita, la cursiva, el subrayado y el tachado se reconocen', () => {
  const [b] = enBloques('<p><b>ene</b><i>ce</i><u>u</u><s>ese</s></p>');
  const como = (t) => [t.negrita, t.cursiva, t.subrayado, t.tachado];
  assert.deepEqual(como(b.trozos[0]), [true, false, false, false]);
  assert.deepEqual(como(b.trozos[1]), [false, true, false, false]);
  assert.deepEqual(como(b.trozos[2]), [false, false, true, false]);
  assert.deepEqual(como(b.trozos[3]), [false, false, false, true]);
});

test('los formatos se acumulan cuando van uno dentro de otro', () => {
  const [b] = enBloques('<p><b>en negrita y <i>también en cursiva</i></b></p>');
  const ambas = b.trozos.find((t) => /cursiva/.test(t.texto));
  assert.ok(ambas.negrita && ambas.cursiva, 'el trozo de adentro lleva los dos');
});

test('«strong» y «em» valen lo mismo que «b» e «i», que es lo que manda el editor', () => {
  const [b] = enBloques('<p><strong>fuerte</strong> y <em>énfasis</em></p>');
  assert.equal(b.trozos.find((t) => t.texto === 'fuerte').negrita, true);
  assert.equal(b.trozos.find((t) => t.texto === 'énfasis').cursiva, true);
});

test('los títulos se distinguen del texto corriente', () => {
  const b = enBloques('<h3>Apertura</h3><p>El desarrollo.</p><h4>Un punto</h4>');
  assert.deepEqual(b.map((x) => x.tipo), ['h3', 'p', 'h4']);
});

test('un salto de línea es un salto, no un párrafo nuevo', () => {
  // Una dirección cortada en dos líneas es un solo párrafo.
  const b = enBloques('<p>Primera línea<br>Segunda línea</p>');
  assert.equal(b.length, 1, 'un bloque, no dos');
  assert.ok(b[0].trozos.some((t) => t.salto), 'con su salto adentro');
});

// ────────────────────────────────────────────── lo que llega mal escrito ───

test('una etiqueta que el sistema no dibuja no se lleva el texto consigo', () => {
  // El saneador ya bota casi todo, pero si algo pasara, el acta tiene que
  // salir igual: sin ese formato, nunca sin ese texto.
  assert.equal(todoElTexto('<p>Antes <span>en el medio</span> después</p>'), 'Antes en el medio después');
  assert.equal(todoElTexto('<table><tr><td>en una tabla</td></tr></table>'), 'en una tabla');
});

test('una etiqueta sin cerrar no se come el resto del acta', () => {
  assert.match(todoElTexto('<p><b>sin cerrar la negrita</p><p>y el párrafo que sigue</p>'), /y el párrafo que sigue/);
});

test('lo que viene escrito con entidades se devuelve a su letra', () => {
  assert.equal(texto('el saldo &lt; 100 &amp; el resto'), 'el saldo < 100 & el resto');
  assert.equal(texto('Ma&ntilde;ana en la Uni&oacute;n'), 'Mañana en la Unión');
  assert.equal(texto('N.&ordm; 7 &mdash; &laquo;el acuerdo&raquo;'), 'N.º 7 — «el acuerdo»');
  assert.equal(texto('&#209;u&#241;ez'), 'Ñuñez');
  assert.equal(texto('&#x41;&#x42;'), 'AB');
});

test('un texto vacío no inventa bloques', () => {
  for (const nada of ['', null, undefined, '<p></p>', '<p>  </p>', '<p><br></p>']) {
    const b = enBloques(nada);
    assert.ok(b.every((x) => x.trozos.some((t) => t.salto || t.texto.trim())) , `${JSON.stringify(nada)} no puede dejar bloques con nada`);
  }
  assert.equal(enBloques('').length, 0);
});

// ─────────────────────────────────────────── un acta de verdad, entera ───

test('UN ACTA COMPLETA: no se pierde ni una palabra por el camino', () => {
  const acta = '<h3>Apertura</h3>'
    + '<p>Se abre la reunión con oración a las <b>19:30</b> horas.</p>'
    + '<p>Se leyó el acta anterior y fue <i>aprobada sin observaciones</i>.</p>'
    + '<h4>Ensayos</h4><p>Se acordó lo siguiente:</p>'
    + '<ul><li>Ensayar los <b>martes</b>.</li><li>Sumar un ensayo extra.</li></ul>'
    + '<blockquote>La hermana Ñuñez pidió dejar constancia.</blockquote>';
  const salio = todoElTexto(acta);
  for (const palabra of ['Apertura', 'oración', '19:30', 'aprobada sin observaciones', 'Ensayos',
    'martes', 'ensayo extra', 'Ñuñez', 'constancia']) {
    assert.match(salio, new RegExp(palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `falta «${palabra}»`);
  }
  const bloques = enBloques(acta);
  assert.equal(bloques.filter((b) => b.tipo === 'li').length, 2, 'los dos puntos de la lista');
  assert.equal(bloques.filter((b) => b.tipo === 'blockquote').length, 1, 'y la cita');
});
