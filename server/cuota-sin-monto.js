/**
 * Un cuerpo que cobra cuota mensual y no dice de cuánto.
 *
 * Medido sobre la base de trabajo:
 *
 *   cuerpos que cobran cuota .......... 16 de 16
 *   de ésos, con el monto escrito ..... 0
 *   personas alcanzadas ............... 603
 *
 * Toda la membresía figuraba debiendo una cuota mensual de monto desconocido.
 * No es un defecto del programa: un cuerpo NACE COBRANDO —así se decidió en la
 * 1.219.0 y está bien, porque casi todos cobran— y el monto es otro campo, que
 * queda vacío hasta que alguien lo llene. El defecto era que nadie se enteraba.
 *
 * En la planilla de cuotas del cuerpo sí se veía —el sistema avisa «Falta el
 * monto» y no deja marcar pagos— pero había que entrar cuerpo por cuerpo para
 * saberlo, y ni el listado, ni el panel, ni el estado de cumplimiento lo
 * decían. Un dato que falta y que nadie ve es un dato que no se llena nunca.
 *
 * ── POR ESO EL ARREGLO ES QUE SE NOTE ──
 *
 * Tres lugares, y ninguno inventa nada: el mismo hecho, dicho donde se mira.
 *
 *   · el ESTADO DE CUMPLIMIENTO del cuerpo lo cuenta entre sus requisitos, al
 *     lado del reglamento y de la directiva vigente, y de ahí sale la etiqueta
 *     que el listado ya muestra;
 *   · el PANEL lo dice de todos juntos, con cuánta gente alcanza cada uno, y
 *     cada línea abre la ficha donde se arregla;
 *   · y ENCENDER la cuota sin poner el monto pregunta, en el momento en que
 *     alguien está tomando esa decisión.
 *
 * ── LO QUE NO SE HACE, Y POR QUÉ ──
 *
 * NO SE PREGUNTA AL CREAR el cuerpo, y es a propósito. Un cuerpo nace cobrando
 * por omisión, así que preguntarlo ahí sería un aviso en CADA cuerpo nuevo por
 * un valor que en ese momento casi nunca se sabe: el monto lo fija el cuerpo
 * cuando se reúne, no quien lo anota en el sistema. Este sistema ya aprendió
 * que un aviso que sale siempre no cuida el dato —enseña a apretar «Está bien»
 * sin leer (ver server/pastor-de-la-iglesia.js)—. El cuerpo recién creado
 * aparece igual en el panel y en su cumplimiento desde el primer día.
 *
 * Y NO SE PONE UN MONTO POR OMISIÓN. Sería inventar plata que nadie acordó, y
 * quedaría escrito como si alguien lo hubiera decidido.
 */

/** ¿Este cuerpo cobra cuota mensual? */
const cobra = (fila) => !!(fila && fila.cobra_cuota);

/** ¿Y no dice de cuánto? El cero y el vacío son lo mismo acá: no hay monto. */
const sinMonto = (fila) => !(Number(fila && fila.cuota_mensual) > 0);

/** ¿Le falta el monto de su cuota? */
const leFaltaElMonto = (fila) => cobra(fila) && sinMonto(fila);

/**
 * El aviso de que se está encendiendo la cuota sin decir de cuánto, o null.
 *
 * Se pregunta solo cuando ESTE guardado deja al cuerpo cobrando sin monto
 * habiendo cambiado algo de eso: encender la cuota, o borrar el monto de uno
 * que sí lo tenía. Corregirle el teléfono a un cuerpo que ya está así no
 * vuelve a preguntar —de eso se encargan el panel y el cumplimiento— y crear
 * uno nuevo tampoco, por lo que está explicado arriba.
 *
 * Se pregunta y no se prohíbe: no saber todavía cuánto va a cobrar un cuerpo
 * es una situación legítima y muy común. Lo que no puede pasar es que la
 * decisión se tome sin que nadie la vea.
 */
