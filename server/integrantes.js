/**
 * Quién pertenece a cada cuerpo o grupo.
 *
 * Antes la pertenencia era una lista de números guardada dentro del cuerpo,
 * y por eso no se podía decir nada más de cada persona: solo si estaba o no
 * estaba. Ahora cada pertenencia es una ficha propia —módulo
 * "integrantes_cuerpo"— con su estado, su fecha de ingreso, su período de
 * prueba y si paga cuota.
 *
 * Los tres estados:
 *
 *   En prueba   Recién ingresado. Al terminar su período se evalúa su
 *               informe: o pasa a integrante oficial, o se le extiende.
 *   Activo      Integrante oficial del cuerpo, con todos sus deberes.
 *   Retirado    Ya no pertenece. Su ficha queda, con la fecha y el motivo.
 *
 * Para todo lo demás del sistema —pasar lista, elegir una directiva, saber
 * quién es oficial, qué ve cada usuario— cuentan los que están hoy en el
 * cuerpo: los activos y los que están en prueba. Este archivo es el único
 * lugar donde se decide eso, para que todos respondan lo mismo.
 */

/** Los estados en que puede estar una persona dentro de un cuerpo. */
const ESTADOS = ['En prueba', 'Activo', 'Retirado'];

/** Los que pertenecen hoy: activos y en prueba. */
const VIGENTES = ['En prueba', 'Activo'];

/**
 * Ids de quienes pertenecen hoy a un cuerpo, incluido su líder.
 *
 * El líder va primero aunque no tenga ficha de integrante: dirigir el cuerpo
 * es pertenecer a él, y así nunca queda fuera de una lista de asistencia.
 */
function idsDeIntegrantes(db, cuerpoId, { conRetirados = false } = {}) {
  if (!cuerpoId) return [];
  const estados = conRetirados ? ESTADOS : VIGENTES;
  const marcas = estados.map(() => '?').join(',');
  const filas = db
    .prepare(
      `SELECT i.miembro_id AS id
         FROM integrantes_cuerpo i
         JOIN miembros m ON m.id = i.miembro_id
        WHERE i.cuerpo_id = ? AND i.estado IN (${marcas})
        ORDER BY m.apellidos, m.nombres`
    )
    .all(cuerpoId, ...estados)
    .map((f) => Number(f.id));

  const cuerpo = db.prepare('SELECT lider_id FROM cuerpos WHERE id = ?').get(cuerpoId);
  if (cuerpo && cuerpo.lider_id && !filas.includes(Number(cuerpo.lider_id))) {
    filas.unshift(Number(cuerpo.lider_id));
  }
  return filas;
}

/** Lo mismo para varios cuerpos a la vez, sin repetir a nadie. */
function idsDeVariosCuerpos(db, cuerpoIds, opciones) {
  const todos = new Set();
  for (const id of cuerpoIds || []) {
    for (const miembro of idsDeIntegrantes(db, id, opciones)) todos.add(miembro);
  }
  return [...todos];
}

/**
 * Las fichas de integrante de un cuerpo, con el nombre de cada persona y su
 * RUT, para mostrarlas y para elegir entre ellas.
 */
function integrantesDe(db, cuerpoId, opciones = {}) {
  if (!cuerpoId) return [];
  const estados = opciones.conRetirados ? ESTADOS : VIGENTES;
  const marcas = estados.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT i.*, m.nombres, m.apellidos, m.rut, m.foto, m.tratamiento_personalizado
         FROM integrantes_cuerpo i
         JOIN miembros m ON m.id = i.miembro_id
        WHERE i.cuerpo_id = ? AND i.estado IN (${marcas})
        ORDER BY m.apellidos, m.nombres`
    )
    .all(cuerpoId, ...estados);
}

/** La ficha de una persona dentro de un cuerpo, si la tiene. */
function fichaDeIntegrante(db, cuerpoId, miembroId) {
  if (!cuerpoId || !miembroId) return null;
  return db
    .prepare('SELECT * FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?')
    .get(cuerpoId, miembroId) || null;
}

/** Los cuerpos a los que pertenece una persona hoy. */
function cuerposDe(db, miembroId, opciones = {}) {
  if (!miembroId) return [];
  const estados = opciones.conRetirados ? ESTADOS : VIGENTES;
  const marcas = estados.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT i.*, c.nombre, c.tipo, c.estado AS estado_cuerpo, c.lider_id
         FROM integrantes_cuerpo i
         JOIN cuerpos c ON c.id = i.cuerpo_id
        WHERE i.miembro_id = ? AND i.estado IN (${marcas})
        ORDER BY c.nombre`
    )
    .all(miembroId, ...estados);
}

/**
 * Cuándo se le termina el período de prueba a quien entra hoy. Los meses los
 * define cada cuerpo; si no dice nada, se usan los de Configuración.
 */
function finDelPeriodoDePrueba(db, cuerpoId, desde) {
  if (!desde) return null;
  const cuerpo = db.prepare('SELECT meses_prueba FROM cuerpos WHERE id = ?').get(cuerpoId);
  const propios = cuerpo && cuerpo.meses_prueba != null && cuerpo.meses_prueba !== ''
    ? Number(cuerpo.meses_prueba)
    : null;
  const meses = Number.isFinite(propios) && propios > 0
    ? propios
    : require('./ajustes').numero('cuerpos_meses_prueba', 0, 60);
  if (!meses) return null;

  const [a, m, d] = String(desde).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  const fecha = new Date(Date.UTC(a, m - 1 + meses, d));
  return fecha.toISOString().slice(0, 10);
}

module.exports = {
  ESTADOS, VIGENTES,
  idsDeIntegrantes, idsDeVariosCuerpos, integrantesDe, fichaDeIntegrante, cuerposDe,
  finDelPeriodoDePrueba,
};
