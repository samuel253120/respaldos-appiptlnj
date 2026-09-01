/**
 * Lo que una deuda deja en el libro de la plata.
 *
 * El sistema ya sabía hacer esto en otras tres partes —la ofrenda de un
 * servicio, la cuota de un integrante y una ayuda social entregada—: el hecho
 * vive en su módulo y el movimiento aparece solo en Tesorería, enlazado en los
 * dos sentidos, para que nadie lo anote dos veces ni pueda quedar descuadrado.
 * Este puente es el mismo mecanismo por cuarta vez.
 *
 * UNA DEUDA DEJA DOS CLASES DE MOVIMIENTO:
 *
 *   EL DESEMBOLSO   la plata que se recibe al contraerla —o que se entrega, si
 *                   la organización es la que presta—. Es UNO solo, y no todas
 *                   las deudas lo tienen: una COMPRA A CRÉDITO no mueve un peso
 *                   al contraerse, porque llega la cosa y queda el compromiso.
 *
 *   LOS PAGOS       cada cuota que se paga, o cada abono a cuenta. Son los que
 *                   van saldando la deuda, y de sumarlos sale cuánto falta.
 *
 * LOS SIGNOS SALEN DE LA DIRECCIÓN, y son opuestos entre sí:
 *
 *   Por pagar   → el desembolso ENTRA (ingreso) y los pagos SALEN (egresos)
 *   Por cobrar  → el desembolso SALE  (egreso)  y los cobros ENTRAN (ingresos)
 *
 * Así, `tipo` basta para distinguir un desembolso de un pago sin una columna
 * que lo diga… salvo en un caso: una deuda sin desembolso donde alguien
 * devuelve plata. Por eso el movimiento del desembolso lleva su marca propia,
 * y no se deduce.
 *
 * EL MOVIMIENTO ES DE LA DEUDA: se crea, se corrige y se retira con ella, y no
 * se edita por separado en Tesorería. Es la misma regla que ya rige para los
 * dos lados de un traspaso y para el egreso de una ayuda.
 *
 * ── Y SI LA DEUDA ES CON OTRA CAJA DE LA ORGANIZACIÓN, SON DOS ──
 *
 * Un préstamo entre dos partes de la misma organización no hace entrar ni salir
 * plata: la cambia de bolsillo. Medido antes de esto, prestándole $ 400.000 de
 * la caja de una iglesia a la de un cuerpo: la que recibe pasó de $ 50.000 a
 * $ 450.000 y la que presta se quedó en $ 100.000 —seguía mostrando una plata
 * que ya no tenía— y el total de la organización subió $ 400.000 que nadie le
 * había entregado a nadie.
 *
 * Así que cada movimiento de una deuda interna lleva SU ESPEJO en la otra caja,
 * con el signo contrario, y los dos van marcados como traslado. De ahí en
 * adelante manda el mecanismo que el sistema ya tenía (ver
 * server/entre-cuentas.js): mirando toda la organización los dos lados están a
 * la vista y el par se descuenta —no entró nada—; mirando una sola de las dos
 * cajas queda un lado solo, y ahí esa plata sí entró o sí salió, que es lo que
 * de verdad le pasó a esa caja.
 *
 * CÓMO SE RECONOCE UN PAR. Las dos filas llevan en `espejo_de` el id del
 * movimiento ORIGINAL, así que el original es el que tiene `espejo_de = id` y
 * el espejo es el otro. Con una sola columna se sabe quiénes son pareja y cuál
 * de los dos manda, y las consultas que suman lo pagado descartan los espejos
 * con esa misma comparación: sin eso, cada pago se contaría dos veces.
 */

const { POR_PAGAR, OTRA_CAJA } = require('./modules/deudas');

/** Las categorías con que se anotan. Vienen de fábrica en Categorías de Tesorería. */
const CATEGORIA_DESEMBOLSO = 'Préstamos recibidos';
const CATEGORIA_PAGO = 'Pago de deudas';
const CATEGORIA_COBRO = 'Cobro de préstamos';
const CATEGORIA_PRESTADO = 'Préstamos entregados';

const NOTA = 'Movimiento generado por Deudas y Compromisos.';

/** ¿Es entre dos cajas del propio sistema? */
function esInterna(deuda) {
  return !!deuda && deuda.contraparte_tipo === OTRA_CAJA && !!deuda.contraparte_cuenta_id;
}

/** El original de un par, y no su espejo. Lo usan todas las lecturas. */
const SIN_ESPEJOS = '(espejo_de IS NULL OR espejo_de = id)';

/** El espejo de este movimiento, si lo tiene. */
function elEspejoDe(db, movimientoId) {
  return db
    .prepare('SELECT * FROM tesoreria WHERE espejo_de = ? AND id <> ?')
    .get(movimientoId, movimientoId) || null;
}

