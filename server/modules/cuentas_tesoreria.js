/**
 * Módulo: Cuentas de Tesorería.
 *
 * La organización maneja su dinero en varias cuentas, en dos niveles:
 *
 *   Corporación          → su tesorería general + una cuenta por cada
 *                          proyecto o trabajo de la corporación.
 *   Cada iglesia local   → su tesorería general, su fondo para la corporación
 *                          (donde aparta el porcentaje de las ofrendas hasta
 *                          traspasarlo) + una cuenta por cada proyecto o
 *                          trabajo de esa iglesia.
 *
 * Cada movimiento de Tesorería se registra en una de estas cuentas, y el
 * saldo de cada una se calcula solo: saldo inicial + ingresos − egresos.
 *
 * Reglas: en cada nivel hay una sola cuenta "General" (la tesorería del
 * nivel), y cada iglesia local tiene un solo "Fondo para la corporación".
 * Las demás son cuentas de proyecto o trabajo.
 */

/** Ingresos, egresos y saldo de una cuenta. */
/**
 * Lo que ya entró y salió de una cuenta.
 *
 * Solo lo que ya ocurrió: un saldo es lo que hay hoy, no lo que va a haber. Un
 * servicio agendado deja su ofrenda anotada con la fecha del servicio, y esa
 * plata todavía no está en la caja (el porqué, y lo que se midió, están en
 * server/saldos.js). Lo anotado más adelante se pregunta aparte.
 */
