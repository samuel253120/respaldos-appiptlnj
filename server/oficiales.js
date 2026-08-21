/**
 * El cuerpo de oficiales.
 *
 * Su nombre se define en Configuración → Organización (por defecto
 * "Oficiales"). De ahí salen los oficiales supervisores de los cuerpos, y a
 * sus integrantes varones se les trata de "Oficial".
 */

/** Sin distinguir mayúsculas ni tildes, para comparar nombres escritos a mano. */
function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** El cuerpo cuyos integrantes son los oficiales, según Configuración. */
function cuerpoDeOficiales(db) {
  const ajustes = require('./ajustes'); // tardío: ajustes usa la base
  const nombre = normalizar(ajustes.obtener('cuerpo_oficiales'));
  if (!nombre) return null;
  const filas = db.prepare('SELECT id, nombre, lider_id FROM cuerpos').all();
  return filas.find((c) => normalizar(c.nombre) === nombre) || null;
}

/** Ids de los integrantes del cuerpo de oficiales (incluido su líder). */
function idsDeOficiales(db) {
  const cuerpo = cuerpoDeOficiales(db);
  if (!cuerpo) return [];
  // Tardío: integrantes.js consulta ajustes, que consulta la base
  return require('./integrantes').idsDeIntegrantes(db, cuerpo.id);
}

/** ¿Este miembro pertenece al cuerpo de oficiales? */
function esOficial(miembroId, db) {
  if (!miembroId) return false;
  return idsDeOficiales(db).includes(Number(miembroId));
}

module.exports = { normalizar, cuerpoDeOficiales, idsDeOficiales, esOficial };
