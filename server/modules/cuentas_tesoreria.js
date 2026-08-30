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

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/** ¿Este guardado mueve el punto de partida, y a cuánto? */
function seMueveElPuntoDePartida(data, existing) {
  if (!existing || data.saldo_inicial === undefined) return null;
  const antes = Number(existing.saldo_inicial) || 0;
  const ahora = Number(data.saldo_inicial) || 0;
  return antes === ahora ? null : { antes, ahora };
}

/**
 * Lo que impide mover el saldo inicial de una cuenta cerrada, o null.
 *
 * «Cerrada» congelaba los movimientos y dejaba suelto el único número que no es
 * un movimiento. Medido: una cuenta cerrada con $ 100.000 rechazaba un ingreso
 * de $ 1 —«no admite nuevos movimientos»— y aceptaba subirle el saldo inicial a
 * $ 9.000.000, dejándola en $ 9.100.000. El estado que refuse un peso y acepte
 * nueve millones no está refusando nada.
 *
 * Acá se frena y no se pregunta, y es a propósito: es la misma regla que
 * rechaza el movimiento de $ 1, dicha del mismo modo. Y la salida está escrita
 * —volver a abrirla, corregirlo y cerrarla de nuevo—, que es lo que faltaba en
 * el otro lado de este mismo estado.
 *
 * Se refuse solo si la cuenta QUEDA cerrada. Reabrirla y corregir el punto de
 * partida en el mismo guardado es el camino escrito hecho en un paso, y
 * negárselo a quien acaba de reabrirla sería incomprensible: al terminar ese
 * guardado la cuenta está activa, que es el estado donde el saldo inicial se
 * mueve. Los demás datos de una cuenta cerrada se siguen corrigiendo —su
 * responsable, su fecha de cierre, su descripción—: ninguno mueve plata.
 */
function loQueNoSeMueveEnUnaCuentaCerrada({ data, existing, quedaCerrada }) {
  if (!existing || existing.estado !== 'Cerrada' || !quedaCerrada) return null;
  if (!seMueveElPuntoDePartida(data, existing)) return null;
  return (
    `La cuenta "${existing.nombre}" está cerrada: su saldo inicial no se puede mover. Una cuenta `
    + 'cerrada tampoco admite movimientos nuevos, y el saldo inicial es plata igual que ellos. '
    + 'Vuelva a abrirla, corrija el punto de partida y ciérrela de nuevo.'
  );
}

/**
 * El aviso de que se está moviendo el saldo inicial de una cuenta que ya tiene
 * movimientos, o null si no hay nada que preguntar.
 *
 * Nada que preguntar es: una cuenta nueva —todavía no hay saldos que correr—,
 * un guardado que no toca el saldo inicial, o una cuenta sin un solo movimiento
 * anotado, donde el punto de partida ES el saldo y moverlo no descuadra nada.
 */
function avisoSiSeMueveElPuntoDePartida(db, { data, existing, confirmado }) {
  if (confirmado) return null;
  const cambio = seMueveElPuntoDePartida(data, existing);
  if (!cambio) return null;
  const { antes, ahora } = cambio;

  const m = movimientosDe(existing.id, db);
  if (!m.movimientos) return null;

  const saldoAntes = antes + m.ingresos - m.egresos;
  const saldoDespues = ahora + m.ingresos - m.egresos;

  return {
    error:
      `Esta cuenta tiene ${Number(m.movimientos).toLocaleString('es-CL')} `
      + `${m.movimientos === 1 ? 'movimiento anotado' : 'movimientos anotados'}, y su saldo pasaría de `
      + `${enPesos(saldoAntes)} a ${enPesos(saldoDespues)}. El saldo inicial es el punto de partida: `
      + 'no cuelga de ningún movimiento, así que moverlo corre todos los saldos de esta cuenta sin que '
      + 'quede una fila que lo explique. Si de verdad el punto de partida era otro, confirme.',
    confirmar: 'saldo_inicial_cambiado',
  };
}

