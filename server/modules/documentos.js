/** Módulo: Documentos (archivo documental general). */
module.exports = {
  name: 'documentos',
  label: 'Documentos',
  labelSingular: 'Documento',
  icon: '📁',
  group: 'Documentación',
  order: 42,
  display: '{titulo}',
  dateField: 'fecha',
  searchFields: ['titulo', 'descripcion', 'etiquetas'],
  listFields: ['titulo', 'tipo', 'fecha', 'iglesia_id', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'titulo', label: 'Título', type: 'text', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', default: 'Administrativo',
      options: ['Legal', 'Financiero', 'Administrativo', 'Correspondencia enviada', 'Correspondencia recibida', 'Constancia', 'Contrato', 'Escritura / Propiedad', 'Otro'],
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos' },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
    { name: 'archivo', label: 'Archivo adjunto', type: 'file', required: false },
    { name: 'etiquetas', label: 'Etiquetas', type: 'text', help: 'Palabras clave separadas por coma para facilitar la búsqueda' },
  ],
};
