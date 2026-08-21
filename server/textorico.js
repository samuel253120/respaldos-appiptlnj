/**
 * Texto enriquecido: negrita, cursiva, listas y títulos.
 *
 * Se guarda como HTML, y eso obliga a una precaución: lo que una persona
 * escribe en un acta lo van a leer todas las demás, así que si se guardara
 * tal cual, quien escribe podría meter código que se ejecute en el navegador
 * de quien lee. Por eso, antes de guardar, se deja SOLO lo que sirve para dar
 * formato y se bota todo lo demás.
 *
 * La regla es corta a propósito: una lista blanca de etiquetas y ningún
 * atributo. Sin atributos no hay direcciones, ni estilos, ni manejadores de
 * eventos que revisar; no queda por dónde colarse. Los enlaces se escriben
 * como texto, que en un acta se lee igual de bien.
 */

/** Lo único que se conserva de lo que llega. */
const PERMITIDAS = new Set([
  'p', 'br', 'div',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'ul', 'ol', 'li',
  'h3', 'h4',
  'blockquote',
]);

/** Las que además se llevan su contenido, no solo su etiqueta. */
const CON_TODO_ADENTRO = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);

function limpiar(html) {
  if (html == null) return null;
  let texto = String(html);
  if (!texto.trim()) return null;

  // Fuera lo que trae contenido peligroso adentro, con contenido y todo
  for (const etiqueta of CON_TODO_ADENTRO) {
    texto = texto.replace(new RegExp(`<${etiqueta}\\b[\\s\\S]*?</${etiqueta}\\s*>`, 'gi'), '');
    texto = texto.replace(new RegExp(`<${etiqueta}\\b[^>]*>`, 'gi'), '');
  }
  texto = texto.replace(/<!--[\s\S]*?-->/g, '');

  // De las demás, se conserva la etiqueta pelada si está permitida
  texto = texto.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b[^>]*>/g, (todo, cierre, nombre) => {
    const etiqueta = nombre.toLowerCase();
    if (!PERMITIDAS.has(etiqueta)) return '';
    if (cierre) return `</${etiqueta}>`;
    return etiqueta === 'br' ? '<br>' : `<${etiqueta}>`;
  });

  // Un texto que quedó sin nada adentro no se guarda
  const soloTexto = texto.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return soloTexto ? texto : null;
}

/** El texto sin formato, para buscar y para resumir. */
function enPlano(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\/(p|div|li|h3|h4|blockquote)\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { limpiar, enPlano, PERMITIDAS };
