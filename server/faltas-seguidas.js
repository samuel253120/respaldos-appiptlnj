/**
 * QUIÉN LLEVA MUCHAS FALTAS SEGUIDAS.
 *
 * El sistema avisa de credenciales por vencer, de cuotas atrasadas, de
 * solicitudes sin respuesta y de cumpleaños: siete tipos de aviso, ninguno de
 * asistencia. Y la asistencia es de lo poco que avisa A TIEMPO de que alguien
 * se está alejando, que es de lo que más le importa a un cuerpo. Cuando se
 * nota sin ayuda, ya pasaron meses.
 *
 * CÓMO SE CUENTA. Se recorren las actividades del cuerpo de la más reciente
 * hacia atrás, y por cada una se mira qué le pusieron a esa persona:
 *
 *   Presente ............  corta la cuenta. Volvió: no lleva faltas seguidas.
 *   Ausente ............   suma una falta.
 *   Justificado .......    suma una falta, y se anota que avisó.
 *   sin marcar ........    ni suma ni corta. Nadie faltó a una lista que no
 *                          se pasó, y contarlo llenaría de avisos falsos al
 *                          cuerpo que va atrasado con sus listas.
 *   visita ............    no se mira. Una visita no tiene a qué faltar.
 *
 * Las justificadas se cuentan pero se dicen aparte: quien avisa que no puede
 * ir no es el mismo caso que quien desapareció, y el aviso tiene que dejar ver
 * la diferencia sin obligar a entrar a mirar.
 *
 * Y solo se mira a quien está ACTIVO en el cuerpo: a quien se retiró no se le
 * avisa de que dejó de venir.
 */
const { db } = require('./db');

/** Cuántas faltas seguidas hacen falta para avisar. En 0 no se avisa. */
const cuantasAvisan = () => require('./ajustes').numero('asistencia_faltas_seguidas', 0, 52);

/**
 * Hasta cuántas actividades hacia atrás se mira.
 *
 * Con 40 caben casi un año de reuniones semanales, que es mucho más de lo que
 * cualquier umbral razonable necesita. El tope está para que un cuerpo con
 * diez años de historia no recorra veinte mil marcas cada mañana.
 */
const CUANTAS_ATRAS = 40;

/**
 * Quiénes del cuerpo llevan `cuantas` o más faltas seguidas.
 *
 * Devuelve una fila por persona, con su cuenta y con cuántas de esas faltas
 * fueron justificadas. Vacío si no hay actividades o si nadie llega al número.
 */
function delCuerpo(cuerpoId, cuantas) {
  const minimo = Number(cuantas) || 0;
  if (!minimo) return [];

  const actividades = db
    .prepare(
      `SELECT DISTINCT a.id, a.fecha FROM asistencias a
        WHERE EXISTS (SELECT 1 FROM json_each(a.cuerpos) WHERE json_each.value = ?)
          AND a.fecha <= date('now','localtime')
        ORDER BY a.fecha DESC, a.id DESC LIMIT ${CUANTAS_ATRAS}`
    )
    .all(cuerpoId);
  if (actividades.length < minimo) return [];

  const ids = actividades.map((a) => a.id);
  const marcas = db
    .prepare(
      `SELECT asistencia_id, miembro_id, no_miembro_id, estado FROM asistencia_detalle
        WHERE cuerpo_id = ? AND COALESCE(visita, 0) = 0
          AND asistencia_id IN (${ids.map(() => '?').join(',')})`
    )
    .all(cuerpoId, ...ids);

  const { clavePersona, personasDelCuerpo } = require('./integrantes');
  const porActividad = new Map(ids.map((id) => [id, new Map()]));
  for (const m of marcas) {
    const quien = clavePersona(m);
    if (!quien) continue;
    porActividad.get(m.asistencia_id).set(quien, m.estado);
  }

  const salen = [];
  for (const persona of personasDelCuerpo(db, cuerpoId)) {
    const quien = clavePersona(persona);
    if (!quien) continue;
    let faltas = 0;
    let justificadas = 0;
    let desde = null;
    for (const a of actividades) {
      const estado = porActividad.get(a.id).get(quien);
      if (!estado) continue;                 // sin marcar: ni suma ni corta
      if (estado === 'Presente') break;      // volvió
      faltas += 1;
      if (estado === 'Justificado') justificadas += 1;
      desde = a.fecha;                       // la más antigua de la racha
    }
    if (faltas >= minimo) {
      salen.push({
        clave: quien,
        persona_tipo: persona.persona_tipo,
        miembro_id: persona.miembro_id || null,
        no_miembro_id: persona.no_miembro_id || null,
        nombre: require('./nombres').paraMostrar(persona.nombres, persona.apellidos),
        faltas,
        justificadas,
        sin_avisar: faltas - justificadas,
        desde,
      });
    }
  }
  return salen.sort((a, b) => b.faltas - a.faltas || a.nombre.localeCompare(b.nombre));
}

module.exports = { delCuerpo, cuantasAvisan, CUANTAS_ATRAS };
