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

// ────────────────────────────────────── la etiqueta sin cerrar (1.96.1) ───
/*
 * El agujero que estuvo abierto hasta la 1.96.1.
 *
 * El filtro reconoce una etiqueta por su «>» de cierre. Una etiqueta SIN
 * CERRAR no la reconocía, y pasaba entera con sus atributos puestos. Suelta
 * no hacía nada —el navegador descarta una etiqueta incompleta al final del
 * texto—, y por eso nadie lo vio. Pero un acta no se pinta suelta: se pinta
 * envuelta, y el «</div>» que viene después le presta el «>» que le faltaba.
 *
 * Se comprobó en un navegador de verdad: seis de siete variantes creaban un
 * elemento vivo con su manejador de evento, y salían impresas en el acta.
 * La política de contenido impedía que se ejecutaran, pero eso era la segunda
 * muralla haciendo el trabajo de la primera.
 */

/** Cómo lo envuelve la pantalla (public/app.js, campo de tipo richtext). */
const comoSePinta = (guardado) => `<div class="dato-rico">${guardado}</div>`;

test('una etiqueta sin cerrar no sobrevive como etiqueta', () => {
  for (const carga of [
    '<img src=x onerror=alert(1)',
    '<svg onload=alert(1)',
    '<input autofocus onfocus=alert(1)',
    '<details open ontoggle=alert(1)',
    '<iframe src=javascript:alert(1)',
  ]) {
    const limpio = rico.limpiar(carga);
    // Ojo con lo que se comprueba acá: el resultado SÍ contiene las letras
    // «onerror=», y está bien. Escapado, eso es texto que se lee en la
    // pantalla, no un atributo que el navegador vaya a mirar. Lo que no puede
    // quedar es una etiqueta abierta, y eso es lo que se exige.
    assert.doesNotMatch(limpio, /<[a-zA-Z]/, `«${carga}» dejó una etiqueta abierta`);
    assert.match(limpio, /^&lt;/, `«${carga}» tendría que quedar escrito como texto`);
  }
});

test('y tampoco cuando la pantalla la envuelve y le presta el «>» que le falta', () => {
  // Esto es lo que de verdad pasaba: el peligro no estaba en lo guardado, sino
  // en lo guardado MÁS lo que viene detrás.
  const guardado = rico.limpiar('<p>Lo tratado.</p><img src=x onerror=alert(1)');
  const enLaPagina = comoSePinta(guardado);
  assert.doesNotMatch(enLaPagina, /<img/i, 'el «</div>» le completó la etiqueta');
  assert.match(enLaPagina, /&lt;img/, 'la carga tiene que quedar como texto a la vista');
  assert.match(enLaPagina, /<p>Lo tratado\.<\/p>/, 'el texto legítimo tiene que seguir ahí');
});

test('un «<» que la persona escribió de verdad se conserva, escrito como texto', () => {
  // Antes se lo comía en silencio junto con todo lo que viniera detrás hasta
  // el siguiente «>». En un acta que habla de plata, eso es perder una cifra.
  assert.equal(rico.limpiar('<p>el saldo < 100 quedó pendiente</p>'),
    '<p>el saldo &lt; 100 quedó pendiente</p>');
  assert.equal(rico.enPlano(rico.limpiar('<p>2 < 3</p>')), '2 < 3');
});

test('limpiar algo ya limpio lo deja igual', () => {
  // De esto depende que se pueda volver a pasar el filtro por las actas que ya
  // estaban guardadas sin alterar ninguna: la migración del 1.96.1 solo puede
  // tocar las que traen el agujero si el filtro es punto fijo.
  for (const muestra of [
    '<p>Se abre la reunión.</p><ul><li>Primer punto</li><li>Segundo</li></ul>',
    '<h3>Acuerdos</h3><p>Se acuerda <b>por unanimidad</b>.</p>',
    '<blockquote>Palabras del pastor</blockquote><p>Y la <i>oración</i>.</p>',
    '<p>Con &amp; y &lt; escritos como corresponde</p>',
    '<p>Acentos: ñ, á, ü, ¿pregunta?</p>',
    '<p>Uno</p><br><p>Dos</p>',
  ]) {
    const una = rico.limpiar(muestra);
    assert.equal(rico.limpiar(una), una, `«${muestra}» cambia al limpiarlo dos veces`);
  }
});

test('el «<» que escribe el propio filtro no se escapa a sí mismo', () => {
  // Se hace todo en una sola pasada justamente por esto: si el escape fuera un
  // paso aparte, se comería las etiquetas que el filtro acaba de conservar.
  assert.equal(rico.limpiar('<p>hola</p>'), '<p>hola</p>');
  assert.doesNotMatch(rico.limpiar('<b>negrita</b>'), /&lt;/);
});

test('un «<» seguido de espacio tampoco abre etiqueta, ni para bien ni para mal', () => {
  // Es la regla del HTML, y corta por los dos lados: rescata una frase
  // legítima y le quita el disfraz a una carga escrita con espacio.
  assert.equal(rico.limpiar('<p>de 50 < x < 200 personas</p>'),
    '<p>de 50 &lt; x &lt; 200 personas</p>');
  const conEspacio = rico.limpiar('< img src=x onerror=alert(1)>');
  assert.doesNotMatch(conEspacio, /<img/i);
  assert.match(conEspacio, /&lt;/);
});
