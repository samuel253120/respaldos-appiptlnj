/** Módulo: Certificados (bautismo, presentación, matrimonio, membresía…). Imprimible. */
module.exports = {
  name: 'certificados',
  label: 'Certificados',
  labelSingular: 'Certificado',
  icon: '📜',
  group: 'Documentación',
  order: 43,
  display: '{tipo} — {numero}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['numero', 'nombre_titular', 'tipo'],
  listFields: ['numero', 'tipo', 'nombre_titular', 'fecha_emision', 'iglesia_id', 'estado'],
  defaultSort: { field: 'fecha_emision', dir: 'desc' },
  fields: [
    {
      name: 'numero', label: 'Número', type: 'text', required: true, unique: 'iglesia_id',
      help: 'Ej. CERT-001-2026. No puede repetirse dentro de la misma iglesia.',
    },
    {
      name: 'tipo', label: 'Tipo de certificado', type: 'select', required: true, default: 'Bautismo',
      options: ['Bautismo', 'Presentación de niños', 'Matrimonio', 'Membresía', 'Traslado', 'Buena conducta', 'Reconocimiento', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia que emite', type: 'ref', ref: 'iglesias', required: true },
    { name: 'miembro_id', label: 'Miembro (si está registrado)', type: 'ref', ref: 'miembros' },
    { name: 'nombre_titular', label: 'Nombre del titular', type: 'text', required: true, help: 'Nombre completo tal como aparecerá en el certificado' },
    { name: 'fecha_evento', label: 'Fecha del evento (bautismo, boda, etc.)', type: 'date' },
    { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', required: true },
    { name: 'oficiante_id', label: 'Oficiante / Firma', type: 'ref', ref: 'pastores' },
    { name: 'texto', label: 'Texto del certificado', type: 'textarea', help: 'Texto central que aparecerá impreso. Si se deja vacío se usa un texto estándar según el tipo.' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Emitido',
      options: ['Emitido', 'Anulado'],
    },
    { name: 'notas', label: 'Notas internas', type: 'textarea' },
  ],
};