/**
 * El aviso de que se está cerrando una cuenta con plata dentro, o null.
 *
 * Cerrar no es un rótulo: es lo que decide si esa plata se puede volver a
 * mover. Medido —cuenta de proyecto con $ 250.000 anotados—: se cerraba con un
 * 200 y sin preguntar nada, y de ahí en adelante la plata no salía por ninguna
 * de las tres puertas que existen. El traspaso: «está cerrada: no puede salir
 * dinero de ella». El egreso a mano: «no admite nuevos movimientos». El
 * borrado: «tiene 1 movimiento(s) registrado(s)». Las tres negativas son
 * correctas cada una por su lado; juntas dejan la plata sin salida, y el saldo
 * sigue sumando en todos los totales de una cuenta que la organización dio por
 * terminada.
 *
 * La salida existe —reabrirla, traspasar el saldo y volver a cerrarla— y no
 * estaba escrita en ninguna parte, así que quien se topara con esto iba a
 * pensar que el sistema le perdió la plata. Se dice acá, en el único momento en
 * que sirve decirlo: antes de cerrarla.
 *
 * Se pregunta y no se bloquea, como con el saldo inicial: hay cierres que se
 * hacen así a propósito, y discutírselo a quien sabe lo que está haciendo sería
 * peor que el problema.
 */
