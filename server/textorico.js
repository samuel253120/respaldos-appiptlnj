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

  /*
   * De las demás se conserva la etiqueta pelada si está permitida, y CUALQUIER
   * «<» que no forme una etiqueta completa se escribe como texto.
   *
   * Lo segundo tapa un agujero que estuvo abierto hasta la 1.96.1. Esta
   * expresión reconoce una etiqueta por su «>» de cierre, así que una etiqueta
   * SIN CERRAR no la reconocía y pasaba entera, con sus atributos y todo:
   *
   *     <img src=x onerror=…        (sin el «>» final)
   *
   * Suelta no hacía nada —el navegador descarta una etiqueta incompleta al
   * final del texto—, y por eso no se veía. Pero el acta no se pinta suelta:
   * se pinta envuelta, `<div class="dato-rico">…</div>`, y ese «</div>» de
   * más abajo le prestaba el «>» que le faltaba. Ahí nacía un <img> de
   * verdad, con su manejador de evento puesto. Comprobado: seis de siete
   * variantes creaban un elemento vivo, y salían impresas en el acta.
   *
   * La política de contenido del sistema impedía que se ejecutaran, y sigue
   * ahí; pero era la segunda muralla haciendo el trabajo de la primera, y el
   * día que ese HTML salga del navegador —un correo, un exportador— no habría
   * ninguna. Se cierra donde corresponde: acá.
   *
   * Va en la MISMA pasada y no en otra aparte, a propósito: los «<» que esta
   * función escribe (los de las etiquetas que sí se conservan) no se vuelven a
   * mirar, así que no hay forma de escaparlos dos veces por descuido.
   *
   * Y el nombre de la etiqueta tiene que EMPEZAR POR LETRA, como manda el HTML.
   * Aceptando también números se perdía texto en silencio: en
   *
   *     <p>el saldo < 100 quedó pendiente</p>
   *
   * el «< 100 quedó pendiente</p>» calzaba entero como una etiqueta llamada
   * «100», no estaba en la lista blanca, y se borraba con todo lo de adentro;
   * del acta quedaba «el saldo » y la cifra desaparecía. Exigiendo la letra,
   * ese «<» ya no parece una etiqueta, cae en la rama de arriba y se guarda
   * como lo que es: un signo de menor que alguien escribió.
   *
   * Por lo mismo el «<» tiene que ir PEGADO al nombre, sin espacio en medio.
   * Es la regla del HTML —el navegador solo abre una etiqueta cuando al «<»
   * le sigue una letra de inmediato—, y acá arregla el caso hermano del
   * anterior: en «de 50 < x < 200 personas», el «< x …>» se tragaba el resto
   * de la frase. Además cierra la puerta al revés: un «< img src=x onerror=…>»
   * escrito con espacio ya no se toma por etiqueta, que es exactamente lo que
   * hace el navegador con él.
   */
  texto = texto.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|</g, (todo, cierre, nombre) => {
    if (nombre === undefined) return '&lt;'; // un «<» suelto: es texto, no etiqueta
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
