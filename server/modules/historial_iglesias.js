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
        /*
     * NO va marcada como obligatoria: el sistema la pone sola si viene en
     * blanco, unas líneas más abajo. Marcarla lo hace al revés —la
     * comprobación de obligatorios del motor corre ANTES del gancho que la
     * rellena (server/crud.js)— y entonces el relleno no se ejecuta nunca: la
     * anotación se rechaza por no traer una fecha que el sistema tenía puesta
     * para ponerle.
     *
     * MEDIDO en la v1.429.0, la misma anotación sin fecha por las tres puertas:
     * el historial de una solicitud contestaba 201 y la ponía en el día de hoy;
     * éste y el del pastor contestaban 400, «El campo "Fecha" es obligatorio».
     * El razonamiento estaba escrito hace tiempo en historial_solicitudes.js,
     * que es el único de los tres que no cayó en la trampa (hallazgo SA-01).
     */
    { name: 'fecha', label: 'Fecha', type: 'date' },
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
