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
 * aparece igual en su cumplimiento desde el primer día.
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
      + 'en su estado de cumplimiento hasta que lo ponga—.',
    confirmar: 'cobra_cuota_sin_monto',
  };
}

/*
 * ── LO QUE SE FUE DE ACÁ ──
 *
 * Vivía también `losQueCobranSinMonto`: la lista que armaba la tarjeta
 * «Cuotas sin monto definido» del panel de control. La corporación pidió sacar
 * esa tarjeta en la v1.393.0 y la consulta se fue con ella —una lista que
 * nadie mira se sigue armando en cada visita al panel—.
 *
 * Lo que la falta del monto significa se sigue diciendo en los tres lugares
 * donde se puede hacer algo al respecto: el guardado pregunta antes de dejar un
 * cuerpo cobrando sin decir cuánto (`avisoSiCobraSinMonto`), su estado de
 * cumplimiento lo marca (`leFaltaElMonto`, desde server/modules/cuerpos.js) y
 * su ficha y su hoja impresa dicen «sin monto definido».
 */

module.exports = { cobra, sinMonto, leFaltaElMonto, avisoSiCobraSinMonto };
