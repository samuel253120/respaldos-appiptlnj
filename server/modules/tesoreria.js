/**
 * Módulo: Tesorería (ingresos y egresos por iglesia y cuerpo).
 * Incluye ruta extra GET /api/tesoreria/resumen con totales y balance.
 */
module.exports = {
  name: 'tesoreria',
  label: 'Tesorería',
  labelSingular: 'Movimiento',
  icon: '💰',
  group: 'Finanzas',
  order: 30,
  display: '{tipo}: {concepto}',
  dateField: 'fecha',
  searchFields: ['concepto', 'categoria', 'notas'],
  listFields: ['fecha', 'tipo', 'categoria', 'concepto', 'monto', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Ingreso',
      options: ['Ingreso', 'Egreso'],
    },
    {
      name: 'categoria', label: 'Categoría', type: 'select', required: true, default: 'Ofrendas',
      options: [
        'Diezmos', 'Ofrendas', 'Primicias', 'Pro-Templo', 'Donaciones', 'Actividades',
        'Servicios públicos', 'Mantenimiento', 'Compras', 'Ayuda social', 'Honorarios', 'Viáticos', 'Otro',
      ],
    },
    { name: 'concepto', label: 'Concepto / Descripción', type: 'text', required: true },
    { name: 'monto', label: 'Monto', type: 'money', required: true },
    {
      name: 'metodo', label: 'Método', type: 'select', default: 'Efectivo',
      options: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos' },
    { name: 'comprobante', label: 'Comprobante (imagen o PDF)', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  extraRoutes(router, { db, requirePerm, scopeClause }) {
    // Resumen financiero: totales generales, del período filtrado y por categoría.
    router.get('/tesoreria/resumen', requirePerm('tesoreria', 'view'), (req, res) => {
      const params = [];
      const where = [];
      const scope = scopeClause(req.user, params);
      if (scope) where.push(scope);
      if (req.query.f_iglesia_id) {
        where.push('iglesia_id = ?');
        params.push(req.query.f_iglesia_id);
      }
      if (req.query.f_cuerpo_id) {
        where.push('cuerpo_id = ?');
        params.push(req.query.f_cuerpo_id);
      }
      if (req.query.desde) {
        where.push('fecha >= ?');
        params.push(req.query.desde);
      }
      if (req.query.hasta) {
        where.push('fecha <= ?');
        params.push(req.query.hasta);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const totals = db
        .prepare(`SELECT tipo, COALESCE(SUM(monto),0) AS total, COUNT(*) AS n FROM tesoreria ${whereSql} GROUP BY tipo`)
        .all(...params);
      const porCategoria = db
        .prepare(`SELECT tipo, categoria, COALESCE(SUM(monto),0) AS total FROM tesoreria ${whereSql} GROUP BY tipo, categoria ORDER BY total DESC`)
        .all(...params);
      const ingresos = (totals.find((t) => t.tipo === 'Ingreso') || {}).total || 0;
      const egresos = (totals.find((t) => t.tipo === 'Egreso') || {}).total || 0;
      res.json({ ingresos, egresos, balance: ingresos - egresos, movimientos: totals.reduce((a, t) => a + t.n, 0), porCategoria });
    });
  },
};
