/**
 * VACIAR LA CARPETA DE DOCUMENTOS DE LOS MIEMBROS, Y NADA MÁS.
 *
 * Esto existe por una razón concreta y de una sola vez. La importación del
 * sistema anterior trajo los DATOS de cada documento —su tipo, su nombre, su
 * fecha— pero no los archivos: no venían en la exportación. Cada entrada quedó
 * creada, sin archivo, con la observación «El archivo se adjunta cuando llegue
 * la carpeta de respaldos», y su ruta anotada en la lista de pendientes
 * (server/importacion/m12-documentos.js).
 *
 * Esa carpeta no va a llegar. Lo que queda entonces son cientos de entradas que
 * prometen un papel que no existe y que nadie va a poder completar, mezcladas
 * con las que sí se están subiendo ahora. La corporación pidió partir de cero
 * en esa carpeta.
 *
 * ── LO QUE TOCA, Y LO QUE NO ──
 *
 * TOCA, y solo esto:
 *   · las filas de `documentos_miembros`;
 *   · los archivos que esas filas tengan en el disco, y solo si no los usa
 *     ninguna otra ficha —de eso responde server/archivos.js, que es el mismo
 *     cuidado que se tiene al borrar un documento de a uno—;
 *   · sus renglones de la lista de archivos pendientes de la importación, que
 *     esperan una carpeta que no va a llegar.
 *
 * NO TOCA NADA MÁS. Ni las fichas de los miembros, ni su bitácora, ni las otras
 * tres carpetas del sistema —la de una iglesia, la de un pastor, la de una
 * solicitud—, ni la foto de nadie. La ficha de la persona queda entera: lo
 * único que se vacía es su carpeta de papeles.
 *
 * ── POR QUÉ NO ES GENÉRICO ──
 *
 * Podría escribirse para las cuatro carpetas con un parámetro. No se hace: una
 * puerta que borra en bloque tiene que ser tan angosta como la necesidad que la
 * pidió, y la necesidad es una sola carpeta por una migración que pasó una vez.
 * El día que haga falta otra, se escribe otra y se mira de nuevo qué arrastra.
 *
 * ── Y QUEDA ANOTADO ──
 *
 * Una línea en el Registro de Cambios, con cuántas entradas se fueron, cuántos
 * archivos se borraron del disco y quién lo hizo. Borrar en bloque sin dejar
 * constancia sería justo lo que este sistema no hace en ninguna otra parte.
 */
const archivos = require('./archivos');
const bitacora = require('./bitacora');
const { getModule } = require('./registry');

const TABLA = 'documentos_miembros';

/** El texto con que la importación marcó las entradas que dejó esperando. */
const LA_MARCA_DE_LA_MIGRACION = 'El archivo se adjunta cuando llegue la carpeta';

/**
 * Qué hay hoy en la carpeta, para poder mirarlo ANTES de vaciarla.
 *
 * Las tres cifras que importan son distintas y conviene no confundirlas: las
 * que tienen su archivo de verdad en el disco, las que prometen uno que no
 * está, y las que la migración dejó esperando la carpeta que no llegó.
 */
function loQueHayEnLaCarpeta(db) {
  const filas = db.prepare(`SELECT id, archivo, observaciones FROM "${TABLA}"`).all();

  let conSuArchivo = 0;
  let prometenUnoQueNoEsta = 0;
  let deLaMigracion = 0;
  for (const f of filas) {
    if (f.archivo && archivos.existe(f.archivo)) conSuArchivo++;
    else if (f.archivo) prometenUnoQueNoEsta++;
    if (String(f.observaciones || '').includes(LA_MARCA_DE_LA_MIGRACION)) deLaMigracion++;
  }

  const personas = db
    .prepare(`SELECT COUNT(DISTINCT miembro_id) AS n FROM "${TABLA}" WHERE miembro_id IS NOT NULL`)
    .get().n;

  let esperandoLaCarpeta = 0;
  try {
    esperandoLaCarpeta = db
      .prepare('SELECT COUNT(*) AS n FROM importacion_archivos WHERE modulo_destino = ? AND resuelto = 0')
      .get(TABLA).n;
  } catch (e) {
    esperandoLaCarpeta = 0; // la tabla existe solo si alguna vez se importó
  }

  return {
    entradas: filas.length,
    conSuArchivo,
    prometenUnoQueNoEsta,
    sinArchivo: filas.length - conSuArchivo - prometenUnoQueNoEsta,
    deLaMigracion,
    esperandoLaCarpeta,
    personas,
    // Lo que NO se toca, dicho con su cifra para que se vea en la pantalla:
    // quien mire esto tiene que poder comprobar que las fichas se quedan.
    miembros: db.prepare('SELECT COUNT(*) AS n FROM miembros').get().n,
  };
}

/**
 * Vacía la carpeta. Todo o nada: si algo falla, no se fue ninguna.
 *
 * Los archivos se borran del disco DENTRO de la transacción y antes del DELETE,
 * que es cuando todavía se puede leer qué archivo tenía cada fila. Es el mismo
 * orden que usa el motor al borrar un registro de a uno.
 */
function vaciarLaCarpeta(db, { usuario } = {}) {
  const def = getModule(TABLA);
  const antes = loQueHayEnLaCarpeta(db);
  let borradosDelDisco = 0;
  let pendientesSoltados = 0;

  db.transaction(() => {
    for (const fila of db.prepare(`SELECT * FROM "${TABLA}"`).all()) {
      borradosDelDisco += archivos.borrarLosDe(def, fila);
    }
    db.prepare(`DELETE FROM "${TABLA}"`).run();
    try {
      const r = db
        .prepare('DELETE FROM importacion_archivos WHERE modulo_destino = ?')
        .run(TABLA);
      pendientesSoltados = r.changes || 0;
    } catch (e) {
      pendientesSoltados = 0;
    }
  }).immediate();

  const detalle = `Se vació la carpeta de documentos de los miembros: ${antes.entradas} entrada(s) `
    + `de ${antes.personas} persona(s), ${borradosDelDisco} archivo(s) borrado(s) del disco y `
    + `${pendientesSoltados} pendiente(s) de la importación soltado(s). `
    + 'Las fichas de los miembros no se tocaron.';

  bitacora.anotarCambio({
    def,
    accion: 'Eliminación',
    fila: { id: null, nombre: 'Toda la carpeta de documentos de los miembros' },
    detalle,
    usuario,
  });

  return { ...antes, borradosDelDisco, pendientesSoltados, detalle };
}

module.exports = { loQueHayEnLaCarpeta, vaciarLaCarpeta, TABLA, LA_MARCA_DE_LA_MIGRACION };