function avisoSiCobraSinMonto(data, { existing, confirmado }) {
  /*
   * Sin `existing` no hay nada que encender: es un cuerpo que se está creando,
   * y ésa es la puerta por la que sale el caso del alta. Se escribía
   * «isNew || !existing» y sobraba la mitad —al crear, el motor no manda
   * ningún `existing`—; se quitó al comprobar que romper esa mitad no hacía
   * fallar ninguna prueba, que es como se descubre que una defensa no está
   * defendiendo nada.
   */
  if (confirmado) return null;
  if (!existing) return null;

  const dato = (n) => (data[n] !== undefined ? data[n] : existing[n]);
  const quedaAsi = { cobra_cuota: dato('cobra_cuota'), cuota_mensual: dato('cuota_mensual') };
  if (!leFaltaElMonto(quedaAsi)) return null;

  // ¿Este guardado es el que lo dejó así, o ya venía de antes?
  const seEnciende = !cobra(existing) && cobra(quedaAsi);
  const seBorraElMonto = cobra(existing) && !sinMonto(existing) && sinMonto(quedaAsi);
  if (!seEnciende && !seBorraElMonto) return null;

  return {
    error:
      (seEnciende
        ? 'Está marcando que este cuerpo cobra cuota mensual, y no dice de cuánto. '
        : 'Está dejando sin monto la cuota mensual de este cuerpo, que sigue cobrando. ')
      + 'Mientras el monto esté vacío no se le puede registrar el pago a nadie: su planilla de cuotas '
      + 'queda a la vista pero no deja marcar nada, y todos sus integrantes figuran debiendo una cuota '
      + 'de monto desconocido. Si todavía no está acordado, confirme y póngalo después —va a aparecer '
      + 'en el panel y en su estado de cumplimiento hasta que lo ponga—.',
    confirmar: 'cobra_cuota_sin_monto',
  };
}

/**
 * Los cuerpos que cobran sin monto, con cuánta gente alcanza cada uno.
 *
 * Lo pide el panel. Se acota a lo que quien pregunta tiene asignado, como
 * todo lo demás: el secretario de un cuerpo ve el suyo, no los de la
 * organización entera.
 *
 * La gente se cuenta con los que PERTENECEN HOY —activos y en prueba—, que es
 * la misma definición que usa la planilla de cuotas para saber a quién
 * cobrarle (ver server/integrantes.js). Contar también a los retirados diría
 * un número más grande y falso.
 */
function losQueCobranSinMonto(db, usuario) {
  const { VIGENTES } = require('./integrantes');
  const params = [];
  const suyos = require('./alcance')
    .condiciones(require('./registry').getModule('cuerpos'), usuario, params);
  const marcas = VIGENTES.map(() => '?').join(',');

  /*
   * `cuerpos` es la ÚNICA tabla del FROM, y eso no es casual: el trozo de
   * alcance viene con los nombres de columna a secas —«id IN (…)»,
   * «iglesia_id IN (…)»— así que juntarla con `iglesias`, que también tiene
   * una columna `id`, dejaría la consulta ambigua. El nombre de la iglesia se
   * trae con una subconsulta, que no comparte el espacio de nombres.
   */
  return db
    .prepare(
      `SELECT id, nombre, tipo,
              (SELECT i.nombre FROM iglesias i WHERE i.id = cuerpos.iglesia_id) AS iglesia,
              (SELECT COUNT(*) FROM integrantes_cuerpo g
                WHERE g.cuerpo_id = cuerpos.id AND g.estado IN (${marcas})) AS integrantes
         FROM cuerpos
        WHERE cobra_cuota = 1 AND COALESCE(cuota_mensual, 0) <= 0
          ${suyos ? `AND ${suyos}` : ''}
        ORDER BY integrantes DESC, nombre`
    )
    .all(...VIGENTES, ...params);
}

module.exports = { cobra, sinMonto, leFaltaElMonto, avisoSiCobraSinMonto, losQueCobranSinMonto };
