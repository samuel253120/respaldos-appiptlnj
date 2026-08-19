/**
 * Módulo: Documentos de Miembros.
 *
 * Cada miembro puede tener todos los documentos que hagan falta: su carnet de
 * identidad, la ficha de registro, la ficha de actualización, certificados y
 * cualquier otro. Cada uno guarda el archivo y su nombre, para poder
 * distinguirlos sin abrirlos.
 *
 * Se ven y se agregan desde la propia ficha del miembro, al pie.
 */
module.exports = {
  name: 'documentos_miembros',
  label: 'Documentos de Miembros',
  labelSingular: 'Documento del miembro',
  icon: '🗂️',
  group: 'Personas',
  order: 23,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'observaciones'],
  listFields: ['miembro_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Carnet de identidad',
      options: [
        'Carnet de identidad',
        'Ficha de registro de miembro',
        'Ficha de actualización de registro',
        'Certificado de bautismo',
        'Certificado de matrimonio',
        'Certificado de nacimiento',
        'Carta de traslado',
        'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Carnet vigente hasta 2030»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, existing, db }) {
      // La iglesia se hereda del miembro
      const miembroId = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      if (miembroId && !data.iglesia_id) {
        const miembro = db.prepare('SELECT iglesia_id FROM miembros WHERE id = ?').get(miembroId);
        if (miembro && miembro.iglesia_id) data.iglesia_id = miembro.iglesia_id;
      }
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      return null;
    },
  },
};
