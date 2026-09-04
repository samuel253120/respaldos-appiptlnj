/**
 * Módulo: Historial de la Iglesia.
 *
 * Deja constancia de lo que va ocurriendo con cada congregación: su
 * fundación, los cambios de pastor, las obras del templo, los traslados de
 * local, las visitas y todo lo que la iglesia quiera dejar anotado.
 *
 * Los registros automáticos los genera server/bitacora.js al guardarse los
 * datos de la iglesia; los manuales se escriben desde su ficha.
 */
module.exports = {
  name: 'historial_iglesias',
  label: 'Historial de Iglesias',
  labelSingular: 'Registro del historial',
  icon: '🗒️',
  group: 'Organización',
  order: 55,
  menu: false,
  display: '{tipo} — {descripcion}',
  dateField: 'fecha',
  searchFields: ['descripcion', 'tipo'],
  listFields: ['fecha', 'iglesia_id', 'tipo', 'descripcion', 'origen'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo de registro', type: 'select', required: true, default: 'Anotación',
      options: [
        'Anotación', 'Fundación', 'Inauguración', 'Cambio de pastor', 'Obra / Construcción',
        'Traslado de local', 'Aniversario', 'Campaña', 'Visita', 'Reconocimiento',
        'Cambio de datos', 'Documento', 'Otro',
      ],
    },
    {
      name: 'descripcion', label: 'Descripción', type: 'textarea', required: true,
      /*
       * Una iglesia no reserva ningún dato hoy, así que esto no tapa nada
       * todavía. Se declara igual: el día que reserve uno —y las otras dos
       * fichas ya reservan cinco entre las dos— su historial no lo va a dejar
       * escrito a la vista sin que nadie se acuerde de venir a agregarlo
       * (ver server/sensibles.js).
       */
      copiaDe: 'iglesias',
    },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Los registros automáticos los genera el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    ...require('../lo-que-decia-el-sistema').CAMPOS,
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing }) {
      if (isNew) {
        data.origen = data.origen || 'Manual';
        data.registrado_por = user.nombre;
        if (!data.fecha) data.fecha = require('../fechas').hoy();
      }
      // Corregir a mano lo que anotó el sistema deja constancia de lo que decía
      require('../lo-que-decia-el-sistema').guardarLoQueDecia(data, { existing, user });
      return null;
    },
  },
};
