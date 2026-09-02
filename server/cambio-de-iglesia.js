/**
 * Un registro que cambia de iglesia.
 *
 * Hay módulos cuyo dueño es la CONGREGACIÓN y no un cuerpo ni una persona: el
 * libro de actas de asamblea y el de la oficina de partes. En ellos, cambiarle
 * la iglesia a un registro no es editar un campo: es sacar una anotación de un
 * libro y meterla en otro. Se lleva el número con ella —que es único dentro de
 * cada iglesia—, deja un hueco en el de origen, y cambia quién puede verla.
 *
 * ── QUÉ SE COMPARTE Y QUÉ NO ──
 *
 * Se comparte DETECTARLO, que es idéntico en los dos y fácil de escribir mal:
 * hay que distinguir «viene sin iglesia porque se está creando» de «se le está
 * cambiando», y leer el valor que queda —lo que llega si llega, lo que ya
 * estaba si no—.
 *
 * NO se comparte la redacción, y es una decisión. «El acta n.º 3 está en el
 * libro de X y va a pasar al de Y» y «El documento n.º REC-010-2026…» no son la
 * misma frase con una palabra cambiada: cambian el sustantivo, su género —«se
 * va con ELLA» / «con ÉL»— y lo que conviene advertir de cada uno. Una función
 * que armara las dos con banderas quedaría más difícil de leer que las dos
 * frases escritas enteras, y este sistema ya tuvo que arreglar dos veces una
 * regla copiada: lo que se copia son las REGLAS, no las palabras.
 *
 * ── LO QUE ESTO NO DICE ──
 *
 * Que el número pueda estar tomado en el libro de destino. Desde la v1.283.0 el
 * motor lo revisa ANTES que el gancho del módulo y rechaza el traslado con su
 * propio aviso, nombrando el libro. Preguntar «¿está seguro?» por un traslado
 * que después no va a poder ocurrir sería peor que rechazarlo.
 */

/**
 * ¿Se está mudando de iglesia? Devuelve las dos, con su nombre, o nulo.
 *
 * `db` se pasa desde el gancho —que ya lo recibe— en vez de pedirlo acá: así
 * esta pieza se puede probar suelta sin levantar la base del sistema.
 */
function laMudanza(data, existing, db) {
  const antes = existing && existing.iglesia_id;
  const despues = data.iglesia_id !== undefined ? data.iglesia_id : antes;
  /*
   * Sin «de dónde» no hay mudanza: un registro que se está creando no viene de
   * ningún libro, y ese es el caso que cubre el primer `!antes`. Se probó
   * poniendo delante un `if (!existing) return null` y no cambiaba nada —lo que
   * quiere decir que sobraba—, así que la intención se dice acá y no se escribe
   * dos veces.
   */
  if (!antes || !despues || Number(antes) === Number(despues)) return null;

  const nombre = (id) => {
    const f = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id);
    return f ? f.nombre : `la iglesia n.º ${id}`;
  };
  return { antes, despues, deDonde: nombre(antes), aDonde: nombre(despues) };
}

module.exports = { laMudanza };