function avisoSiSeCierraConPlata(db, { data, existing, confirmado }) {
  if (confirmado || !existing) return null;
  if (data.estado !== 'Cerrada' || existing.estado === 'Cerrada') return null;

  const m = movimientosDe(existing.id, db);
  const saldo = (Number(existing.saldo_inicial) || 0) + m.ingresos - m.egresos;
  if (!saldo) return null;

  return {
    error:
      `Esta cuenta tiene ${enPesos(saldo)}. Cerrarla los deja adentro y desde ahí no van a poder `
      + 'salir: una cuenta cerrada no admite movimientos nuevos, no puede ser el origen de un '
      + 'traspaso y tampoco se elimina mientras tenga movimientos anotados. Lo habitual es '
      + 'traspasar el saldo a otra cuenta y después cerrarla; si ya quedó cerrada, hay que volver a '
      + 'abrirla para poder sacarlo. Si de verdad corresponde cerrarla así, confirme.',
    confirmar: 'cuenta_cerrada_con_saldo',
  };
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
      /*
       * El saldo es una cifra del dinero, y se reserva como tal.
       *
       * La llave «Montos del dinero» dice lo que esconde: «los montos de cada
       * movimiento, LOS SALDOS DE LAS CUENTAS y los totales de los informes».
       * Cumplía la primera parte y no la segunda: a quien no la tenía, el
       * listado de Tesorería le tapaba el monto de cada movimiento y esta
       * pantalla le mostraba $ 58.420.654 de un tirón. El saldo no es una
       * columna —se suma al leer—, y por ahí se le escapaba al recorte del
       * motor; desde la 1.212.0 los calculados también se reservan (ver
       * `gruposDe` en server/sensibles.js).
       */
      name: 'saldo', label: 'Saldo', type: 'money', reservado: 'tesoreria_montos',
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
      reservado: 'tesoreria_montos',
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
    beforeSave(data, { isNew, existing, id, db, confirmado }) {
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

      const quedaCerrada = dato('estado') === 'Cerrada';
      const estabaCerrada = !!existing && existing.estado === 'Cerrada';

      /*
       * Una sola cuenta "General", un solo "Fondo para la corporación" y una
       * sola de "Cuotas" por nivel. VIGENTES: una cerrada es historia y no
       * compite con nada.
       *
       * La regla no miraba el estado, y eso dejaba a una iglesia sin poder
       * abrir la cuenta que reemplaza a la que acaba de cerrar: «Ya existe la
       * cuenta general de ese nivel ("Tesorería general — Iglesia Central")»,
       * nombrando justo la cuenta que la iglesia dio por terminada, y sin
       * ofrecer ninguna salida. Cambiar de banco es lo más común que le pasa a
       * una cuenta.
       *
       * Contar solo las activas arregla las dos direcciones de una vez: también
       * impide volver a abrir la vieja cuando su reemplazo ya está andando, que
       * sería quedarse con dos cuentas generales vigentes.
       */
      const unicas = {
        General: 'la cuenta general',
        'Fondo para la corporación': 'el fondo para la corporación',
        'Cuotas de integrantes': 'la cuenta de cuotas',
      };
      const tipo = dato('tipo');
      if (unicas[tipo] && !quedaCerrada) {
        const cuerpoId = ambito === 'Cuerpo / Grupo' ? dato('cuerpo_id') : null;
        const iglesiaId = ambito === 'Corporación' ? null : dato('iglesia_id');
        const VIGENTE = "estado = 'Activa'";
        const otra = cuerpoId
          ? db.prepare(`SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND cuerpo_id = ? AND id != ? AND ${VIGENTE}`).get(tipo, cuerpoId, id || 0)
          : iglesiaId
            ? db.prepare(`SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND iglesia_id = ? AND cuerpo_id IS NULL AND id != ? AND ${VIGENTE}`).get(tipo, iglesiaId, id || 0)
            : db.prepare(`SELECT id, nombre FROM cuentas_tesoreria WHERE tipo = ? AND iglesia_id IS NULL AND id != ? AND ${VIGENTE}`).get(tipo, id || 0);
        if (otra) {
          // Volver a abrir la vieja y abrir una segunda no son el mismo acto, y
          // el consejo que sirve para uno no sirve para el otro
          return estabaCerrada
            ? `No se puede volver a abrir: mientras estuvo cerrada se abrió ${unicas[tipo]} de ese nivel ("${otra.nombre}"). `
              + 'Cierre esa primero si quiere volver a usar esta.'
            : `Ya existe ${unicas[tipo]} de ese nivel ("${otra.nombre}"). Las demás cuentas deben ser de tipo «Proyecto / Trabajo».`;
        }
      }

      if (isNew && !data.fecha_apertura) data.fecha_apertura = new Date().toISOString().slice(0, 10);

      /*
       * Una cuenta que se cierra dice CUÁNDO se cerró.
       *
       * El campo existe y aparece en la ficha en cuanto el estado es «Cerrada»,
       * pero no era obligatorio: medido, una cuenta quedó cerrada con la fecha
       * en blanco, y una fecha de cierre vacía no se distingue de una cuenta que
       * nadie ha cerrado. Se pone sola con el día de hoy —que es el día en que
       * se está cerrando— y queda a la vista para corregirla. Es lo mismo que
       * hace una solicitud con su fecha de respuesta al darse por cerrada.
       */
      // Se mira lo que trae ESTE guardado, no lo que hubiera antes: si no dice
      // cuándo, es hoy. Una fecha vieja de un cierre anterior no es la de este.
      if (quedaCerrada && !estabaCerrada && !data.fecha_cierre) {
        data.fecha_cierre = new Date().toISOString().slice(0, 10);
      }
      /*
       * Y la que se vuelve a abrir deja de tener fecha de cierre.
       *
       * Medido: se cerraba con fecha 30-08-2026, se reabría, y quedaba «Activa /
       * 2026-08-30». Peor todavía, el campo solo aparece en la ficha cuando el
       * estado es «Cerrada» —que es lo correcto para escribirlo—, así que desde
       * la pantalla NO HABÍA FORMA DE BORRARLO: para verlo había que volver a
       * cerrar la cuenta. El dato seguía ahí, salía en la planilla que se baja y
       * contradecía al estado que tiene al lado.
       *
       * Es lo mismo que hace una solicitud al salir de un estado cerrado con su
       * fecha de respuesta (ver server/modules/solicitudes.js), y queda anotado
       * en el Registro de Cambios como cualquier otra corrección.
       */
      if (!quedaCerrada && estabaCerrada) data.fecha_cierre = null;

      // Sobre una cuenta que sigue cerrada, el punto de partida no se mueve:
      // es la misma regla que rechaza un movimiento de $ 1
      const congelado = loQueNoSeMueveEnUnaCuentaCerrada({ data, existing, quedaCerrada });
      if (congelado) return congelado;

      // Y antes de cerrarla, si tiene plata adentro, se pregunta: es lo que
      // decide si esa plata se va a poder volver a mover
      const conPlata = avisoSiSeCierraConPlata(db, { data, existing, confirmado });
      if (conPlata) return conPlata;

      /*
       * Mover el punto de partida corre todos los saldos de la cuenta.
       *
       * Todo saldo del sistema es «saldo inicial + ingresos − egresos», y el
       * saldo inicial es el único número del que no cuelga ningún movimiento:
       * no hay una fila que lo respalde ni que se pueda revisar después. Se
       * editaba como cualquier otro campo de la ficha, con la misma facilidad
       * con que se corrige un teléfono. Medido en la cuenta general de la
       * corporación, con 3.001 movimientos anotados: cambiarlo a $99.000.000
       * llevó el saldo de $63.830.034 a $162.830.034 sin preguntar nada.
       *
       * Queda anotado en el Registro de Cambios —con el antes, el después y
       * quién lo hizo—, y eso es lo que salva el caso. Lo que faltaba era el
       * momento anterior. Se pregunta, no se bloquea: el punto de partida se
       * escribe mal la primera vez y hay que poder corregirlo.
       */
      const aviso = avisoSiSeMueveElPuntoDePartida(db, { data, existing, confirmado });
      if (aviso) return aviso;

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

    /*
     * La cartola de una cuenta: movimiento a movimiento, con el saldo corriendo
     * fila a fila. Es lo que se compara con la cartola del banco.
     *
     * Lo que faltaba no era solo el papel. «Cuánto había en la cuenta del
     * proyecto al 30 de junio» no se podía contestar de ninguna forma: había
     * que bajar todo a una planilla y sumar. Acá esa pregunta es el saldo
     * anterior de una cartola que empiece el 1 de julio, y también el saldo que
     * lleva cada fila.
     *
     * El saldo corre por fecha y, dentro de un mismo día, por el orden en que
     * se anotaron: dos movimientos del mismo día no tienen entre ellos más
     * orden que ese, y es el mismo con que se leen en el listado.
     */
    router.get('/cuentas_tesoreria/:id(\\d+)/cartola', requirePerm('tesoreria', 'view'), (req, res) => {
      /*
       * Quién puede mirar esta cuenta lo contesta `registroSuyo`, y no una
       * comprobación escrita acá.
       *
       * Acá había una a mano: `alcanzaIglesia(req.user, cuenta.iglesia_id)`.
       * Eso es la mitad del alcance —falta el cuerpo— y no es nada del NIVEL de
       * tesorería, que es la otra llave que acota la plata (server/tesorerias.js).
       * Medido con una tesorera de cuerpo: el listado le mostraba 33 de 41
       * cuentas, todas de su nivel, la ficha de la cuenta de la corporación le
       * contestaba 403… y esta ruta le entregaba su cartola del año entera,
       * 1.168 filas, con el saldo corriendo. La cuenta de la corporación tiene
       * `iglesia_id = null`, y esa comprobación con null la pasa cualquiera.
       *
       * `registroSuyo` existe justo para esto —lo escribió la auditoría de
       * aislamiento de la 1.98.0, que encontró diez rutas propias en la misma
       * situación— y aplica el mismo alcance que el listado y la ficha, entero,
       * en una línea (ver server/alcance.js).
       */
      const cuenta = require('../alcance').registroSuyo(req, res, 'cuentas_tesoreria', req.params.id, 'Esa cuenta');
      if (!cuenta) return;

      const desde = req.query.desde || null;
      const hasta = req.query.hasta || null;
      const inicial = Number(cuenta.saldo_inicial) || 0;
      const { YA_OCURRIO, AGENDADO } = require('../saldos');

      /*
       * Con qué saldo empieza la hoja: el inicial de la cuenta más todo lo
       * anterior al período QUE YA OCURRIÓ. Sin lo primero, la cartola de julio
       * empezaría en cero y no cuadraría con nada; sin lo segundo, una cartola
       * pedida sobre un período que arranca más adelante empezaría contando
       * plata que todavía no llegó.
       */
      const anterior = desde
        ? db
            .prepare(
              `SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END), 0) AS s
                 FROM tesoreria WHERE cuenta_id = ? AND fecha < ? AND ${YA_OCURRIO}`
            )
            .get(cuenta.id, desde).s
        : 0;

      const cond = ['cuenta_id = ?'];
      const params = [cuenta.id];
      if (desde) { cond.push('fecha >= ?'); params.push(desde); }
      if (hasta) { cond.push('fecha <= ?'); params.push(hasta); }
      const donde = `WHERE ${cond.join(' AND ')}`;

      /*
       * EL SALDO SE CORTA EN EL DÍA DE HOY, también acá.
       *
       * La cartola es, por definición, la hoja que se compara con la del banco:
       * el número de abajo tiene que ser el que está en el banco. Traía las
       * filas de un servicio agendado —«Ofrenda de servicio general del 30 de
       * noviembre», $ 900.000— corriendo el saldo hacia arriba, sin marca
       * alguna. Medido sobre la tesorería general de una iglesia con un servicio
       * programado: el listado de cuentas decía $ 0, su ficha decía $ 0 y
       * «agendado $ 810.000 · desde el 30-11», y esta hoja decía $ 810.000. Dos
       * pantallas de la misma cuenta, el mismo día, con $ 810.000 de diferencia.
       *
       * No se sacan de la hoja: quien programó ese servicio quiere poder verlo.
       * Se MARCAN y se dejan fuera del saldo, que es lo que ya hace el resto del
       * sistema con lo agendado (ver server/saldos.js). El saldo que corre fila
       * a fila se detiene en la última fila que ya ocurrió; a las de más adelante
       * no se les pone saldo, porque ese saldo no existió nunca.
       *
       * La suma que corre NO necesita excluir lo agendado, y probé a hacerlo:
       * ninguna prueba se caía. Es correcto que no se caiga. La ventana suma
       * las filas ANTERIORES a cada una en el orden `fecha, id`, y una fila con
       * fecha de más adelante va siempre después de todas las que ya
       * ocurrieron: nunca entra en el saldo de ninguna. Lo que sí hace falta es
       * el CASE de afuera, que es el que deja en blanco el saldo de esas filas.
       */
      const saldoAnterior = inicial + anterior;
      const movimientos = db
        .prepare(
          `SELECT id, fecha, tipo, categoria, concepto, monto, metodo, comprobante,
                  traspaso_id, servicio_id, entre_cuentas,
                  CASE WHEN ${AGENDADO} THEN 1 ELSE 0 END AS agendado,
                  CASE WHEN ${AGENDADO} THEN NULL ELSE
                    ? + SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END)
                        OVER (ORDER BY fecha, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                  END AS saldo
             FROM tesoreria ${donde}
            ORDER BY fecha, id`
        )
        .all(saldoAnterior, ...params);

      const suma = (t, cuales) => cuales.reduce((a, m) => a + (m.tipo === t ? Number(m.monto) || 0 : 0), 0);
      const ocurridos = movimientos.filter((m) => !m.agendado);
      const porVenir = movimientos.filter((m) => m.agendado);
      const ingresos = suma('Ingreso', ocurridos);
      const egresos = suma('Egreso', ocurridos);
      // Y lo que está anotado para más adelante, dicho aparte y con su fecha
      const agendado = suma('Ingreso', porVenir) - suma('Egreso', porVenir);

      /*
       * Y sin las cifras, para quien no alcanza la llave de los montos.
       *
       * Es la puerta por la que la llave quedaba anulada: el listado de
       * Tesorería le tapaba el monto de cada movimiento y la cartola de esa
       * misma cuenta se los devolvía los ciento cincuenta juntos, con el saldo
       * corriendo fila a fila. Lo que la llave promete dejar a la vista —la
       * fecha, el concepto, la categoría, el método— se queda; se van las
       * cifras, incluidas las de cada fila (ver `sinLasCifras` en
       * server/sensibles.js).
       */
      res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos', {
        cuenta: { id: cuenta.id, nombre: cuenta.nombre, ambito: cuenta.ambito, tipo: cuenta.tipo, estado: cuenta.estado },
        desde, hasta,
        saldo_inicial: inicial,
        saldo_anterior: saldoAnterior,
        ingresos,
        egresos,
        saldo_final: saldoAnterior + ingresos - egresos,
        agendado,
        movimientos_agendados: porVenir.length,
        agendado_desde: porVenir.length ? porVenir[0].fecha : null,
        movimientos,
      }, ['saldo_inicial', 'saldo_anterior', 'ingresos', 'egresos', 'saldo_final', 'agendado',
          'monto', 'saldo', 'movimientos']));
    });

    // Estado de una cuenta: saldo, totales y sus últimos movimientos.
    router.get('/cuentas_tesoreria/:id(\\d+)/estado', requirePerm('cuentas_tesoreria', 'view'), (req, res) => {
      // El mismo alcance entero que la ficha, por la misma puerta que la
      // cartola de acá arriba: esta ruta le contestaba a la tesorera de cuerpo
      // el saldo de la corporación y sus últimos diez movimientos.
      const cuenta = require('../alcance').registroSuyo(req, res, 'cuentas_tesoreria', req.params.id, 'Esa cuenta');
      if (!cuenta) return;
      const m = movimientosDe(cuenta.id, db);
      // Lo que ya está anotado para más adelante, que no es saldo todavía
      const agendado = require('../saldos').loAgendadoDe(cuenta.id, db);
      const ultimos = db
        .prepare(`SELECT id, fecha, tipo, categoria, concepto, monto FROM tesoreria
                  WHERE cuenta_id = ? ORDER BY fecha DESC, id DESC LIMIT 10`)
        .all(cuenta.id);
      // Sin las cifras para quien no alcanza la llave de los montos: cuántos
      // movimientos hay y desde cuándo se pueden decir; cuánta plata, no.
      res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos', {
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
      }, ['saldo_inicial', 'ingresos', 'egresos', 'saldo', 'agendado', 'monto', 'ultimos']));
    });
  },
};
