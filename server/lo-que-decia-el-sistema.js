/**
 * Lo que el sistema había anotado, cuando alguien lo corrige a mano.
 *
 * Los tres historiales —el de una persona, el de una iglesia, el de un
 * pastor— mezclan dos cosas en la misma lista: lo que escribió el equipo y lo
 * que anotó el sistema al ocurrir el hecho. La fila dice cuál es cuál, en su
 * columna «Origen».
 *
 * Y las automáticas se pueden corregir. Eso es a propósito y está decidido,
 * porque una redacción se corrige. Lo que estaba mal era otra cosa. Medido
 * sobre una anotación automática, con el lápiz que ofrece la propia pantalla:
 *
 *   cambiarle el texto ..................  200, aceptado
 *   antes decía .........................  «Sale de "Damas de la Bitácora" (Traslado de ciudad).»
 *   quedó diciendo ......................  «Aquí no pasó nada.»
 *   y su origen seguía siendo ...........  Automático
 *   el texto original quedaba guardado en   ninguna parte
 *
 * O sea que después de la edición quedaba una anotación que dice «esto lo
 * registró el sistema cuando ocurrió», con un texto escrito por una persona y
 * sin rastro de lo que decía antes. La pantalla marcaba la fila con un
 * «editado», así que no era del todo muda, pero lo que se había perdido no
 * había dónde ir a buscarlo.
 *
 * La puerta contraria ya estaba cerrada, y bien: se comprobó que una nota
 * escrita a mano no puede hacerse pasar por una del sistema —se intentó crearla
 * y editarla poniéndole `origen: Automático` y `registrado_por: Sistema`, y el
 * servidor los ignoró las dos veces—. Faltaba esta.
 *
 * ── La regla ──
 *
 * Cuando se le cambia el texto a una anotación AUTOMÁTICA, se guarda lo que
 * decía y quién la corrigió. Solo a las automáticas, y la razón es exacta: en
 * una automática, «Origen» es una afirmación —«el sistema anotó esto cuando
 * pasó»— que la edición vuelve falsa. En una escrita a mano, «Origen» y
 * «Registrado por» dicen de quién son esas palabras, y eso sigue siendo cierto
 * después de que su autor las corrija: son suyas.
 *
 * Y se guarda el PRIMER texto, no el anterior. Lo que hay que poder leer
 * después es lo que anotó el sistema, no por cuántas manos pasó: si alguien
 * corrige una corrección, el original sigue siendo el mismo.
 *
 * ── LA OTRA MITAD: BORRAR ──
 *
 * Hasta la v1.433.0 los cuatro historiales no contestaban lo mismo, y dependía
 * de en qué pestaña estuviera parado quien preguntara. MEDIDO en la v1.433.0,
 * sobre una anotación que dejó el sistema, en los cuatro:
 *
 *   historial_solicitudes  ·  corregirla 400 «no se modifica»  ·  borrarla 400
 *   historial_iglesias ....  corregirla 200 (con texto_original)  ·  borrarla 200 BORRADA
 *   historial_pastores ....  corregirla 200 (con texto_original)  ·  borrarla 200 BORRADA
 *   bitacora ..............  corregirla 200 (con texto_original)  ·  borrarla 200 BORRADA
 *
 * (Son CUATRO y no tres: la bitácora de un miembro tiene la misma forma y no
 * estaba en la revisión, igual que en el hallazgo SA-01.)
 *
 * LA REGLA QUEDA UNA SOLA, Y CADA MITAD TIENE SU RAZÓN:
 *
 *   SE CORRIGE, y queda escrito lo que decía y quién lo corrigió. Una redacción
 *   se arregla, y lo que anotó el sistema no se pierde: está ahí, en la misma
 *   fila, y la pantalla marca que fue corregida. Al de una solicitud le faltaba
 *   esto y se le dio.
 *
 *   NO SE ELIMINA. Acá no hay nada equivalente a `texto_original`: la línea
 *   desaparece de la lista donde la gente la lee, y lo único que queda es una
 *   entrada del Registro de Cambios, que es otra pantalla y otros permisos. Un
 *   historial del que se pueden sacar líneas deja de ser constancia de nada. Los
 *   otros tres no lo tenían y se les dio.
 *
 * Se decidió acá porque las dos posturas eran defendibles y ninguna estaba
 * escrita como decisión: si la corporación prefiere la mitad contraria —que lo
 * automático tampoco se corrija—, es quitar `guardarLoQueDecia` de los cuatro
 * ganchos y devolverle al de solicitudes su negativa. Lo que no puede volver es
 * que cada pestaña conteste una cosa distinta (hallazgo SA-05).
 */

