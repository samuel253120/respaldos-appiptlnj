/**
 * Cuántos mensajes por hora puede mandar una persona.
 *
 * ── POR QUÉ HACE FALTA ──
 *
 * El módulo tiene un tope de quinientos POR ENVÍO, que era el freno pensado: no
 * despertar a media organización de un clic. No había ninguno para la cantidad
 * de envíos, y medido en la revisión del módulo salieron veinticinco mensajes
 * urgentes seguidos a la misma persona en ochenta y cinco milésimas de segundo.
 *
 * Por separado, las dos reglas del módulo están bien. Juntas dejan un hueco:
 * el aviso de un mensaje NO se puede apagar en la campanita —a propósito, porque
 * quien lo manda no tiene acuse de recibo— así que una cuenta descuidada, o
 * robada, puede llenar una campanita que nadie puede silenciar.
 *
 * ── CÓMO SE CUENTA ──
 *
 * Solo los envíos que SALIERON. Uno rechazado por falta de título, o la pregunta
 * de «le va a llegar a mucha gente», no gastan nada: si gastaran, contestar que
 * sí costaría dos, y quien se equivoca al escribir pagaría por equivocarse. Es
 * el mismo criterio del tope de la página de verificación, que solo cobra los
 * errores porque son los que delatan a quien está probando.
 *
 * Se lleva en memoria, como los intentos de entrada y el tope de verificación:
 * un reinicio lo borra, y eso está bien —no es algo que nadie pueda provocar— y
 * evita escribir en la base en cada envío.
 *
 * ── DÓNDE SE APLICA ──
 *
 * En la ruta, no dentro de `enviar`. Un tope por tiempo es cosa de la puerta:
 * cuida de que a esa puerta no la golpeen a máquina. Adentro está lo que hace al
 * mensaje —a quién alcanza, qué le falta, a cuántos va— que es lo que tiene que
 * valer venga por donde venga.
 */

/** El tope de fábrica, si nadie lo cambió en Configuración. */
const DE_FABRICA = 10;
/** La ventana que se mira: una hora. */
const VENTANA_MS = 60 * 60 * 1000;
/** Cuántas personas se recuerdan antes de hacer limpieza. */
const CUANTAS_CABEN = 2000;

/** Persona → las horas de sus últimos envíos dentro de la ventana. */
const envios = new Map();

/** El tope que rige ahora, tomado de Configuración. */
function tope() {
  try {
    return require('../ajustes').numero('mensajes_por_hora', 1, 200) || DE_FABRICA;
  } catch (e) {
    return DE_FABRICA; // si los ajustes no están cargados todavía, el de fábrica
  }
}

/** Los envíos de esta persona que todavía cuentan. */
function recientes(usuarioId, ahora) {
  return (envios.get(usuarioId) || []).filter((t) => ahora - t < VENTANA_MS);
}

/**
 * Cuántos segundos le faltan para poder mandar otro. Cero si puede ahora.
 *
 * El número sale del más viejo de los que cuentan: en cuanto ese salga de la
 * ventana, queda un lugar libre. Sirve para decir cuánto falta en vez de un «no»
 * a secas.
 */
function cuantoLeFalta(usuarioId, ahora = Date.now()) {
  const suyos = recientes(usuarioId, ahora);
  if (suyos.length < tope()) return 0;
  const elMasViejo = Math.min(...suyos);
  return Math.max(1, Math.ceil((VENTANA_MS - (ahora - elMasViejo)) / 1000));
}

/** Queda anotado un envío que salió. */
function anotarEnvio(usuarioId, ahora = Date.now()) {
  const suyos = recientes(usuarioId, ahora);
  suyos.push(ahora);
  envios.set(usuarioId, suyos);

  // Limpieza: sin esto, un sistema con muchas cuentas guarda una entrada por
  // cada una para siempre
  if (envios.size > CUANTAS_CABEN) {
    for (const [quien, horas] of envios) {
      if (!horas.some((t) => ahora - t < VENTANA_MS)) envios.delete(quien);
    }
  }
  return suyos.length;
}

/** Cuántos lleva mandados dentro de la ventana. */
function cuantosLleva(usuarioId, ahora = Date.now()) {
  return recientes(usuarioId, ahora).length;
}

/** Lo que se le dice a quien se topa con el tope. */
function comoSeExplica(segundos) {
  const minutos = Math.ceil(segundos / 60);
  const espera = minutos <= 1 ? 'un minuto' : `${minutos} minutos`;
  return `Ya mandó ${tope()} mensajes en la última hora. Puede mandar otro en ${espera}. `
    + 'El aviso de un mensaje no se puede apagar, así que mandarlos seguidos llena una campanita '
    + 'que nadie puede silenciar.';
}

/** Para las pruebas: se olvida de todo. */
function olvidarTodo() {
  envios.clear();
}

module.exports = { cuantoLeFalta, anotarEnvio, cuantosLleva, comoSeExplica, olvidarTodo, DE_FABRICA, VENTANA_MS };
