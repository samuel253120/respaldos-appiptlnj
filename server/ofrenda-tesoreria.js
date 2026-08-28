/**
 * La ofrenda de un servicio, anotada en Tesorería.
 *
 * Lo que se recibe en un servicio entra completo a la tesorería de la
 * iglesia: si se ofrendaron cien mil pesos, en la cuenta general de esa
 * iglesia se lee un ingreso de cien mil pesos, que es lo que efectivamente
 * pasó por la mesa.
 *
 * COMO LLEGÓ. Entra en dos ingresos y no en uno: lo que se recibió en efectivo
 * y lo que llegó por transferencia, cada uno con su método. Antes los tres
 * movimientos se anotaban con «Efectivo» escrito fijo, así que con parte de la
 * ofrenda llegando al banco el libro decía que había entrado en efectivo y
 * cuadrarlo con la cartola no salía. El servicio que no reparte nada deja un
 * solo ingreso, como siempre.
 *
 * De ahí sale el aporte que le corresponde a la corporación —el porcentaje
 * que se define en Configuración → Organización, 10% por defecto— y ese
 * aporte se anota dos veces, como se anota cualquier movimiento de dinero
 * entre dos cuentas:
 *
 *   1. Ingreso    de la ofrenda en efectivo      en la tesorería general de la iglesia
 *   2. Ingreso    de lo que llegó al banco       en esa misma cuenta, como transferencia
 *   3. Egreso     del aporte                     de esa misma cuenta
 *   4. Ingreso    del aporte                     en el «Fondo para la corporación» de la iglesia
 *
 * El par del aporte —3 y 4— va con método «Otro», y no es descuido: no es
 * dinero que entre ni salga de la iglesia, es la misma plata pasando de una
 * cuenta suya a otra. Decir «Efectivo» ahí era tan inexacto como decirlo de una
 * transferencia. Los movimientos que ya están anotados no se salen a reescribir:
 * quedan como estaban hasta que alguien vuelva a guardar SU servicio, que es
 * cuando se ponen al día —igual que ya pasaba con el monto y el concepto—.
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

/** Los movimientos que le corresponden a la ofrenda de este servicio. */
function movimientosDeLaOfrenda(fila, db) {
  /*
   * El porcentaje que se escribe en el movimiento es EL DEL SERVICIO, no el que
   * rija hoy. Si no, un servicio viejo que alguien vuelva a guardar quedaba con
   * un movimiento que decía «(20%)» sobre un monto calculado al 10%.
   */
  const ajustes = require('./ajustes');
  const suyo = fila.ofrenda_porcentaje;
  const porcentaje = suyo !== null && suyo !== undefined && suyo !== '' && Number.isFinite(Number(suyo))
    ? Number(suyo)
    : ajustes.numero('ofrenda_porcentaje_fondo', 0, 100);
  const cuentaDe = (tipo) =>
    db.prepare('SELECT * FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = ?').get(fila.iglesia_id, tipo);

  const general = cuentaDe('General');
  const fondo = cuentaDe('Fondo para la corporación');
  const detalle = `ofrenda de ${(fila.tipo || 'servicio').toLowerCase()} del ${fechaLarga(fila.fecha)}`;
  const recibida = detalle.charAt(0).toUpperCase() + detalle.slice(1);
  const aporte = `Aporte a la corporación (${porcentaje}%) — ${detalle}`;

  /*
   * Lo que llegó al banco lo dice el servicio; el efectivo es el resto. Se saca
   * de la resta y no del campo calculado para que un servicio viejo —guardado
   * antes de que el reparto existiera, con la columna en blanco— siga dejando
   * su ingreso completo en efectivo, que es lo que pasó.
   */
  const total = Number(fila.ofrenda_total) || 0;
  const porBanco = Number(fila.ofrenda_transferencia) || 0;
  const enEfectivo = Math.max(0, total - porBanco);

  return [
    {
      columna: 'movimiento_iglesia_id',
      tipo: 'Ingreso', categoria: 'Ofrendas', metodo: 'Efectivo',
      monto: enEfectivo,
      cuenta: general, concepto: recibida,
    },
    {
      columna: 'movimiento_transferencia_id',
      tipo: 'Ingreso', categoria: 'Ofrendas', metodo: 'Transferencia',
      monto: porBanco,
      cuenta: general, concepto: `${recibida} (por transferencia)`,
    },
    {
      columna: 'movimiento_aporte_id',
      tipo: 'Egreso', categoria: 'Aportes', metodo: 'Otro',
      monto: Number(fila.ofrenda_fondo) || 0,
      cuenta: general, concepto: aporte,
    },
    {
      columna: 'movimiento_fondo_id',
      tipo: 'Ingreso', categoria: 'Aportes', metodo: 'Otro',
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
      // El método va en el UPDATE y no solo en el INSERT: sin él, cambiarle a un
      // servicio lo que llegó por transferencia le corregía el monto al
      // movimiento y le dejaba el método viejo, que es justo lo que se vino a
      // arreglar. Se vio al probarlo.
      db.prepare(
        `UPDATE tesoreria
            SET fecha = ?, tipo = ?, categoria = ?, concepto = ?, monto = ?, metodo = ?,
                cuenta_id = ?, iglesia_id = ?, updated_at = datetime('now','localtime')
          WHERE id = ?`
      ).run(fila.fecha, lado.tipo, lado.categoria, lado.concepto, lado.monto, lado.metodo,
            lado.cuenta.id, fila.iglesia_id, guardado.id);
    } else {
      const info = db
        .prepare(
          `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                                  iglesia_id, notas, servicio_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(fila.fecha, lado.tipo, lado.categoria, lado.concepto, lado.monto, lado.metodo,
             lado.cuenta.id, fila.iglesia_id, NOTA, fila.id);
      db.prepare(`UPDATE servicios SET "${lado.columna}" = ? WHERE id = ?`).run(info.lastInsertRowid, fila.id);
    }
  }
}

module.exports = { sincronizarOfrenda, movimientosDeLaOfrenda };
