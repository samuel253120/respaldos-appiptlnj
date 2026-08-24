/**
 * El número de cada solicitud.
 *
 * Formato: cuatro dígitos correlativos, un guion y el año. `0001-2026`.
 *
 * SE REINICIA CON EL AÑO, a propósito: es correspondencia interna, y cuando
 * alguien dice «la 45 de este año» todos saben cuál es. Después de la
 * 0187-2026 viene la 0001-2027.
 *
 * LO ASIGNA EL SISTEMA. En ninguna pantalla se escribe ni se corrige: el
 * número es cómo se nombra la solicitud en un acta, en un correo o de viva
 * voz, y si dos personas pudieran elegirlo se repetiría.
 *
 * NO SE REUTILIZA DENTRO DEL AÑO. Si una solicitud se elimina, su número queda
 * consumido. Por eso el correlativo no se calcula contando filas ni buscando
 * el máximo —eso volvería a entregar el número de una que se borró, y dos
 * papeles distintos llevarían el mismo—: se lleva en un contador propio, uno
 * por año, que solo sube.
 *
 * DOS PERSONAS A LA VEZ NO PUEDEN RECIBIR EL MISMO. El contador se incrementa
 * y se lee en un solo paso de la base, y además la columna lleva una
 * restricción de unicidad: si por lo que fuera se intentara repetir uno, la
 * base lo rechaza.
 *
 * Es normal y esperado que queden saltos en la numeración.
 */

/** Con cuántos dígitos se escribe el correlativo, como mínimo. */
const MINIMO_DIGITOS = 4;

/**
 * La base, pedida en el momento y no al cargar el archivo: este archivo lo usa
 * una migración, y las migraciones corren desde dentro de db.js.
 */
let listo = false;
function base() {
  const { db } = require('../db');
  if (!listo) {
    // El contador vive en su propia tabla, una fila por año. No se toca al
    // borrar solicitudes: de eso se trata que el número no se reutilice.
    db.exec(`CREATE TABLE IF NOT EXISTS solicitud_contador (
      anio INTEGER PRIMARY KEY,
      ultimo INTEGER NOT NULL DEFAULT 0
    )`);
    listo = true;
  }
  return db;
}

/** Cómo se escribe: `0001-2026`. */
function comoSeEscribe(correlativo, anio) {
  return `${String(correlativo).padStart(MINIMO_DIGITOS, '0')}-${anio}`;
}

/**
 * El siguiente número del año que se indique (por omisión, el de hoy).
 *
 * Se sube y se lee de una sola vez: `RETURNING` devuelve el valor que quedó
 * después de sumar, así que dos peticiones simultáneas reciben dos números
 * distintos sin que haga falta ningún candado.
 */
function siguiente(anio) {
  const db = base();
  const cual = Number(anio) || new Date().getFullYear();
  const fila = db
    .prepare(
      `INSERT INTO solicitud_contador (anio, ultimo) VALUES (?, 1)
       ON CONFLICT(anio) DO UPDATE SET ultimo = ultimo + 1
       RETURNING ultimo`
    )
    .get(cual);
  return comoSeEscribe(fila.ultimo, cual);
}

/**
 * Deja el contador de un año en un valor dado, si estaba más atrás.
 *
 * Lo usa la migración que numera las solicitudes que ya existían: después de
 * ponerles número hay que dejar el contador donde corresponde, o la siguiente
 * solicitud repetiría uno.
 */
function alMenos(anio, cuanto) {
  const db = base();
  db.prepare(
    `INSERT INTO solicitud_contador (anio, ultimo) VALUES (?, ?)
     ON CONFLICT(anio) DO UPDATE SET ultimo = MAX(ultimo, excluded.ultimo)`
  ).run(Number(anio), Number(cuanto));
}

/** El año que dice un número de solicitud, o nada si no lo trae. */
function anioDe(numero) {
  const m = /^(\d+)-(\d{4})$/.exec(String(numero || ''));
  return m ? Number(m[2]) : null;
}

module.exports = { siguiente, comoSeEscribe, alMenos, anioDe, MINIMO_DIGITOS };
