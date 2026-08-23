/**
 * El texto con formato de las actas.
 *
 * Lo que una persona escribe en un acta lo leen todas las demás. Si se
 * guardara tal cual, quien escribe podría meter instrucciones que se
 * ejecutaran en el navegador de quien lee. Por eso antes de guardar se deja
 * SOLO lo que sirve para dar formato.
 *
 * La regla es una lista blanca y ningún atributo: sin atributos no hay
 * direcciones, ni estilos, ni manejadores que revisar. Estas pruebas insisten
 * en las formas de colarse que se ven de verdad —etiquetas partidas,
 * mayúsculas mezcladas, comentarios— más que en el caso obvio.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rico = require('../../server/textorico');

/** No queda ni rastro de instrucciones ni de atributos. */
function estaLimpio(html) {
  const t = String(html || '');
  assert.doesNotMatch(t, /<script/i, 'quedó un <script>');
  assert.doesNotMatch(t, /on\w+\s*=/i, 'quedó un manejador de eventos');
  assert.doesNotMatch(t, /javascript:/i, 'quedó una dirección javascript:');
  assert.doesNotMatch(t, /<\w+[^>]+=/, 'quedó una etiqueta con atributos');
}

test('el formato que sirve se conserva', () => {
  const limpio = rico.limpiar('<p>Se acordó <b>comprar</b> las <i>sillas</i>.</p><ul><li>Uno</li></ul>');
  assert.match(limpio, /<b>comprar<\/b>/);
  assert.match(limpio, /<i>sillas<\/i>/);
  assert.match(limpio, /<li>Uno<\/li>/);
});

test('un guion escondido en el acta no sobrevive', () => {
  const sucio = rico.limpiar('<p>Hola</p><script>alert(1)</script><p>Chao</p>');
  estaLimpio(sucio);
  assert.match(sucio, /Hola/);
  assert.match(sucio, /Chao/);
  assert.doesNotMatch(sucio, /alert/, 'se lleva también lo que había adentro');
});

test('ni escrito con mayúsculas mezcladas', () => {
  estaLimpio(rico.limpiar('<ScRiPt>alert(1)</ScRiPt>'));
  estaLimpio(rico.limpiar('<IMG SRC=x onerror="alert(1)">'));
});

test('los atributos se van, aunque la etiqueta se quede', () => {
  const limpio = rico.limpiar('<p onclick="alert(1)" style="color:red">Texto</p>');
  estaLimpio(limpio);
  assert.match(limpio, /Texto/);
  assert.match(limpio, /<p>/);
});

test('los enlaces quedan como texto, que en un acta se lee igual', () => {
  const limpio = rico.limpiar('<a href="javascript:alert(1)">apretar acá</a>');
  estaLimpio(limpio);
  assert.match(limpio, /apretar acá/);
});

test('lo que trae cosas adentro se va con contenido y todo', () => {
  for (const etiqueta of ['style', 'iframe', 'object', 'embed', 'svg', 'math', 'template']) {
    const limpio = rico.limpiar(`<p>antes</p><${etiqueta}>veneno</${etiqueta}><p>después</p>`);
    estaLimpio(limpio);
    assert.doesNotMatch(limpio, /veneno/, `${etiqueta} dejó su contenido`);
    assert.match(limpio, /antes/);
    assert.match(limpio, /después/);
  }
});

test('los comentarios no sirven de escondite', () => {
  estaLimpio(rico.limpiar('<p>Hola</p><!-- <script>alert(1)</script> -->'));
});

test('un texto que quedó sin nada adentro no se guarda', () => {
  assert.equal(rico.limpiar('<p></p>'), null);
  assert.equal(rico.limpiar('<p>&nbsp;</p>'), null);
  assert.equal(rico.limpiar('   '), null);
  assert.equal(rico.limpiar(''), null);
  assert.equal(rico.limpiar(null), null);
  assert.equal(rico.limpiar('<script>alert(1)</script>'), null, 'si era puro veneno, no queda nada');
});

test('el texto en plano sirve para buscar y para resumir', () => {
  assert.equal(rico.enPlano('<p>Se acordó <b>comprar</b></p><p>las sillas</p>'), 'Se acordó comprar las sillas');
  assert.equal(rico.enPlano('<ul><li>Uno</li><li>Dos</li></ul>'), 'Uno Dos');
  assert.equal(rico.enPlano(null), '');
});
