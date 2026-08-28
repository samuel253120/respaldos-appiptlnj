/**
 * Módulo: Traspasos entre Cuentas.
 *
 * Mover dinero de una cuenta de tesorería a otra dejando constancia: cuándo,
 * de qué cuenta a cuál, cuánto y en qué forma (efectivo, transferencia…).
 *
 * El caso corriente: cada iglesia aparta en su «Fondo para la corporación» el
 * porcentaje de las ofrendas que le corresponde a la corporación, y cuando
 * llega el momento traspasa ese fondo a la tesorería general de la
 * corporación.
 *
 * Cada traspaso genera sus dos movimientos en Tesorería —un egreso en la
 * cuenta de origen y un ingreso en la de destino—, que se mantienen
 * cuadrados: si se corrige el traspaso se corrigen los dos, y si se elimina
 * se eliminan los dos. Esos movimientos no se editan por separado.
 *
 * Los dos van marcados como TRASLADO ENTRE CUENTAS: la plata no entró ni salió
 * de la organización, cambió de cuenta. El resumen la cuenta aparte cuando ve
 * los dos lados, y como egreso de verdad cuando solo ve uno —el aporte que una
 * iglesia le traspasa a la corporación, mirado desde esa iglesia, sí salió—.
 * Está explicado en server/entre-cuentas.js.
 */
