/**
 * Una cuenta cerrada no recibe plata nueva. En un solo lugar.
 *
 * «Cerrada» es un estado de las cuentas de tesorería y significa una cosa
 * concreta: el proyecto terminó, el cuerpo dejó de existir, la cuenta del banco
 * se cerró. De ahí en adelante no entra ni sale nada; lo que ya está anotado se
 * queda y se puede corregir, porque es historia y la historia no se toca.
 *
 * La regla estaba escrita —bien escrita— en tres archivos, y faltaba en los
 * otros dos. Cinco puertas escriben en la tabla `tesoreria`:
 *
 *   Tesorería, a mano ........... la tenía
 *   Traspasos entre cuentas ..... la tenía
 *   Ayudas Sociales ............. la tenía
 *   La ofrenda de un servicio ... NO la tenía
 *   La cuota de un integrante ... NO la tenía
 *
 * Medido sobre la base de trabajo, con las dos cuentas de una iglesia cerradas:
 * el ingreso escrito a mano se rechazaba con su explicación (400), y un
 * servicio con $ 400.000 de ofrenda se guardaba normal (201) y les metía la
 * plata igual. El saldo de la cuenta cerrada pasó de $ 250.000 a $ 610.000; el
 * fondo para la corporación, cerrado y en cero, quedó con $ 40.000; y la cuenta
 * de cuotas de un cuerpo, cerrada con $ 1.000, quedó con $ 4.000. Ninguna de
 * las dos operaciones dijo una palabra.
 *
 * Una regla copiada en cinco archivos es una regla que va a faltar en el sexto.
 * Acá está una vez, y los cinco preguntan.
 *
 * QUÉ SE DICE, SEGÚN LO QUE SE INTENTABA. No es lo mismo anotar un movimiento
 * que traspasar: en un traspaso hay dos cuentas y hay que decir cuál de las dos
 * es la que está cerrada y de qué lado.
 */

const MOTIVOS = {
  nuevo: 'no admite nuevos movimientos',
  entra: 'no puede entrar dinero en ella',
  sale: 'no puede salir dinero de ella',
};

/** ¿Esta cuenta admite plata nueva? Una que no existe, tampoco. */
function admitePlataNueva(cuenta) {
  return !!cuenta && cuenta.estado !== 'Cerrada';
}

/**
 * El aviso de que esa cuenta está cerrada, o null si admite plata nueva.
 *
 * `motivo` es una de las claves de MOTIVOS y elige la segunda mitad de la
 * frase. Una cuenta que no existe no da este aviso: eso es otro problema y lo
 * dice quien la fue a buscar.
 */
function avisoSiEstaCerrada(cuenta, motivo = 'nuevo') {
  if (!cuenta || admitePlataNueva(cuenta)) return null;
  return `La cuenta "${cuenta.nombre}" está cerrada: ${MOTIVOS[motivo] || MOTIVOS.nuevo}`;
}

/**
 * Las cuentas cerradas donde este movimiento automático querría escribir.
 *
 * Los dos puentes que anotan solos —la ofrenda de un servicio y la cuota de un
 * integrante— no eligen la cuenta: la buscan por su tipo. Acá se les contesta
 * cuáles de las que iban a usar están cerradas, para poder decirlo ANTES de
 * guardar y en la pantalla donde se está trabajando, que es la del servicio o
 * la de las cuotas, no la de Tesorería.
 *
 * `lados` es una lista de { cuenta, monto }: solo cuentan los que llevan plata.
 * Un lado en cero no va a escribir nada, así que no hay nada que avisar.
 */
function lasCerradasDe(lados) {
  const vistas = new Map();
  for (const lado of lados || []) {
    if (!lado || !(Number(lado.monto) > 0)) continue;
    if (admitePlataNueva(lado.cuenta)) continue;
    if (lado.cuenta) vistas.set(lado.cuenta.id, lado.cuenta);
  }
  return [...vistas.values()];
}

/** Cómo se nombran varias cuentas en una frase: «A», «A» y «B». */
function nombradas(cuentas) {
  const nombres = cuentas.map((c) => `«${c.nombre}»`);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

module.exports = { MOTIVOS, admitePlataNueva, avisoSiEstaCerrada, lasCerradasDe, nombradas };
