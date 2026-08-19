/** Módulo: Cuerpos / Grupos (ministerios y sociedades internas de cada iglesia). */
module.exports = {
  name: 'cuerpos',
  label: 'Cuerpos / Grupos',
  labelSingular: 'Cuerpo / Grupo',
  icon: '👥',
  group: 'Organización',
  order: 12,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion'],
  listFields: ['nombre', 'tipo', 'iglesia_id', 'lider_id', 'estado'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    { name: 'nombre', label: 'Nombre', type: 'text', required: true, help: 'Ej: Damas, Caballeros, Jóvenes, Coro, Escuela Dominical…' },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Cuerpo',
      options: ['Cuerpo', 'Grupo'],
      help: 'El nombre propio (Damas, Caballeros, Jóvenes, Coro…) va en el campo Nombre.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lider_id', label: 'Líder / Encargado', type: 'ref', ref: 'miembros' },
    { name: 'integrantes', label: 'Integrantes', type: 'multiref', ref: 'miembros' },
    { name: 'fecha_creacion', label: 'Fecha de creación', type: 'date' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo'],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
  ],
};
