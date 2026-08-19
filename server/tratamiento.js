/**
 * Cómo se le dice a cada persona.
 *
 * En la iglesia a cada miembro se le trata con un prefijo:
 *
 *   Hermano / Hermana   a los miembros en general, según su género.
 *   Oficial             a los varones que pertenecen al cuerpo de oficiales.
 *   Pastor / Pastora    a quienes están registrados en Pastores / Guías y,
 *                       si así se configura, a su cónyuge.
 *
 * Se calcula al leer la ficha —no se guarda—, así que se mantiene al día solo
 * cuando alguien entra al cuerpo de oficiales o queda registrado como pastor.
 * Cada miembro puede llevar además un trato fijado a mano, que manda sobre
 * todo lo anterior.
 */
const { esOficial } = require('./oficiales');

/** Los tratos que se pueden fijar a mano en la ficha. */
const TRATAMIENTOS = ['Hermano', 'Hermana', 'Oficial', 'Pastor', 'Pastora', 'Diácono', 'Diaconisa', 'Anciano'];

const esMujer = (genero) => genero === 'Femenino';

/** ¿Esta persona está registrada como pastor(a)? Se busca por su RUT. */
function estaEnPastores(rut, db) {
  if (!rut) return false;
  return !!db.prepare('SELECT id FROM pastores WHERE rut = ?').get(rut);
}

/** El trato que le corresponde a un miembro. Devuelve '' si no se puede saber. */
function tratamientoDe(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;

  const ajustes = require('./ajustes'); // tardío: ajustes usa la base

  if (estaEnPastores(miembro.rut, db)) return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';

  // El cónyuge del pastor o la pastora recibe el mismo trato, si así se usa
  if (miembro.conyuge_id && ajustes.activo('conyuge_pastor_tratamiento')) {
    const conyuge = db.prepare('SELECT rut FROM miembros WHERE id = ?').get(miembro.conyuge_id);
    if (conyuge && estaEnPastores(conyuge.rut, db)) return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';
  }

  if (!esMujer(miembro.genero) && miembro.genero && esOficial(miembro.id, db)) return 'Oficial';

  if (!miembro.genero) return '';
  return esMujer(miembro.genero) ? 'Hermana' : 'Hermano';
}

/** "Hermano Juan Pérez" */
function conTratamiento(miembro, db) {
  const trato = tratamientoDe(miembro, db);
  const nombre = `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim();
  return trato ? `${trato} ${nombre}` : nombre;
}

module.exports = { TRATAMIENTOS, tratamientoDe, conTratamiento };
