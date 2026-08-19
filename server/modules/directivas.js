/**
 * Módulo: Directivas de Cuerpos (histórico).
 *
 * Cada cuerpo formal elige su directiva por períodos. Aquí queda el registro
 * de todas: la vigente y las anteriores, con sus cargos y el acta de elección.
 *
 * La directiva se compone de: oficial supervisor(a), primer jefe / primera
 * jefa, segundo jefe / segunda jefa, secretario(a), tesorero(a) y, cuando se
 * designa, consejero(a).
 *
 * Regla: un cuerpo tiene como máximo UNA directiva vigente. Al marcar una
 * como vigente, las demás de ese cuerpo pasan a "Finalizada" automáticamente.
 */
module.exports = {
  name: 'directivas',
  label: 'Directivas de Cuerpos',
  labelSingular: 'Directiva',
  icon: '🏅',
  group: 'Organización',
  order: 13,
  display: '{periodo}',
  dateField: 'fecha_inicio',
  printable: true,
  searchFields: ['periodo', 'otros_cargos', 'notas'],
  listFields: ['cuerpo_id', 'periodo', 'primer_jefe_id', 'secretario_id', 'fecha_inicio', 'fecha_termino', 'estado'],
  defaultSort: { field: 'fecha_inicio', dir: 'desc' },
  fields: [
    { name: 'cuerpo_id', label: 'Cuerpo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'periodo', label: 'Período', type: 'text', required: true, help: 'Ej: 2026 – 2027' },
    { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true },
    { name: 'fecha_termino', label: 'Fecha de término', type: 'date', help: 'Al llegar esta fecha, la directiva figura como vencida en el estado de cumplimiento.' },
    // --- Integrantes de la directiva ---
    {
      name: 'oficial_supervisor_id', label: 'Oficial supervisor(a)', type: 'ref', ref: 'pastores',
      help: 'Oficial de la iglesia que supervisa el cuerpo (pastor, guía, anciano, diácono…).',
    },
    { name: 'primer_jefe_id', label: 'Primer jefe / Primera jefa', type: 'ref', ref: 'miembros' },
    { name: 'segundo_jefe_id', label: 'Segundo jefe / Segunda jefa', type: 'ref', ref: 'miembros' },
    { name: 'secretario_id', label: 'Secretario(a)', type: 'ref', ref: 'miembros' },
    { name: 'tesorero_id', label: 'Tesorero(a)', type: 'ref', ref: 'miembros' },
    { name: 'consejero_id', label: 'Consejero(a)', type: 'ref', ref: 'miembros', help: 'Cargo adicional, no siempre se designa.' },
    { name: 'otros_cargos', label: 'Otros cargos', type: 'textarea', help: 'Opcional. Ej: Directora de música: Ana Soto' },
    { name: 'acta_eleccion', label: 'Acta de elección', type: 'file' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Vigente',
      options: ['Vigente', 'Finalizada'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { db, id, existing }) {
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing && existing.cuerpo_id;
      if (!cuerpoId) return null;

      // Heredar la iglesia del cuerpo
      if (data.iglesia_id === undefined || data.iglesia_id === null) {
        const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (cuerpo) data.iglesia_id = cuerpo.iglesia_id;
      }

      // Una sola directiva vigente por cuerpo
      const estado = data.estado !== undefined ? data.estado : existing && existing.estado;
      if (estado === 'Vigente') {
        db.prepare(
          `UPDATE directivas SET estado = 'Finalizada' WHERE cuerpo_id = ? AND id != ? AND estado = 'Vigente'`
        ).run(cuerpoId, id || 0);
      }
      return null;
    },
  },
};
