/**
 * ¿Esta caja está vacía, o tiene algo anotado?
 *
 * La pregunta la hacen DOS reglas de borrado, y tiene que contestarse igual en
 * las dos: la de una iglesia que todavía no ha sido nada (1.233.0, ver
 * server/iglesia-vacia.js) y la de un cuerpo recién creado (ver
 * server/cuerpo-vacio.js). Las dos existen por lo mismo: el sistema le abre
 * sus cuentas al crearlo —está así a propósito y es correcto— y después se
 * negaba a borrarlo por culpa de las cuentas que él mismo había abierto.
 *
 * No se pregunta QUIÉN abrió la caja, se pregunta si TIENE ALGO. Una caja sin
 * movimientos, sin traspasos por ninguno de sus dos lados, sin deudas y sin
 * saldo con que empezar es un casillero vacío. Con cualquiera de esas cuatro
 * cosas hay plata anotada, y la plata frena el borrado como en cualquier otra
 * parte del sistema.
 *
 * Estaba escrita una sola vez, dentro de la regla de la iglesia, y contaba
 * tres de las cuatro: las DEUDAS son de la 1.247.0 y aquella regla es de la
 * 1.233.0, así que una caja con una deuda viva y sin un solo movimiento
 * contaba como vacía. No llegaba a romper nada —el borrado se frenaba igual,
 * un eslabón más adelante, cuando la cascada topaba con `deudas.cuenta_id`—
 * pero el aviso hablaba de la caja y no de la deuda, que es lo que de verdad
 * lo impedía. Al escribir la del cuerpo se puso acá, para que las dos
 * pregunten lo mismo y una no se quede atrás la próxima vez.
 */

/** ¿Esta caja no tiene nada anotado? Recibe la fila, no el id. */
function estaVacia(db, cuenta) {
  if (!cuenta) return true;
  if (Number(cuenta.saldo_inicial || 0) !== 0) return false;

  const cuantas = (sql, ...params) => db.prepare(sql).get(...params).n;
  if (cuantas('SELECT COUNT(*) AS n FROM tesoreria WHERE cuenta_id = ?', cuenta.id)) return false;
  if (cuantas(
    'SELECT COUNT(*) AS n FROM traspasos WHERE cuenta_origen_id = ? OR cuenta_destino_id = ?',
    cuenta.id, cuenta.id
  )) return false;

  /*
   * Las deudas se preguntan con cuidado: la tabla es de la 1.247.0 y esta
   * regla corre también sobre bases que vienen de antes, donde todavía no
   * existe. Sin tabla no hay deudas que contar, que es la respuesta correcta.
   */
  try {
    if (cuantas('SELECT COUNT(*) AS n FROM deudas WHERE cuenta_id = ?', cuenta.id)) return false;
  } catch (e) { /* la tabla se crea al arrancar */ }

  return true;
}

module.exports = { estaVacia };
