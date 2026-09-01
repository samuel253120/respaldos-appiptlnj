/**
 * Cuándo dos nombres son el mismo nombre.
 *
 * Sin tildes, sin mayúsculas y sin espacios de más: «Damas», «damas» y
 * «DAMAS  » son el mismo nombre para cualquiera que los lea en un desplegable,
 * y por eso tienen que serlo también para las reglas que avisan de que algo se
 * repite.
 *
 * La pregunta la hacen DOS módulos —Iglesias, desde la 1.238.0, y Cuerpos /
 * Grupos desde la 1.252.0— y tiene que contestarse igual en los dos: si uno
 * ignorara las tildes y el otro no, «Jóvenes» y «Jovenes» se avisarían en una
 * lista y no en la otra. Estaba escrita dentro del módulo de Iglesias; se sacó
 * acá al escribir la del cuerpo.
 *
 * Se compara EN JAVASCRIPT y no en SQL a propósito: SQLite no sabe ignorar las
 * tildes, que es justamente lo que hay que ignorar. Son unas pocas decenas de
 * filas, y esto se pregunta al crear un registro o al cambiarle el nombre, que
 * se hace de a uno y a mano.
 */

/** Dos nombres se comparan sin tildes, sin mayúsculas y sin espacios de más. */
const comoSeCompara = (nombre) => String(nombre || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

/** Cuántas veces aparece cada nombre en una lista, ya normalizado. */
function cuantasVecesCadaUno(nombres) {
  const cuantas = new Map();
  for (const n of nombres) {
    const clave = comoSeCompara(n);
    cuantas.set(clave, (cuantas.get(clave) || 0) + 1);
  }
  return cuantas;
}

module.exports = { comoSeCompara, cuantasVecesCadaUno };
