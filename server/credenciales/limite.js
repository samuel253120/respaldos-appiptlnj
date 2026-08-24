/**
 * Cuántas veces por minuto se puede errar el código de una credencial (punto 9.6).
 *
 * La página de verificación es pública y no pide sesión: es su gracia —quien
 * recibe una credencial escanea el QR y listo— y también su riesgo. Sin un
 * tope, alguien puede probar números de serie a máquina hasta dar con los que
 * existen, y armarse la lista de a quién se le emitió credencial.
 *
 * Contra eso no basta con que el código de autenticidad sea difícil de
 * adivinar. Lo que hace falta es que probar SALGA CARO en tiempo, y eso es lo
 * que hace este archivo: pasado el tope, la dirección espera.
 *
 * SOLO SE COBRAN LOS ERRORES
 *
 * Una verificación que sale bien no gasta nada. Quien llega con un código
 * correcto ya tiene la credencial en la mano: no hay nada que pueda averiguar
 * probando, porque ya lo sabe. El que gasta es el que falla, que es
 * exactamente quien está probando números.
 *
 * Esto importa más de lo que parece. Si se cobrara cada visita, la secretaria
 * que verifica quince credenciales seguidas —y cada página pide además la
 * fotografía, o sea dos peticiones— quedaría esperando por hacer bien su
 * trabajo. Es el mismo problema que tiene el portero de la entrada
 * (server/intentos.js): en una oficina todos salen a internet por la misma
 * dirección, así que para el sistema son una sola persona.
 *
 * Con veinte errores por minuto, quien se equivocó al copiar un número tiene
 * margen de sobra, y un ataque que necesita millones de intentos se vuelve
 * inútil: a veinte por minuto, recorrer los números de un solo año toma meses.
 *
 * Se lleva en memoria, como los intentos de entrada: un reinicio lo borra, y
 * eso está bien —no es algo que un atacante pueda provocar— y evita escribir
 * en la base en cada visita.
 */

/** El tope de fábrica, si nadie lo cambió en Configuración. */
const DE_FABRICA = 20;
/** La ventana que se mira: un minuto. */
const VENTANA_MS = 60 * 1000;
/** Cuántas direcciones distintas se recuerdan antes de hacer limpieza. */
const CUANTAS_CABEN = 5000;

/** Dirección → las horas de sus últimos errores dentro de la ventana. */
const fallos = new Map();

/** El tope que rige ahora, tomado de Configuración. */
function tope() {
  try {
    return require('../ajustes').numero('credencial_intentos_por_minuto', 5, 300) || DE_FABRICA;
  } catch (e) {
    // Si los ajustes todavía no están cargados, el de fábrica
    return DE_FABRICA;
  }
}

/** Los errores de esta dirección que todavía cuentan. */
function recientes(cual, ahora) {
  return (fallos.get(cual) || []).filter((t) => ahora - t < VENTANA_MS);
}

const deQuien = (direccion) => String(direccion || 'sin dirección');

/**
 * ¿Esta dirección está frenada ahora mismo?
 *
 * Devuelve cuántos segundos le faltan para volver a poder preguntar, o cero si
 * puede seguir. No cuenta nada: se pregunta ANTES de mirar en la base, para
 * que a quien está frenado ni siquiera se le busque el número de serie.
 */
function cuantoLeFalta(direccion, ahora = Date.now()) {
  const cual = deQuien(direccion);
  const suyos = recientes(cual, ahora);
  if (suyos.length < tope()) return 0;
  fallos.set(cual, suyos);
  // Cuánto falta para que el más antiguo salga de la ventana
  return Math.max(1, Math.ceil((VENTANA_MS - (ahora - suyos[0])) / 1000));
}

/** Un intento que no calzó: es lo único que se cobra. */
function anotarFallo(direccion, ahora = Date.now()) {
  const cual = deQuien(direccion);
  const suyos = recientes(cual, ahora);
  suyos.push(ahora);
  fallos.set(cual, suyos);
  if (fallos.size > CUANTAS_CABEN) limpiar(ahora);
}

/** Se olvidan las direcciones que ya no tienen ningún error reciente. */
function limpiar(ahora = Date.now()) {
  for (const [cual, cuando] of fallos) {
    const vivos = cuando.filter((t) => ahora - t < VENTANA_MS);
    if (vivos.length) fallos.set(cual, vivos);
    else fallos.delete(cual);
  }
}

/** Para las pruebas: dejar el contador como recién arrancado. */
function olvidarTodo() {
  fallos.clear();
}

module.exports = { cuantoLeFalta, anotarFallo, limpiar, olvidarTodo, tope, DE_FABRICA, VENTANA_MS };
