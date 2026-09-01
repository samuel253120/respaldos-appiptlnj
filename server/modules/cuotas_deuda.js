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
