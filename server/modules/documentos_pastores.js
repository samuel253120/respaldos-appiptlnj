/**
 * Los tipos de documento que se guardan de un pastor o guía, en el orden en
 * que los pide la iglesia: primero los que acreditan quién es y que está en
 * condiciones de servir, después su matrimonio, y al final su nombramiento y
 * su renuncia. «Otro Documento» es el cajón para lo que no calce en ninguno.
 *
 * Esta es la lista de verdad: la migración que ordena los tipos guardados la
 * toma de acá, para que no haya dos versiones de lo mismo.
 */
const TIPOS_DE_DOCUMENTO = [
  'Carnet de Identidad',
  'Certificado de Antecedentes',
  'Certificado de Inhabilidades',
  'Certificado de Matrimonio Civil',
  'Certificado de Matrimonio Iglesia',
  'Certificado de Nombramiento (Ordenacion)',
  'Carta de Renuncia',
  'Otro Documento',
];


/**
 * Módulo: Documentos del Pastor / Guía.
 *
 * Todo lo que respalda su ministerio y su identificación: su carnet, sus
 * certificados, su nombramiento. Cada documento guarda el archivo y su
 * nombre, para distinguirlos sin abrirlos.
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
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Otro Documento',
      options: TIPOS_DE_DOCUMENTO,
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
