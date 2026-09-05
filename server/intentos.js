/**
 * El portero de la entrada: cuántas veces seguidas se puede errar la clave.
 *
 * Sin esto, alguien puede probar contraseñas a máquina —miles por minuto—
 * hasta dar con una. Con esto, a los pocos errores la puerta se cierra un
 * rato, y ese rato crece si insisten. Probar se vuelve inútil.
 *
 * Se cuenta por dos lados a la vez, porque cada uno tapa un agujero del otro:
 *
 *   por RUT       frena a quien ataca una cuenta concreta desde donde sea.
 *                 Cinco errores y a esperar.
 *   por dirección frena a quien va probando RUT tras RUT desde un mismo lugar,
 *                 que al contar solo por RUT nunca llegaría al tope. Acá el
 *                 tope es mucho más alto —veinte—, porque toda la iglesia sale
 *                 por el mismo wifi y nadie tiene por qué quedar afuera por el
 *                 despiste del de al lado.
 *
 * La espera por RUT se deja corta a propósito. Es la contrapartida de este
 * método: alguien podría errar cinco veces adrede sobre un RUT ajeno para
 * dejar a esa persona afuera. Que sean minutos y no horas hace que esa maña
 * moleste poco y que el ataque por fuerza bruta siga sin servir.
 *
 * Se lleva en memoria: si el sistema se reinicia, se empieza de nuevo. Es lo
 * razonable —un reinicio no es algo que un atacante pueda provocar— y evita
 * escribir en la base en cada intento fallido.
 */

/**
 * A los cuántos errores se cierra, y por cuánto rato.
 *
 * Por RUT se es estricto: cinco errores sobre una misma cuenta no son un
 * despiste, y al dueño de esa cuenta lo frena poco esperar un minuto.
 *
 * Por dirección se es mucho más ancho, y hay una razón: en la iglesia todos
 * salen a internet por el mismo wifi, así que para el sistema son la misma
 * dirección. Si ahí se cerrara a los cinco errores, el hermano que no se
 * acuerda de su clave dejaría afuera a los demás. Con veinte, un ataque que
 * va probando RUT tras RUT sigue topando, y nadie queda fuera por el error
 * del de al lado.
 */
/**
 * De cuántos errores hablamos se fija en la pantalla de configuración, con un
 * solo número: a los cuántos se cierra la primera vez. Los demás peldaños
 * salen de ese —el doble y el triple, con esperas más largas—, y el de la
 * dirección va cuatro veces más arriba por lo del wifi compartido.
 *
 * Con el valor de fábrica (5) queda exactamente la escala de siempre:
 * 5 · 10 · 15 por RUT, y 20 · 40 · 60 por dirección.
 */
function escalaDe(llave) {
  const base = require('./ajustes').numero('acceso_intentos', 3, 20);
  const cuantos = llave.startsWith('rut:') ? base : base * 4;
  const espera = esperaMaxima();
  return [
    { fallos: cuantos * 3, minutos: espera },
    { fallos: cuantos * 2, minutos: Math.max(1, Math.round(espera / 3)) },
    { fallos: cuantos, minutos: Math.max(1, Math.round(espera / 15)) },
  ];
}

/**
 * La espera más larga, que también se fija en la configuración.
 *
 * Igual que con la cantidad de errores, se pide UN número y los peldaños de
 * abajo salen de él. Con el valor de fábrica (15) queda exactamente la escala
 * de siempre: 1, 5 y 15 minutos. Pedir tres números por separado invitaría a
 * dejarlos incoherentes —la espera corta más larga que la larga— sin que nada
 * lo impida.
 */
function esperaMaxima() {
  return require('./ajustes').numero('acceso_espera_minutos', 1, 120);
}

/**
 * Cuánto se recuerda un intento fallido suelto: el doble de la espera larga.
 *
 * Va atado a lo mismo y no aparte porque son la misma idea vista de dos
 * lados. Si se olvidara antes de que termine la espera, quien insiste podría
 * limpiar su cuenta simplemente esperando un poco menos de lo que le tocaba.
 */
function memoriaMs() {
  return esperaMaxima() * 2 * 60 * 1000;
}

const registro = new Map(); // llave → { fallos, ultimo, hasta }

function ahora() {
  return Date.now();
}

function ficha(llave) {
  let f = registro.get(llave);
  if (f && ahora() - f.ultimo > memoriaMs()) {
    registro.delete(llave); // hace rato que no lo intenta: se le olvida
    f = null;
  }
  if (!f) registro.set(llave, (f = { fallos: 0, ultimo: ahora(), hasta: 0 }));
  return f;
}

