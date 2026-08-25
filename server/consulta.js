/**
 * Lo que viene después del «?» en una dirección, leído de una sola manera.
 *
 * Cada dato llega como UN texto, siempre. Suena obvio y no lo era: una
 * dirección puede traer la misma clave dos veces —`?q=a&q=b`— y ahí Express
 * entregaba una lista donde el resto del sistema esperaba un texto. Nadie la
 * escribe así a propósito, pero pasa: un formulario que se manda dos veces, un
 * enlace mal armado, un buscador automático recorriendo el sitio.
 *
 * Y el sistema respondía con un error 500 en TODOS los listados: a una lista
 * no se le puede pedir `.trim()`, y a la base no se le puede pasar una lista
 * donde va un valor. No filtraba nada —el aviso solo entrega un número de
 * referencia— pero cualquiera con sesión dejaba sin listados a los demás
 * escribiendo una dirección a mano.
 *
 * Se resuelve acá, en el único lugar por donde pasa todo, y no en los treinta y
 * dos sitios que leen un dato de la dirección: si mañana se agrega el treinta y
 * tres, ya viene resuelto.
 *
 * DOS DECISIONES, Y POR QUÉ
 *
 * Repetida una clave, vale LA PRIMERA. Es lo mismo que devuelve el navegador
 * cuando se le pregunta por ella, así que la pantalla y el servidor entienden
 * la misma dirección de la misma manera. Y no puede abrir de más: los filtros
 * solo acotan, y a qué iglesia alcanza cada persona se decide aparte.
 *
 * Se usa el analizador simple de Node y no el que trae Express por omisión. El
 * de Express entiende una sintaxis de listas y objetos anidados —`?a[b]=c`—
 * que este sistema no usa en ninguna parte, y que a cambio deja mandar un
 * objeto donde se espera un texto. Con el simple, un `?f_estado[x]=1` queda
 * como una clave llamada «f_estado[x]», que no es ningún campo declarado y se
 * ignora sin más.
 */
const querystring = require('querystring');

/**
 * Convierte la parte de la dirección en datos, con un texto por clave.
 *
 * Se le entrega a Express con `app.set('query parser', leerLaConsulta)`.
 */
function leerLaConsulta(cadena) {
  const crudo = querystring.parse(cadena || '');
  // Sin prototipo, para que una clave llamada «__proto__» sea solo una clave y
  // no toque nada de lo que hay detrás.
  const limpio = Object.create(null);
  for (const clave of Object.keys(crudo)) {
    const valor = crudo[clave];
    if (Array.isArray(valor)) limpio[clave] = valor.length ? valor[0] : '';
    else limpio[clave] = valor;
  }
  return limpio;
}

module.exports = { leerLaConsulta };
