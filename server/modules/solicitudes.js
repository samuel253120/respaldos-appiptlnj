/** Módulo: Solicitudes (peticiones y trámites internos con flujo de estado). */
module.exports = {
  name: 'solicitudes',
  label: 'Solicitudes',
  labelSingular: 'Solicitud',
  icon: '📨',
  group: 'Documentación',
  order: 45,
  display: '{asunto}',
  dateField: 'fecha',
  searchFields: ['asunto', 'solicitante', 'descripcion'],
  listFields: ['fecha', 'solicitante', 'tipo', 'asunto', 'estado', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha de la solicitud', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'solicitante', label: 'Solicitante', type: 'text', required: true },
    { name: 'miembro_id', label: 'Miembro relacionado (si aplica)', type: 'ref', ref: 'miembros' },
    {
      name: 'tipo', label: 'Tipo de solicitud', type: 'select', required: true, default: 'Otro',
      options: ['Traslado de membresía', 'Certificado', 'Credencial', 'Ayuda social', 'Permiso / Licencia', 'Uso de instalaciones', 'Materiales / Equipo', 'Audiencia con liderazgo', 'Otro'],
    },
    { name: 'asunto', label: 'Asunto', type: 'text', required: true },
    { name: 'descripcion', label: 'Descripción detallada', type: 'textarea' },
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Pendiente',
      options: ['Pendiente', 'En revisión', 'Aprobada', 'Rechazada', 'Completada'],
    },
    { name: 'respuesta', label: 'Respuesta / Resolución', type: 'textarea' },
    { name: 'atendida_por', label: 'Atendida por', type: 'text' },
    { name: 'fecha_respuesta', label: 'Fecha de respuesta', type: 'date' },
  ],
};
