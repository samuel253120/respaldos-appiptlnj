/**
 * Módulo: Documentos de Solicitudes.
 *
 * Cada solicitud puede juntar todos los antecedentes que hagan falta: la carta
 * que se presentó, la fotografía del papel, un certificado, la respuesta
 * firmada. Uno por archivo, con su nombre, para poder distinguirlos sin
 * abrirlos.
 *
 * Van en su propio módulo y no en un campo del formulario porque una solicitud
 * junta papeles a lo largo de su tramitación, y no se sabe de antemano cuántos
 * serán ni cuándo llegarán.
 *
 * Se ven y se agregan desde la propia ficha de la solicitud, en su pestaña.
 */
module.exports = {
  name: 'documentos_solicitudes',
  label: 'Documentos de Solicitudes',
  labelSingular: 'Documento de la solicitud',
  icon: '🗂️',
  group: 'Atención y ayuda',
  order: 33,
  menu: false,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'observaciones'],
  listFields: ['solicitud_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'solicitud_id', label: 'Solicitud', type: 'ref', ref: 'solicitudes', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Antecedente',
      options: [
        'Carta de solicitud', 'Antecedente', 'Fotografía', 'Certificado',
        'Comprobante', 'Respuesta / Resolución', 'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce (ej: «Carta firmada por el solicitante»).',
    },
    {
      name: 'archivo', label: 'Documento o fotografía', type: 'file', required: true,
      help: 'Se puede sacar con el teléfono: si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la solicitud.' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, existing, db }) {
      const solicitudId = data.solicitud_id !== undefined ? data.solicitud_id : existing ? existing.solicitud_id : null;
      if (solicitudId) {
        const s = db.prepare('SELECT iglesia_id FROM solicitudes WHERE id = ?').get(solicitudId);
        if (s && s.iglesia_id) data.iglesia_id = s.iglesia_id;
      }
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      return null;
    },
    /** Que un antecedente llegue queda anotado en el seguimiento. */
    afterSave(fila, { isNew, user, db }) {
      if (!isNew) return;
      require('../solicitudes/seguimiento').anotar(db, fila.solicitud_id, {
        tipo: 'Documento',
        descripcion: `Se adjuntó «${fila.nombre}» (${fila.tipo}).`,
        user,
      });
    },
  },
};
