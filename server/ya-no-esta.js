/**
 * A quien ya no está en la iglesia se le retira de sus cuerpos y grupos.
 *
 * Marcar una ficha como **Fallecido** o **Trasladado** ya hacía tres cosas: le
 * cerraba el acceso al sistema, la sacaba de los cumpleaños y la retiraba de la
 * directiva. Pero no la sacaba de sus cuerpos, y de la lista de integrantes de
 * un cuerpo cuelga casi todo lo demás:
 *
 *   · la pantalla donde se pasa lista la seguía ofreciendo para marcarla
 *   · la planilla mensual impresa le seguía abriendo su columna
 *   · el porcentaje de asistencia del cuerpo la contaba entre los convocados,
 *     así que bajaba para siempre por gente que no puede asistir
 *   · y el aviso de faltas seguidas —«lleva 4 faltas, conviene visitarla»— la
 *     iba a nombrar en el panel, delante de quien corresponda
 *
 * Las cuatro salen de `personasDelCuerpo` (ver server/integrantes.js), que
 * mira el estado de la FICHA DE INTEGRANTE y no el de la persona. Filtrar ahí
 * al vuelo habría tapado los cuatro casos de una vez, pero sin dejar rastro:
 * la ficha de integrante seguiría diciendo que pertenece. Retirarla de verdad
 * deja la fecha, el motivo y una línea en su bitácora y en la del cuerpo, que
 * es lo que se consulta después.
 *
 * ── Qué se retira ──
 *
 * TODAS sus fichas vigentes, las haya puesto la regla de la directiva o una
 * persona a mano. Acá no se trata de que una regla mande sobre otra: la
 * persona no está, y eso vale para el cuerpo que sea.
 *
 * ── Y si fue un error ──
 *
 * El estado se puede volver atrás, y la regla lo acompaña: se reabren
 * exactamente las fichas que ESTA regla retiró —se reconocen por su motivo— y
 * ninguna otra. A quien el cuerpo retiró por su cuenta no se le devuelve nunca.
 *
 * Se reabren solo los cuerpos de la iglesia en la que la persona está HOY: si
 * se trasladó de verdad y su ficha quedó en la congregación que la recibió,
 * devolverla a los cuerpos de la que dejó sería meterla donde ya no pertenece.
 *
 * Y vuelve al estado que le corresponde por su propio período de prueba, que
 * quedó escrito en su ficha: si todavía no termina, vuelve «En prueba»; si ya
 * pasó, «Activo». Devolverla siempre como activa le regalaría la prueba.
 */
const bitacora = require('./bitacora');
const { hoy } = require('./fechas');

/** Los estados en que la persona ya no es parte de la congregación. */
const YA_NO_ESTA = ['Fallecido', 'Trasladado'];

/**
 * El motivo que queda escrito en la ficha de integrante.
 *
 * Se lee en la ficha del cuerpo años después, así que dice lo que pasó y no
 * cómo se llama la regla. Y es además la marca por la que se reconoce lo que
 * esta regla retiró: si alguna vez cambia el texto, lo retirado con el texto
 * viejo deja de reabrirse solo —por eso los dos están en la lista de abajo—.
 */
const MOTIVO = { Fallecido: 'Fallecimiento', Trasladado: 'Traslado a otra iglesia' };

/** Los motivos que escribió esta regla, y que por lo tanto puede deshacer. */
const MOTIVOS_DE_LA_REGLA = ['Fallecimiento', 'Traslado a otra iglesia'];

/** Los estados de integrante que cuentan como pertenecer hoy. */
const VIGENTES = ['En prueba', 'Activo'];

/** ¿Esta ficha dice que la persona ya no es parte de la congregación? */
function yaNoEsta(miembro) {
  return !!miembro && YA_NO_ESTA.includes(miembro.estado);
}

/** Las fichas de integrante de una persona, con el nombre de su cuerpo. */
function fichasDe(db, miembroId, estados) {
  const marcas = estados.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT i.id, i.estado, i.fecha_fin_prueba, i.motivo_retiro,
              c.id AS cuerpo_id, c.nombre AS cuerpo, c.iglesia_id AS cuerpo_iglesia
         FROM integrantes_cuerpo i
         JOIN cuerpos c ON c.id = i.cuerpo_id
        WHERE i.miembro_id = ? AND i.estado IN (${marcas})
        ORDER BY c.nombre`
    )
    .all(miembroId, ...estados);
}

/** Retira de todos sus cuerpos a quien ya no está. Devuelve los nombres. */
function retirar(db, miembro, usuario) {
  const motivo = MOTIVO[miembro.estado];
  const salio = [];
  for (const ficha of fichasDe(db, miembro.id, VIGENTES)) {
    db.prepare(
      `UPDATE integrantes_cuerpo
          SET estado = 'Retirado', fecha_retiro = ?, motivo_retiro = ?,
              updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(hoy(), motivo, ficha.id);

    bitacora.anotar({
      miembroId: miembro.id, tipo: 'Salida de cuerpo', iglesiaId: ficha.cuerpo_iglesia, usuario,
      descripcion: `Sale de "${ficha.cuerpo}" (${motivo}).`,
    });
    salio.push(ficha.cuerpo);
  }
  return salio;
}

/** Devuelve a sus cuerpos a quien había salido por esta misma regla. */
function devolver(db, miembro, usuario) {
  const volvio = [];
  for (const ficha of fichasDe(db, miembro.id, ['Retirado'])) {
    if (!MOTIVOS_DE_LA_REGLA.includes(ficha.motivo_retiro)) continue;   // lo retiró otro
    if (miembro.iglesia_id && Number(ficha.cuerpo_iglesia) !== Number(miembro.iglesia_id)) continue;

    const enPrueba = ficha.fecha_fin_prueba && String(ficha.fecha_fin_prueba) > hoy();
    db.prepare(
      `UPDATE integrantes_cuerpo
          SET estado = ?, fecha_retiro = NULL, motivo_retiro = NULL,
              updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(enPrueba ? 'En prueba' : 'Activo', ficha.id);

    bitacora.anotar({
      miembroId: miembro.id, tipo: 'Ingreso a cuerpo', iglesiaId: ficha.cuerpo_iglesia, usuario,
      descripcion: `Vuelve a "${ficha.cuerpo}": su ficha ya no dice que se fue de la iglesia.`,
    });
    volvio.push(ficha.cuerpo);
  }
  return volvio;
}

/**
 * La regla corrida para una persona, al guardar su ficha.
 *
 * Va ANTES que la de la directiva a propósito. Las dos pueden querer retirar
 * la misma ficha, y la que llega primero es la que deja escrito el motivo: si
 * corriera después, a quien falleció siendo líder su ficha le quedaría diciendo
 * «Dejó de ser Miembro Líder», que no es lo que pasó.
 */
function alGuardarUnMiembro(db, miembro, usuario) {
  if (!miembro || !miembro.id) return { salio: [], volvio: [] };
  try {
    return yaNoEsta(miembro)
      ? { salio: retirar(db, miembro, usuario), volvio: [] }
      : { salio: [], volvio: devolver(db, miembro, usuario) };
  } catch (e) {
    // Una base a medio migrar no puede impedir que se guarde una ficha
    return { salio: [], volvio: [] };
  }
}

module.exports = { alGuardarUnMiembro, yaNoEsta, YA_NO_ESTA, MOTIVO, MOTIVOS_DE_LA_REGLA };
