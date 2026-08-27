/**
 * La planilla mensual de asistencia de un cuerpo.
 *
 * Es el registro que la iglesia llevaba a mano en una hoja de cálculo: los
 * integrantes en las filas, los días del mes en las columnas, y en el cruce
 * una letra que dice si esa persona estuvo. A la derecha, cuánto asistió cada
 * uno; al pie, cuánta gente hubo cada día.
 *
 * Vive en su propio archivo, y no dentro de la ruta que la entrega, porque el
 * cálculo tiene tres cosas que es fácil equivocar sin que se note, y acá se
 * pueden probar una por una (ver pruebas/motor/planilla-asistencia.test.js):
 *
 *   · cuántos días tiene el mes —febrero de un año bisiesto y de uno común—
 *   · qué pasa cuando un cuerpo tuvo dos actividades el mismo día
 *   · qué pasa cuando a alguien no se le marcó nada en un día que sí hubo lista
 */
const { tratamientoDe } = require('./tratamiento');
const { personasDelCuerpo, clavePersona } = require('./integrantes');

/**
 * Con qué se queda un día que tuvo más de una actividad.
 *
 * UN DÍA, UNA COLUMNA. Si el cuerpo tuvo dos actividades el mismo día —el
 * ensayo en la mañana y el culto en la tarde— la columna dice lo mejor de las
 * dos: estuvo gana sobre justificó, y justificó gana sobre faltó. Es la única
 * forma de que la cuenta cuadre: la columna «T.» cuenta días con reunión, y
 * S + J + N tiene que dar exactamente eso.
 */
const PESO = { Presente: 3, Justificado: 2, Ausente: 1 };
const LETRA = { Presente: 'S', Justificado: 'J', Ausente: 'N' };

/**
 * El trato, abreviado, como se escribe en la planilla de siempre.
 *
 * Va abreviado por sitio: escrito entero, «Hermano» repetido treinta veces
 * ensancha la columna del nombre, y el ancho que se lleva ahí es el que les
 * falta a los treinta y un días.
 */
const ABREVIADO = {
  Hermano: 'Hno.', Hermana: 'Hna.', Oficial: 'Of.',
  Pastor: 'Ps.', Pastora: 'Psa.', 'Guía de Obra': 'Guía',
};

/** ¿Está bien escrito el mes que se pide? Se espera AAAA-MM. */
const mesValido = (mes) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ''));

/**
 * Arma la planilla de un cuerpo para un mes.
 *
 * `cuerpo` es la fila del cuerpo, ya comprobada por quien llama: acá no se
 * miran permisos ni alcance, solo se calcula.
 */
function armar(db, cuerpo, mes) {
  const [anio, numeroDeMes] = mes.split('-').map(Number);
  // El día 0 del mes siguiente es el último de este: así se resuelven de una
  // vez los meses de 30, los de 31 y el febrero de los años bisiestos.
  const cuantosDias = new Date(anio, numeroDeMes, 0).getDate();
  const dias = Array.from({ length: cuantosDias }, (_, i) => i + 1);
  const primero = `${mes}-01`;
  const ultimo = `${mes}-${String(cuantosDias).padStart(2, '0')}`;

  // Los dos registros: en un grupo también sirve gente que no está inscrita
  // en la membresía, y la planilla del grupo tiene que traerla igual
  const gente = personasDelCuerpo(db, cuerpo.id);

  const filas = db
    .prepare(
      `SELECT miembro_id, no_miembro_id, fecha, estado FROM asistencia_detalle
        WHERE cuerpo_id = ? AND fecha >= ? AND fecha <= ?`
    )
    .all(cuerpo.id, primero, ultimo);

  /** Un día tiene reunión si ese día se le pasó lista al cuerpo. */
  const conReunion = new Set();
  const porPersona = new Map(); // clave de persona -> { día -> estado }
  for (const f of filas) {
    const dia = Number(String(f.fecha).slice(8, 10));
    if (!dia) continue;
    conReunion.add(dia);
    const quien = clavePersona(f);
    if (!quien) continue;
    if (!porPersona.has(quien)) porPersona.set(quien, {});
    const suyas = porPersona.get(quien);
    if (!suyas[dia] || PESO[f.estado] > PESO[suyas[dia]]) suyas[dia] = f.estado;
  }
  const diasConReunion = [...conReunion].sort((a, b) => a - b);
  const porcentaje = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  const integrantes = gente.map((m, i) => {
    const suyas = porPersona.get(m.clave) || {};
    const marcas = {};
    let presentes = 0, justificados = 0, ausentes = 0;
    for (const dia of diasConReunion) {
      const estado = suyas[dia];
      // Un día con reunión en el que a esta persona no se le marcó nada cuenta
      // como falta: la lista se pasó y no estaba.
      marcas[dia] = LETRA[estado] || 'N';
      if (estado === 'Presente') presentes++;
      else if (estado === 'Justificado') justificados++;
      else ausentes++;
    }
    const total = diasConReunion.length;
    /*
     * El trato sale de la ficha de miembro entera —su género, su ficha
     * ministerial, la de su cónyuge—, así que hay que ir a buscarla. Quien no
     * está inscrito no lleva trato: no tiene ficha de donde sacarlo.
     */
    const suFicha = m.miembro_id
      ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(m.miembro_id)
      : null;
    const trato = suFicha ? tratamientoDe(suFicha, db) : '';
    return {
      n: i + 1,
      miembro_id: m.miembro_id || null,
      no_miembro_id: m.no_miembro_id || null,
      persona_tipo: m.persona_tipo,
      trato: ABREVIADO[trato] || trato,
      nombre: `${m.nombres || ''} ${m.apellidos || ''}`.trim(),
      marcas, total,
      presentes, justificados, ausentes,
      pct_presente: porcentaje(presentes, total),
      pct_justificado: porcentaje(justificados, total),
      pct_ausente: porcentaje(ausentes, total),
    };
  });

  // El pie: cómo estuvo cada día
  const porDia = {};
  for (const dia of diasConReunion) {
    let presentes = 0, justificados = 0, ausentes = 0;
    for (const p of integrantes) {
      if (p.marcas[dia] === 'S') presentes++;
      else if (p.marcas[dia] === 'J') justificados++;
      else ausentes++;
    }
    const total = integrantes.length;
    porDia[dia] = {
      integrantes: total, presentes, justificados, ausentes,
      pct_presente: porcentaje(presentes, total),
      pct_justificado: porcentaje(justificados, total),
      pct_ausente: porcentaje(ausentes, total),
    };
  }

  return {
    cuerpo: { id: cuerpo.id, nombre: cuerpo.nombre, tipo: cuerpo.tipo },
    mes, anio, numeroDeMes, dias, diasConReunion, integrantes, porDia,
  };
}

module.exports = { armar, mesValido, ABREVIADO };
