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

/**
 * El cuerpo cuyos integrantes son los oficiales, según Configuración.
 *
 * `comoSeLlama` se puede pasar para no leer el ajuste: es lo que permite
 * preguntar «¿y si se llamara de otra manera?» sin tocar la configuración de
 * todos, que es compartida.
 */
function cuerpoDeOficiales(db, comoSeLlama) {
  const ajustes = require('./ajustes'); // tardío: ajustes usa la base
  const nombre = normalizar(comoSeLlama !== undefined ? comoSeLlama : ajustes.obtener('cuerpo_oficiales'));
  if (!nombre) return null;
  const filas = db.prepare('SELECT id, nombre, lider_id FROM cuerpos').all();
  return filas.find((c) => normalizar(c.nombre) === nombre) || null;
}

/** Ids de los integrantes del cuerpo de oficiales (incluido su líder). */
function idsDeOficiales(db, comoSeLlama) {
  const cuerpo = cuerpoDeOficiales(db, comoSeLlama);
  if (!cuerpo) return [];
  // Tardío: integrantes.js consulta ajustes, que consulta la base
  return require('./integrantes').idsDeIntegrantes(db, cuerpo.id);
}

/**
 * Si el cuerpo de oficiales está armado o no, y por qué no.
 *
 * De acá salen dos cosas que tienen que decir lo mismo: la comprobación del
 * oficial supervisor al guardar una directiva —que se apaga cuando no está
 * armado, porque no hay contra qué comprobar— y el aviso del vigía, que es
 * quien le dice a alguien que la encienda. Escritas por separado, un día una
 * daría por armado lo que la otra sigue reclamando.
 */
function comoEsta(db, comoSeLlama) {
  const ajustes = require('./ajustes');
  const nombre = String(comoSeLlama !== undefined ? comoSeLlama : (ajustes.obtener('cuerpo_oficiales') || '')).trim();
  if (!nombre) return { nombre: '', cuerpo: null, cuantos: 0, armado: false, sinNombre: true };
  const cuerpo = cuerpoDeOficiales(db, nombre);
  const cuantos = cuerpo ? idsDeOficiales(db, nombre).length : 0;
  return { nombre, cuerpo, cuantos, armado: !!cuerpo && cuantos > 0, sinNombre: false };
}

/** ¿Este miembro pertenece al cuerpo de oficiales? */
function esOficial(miembroId, db) {
  if (!miembroId) return false;
  return idsDeOficiales(db).includes(Number(miembroId));
}

module.exports = { normalizar, cuerpoDeOficiales, idsDeOficiales, comoEsta, esOficial };
