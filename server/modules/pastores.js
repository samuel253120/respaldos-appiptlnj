/** Módulo: Pastores y Guías (liderazgo ministerial). */
module.exports = {
  name: 'pastores',
  label: 'Pastores / Guías',
  labelSingular: 'Pastor / Guía',
  icon: '🧑‍💼',
  group: 'Organización',
  order: 11,
  display: '{nombres} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono'],
  listFields: ['foto', 'rut', 'nombres', 'apellidos', 'cargo', 'iglesia_id', 'estado'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  fields: [
    { name: 'nombres', label: 'Nombres', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    {
      name: 'cargo', label: 'Cargo', type: 'select', required: true, default: 'Pastor',
      options: ['Pastor', 'Pastora', 'Guía', 'Anciano', 'Diácono', 'Diaconisa', 'Evangelista', 'Misionero', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true,
      help: 'Con o sin puntos. Se valida el dígito verificador y evita registros repetidos.',
    },
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date' },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'documento_identidad', label: 'Otro documento (pasaporte / extranjero)', type: 'text' },
    { name: 'fecha_ordenacion', label: 'Fecha de ordenación', type: 'date' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'],
    },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