/**
 * CONTRA QUÉ SE CUENTA: contra la cuenta, no contra cómo se tecleó su RUT.
 *
 * Para BUSCAR la cuenta, la entrada normaliza el RUT —`rutUtil.canonico()`
 * deja «5.111.111-7», «5111111-7» y «51111117» en una sola forma—. Para
 * CONTAR los errores, acá se usaba el texto tal como venía, apenas recortado
 * de espacios. Así que la misma cuenta tenía tantos cupos de cinco intentos
 * como maneras hubiera de escribir su RUT.
 *
 * MEDIDO en la v1.416.0, la misma cuenta escrita de seis maneras, cinco
 * intentos cada una:
 *
 *   "5.111.111-7" ...  401 401 401 401 429   cupo propio
 *   "5111111-7" .....  401 401 401 401 429   cupo propio
 *   "51111117" ......  401 401 401 401 429   cupo propio
 *   "5-111-111-7" ...  401 401 401 401 429   cupo propio
 *   ──
 *   "5.111.111-7 " ..  429 429 429 429 429   el mismo cupo (lo iguala el trim)
 *   "5.111.111-7\t" ..  429 429 429 429 429   el mismo cupo
 *
 * Dieciséis pruebas de contraseña donde el diseño quiere cinco. Las dos
 * últimas ya caían en el mismo cupo: la normalización existía y se quedaba
 * corta, que es distinto de no estar.
 *
 * Se normaliza acá, en la llave, y no en cada puerta: así lo heredan las tres
 * que cuentan —entrar, preguntar por la pregunta secreta y recuperar— sin que
 * ninguna tenga que acordarse.
 */
const rutUtil = require('./rut');

function comoSeLlama(quien) {
  const texto = String(quien == null ? '' : quien).trim();
  if (!texto) return '';
  // La puerta de compatibilidad: las cuentas viejas todavía entran con su
  // correo mientras no se les asigne un RUT (ver server/auth.js).
  if (texto.includes('@')) return texto.toLowerCase();
  // Y lo que no es un RUT que el sistema entienda se cuenta tal cual, en
  // minúsculas: no se puede dejar sin contar lo que no se supo normalizar.
  return (rutUtil.canonico(texto) || texto).toLowerCase();
}

/**
 * Las llaves con que se mira a quien intenta entrar.
 *
 * SIN RUT se cuenta SOLO por dirección, y eso tiene un uso concreto: la puerta
 * de «¿Olvidó su contraseña?» pregunta cuál es la pregunta secreta de una
 * cuenta, y eso no es un error de nadie —no se puede contar contra el RUT que
 * se está preguntando, porque entonces preguntar por una cuenta ajena la
 * dejaría a ella cerrada—. Lo que sí hay que frenar es a quien pregunta por
 * cientos de RUT desde el mismo lugar, y para eso está el conteo por dirección.
 */
function llaves(rut, ip) {
  const suyas = [`ip:${ip || '?'}`];
  const limpio = comoSeLlama(rut);
  if (limpio) suyas.unshift(`rut:${limpio}`);
  return suyas;
}

/**
 * ¿Le toca esperar? Devuelve los minutos que faltan, o 0 si puede intentar.
 */
function esperaQueLeFalta(rut, ip) {
  let falta = 0;
  for (const llave of llaves(rut, ip)) {
    const f = registro.get(llave);
    if (!f || !f.hasta) continue;
    falta = Math.max(falta, f.hasta - ahora());
  }
  return falta > 0 ? Math.ceil(falta / 60000) : 0;
}

/** Se equivocó: se anota y, si ya son demasiadas, se cierra un rato. */
function fallo(rut, ip) {
  for (const llave of llaves(rut, ip)) {
    const f = ficha(llave);
    f.fallos++;
    f.ultimo = ahora();
    const tope = escalaDe(llave).find((e) => f.fallos >= e.fallos);
    if (tope) f.hasta = ahora() + tope.minutos * 60000;
  }
}

/** Entró bien: se le borra la cuenta de errores. */
function acierto(rut, ip) {
  for (const llave of llaves(rut, ip)) registro.delete(llave);
}

/** Cuántos le quedan antes de que se cierre, para poder avisarle. */
function intentosQueLeQuedan(rut, ip) {
  let menos = Infinity;
  for (const llave of llaves(rut, ip)) {
    const escala = escalaDe(llave);
    const primero = escala[escala.length - 1].fallos;
    const f = registro.get(llave);
    menos = Math.min(menos, primero - (f ? f.fallos : 0));
  }
  return Math.max(0, menos === Infinity ? 0 : menos);
}

// Cada media hora se barren los que quedaron olvidados, para que la memoria
// no crezca sola con el tiempo.
try {
  setInterval(() => {
    const limite = ahora() - memoriaMs();
    for (const [llave, f] of registro) {
      if (f.ultimo < limite && (!f.hasta || f.hasta < ahora())) registro.delete(llave);
    }
  }, 30 * 60 * 1000).unref();
} catch (e) {
  /* en un script suelto puede no haber temporizadores; da igual */
}

module.exports = { esperaQueLeFalta, fallo, acierto, intentosQueLeQuedan, comoSeLlama };
