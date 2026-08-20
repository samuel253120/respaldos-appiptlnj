/**
 * Módulo: Documentos del Pastor / Guía.
 *
 * Todo lo que respalda su ministerio y su identificación: la credencial
 * ministerial, el certificado de ordenación, sus estudios, nombramientos.
 * Cada documento guarda el archivo y su nombre, para distinguirlos sin
 * abrirlos.
 *
 * Se ven y se agregan desde la ficha del pastor, al pie. La iglesia se hereda
 * de su ficha, que es lo que acota quién puede verlos.
 */
module.exports = {
  name: 'documentos_pastores',
  label: 'Documentos de Pastores',
  labelSingular: 'Documento del pastor',
  icon: '🗂️',
  group: 'Organización',
  order: 11.2,
  menu: false,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'observaciones'],
  listFields: ['pastor_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'pastor_id', label: 'Pastor / Guía', type: 'ref', ref: 'pastores', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Otro',
      options: [
        'Credencial ministerial',
        'Certificado de ordenación',
        'Nombramiento',
        'Carnet de identidad',
        'Certificado de estudios',
        'Certificado de matrimonio',
        'Carta de traslado',
        'Currículum',
        'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Credencial 2026»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la ficha del pastor.' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, existing, db }) {
      // La iglesia se hereda del pastor: es la que decide quién puede verlo
      const pastorId = data.pastor_id !== undefined ? data.pastor_id : existing ? existing.pastor_id : null;
      if (pastorId) {
        const pastor = db.prepare('SELECT iglesia_id FROM pastores WHERE id = ?').get(pastorId);
        if (pastor && pastor.iglesia_id) data.iglesia_id = pastor.iglesia_id;
      }
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      return null;
    },
  },
};