/**
 * Deja el movimiento del otro lado al día: lo crea, lo corrige o lo retira.
 *
 * Se llama después de escribir el movimiento propio, con la fila ya guardada.
 * Si la deuda dejó de ser interna —le cambiaron la contraparte a una persona—
 * el espejo se retira y el original deja de estar marcado como traslado.
 */
function ponerElEspejo(db, movimiento, deuda) {
  const ya = elEspejoDe(db, movimiento.id);

  if (!esInterna(deuda)) {
    if (ya) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(ya.id);
    db.prepare('UPDATE tesoreria SET entre_cuentas = 0, espejo_de = NULL WHERE id = ?').run(movimiento.id);
    return { creado: false, corregido: false, retirado: !!ya };
  }

  const otra = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(deuda.contraparte_cuenta_id);
  if (!otra) return { creado: false, corregido: false, retirado: false };

  // El original queda marcado y apuntándose a sí mismo: así el par se reconoce
  // desde cualquiera de las dos filas con una sola columna.
  db.prepare('UPDATE tesoreria SET entre_cuentas = 1, espejo_de = id WHERE id = ?').run(movimiento.id);

  const alReves = movimiento.tipo === 'Ingreso' ? 'Egreso' : 'Ingreso';
  const concepto = `${movimiento.concepto} (con ${otra.nombre})`;

  if (!ya) {
    db.prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, comprobante, cuenta_id,
                              iglesia_id, cuerpo_id, notas, deuda_id, cuota_id, desembolso,
                              entre_cuentas, espejo_de, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      movimiento.fecha, alReves, movimiento.categoria, concepto, movimiento.monto,
      movimiento.metodo, movimiento.comprobante || null, otra.id,
      otra.iglesia_id || null, otra.cuerpo_id || null, NOTA, deuda.id,
      movimiento.cuota_id || null, movimiento.desembolso, movimiento.id, movimiento.created_by || null
    );
    return { creado: true, corregido: false, retirado: false };
  }

  db.prepare(
    `UPDATE tesoreria SET fecha = ?, tipo = ?, categoria = ?, concepto = ?, monto = ?, metodo = ?,
                          comprobante = ?, cuenta_id = ?, iglesia_id = ?, cuerpo_id = ?,
                          cuota_id = ? WHERE id = ?`
  ).run(
    movimiento.fecha, alReves, movimiento.categoria, concepto, movimiento.monto,
    movimiento.metodo, movimiento.comprobante || null, otra.id,
    otra.iglesia_id || null, otra.cuerpo_id || null, movimiento.cuota_id || null, ya.id
  );
  return { creado: false, corregido: true, retirado: false };
}

/** ¿Esta clase de deuda entrega o recibe plata al contraerse? */
function tieneDesembolso(deuda) {
  return !!deuda && deuda.clase !== 'Compra a crédito';
}

/** El tipo de movimiento del desembolso y el de sus pagos. */
function losSignosDe(deuda) {
  return deuda && deuda.direccion === POR_PAGAR
    ? { desembolso: 'Ingreso', pago: 'Egreso' }
    : { desembolso: 'Egreso', pago: 'Ingreso' };
}

/** Con qué categoría se anota cada uno. */
function laCategoriaDe(deuda, esDesembolso) {
  const porPagar = !deuda || deuda.direccion === POR_PAGAR;
  if (esDesembolso) return porPagar ? CATEGORIA_DESEMBOLSO : CATEGORIA_PRESTADO;
  return porPagar ? CATEGORIA_PAGO : CATEGORIA_COBRO;
}

/** El movimiento del desembolso de esta deuda, si lo tiene. */
function elDesembolsoDe(db, deudaId) {
  return db
    .prepare(`SELECT * FROM tesoreria WHERE deuda_id = ? AND desembolso = 1 AND ${SIN_ESPEJOS}`)
    .get(deudaId) || null;
}

/** Los pagos anotados contra esta deuda. */
function losPagosDe(db, deudaId) {
  return db
    .prepare(
      `SELECT * FROM tesoreria WHERE deuda_id = ? AND desembolso = 0 AND ${SIN_ESPEJOS}
        ORDER BY fecha, id`
    )
    .all(deudaId);
}

/**
 * Deja en Tesorería el movimiento que le corresponde a esta deuda al
 * contraerse: lo crea, lo corrige o lo retira, según lo que diga la ficha.
 *
 * Se llama al guardar la deuda. Corregirle el monto o la fecha a una deuda
 * corrige su desembolso, para que el libro no diga una cosa distinta de la que
 * dice el registro que lo originó; cambiarle la clase a «Compra a crédito»
 * retira el movimiento, porque esa deuda no movió plata.
 */
