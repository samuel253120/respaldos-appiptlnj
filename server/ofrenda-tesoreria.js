/**
 * La ofrenda de un servicio, anotada en Tesorería.
 *
 * Lo que se recibe en un servicio entra completo a la tesorería de la
 * iglesia: si se ofrendaron cien mil pesos, en la cuenta general de esa
 * iglesia se lee un ingreso de cien mil pesos, que es lo que efectivamente
 * pasó por la mesa.
 *
 * De ahí sale el aporte que le corresponde a la corporación —el porcentaje
 * que se define en Configuración → Organización, 10% por defecto— y ese
 * aporte se anota dos veces, como se anota cualquier movimiento de dinero
 * entre dos cuentas:
 *
 *   1. Ingreso    de la ofrenda completa   en la tesorería general de la iglesia
 *   2. Egreso     del aporte               de esa misma cuenta
 *   3. Ingreso    del aporte               en el «Fondo para la corporación» de la iglesia
 *
 * Así la cuenta de la iglesia muestra las dos cosas por separado: cuánto
 * entró de ofrenda y cuánto salió para la corporación. El saldo queda igual
 * que si se hubiera anotado solo la diferencia, pero sin que nadie tenga que
 * adivinar de dónde salió ese descuento.
 *
 * Los tres movimientos son del servicio: se crean, se corrigen y se borran
 * con él, y no se editan por separado en Tesorería.
 */
const { fechaLarga } = require('./formato');

const NOTA = 'Movimiento generado por el Registro de Servicios.';

/** Los tres movimientos que le corresponden a la ofrenda de este servicio. */
function movimientosDeLaOfrenda(fila, db) {
  const ajustes = require('./ajustes');
  const porcentaje = ajustes.numero('ofrenda_porcentaje_fondo', 0, 100);
  const cuentaDe = (tipo) =>
    db.prepare('SELECT * FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = ?').get(fila.iglesia_id, tipo);

  const general = cuentaDe('General');
  const fondo = cuentaDe('Fondo para la corporación');
  const detalle = `ofrenda de ${(fila.tipo || 'servicio').toLowerCase()} del ${fechaLarga(fila.fecha)}`;
  const recibida = detalle.charAt(0).toUpperCase() + detalle.slice(1);
  const aporte = `Aporte a la corporación (${porcentaje}%) — ${detalle}`;

  return [
    {
      columna: 'movimiento_iglesia_id',
      tipo: 'Ingreso', categoria: 'Ofrendas',
      monto: Number(fila.ofrenda_total) || 0,
      cuenta: general, concepto: recibida,
    },
    {
      columna: 'movimiento_aporte_id',
      tipo: 'Egreso', categoria: 'Aportes',
      monto: Number(fila.ofrenda_fondo) || 0,
      cuenta: general, concepto: aporte,
    },
    {
      columna: 'movimiento_fondo_id',
      tipo: 'Ingreso', categoria: 'Aportes',
      monto: Number(fila.ofrenda_fondo) || 0,
      cuenta: fondo, concepto: aporte,
    },
  ];
}

/**
 * Deja la tesorería calzando con lo que dice el servicio: crea lo que falte,
 * corrige lo que cambió y retira lo que ya no corresponde.
 */
function sincronizarOfrenda(fila, db) {
  const ajustes = require('./ajustes');
  const registrar = ajustes.activo('ofrenda_registra_tesoreria');

  for (const lado of movimientosDeLaOfrenda(fila, db)) {
    const guardado = fila[lado.columna]
      ? db.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila[lado.columna])
      : null;

    // Sin ofrenda, sin cuenta donde anotarla o con el registro apagado:
    // no queda movimiento (y se retira el que hubiera).
    if (!registrar || !lado.cuenta || lado.monto <= 0) {
      if (guardado) {
        db.prepare('DELETE FROM tesoreria WHERE id = ?').run(guardado.id);
        db.prepare(`UPDATE servicios SET "${lado.columna}" = NULL WHERE id = ?`).run(fila.id);
      }
      continue;
    }

    if (guardado) {
      db.prepare(
        `UPDATE tesoreria
            SET fecha = ?, tipo = ?, categoria = ?, concepto = ?, monto = ?,
                cuenta_id = ?, iglesia_id = ?, updated_at = datetime('now','localtime')
          WHERE id = ?`
      ).run(fila.fecha, lado.tipo, lado.categoria, lado.concepto, lado.monto,
            lado.cuenta.id, fila.iglesia_id, guardado.id);
    } else {
      const info = db
        .prepare(
          `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                                  iglesia_id, notas, servicio_id)
           VALUES (?, ?, ?, ?, ?, 'Efectivo', ?, ?, ?, ?)`
        )
        .run(fila.fecha, lado.tipo, lado.categoria, lado.concepto, lado.monto,
             lado.cuenta.id, fila.iglesia_id, NOTA, fila.id);
      db.prepare(`UPDATE servicios SET "${lado.columna}" = ? WHERE id = ?`).run(info.lastInsertRowid, fila.id);
    }
  }
}

module.exports = { sincronizarOfrenda, movimientosDeLaOfrenda };
