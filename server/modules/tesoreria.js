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
const { comoSeLee } = require('../fechas');

/**
 * El texto de un concepto, como se compara.
 *
 * Sin tildes, sin mayúsculas y sin espacios de más, porque quien anota dos
 * veces la misma compra no la escribe dos veces igual: «Sillas para el salón»
 * y «sillas PARA el SALON» son el mismo gasto y hay que reconocerlas.
 */
const comoSeCompara = (t) =>
  String(t == null ? '' : t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/**
 * El movimiento igual a este que ya estaba anotado, o null si no hay ninguno.
 *
 * «Igual» es: la misma cuenta, el mismo día, el mismo tipo, el mismo monto y el
 * mismo concepto. Los cuatro primeros se preguntan en SQL; el concepto se
 * compara en JavaScript y no en la consulta, porque el LOWER de SQLite no sabe
 * de tildes —«SALÓN» y «salón» le parecen distintos— y es justo la diferencia
 * que hay que pasar por alto.
 *
 * No hace falta excluir de la búsqueda el movimiento que se está guardando: acá
 * se llega solo cuando cambió algo de esos cinco datos (ver `seguiIgual` en el
 * hook), y con cualquiera de ellos distinto la fila guardada ya no calza con lo
 * que se busca. Se probó quitando la exclusión: ninguna prueba se cae. Si algún
 * día esto lo llama alguien más, esa condición hay que volver a ponerla.
 */
function elQueYaEstaba(db, datos) {
  const fecha = String(datos.fecha == null ? '' : datos.fecha).slice(0, 10);
  const candidatos = db
    .prepare(
      `SELECT t.id, t.concepto, t.comprobante, t.created_at, u.nombre AS quien
         FROM tesoreria t
         LEFT JOIN usuarios u ON u.id = t.created_by
        WHERE t.cuenta_id = ? AND t.fecha = ? AND t.tipo = ? AND t.monto = ?
        ORDER BY t.id`
    )
    .all(datos.cuenta_id, fecha, datos.tipo, Number(datos.monto) || 0);

  const suyo = comoSeCompara(datos.concepto);
  return candidatos.find((c) => comoSeCompara(c.concepto) === suyo) || null;
}

/**
 * El aviso de movimiento repetido, o null si no hay ninguno.
 *
 * Se pregunta, no se bloquea: dos compras iguales el mismo día existen —dos
 * sacos de cemento, dos pasajes— y el sistema no está para discutírselo a la
 * tesorera. Lo que no puede es dejar pasar en silencio el mismo egreso anotado
 * dos veces, porque la cuenta descuenta el doble y el descuadre no se ve hasta
 * que se cuenta la plata.
 */
function avisoDeMovimientoRepetido(db, datos) {
  const otro = datos.otro;
  if (!otro) return null;

  // Con qué se distingue de este: cuándo se anotó, quién y si tiene comprobante
  const senas = [
    otro.created_at ? `anotado el ${comoSeLee(String(otro.created_at).slice(0, 10))}` : null,
    otro.quien ? `por ${otro.quien}` : null,
    otro.comprobante ? 'con comprobante' : null,
  ].filter(Boolean).join(', ');

  const queEs = datos.tipo === 'Ingreso' ? 'un ingreso' : 'un egreso';
  return {
    error:
      `Ya hay ${queEs} de ${enPesos(datos.monto)} con ese mismo concepto en esta cuenta `
      + `el ${comoSeLee(String(datos.fecha).slice(0, 10))}`
      + `${senas ? ` (${senas})` : ''}. `
      + 'Si es este mismo, abra ese en vez de anotarlo de nuevo: registrado dos veces, la cuenta '
      + `${datos.tipo === 'Ingreso' ? 'suma' : 'descuenta'} el doble. Si de verdad fueron dos, confirme.`,
    confirmar: 'movimiento_ya_anotado',
  };
}

module.exports = {
  name: 'tesoreria',
  label: 'Tesorería',
  labelSingular: 'Movimiento',
  icon: '💰',
  group: 'Finanzas',
  order: 40,
  display: '{tipo}: {concepto}',
  dateField: 'fecha',
  searchFields: ['concepto', 'categoria', 'notas'],
  listFields: ['fecha', 'cuenta_id', 'tipo', 'categoria', 'concepto', 'monto'],
  filterFields: ['cuenta_id', 'tipo', 'categoria'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true, seccion: 'Qué movimiento es' },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Ingreso',
      options: ['Ingreso', 'Egreso'],
    },
    {
      name: 'categoria', label: 'Categoría', type: 'select', required: true, default: 'Ofrendas',
      // La lista la mantiene la iglesia en Categorías de Tesorería, y se acota
      // sola: al registrar un gasto no aparecen las categorías de ingreso.
      optionsRoute: '/categorias_tesoreria/opciones?tipo={tipo}',
      help: 'Se mantienen en «Categorías de Tesorería». Se ofrecen solo las que corresponden al tipo de movimiento.',
    },
    { name: 'concepto', label: 'Concepto / Descripción', type: 'text', required: true, seccion: 'Monto y forma de pago' },
    { name: 'monto', label: 'Monto', type: 'money', required: true, min: 1, reservado: 'tesoreria_montos' },
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
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true,
      help: 'Se toma de la cuenta elegida, igual que la iglesia. Solo lo llevan los movimientos de una cuenta de un cuerpo.',
    },
    { name: 'comprobante', label: 'Comprobante (imagen o PDF)', type: 'file', seccion: 'Respaldo y notas' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
    // Movimientos generados por un traspaso o por la ofrenda de un servicio
    // (se manejan desde allá, para que los dos lados queden siempre cuadrados)
    { name: 'traspaso_id', type: 'number', oculto: true, readonly: true },
    { name: 'servicio_id', type: 'number', oculto: true, readonly: true },
    /*
     * Un lado de un traslado entre cuentas de la organización: los dos de un
     * traspaso, y los dos del aporte que una ofrenda pasa al fondo. No es plata
     * que entre ni salga, y por eso el resumen la cuenta aparte (ver
     * server/entre-cuentas.js). Lo pone quien genera el movimiento, no la
     * persona: un movimiento escrito a mano nunca es un traslado.
     */
    { name: 'entre_cuentas', type: 'number', oculto: true, readonly: true },
  ],
  hooks: {
    beforeSave(data, { user, existing, db, confirmado }) {
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
      if (!require('../alcance').alcanzaIglesia(user, cuenta.iglesia_id)) {
        return `La cuenta "${cuenta.nombre}" no está entre las iglesias que administra`;
      }

      // Una cuenta cerrada no recibe movimientos nuevos, pero los suyos se pueden corregir
      const cambiaDeCuenta = !existing || String(existing.cuenta_id) !== String(cuentaId);
      if (cuenta.estado === 'Cerrada' && cambiaDeCuenta) {
        return `La cuenta "${cuenta.nombre}" está cerrada: no admite nuevos movimientos`;
      }

      data.iglesia_id = cuenta.iglesia_id || null;

      /**
       * Y el cuerpo, también de la cuenta.
       *
       * Antes era un campo suelto que se escribía a mano, así que un
       * movimiento podía decir que era del cuerpo A estando en la cuenta del
       * cuerpo B, o no decir nada estándolo. Con eso, el panel de la ficha del
       * cuerpo mostraba una tesorería incompleta —los movimientos que nadie se
       * acordó de marcar no aparecían— y no había forma de saber de quién era
       * la plata sin ir a mirar la cuenta. La cuenta es el único dato que no
       * se puede contradecir consigo mismo: de ahí sale.
       */
      data.cuerpo_id = cuenta.cuerpo_id || null;

      if (!confirmado) {
        const tipo = data.tipo !== undefined ? data.tipo : existing ? existing.tipo : null;
        const monto = data.monto !== undefined ? data.monto : existing ? existing.monto : 0;
        const fecha = data.fecha !== undefined ? data.fecha : existing ? existing.fecha : null;
        const concepto = data.concepto !== undefined ? data.concepto : existing ? existing.concepto : null;

        /*
         * Lo primero que se pregunta es si este movimiento ya está anotado: es
         * lo que cuesta plata. La confirmación es una sola para todo el guardado
         * —así funciona el mecanismo—, así que la pregunta que se muestra tiene
         * que ser la que más importa. Un movimiento repetido descuadra la cuenta
         * en silencio; un saldo en rojo, en cambio, se ve.
         *
         * Al CORREGIR uno que ya está guardado solo se pregunta si cambió algo
         * de lo que lo hace «el mismo». Si no, el repetido ya estaba ahí antes
         * de abrir la ficha y alguien ya dijo que eran dos: volver a preguntarlo
         * cada vez que se le arregla una coma es ruido, y el ruido enseña a
         * confirmar sin leer, que es lo contrario de lo que esto busca.
         */
        const seguiIgual = existing
          && String(existing.cuenta_id) === String(cuentaId)
          && String(existing.fecha).slice(0, 10) === String(fecha).slice(0, 10)
          && existing.tipo === tipo
          && Number(existing.monto) === Number(monto)
          && comoSeCompara(existing.concepto) === comoSeCompara(concepto);

        const otro = seguiIgual ? null
          : elQueYaEstaba(db, { cuenta_id: cuentaId, fecha, tipo, monto, concepto });
        if (otro) {
          const repetido = avisoDeMovimientoRepetido(db, { fecha, tipo, monto, otro });
          if (repetido) return repetido;
        }

        // ¿Este egreso deja la cuenta en rojo? No se bloquea —una cuenta puede
        // quedar en rojo de verdad— pero se pregunta, porque el caso corriente
        // no es ese sino el cero de más (ver server/saldos.js).
        const aviso = require('../saldos').avisoSiQuedaEnRojo(cuentaId, {
          tipo, monto, fecha, excluirMovimiento: existing ? existing.id : null,
        });
        if (aviso) return aviso;
      }
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
      /*
       * Lo que entró y lo que salió, sin la plata que solo cambió de bolsillo:
       * el aporte que una ofrenda pasa al fondo de su misma iglesia y los dos
       * lados de un traspaso. Se descuentan solo cuando LOS DOS LADOS están
       * dentro de lo que se está mirando; el porqué está en
       * server/entre-cuentas.js.
       */
      const entreCuentas = require('../entre-cuentas');
      const cuentas = entreCuentas.totalesDe(db, whereSql, params);
      const porCategoria = entreCuentas.porCategoriaDe(db, whereSql, params);
      const suyasResumen = require('../alcance').iglesiasDe(req.user);
      /*
       * Saldo por cuenta, para ver de un vistazo cómo está repartido el dinero.
       * El saldo cuenta solo lo que ya ocurrió, y lo anotado más adelante va en
       * su propia columna: no es plata que esté en la caja (ver server/saldos.js).
       * El corte va en los CASE y no en el JOIN porque hacen falta las dos cifras.
       */
      const YA = "t.fecha <= date('now','localtime')";
      const porCuenta = db
        .prepare(
          `SELECT c.id, c.nombre, c.ambito, c.tipo,
                  COALESCE(c.saldo_inicial, 0)
                    + COALESCE(SUM(CASE WHEN ${YA} AND t.tipo = 'Ingreso' THEN t.monto ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN ${YA} AND t.tipo = 'Egreso'  THEN t.monto ELSE 0 END), 0) AS saldo,
                  COALESCE(SUM(CASE WHEN NOT (${YA}) THEN (CASE WHEN t.tipo = 'Ingreso' THEN t.monto ELSE -t.monto END) ELSE 0 END), 0) AS agendado
             FROM cuentas_tesoreria c
             LEFT JOIN tesoreria t ON t.cuenta_id = c.id
            ${suyasResumen.length ? `WHERE c.iglesia_id IN (${suyasResumen.map(() => '?').join(',')})` : ''}
            GROUP BY c.id
            ORDER BY c.ambito, c.tipo DESC, c.nombre`
        )
        .all(...suyasResumen);

      res.json({ ...cuentas, porCategoria, porCuenta });
    });
  },
};
