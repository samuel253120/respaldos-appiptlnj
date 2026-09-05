/**
 * Módulo: Cuotas de una deuda.
 *
 * Una fila por cuota del plan de pagos: su número, cuándo vence y cuánto se
 * pactó. Lo PAGADO no vive acá: son movimientos de tesorería enlazados a su
 * cuota, y de sumarlos sale cuánto se lleva pagado (ver server/plan-de-cuotas.js).
 * Guardar acá un «pagada: sí» sería una segunda verdad sobre la misma plata.
 *
 * No aparece en el menú: se maneja desde la ficha de su deuda, con la planilla
 * de cuotas, igual que las cuotas de un cuerpo se manejan desde su ficha.
 *
 * Se puede corregir cuota por cuota —la fecha y el monto—, porque algunas
 * deudas llevan interés y hay créditos que se reajustan: lo que el sistema
 * propone al armar el plan es un punto de partida.
 */
module.exports = {
  name: 'cuotas_deuda',
  label: 'Cuotas de Deudas',
  labelSingular: 'Cuota',
  icon: '📆',
  group: 'Finanzas',
  order: 47,
  menu: false,
  display: 'Cuota {numero}',
  dateField: 'vence',
  listFields: ['deuda_id', 'numero', 'vence', 'monto'],
  filterFields: ['deuda_id'],
  defaultSort: { field: 'numero', dir: 'asc' },
  fields: [
    { name: 'deuda_id', label: 'Deuda', type: 'ref', ref: 'deudas', required: true },
    { name: 'numero', label: 'N.º de cuota', type: 'number', required: true, min: 1 },
    {
      name: 'vence', label: 'Vence', type: 'date',
      // Hacia adelante, como la primera: una cuota es un compromiso, no un
      // hecho, y el motor rechaza las fechas futuras salvo que se le diga
      futuro: true,
      help: 'Cuándo se pactó pagarla. El plan las propone mensuales desde la primera.',
    },
    {
      name: 'monto', label: 'Monto de la cuota', type: 'money', required: true, min: 0,
      reservado: 'tesoreria_montos',
      help: 'Lo pactado. Lo que se pagó de verdad sale de sus movimientos.',
    },
    { name: 'notas', label: 'Notas', type: 'text' },
  ],
  hooks: {
    /**
     * QUE EL PLAN SIGA SIENDO UN PLAN.
     *
     * Se puede corregir cuota por cuota —lo dice la cabecera de este módulo, y
     * con razón: hay deudas con interés y créditos que se reajustan—. Lo que
     * faltaba era que corregir no descuadrara el plan en silencio. MEDIDO en la
     * v1.414.0, sobre una deuda de $ 600.000 en seis cuotas de $ 100.000:
     *
     *   ponerle $ 1 a la primera cuota ....  200   el plan suma $ 500.001
     *   agregar otra cuota número 1 .......  201   dos «cuota 1», siete en total
     *   una cuota de $ 0 ..................  201   entra
     *   una que vence el 10-01-2020 .......  201   seis años antes de la deuda
     *   ──
     *   borrar una cuota con pagos ........  400   lo dice y lo impide
     *
     * Esa última fila es la que enseña dónde estaba la línea: el módulo ya
     * cuidaba la plata pagada, y lo que no cuidaba era el plan. El plan es lo
     * que se lleva a la reunión para decir cuánto falta y cuándo vence lo
     * próximo, y uno que suma distinto de la deuda, o con dos cuotas número 1,
     * se lee mal justo cuando hay que leerlo bien.
     *
     * Las tres reglas no se resuelven igual. Dos números de cuota repetidos y
     * una cuota que vence antes de contraerse la deuda son errores: se
     * rechazan. Que el plan no cuadre con la deuda no lo es —es exactamente lo
     * que pasa cuando se reajusta un crédito— así que se PREGUNTA, con los dos
     * números puestos.
     */
    beforeSave(data, { existing, id, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const deudaId = Number(dato('deuda_id'));
      const deuda = db.prepare('SELECT * FROM deudas WHERE id = ?').get(deudaId);
      if (!deuda) return 'No encuentro la deuda a la que pertenece esta cuota.';

      // Dos «cuota 1» en el mismo plan no es una corrección, es un error
      const numero = Number(dato('numero'));
      const repetida = db
        .prepare('SELECT id FROM cuotas_deuda WHERE deuda_id = ? AND numero = ? AND id != ?')
        .get(deudaId, numero, id || 0);
      if (repetida) {
        return `El plan de «${deuda.concepto}» ya tiene una cuota ${numero}. `
          + 'Cada cuota lleva su número una sola vez: si quiere agregar otra, póngale el '
          + 'que sigue; si quiere cambiar la que está, ábrala y corríjala.';
      }

      // Y una cuota no vence antes de que la deuda exista
      const vence = dato('vence');
      if (vence && deuda.fecha && vence < deuda.fecha) {
        const { comoSeLee } = require('../fechas');
        return `«${deuda.concepto}» se contrajo el ${comoSeLee(deuda.fecha)}, así que ninguna de `
          + `sus cuotas puede vencer el ${comoSeLee(vence)}. Revise la fecha de la cuota, o la `
          + 'de la deuda si es esa la que está mal.';
      }

      /*
       * Y que el plan siga cuadrando. Se miran las dos cosas —cuánto suma y
       * cuántas son— porque una cuota de $ 0 agregada al final no mueve la suma
       * y deja el plan con una cuota de más.
       */
      if (!confirmado) {
        const plan = require('../plan-de-cuotas');
        const { enPesos } = require('../repetido');
        const queda = plan.comoQuedariaElPlan(db, deudaId, { id, monto: dato('monto') });
        const debe = Math.round(Number(deuda.monto) || 0);
        const cuantasDice = Math.max(1, Math.floor(Number(deuda.cuotas) || 1));

        const problemas = [];
        if (queda.suma !== debe) {
          const dice = queda.suma > debe ? 'más' : 'menos';
          problemas.push(`el plan sumaría ${enPesos(queda.suma)} y la deuda dice `
            + `${enPesos(debe)}: ${enPesos(Math.abs(debe - queda.suma))} de ${dice}`);
        }
        if (queda.cuantas !== cuantasDice) {
          problemas.push(`quedarían ${queda.cuantas} cuotas y la ficha dice ${cuantasDice}`);
        }
        if (problemas.length) {
          return {
            error: `Así ${problemas.join(', y ')}. El plan es lo que se lleva a la reunión para `
              + 'decir cuánto falta y cuándo vence lo próximo. Si la deuda se reajustó o lleva '
              + 'interés, esto es lo esperado y puede seguir; si no, corrija la cuota, o el monto '
              + 'y el número de cuotas en la ficha de la deuda.',
            confirmar: 'el_plan_no_cuadra_con_la_deuda',
          };
        }
      }
      return null;
    },

    /**
     * Una cuota con plata encima no se borra: eso dejaría movimientos de
     * tesorería apuntando a una cuota que ya no existe, y con ellos la plata
     * pagada dejaría de contarse contra la deuda.
     */
    beforeDelete(fila, { db }) {
      const pagos = db
        .prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE cuota_id = ?')
        .get(fila.id).c;
      if (pagos) {
        return `La cuota ${fila.numero} tiene ${pagos} pago(s) anotado(s). Retire primero esos pagos: `
          + 'borrar la cuota dejaría esa plata sin contra qué contarse.';
      }
      return null;
    },
  },
};
