/**
 * VARIAS ADVERTENCIAS, UNA SOLA PREGUNTA.
 *
 * Cuando el servidor quiere que alguien confirme algo antes de guardar,
 * contesta con un reparo y una clave, y quien guarda vuelve a mandar lo mismo
 * con la marca de «guardar igual». Esa marca es UNA para toda la petición: no
 * dice a qué reparo contesta, dice «sí» a todo lo que este guardado tenga que
 * preguntar.
 *
 * De ahí sale la regla: un guardado que tiene dos cosas que advertir las dice
 * LAS DOS, en el mismo aviso y numeradas. Preguntando de a una, quien confirma
 * la primera pasa la segunda sin haberla leído — y la segunda puede ser la
 * grave.
 *
 * Estaba escrito en server/reglas-del-acta.js, que es donde hizo falta la
 * primera vez. No es una regla de las actas: es cómo funciona el mecanismo de
 * confirmar, y el mismo caso apareció en la oficina de partes en cuanto un
 * documento pudo cambiar de flujo y de iglesia en el mismo guardado. Se mudó
 * acá para que el segundo módulo no tuviera que pedirle al libro de actas una
 * pieza que no es suya.
 */

/** Varias advertencias de un mismo guardado, en un solo aviso y numeradas. */
function enUnSoloAviso(avisos) {
  if (avisos.length === 1) return avisos[0].texto;
  const cuantas = avisos.length === 2 ? 'dos' : String(avisos.length);
  return `Hay ${cuantas} cosas que revisar antes de guardar. `
    + avisos.map((a, i) => `(${i + 1}) ${a.texto}`).join(' ');
}

module.exports = { enUnSoloAviso };
