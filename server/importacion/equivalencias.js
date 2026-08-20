/**
 * La tabla de equivalencias: qué registro del sistema anterior es cuál acá.
 *
 * El sistema anterior identificaba cada fila con un texto (<i8k7007d4</i>) y
 * este usa números correlativos, así que los identificadores no se pueden
 * conservar tal cual. Lo que se conserva —que es lo que importa— son las
 * relaciones: cada vínculo del origen se traduce por esta tabla.
 *
 * Sirve además para dos cosas más:
 *
 *  - **Idempotencia**: antes de insertar cualquier fila se busca acá. Si ya
 *    está, se actualiza en vez de crear otra. Correr la importación dos veces
 *    deja exactamente lo mismo que correrla una.
 *  - **Rastro**: queda registrado de dónde salió cada cosa, por si mañana hay
 *    que revisar un dato contra el sistema anterior.
 */
const { db } = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS importacion_equivalencias (
    modulo_origen  TEXT NOT NULL,
    id_origen      TEXT NOT NULL,
    modulo_destino TEXT NOT NULL,
    id_destino     INTEGER NOT NULL,
    lote           TEXT,
    creado_en      TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (modulo_origen, id_origen)
  );

  CREATE TABLE IF NOT EXISTS importacion_archivos (
    modulo_destino TEXT NOT NULL,
    id_destino     INTEGER NOT NULL,
    campo          TEXT NOT NULL,
    ruta_origen    TEXT NOT NULL,
    nombre         TEXT,
    tipo           TEXT,
    tamano         INTEGER,
    resuelto       INTEGER DEFAULT 0,
    lote           TEXT,
    PRIMARY KEY (modulo_destino, id_destino, campo, ruta_origen)
  );
`);

/** El id de acá que corresponde a un id del sistema anterior. */
function resolver(moduloOrigen, idOrigen) {
  if (!idOrigen) return null;
  const f = db
    .prepare('SELECT id_destino FROM importacion_equivalencias WHERE modulo_origen = ? AND id_origen = ?')
    .get(moduloOrigen, String(idOrigen));
  return f ? f.id_destino : null;
}

/** Deja anotada la equivalencia entre un registro del origen y el de acá. */
function registrar(moduloOrigen, idOrigen, moduloDestino, idDestino, lote) {
  db.prepare(
    `INSERT INTO importacion_equivalencias (modulo_origen, id_origen, modulo_destino, id_destino, lote)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(modulo_origen, id_origen) DO UPDATE SET
       modulo_destino = excluded.modulo_destino, id_destino = excluded.id_destino, lote = excluded.lote`
  ).run(moduloOrigen, String(idOrigen), moduloDestino, idDestino, lote || null);
}

/**
 * Anota un archivo que el registro tenía en el sistema anterior y que
 * todavía no está acá: cuando llegue la carpeta de adjuntos, se copia y se
 * conecta con su ficha sin tener que volver a importar nada.
 */
function archivoPendiente({ moduloDestino, idDestino, campo, ruta, nombre, tipo, tamano, lote }) {
  if (!ruta) return;
  db.prepare(
    `INSERT OR REPLACE INTO importacion_archivos
       (modulo_destino, id_destino, campo, ruta_origen, nombre, tipo, tamano, resuelto, lote)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(moduloDestino, idDestino, campo, ruta, nombre || null, tipo || null, tamano || null, lote || null);
}

/** Cuántas equivalencias hay de un módulo del origen. */
function cuantas(moduloOrigen) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM importacion_equivalencias WHERE modulo_origen = ?')
    .get(moduloOrigen).n;
}

module.exports = { resolver, registrar, archivoPendiente, cuantas };
