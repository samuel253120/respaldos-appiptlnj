/**
 * Módulo: Historial del Pastor / Guía.
 *
 * El recorrido ministerial de cada persona: su ordenación, los ascensos de
 * cargo, los nombramientos, los traslados de una iglesia a otra, las
 * licencias y lo que se quiera dejar anotado.
 *
 * Los registros automáticos los genera server/bitacora.js —en especial los
 * cambios de cargo y de iglesia—; los manuales se escriben desde su ficha.
 */
module.exports = {
  name: 'historial_pastores',
  label: 'Historial de Pastores',
  labelSingular: 'Registro del historial',
  icon: '🗒️',
  group: 'Organización',
  order: 57,
  menu: false,
  display: '{tipo} — {descripcion}',
  dateField: 'fecha',
  searchFields: ['descripcion', 'tipo'],
  listFields: ['fecha', 'pastor_id', 'tipo', 'descripcion', 'origen'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'pastor_id', label: 'Pastor / Guía', type: 'ref', ref: 'pastores', required: true },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo de registro', type: 'select', required: true, default: 'Anotación',
      options: [
        'Anotación', 'Ordenación', 'Cambio de cargo', 'Nombramiento', 'Traslado de iglesia',
        'Licencia', 'Reconocimiento', 'Disciplina', 'Capacitación', 'Cambio de datos',
        'Documento', 'Otro',
      ],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la ficha del pastor.' },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Los registros automáticos los genera el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing, db }) {
      const pastorId = data.pastor_id !== undefined ? data.pastor_id : existing ? existing.pastor_id : null;
      if (pastorId) {
        const pastor = db.prepare('SELECT iglesia_id FROM pastores WHERE id = ?').get(pastorId);
        if (pastor && pastor.iglesia_id) data.iglesia_id = pastor.iglesia_id;
      }
      if (isNew) {
        data.origen = data.origen || 'Manual';
        data.registrado_por = user.nombre;
        if (!data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      }
      return null;
    },
  },
};
