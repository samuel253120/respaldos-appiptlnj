/**
 * Cómo se busca por texto en cualquier listado.
 *
 * Estaba escrito en tres líneas dentro del listado y hacía lo más simple:
 * poner lo tecleado, entero, contra cada campo buscable por separado. Dos
 * cosas que eso no encontraba, medidas sobre 603 fichas cargadas:
 *
 *   · «María González» daba CERO resultados. El nombre está en una columna y
 *     el apellido en otra, así que ninguna contiene el texto completo. Es la
 *     manera en que busca todo el mundo, y cero resultados no se lee como
 *     «busque de otra forma»: se lee como «esa persona no está». El paso
 *     siguiente natural es crearla de nuevo, y ahí nace la ficha repetida.
 *
 *   · «Gonzalez» sin tilde daba CERO, y «González» daba 111. Lo mismo con
 *     «Munoz» contra «Muñoz». En esa base 433 de las 603 fichas —el 72%—
 *     llevan tilde o eñe en el nombre, y en el teléfono casi nadie las
 *     escribe.
 *
 * Ahora se parte lo tecleado en palabras y se exige que CADA UNA aparezca en
 * alguno de los campos buscables, sin importar el orden ni las tildes. Así
 * «María González», «gonzalez maria» y «maria gonzález» encuentran a la misma
 * persona, y buscar una sola palabra sigue funcionando igual que antes.
 *
 * ── Lo que cuesta ──
 *
 * Más que antes, y hay que decirlo: quitar las tildes obliga a mirar el texto
 * de cada fila en vez de compararlo tal cual. Medido:
 *
 *                          603 fichas      10.000 fichas
 *   como era antes          0,18 ms           2,5 ms
 *   una palabra             1,38 ms          23,7 ms
 *   dos palabras            1,45 ms          22,0 ms
 *   seis palabras           2,54 ms          43,6 ms
 *
 * Se paga una vez cuando la persona deja de teclear —la pantalla espera 280 ms
 * antes de preguntar, no busca en cada tecla— así que veinte milisegundos en
 * una organización de diez mil fichas no se notan. Y es lo que vale que el
 * buscador encuentre a la persona: en esa misma base, 433 de las 603 fichas
 * —el 72%— llevan tilde o eñe en el nombre.
 */

/**
 * Las tildes y la eñe, dichas de las dos maneras.
 *
 * `lower()` de SQLite solo baja las letras del inglés: «Á» se queda «Á». Por
 * eso cada letra va con sus dos formas, y el reemplazo se hace antes de bajar
 * a minúsculas.
 *
 * La eñe entra en la lista a propósito. «Muñoz» y «Munoz» son el mismo
 * apellido tecleado por dos personas distintas, y quien lo escribe sin eñe
 * está buscando a la misma señora. Lo que se pierde —distinguir «año» de
 * «ano»— no le importa a un buscador de nombres.
 */
const LETRAS = [
  ['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'], ['ü', 'u'], ['ñ', 'n'],
  ['Á', 'a'], ['É', 'e'], ['Í', 'i'], ['Ó', 'o'], ['Ú', 'u'], ['Ü', 'u'], ['Ñ', 'n'],
];

/**
 * Cuántas palabras se miran.
 *
 * Cada palabra suma una condición por campo buscable, así que quien pegue un
 * párrafo entero armaría una consulta enorme. Con seis alcanza de sobra para
 * un nombre completo con RUT, y lo que sobra se ignora en vez de rechazar la
 * búsqueda: quien pegó de más igual quiere ver algo.
 */
const PALABRAS_QUE_SE_MIRAN = 6;

/** El mismo texto que compara SQLite, hecho acá para el patrón de búsqueda. */
function comoSeCompara(texto) {
  let salida = String(texto == null ? '' : texto);
  for (const [de, a] of LETRAS) salida = salida.split(de).join(a);
  return salida.toLowerCase();
}

/**
 * Todos los campos buscables juntos, sin tildes y en minúsculas, como SQL.
 *
 * Se pegan ANTES de quitar las tildes y no después, y eso no es un detalle:
 * quitarlas campo por campo obliga a SQLite a recorrer catorce reemplazos por
 * cada campo de cada fila. Medido sobre 10.000 fichas y cinco campos
 * buscables: campo por campo, 35 ms; pegados, 8 ms. Los dos dan exactamente lo
 * mismo, porque lo tecleado se parte en palabras y una palabra nunca lleva un
 * espacio adentro: no hay manera de que calce a caballo entre dos campos.
 */
function textoBuscable(campos) {
  const pegados = campos.map((c) => `coalesce("${c}",'')`).join(" || ' ' || ");
  const expr = LETRAS.reduce((dentro, [de, a]) => `replace(${dentro},'${de}','${a}')`, `(${pegados})`);
  return `lower(${expr})`;
}

/** Las palabras que se van a exigir, ya limpias. */
function palabrasDe(texto) {
  return String(texto || '').trim().split(/\s+/).filter(Boolean).slice(0, PALABRAS_QUE_SE_MIRAN);
}

/**
 * La condición de búsqueda y sus parámetros, o null si no hay nada que buscar.
 *
 * Cada palabra tiene que estar en alguna parte de lo buscable, y todas tienen
 * que estar —de ahí el AND—. El orden no importa: «Pérez María» encuentra lo
 * mismo que «María Pérez».
 */
function condicion(texto, campos) {
  const palabras = palabrasDe(texto);
  if (!palabras.length || !campos || !campos.length) return null;

  const donde = textoBuscable(campos);
  const params = palabras.map((palabra) => `%${comoSeCompara(palabra)}%`);
  const sql = palabras.map(() => `${donde} LIKE ?`).join(' AND ');

  return { sql, params };
}

module.exports = { condicion, comoSeCompara, palabrasDe, textoBuscable, PALABRAS_QUE_SE_MIRAN, LETRAS };
