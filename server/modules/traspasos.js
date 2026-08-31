/**
 * Módulo: Traspasos entre Cuentas.
 *
 * Mover dinero de una cuenta de tesorería a otra dejando constancia: cuándo,
 * de qué cuenta a cuál, cuánto y en qué forma (efectivo, transferencia…).
 *
 * El caso corriente: cada iglesia aparta en su «Fondo para la corporación» el
 * porcentaje de las ofrendas que le corresponde a la corporación, y cuando
 * llega el momento traspasa ese fondo a la tesorería general de la
 * corporación. Un cuerpo hace lo mismo un nivel más abajo: junta las cuotas de
 * sus integrantes y le entrega a su iglesia.
 *
 * La plata se entrega HACIA ARRIBA, y por eso la cuenta de destino puede ser
 * una que quien anota el traspaso no administra. Nunca hacia el lado ni hacia
 * abajo: la regla entera está en server/entregar-hacia-arriba.js.
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
const repetido = require('../repetido');
const { comoSeLee } = require('../fechas');

/**
 * El traspaso igual a este que ya estaba anotado, o null si no hay ninguno.
 *
 * «Igual» es: el mismo día, de la misma cuenta a la misma cuenta, por el mismo
 * monto y con el mismo concepto. La forma —transferencia, cheque, efectivo— no
 * entra: el mismo aporte puede anotarse de dos maneras y sigue siendo uno solo.
 *
 * Los cuatro primeros se preguntan en SQL; el concepto se compara en JavaScript,
 * por lo que dice server/repetido.js. No hace falta excluir el traspaso que se
 * está guardando: acá se llega solo cuando cambió algo de esos cinco datos, así
 * que la fila guardada ya no calza con lo que se busca.
 */
function elQueYaEstaba(db, { fecha, origenId, destinoId, monto, concepto }) {
  const candidatos = db
    .prepare(
      `SELECT t.id, t.concepto, t.comprobante, t.created_at, u.nombre AS quien
         FROM traspasos t
         LEFT JOIN usuarios u ON u.id = t.created_by
        WHERE t.fecha = ? AND t.cuenta_origen_id = ? AND t.cuenta_destino_id = ? AND t.monto = ?
        ORDER BY t.id`
    )
    .all(String(fecha == null ? '' : fecha).slice(0, 10), origenId, destinoId, Number(monto) || 0);

  const suyo = repetido.comoSeCompara(concepto);
  return candidatos.find((c) => repetido.comoSeCompara(c.concepto) === suyo) || null;
}

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
      help: 'A dónde entra el dinero: las suyas y las de más arriba —su iglesia, la corporación—.',
      // El destino es, a propósito, algo que quien anota el traspaso no
      // administra: la plata se entrega hacia arriba. La comprobación general
      // del motor lo rechazaría; la que corresponde está abajo, en beforeSave
      // (ver server/entregar-hacia-arriba.js).
      alcanceLoDecideElModulo: true,
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

      /*
       * Se traspasa DESDE una cuenta propia. Esa sigue siendo la condición, y
       * es la que decide de quién es el traspaso: su iglesia y su nivel se
       * toman de ella.
       */
      if (!require('../alcance').alcanza(
        require('../registry').getModule('cuentas_tesoreria'), origen, user)) {
        return `La cuenta "${origen.nombre}" no está entre las que administra`;
      }

      /*
       * Y HACIA una que alcance, o una de más arriba.
       *
       * El destino de un traspaso es a propósito algo que quien lo anota no
       * administra: así es como un cuerpo le entrega a su iglesia y una iglesia
       * a la corporación, que es el trabajo de este módulo. La regla —hacia
       * arriba, misma iglesia, nunca al lado ni hacia abajo— y lo que se midió
       * antes de tenerla están en server/entregar-hacia-arriba.js.
       */
      const arriba = require('../entregar-hacia-arriba');
      const alcanzaDestino = require('../alcance').alcanza(
        require('../registry').getModule('cuentas_tesoreria'), destino, user);
      if (!alcanzaDestino && !arriba.admiteComoDestino(origen, destino)) {
        return `La cuenta "${destino.nombre}" no está entre las que administra, y tampoco es de las `
          + 'de más arriba. Un traspaso entrega hacia arriba —de un cuerpo a su iglesia, de una '
          + 'iglesia a la corporación—: hacia otra congregación o hacia otro cuerpo hay que pedirlo '
          + 'a quien administre las dos cuentas.';
      }
      // La misma regla que en las otras cuatro puertas (server/cuenta-cerrada.js),
      // dicha por el lado que corresponde: de un traspaso se sale y se entra
      const cerrada = require('../cuenta-cerrada');
      const noSale = cerrada.avisoSiEstaCerrada(origen, 'sale');
      if (noSale) return noSale;
      const noEntra = cerrada.avisoSiEstaCerrada(destino, 'entra');
      if (noEntra) return noEntra;

      data.iglesia_id = origen.iglesia_id || null;

      if (!confirmado) {
        const fecha = data.fecha !== undefined ? data.fecha : existing ? existing.fecha : null;
        const concepto = data.concepto !== undefined ? data.concepto : existing ? existing.concepto : null;

        /*
         * Lo primero, si este traspaso ya está anotado: es lo que cuesta plata.
         * La confirmación es una sola para todo el guardado, así que la pregunta
         * que se muestra tiene que ser la que más importa. Un traspaso repetido
         * mueve dos cuentas en silencio —medido: uno de $400.000 anotado tres
         * veces movió $1.200.000 que nunca se movieron— mientras que un saldo en
         * rojo se ve.
         */
        const sinCambios = repetido.seguiIgual(
          existing,
          { fecha, cuenta_origen_id: origenId, cuenta_destino_id: destinoId, monto, concepto },
          [['fecha', 'fecha'], ['cuenta_origen_id', 'igual'], ['cuenta_destino_id', 'igual'],
           ['monto', 'numero'], ['concepto', 'texto']]
        );
        const otro = sinCambios ? null
          : elQueYaEstaba(db, { fecha, origenId, destinoId, monto, concepto });
        if (otro) {
          return {
            error:
              `Ya hay un traspaso de ${repetido.enPesos(monto)} con ese mismo concepto, de `
              + `"${origen.nombre}" a "${destino.nombre}", el ${comoSeLee(String(fecha).slice(0, 10))}`
              + `${repetido.senasDe(otro) ? ` (${repetido.senasDe(otro)})` : ''}. `
              + 'Si es este mismo, abra ese en vez de anotarlo de nuevo: registrado dos veces, la plata '
              + 'se mueve dos veces y las dos cuentas quedan descuadradas. Si de verdad fueron dos, confirme.',
            confirmar: 'traspaso_ya_anotado',
          };
        }

        // ¿Se está sacando de la cuenta de origen más de lo que hay? Se pregunta
        // antes de dejarla en rojo. Los dos lados del traspaso que ya estuvieran
        // guardados no cuentan: este guardado los rehace enteros.
        const aviso = require('../saldos').avisoSiQuedaEnRojo(origenId, {
          tipo: 'Egreso', monto,
          fecha,
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
