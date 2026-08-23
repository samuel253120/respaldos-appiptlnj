/** Módulo: Ayudas Sociales (apoyo a miembros y comunidad). */
module.exports = {
  name: 'ayudas_sociales',
  label: 'Ayudas Sociales',
  labelSingular: 'Ayuda Social',
  icon: '🤝',
  group: 'Finanzas',
  order: 31,
  display: '{tipo_ayuda} — {beneficiario}',
  dateField: 'fecha',
  searchFields: ['beneficiario', 'descripcion', 'tipo_ayuda'],
  listFields: ['fecha', 'beneficiario', 'tipo_ayuda', 'valor_estimado', 'estado', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'beneficiario', label: 'Beneficiario', type: 'text', required: true, help: 'Nombre de la persona o familia beneficiada' },
    { name: 'miembro_id', label: 'Miembro relacionado (si aplica)', type: 'ref', ref: 'miembros' },
    {
      name: 'tipo_ayuda', label: 'Tipo de ayuda', type: 'select', required: true, default: 'Alimentos',
      options: ['Alimentos', 'Económica', 'Medicamentos / Salud', 'Ropa', 'Vivienda', 'Funeraria', 'Educación', 'Otro'],
    },
    { name: 'descripcion', label: 'Descripción de la ayuda', type: 'textarea' },
    { name: 'valor_estimado', label: 'Valor estimado', type: 'money', min: 0, },
    { name: 'aprobada_por', label: 'Aprobada por', type: 'text' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Solicitada',
      options: ['Solicitada', 'Aprobada', 'Entregada', 'Rechazada'],
    },
    { name: 'soporte', label: 'Soporte / Evidencia', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
