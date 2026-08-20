/**
 * Cómo se le dice a cada persona.
 *
 * En la iglesia a cada miembro se le trata con un prefijo:
 *
 *   Hermano / Hermana   a los miembros en general, según su género.
 *   Oficial             a los varones que pertenecen al cuerpo de oficiales.
 *   Guía de obra        a quien tiene ese cargo en Pastores / Guías: al guía
 *                       de obra se le dice guía de obra, no hermano ni pastor.
 *   Pastor / Pastora    a quienes tienen un cargo pastoral —de pastor
 *                       probando hacia arriba— y a su cónyuge: el marido de
 *                       la pastora es Pastor y la esposa del pastor es
 *                       Pastora, nunca Hermano ni Hermana.
 *
 * Se calcula al leer la ficha —no se guarda—, así que se mantiene al día solo
 * cuando alguien entra al cuerpo de oficiales, queda registrado en Pastores /
 * Guías o cambia de cargo. Cada miembro puede llevar además un trato fijado a
 * mano, que manda sobre todo lo anterior.
 */
const { esOficial } = require('./oficiales');

/**
 * El primer cargo del ministerio. No es un cargo pastoral: su trato es el
 * nombre mismo del cargo y su cónyuge no pasa a ser Pastor ni Pastora.
 */
const CARGO_GUIA = 'Guía de obra';

/** Los únicos tratos que se usan en la iglesia. */
const TRATAMIENTOS = ['Hermano', 'Hermana', 'Oficial', CARGO_GUIA, 'Pastor', 'Pastora'];

const esMujer = (genero) => genero === 'Femenino';

/**
 * La ficha de Pastores / Guías de esta persona, si tiene.
 *
 * Quien está en ese módulo es también miembro de su iglesia: su ficha de
 * miembro queda enlazada. Se reconoce por ese enlace y, si aún no lo tiene,
 * por el RUT.
 */
function fichaPastoral(miembro, db) {
  if (!miembro) return null;
  if (miembro.id) {
    const ficha = db.prepare('SELECT * FROM pastores WHERE miembro_id = ?').get(miembro.id);
    if (ficha) return ficha;
  }
  if (miembro.rut) return db.prepare('SELECT * FROM pastores WHERE rut = ?').get(miembro.rut) || null;
  return null;
}

/** ¿Esta persona está registrada en Pastores / Guías? */
function estaEnPastores(miembro, db) {
  return !!fichaPastoral(miembro, db);
}

/**
 * El trato que le da su propia ficha ministerial: 'Guía de obra' según el
 * cargo, 'Pastor' o 'Pastora' según el género, o '' si no tiene ficha.
 */
function tratoDeLaFicha(miembro, db) {
  const ficha = fichaPastoral(miembro, db);
  if (!ficha) return '';
  if (ficha.cargo === CARGO_GUIA) return CARGO_GUIA;
  return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';
}

/** ¿Es guía de obra? */
function esGuiaDeObra(miembro, db) {
  return tratoDeLaFicha(miembro, db) === CARGO_GUIA;
}

/** ¿Tiene un cargo pastoral? El guía de obra todavía no lo tiene. */
function esPastorRegistrado(miembro, db) {
  return ['Pastor', 'Pastora'].includes(tratoDeLaFicha(miembro, db));
}

/**
 * El trato que impone el ministerio: el de su propia ficha o, si es cónyuge
 * de un pastor o una pastora, el que le toca por ese matrimonio. Devuelve ''
 * cuando nada del ministerio lo obliga.
 */
function tratoMinisterial(miembro, db) {
  if (!miembro) return '';
  const propio = tratoDeLaFicha(miembro, db);
  if (propio) return propio;
  if (miembro.conyuge_id) {
    const conyuge = db.prepare('SELECT id, rut, genero FROM miembros WHERE id = ?').get(miembro.conyuge_id);
    if (conyuge && esPastorRegistrado(conyuge, db)) return esMujer(miembro.genero) ? 'Pastora' : 'Pastor';
  }
  return '';
}

/** El trato que le corresponde a un miembro. Devuelve '' si no se puede saber. */
function tratamientoDe(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;

  // Su ficha ministerial y, si no la tiene, la de su cónyuge
  const ministerial = tratoMinisterial(miembro, db);
  if (ministerial) return ministerial;

  if (!esMujer(miembro.genero) && miembro.genero && esOficial(miembro.id, db)) return 'Oficial';

  if (!miembro.genero) return '';
  return esMujer(miembro.genero) ? 'Hermana' : 'Hermano';
}

/**
 * El trato que le corresponde **por sí misma**, sin contar a su cónyuge: por
 * tener ficha en Pastores / Guías o por tenerlo fijado a mano.
 *
 * Sirve para elegir cónyuge: la pastora es pastora por su propio registro, no
 * por estar casada; si no, la regla se mordería la cola.
 */
function tratamientoPropio(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;
  return tratoDeLaFicha(miembro, db);
}

/** ¿Es pastor o pastora por su propio registro? */
function esPastorPorSiMismo(miembro, db) {
  return ['Pastor', 'Pastora'].includes(tratamientoPropio(miembro, db));
}

/**
 * ¿A esta persona le corresponde el trato de Pastor o Pastora? Lo es quien
 * tiene un cargo pastoral y también su cónyuge.
 */
function leCorrespondePastor(miembro, db) {
  return ['Pastor', 'Pastora'].includes(tratoMinisterial(miembro, db));
}

/** "Hermano Juan Pérez" */
function conTratamiento(miembro, db) {
  const trato = tratamientoDe(miembro, db);
  const nombre = `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim();
  return trato ? `${trato} ${nombre}` : nombre;
}

module.exports = {
  CARGO_GUIA, TRATAMIENTOS, tratamientoDe, conTratamiento, estaEnPastores, leCorrespondePastor,
  tratamientoPropio, esPastorPorSiMismo, fichaPastoral, tratoDeLaFicha, esGuiaDeObra,
  esPastorRegistrado, tratoMinisterial,
};
