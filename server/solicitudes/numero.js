/**
 * El número de cada solicitud.
 *
 * Formato: `SOL-CENTRAL-0001-2026`. Tres partes y cada una está por algo:
 *
 *   · EL PREFIJO (`SOL-`) dice qué es. Se cambia en Configuración, como el de
 *     los certificados y el de la oficina de partes.
 *   · EL CÓDIGO DE LA IGLESIA (`CENTRAL`) dice DE CUÁL ES. Esto es lo que
 *     faltaba: el correlativo era de todo el sistema, así que la primera
 *     solicitud de una iglesia recién creada salía con el 0004 —heredaba el de
 *     las otras— y decir «la 12 de este año» no significaba nada mientras
 *     hubiera más de una congregación. Sale de la ficha de la iglesia (ver
 *     server/codigo-iglesia.js).
 *   · EL CORRELATIVO Y EL AÑO (`0001-2026`) cuentan, por iglesia y por año.
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
 * por iglesia y año, que solo sube.
 *
 * DOS PERSONAS A LA VEZ NO PUEDEN RECIBIR EL MISMO. El contador se incrementa
 * y se lee en un solo paso de la base, y además la columna lleva una
 * restricción de unicidad: si por lo que fuera se intentara repetir uno, la
 * base lo rechaza.
 *
 * Es normal y esperado que queden saltos en la numeración.
 *
 * LO YA EMITIDO NO SE TOCA. Las solicitudes numeradas con el formato anterior
 * —`0001-2026`, sin iglesia— conservan su número: es con el que están
 * nombradas en actas y correos. Lo que hace la migración es dejar el contador
 * de cada iglesia donde llegó su numeración, para que la siguiente siga de
 * largo en vez de empezar de nuevo.
 */
const codigoDeIglesia = require('../codigo-iglesia');

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
    // El contador vive en su propia tabla, una fila por iglesia y año. No se
    // toca al borrar solicitudes: de eso se trata que no se reutilice.
    db.exec(`CREATE TABLE IF NOT EXISTS solicitud_contador_iglesia (
      iglesia_id INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      ultimo INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (iglesia_id, anio)
    )`);
    listo = true;
  }
  return db;
}

/** El prefijo que la iglesia haya puesto. Se lee cada vez: es un ajuste. */
function prefijo() {
  try {
    return String(require('../ajustes').obtener('solicitud_prefijo') || '').trim();
  } catch (e) {
    return 'SOL-';
  }
}

/** Cómo se escribe: `SOL-CENTRAL-0001-2026`. */
function comoSeEscribe(correlativo, anio, sigla, conQuePrefijo) {
  const pre = conQuePrefijo === undefined ? prefijo() : String(conQuePrefijo || '');
  const cual = String(sigla || '').trim();
  return `${pre}${cual ? `${cual}-` : ''}${String(correlativo).padStart(MINIMO_DIGITOS, '0')}-${anio}`;
}

/**
 * El siguiente número de esa iglesia, en el año que se indique.
 *
 * Se sube y se lee de una sola vez: `RETURNING` devuelve el valor que quedó
 * después de sumar, así que dos peticiones simultáneas reciben dos números
 * distintos sin que haga falta ningún candado.
 */
function siguiente(iglesiaId, anio) {
  const db = base();
  const cual = Number(anio) || new Date().getFullYear();
  const deQuien = Number(iglesiaId) || 0;
  const fila = db
    .prepare(
      `INSERT INTO solicitud_contador_iglesia (iglesia_id, anio, ultimo) VALUES (?, ?, 1)
       ON CONFLICT(iglesia_id, anio) DO UPDATE SET ultimo = ultimo + 1
       RETURNING ultimo`
    )
    .get(deQuien, cual);
  return comoSeEscribe(fila.ultimo, cual, codigoDeIglesia.deLaIglesia(db, deQuien));
}

/**
 * Deja el contador de una iglesia y un año en un valor dado, si estaba atrás.
 *
 * Lo usa la migración que pasa la numeración a ser por iglesia: después de
 * mirar hasta dónde llegó cada una hay que dejar su contador ahí, o la
 * siguiente solicitud repetiría un número.
 */
function alMenos(iglesiaId, anio, cuanto) {
  const db = base();
  db.prepare(
    `INSERT INTO solicitud_contador_iglesia (iglesia_id, anio, ultimo) VALUES (?, ?, ?)
     ON CONFLICT(iglesia_id, anio) DO UPDATE SET ultimo = MAX(ultimo, excluded.ultimo)`
  ).run(Number(iglesiaId) || 0, Number(anio), Number(cuanto));
}

/**
 * Lee la cola de un número: el correlativo y el año.
 *
 * Se ancla al final a propósito, y no al principio: así lee igual los números
 * del formato de hoy —`SOL-CENTRAL-0001-2026`— y los del anterior —`0001-2026`—,
 * que siguen circulando y hay que poder contarlos para no repetirlos.
 */
function partesDe(numero) {
  const m = /(\d{1,6})-(\d{4})$/.exec(String(numero || '').trim());
  return m ? { correlativo: Number(m[1]), anio: Number(m[2]) } : null;
}

/** El año que dice un número de solicitud, o nada si no lo trae. */
function anioDe(numero) {
  const p = partesDe(numero);
  return p ? p.anio : null;
}

/** El correlativo que dice un número de solicitud, o nada si no lo trae. */
function correlativoDe(numero) {
  const p = partesDe(numero);
  return p ? p.correlativo : null;
}

module.exports = {
  siguiente, comoSeEscribe, alMenos, anioDe, correlativoDe, partesDe, prefijo, MINIMO_DIGITOS,
};
