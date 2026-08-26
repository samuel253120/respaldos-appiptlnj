/**
 * Módulo: Certificados (bautismo, presentación, matrimonio, membresía…).
 * Imprimible.
 *
 * De qué clases hay, qué dice cada una y cómo se ve la hoja NO está acá: lo
 * mantiene la iglesia en «Formatos de Certificado». Acá queda cada certificado
 * emitido, con su número, su titular y sus fechas.
 */
module.exports = {
  name: 'certificados',
  label: 'Certificados',
  labelSingular: 'Certificado',
  icon: '📜',
  group: 'Documentación',
  order: 63,
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
      name: 'tipo', label: 'Tipo de certificado', type: 'select', required: true,
      // Los mantiene la iglesia (módulo «Formatos de Certificado»): de ahí sale
      // también el texto y el diseño de la hoja al imprimir
      optionsRoute: '/formatos_certificado/opciones',
      help: 'Se administran en Formatos de Certificado, junto con su texto y su diseño.',
    },
    { name: 'iglesia_id', label: 'Iglesia que emite', type: 'ref', ref: 'iglesias', required: true },
    { name: 'miembro_id', label: 'Miembro (si está registrado)', type: 'ref', ref: 'miembros' },
    { name: 'nombre_titular', label: 'Nombre del titular', type: 'text', required: true, help: 'Nombre completo tal como aparecerá en el certificado' },
    { name: 'fecha_evento', label: 'Fecha del evento (bautismo, boda, etc.)', type: 'date' },
    { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', required: true },
    { name: 'oficiante_id', label: 'Oficiante / Firma', type: 'ref', ref: 'pastores' },
    {
      name: 'texto', label: 'Texto del certificado', type: 'textarea',
      help: 'Solo si este certificado tiene que decir algo distinto. Vacío usa el texto del formato, ' +
        'que es lo habitual: así, corregir una redacción se hace una vez en el formato y no certificado por certificado.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Emitido',
      options: ['Emitido', 'Anulado'],
    },
    { name: 'notas', label: 'Notas internas', type: 'textarea' },
  ],
};