module.exports = {
  name: 'traspasos',
  label: 'Traspasos entre Cuentas',
  labelSingular: 'Traspaso',
  icon: '🔄',
  group: 'Finanzas',
  order: 42,
  display: '{fecha} — {concepto}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['concepto', 'referencia', 'notas'],
  listFields: ['fecha', 'cuenta_origen_id', 'cuenta_destino_id', 'monto', 'forma', 'concepto'],
  filterFields: ['cuenta_origen_id', 'cuenta_destino_id', 'forma'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha del traspaso', type: 'date', required: true },
    {
      name: 'cuenta_origen_id', label: 'Desde la cuenta', type: 'ref', ref: 'cuentas_tesoreria', required: true,
      optionsRoute: '/cuentas_tesoreria/activas',
      help: 'De dónde sale el dinero. Solo sus cuentas activas.',
    },
    {
      name: 'cuenta_destino_id', label: 'Hacia la cuenta', type: 'ref', ref: 'cuentas_tesoreria', required: true,
      optionsRoute: '/cuentas_tesoreria/destinos',
      help: 'A dónde entra el dinero, incluidas las cuentas de la corporación.',
    },
    { name: 'monto', label: 'Monto', type: 'money', required: true, min: 1, reservado: 'tesoreria_montos' },
    {
      name: 'forma', label: 'Forma del traspaso', type: 'select', required: true, default: 'Transferencia',
      options: ['Efectivo', 'Transferencia', 'Depósito', 'Cheque', 'Vale vista', 'Otra'],
    },
    {
      name: 'referencia', label: 'N.º de operación / documento', type: 'text',
      help: 'El número de la transferencia, del depósito o del cheque, si lo tiene.',
    },
    {
      name: 'concepto', label: 'Concepto', type: 'text', required: true,
      help: 'Por qué se traspasa. Ej: «10% de las ofrendas de julio».',
    },
    { name: 'comprobante', label: 'Comprobante (imagen o PDF)', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma de la cuenta de origen.',
    },
    // Los dos movimientos que este traspaso generó en Tesorería
    { name: 'movimiento_egreso_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_ingreso_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { user, existing, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const origenId = dato('cuenta_origen_id');
      const destinoId = dato('cuenta_destino_id');
      const monto = Number(dato('monto'));

      if (String(origenId) === String(destinoId)) {
        return 'El traspaso tiene que ir de una cuenta a otra distinta';
      }
      if (!Number.isFinite(monto) || monto <= 0) {
        return 'El monto del traspaso tiene que ser mayor que cero';
      }

      const origen = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(origenId);
      const destino = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(destinoId);
      if (!origen) return 'La cuenta de origen indicada no existe';
      if (!destino) return 'La cuenta de destino indicada no existe';

      // Se traspasa desde una cuenta propia; el destino puede ser de otro nivel
      if (!require('../alcance').alcanzaIglesia(user, origen.iglesia_id)) {
        return `La cuenta "${origen.nombre}" no está entre las iglesias que administra`;
      }
      if (origen.estado === 'Cerrada') return `La cuenta "${origen.nombre}" está cerrada: no puede salir dinero de ella`;
      if (destino.estado === 'Cerrada') return `La cuenta "${destino.nombre}" está cerrada: no puede entrar dinero en ella`;

      data.iglesia_id = origen.iglesia_id || null;

      // ¿Se está sacando de la cuenta de origen más de lo que hay? Se pregunta
      // antes de dejarla en rojo. Los dos lados del traspaso que ya estuvieran
      // guardados no cuentan: este guardado los rehace enteros.
      if (!confirmado) {
        const aviso = require('../saldos').avisoSiQuedaEnRojo(origenId, {
          tipo: 'Egreso', monto,
          fecha: data.fecha !== undefined ? data.fecha : existing ? existing.fecha : null,
          excluirTraspaso: existing ? existing.id : null,
          queEs: 'Este traspaso',
        });
        if (aviso) return aviso;
      }
      return null;
    },

    /**
     * Deja los dos movimientos del traspaso al día: el egreso en la cuenta de
     * origen y el ingreso en la de destino. Se crean la primera vez y se
     * corrigen después, para que los saldos nunca queden descuadrados.
     */
    afterSave(fila, { db }) {
      const origen = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(fila.cuenta_origen_id);
      const destino = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(fila.cuenta_destino_id);
      if (!origen || !destino) return;

      const lados = [
        {
          columna: 'movimiento_egreso_id',
          tipo: 'Egreso',
          cuenta: origen,
          concepto: `${fila.concepto} — traspaso a "${destino.nombre}"`,
        },
        {
          columna: 'movimiento_ingreso_id',
          tipo: 'Ingreso',
          cuenta: destino,
          concepto: `${fila.concepto} — traspaso desde "${origen.nombre}"`,
        },
      ];

      for (const lado of lados) {
        const existente = fila[lado.columna]
          ? db.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila[lado.columna])
          : null;
        if (existente) {
          db.prepare(
            `UPDATE tesoreria
                SET fecha = ?, tipo = ?, categoria = 'Traspaso', concepto = ?, monto = ?,
                    metodo = ?, entre_cuentas = 1, cuenta_id = ?, iglesia_id = ?, comprobante = ?,
                    updated_at = datetime('now','localtime')
              WHERE id = ?`
          ).run(
            fila.fecha, lado.tipo, lado.concepto, fila.monto,
            metodoDe(fila.forma), lado.cuenta.id, lado.cuenta.iglesia_id || null,
            fila.comprobante || null, existente.id
          );
        } else {
          const info = db
            .prepare(
              `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, entre_cuentas,
                                      cuenta_id, iglesia_id, comprobante, notas, traspaso_id)
               VALUES (?, ?, 'Traspaso', ?, ?, ?, 1, ?, ?, ?, ?, ?)`
            )
            .run(
              fila.fecha, lado.tipo, lado.concepto, fila.monto,
              metodoDe(fila.forma), lado.cuenta.id, lado.cuenta.iglesia_id || null,
              fila.comprobante || null,
              'Movimiento generado por un traspaso entre cuentas.', fila.id
            );
          db.prepare(`UPDATE traspasos SET "${lado.columna}" = ? WHERE id = ?`).run(info.lastInsertRowid, fila.id);
        }
      }
    },

    beforeDelete(fila, { db }) {
      // Al eliminar el traspaso se van sus dos movimientos: si no, quedarían
      // sumando o restando en cuentas donde ese dinero ya no se movió.
      db.prepare('DELETE FROM tesoreria WHERE traspaso_id = ?').run(fila.id);
      return null;
    },
  },
};

/** La forma del traspaso, dicha como la registra Tesorería. */
function metodoDe(forma) {
  if (forma === 'Efectivo') return 'Efectivo';
  if (forma === 'Cheque') return 'Cheque';
  if (forma === 'Transferencia' || forma === 'Depósito') return 'Transferencia';
  return 'Otro';
}
