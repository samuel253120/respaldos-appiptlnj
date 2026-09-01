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
 */

const { POR_PAGAR } = require('./modules/deudas');

/** Las categorías con que se anotan. Vienen de fábrica en Categorías de Tesorería. */
const CATEGORIA_DESEMBOLSO = 'Préstamos recibidos';
const CATEGORIA_PAGO = 'Pago de deudas';
const CATEGORIA_COBRO = 'Cobro de préstamos';
const CATEGORIA_PRESTADO = 'Préstamos entregados';

const NOTA = 'Movimiento generado por Deudas y Compromisos.';

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
  return db.prepare('SELECT * FROM tesoreria WHERE deuda_id = ? AND desembolso = 1').get(deudaId) || null;
}

/** Los pagos anotados contra esta deuda. */
function losPagosDe(db, deudaId) {
  return db
    .prepare('SELECT * FROM tesoreria WHERE deuda_id = ? AND desembolso = 0 ORDER BY fecha, id')
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
    if (ya) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(ya.id);
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
    return { creado: true, corregido: false, retirado: false };
  }

  db.prepare(
    `UPDATE tesoreria SET fecha = ?, tipo = ?, categoria = ?, concepto = ?, monto = ?,
                          cuenta_id = ?, iglesia_id = ?, cuerpo_id = ? WHERE id = ?`
  ).run(
    String(deuda.fecha).slice(0, 10), desembolso, categoria, concepto, deuda.monto,
    deuda.cuenta_id, deuda.iglesia_id || null, deuda.cuerpo_id || null, ya.id
  );
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
  return db.prepare('SELECT * FROM tesoreria WHERE id = ?').get(info.lastInsertRowid);
}

/** Retira un pago y su movimiento. */
function retirarUnPago(db, deudaId, movimientoId) {
  const suyo = db
    .prepare('SELECT * FROM tesoreria WHERE id = ? AND deuda_id = ? AND desembolso = 0')
    .get(movimientoId, deudaId);
  if (!suyo) return null;
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(suyo.id);
  return suyo;
}

module.exports = {
  CATEGORIA_DESEMBOLSO, CATEGORIA_PAGO, CATEGORIA_COBRO, CATEGORIA_PRESTADO, NOTA,
  tieneDesembolso, losSignosDe, laCategoriaDe, elDesembolsoDe, losPagosDe,
  ponerElDesembolso, anotarUnPago, retirarUnPago,
};
