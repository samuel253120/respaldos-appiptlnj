/**
 * Lo mismo anotado dos veces.
 *
 * Dos personas de la misma oficina anotan la compra del domingo, o alguien la
 * anota dos veces sin darse cuenta. El sistema guardaba las dos sin decir nada
 * y la cuenta quedaba con el doble descontado; el descuadre no se ve hasta que
 * se cuenta la plata. Medido: un egreso de $250.000 guardado dos veces dejaba la
 * cuenta $500.000 abajo, y un traspaso de $400.000 anotado tres veces movía
 * $1.200.000 entre dos cuentas que nunca los movieron.
 *
 * Acá vive lo que las dos preguntas —la de Tesorería y la de Traspasos— tienen
 * en común, para que no puedan discrepar: cómo se compara un texto escrito por
 * una persona, y cuándo NO hay que volver a preguntar. QUÉ hace que dos
 * registros sean «el mismo» lo decide cada módulo, porque no es lo mismo en una
 * tabla que en otra.
 *
 * Las dos preguntan, no bloquean: dos compras iguales el mismo día existen, y
 * dos traspasos iguales también —una cuota que se paga en dos partes—. Quien
 * confirma manda.
 */

/**
 * El texto de un concepto, como se compara.
 *
 * Sin tildes, sin mayúsculas y sin espacios de más, porque quien anota dos veces
 * la misma cosa no la escribe dos veces igual: «Sillas para el salón» y «sillas
 * PARA el SALON» son el mismo gasto y hay que reconocerlas.
 *
 * En JavaScript y no en la consulta: el LOWER de SQLite solo baja las letras del
 * inglés —«SALÓN» y «salón» le parecen distintos— y es justo la diferencia que
 * hay que pasar por alto.
 */
const comoSeCompara = (t) =>
  String(t == null ? '' : t)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Un monto como se lee acá. */
const enPesos = (n) => require('./formato').enPlata(n);

/**
 * ¿Sigue siendo el mismo registro que ya estaba guardado?
 *
 * Al CORREGIR uno que ya existe solo hay que preguntar si cambió algo de lo que
 * lo hace «el mismo». Si no, el repetido ya estaba ahí antes de abrir la ficha y
 * alguien ya dijo que eran dos: volver a preguntarlo cada vez que se le arregla
 * una coma es ruido, y el ruido enseña a confirmar sin leer, que es lo contrario
 * de lo que la pregunta busca.
 *
 * `campos` dice qué mirar y cómo: 'texto' se compara con `comoSeCompara`,
 * 'numero' por su valor —«250000» y 250000 son el mismo monto—, 'fecha' por sus
 * diez primeros caracteres, y lo demás como texto a secas.
 */
function seguiIgual(existing, datos, campos) {
  if (!existing) return false;
  return campos.every(([nombre, como]) => {
    const antes = existing[nombre];
    const ahora = datos[nombre];
    if (como === 'texto') return comoSeCompara(antes) === comoSeCompara(ahora);
    if (como === 'numero') return Number(antes) === Number(ahora);
    if (como === 'fecha') return String(antes).slice(0, 10) === String(ahora).slice(0, 10);
    return String(antes == null ? '' : antes) === String(ahora == null ? '' : ahora);
  });
}

/**
 * Con qué se distingue de este el que ya estaba: cuándo se anotó, quién lo hizo
 * y si tiene comprobante. Es lo que hace falta para contestar la pregunta sin
 * salir de la pantalla.
 */
function senasDe(otro) {
  const comoSeLee = require('./fechas').comoSeLee;
  return [
    otro.created_at ? `anotado el ${comoSeLee(String(otro.created_at).slice(0, 10))}` : null,
    otro.quien ? `por ${otro.quien}` : null,
    otro.comprobante ? 'con comprobante' : null,
  ].filter(Boolean).join(', ');
}

module.exports = { comoSeCompara, enPesos, seguiIgual, senasDe };