function ponerElDesembolso(db, deuda, usuario) {
  const ya = elDesembolsoDe(db, deuda.id);
  const corresponde = tieneDesembolso(deuda);

  if (!corresponde) {
    // Con su espejo: si el original se va, el otro lado se quedaría suelto
    // moviéndole el saldo a una caja por una deuda que ya no mueve nada.
    if (ya) {
      const espejo = elEspejoDe(db, ya.id);
      if (espejo) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(espejo.id);
      db.prepare('DELETE FROM tesoreria WHERE id = ?').run(ya.id);
    }
    return { creado: false, corregido: false, retirado: !!ya };
  }

  const { desembolso } = losSignosDe(deuda);
  const categoria = laCategoriaDe(deuda, true);
  const concepto = deuda.direccion === POR_PAGAR
    ? `Préstamo recibido: ${deuda.concepto}`
    : `Préstamo entregado: ${deuda.concepto}`;

  if (!ya) {
    db.prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                              iglesia_id, cuerpo_id, notas, deuda_id, desembolso, created_by)
       VALUES (?, ?, ?, ?, ?, 'Transferencia', ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      String(deuda.fecha).slice(0, 10), desembolso, categoria, concepto, deuda.monto,
      deuda.cuenta_id, deuda.iglesia_id || null, deuda.cuerpo_id || null, NOTA, deuda.id,
      usuario ? usuario.id : null
    );
    ponerElEspejo(db, elDesembolsoDe(db, deuda.id), deuda);
    return { creado: true, corregido: false, retirado: false };
  }

  db.prepare(
    `UPDATE tesoreria SET fecha = ?, tipo = ?, categoria = ?, concepto = ?, monto = ?,
                          cuenta_id = ?, iglesia_id = ?, cuerpo_id = ? WHERE id = ?`
  ).run(
    String(deuda.fecha).slice(0, 10), desembolso, categoria, concepto, deuda.monto,
    deuda.cuenta_id, deuda.iglesia_id || null, deuda.cuerpo_id || null, ya.id
  );
  ponerElEspejo(db, db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(ya.id), deuda);
  return { creado: false, corregido: true, retirado: false };
}

/**
 * Anota un pago de esta deuda y deja su movimiento. Devuelve el movimiento.
 *
 * `cuotaId` puede venir en nulo: es un abono a cuenta, que también salda deuda
 * aunque no corresponda a una cuota del plan.
 */
function anotarUnPago(db, deuda, { cuotaId = null, fecha, monto, metodo, comprobante, notas }, usuario) {
  const { pago } = losSignosDe(deuda);
  const cuota = cuotaId
    ? db.prepare('SELECT * FROM cuotas_deuda WHERE id = ? AND deuda_id = ?').get(cuotaId, deuda.id)
    : null;
  const comoSeLlama = cuota
    ? `${deuda.concepto} — cuota ${cuota.numero}`
    : `${deuda.concepto} — abono a cuenta`;

  const info = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, comprobante, cuenta_id,
                            iglesia_id, cuerpo_id, notas, deuda_id, cuota_id, desembolso, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    String(fecha).slice(0, 10), pago, laCategoriaDe(deuda, false), comoSeLlama, monto,
    metodo || 'Transferencia', comprobante || null, deuda.cuenta_id,
    deuda.iglesia_id || null, deuda.cuerpo_id || null, notas || NOTA, deuda.id,
    cuota ? cuota.id : null, usuario ? usuario.id : null
  );
  const movimiento = db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(info.lastInsertRowid);
  ponerElEspejo(db, movimiento, deuda);
  return db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(movimiento.id);
}

/** Retira un pago y su movimiento. */
function retirarUnPago(db, deudaId, movimientoId) {
  const suyo = db
    .prepare(
      `SELECT * FROM tesoreria WHERE id = ? AND deuda_id = ? AND desembolso = 0 AND ${SIN_ESPEJOS}`
    )
    .get(movimientoId, deudaId);
  if (!suyo) return null;
  const espejo = elEspejoDe(db, suyo.id);
  if (espejo) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(espejo.id);
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(suyo.id);
  return suyo;
}

module.exports = {
  CATEGORIA_DESEMBOLSO, CATEGORIA_PAGO, CATEGORIA_COBRO, CATEGORIA_PRESTADO, NOTA,
  tieneDesembolso, esInterna, losSignosDe, laCategoriaDe, elDesembolsoDe, losPagosDe,
  elEspejoDe, ponerElEspejo, ponerElDesembolso, anotarUnPago, retirarUnPago, SIN_ESPEJOS,
};
