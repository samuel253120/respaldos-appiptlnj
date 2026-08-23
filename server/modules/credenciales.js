/** Módulo: Credenciales (carnets ministeriales y de membresía). Imprimible. */
module.exports = {
  name: 'credenciales',
  label: 'Credenciales',
  labelSingular: 'Credencial',
  genero: 'f', // «una credencial»: la regla por la terminación no lo acierta
  icon: '🪪',
  group: 'Documentación',
  order: 44,
  display: '{numero} — {nombre_titular}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['numero', 'nombre_titular', 'tipo'],
  listFields: ['numero', 'nombre_titular', 'tipo', 'fecha_vencimiento', 'iglesia_id', 'estado'],
  defaultSort: { field: 'fecha_emision', dir: 'desc' },
  fields: [
    {
      name: 'numero', label: 'Número de credencial', type: 'text', required: true, unique: 'iglesia_id',
      help: 'Ej. CRED-001. No puede repetirse dentro de la misma iglesia.',
    },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Pastor',
      options: ['Pastor', 'Guía', 'Obrero', 'Diácono', 'Misionero', 'Miembro', 'Otro'],
    },
    { name: 'nombre_titular', label: 'Nombre del titular', type: 'text', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'pastor_id', label: 'Pastor / Guía (si está registrado)', type: 'ref', ref: 'pastores' },
    { name: 'miembro_id', label: 'Miembro (si está registrado)', type: 'ref', ref: 'miembros' },
    { name: 'cargo', label: 'Cargo que acredita', type: 'text' },
    { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', required: true },
    { name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', futuro: true, noAntesDe: 'fecha_emision' },
    { name: 'foto', label: 'Foto del titular', type: 'file', accept: 'image/*', recorte: 'cuadrado' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Vigente',
      options: ['Vigente', 'Vencida', 'Suspendida', 'Anulada'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
