/**
 * Módulo: Cuentas de Tesorería.
 *
 * La organización maneja su dinero en varias cuentas, en dos niveles:
 *
 *   Corporación          → su tesorería general + una cuenta por cada
 *                          proyecto o trabajo de la corporación.
 *   Cada iglesia local   → su tesorería general + una cuenta por cada
 *                          proyecto o trabajo de esa iglesia.
 *
 * Cada movimiento de Tesorería se registra en una de estas cuentas, y el
 * saldo de cada una se calcula solo: saldo inicial + ingresos − egresos.
 *
 * Regla: en cada nivel hay una sola cuenta "General" (la tesorería del
 * nivel). Las demás son cuentas de proyecto o trabajo.
 */

/** Ingresos, egresos y saldo de una cuenta. */
function movimientosDe(cuentaId, db) {
  const fila = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
         COALESCE(SUM(CASE WHEN tipo = 'Egreso'  THEN monto ELSE 0 END), 0) AS egresos,
         COUNT(*) AS movimientos
       FROM tesoreria WHERE cuenta_id = ?`
    )
    .get(cuentaId);
  return fila || { ingresos: 0, egresos: 0, movimientos: 0 };
}

module.exports = {
  name: 'cuentas_tesoreria',
  label: 'Cuentas de Tesorería',
  labelSingular: 'Cuenta de tesorería',
  icon: '🏦',
  group: 'Finanzas',
  order: 29,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion', 'responsable'],
  listFields: ['nombre', 'ambito', 'iglesia_id', 'tipo', 'saldo', 'estado'],
  filterFields: ['ambito', 'tipo', 'estado'],
  defaultSort: { field: 'nombre', dir: 'asc' },

  computed: [
    {
      name: 'saldo', label: 'Saldo', type: 'money',
      calc: (r, { db }) => {
        const m = movimientosDe(r.id, db);
        return (Number(r.saldo_inicial) || 0) + m.ingresos - m.egresos;
      },
    },
  ],

  fields: [
    {
      name: 'nombre', label: 'Nombre de la cuenta', type: 'text', required: true,
      help: 'Ej: «Tesorería general», «Proyecto templo», «Campaña misionera».',
    },
    {
      name: 'ambito', label: 'Nivel', type: 'select', required: true, default: 'Iglesia local',
      options: ['Corporación', 'Iglesia local'],
      help: 'De la corporación (toda la organización) o de una iglesia local.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias',
      showIf: { field: 'ambito', equals: 'Iglesia local' },
      help: 'A qué iglesia local pertenece esta cuenta.',
    },
    {
      name: 'tipo', label: 'Tipo de cuenta', type: 'select', required: true, default: 'Proyecto / Trabajo',
      options: ['General', 'Proyecto / Trabajo'],
      help: 'La cuenta «General» es la tesorería del nivel; hay una sola por corporación y una por iglesia.',
    },
    { name: 'responsable', label: 'Responsable', type: 'persona', ref: 'miembros' },
    { name: 'fecha_apertura', label: 'Fecha de apertura', type: 'date' },
    {
      name: 'saldo_inicial', label: 'Saldo inicial', type: 'money', default: 0,
      help: 'Con cuánto empezó la cuenta, antes de registrar movimientos en el sistema.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Activa',
      options: ['Activa', 'Cerrada'],
    },
    {
      name: 'fecha_cierre', label: 'Fecha de cierre', type: 'date',
      showIf: { field: 'estado', equals: 'Cerrada' },
    },
    { name: 'descripcion', label: 'Descripción / Objetivo', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { isNew, existing, id, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const ambito = dato('ambito');

      // La cuenta de la corporación no pertenece a ninguna iglesia
      if (ambito === 'Corporación') {
        data.iglesia_id = null;
      } else if (!dato('iglesia_id')) {
        return 'Indique a qué iglesia local pertenece la cuenta';
      }

      // Una sola cuenta "General" por nivel
      if (dato('tipo') === 'General') {
        const iglesiaId = ambito === 'Corporación' ? null : dato('iglesia_id');
        const otra = iglesiaId
          ? db.prepare(`SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = 'General' AND iglesia_id = ? AND id != ?`).get(iglesiaId, id || 0)
          : db.prepare(`SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = 'General' AND iglesia_id IS NULL AND id != ?`).get(id || 0);
        if (otra) {
          return `Ya existe la cuenta general de ese nivel ("${otra.nombre}"). Las demás cuentas deben ser de tipo «Proyecto / Trabajo».`;
        }
      }

      if (isNew && !data.fecha_apertura) data.fecha_apertura = new Date().toISOString().slice(0, 10);
      return null;
    },

    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE cuenta_id = ?').get(row.id).c;
      if (usos) {
        return `No se puede eliminar: la cuenta tiene ${usos} movimiento(s) registrado(s). Ciérrela en vez de eliminarla.`;
      }
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm, scopeClause }) {
    // Opciones para el selector de cuenta de un movimiento: solo las activas
    // (una cuenta cerrada ya no recibe dinero) y solo las del alcance del usuario.
    router.get('/cuentas_tesoreria/activas', (req, res) => {
      const params = [];
      const where = ["estado = 'Activa'"];
      const scope = scopeClause(req.user, params);
      if (scope) where.push(scope);
      const filas = db
        .prepare(`SELECT id, nombre, ambito FROM cuentas_tesoreria WHERE ${where.join(' AND ')} ORDER BY ambito, nombre`)
        .all(...params);
      res.json(filas.map((c) => ({ id: c.id, label: `${c.nombre} · ${c.ambito}` })));
    });

    // Estado de una cuenta: saldo, totales y sus últimos movimientos.
    router.get('/cuentas_tesoreria/:id(\\d+)/estado', requirePerm('cuentas_tesoreria', 'view'), (req, res) => {
      const cuenta = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(req.params.id);
      if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
      if (req.user.iglesia_id && cuenta.iglesia_id !== req.user.iglesia_id) {
        return res.status(403).json({ error: 'Cuenta fuera de su iglesia asignada' });
      }
      const m = movimientosDe(cuenta.id, db);
      const ultimos = db
        .prepare(`SELECT id, fecha, tipo, categoria, concepto, monto FROM tesoreria
                  WHERE cuenta_id = ? ORDER BY fecha DESC, id DESC LIMIT 10`)
        .all(cuenta.id);
      res.json({
        nombre: cuenta.nombre,
        estado: cuenta.estado,
        saldo_inicial: Number(cuenta.saldo_inicial) || 0,
        ingresos: m.ingresos,
        egresos: m.egresos,
        movimientos: m.movimientos,
        saldo: (Number(cuenta.saldo_inicial) || 0) + m.ingresos - m.egresos,
        ultimos,
      });
    });
  },
};
