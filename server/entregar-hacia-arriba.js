/**
 * En un traspaso, la plata se entrega HACIA ARRIBA.
 *
 * La organización tiene tres niveles y el dinero sube por ellos: un cuerpo
 * junta las cuotas de sus integrantes y le entrega a su iglesia; cada iglesia
 * aparta el porcentaje que le corresponde a la corporación y se lo traspasa
 * cuando llega el momento. Ese es el trabajo del módulo de Traspasos, y está
 * escrito en su encabezado desde el primer día.
 *
 * Y no se podía hacer. El alcance del sistema dice —con razón— que nadie toca
 * lo que no administra, y una cuenta de la corporación no es de ninguna
 * iglesia, así que quedaba fuera del alcance de toda tesorera local. Medido: el
 * desplegable «Hacia la cuenta» le ofrecía a la tesorera de la Iglesia Central
 * la tesorería de la corporación, con su nombre, y al guardar recibía
 *
 *     403 · Hacia la cuenta: cuenta de tesorería n.º 1 está fuera de lo que
 *           tiene asignado
 *
 * Lo mismo un nivel más abajo: a una tesorera de cuerpo el desplegable le
 * ofrecía 26 cuentas y le servía 1 —la otra cuenta de su propio cuerpo—. Su
 * caso de verdad, entregarle a la iglesia lo recaudado, era de los rechazados.
 *
 * ── LA REGLA ──
 *
 * La cuenta de DESTINO de un traspaso admite una que quien lo anota no alcanza
 * para nada más, con dos condiciones:
 *
 *   · tiene que estar MÁS ARRIBA que la de origen —de un cuerpo a su iglesia o
 *     a la corporación; de una iglesia a la corporación—; y
 *   · si el destino pertenece a una iglesia, tiene que ser LA MISMA del origen.
 *
 * Nunca hacia el lado —de un cuerpo al cuerpo de al lado, de una iglesia a
 * otra— y nunca hacia abajo. Entregar hacia arriba es rendir cuentas; mover
 * plata hacia el lado es disponer de la de otro.
 *
 * Y la excepción es solo eso: EL DESTINO DE UN TRASPASO. No se puede sacar de
 * una cuenta de arriba, ni verla, ni anotarle movimientos a mano en Tesorería.
 * Entregar no es administrar.
 *
 * ── DE QUIÉN ES EL TRASPASO ──
 *
 * De quien lo saca. Su iglesia se toma de la cuenta de origen —ya se tomaba— y
 * desde esta versión su NIVEL también (ver LIBROS en server/tesorerias.js). Sin
 * eso, la tesorera del cuerpo anotaría una entrega que después no puede ver: el
 * traspaso tocaría el nivel general por su destino y el listado se lo
 * escondería. Se comprobó que pasaba, y es exactamente lo que este archivo
 * existe para evitar.
 */

/** Los tres niveles, de abajo hacia arriba. Una cuenta está en uno solo. */
const NIVELES = ['cuerpo', 'iglesia', 'corporacion'];

/** En qué nivel está una cuenta. La cuenta lo dice sola, por sus columnas. */
function nivelDe(cuenta) {
  if (!cuenta) return null;
  if (cuenta.cuerpo_id) return 'cuerpo';
  if (cuenta.iglesia_id) return 'iglesia';
  return 'corporacion';
}

/** ¿Está la segunda más arriba que la primera? */
function masArriba(origen, destino) {
  const a = NIVELES.indexOf(nivelDe(origen));
  const b = NIVELES.indexOf(nivelDe(destino));
  return a >= 0 && b >= 0 && b > a;
}

/**
 * ¿Admite este destino la regla de entregar hacia arriba?
 *
 * Contesta solo por la regla. Que quien lo anota alcance la cuenta de ORIGEN se
 * pregunta aparte y sigue siendo obligatorio: esto no abre un traspaso, le
 * agrega un destino posible a uno que ya podía hacerse.
 */
function admiteComoDestino(origen, destino) {
  if (!origen || !destino) return false;
  if (!masArriba(origen, destino)) return false;
  // Una iglesia distinta no es «arriba», es «al lado de otra congregación»
  if (destino.iglesia_id && String(destino.iglesia_id) !== String(origen.iglesia_id)) return false;
  return true;
}

/**
 * La condición SQL de las cuentas que se le pueden ofrecer a alguien COMO
 * DESTINO por esta regla, además de las que ya alcanza.
 *
 * El desplegable se llena cuando el formulario se abre, antes de que haya una
 * cuenta de origen elegida, así que no puede preguntar por una en concreto: se
 * ofrece todo lo que esté por encima del nivel MÁS BAJO desde el que esa
 * persona puede sacar. Con los tres niveles que hay, eso da exactamente lo
 * mismo que preguntar cuenta por cuenta —comprobado midiendo cuántas de las
 * ofrecidas sirven de verdad—, y evita un desplegable que prometa de más, que
 * es la mitad del problema que esto vino a arreglar.
 *
 * `params` se llena con lo que la consulta necesite, como en server/alcance.js.
 */
function condicionDeDestinos(usuario, db, params) {
  const alcance = require('./alcance');
  const iglesias = alcance.iglesiasDe(usuario);
  const tesorerias = require('./tesorerias');
  const sinLlave = tesorerias.fuera(usuario);

  // A quien no está acotado no le hace falta ninguna excepción: ya alcanza
  // todo, y agregarle una condición acá lo dejaría viendo SOLO lo de arriba.
  if (!iglesias.length && !alcance.cuerposDe(usuario).length && !sinLlave.length) return null;

  // ¿Desde qué nivel puede sacar? El más bajo que alcance manda.
  const puedeSacarDeCuerpo = !sinLlave.includes(tesorerias.CUERPO);
  const puedeSacarDeIglesia = !sinLlave.includes(tesorerias.GENERAL) && iglesias.length > 0;
  if (!puedeSacarDeCuerpo && !puedeSacarDeIglesia) return null;

  const partes = [];
  // Desde un cuerpo se entrega a su iglesia; desde una iglesia, a la corporación
  if (puedeSacarDeCuerpo && iglesias.length) {
    partes.push(`(cuerpo_id IS NULL AND iglesia_id IN (${iglesias.map(() => '?').join(',')}))`);
    params.push(...iglesias);
  }
  if (puedeSacarDeCuerpo || puedeSacarDeIglesia) {
    partes.push('(iglesia_id IS NULL AND cuerpo_id IS NULL)');
  }
  return partes.length ? `(${partes.join(' OR ')})` : null;
}

module.exports = { NIVELES, nivelDe, masArriba, admiteComoDestino, condicionDeDestinos };
