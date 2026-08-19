/**
 * Módulo: Tesorería (ingresos y egresos).
 *
 * Cada movimiento pertenece a una **cuenta de tesorería** (ver el módulo
 * Cuentas de Tesorería): la general de la corporación, la general de una
 * iglesia local, o alguna de las cuentas de proyecto de cualquiera de los dos
 * niveles. La iglesia del movimiento se toma de su cuenta, para que el
 * alcance por iglesia calce siempre con el nivel de la cuenta.
 *
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
  listFields: ['fecha', 'cuenta_id', 'tipo', 'categoria', 'concepto', 'monto'],
  filterFields: ['cuenta_id', 'tipo', 'categoria'],
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
        'Servicios públicos', 'Mantenimiento', 'Compras', 'Ayuda social', 'Honorarios', 'Viáticos', 'Traspaso', 'Otro',
      ],
    },
    { name: 'concepto', label: 'Concepto / Descripción', type: 'text', required: true },
    { name: 'monto', label: 'Monto', type: 'money', required: true },
    {
      name: 'metodo', label: 'Método', type: 'select', default: 'Efectivo',
      options: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
    },
    {
      name: 'cuenta_id', label: 'Cuenta de tesorería', type: 'ref', ref: 'cuentas_tesoreria', required: true,
      optionsRoute: '/cuentas_tesoreria/activas',
      help: 'En qué cuenta entra o sale este dinero: la general de la corporación o de la iglesia, o una cuenta de proyecto. Solo se ofrecen las cuentas activas.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma de la cuenta elegida. Las cuentas de la corporación no pertenecen a una iglesia.',
    },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos' },
    { name: 'comprobante', label: 'Comprobante (imagen o PDF)', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
    // Movimientos generados por un traspaso o por la ofrenda de un servicio
    // (se manejan desde allá, para que los dos lados queden siempre cuadrados)
    { name: 'traspaso_id', type: 'number', oculto: true, readonly: true },
    { name: 'servicio_id', type: 'number', oculto: true, readonly: true },
  ],
  hooks: {
    beforeSave(data, { user, existing, db }) {
      // Los dos movimientos de un traspaso se corrigen desde el traspaso, para
      // que los dos lados queden siempre por el mismo monto y la misma fecha.
      if (existing && existing.traspaso_id) {
        return 'Este movimiento lo generó un traspaso entre cuentas: modifíquelo en «Traspasos entre Cuentas»';
      }
      if (existing && existing.servicio_id) {
        return 'Este movimiento lo generó la ofrenda de un servicio: modifíquelo en «Registro de Servicios»';
      }

      // La iglesia del movimiento es la de su cuenta (o ninguna, si es de la corporación)
      const cuentaId = data.cuenta_id !== undefined ? data.cuenta_id : existing ? existing.cuenta_id : null;
      if (!cuentaId) return 'Indique la cuenta de tesorería del movimiento';
      const cuenta = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
      if (!cuenta) return 'La cuenta de tesorería indicada no existe';

      // Un usuario asignado a una iglesia solo mueve dinero de las cuentas de esa iglesia
      if (user.iglesia_id && (cuenta.iglesia_id || null) !== user.iglesia_id) {
        return `La cuenta "${cuenta.nombre}" no pertenece a su iglesia`;
      }

      // Una cuenta cerrada no recibe movimientos nuevos, pero los suyos se pueden corregir
      const cambiaDeCuenta = !existing || String(existing.cuenta_id) !== String(cuentaId);
      if (cuenta.estado === 'Cerrada' && cambiaDeCuenta) {
        return `La cuenta "${cuenta.nombre}" está cerrada: no admite nuevos movimientos`;
      }

      data.iglesia_id = cuenta.iglesia_id || null;
      return null;
    },

    beforeDelete(fila) {
      if (fila.traspaso_id) {
        return 'Este movimiento lo generó un traspaso entre cuentas: elimine el traspaso y los dos lados se van juntos';
      }
      if (fila.servicio_id) {
        return 'Este movimiento lo generó la ofrenda de un servicio: cambie la ofrenda en el servicio y el movimiento se ajusta solo';
      }
      return null;
    },
  },

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
      if (req.query.f_cuenta_id) {
        where.push('cuenta_id = ?');
        params.push(req.query.f_cuenta_id);
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
      // Saldo por cuenta, para ver de un vistazo cómo está repartido el dinero
      const porCuenta = db
        .prepare(
          `SELECT c.id, c.nombre, c.ambito, c.tipo,
                  COALESCE(c.saldo_inicial, 0)
                    + COALESCE(SUM(CASE WHEN t.tipo = 'Ingreso' THEN t.monto ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN t.tipo = 'Egreso'  THEN t.monto ELSE 0 END), 0) AS saldo
             FROM cuentas_tesoreria c
             LEFT JOIN tesoreria t ON t.cuenta_id = c.id
            ${req.user.iglesia_id ? 'WHERE c.iglesia_id = ?' : ''}
            GROUP BY c.id
            ORDER BY c.ambito, c.tipo DESC, c.nombre`
        )
        .all(...(req.user.iglesia_id ? [req.user.iglesia_id] : []));

      res.json({
        ingresos, egresos, balance: ingresos - egresos,
        movimientos: totals.reduce((a, t) => a + t.n, 0),
        porCategoria, porCuenta,
      });
    });
  },
};
