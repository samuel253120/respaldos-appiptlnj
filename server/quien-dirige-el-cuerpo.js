/**
 * Quién puede dirigir un cuerpo o un grupo.
 *
 * El módulo dice de sí mismo, desde que se escribió, que «a un cuerpo lo dirige
 * un miembro inscrito: es formal, y DE SUS INTEGRANTES SALE SU DIRECTIVA».
 * Nadie comprobaba ninguna de las dos cosas. Medido:
 *
 *   poner de líder a alguien que NO es integrante ..... 200
 *   el cuerpo queda con ........................ 0 integrantes y 1 líder
 *   poner de líder a un miembro de OTRA iglesia ....... 200
 *
 * Y había una asimetría al revés de como tenía que ser: al poner de encargado
 * de un GRUPO a alguien NO INSCRITO, el sistema sí comprobaba la iglesia y
 * contestaba «Esa persona está registrada en otra iglesia. Cada iglesia lleva a
 * los suyos». O sea, la regla más estricta se le aplicaba al caso más suelto
 * —el encargado informal de un grupo de servicio— y el líder formal de un
 * cuerpo, del que sale su directiva, no se comprobaba en absoluto.
 *
 * ── LA IGLESIA SE EXIGE, EL SER INTEGRANTE SE PREGUNTA ──
 *
 * No son la misma clase de cosa, y por eso no se tratan igual.
 *
 * LA IGLESIA SE FRENA. Un cuerpo es de una iglesia y su gente es de esa
 * iglesia: eso es lo que decide QUIÉN VE cada cosa suya (ver
 * server/alcance.js), así que un líder de otra congregación no es una
 * excepción legítima, es un dato mal puesto. Y ya se frenaba para el encargado
 * no inscrito de un grupo: lo que se hace acá es dejar de tratar mejor al caso
 * formal que al informal. Se dice con las MISMAS PALABRAS, porque es la misma
 * regla.
 *
 * SER INTEGRANTE SE PREGUNTA. Ahí sí hay casos legítimos, y son corrientes: el
 * cuerpo se está formando y todavía no tiene a nadie inscrito; alguien lo
 * dirige de manera interina mientras se designa a su directiva; el líder se
 * anota antes que su propia ficha de integrante. Frenarlo obligaría a hacer las
 * cosas en un orden que la organización no siempre puede seguir. Pero
 * preguntarlo pone a la vista lo que el módulo dice de sí mismo, en el momento
 * en que alguien lo está contradiciendo.
 *
 * ── Y VALE PARA LOS DOS REGISTROS ──
 *
 * Un líder sale de Miembros y un encargado de un grupo sale de No Miembros, y
 * las dos preguntas son las mismas: de qué iglesia es, y si pertenece al
 * cuerpo. Escritas una sola vez para los dos, no se puede volver a quedar una
 * mitad sin comprobar, que es exactamente lo que había pasado.
 */
const { VIGENTES } = require('./integrantes');

/** De qué registro sale cada uno, y cómo se llama su columna en el cuerpo. */
const DE_DONDE = {
  Miembro: { tabla: 'miembros', columna: 'miembro_id', comoSeLlama: 'líder' },
  'No miembro': { tabla: 'no_miembros', columna: 'no_miembro_id', comoSeLlama: 'encargado(a)' },
};

/** ¿Esta persona pertenece HOY a este cuerpo? Activos y en prueba, como en todo. */
function esIntegrante(db, cuerpoId, tipo, personaId) {
  if (!cuerpoId || !personaId) return false;
  const donde = DE_DONDE[tipo];
  if (!donde) return false;
  const marcas = VIGENTES.map(() => '?').join(',');
  return !!db
    .prepare(
      `SELECT 1 FROM integrantes_cuerpo
        WHERE cuerpo_id = ? AND persona_tipo = ? AND "${donde.columna}" = ?
          AND estado IN (${marcas})`
    )
    .get(cuerpoId, tipo, personaId, ...VIGENTES);
}

/**
 * El rechazo de que esa persona es de otra iglesia, o null.
 *
 * Las mismas palabras que ya usaba el encargado no inscrito de un grupo: es la
 * misma regla, y decirla distinto haría parecer que son dos.
 */
function avisoSiEsDeOtraIglesia(ficha, iglesiaId) {
  if (!ficha || !ficha.iglesia_id || !iglesiaId) return null;
  if (Number(ficha.iglesia_id) === Number(iglesiaId)) return null;
  return 'Esa persona está registrada en otra iglesia. Cada iglesia lleva a los suyos.';
}

/**
 * La pregunta de que quien lo dirige no pertenece al cuerpo, o null.
 *
 * Se pregunta solo cuando ESTE guardado cambia quién lo dirige. Corregirle el
 * teléfono a un cuerpo cuyo líder nunca fue integrante no vuelve a preguntar:
 * un aviso que sale siempre enseña a apretar «Está bien» sin leer.
 *
 * Y no se pregunta al CREAR el cuerpo, por lo evidente: un cuerpo recién
 * creado no tiene integrantes todavía, así que ahí el aviso saldría siempre y
 * no diría nada.
 */
function avisoSiNoEsIntegrante(db, { tipo, personaId, ficha, existing, confirmado }) {
  /*
   * Sin ficha anterior es un cuerpo que se está creando, y ésa es la puerta
   * por la que sale el caso del alta. Se preguntaba además por el id —«no
   * cuerpoId»— y era el mismo hecho dicho dos veces: al crear, el motor no
   * manda ni uno ni otro. Se quitó al comprobar que romper esa mitad no hacía
   * fallar ninguna prueba, y de paso el cuerpo se toma de la ficha anterior,
   * que es la única que lo sabe con seguridad.
   */
  if (confirmado) return null;
  if (!existing || !personaId) return null;
  const cuerpoId = existing.id;

  const donde = DE_DONDE[tipo];
  if (!donde) return null;

  // ¿Este guardado es el que lo está poniendo?
  const antes = existing[tipo === 'Miembro' ? 'lider_id' : 'lider_no_miembro_id'];
  const mismaPersona = String(antes || '') === String(personaId)
    && String(existing.lider_tipo || 'Miembro') === String(tipo);
  if (mismaPersona) return null;

  if (esIntegrante(db, cuerpoId, tipo, personaId)) return null;

  const nombre = `${(ficha && ficha.nombres) || ''} ${(ficha && ficha.apellidos) || ''}`.trim() || 'Esa persona';
  const cuantos = db
    .prepare(`SELECT COUNT(*) AS n FROM integrantes_cuerpo
               WHERE cuerpo_id = ? AND estado IN (${VIGENTES.map(() => '?').join(',')})`)
    .get(cuerpoId, ...VIGENTES).n;

  return {
    error:
      `${nombre} no figura entre los integrantes de este cuerpo`
      + (cuantos ? `, que hoy tiene ${cuantos}.` : ', que hoy no tiene ninguno.')
      + ' De los integrantes de un cuerpo sale su directiva, así que quien lo dirige normalmente es '
      + `uno de ellos. Si está de ${tipo === 'Miembro' ? 'interino' : 'encargado(a)'} mientras se `
      + 'designa a alguien, o todavía no se le anota su ficha de integrante, confirme; si no, '
      + 'agréguelo primero a los integrantes del cuerpo.',
    confirmar: 'quien_lo_dirige_no_es_integrante',
  };
}

module.exports = { DE_DONDE, esIntegrante, avisoSiEsDeOtraIglesia, avisoSiNoEsIntegrante };
