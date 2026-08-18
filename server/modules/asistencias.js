/** Módulo: Asistencias (registro de asistencia a cultos y reuniones). */
module.exports = {
  name: 'asistencias',
  label: 'Asistencias',
  labelSingular: 'Asistencia',
  icon: '📋',
  group: 'Personas',
  order: 21,
  display: '{tipo_reunion} — {fecha}',
  dateField: 'fecha',
  searchFields: ['tipo_reunion', 'observaciones'],
  listFields: ['fecha', 'tipo_reunion', 'iglesia_id', 'cuerpo_id', 'total_general'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo_reunion', label: 'Tipo de reunión', type: 'select', required: true, default: 'Culto general',
      options: ['Culto general', 'Escuela Dominical', 'Culto de oración', 'Ayuno', 'Estudio bíblico', 'Reunión de cuerpo', 'Vigilia', 'Evangelismo', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos' },
    { name: 'total_hombres', label: 'Hombres', type: 'number', default: 0 },
    { name: 'total_mujeres', label: 'Mujeres', type: 'number', default: 0 },
    { name: 'total_ninos', label: 'Niños', type: 'number', default: 0 },
    { name: 'total_visitas', label: 'Visitas', type: 'number', default: 0 },
    { name: 'total_general', label: 'Total general', type: 'number', help: 'Si se deja vacío se calcula con la suma de los anteriores' },
    { name: 'miembros_presentes', label: 'Miembros presentes (lista nominal)', type: 'multiref', ref: 'miembros' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data) {
      const sum =
        (Number(data.total_hombres) || 0) +
        (Number(data.total_mujeres) || 0) +
        (Number(data.total_ninos) || 0) +
        (Number(data.total_visitas) || 0);
      if (data.total_general == null || data.total_general === '' || Number(data.total_general) === 0) {
        data.total_general = sum;
      }
      return null;
    },
  },
};
