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
 *
 * ---------------------------------------------------------------------------
 * DE QUÉ REGISTRO SALE CADA PERSONA
 *
 * Un CUERPO es una entidad formal —reglamento, deberes y derechos, directiva
 * propia— y se compone de miembros inscritos en el registro oficial de la
 * iglesia. Un GRUPO es una agrupación de servicio, y ahí sirve gente que no
 * necesariamente está inscrita: el hermano que ayuda con el sonido, la
 * hermana que cocina para la once. Esas personas tienen su ficha en el
 * registro aparte —módulo "No Miembros"— y ahora pueden pertenecer a un
 * grupo sin entrar a la membresía.
 *
 * Por eso cada ficha de integrante dice de qué registro sale su persona, y
 * hay DOS FAMILIAS DE FUNCIONES ACÁ, que no se pueden confundir:
 *
 *   idsDeIntegrantes / idsDeVariosCuerpos
 *       Devuelven ids de MIEMBROS y nada más. Las usan el alcance de cada
 *       usuario, los oficiales y las directivas, que cruzan ese número contra
 *       la tabla de miembros. Meter ahí el id de un no miembro haría que el
 *       número 7 del registro aparte se confundiera con el miembro número 7:
 *       dos personas distintas con el mismo número.
 *
 *   personasDelCuerpo / integrantesDe
 *       Devuelven a TODA la gente del cuerpo, de los dos registros, cada una
 *       diciendo de cuál sale. Las usan la ficha del cuerpo, las cuotas y la
 *       lista de asistencia, que muestran personas, no ids.
 */

/** Los estados en que puede estar una persona dentro de un cuerpo. */
const ESTADOS = ['En prueba', 'Activo', 'Retirado'];

/** Los que pertenecen hoy: activos y en prueba. */
const VIGENTES = ['En prueba', 'Activo'];

/** De qué registro sale la persona de una ficha de integrante. */
const REGISTROS = ['Miembro', 'No miembro'];

/**
 * La clave con la que se identifica a una persona sin ambigüedad.
 *
 * El número solo no alcanza: el miembro n.º 7 y el no miembro n.º 7 son dos
 * personas distintas. La letra dice de qué registro sale.
 */
function clavePersona(quien) {
  if (!quien) return '';
  const no = Number(quien.no_miembro_id);
  if (no) return `n${no}`;
  const si = Number(quien.miembro_id);
  return si ? `m${si}` : '';
}

/** Al revés: de la clave a los dos campos, para guardar. */
function personaDeClave(clave) {
  const texto = String(clave || '');
  const n = Number(texto.slice(1));
  if (!n) return { miembro_id: null, no_miembro_id: null };
  if (texto[0] === 'n') return { miembro_id: null, no_miembro_id: n };
  if (texto[0] === 'm') return { miembro_id: n, no_miembro_id: null };
  return { miembro_id: null, no_miembro_id: null };
}

/**
 * Ids de los MIEMBROS que pertenecen hoy a un cuerpo, incluido su líder.
 *
 * El líder va primero aunque no tenga ficha de integrante: dirigir el cuerpo
 * es pertenecer a él, y así nunca queda fuera de una lista de asistencia.
 *
 * Los no miembros que sirven en un grupo NO salen acá, a propósito: quien
 * llama a esta función usa el número para buscar en la tabla de miembros.
 * Para la gente completa está personasDelCuerpo.
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

/** ¿Existe todavía la columna del registro aparte? (bases muy viejas) */
function hayNoMiembros(db) {
  try {
    return db.prepare('PRAGMA table_info("integrantes_cuerpo")').all()
      .some((c) => c.name === 'no_miembro_id');
  } catch (e) {
    return false;
  }
}

/**
 * Las fichas de integrante de un cuerpo, con el nombre de cada persona y su
 * RUT, para mostrarlas y para elegir entre ellas.
 *
 * Salen las de los dos registros, cada una diciendo de cuál viene. El campo
 * `id` sigue siendo el de la FICHA —no el de la persona—, porque es con ese
 * número con el que se cobran las cuotas y se evalúan los períodos de prueba.
 */
function integrantesDe(db, cuerpoId, opciones = {}) {
  if (!cuerpoId) return [];
  const estados = opciones.conRetirados ? ESTADOS : VIGENTES;
  const marcas = estados.map(() => '?').join(',');

  const deMiembros = `
    SELECT i.id, i.cuerpo_id, i.estado, i.fecha_ingreso, i.fecha_fin_prueba, i.fecha_oficial,
           i.fecha_retiro, i.motivo_retiro, i.exento_cuota, i.exento_motivo, i.observaciones,
           i.iglesia_id, i.automatico,
           'Miembro' AS persona_tipo, i.miembro_id AS miembro_id, NULL AS no_miembro_id,
           m.nombres AS nombres, m.apellidos AS apellidos, m.rut AS rut, m.foto AS foto,
           m.tratamiento_personalizado AS tratamiento_personalizado
      FROM integrantes_cuerpo i
      JOIN miembros m ON m.id = i.miembro_id
     WHERE i.cuerpo_id = ? AND i.estado IN (${marcas})`;

  if (!hayNoMiembros(db)) {
    return db.prepare(`${deMiembros} ORDER BY apellidos, nombres`).all(cuerpoId, ...estados);
  }

  const deNoMiembros = `
    SELECT i.id, i.cuerpo_id, i.estado, i.fecha_ingreso, i.fecha_fin_prueba, i.fecha_oficial,
           i.fecha_retiro, i.motivo_retiro, i.exento_cuota, i.exento_motivo, i.observaciones,
           i.iglesia_id, i.automatico,
           'No miembro' AS persona_tipo, NULL AS miembro_id, i.no_miembro_id AS no_miembro_id,
           n.nombres AS nombres, n.apellidos AS apellidos, n.rut AS rut, NULL AS foto,
           NULL AS tratamiento_personalizado
      FROM integrantes_cuerpo i
      JOIN no_miembros n ON n.id = i.no_miembro_id
     WHERE i.cuerpo_id = ? AND i.estado IN (${marcas}) AND i.no_miembro_id IS NOT NULL`;

  return db
    .prepare(`${deMiembros} UNION ALL ${deNoMiembros} ORDER BY apellidos, nombres`)
    .all(cuerpoId, ...estados, cuerpoId, ...estados);
}

