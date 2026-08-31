/**
 * Lo que significa que una iglesia esté INACTIVA.
 *
 * Hasta acá, nada. El campo tenía sus tres opciones —Activa, Inactiva, En
 * formación—, se guardaba, se pintaba de gris en el listado, y NINGUNA regla
 * del sistema lo consultaba. Medido sobre una iglesia creada directamente como
 * inactiva:
 *
 *   anotarle un miembro nuevo ................. 201
 *   crearle un cuerpo nuevo ................... 201
 *   meterle plata en la caja .................. 201
 *   ¿sigue en el listado? ..................... sí, igual que las activas
 *   ¿la ofrece el desplegable de un miembro? .. sí
 *
 * Y es la ÚNICA salida que el sistema ofrece para retirar una congregación:
 * borrarla está prohibido, y el aviso que lo dice termina con «márquela como
 * inactiva». Así que quien cierra una iglesia hace lo que le dicen, la marca,
 * y queda convencido de que el asunto está resuelto. Meses después alguien
 * anota una ofrenda en esa caja porque el desplegable se la ofreció. Un estado
 * que no hace cumplir nada es peor que no tenerlo: promete una protección que
 * no existe.
 *
 * LO QUE SE FRENA ES LO NUEVO, NO LO QUE YA ESTÁ. Una iglesia inactiva es
 * historia, y la historia se lee, se consulta, se corrige y se imprime. Lo que
 * no se hace es seguir colgándole cosas: gente, cuerpos, plata, papeles. Por
 * eso la regla mira solo el alta —y el traslado de un registro HACIA una
 * inactiva—, y no toca ninguna edición de lo que ya vive ahí.
 *
 * SE FRENA Y NO SE PREGUNTA, como en una cuenta cerrada (ver
 * server/cuenta-cerrada.js): la salida está escrita en el propio aviso —volver
 * a marcarla Activa— y es una decisión que se toma en la ficha de la iglesia,
 * no de pasada al guardar otra cosa.
 */

/** El estado que cierra la puerta. «En formación» no: para eso se está formando. */
const INACTIVA = 'Inactiva';

/**
 * Lo que SÍ se le puede seguir escribiendo a una iglesia inactiva.
 *
 * Son los módulos que existen para contar lo que le pasó a la iglesia, y el
 * cierre es justamente algo que hay que poder anotar: el acta que lo acordó,
 * la línea del historial que lo deja dicho, y la auditoría, que la escribe el
 * propio sistema y no una persona.
 *
 * `usuarios` va aparte por otra razón: ahí `iglesia_id` no dice de qué iglesia
 * es el registro, dice cuál es la iglesia PRINCIPAL de esa cuenta —con cuál
 * trabaja por omisión—, que es un dato distinto. Es la misma advertencia que
 * ya está escrita en server/alcance.js.
 */
const PUEDEN_ESCRIBIRLE = ['historial_iglesias', 'documentos_iglesias', 'registro_cambios', 'usuarios'];

/** ¿Esta iglesia está marcada como inactiva? Devuelve su fila, o null. */
function laInactiva(db, iglesiaId) {
  const id = Number(iglesiaId) || 0;
  if (!id) return null;
  let fila = null;
  try {
    fila = db.prepare('SELECT id, nombre, estado FROM iglesias WHERE id = ?').get(id);
  } catch (e) {
    return null; // la tabla se crea al arrancar; si aún no está, no hay regla que correr
  }
  return fila && fila.estado === INACTIVA ? fila : null;
}

/**
 * El aviso de que esto no se le puede colgar a una iglesia inactiva, o null.
 *
 * Se llama DESPUÉS del gancho del módulo, y eso importa: hay módulos que no
 * reciben la iglesia y la deducen ahí —un traspaso la toma de su cuenta de
 * origen, una cuenta de cuerpo la toma de su cuerpo, un artículo de inventario
 * también—. Preguntando antes, esos entrarían igual.
 */
function avisoSiLaIglesiaEstaInactiva(db, def, { data, existing, isNew }) {
  if (PUEDEN_ESCRIBIRLE.includes(def.name)) return null;

  /*
   * A qué iglesia se está mandando esto. Si el guardado no la nombra, no se
   * está mandando a ninguna parte y no hay nada que preguntar: es alguien
   * corrigiéndole el teléfono a una ficha sin tocar de quién es.
   *
   * Por ahí salen solos, sin que haya que nombrarlos, los dos casos que la
   * primera versión de este archivo listaba aparte:
   *
   *   · la ficha de la PROPIA iglesia, que no tiene columna `iglesia_id`
   *     porque es ella —y por eso una inactiva se sigue editando, que es
   *     como se la vuelve a abrir—;
   *   · y cualquier módulo que no tenga iglesia, como los perfiles de
   *     permisos.
   *
   * Aquellas dos líneas se sacaron después de comprobar que quitarlas no
   * rompía ninguna prueba: no eran una defensa, eran la misma pregunta
   * escrita tres veces.
   */
  const ahora = data.iglesia_id;
  if (!ahora) return null;

  // Al editar, solo si el registro se está MUDANDO a una iglesia inactiva: lo
  // que ya vive en una se sigue corrigiendo, que es de lo que se trata
  const antes = existing ? existing.iglesia_id : null;
  if (!isNew && String(antes || '') === String(ahora)) return null;

  const iglesia = laInactiva(db, ahora);
  if (!iglesia) return null;

  const que = isNew ? 'anotarse' : 'pasarse';
  return (
    `La iglesia "${iglesia.nombre}" está marcada como inactiva, así que no puede ${que} nada nuevo `
    + 'en ella: se retiró y lo suyo quedó como historia. Si la congregación volvió a funcionar, '
    + 'cámbiele el estado a «Activa» en su ficha y vuelva a intentarlo; si esto corresponde a otra '
    + 'iglesia, elíjala.'
  );
}

/** La condición SQL de las que sí reciben cosas nuevas. */
const condicionDeActivas = () => `estado <> '${INACTIVA}'`;

module.exports = { INACTIVA, PUEDEN_ESCRIBIRLE, laInactiva, avisoSiLaIglesiaEstaInactiva, condicionDeActivas };
