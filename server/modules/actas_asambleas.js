/** Módulo: Actas de Asambleas (asambleas generales de la iglesia). */
module.exports = {
  name: 'actas_asambleas',
  label: 'Actas de Asambleas',
  labelSingular: 'Acta de Asamblea',
  icon: '🏛️',
  group: 'Documentación',
  order: 61,
  display: 'Asamblea {numero_acta} — {fecha}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['numero_acta', 'agenda', 'acuerdos', 'presidida_por'],
  listFields: ['numero_acta', 'fecha', 'tipo', 'iglesia_id', 'total_asistentes', 'estado'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    {
      name: 'numero_acta', label: 'Número de acta', type: 'text', required: true,
      // Único dentro de la iglesia: la asamblea es de la congregación entera,
      // así que su libro es uno por iglesia.
      unique: 'iglesia_id',
      help: 'Lo propone el sistema, y se puede cambiar. Ej. AS-001-2026',
    },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo de asamblea', type: 'select', required: true, default: 'Ordinaria',
      options: ['Ordinaria', 'Extraordinaria'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    { name: 'hora_fin', label: 'Hora de finalización', type: 'time' },
    { name: 'presidida_por', label: 'Presidida por', type: 'text' },
    { name: 'secretario', label: 'Secretario(a)', type: 'text' },
    { name: 'total_asistentes', label: 'Total de asistentes', type: 'number' },
    { name: 'hubo_quorum', label: '¿Hubo quórum?', type: 'boolean', default: 1 },
    { name: 'agenda', label: 'Agenda / Orden del día', type: 'textarea' },
    { name: 'desarrollo', label: 'Desarrollo de la asamblea', type: 'textarea' },
    { name: 'acuerdos', label: 'Acuerdos y resoluciones', type: 'textarea' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Borrador',
      options: ['Borrador', 'Aprobada', 'Firmada'],
    },
    { name: 'documento', label: 'Documento adjunto (escaneada/firmada)', type: 'file' },
  ],

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Qué número le toca a la próxima acta de asamblea de esta iglesia.
     *
     * Es una propuesta, igual que en las actas de reunión: se puede cambiar, y
     * si dos personas la piden a la vez la segunda se topa al guardar con que
     * ese número ya está usado (ver server/numeracion.js).
     */
    router.get('/actas_asambleas/proximo-numero', requirePerm('actas_asambleas', 'create'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.json({ numero: null });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      res.json({ numero: require('../numeracion').proximoNumero('actas_asambleas', iglesiaId, req.query.fecha) });
    });
  },
};
