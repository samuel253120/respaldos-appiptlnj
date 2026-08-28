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
 *
 * ── QUÉ ES UN SALDO ──
 *
 * Lo que hay en la cuenta HOY, no lo que va a haber. La diferencia no era
 * teórica: un servicio sí se puede agendar —está pensado así— y su ofrenda
 * entra a Tesorería con la fecha del servicio. Medido en una cuenta recién
 * creada, sin nada anotado:
 *
 *   movimiento a mano con fecha 11-06-2028 ....  rechazado, con su motivo
 *   servicio agendado para el 11-06-2028 ......  guardado, deja 2 movimientos
 *   saldo de la cuenta, hoy ...................  $ 405.000
 *   plata que de verdad hay en la caja ........  $ 0
 *   egreso de $ 300.000 hecho hoy .............  aceptado sin preguntar
 *
 * Ese último renglón es lo que costaba: el aviso de «esto deja la cuenta en
 * rojo» se calcula sobre el mismo saldo, así que una cuenta vacía parecía tener
 * con qué pagar porque contaba una ofrenda de dos años más adelante.
 *
 * Por eso el saldo se corta en el día de hoy, y lo que está anotado más
 * adelante se dice aparte, como «agendado». Los movimientos no se tocan: son
 * el registro correcto de algo con fecha, y el día que esa fecha llegue entran
 * al saldo solos, sin que nadie tenga que hacer nada.
 */
const { db } = require('./db');
const { normalizar, comoSeLee } = require('./fechas');

/**
 * Lo que ya ocurrió, y lo que todavía no.
 *
 * En SQL y no en JavaScript porque así el corte es el mismo para las cuatro
 * consultas que calculan un saldo, y porque `date('now','localtime')` toma la
 * zona horaria configurada —la misma que usa el resto del sistema— sin que
 * haya que pasarle la fecha de hoy a cada una (ver server/zona-horaria.js).
 */
const YA_OCURRIO = "fecha <= date('now','localtime')";
const AGENDADO = "fecha > date('now','localtime')";

/** Lo anotado más adelante en una cuenta: cuánto suma y cuántos movimientos son. */
function loAgendadoDe(cuentaId, base = db) {
  return base
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END), 0) AS neto,
         COUNT(*) AS movimientos,
         MIN(fecha) AS primera
       FROM tesoreria WHERE cuenta_id = ? AND ${AGENDADO}`
    )
    .get(cuentaId) || { neto: 0, movimientos: 0, primera: null };
}

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/**
 * El saldo que tendría la cuenta contando este movimiento, al día que se diga.
 *
 * `alDia` es la fecha hasta la que se cuenta; por omisión, hoy. Lo anotado más
 * adelante no entra: un saldo es lo que hay a esa fecha.
 *
 * `excluyendo` deja fuera los movimientos que este guardado va a reemplazar:
 * al corregir un egreso, el que estaba guardado ya no cuenta —lo que cuenta es
 * el nuevo—, y al corregir un traspaso, sus dos lados se rehacen enteros.
 */
function saldoResultante(cuentaId, { tipo, monto, fecha, alDia, excluirMovimiento, excluirTraspaso } = {}) {
  const cuenta = db.prepare('SELECT saldo_inicial FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  if (!cuenta) return null;

  const condiciones = ['cuenta_id = ?'];
  const params = [cuentaId];
  if (alDia) {
    condiciones.push('fecha <= ?');
    params.push(alDia);
  } else {
    condiciones.push(YA_OCURRIO);
  }
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

  /*
   * El movimiento que se está guardando solo cuenta si su fecha cae dentro del
   * corte. Un egreso con fecha del próximo año no cambia lo que hay hoy.
   */
  const cuenta_este = !fecha || !alDia || fecha <= alDia;
  const delta = !cuenta_este ? 0 : tipo === 'Ingreso' ? Number(monto) || 0 : -(Number(monto) || 0);
  return (Number(cuenta.saldo_inicial) || 0) + s + delta;
}

/** El día de hoy en la zona configurada, preguntado a la misma base que hace el corte. */
const hoy = () => db.prepare("SELECT date('now','localtime') AS d").get().d;

/**
 * El aviso si esto deja la cuenta en rojo, o null si no.
 *
 * Se mira en dos momentos, no en uno: **el día del movimiento** y **hoy**. Con
 * uno solo quedaba un hueco por cada lado. Un egreso fechado el año que viene no
 * cambia lo que hay hoy, así que mirando solo hoy nunca se avisaría de él; y un
 * egreso fechado el año pasado puede haber cabido entonces y no caber ahora,
 * así que mirando solo su fecha tampoco. Se avisa por el peor de los dos, y
 * cuando no es hoy se dice de qué día se está hablando.
 *
 * Se devuelve como objeto con `confirmar` para que el motor lo distinga de un
 * error de verdad: la pantalla lo convierte en una pregunta con dos botones en
 * vez de en un rechazo (ver server/crud.js y public/app.js).
 */
function avisoSiQuedaEnRojo(cuentaId, { tipo, monto, fecha, excluirMovimiento, excluirTraspaso, queEs = 'Este egreso' } = {}) {
  if (tipo === 'Ingreso') return null;

  const hoyEs = hoy();
  const suDia = normalizar(fecha);
  // Su día y hoy. Si es el mismo, se mira una sola vez.
  const dias = [suDia || hoyEs];
  if (dias[0] !== hoyEs) dias.push(hoyEs);

  let peor = null;
  for (const dia of dias) {
    const queda = saldoResultante(cuentaId, {
      tipo, monto, fecha: suDia, alDia: dia, excluirMovimiento, excluirTraspaso,
    });
    if (queda === null || queda >= 0) continue;
    if (!peor || queda < peor.queda) peor = { dia, queda };
  }
  if (!peor) return null;

  const cuenta = db.prepare('SELECT nombre FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  const antes = saldoResultante(cuentaId, {
    tipo, monto: 0, fecha: suDia, alDia: peor.dia, excluirMovimiento, excluirTraspaso,
  });
  const cuando = peor.dia === hoyEs ? '' : ` al ${comoSeLee(peor.dia)}`;

  return {
    error:
      `${queEs} deja la cuenta "${(cuenta && cuenta.nombre) || cuentaId}" en ${enPesos(peor.queda)}${cuando}. ` +
      `Ahí hay ${enPesos(antes)} y se están sacando ${enPesos(monto)}. ` +
      'Revise si se le fue un dígito. Si es correcto, confirme y se guarda igual.',
    confirmar: 'saldo_negativo',
  };
}

module.exports = { saldoResultante, avisoSiQuedaEnRojo, loAgendadoDe, YA_OCURRIO, AGENDADO };