function movimientosDe(cuentaId, db) {
  const { YA_OCURRIO } = require('../saldos');
  const fila = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
         COALESCE(SUM(CASE WHEN tipo = 'Egreso'  THEN monto ELSE 0 END), 0) AS egresos,
         COUNT(*) AS movimientos
       FROM tesoreria WHERE cuenta_id = ? AND ${YA_OCURRIO}`
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
  order: 41,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion', 'responsable'],
  listFields: ['nombre', 'ambito', 'iglesia_id', 'cuerpo_id', 'tipo', 'saldo', 'estado'],
  filterFields: ['ambito', 'iglesia_id', 'cuerpo_id', 'tipo', 'estado'],
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
      options: ['Corporación', 'Iglesia local', 'Cuerpo / Grupo'],
      help: 'De la corporación (toda la organización), de una iglesia local o de un cuerpo o grupo, que lleva su propia tesorería.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias',
      showIf: { field: 'ambito', in: ['Iglesia local', 'Cuerpo / Grupo'] },
      help: 'A qué iglesia local pertenece esta cuenta.',
    },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos',
      showIf: { field: 'ambito', equals: 'Cuerpo / Grupo' },
      help: 'De qué cuerpo o grupo es esta cuenta. Su tesorería general se crea sola; acá se abren las demás.',
    },
    {
      name: 'tipo', label: 'Tipo de cuenta', type: 'select', required: true, default: 'Proyecto / Trabajo',
      options: ['General', 'Fondo para la corporación', 'Cuotas de integrantes', 'Proyecto / Trabajo'],
      help:
        'La cuenta «General» es la tesorería del nivel: una por corporación, una por iglesia y una por cuerpo. ' +
        'El «Fondo para la corporación» es donde cada iglesia aparta lo que después le traspasa a la corporación. ' +
        'Las «Cuotas de integrantes» son las de cada cuerpo, que se manejan aparte de su tesorería general.',
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
      futuro: true, noAntesDe: 'fecha_apertura',
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
        data.cuerpo_id = null;
      } else if (!dato('iglesia_id')) {
        return 'Indique a qué iglesia local pertenece la cuenta';
      }

      // La de un cuerpo necesita saber de qué cuerpo es, y toma su iglesia
      if (ambito === 'Cuerpo / Grupo') {
        const cuerpoId = dato('cuerpo_id');
        if (!cuerpoId) return 'Indique de qué cuerpo o grupo es la cuenta';
        const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (cuerpo) data.iglesia_id = cuerpo.iglesia_id;
      } else {
        data.cuerpo_id = null;
      }

      // El fondo para la corporación es una cuenta de la iglesia local
      if (dato('tipo') === 'Fondo para la corporación' && ambito === 'Corporación') {
        return 'El «Fondo para la corporación» es una cuenta de una iglesia local: es donde la iglesia aparta lo que después traspasa a la corporación';
      }

      // Las cuotas son de un cuerpo: no existen a nivel de iglesia ni de corporación
      if (dato('tipo') === 'Cuotas de integrantes' && ambito !== 'Cuerpo / Grupo') {
        return 'La cuenta de «Cuotas de integrantes» es de un cuerpo o grupo: son las cuotas que pagan sus integrantes';
      }

      // Una sola cuenta "General" y un solo "Fondo para la corporación" por nivel
      const unicas = {
        General: 'la cuenta general',
        'Fondo para la corporación': 'el fondo para la corporación',
        'Cuotas de integrantes': 'la cuenta de cuotas',
      };
      const tipo = dato('tipo');
      if (unicas[tipo]) {
        const cuerpoId = ambito === 'Cuerpo / Grupo' ? dato('cuerpo_id') : null;
        const iglesiaId = ambito === 'Corporación' ? null : dato('iglesia_id');
        const otra = cuerpoId
          ? db.prepare('SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND cuerpo_id = ? AND id != ?').get(tipo, cuerpoId, id || 0)
          : iglesiaId
            ? db.prepare('SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND iglesia_id = ? AND cuerpo_id IS NULL AND id != ?').get(tipo, iglesiaId, id || 0)
            : db.prepare('SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND iglesia_id IS NULL AND id != ?').get(tipo, id || 0);
        if (otra) {
          return `Ya existe ${unicas[tipo]} de ese nivel ("${otra.nombre}"). Las demás cuentas deben ser de tipo «Proyecto / Trabajo».`;
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
    // Destinos posibles de un traspaso: las cuentas de la corporación —una
    // iglesia le traspasa lo que apartó— y las de la propia iglesia. Las de
    // otras congregaciones no se ofrecen ni se muestran.
    router.get('/cuentas_tesoreria/destinos', requirePerm('traspasos', 'view'), (req, res) => {
      const params = [];
      let where = "estado = 'Activa'";
      const suyas = require('../alcance').iglesiasDe(req.user);
      if (suyas.length) {
        where += ` AND (iglesia_id IS NULL OR iglesia_id IN (${suyas.map(() => '?').join(',')}))`;
        params.push(...suyas);
      }
      // Y del nivel que alcance: no se ofrece como destino una cuenta que
      // después no va a poder ver (ver server/tesorerias.js)
      const porNivel = require('../tesorerias').condicion(module.exports, req.user);
      if (porNivel) where += ` AND ${porNivel}`;
      const filas = db
        .prepare(`SELECT id, nombre, ambito FROM cuentas_tesoreria WHERE ${where} ORDER BY ambito, nombre`)
        .all(...params);
      res.json(filas.map((c) => ({ id: c.id, label: `${c.nombre} · ${c.ambito}` })));
    });

    // Opciones para el selector de cuenta de un movimiento: solo las activas
    // (una cuenta cerrada ya no recibe dinero) y solo las del alcance del usuario.
    router.get('/cuentas_tesoreria/activas', requirePerm('tesoreria', 'view'), (req, res) => {
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
      if (!require('../alcance').alcanzaIglesia(req.user, cuenta.iglesia_id)) {
        return res.status(403).json({ error: 'Esa cuenta está fuera de lo que tiene asignado' });
      }
      const m = movimientosDe(cuenta.id, db);
      // Lo que ya está anotado para más adelante, que no es saldo todavía
      const agendado = require('../saldos').loAgendadoDe(cuenta.id, db);
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
        agendado: Number(agendado.neto) || 0,
        movimientos_agendados: Number(agendado.movimientos) || 0,
        agendado_desde: agendado.primera || null,
        ultimos,
      });
    });
  },
};
