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
/*
 * Cómo se compara un texto escrito por una persona, y cuándo no hay que volver
 * a preguntar, viven en server/repetido.js: son las mismas reglas que usa la
 * pregunta de Traspasos, y escritas dos veces un día dirían dos cosas.
 */
const { comoSeCompara, enPesos, seguiIgual, senasDe } = require('../repetido');

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
  const senas = senasDe(otro);

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

/**
 * El aviso de un egreso grande sin su boleta, o null si no hay nada que decir.
 *
 * Desde qué monto se pregunta lo decide la iglesia en Configuración
 * («Preguntar por el comprobante de un egreso desde»), como los demás plazos
 * del sistema. En cero no pregunta nunca: hay tesorerías que documentan aparte
 * y el sistema no está para discutírselo.
 *
 * No se pregunta por los movimientos que genera otro módulo —la ofrenda de un
 * servicio, los dos lados de un traspaso, el egreso de una ayuda entregada—:
 * esos no pasan por acá, pero si algún día pasaran, nadie les va a adjuntar una
 * boleta a mano. El respaldo de una ayuda es el suyo, y vive en la ayuda.
 */
function avisoDeEgresoSinRespaldo({ data, existing, tipo, monto }) {
  if (tipo !== 'Egreso') return null;
  if (existing && (existing.traspaso_id || existing.servicio_id || existing.ayuda_id)) return null;

  const comprobante = data.comprobante !== undefined
    ? data.comprobante
    : existing ? existing.comprobante : null;
  if (comprobante && String(comprobante).trim()) return null;

  const desde = require('../ajustes').numero('egreso_pide_comprobante_desde', 0, 100000000);
  if (!desde || (Number(monto) || 0) < desde) return null;

  return {
    error:
      `Este egreso de ${enPesos(monto)} va sin la boleta ni el comprobante de la transferencia. `
      + `Desde ${enPesos(desde)} conviene adjuntarlo: cuando llega una revisión, el respaldo que no `
      + 'está en el sistema hay que buscarlo en una carpeta, movimiento por movimiento. Se puede '
      + 'adjuntar después abriendo el movimiento. Si va sin respaldo, confirme.',
    confirmar: 'egreso_sin_respaldo',
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
  // Un traspaso se podía imprimir y un movimiento no, siendo el mismo dinero
  printable: true,
  searchFields: ['concepto', 'categoria', 'notas'],
  /*
   * Un gasto se recuerda por su monto: «el de los doscientos cincuenta mil».
   * Medido antes de esto, «250000» y «250.000» daban CERO los dos.
   *
   * Va en `buscaTambien` y no en `searchFields` porque el monto se guarda como
   * número y el motor lo pegaría con su decimal —«250000.0»—, que no es lo que
   * nadie teclea. Y declara su grupo reservado: quien no puede ver los montos
   * tampoco puede encontrar un movimiento probando cifras en el buscador, que
   * sería la misma fuga por otra puerta (ver server/sensibles.js).
   */
  buscaTambien: [{ sql: 'CAST(monto AS INTEGER)', reservado: 'tesoreria_montos' }],
  listFields: ['fecha', 'cuenta_id', 'tipo', 'categoria', 'concepto', 'monto', 'respaldo'],
  // El método ya se podía filtrar por dirección y la barra no lo ofrecía
  filterFields: ['cuenta_id', 'tipo', 'categoria', 'metodo'],
  /*
   * El respaldo de un movimiento: la boleta o el comprobante de la
   * transferencia.
   *
   * El campo estaba, funcionaba y guardaba el archivo, pero nada lo pedía y no
   * se veía en ninguna parte: medido sobre la primera página del libro, CERO de
   * doscientos egresos lo tenían. Cuando llega una revisión, el respaldo hay que
   * buscarlo en una carpeta física, movimiento por movimiento. El sistema ya
   * tenía dónde guardarlo; lo que no tenía es el hábito, y el hábito lo hace la
   * pantalla: una columna que se ve de un vistazo, un filtro para encontrar lo
   * que falta, y una pregunta al guardar un egreso grande sin adjunto.
   */
  computed: [
    {
      name: 'respaldo', label: 'Respaldo', type: 'badge',
      /*
       * Solo dice que falta cuando falta de verdad: un ingreso no necesita
       * boleta, y los movimientos que genera otro módulo —la ofrenda de un
       * servicio, los dos lados de un traspaso, el egreso de una ayuda— no los
       * adjunta nadie a mano: el de la ayuda es el suyo y vive en la ayuda.
       */
      calc: (r) => {
        if (r.comprobante) return { texto: '📎 Sí', nivel: 'ok' };
        if (r.tipo !== 'Egreso' || r.traspaso_id || r.servicio_id || r.ayuda_id) return { texto: '—', nivel: '' };
        return { texto: 'Falta', nivel: 'medio' };
      },
    },
  ],
  filtrosPropios: [
    {
      nombre: 'respaldo', label: 'Respaldo', tipo: 'select',
      opciones: ['Egresos sin respaldo', 'Con respaldo'],
      donde: (valor) => (valor === 'Con respaldo'
        ? { sql: "comprobante IS NOT NULL AND TRIM(comprobante) <> ''", params: [] }
        : {
            sql: `tipo = 'Egreso' AND traspaso_id IS NULL AND servicio_id IS NULL AND ayuda_id IS NULL
                    AND (comprobante IS NULL OR TRIM(comprobante) = '')`,
            params: [],
          }),
    },
  ],
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
      placeholder: 'Escriba el nombre de la cuenta…',
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
    // Movimientos generados por otro módulo: se manejan desde allá, para que
    // los dos lados queden siempre cuadrados y el libro no diga una cosa
    // distinta de la que dice el registro que lo originó
    { name: 'traspaso_id', type: 'number', oculto: true, readonly: true },
    { name: 'servicio_id', type: 'number', oculto: true, readonly: true },
    // …y por una ayuda social entregada con cargo a una cuenta
    { name: 'ayuda_id', type: 'number', oculto: true, readonly: true },
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
      if (existing && existing.ayuda_id) {
        return 'Este movimiento lo generó una ayuda social entregada: modifíquelo en «Ayudas Sociales»';
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
        // Los cinco datos que hacen que dos movimientos sean «el mismo»
        const sinCambios = seguiIgual(existing, { cuenta_id: cuentaId, fecha, tipo, monto, concepto }, [
          ['cuenta_id', 'igual'], ['fecha', 'fecha'], ['tipo', 'igual'],
          ['monto', 'numero'], ['concepto', 'texto'],
        ]);

        const otro = sinCambios ? null
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

        // Y de última, el respaldo: es la que menos urge de las tres, porque no
        // descuadra nada hoy, pero es la que se echa de menos en una revisión
        const sinRespaldo = avisoDeEgresoSinRespaldo({ data, existing, tipo, monto });
        if (sinRespaldo) return sinRespaldo;
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
    /*
     * Qué movimientos se están mirando: el alcance de quien pregunta más los
     * filtros y el rango de fechas de la pantalla. Lo arman igual el resumen de
     * arriba del listado y el informe que se imprime, para que no puedan decir
     * cifras distintas del mismo período.
     *
     * Sin alias en la tabla: las condiciones que emite server/alcance.js traen
     * los nombres de columna a secas, y la regla de los traslados también (ver
     * server/entre-cuentas.js).
     */
    const loQueSeEstaMirando = (req) => {
      const params = [];
      const where = [];
      const scope = scopeClause(req.user, params);
      if (scope) where.push(scope);
      const filtro = (q, columna) => {
        if (!req.query[q]) return;
        where.push(`${columna} = ?`);
        params.push(req.query[q]);
      };
      filtro('f_iglesia_id', 'iglesia_id');
      filtro('f_cuerpo_id', 'cuerpo_id');
      filtro('f_cuenta_id', 'cuenta_id');
      filtro('f_categoria', 'categoria');
      filtro('f_tipo', 'tipo');
      if (req.query.desde) {
        where.push('fecha >= ?');
        params.push(req.query.desde);
      }
      if (req.query.hasta) {
        where.push('fecha <= ?');
        params.push(req.query.hasta);
      }
      return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
    };

    router.get('/tesoreria/resumen', requirePerm('tesoreria', 'view'), (req, res) => {
      const { whereSql, params } = loQueSeEstaMirando(req);
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
      /*
       * Saldo por cuenta, para ver de un vistazo cómo está repartido el dinero.
       * El saldo cuenta solo lo que ya ocurrió, y lo anotado más adelante va en
       * su propia columna: no es plata que esté en la caja (ver server/saldos.js).
       * El corte va en los CASE y no en el JOIN porque hacen falta las dos cifras.
       *
       * Qué cuentas entran lo decide el MISMO alcance que el listado de Cuentas
       * de Tesorería, pedido en una línea. Acá había un recorte escrito a mano
       * —«las iglesias que administra»— y le faltaban las otras dos partes: los
       * cuerpos asignados y el nivel de tesorería. Medido con una tesorera de
       * cuerpo, que en su listado ve 33 de 41: este resumen le devolvía las 41,
       * ocho de un nivel que no alcanza, con su saldo. Entre ellas la general de
       * la corporación, $ 56.231.187.
       *
       * El recorte va en una SUBCONSULTA sobre la tabla sola, y no pegado al
       * WHERE de acá: las condiciones que emite server/alcance.js traen los
       * nombres de columna a secas, y en esta consulta hay dos tablas con una
       * columna `iglesia_id` —la cuenta y el movimiento—. Pegada directamente,
       * la condición se ataba al movimiento y no a la cuenta: a un tesorero de
       * una sola iglesia, que ve 28 cuentas, el resumen le devolvía CERO.
       */
      const YA = "t.fecha <= date('now','localtime')";
      const deLasCuentas = [];
      const suyas = require('../alcance')
        .condiciones(require('../registry').getModule('cuentas_tesoreria'), req.user, deLasCuentas);
      const porCuenta = db
        .prepare(
          `SELECT cuentas_tesoreria.id, cuentas_tesoreria.nombre, cuentas_tesoreria.ambito, cuentas_tesoreria.tipo,
                  COALESCE(cuentas_tesoreria.saldo_inicial, 0)
                    + COALESCE(SUM(CASE WHEN ${YA} AND t.tipo = 'Ingreso' THEN t.monto ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN ${YA} AND t.tipo = 'Egreso'  THEN t.monto ELSE 0 END), 0) AS saldo,
                  COALESCE(SUM(CASE WHEN NOT (${YA}) THEN (CASE WHEN t.tipo = 'Ingreso' THEN t.monto ELSE -t.monto END) ELSE 0 END), 0) AS agendado
             FROM cuentas_tesoreria
             LEFT JOIN tesoreria t ON t.cuenta_id = cuentas_tesoreria.id
            ${suyas ? `WHERE cuentas_tesoreria.id IN (SELECT id FROM cuentas_tesoreria WHERE ${suyas})` : ''}
            GROUP BY cuentas_tesoreria.id
            ORDER BY cuentas_tesoreria.ambito, cuentas_tesoreria.tipo DESC, cuentas_tesoreria.nombre`
        )
        .all(...deLasCuentas);

      /*
       * Y sin las cifras para quien no alcanza la llave de los montos: la
       * llave dice esconder «los totales de los informes», y este resumen es
       * el que encabeza el listado. Los CONTEOS se quedan —cuántos movimientos
       * hay, cuántos son entre cuentas—: eso es el «QUÉ se movió» que la llave
       * promete dejar a la vista. Se van los pesos.
       */
      res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos',
        { ...cuentas, porCategoria, porCuenta },
        ['ingresos', 'egresos', 'balance', 'movido', 'total', 'monto', 'saldo', 'agendado',
         'porCategoria', 'porCuenta']));
    });

    /*
     * El balance del período: el papel que se lleva a la reunión de la
     * directiva y se archiva.
     *
     * El módulo guardaba bien y devolvía poco: había totales en pantalla y una
     * planilla Excel, y el balance del mes se terminaba armando a mano en otra
     * planilla a partir de ese Excel. Una suma hecha a mano cada mes es una
     * suma que alguna vez sale mal sin que nadie pueda comprobarlo.
     *
     * Es el mismo recorte del resumen —mismo alcance, mismos filtros, mismo
     * período— y las mismas cuentas de server/entre-cuentas.js, para que el
     * papel impreso y la pantalla no puedan discrepar.
     */
    router.get('/tesoreria/informe', requirePerm('tesoreria', 'view'), (req, res) => {
      const { whereSql, params } = loQueSeEstaMirando(req);
      const entreCuentas = require('../entre-cuentas');
      // El balance que se lleva a la reunión es, entero, «los totales de los
      // informes» que la llave de los montos dice esconder: sin ella no queda
      // papel que imprimir, y eso es lo correcto.
      res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos', {
        desde: req.query.desde || null,
        hasta: req.query.hasta || null,
        resumen: entreCuentas.totalesDe(db, whereSql, params),
        porMes: entreCuentas.porMesDe(db, whereSql, params),
        porCategoria: entreCuentas.porCategoriaDe(db, whereSql, params),
        porCuenta: entreCuentas.porCuentaDe(db, whereSql, params),
      }, ['resumen', 'ingresos', 'egresos', 'balance', 'movido', 'total', 'monto', 'saldo',
          'agendado', 'porMes', 'porCategoria', 'porCuenta']));
    });
  },
};
