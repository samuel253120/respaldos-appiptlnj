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
const { DE_MEJOR_A_PEOR, LETRA_DE: LETRA } = require('./modules/asistencia_detalle');
/*
 * El peso sale del orden que declara el módulo de la marca, de mejor a peor:
 * el primero pesa más. Estaba escrito acá con sus tres números, y la letra
 * también, así que los tres estados vivían en cinco sitios y coincidían por
 * costumbre (v1.384.0).
 */
const PESO = Object.fromEntries(DE_MEJOR_A_PEOR.map((e, i) => [e, DE_MEJOR_A_PEOR.length - i]));

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

  /*
   * Sin las VISITAS. La planilla es el padrón del cuerpo mes a mes —una fila
   * por integrante—, y una visita no es integrante: sumarla le abriría una
   * fila a alguien que no está en el cuerpo y le movería el porcentaje del día
   * al pie de la columna. Su constancia queda en la lista de esa actividad y
   * en el informe, que las cuenta aparte.
   */
  const filas = db
    .prepare(
      `SELECT miembro_id, no_miembro_id, fecha, estado FROM asistencia_detalle
        WHERE cuerpo_id = ? AND fecha >= ? AND fecha <= ? AND COALESCE(visita, 0) = 0`
    )
    .all(cuerpo.id, primero, ultimo);

  /*
   * ── LOS DÍAS QUE VAN EN LA HOJA ──
   *
   * Son dos cosas distintas y hasta la v1.377.0 se contestaban con una sola:
   *
   *   · los días con LISTA PASADA, que son los que tienen marcas. De ellos
   *     cuelga toda la cuenta: la columna «T.», los porcentajes de cada
   *     integrante y el pie de cada día;
   *   · los días PROGRAMADOS, que tienen actividad y todavía no tienen lista.
   *
   * La hoja se armaba solo con los primeros, y esta hoja se imprime apaisada y
   * se lleva a la reunión: el mes que uno quiere imprimir para ir llenándolo a
   * mano es justamente el que no tiene ninguna marca. Medido en la v1.374.0
   * sobre el cuerpo con más actividades de junio —diez— la hoja salía con sus
   * cincuenta y un integrantes y CERO columnas.
   *
   * Los programados no entran en ninguna cuenta: un día en que no se pasó lista
   * no le baja el porcentaje a nadie. Van como columna en blanco, que es lo que
   * hay que llenar.
   */
  const programados = new Set(
    db
      .prepare(
        `SELECT fecha FROM asistencias
          WHERE fecha >= ? AND fecha <= ?
            AND EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value = ?)`
      )
      .all(primero, ultimo, cuerpo.id)
      .map((a) => Number(String(a.fecha).slice(8, 10)))
      .filter(Boolean)
  );

  /*
   * ── LO QUE LA HOJA NO PUEDE MOSTRAR, Y LO DICE ──
   *
   * La consulta de arriba pide las marcas de ESTE cuerpo, así que una marca sin
   * cuerpo anotado no entra —no se sabe de quién es la fila— y hasta la
   * v1.379.0 desaparecía sin una palabra. El sistema repara esas marcas al
   * arrancar, pero su propio aviso reconoce que hay casos que no puede
   * resolver, y una copia restaurada o una planilla importada traen los suyos.
   *
   * Se cuentan las de las actividades que convocaron a este cuerpo, que son las
   * que uno esperaría ver en esta hoja, y la hoja lo dice al pie. No se
   * inventan filas ni se reparten entre los integrantes: no se sabe de quién
   * son, y una hoja que se firma no puede decir lo que no sabe.
   */
  const sinCuerpo = db
    .prepare(
      `SELECT COUNT(*) AS n FROM asistencia_detalle d
         JOIN asistencias a ON a.id = d.asistencia_id
        WHERE d.cuerpo_id IS NULL AND d.fecha >= ? AND d.fecha <= ?
          AND COALESCE(d.visita, 0) = 0
          AND EXISTS (SELECT 1 FROM json_each(a.cuerpos) WHERE json_each.value = ?)`
    )
    .get(primero, ultimo, cuerpo.id).n;

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
  // Los que están esperando su lista: los programados que todavía no la tienen
  const diasProgramados = [...programados].filter((d) => !conReunion.has(d)).sort((a, b) => a - b);
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
    mes, anio, numeroDeMes, dias, diasConReunion, diasProgramados, integrantes, porDia, sinCuerpo,
  };
}

module.exports = { armar, mesValido, ABREVIADO };
