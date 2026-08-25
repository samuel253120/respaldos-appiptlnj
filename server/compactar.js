/**
 * Compactar la base: recuperar el espacio de lo que se borró.
 *
 * EL PROBLEMA, QUE NO SE VE. SQLite no le devuelve al disco el espacio de las
 * filas que se borran. Las páginas quedan adentro del archivo, marcadas como
 * libres, y se reutilizan cuando entran datos nuevos. Mientras tanto el
 * archivo conserva su tamaño más grande histórico, para siempre. Medido en
 * este proyecto:
 *
 *     base con 60.000 filas               26,1 MB
 *     tras borrar el 90% de las filas     26,1 MB   ← el archivo no baja
 *     después de compactar                 2,6 MB
 *
 * En un sistema que borra avisos leídos todos los días, poda respaldos y saca
 * archivos sin dueño, ese espacio se va acumulando sin que nadie lo note hasta
 * que el volumen se llena y no se puede guardar nada.
 *
 * NO BORRA NADA. VACUUM reescribe el archivo entero, ordenado y sin huecos:
 * salen exactamente las mismas filas que entraron. Es lo contrario de una
 * limpieza de datos —no decide qué sobra— y por eso puede correr solo.
 *
 * CUÁNDO SE HACE. Con el respaldo automático, de madrugada, porque bloquea la
 * base mientras dura y ese es el rato en que no hay nadie trabajando. Y se
 * salta cuando no vale la pena o no es seguro; ver las dos guardas de abajo.
 */
const fs = require('fs');
const path = require('path');

/** Desde cuánto espacio libre adentro vale la pena la molestia. */
const VALE_LA_PENA_MB = 5;

/** El archivo de la base y lo que pesa, en bytes. */
function tamanoDeLaBase(db) {
  const ruta = db.name;
  try {
    let total = fs.statSync(ruta).size;
    // El diario (WAL) es parte de lo que ocupa en el disco.
    for (const extra of ['-wal', '-shm']) {
      try { total += fs.statSync(ruta + extra).size; } catch (e) { /* puede no existir */ }
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/** Cuánto espacio hay libre DENTRO del archivo, en bytes. */
function espacioDesperdiciado(db) {
  try {
    const paginas = db.pragma('freelist_count', { simple: true });
    const tamano = db.pragma('page_size', { simple: true });
    return Number(paginas) * Number(tamano);
  } catch (e) {
    return 0;
  }
}

/** Cuánto disco queda libre donde vive la base, en bytes. */
function discoLibre(db) {
  try {
    return fs.statfsSync(path.dirname(db.name)).bavail * fs.statfsSync(path.dirname(db.name)).bsize;
  } catch (e) {
    return Infinity; // si no se puede saber, no se usa esta guarda
  }
}

/**
 * Compacta si conviene. Devuelve qué pasó, siempre, para poder anotarlo.
 *
 * Las dos guardas:
 *
 *   · SI NO HAY BASTANTE QUE RECUPERAR, no se hace. Compactar reescribe el
 *     archivo entero: en una base grande son minutos de bloqueo, y hacerlo
 *     todas las noches para recuperar unos kilobytes es puro gasto.
 *
 *   · SI NO CABE, tampoco. VACUUM escribe una copia completa antes de
 *     reemplazar la original, así que necesita en disco tanto como pesa la
 *     base. Empezarlo sin espacio lo deja a medias y con el volumen lleno,
 *     que es peor que no haberlo intentado.
 */
function compactar(db, { desdeMB = VALE_LA_PENA_MB } = {}) {
  const sobra = espacioDesperdiciado(db);
  const antes = tamanoDeLaBase(db);

  if (sobra < desdeMB * 1024 * 1024) {
    return { hecho: false, porque: 'no hay bastante que recuperar', sobra, antes };
  }
  const libre = discoLibre(db);
  if (libre < antes) {
    return { hecho: false, porque: 'no hay disco suficiente para hacerlo con seguridad', sobra, antes, libre };
  }

  try {
    db.exec('VACUUM');
    // Sin esto el archivo sigue viéndose grande hasta el próximo cierre: lo
    // recuperado está en el diario y todavía no volvió al archivo principal.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    return { hecho: false, porque: e.message, sobra, antes };
  }

  const despues = tamanoDeLaBase(db);
  return { hecho: true, antes, despues, recuperado: Math.max(0, antes - despues) };
}

module.exports = { compactar, espacioDesperdiciado, tamanoDeLaBase, VALE_LA_PENA_MB };