/**
 * Deja constancia de lo que decía la anotación, si es que la escribió el
 * sistema y alguien le está cambiando el texto. Modifica `data` en el sitio.
 *
 * Se llama desde el `beforeSave` de cada historial. Escribe campos de solo
 * lectura, que es lo que corresponde: el motor los quita de lo que llega del
 * formulario ANTES del hook, así que solo el sistema los puede poner (es lo
 * mismo que hace `registrado_por`).
 */
function guardarLoQueDecia(data, { existing, user }) {
  /*
   * Al crear no hay `existing` —el motor lo deja en null— y por eso no hace
   * falta preguntar además si es nueva: se comprobó rompiéndolo, y quitar esa
   * pregunta no hacía caer ninguna prueba. Era código de más, y una condición
   * que parece que cuida algo y no cuida nada es peor que no tenerla.
   */
  if (!existing) return;
  if (existing.origen !== 'Automático') return;
  if (data.descripcion === undefined) return;
  if (String(data.descripcion) === String(existing.descripcion == null ? '' : existing.descripcion)) return;

  // El primero, no el anterior: si ya se había corregido, lo que anotó el
  // sistema es lo que quedó guardado la primera vez
  if (!existing.texto_original) data.texto_original = existing.descripcion;
  data.corregido_por = user && user.nombre ? user.nombre : 'Sistema';
}

/**
 * Lo que anotó el sistema no se elimina: es la constancia de lo que pasó.
 *
 * Se llama desde el `beforeDelete` de cada historial. Devuelve la negativa o
 * `null`, que es lo que el motor espera.
 *
 * NO frena el arrastre de un borrado en cascada, y eso es correcto: cuando se
 * borra la ficha madre, sus líneas se van con ella por el camino de
 * server/dependencias.js, que borra las filas directamente sin pasar por este
 * gancho. Una anotación sobre una iglesia que ya no existe no es constancia de
 * nada, y si lo fuera, quien la necesita es el Registro de Cambios, que sí la
 * conserva.
 */
function noSeElimina(fila) {
  if (fila && fila.origen === 'Automático') {
    return 'Esa anotación la dejó el sistema al ocurrir el hecho: es la constancia de lo que pasó '
      + 'y no se elimina. Si lo que dice está mal, corríjale el texto —queda escrito lo que decía— '
      + 'o escriba una anotación nueva al lado.';
  }
  return null;
}

/**
 * Los dos campos que esto necesita, iguales en los cuatro historiales.
 *
 * De solo lectura los dos, y visibles: el punto de todo esto es que lo que
 * anotó el sistema se pueda leer sin permisos especiales ni ir a buscarlo a
 * otra parte.
 */
const CAMPOS = [
  {
    name: 'texto_original', label: 'Lo que había anotado el sistema', type: 'textarea', readonly: true,
    help: 'Aparece cuando alguien corrige a mano una anotación automática. Es lo que decía antes.',
  },
  {
    name: 'corregido_por', label: 'Corregida a mano por', type: 'text', readonly: true,
  },
];

module.exports = { guardarLoQueDecia, noSeElimina, CAMPOS };
