/**
 * Los cuerpos que hoy no tienen quién los dirija, o están por quedarse sin.
 *
 * Medido sobre la base de trabajo, antes de esto:
 *
 *   cuerpos y grupos ............................ 17
 *   con directiva en ejercicio .................. 0
 *   SIN directiva en ejercicio .................. 17
 *   bloques del panel que lo nombran ............ 0
 *   fichas que había que abrir para saberlo ..... 17
 *
 * El panel avisa de credenciales por vencer, de credenciales de quienes ya no
 * ejercen y de cuerpos que cobran cuota sin monto —los tres por la misma razón:
 * son cosas que piden HACER algo y no se notan por ningún otro lado— y no decía
 * una palabra de las directivas. El estado de cumplimiento de cada cuerpo sí lo
 * dice, pero hay que entrar cuerpo por cuerpo, y un dato que solo se ve así es
 * un dato que no se arregla nunca. Es la misma lección de la cuota sin monto
 * (ver server/cuota-sin-monto.js).
 *
 * ── Y ADEMÁS SE VENCE SOLO ──
 *
 * Ésta es la diferencia con los otros avisos del panel, y es lo que la hace
 * valer más: una cuota sin monto se queda sin monto hasta que alguien lo
 * escriba, pero una directiva EN EJERCICIO SE VENCE SIN QUE NADIE TOQUE NADA.
 * Un cuerpo que ayer estaba perfecto amanece sin quién lo dirija porque pasó un
 * día. Por eso la lista trae las dos cosas —las que ya se vencieron y las que
 * están por vencerse—, igual que las credenciales: el aviso anticipado es el
 * que sirve, porque elegir una directiva toma semanas.
 *
 * ── A QUIÉNES SE LES PIDE ──
 *
 * Solo a los CUERPOS y solo a los que FUNCIONAN. Un grupo no elige directiva
 * —«agrupación de servicio o ayuda, sin reglamento ni obligaciones formales»,
 * lo dice su propio campo— y su estado de cumplimiento ya contesta «No aplica».
 * Y a un cuerpo marcado inactivo no se le reprocha no tener directiva: dejó de
 * funcionar, que es justamente lo que ese estado significa (ver
 * server/cuerpo-inactivo.js). Reprocharle a alguien algo que no está en sus
 * manos o que no corresponde es la manera más rápida de que deje de leer los
 * avisos.
 *
 * ── QUIÉN GOBIERNA LO DICE UN SOLO ARCHIVO ──
 *
 * De acá NO sale una segunda definición de «directiva vigente». Se le pregunta
 * a server/directiva-en-ejercicio.js, que es donde vive la única, y lo que este
 * archivo agrega es el PORQUÉ: si nunca tuvo, si la suya terminó y cuándo, o si
 * hay una electa esperando para asumir. Sin el porqué, la lista dice diecisiete
 * veces lo mismo y no se puede decidir por dónde empezar.
 */
const { hoy, comoSeLee } = require('./fechas');
const enEjercicio = require('./directiva-en-ejercicio');

/** Cuántos días de anticipación. Lo fija Configuración, como el de las credenciales. */
const diasDeAviso = () => require('./ajustes').numero('directiva_aviso_dias', 7, 365);

