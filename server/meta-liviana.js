/**
 * La descripción del sistema, sin lo que no dice nada.
 *
 * Al entrar, la pantalla pide /api/meta: la lista de módulos con todos sus
 * campos, que es de donde se arma sola toda la interfaz. Pesaba 251 KB, y más
 * de la mitad —144 KB— eran propiedades cuyo valor era «no»:
 *
 *     423 veces  optionsRoute: null
 *     434 veces  sugerencias: null
 *     420 veces  mostrarEdad: false
 *     437 veces  calcula: null
 *
 * La pantalla las lee todas como «no», y un campo que directamente NO VIENE se
 * lee exactamente igual de «no». O sea que viajaban ciento cuarenta kilos para
 * no decir nada, y encima había que leerlos: el navegador de un teléfono se
 * demora en eso más que el servidor en armarlo.
 *
 * Así que se van. Con dos cuidados:
 *
 *   · **El cero y el texto se quedan.** `min: 0` es un límite de verdad —«no
 *     puede ser negativo»— y no una ausencia. Solo se van el nulo, el vacío y
 *     el no definido.
 *
 *   · **El «no» que sí dice algo se queda.** `buscador: false` significa «este
 *     campo NO lleva buscador aunque tenga muchas opciones», que es distinto de
 *     no venir, que significa «decida usted según cuántas opciones haya». La
 *     pantalla los distingue (`f.buscador === false`, en public/app.js), así
 *     que ese se manda tal cual.
 *
 * Si algún día otra propiedad necesita ese mismo trato, se agrega a la lista de
 * abajo y ya: el resto sigue funcionando igual.
 */

/** Propiedades donde el «no» es una decisión y no una ausencia. */
const EL_NO_DICE_ALGO = new Set(['buscador']);

/** Un campo tal como sale al navegador: sin lo que no aporta. */
function sinLoQueNoDiceNada(campo) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(campo)) {
    // Nulo, vacío o sin definir: es lo mismo que no venir
    if (valor === null || valor === '' || valor === undefined) continue;
    // El falso, en cambio, se va salvo donde signifique algo por sí mismo
    if (valor === false && !EL_NO_DICE_ALGO.has(clave)) continue;
    limpio[clave] = valor;
  }
  return limpio;
}

module.exports = { sinLoQueNoDiceNada, EL_NO_DICE_ALGO };