/**
 * Toda la gente que hoy pertenece a un cuerpo, para mostrarla o pasarle
 * lista: los integrantes de los dos registros MÁS el líder, que pertenece al
 * cuerpo por dirigirlo aunque no tenga ficha.
 *
 * Cada persona trae su `clave`, que es lo único que la identifica sin
 * ambigüedad entre los dos registros.
 */
function personasDelCuerpo(db, cuerpoId, opciones = {}) {
  if (!cuerpoId) return [];
  const gente = integrantesDe(db, cuerpoId, opciones).map((f) => ({
    ficha_id: f.id,
    clave: clavePersona(f),
    persona_tipo: f.persona_tipo,
    miembro_id: f.miembro_id || null,
    no_miembro_id: f.no_miembro_id || null,
    nombres: f.nombres,
    apellidos: f.apellidos,
    rut: f.rut || null,
    foto: f.foto || null,
    estado: f.estado,
  }));

  /*
   * El líder pertenece al cuerpo por dirigirlo, aunque no tenga ficha de
   * integrante. Y a un GRUPO lo puede dirigir alguien que no está inscrito en
   * la membresía (ver server/modules/cuerpos.js), así que hay que ir a
   * buscarlo al registro que corresponda.
   */
  const cuerpo = db
    .prepare('SELECT lider_id, lider_no_miembro_id FROM cuerpos WHERE id = ?')
    .get(cuerpoId);
  if (!cuerpo) return gente;

  const noInscrito = Number(cuerpo.lider_no_miembro_id) || 0;
  const inscrito = noInscrito ? 0 : Number(cuerpo.lider_id) || 0;
  const yaEsta = noInscrito
    ? gente.some((g) => g.persona_tipo === 'No miembro' && Number(g.no_miembro_id) === noInscrito)
    : inscrito && gente.some((g) => g.persona_tipo === 'Miembro' && Number(g.miembro_id) === inscrito);

  if ((noInscrito || inscrito) && !yaEsta) {
    const m = noInscrito
      ? db.prepare('SELECT id, nombres, apellidos, rut FROM no_miembros WHERE id = ?').get(noInscrito)
      : db.prepare('SELECT id, nombres, apellidos, rut, foto FROM miembros WHERE id = ?').get(inscrito);
    if (m) {
      gente.unshift({
        ficha_id: null,
        clave: clavePersona(noInscrito ? { no_miembro_id: m.id } : { miembro_id: m.id }),
        persona_tipo: noInscrito ? 'No miembro' : 'Miembro',
        miembro_id: noInscrito ? null : m.id,
        no_miembro_id: noInscrito ? m.id : null,
        nombres: m.nombres,
        apellidos: m.apellidos,
        rut: m.rut || null,
        foto: m.foto || null,
        estado: 'Activo',
      });
    }
  }
  return gente;
}

/** La ficha de un MIEMBRO dentro de un cuerpo, si la tiene. */
function fichaDeIntegrante(db, cuerpoId, miembroId) {
  if (!cuerpoId || !miembroId) return null;
  return db
    .prepare('SELECT * FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?')
    .get(cuerpoId, miembroId) || null;
}

/**
 * La ficha de una persona cualquiera dentro de un cuerpo, venga del registro
 * que venga. Es lo que hay que preguntar antes de crear otra: nadie puede
 * tener dos fichas en el mismo cuerpo.
 */
function fichaDePersona(db, cuerpoId, quien) {
  if (!cuerpoId || !quien) return null;
  if (Number(quien.no_miembro_id)) {
    if (!hayNoMiembros(db)) return null;
    return db
      .prepare('SELECT * FROM integrantes_cuerpo WHERE cuerpo_id = ? AND no_miembro_id = ?')
      .get(cuerpoId, Number(quien.no_miembro_id)) || null;
  }
  return fichaDeIntegrante(db, cuerpoId, Number(quien.miembro_id));
}

/** Los cuerpos a los que pertenece un miembro hoy. */
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

/** Los grupos a los que pertenece hoy alguien del registro aparte. */
function gruposDeNoMiembro(db, noMiembroId, opciones = {}) {
  if (!noMiembroId || !hayNoMiembros(db)) return [];
  const estados = opciones.conRetirados ? ESTADOS : VIGENTES;
  const marcas = estados.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT i.*, c.nombre, c.tipo, c.estado AS estado_cuerpo, c.lider_id
         FROM integrantes_cuerpo i
         JOIN cuerpos c ON c.id = i.cuerpo_id
        WHERE i.no_miembro_id = ? AND i.estado IN (${marcas})
        ORDER BY c.nombre`
    )
    .all(noMiembroId, ...estados);
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
  ESTADOS, VIGENTES, REGISTROS,
  clavePersona, personaDeClave,
  idsDeIntegrantes, idsDeVariosCuerpos, integrantesDe, personasDelCuerpo,
  fichaDeIntegrante, fichaDePersona, cuerposDe, gruposDeNoMiembro,
  finDelPeriodoDePrueba,
};
