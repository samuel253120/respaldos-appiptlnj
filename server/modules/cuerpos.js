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
 *
 * La directiva de cada cuerpo se registra por períodos en el módulo
 * "directivas" (histórico). Aquí se calcula el ESTADO DE CUMPLIMIENTO a
 * partir de esos datos: reglamento adjunto, directiva vigente y no vencida,
 * y cuerpo activo.
 */

/** Revisa los requisitos formales de un cuerpo y devuelve su estado. */
function evaluarCumplimiento(fila, db) {
  if (fila.tipo !== 'Cuerpo') return { nivel: 'No aplica', texto: 'No aplica', items: [] };

  const hoy = new Date().toISOString().slice(0, 10);
  const directiva = db
    .prepare(`SELECT * FROM directivas WHERE cuerpo_id = ? AND estado = 'Vigente' ORDER BY fecha_inicio DESC LIMIT 1`)
    .get(fila.id);

  const items = [
    {
      texto: 'Reglamento adjunto',
      ok: !!fila.reglamento,
      detalle: fila.reglamento ? 'Documento cargado' : 'Falta adjuntar el reglamento vigente',
    },
    {
      texto: 'Directiva vigente registrada',
      ok: !!directiva,
      detalle: directiva ? `Período ${directiva.periodo}` : 'No hay una directiva vigente registrada',
    },
    {
      texto: 'Directiva dentro de su período',
      ok: !!directiva && (!directiva.fecha_termino || directiva.fecha_termino >= hoy),
      detalle: !directiva
        ? 'Sin directiva vigente'
        : !directiva.fecha_termino
          ? 'Sin fecha de término definida'
          : directiva.fecha_termino >= hoy
            ? `Vigente hasta el ${directiva.fecha_termino}`
            : `Venció el ${directiva.fecha_termino}`,
    },
    {
      texto: 'Cuerpo activo',
      ok: fila.estado === 'Activo',
      detalle: fila.estado || 'Sin estado',
    },
  ];

  const faltan = items.filter((i) => !i.ok).length;
  const nivel = faltan === 0 ? 'Al día' : faltan === 1 ? 'Observado' : 'Pendiente';
  const texto = faltan === 0 ? 'Al día' : `${nivel} (${faltan})`;
  return { nivel, texto, items };
}

module.exports = {
  name: 'cuerpos',
  label: 'Cuerpos / Grupos',
  labelSingular: 'Cuerpo / Grupo',
  icon: '👥',
  group: 'Organización',
  order: 12,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion'],
  listFields: ['nombre', 'tipo', 'iglesia_id', 'lider_id', 'estado', 'cumplimiento'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  computed: [
    {
      name: 'cumplimiento', label: 'Cumplimiento', type: 'badge',
      help: 'Se calcula con el reglamento, la directiva vigente y el estado del cuerpo.',
      calc: (fila, { db }) => evaluarCumplimiento(fila, db),
    },
  ],
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
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo'],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
  ],
  extraRoutes(router, { db, requirePerm }) {
    // Detalle del cumplimiento de un cuerpo, para mostrarlo en su ficha
    router.get('/cuerpos/:id(\\d+)/cumplimiento', requirePerm('cuerpos', 'view'), (req, res) => {
      const fila = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(req.params.id);
      if (!fila) return res.status(404).json({ error: 'Cuerpo no encontrado' });
      res.json(evaluarCumplimiento(fila, db));
    });
  },
};
