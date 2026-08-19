/**
 * Módulo: Pastores y Guías (liderazgo ministerial).
 *
 * Matrimonio: el pastor y la pastora se vinculan entre sí; el vínculo queda
 * en las dos fichas. Si el cónyuge no está en este módulo sino en Miembros,
 * se vincula allá.
 */
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
      name: 'conyuge_id', label: 'Cónyuge (pastor / guía)', type: 'ref', ref: 'pastores',
      help: 'Si su cónyuge también está registrado aquí, elíjalo: el vínculo queda en las dos fichas. Si solo está en Miembros, vincúlelo desde allá.',
    },
    {
      name: 'conyuge_miembro_id', label: 'Cónyuge (miembro)', type: 'ref', ref: 'miembros',
      help: 'Si su cónyuge está registrado como miembro y no como pastor(a).',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'],
    },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { id, existing }) {
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && id && Number(conyuge) === Number(id)) {
        return 'Un pastor no puede figurar como su propio cónyuge';
      }
      return null;
    },

    /** El vínculo del matrimonio queda en las dos fichas. */
    afterSave(fila, { db }) {
      const conyugeId = fila.conyuge_id || null;
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(fila.id, conyugeId || 0);
      if (!conyugeId) return;

      const conyuge = db.prepare('SELECT * FROM pastores WHERE id = ?').get(conyugeId);
      if (!conyuge) {
        db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE id = ?').run(fila.id);
        return;
      }
      if (conyuge.conyuge_id && Number(conyuge.conyuge_id) !== Number(fila.id)) {
        db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE id = ?').run(conyuge.conyuge_id);
      }
      db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(fila.id, conyuge.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
