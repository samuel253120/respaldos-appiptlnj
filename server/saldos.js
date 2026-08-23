/**
 * Cuánto va a quedar en la cuenta después de guardar esto.
 *
 * La tesorería está bien armada: los saldos cuadran, los traspasos mueven las
 * dos cuentas y borrar un traspaso devuelve los saldos al peso. Lo que no
 * revisaba era si el número tiene sentido. Se comprobó:
 *
 *   saldo de la cuenta ....................  70.000
 *   egreso de 9.000.000 ...................  aceptado, saldo queda en −8.930.000
 *   traspaso de 5.000.000 a otra cuenta ...  aceptado, origen queda en −4.930.000
 *
 * El caso real no es el fraude, es el cero de más: alguien escribe 900.000
 * donde iban 90.000. El saldo negativo aparece en pantalla como cualquier otro
 * número y nada indica que algo esté mal hasta que se cuadra la caja a mano.
 *
 * Por eso esto **avisa y pregunta**, no bloquea. Una cuenta puede quedar en
 * rojo de verdad —se pagó algo antes de que entrara lo que lo cubría— y el
 * sistema no está para discutirle eso a la tesorera. Lo que no puede es dejar
 * pasar en silencio un egreso ciento veintisiete veces más grande que el saldo.
 *
 * Quien confirma manda: el guardado se repite con `igual_asi` y entra tal cual.
 */
const { db } = require('./db');

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/**
 * El saldo que tendría la cuenta contando este movimiento.
 *
 * `excluyendo` deja fuera los movimientos que este guardado va a reemplazar:
 * al corregir un egreso, el que estaba guardado ya no cuenta —lo que cuenta es
 * el nuevo—, y al corregir un traspaso, sus dos lados se rehacen enteros.
 */
function saldoResultante(cuentaId, { tipo, monto, excluirMovimiento, excluirTraspaso } = {}) {
  const cuenta = db.prepare('SELECT saldo_inicial FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  if (!cuenta) return null;

  const condiciones = ['cuenta_id = ?'];
  const params = [cuentaId];
  if (excluirMovimiento) {
    condiciones.push('id != ?');
    params.push(excluirMovimiento);
  }
  if (excluirTraspaso) {
    condiciones.push('(traspaso_id IS NULL OR traspaso_id != ?)');
    params.push(excluirTraspaso);
  }

  const { s } = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END), 0) AS s
         FROM tesoreria WHERE ${condiciones.join(' AND ')}`
    )
    .get(...params);

  const delta = tipo === 'Ingreso' ? Number(monto) || 0 : -(Number(monto) || 0);
  return (Number(cuenta.saldo_inicial) || 0) + s + delta;
}

/**
 * El aviso si esto deja la cuenta en rojo, o null si no.
 *
 * Se devuelve como objeto con `confirmar` para que el motor lo distinga de un
 * error de verdad: la pantalla lo convierte en una pregunta con dos botones en
 * vez de en un rechazo (ver server/crud.js y public/app.js).
 */
function avisoSiQuedaEnRojo(cuentaId, { tipo, monto, excluirMovimiento, excluirTraspaso, queEs = 'Este egreso' } = {}) {
  if (tipo === 'Ingreso') return null;

  const queda = saldoResultante(cuentaId, { tipo, monto, excluirMovimiento, excluirTraspaso });
  if (queda === null || queda >= 0) return null;

  const cuenta = db.prepare('SELECT nombre FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  const antes = saldoResultante(cuentaId, { tipo, monto: 0, excluirMovimiento, excluirTraspaso });

  return {
    error:
      `${queEs} deja la cuenta "${(cuenta && cuenta.nombre) || cuentaId}" en ${enPesos(queda)}. ` +
      `Ahí hay ${enPesos(antes)} y se están sacando ${enPesos(monto)}. ` +
      'Revise si se le fue un dígito. Si es correcto, confirme y se guarda igual.',
    confirmar: 'saldo_negativo',
  };
}

module.exports = { saldoResultante, avisoSiQuedaEnRojo };
