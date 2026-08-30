/**
 * Módulo: Cuotas mensuales de los cuerpos.
 *
 * Cada integrante de un cuerpo tiene el deber de pagar una cuota todos los
 * meses. Acá queda constancia de cada pago: de quién, de qué mes, cuánto y
 * cuándo se pagó.
 *
 * Hay dos maneras de no deber cuota, y las dos se respetan solas:
 *
 *   · el cuerpo entero no cobra (se apaga en la ficha del cuerpo);
 *   · un integrante está exento, con su motivo (se marca en su ficha).
 *
 * El pago entra como ingreso a la tesorería del propio cuerpo, y ese
 * movimiento se mantiene al día con el pago: si se corrige el monto se
 * corrige, y si se borra el pago se va con él. Se puede apagar en
 * Configuración → Organización.
 *
 * No aparece en el menú: se maneja desde la ficha del cuerpo, con la planilla
 * de quién pagó cada mes.
 */
const { OPCIONES_MES, sincronizarConLaTesoreria } = require('../cuotas');


module.exports = {
  name: 'cuotas_cuerpo',
  label: 'Cuotas de Cuerpos',
  labelSingular: 'Cuota',
  icon: '🎟️',
  group: 'Finanzas',
  order: 44,
  menu: false,
  display: '{mes}/{anio} — {persona}',
  dateField: 'fecha_pago',
  searchFields: ['persona', 'notas'],
  listFields: ['fecha_pago', 'cuerpo_id', 'persona', 'anio', 'mes', 'monto'],
  filterFields: ['cuerpo_id', 'anio', 'mes'],
  defaultSort: { field: 'fecha_pago', dir: 'desc' },

  fields: [
    {
      name: 'integrante_id', label: 'Integrante', type: 'ref', ref: 'integrantes_cuerpo', required: true,
      seccion: 'Quién paga',
    },
    {
      name: 'anio', label: 'Año', type: 'number', required: true,
      seccion: 'Qué mes se paga',
    },
    { name: 'mes', label: 'Mes', type: 'select', required: true, options: OPCIONES_MES },
    { name: 'monto', label: 'Monto pagado', type: 'money', required: true, seccion: 'El pago', min: 0, reservado: 'tesoreria_montos' },
    { name: 'fecha_pago', label: 'Fecha del pago', type: 'date', required: true },
    {
      name: 'metodo', label: 'Forma de pago', type: 'select', default: 'Efectivo',
      options: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
    },
    { name: 'notas', label: 'Notas', type: 'text' },
    // Se toman del integrante, para poder filtrar y para los permisos
    { name: 'cuerpo_id', type: 'number', oculto: true, readonly: true },
    { name: 'miembro_id', type: 'number', oculto: true, readonly: true },
    /*
     * Quién pagó, escrito.
     *
     * El número de miembro ya no alcanza: en un grupo también paga cuota gente
     * que no está inscrita en la membresía, y esa no tiene número de miembro
     * (ver server/integrantes.js). El nombre se copia de la ficha de
     * integrante, que es la que sabe de qué registro sale la persona.
     */
    { name: 'persona', label: 'Quién pagó', type: 'text', readonly: true },
    { name: 'iglesia_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing, id, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(dato('integrante_id'));
      if (!ficha) return 'No encuentro la ficha del integrante que está pagando.';
      data.cuerpo_id = ficha.cuerpo_id;
      data.miembro_id = ficha.miembro_id || null;
      data.persona = ficha.persona || null;
      data.iglesia_id = ficha.iglesia_id;

      const anio = Number(dato('anio'));
      const mes = String(dato('mes') || '');
      if (!(anio > 1900 && anio < 2200)) return 'El año del pago no parece correcto';
      if (!/^(0[1-9]|1[0-2])$/.test(mes)) return 'Elija el mes que se está pagando';

      const repetida = db
        .prepare('SELECT id FROM cuotas_cuerpo WHERE integrante_id = ? AND anio = ? AND mes = ? AND id != ?')
        .get(ficha.id, anio, mes, id || 0);
      if (repetida) return 'Esa persona ya tiene registrado el pago de ese mes en este cuerpo.';

      // Una cuota que no tiene dónde quedar anotada no se registra: la cuota ES
      // la plata (ver `avisoSiLaCuentaEstaCerrada` en server/cuotas.js). Solo
      // para las nuevas: una ya anotada se sigue corrigiendo.
      if (!id) {
        const sinDonde = require('../cuotas').avisoSiLaCuentaEstaCerrada(ficha.cuerpo_id, db);
        if (sinDonde) return sinDonde;
      }

      if (!dato('fecha_pago')) data.fecha_pago = new Date().toISOString().slice(0, 10);
      return null;
    },

    afterSave(fila, { db }) {
      sincronizarConLaTesoreria(fila, db);
    },

    beforeDelete(fila, { db }) {
      // El ingreso de una cuota que se borra no puede quedar en tesorería
      if (fila.movimiento_id) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(fila.movimiento_id);
      return null;
    },
  },
};