/** Días entre dos fechas ISO, en positivo si la segunda es posterior. */
function diasEntre(desde, hasta) {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** «hace 3 días» · «ayer» · «hoy» · «en 12 días». */
function cuantoFalta(dias) {
  if (dias === null) return '';
  if (dias === 0) return 'hoy mismo';
  if (dias === 1) return 'mañana';
  if (dias === -1) return 'ayer';
  return dias > 0 ? `en ${dias} días` : `hace ${-dias} días`;
}

/**
 * Qué le pasa a este cuerpo, en palabras, o null si no le pasa nada.
 *
 * `sus` son TODAS las directivas del cuerpo, ya traídas: se le pasan hechas
 * para no volver a la base una vez por cuerpo y por pregunta.
 */
function loQueLePasa(db, cuerpoId, sus, cuando = hoy(), dias = diasDeAviso()) {
  const dirige = enEjercicio.laQueEjerce(db, cuerpoId, cuando);

  /*
   * Una electa cambia el tono de todo lo demás: un cuerpo que se quedó sin
   * directiva la semana pasada y ya tiene electa la que asume el lunes no está
   * en el mismo problema que uno que no tiene nada. Se dice, y se dice cuándo.
   */
  const electa = sus
    .filter((d) => d.estado !== enEjercicio.CERRADA && d.fecha_inicio && d.fecha_inicio > cuando)
    .sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)))[0];
  const laQueViene = electa
    ? ` Hay una electa que asume el ${comoSeLee(electa.fecha_inicio)}.`
    : '';

  if (dirige) {
    /*
     * `faltan` en nulo es la directiva SIN FECHA DE TÉRMINO: no vence nunca, así
     * que no hay día del que avisar y no entra acá. Eso lo dice el estado de
     * cumplimiento del cuerpo, que tiene un requisito escrito para exactamente
     * eso. Antes había además un `if (!dirige.fecha_termino) return null` arriba
     * de esta línea; se quitó al comprobar que romperlo no hacía fallar ninguna
     * prueba —esta comparación ya decidía lo mismo—, que es como se descubre
     * que una defensa no está defendiendo nada.
     */
    const faltan = diasEntre(cuando, dirige.fecha_termino);
    if (faltan === null || faltan > dias) return null;
    return {
      nivel: 'por vencer',
      periodo: dirige.periodo || '',
      cuando: dirige.fecha_termino,
      situacion: `Su directiva termina ${cuantoFalta(faltan)}, el ${comoSeLee(dirige.fecha_termino)}.${laQueViene}`,
    };
  }

  if (!sus.length) {
    return { nivel: 'sin', periodo: '', cuando: null,
      situacion: 'Nunca se le ha anotado una directiva.' };
  }

  /*
   * Tiene directivas y ninguna gobierna. Se dice cuál fue la última que lo
   * hizo, que es el dato con el que alguien decide si esto es de la semana
   * pasada o de hace seis años.
   */
  const terminadas = sus
    .filter((d) => d.fecha_termino && d.fecha_termino < cuando)
    .sort((a, b) => String(b.fecha_termino).localeCompare(String(a.fecha_termino)));
  if (terminadas.length) {
    const ultima = terminadas[0];
    const desde = diasEntre(cuando, ultima.fecha_termino);
    return {
      nivel: 'sin', periodo: ultima.periodo || '', cuando: ultima.fecha_termino,
      situacion: `Su directiva terminó ${cuantoFalta(desde)}, el ${comoSeLee(ultima.fecha_termino)}`
        + `${ultima.periodo ? ` (período ${ultima.periodo})` : ''}.${laQueViene}`,
    };
  }

  /*
   * Quedan dos casos que no son «se venció»: las que alguien cerró a mano y las
   * que todavía no asumen. Un cuerpo cuya única directiva es la electa del año
   * que viene HOY no tiene quién lo dirija, y decirlo así es más útil que
   * meterlo en la misma bolsa que uno abandonado.
   */
  if (electa) {
    return { nivel: 'sin', periodo: electa.periodo || '', cuando: electa.fecha_inicio,
      situacion: `Todavía no asume ninguna: la electa empieza el ${comoSeLee(electa.fecha_inicio)}.` };
  }
  return { nivel: 'sin', periodo: '', cuando: null,
    situacion: 'Ninguna de las directivas anotadas está dirigiendo hoy.' };
}

/**
 * La lista para el panel, acotada a lo que quien pregunta tiene asignado.
 *
 * Trae de cada uno lo que hace falta para decidir: su iglesia, a cuánta gente
 * alcanza y qué le pasa. Primero los que ya no tienen quién los dirija —de
 * mayor a menor cantidad de gente— y después los que están por quedarse sin,
 * por orden de vencimiento: lo que ya pasó pesa más que lo que va a pasar, y
 * dentro de cada grupo pesa más lo que alcanza a más personas.
 */
function losQueSeQuedanSinDirectiva(db, usuario, cuando = hoy()) {
  const { VIGENTES } = require('./integrantes');
  const inactivo = require('./cuerpo-inactivo');
  const params = [];
  const suyos = require('./alcance')
    .condiciones(require('./registry').getModule('cuerpos'), usuario, params);
  const marcas = VIGENTES.map(() => '?').join(',');

  /*
   * `cuerpos` como única tabla del FROM, igual que en la cuota sin monto: el
   * trozo de alcance viene con los nombres de columna a secas —«id IN (…)»— y
   * juntarla con `iglesias`, que también tiene un `id`, dejaría la consulta
   * ambigua. El nombre de la iglesia se trae con una subconsulta.
   */
  const cuerpos = db
    .prepare(
      `SELECT id, nombre, tipo, estado,
              (SELECT i.nombre FROM iglesias i WHERE i.id = cuerpos.iglesia_id) AS iglesia,
              (SELECT COUNT(*) FROM integrantes_cuerpo g
                WHERE g.cuerpo_id = cuerpos.id AND g.estado IN (${marcas})) AS integrantes
         FROM cuerpos
        WHERE tipo = 'Cuerpo' ${suyos ? `AND ${suyos}` : ''}`
    )
    .all(...VIGENTES, ...params)
    .filter((c) => inactivo.funciona(c));

  if (!cuerpos.length) return [];

  // Las directivas de todos ellos de una vez, y no una consulta por cuerpo
  const huecos = cuerpos.map(() => '?').join(',');
  const porCuerpo = new Map(cuerpos.map((c) => [c.id, []]));
  for (const d of db
    .prepare(`SELECT * FROM directivas WHERE cuerpo_id IN (${huecos})`)
    .all(...cuerpos.map((c) => c.id))) {
    const suyas = porCuerpo.get(d.cuerpo_id);
    if (suyas) suyas.push(d);
  }

  const dias = diasDeAviso();
  const lista = [];
  for (const c of cuerpos) {
    const que = loQueLePasa(db, c.id, porCuerpo.get(c.id) || [], cuando, dias);
    if (que) lista.push({ ...c, ...que });
  }

  return lista.sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'sin' ? -1 : 1;
    if (a.nivel === 'sin') return (b.integrantes || 0) - (a.integrantes || 0);
    return String(a.cuando || '').localeCompare(String(b.cuando || ''));
  });
}

module.exports = { losQueSeQuedanSinDirectiva, loQueLePasa, diasEntre, cuantoFalta, diasDeAviso };
