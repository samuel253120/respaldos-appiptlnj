/** Módulo: Inventarios (bienes de la iglesia y de cada cuerpo/grupo). */
module.exports = {
  name: 'inventarios',
  label: 'Inventarios',
  labelSingular: 'Artículo de inventario',
  icon: '📦',
  group: 'Finanzas',
  order: 32,
  display: '{articulo}',
  searchFields: ['articulo', 'categoria', 'ubicacion', 'notas'],
  listFields: ['articulo', 'categoria', 'cantidad', 'estado', 'iglesia_id', 'cuerpo_id'],
  defaultSort: { field: 'articulo', dir: 'asc' },
  fields: [
    { name: 'articulo', label: 'Artículo', type: 'text', required: true },
    {
      name: 'categoria', label: 'Categoría', type: 'select', default: 'Mobiliario',
      options: ['Mobiliario', 'Equipo de sonido', 'Instrumentos musicales', 'Equipo audiovisual', 'Electrodomésticos', 'Cocina', 'Vehículos', 'Inmuebles', 'Material didáctico', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (vacío = inventario general de la iglesia)', type: 'ref', ref: 'cuerpos' },
    { name: 'cantidad', label: 'Cantidad', type: 'number', required: true, default: 1 },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Bueno',
      options: ['Bueno', 'Regular', 'Malo', 'En reparación', 'De baja'],
    },
    { name: 'valor_estimado', label: 'Valor estimado (unitario)', type: 'money' },
    { name: 'fecha_adquisicion', label: 'Fecha de adquisición', type: 'date' },
    { name: 'ubicacion', label: 'Ubicación física', type: 'text' },
    { name: 'responsable_id', label: 'Responsable', type: 'ref', ref: 'miembros' },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
