/**
 * Módulo: Documentos de la Iglesia.
 *
 * Cada iglesia local puede tener todos los documentos que hagan falta: su
 * personería jurídica, los estatutos, la escritura o el contrato de arriendo
 * del templo, permisos municipales, planos. Cada uno guarda el archivo y su
 * nombre, para poder distinguirlos sin abrirlos.
 *
 * Se ven y se agregan desde la propia ficha de la iglesia, al pie. Por eso no
 * ocupa un lugar propio en el menú (`menu: false`).
 */
const carpetas = require('../carpetas');

module.exports = {
  name: 'documentos_iglesias',
  label: 'Documentos de Iglesias',
  labelSingular: 'Documento de la iglesia',
  icon: '🗂️',
  group: 'Organización',
  order: 54,
  menu: false,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'observaciones'],
  listFields: ['iglesia_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Otro',
      options: [
        'Personería jurídica',
        'Estatutos',
        'Acta de fundación',
        'Escritura / Propiedad',
        'Contrato de arriendo',
        'Permiso municipal',
        'Plano del templo',
        'Certificado',
        'Reglamento interno',
        'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Escritura del templo, 2018»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, id, existing, db, confirmado }) {
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      // ¿No será el mismo papel que ya está? Ver server/carpetas.js
      return carpetas.preguntaSiSeRepite({
        db, tabla: 'documentos_iglesias', campoDueno: 'iglesia_id', deQuien: 'esta iglesia',
        data, id, existing, confirmado,
      });
    },
  },
};
