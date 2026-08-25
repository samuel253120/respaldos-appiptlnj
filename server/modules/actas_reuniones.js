/**
 * Módulo: Actas de Reuniones de Cuerpos / Grupos.
 *
 * Un acta se puede registrar de dos maneras, y las dos valen: adjuntando el
 * documento firmado, o escribiéndola acá mismo. Para lo segundo, el desarrollo
 * y los acuerdos son campos de texto con formato —negrita, cursiva, listas y
 * títulos—, que es como se escribe un acta de verdad.
 *
 * Se ven y se crean desde la ficha del propio cuerpo, que es donde se buscan.
 */
module.exports = {
  name: 'actas_reuniones',
  label: 'Actas de Reuniones',
  labelSingular: 'Acta de Reunión',
  icon: '📝',
  group: 'Documentación',
  order: 60,
  display: 'Acta {numero_acta} — {fecha}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['numero_acta', 'agenda', 'acuerdos', 'presidida_por'],
  listFields: ['numero_acta', 'fecha', 'cuerpo_id', 'iglesia_id', 'presidida_por', 'estado'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'numero_acta', label: 'Número de acta', type: 'text', required: true, help: 'Ej. 001-2026', seccion: 'Identificación' },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text', seccion: 'Dónde y quiénes' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    { name: 'hora_fin', label: 'Hora de finalización', type: 'time' },
    { name: 'presidida_por', label: 'Presidida por', type: 'text' },
    { name: 'secretario', label: 'Secretario(a)', type: 'text' },
    { name: 'asistentes', label: 'Asistentes', type: 'multiref', ref: 'miembros' },
    {
      name: 'agenda', label: 'Agenda / Orden del día', type: 'textarea',
      seccion: 'El acta',
      help: 'Los puntos que se trataron. Se puede dejar en blanco si el acta va adjunta.',
    },
    {
      name: 'desarrollo', label: 'Desarrollo de la reunión', type: 'richtext',
      help: 'El acta escrita acá mismo, con formato. Se puede dejar en blanco si va adjunta.',
    },
    { name: 'acuerdos', label: 'Acuerdos y compromisos', type: 'richtext' },
    { name: 'documento', label: 'Documento adjunto (escaneada/firmada)', type: 'file', seccion: 'Documento y estado' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Borrador',
      options: ['Borrador', 'Aprobada', 'Firmada'],
    },
  ],
};
