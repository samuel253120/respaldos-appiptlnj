/**
 * Módulo: Cuerpos / Grupos de cada iglesia.
 *
 * La organización distingue dos realidades distintas:
 *
 * - CUERPO: entidad formal, con reglamento, deberes y derechos, y su propia
 *   directiva (ej. Damas, Caballeros, Jóvenes). Por eso tiene campos para el
 *   reglamento, la fecha de constitución y los cargos de la directiva.
 * - GRUPO: agrupación de servicio o ayuda, sin reglamento ni obligaciones
 *   formales (ej. equipo de aseo, apoyo social).
 *
 * Los campos propios de los cuerpos se muestran solo cuando el tipo es
 * "Cuerpo", mediante la condición showIf.
 */
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
      help: 'CUERPO: entidad formal, con reglamento, deberes y derechos. GRUPO: agrupación de servicio o ayuda, sin reglamento ni obligaciones formales.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lider_id', label: 'Líder / Encargado', type: 'ref', ref: 'miembros' },
    { name: 'integrantes', label: 'Integrantes', type: 'multiref', ref: 'miembros' },
    { name: 'fecha_creacion', label: 'Fecha de creación', type: 'date' },

    // --- Propios de los cuerpos formales ---
    {
      name: 'fecha_constitucion', label: 'Fecha de constitución formal', type: 'date',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'reglamento', label: 'Reglamento (documento)', type: 'file',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
      help: 'Reglamento vigente del cuerpo, con sus deberes y derechos.',
    },
    {
      name: 'reglamento_fecha', label: 'Fecha de aprobación del reglamento', type: 'date',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'presidente_id', label: 'Presidente(a)', type: 'ref', ref: 'miembros',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'secretario_id', label: 'Secretario(a)', type: 'ref', ref: 'miembros',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'tesorero_id', label: 'Tesorero(a)', type: 'ref', ref: 'miembros',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'periodo_directiva', label: 'Período de la directiva', type: 'text',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
      help: 'Ej: 2026 – 2027',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo'],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
  ],
};
