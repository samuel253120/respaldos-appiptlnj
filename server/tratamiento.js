/**
 * Cómo se le dice a cada persona.
 *
 * En la iglesia a cada miembro se le trata con un prefijo:
 *
 *   Hermano / Hermana   a los miembros en general, según su género.
 *   Oficial             a los varones que pertenecen al cuerpo de oficiales.
 *   Pastor / Pastora    a quienes están registrados en Pastores / Guías y a
 *                       su cónyuge: el marido de la pastora es Pastor y la
 *                       esposa del pastor es Pastora, nunca Hermano ni
 *                       Hermana.
 *
 * Se calcula al leer la ficha —no se guarda—, así que se mantiene al día solo
 * cuando alguien entra al cuerpo de oficiales o queda registrado como pastor.
 * Cada miembro puede llevar además un trato fijado a mano, que manda sobre
 * todo lo anterior.
 */
const { esOficial } = require('./oficiales');

/** Los únicos tratos que se usan en la iglesia. */
const TRATAMIENTOS = ['Hermano', 'Hermana', 'Oficial', 'Pastor', 'Pastora'];

const esMujer = (genero) => genero === 'Femenino';

/**
 * ¿Esta persona está registrada como pastor(a)?
 *
 * El pastor y la pastora de una iglesia son también miembros de ella: su
 * ficha de miembro queda enlazada a la de Pastores / Guías. Se reconoce por
 * ese enlace y, si aún no lo tiene, por el RUT.
 */
function estaEnPastores(miembro, db) {
  if (!miembro) return false;
  if (miembro.id && db.prepare('SELECT id FROM pastores WHERE miembro_id = ?').get(miembro.id)) return true;
  if (miembro.rut && db.prepare('SELECT id FROM pastores WHERE rut = ?').get(miembro.rut)) return true;
  return false;
}

/** El trato que le corresponde a un miembro. Devuelve '' si no se puede saber. */
function tratamientoDe(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;

  if (estaEnPastores(miembro, db)) return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';

  // El cónyuge del pastor o de la pastora recibe siempre el mismo trato
  if (miembro.conyuge_id) {
    const conyuge = db.prepare('SELECT id, rut FROM miembros WHERE id = ?').get(miembro.conyuge_id);
    if (conyuge && estaEnPastores(conyuge, db)) return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';
  }

  if (!esMujer(miembro.genero) && miembro.genero && esOficial(miembro.id, db)) return 'Oficial';

  if (!miembro.genero) return '';
  return esMujer(miembro.genero) ? 'Hermana' : 'Hermano';
}

/**
 * ¿A esta persona le corresponde el trato de Pastor o Pastora? Lo es quien
 * tiene ficha en Pastores / Guías y también su cónyuge.
 */
function leCorrespondePastor(miembro, db) {
  if (!miembro) return false;
  if (estaEnPastores(miembro, db)) return true;
  if (miembro.conyuge_id) {
    const conyuge = db.prepare('SELECT id, rut FROM miembros WHERE id = ?').get(miembro.conyuge_id);
    if (conyuge && estaEnPastores(conyuge, db)) return true;
  }
  return false;
}

/** "Hermano Juan Pérez" */
function conTratamiento(miembro, db) {
  const trato = tratamientoDe(miembro, db);
  const nombre = `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim();
  return trato ? `${trato} ${nombre}` : nombre;
}

module.exports = { TRATAMIENTOS, tratamientoDe, conTratamiento, estaEnPastores, leCorrespondePastor };
