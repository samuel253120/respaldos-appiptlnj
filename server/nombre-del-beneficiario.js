/**
 * EL NOMBRE DE QUIEN RECIBIÓ LA AYUDA, CUANDO LA FICHA LO CORRIGE.
 *
 * Cada ayuda guarda el nombre del beneficiario en una columna propia. No se
 * escribe a mano: lo copia el sistema de la ficha elegida al guardar. Esa
 * columna es la que se ve en el listado de Ayudas Sociales, la que titula cada
 * ayuda en cualquier parte del sistema, y por la que se busca.
 *
 * Se copiaba UNA vez y no se volvía a mirar. Medido: a «Carmen Soto» se le
 * entregaron tres ayudas; se le corrigió el apellido en su ficha a «Sotto» y
 * las tres siguieron diciendo «Soto». El apellido no se corrigió por capricho
 * —estaba mal escrito—, y el listado seguía mostrando el error, ahora en tres
 * lugares y sin que nadie pudiera arreglarlo desde ahí: el campo es de solo
 * lectura, a propósito.
 *
 * ── POR QUÉ SE REESCRIBE LA COPIA Y NO SE MUESTRA EL NOMBRE VIVO ──
 *
 * Mostrar el nombre vivo y dejar la copia quieta parece más limpio —no
 * reescribe nada— y fue lo primero que se pensó. No alcanza: el título de un
 * registro lo arma el motor con las COLUMNAS GUARDADAS (ver `displayOf` y
 * `etiquetasDe` en server/crud.js), porque las etiquetas de un listado entero
 * se resuelven en una sola consulta. Un nombre calculado al leer llegaría al
 * listado y no al título, y la misma ayuda diría dos nombres distintos según
 * dónde se la mire, que es peor que el problema que se venía a arreglar.
 *
 * Reescribir la copia, en cambio, llega de una vez a todo: al listado, al
 * título, a la búsqueda, a la planilla y a lo que se imprime.
 *
 * ── QUÉ NO SE PIERDE ──
 *
 * La constancia de a nombre de quién se entregó no vive solo en esta columna:
 * las ayudas están entre los módulos vigilados por la bitácora del sistema
 * (ver server/bitacora.js), que guarda cada versión con su fecha y su autor.
 * Y las ayudas de antes del registro —las que llevan un nombre escrito a mano
 * y no apuntan a ninguna ficha— NO se tocan nunca: ahí ese texto es lo único
 * que hay, y es la constancia de verdad.
 *
 * El refresco no pasa por el guardado normal de la ayuda, a propósito: no es
 * un cambio de la ayuda —nadie decidió nada sobre ella— sino una copia que se
 * pone al día. Anotarlo en la bitácora llenaría el historial de tres, diez o
 * cuarenta entradas por cada apellido corregido, y ninguna diría nada.
 */

/**
 * Cómo se escribe el nombre de una ficha en la ayuda. Una sola vez acá: si el
 * hook que copia y el refresco lo armaran cada uno por su lado, un día
 * diferirían por un espacio y las ayudas quedarían «cambiando» sin motivo.
 */
function comoSeLlama(ficha) {
  if (!ficha) return null;
  return `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
}

/**
 * Pone al día el nombre en las ayudas de esta persona.
 *
 * `deDonde` es de qué registro sale: 'miembros' o 'no_miembros'. Solo escribe
 * cuando el nombre cambió de verdad, así corregir un teléfono no toca ni una
 * fila. Devuelve cuántas ayudas quedaron al día, que es lo que se prueba.
 */
function ponerAlDiaElNombre(db, deDonde, id) {
  const columna = deDonde === 'miembros' ? 'miembro_id' : 'no_miembro_id';
  const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde}" WHERE id = ?`).get(id);
  const nombre = comoSeLlama(ficha);
  /*
   * Sin nombre no se escribe nada, y cubre los dos casos de una vez: la ficha
   * que ya no está —`comoSeLlama` devuelve null— y la que existe con el nombre
   * vacío, que el formulario no deja crear pero una planilla mal armada o una
   * migración sí. Los dos terminarían dejando el beneficiario en blanco, y eso
   * es cambiar «no sabemos si el nombre está al día» por «no sabemos a quién se
   * le entregó», que es mucho peor.
   *
   * Un guardián aparte para la ficha que no existe sería código muerto: no hay
   * cómo llegar a la consulta con una y sin el otro.
   */
  if (!nombre) return 0;
  const r = db
    .prepare(
      `UPDATE ayudas_sociales SET beneficiario = ?
        WHERE "${columna}" = ? AND COALESCE(beneficiario, '') <> ?`
    )
    .run(nombre, id, nombre);
  return r.changes;
}

module.exports = { comoSeLlama, ponerAlDiaElNombre };
