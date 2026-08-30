/**
 * Módulo: Ayudas Sociales (apoyo a miembros y a la comunidad).
 *
 * A QUIÉN SE LE AYUDÓ. Antes el beneficiario era un nombre escrito a mano y,
 * aparte, un enlace opcional a un miembro. Eso dejaba dos problemas: se podían
 * llenar los dos, o ninguno, y quedaba una ayuda sin saber bien de quién era;
 * y la mayoría de las ayudas —que son para gente que no pertenece a la
 * iglesia— quedaban como un nombre suelto, sin ficha detrás, así que no había
 * manera de ver el historial de una persona ni de saber a cuántas se ha
 * ayudado.
 *
 * Ahora se elige primero SI ES MIEMBRO O NO, y según eso aparece el selector
 * que corresponde: Miembros o No Miembros. Uno de los dos, nunca los dos, y
 * siempre uno: no se puede registrar una ayuda sin decir para quién.
 *
 * El nombre del beneficiario se sigue guardando en `beneficiario`, pero ya no
 * se escribe: lo copia el sistema de la ficha elegida al guardar. Así los
 * listados, la búsqueda y las ayudas que ya estaban registradas siguen
 * funcionando igual, y el nombre queda como constancia de a nombre de quién se
 * entregó, aunque después la ficha se corrija.
 */

const { TIPOS_DE_AYUDA } = require('../tipos-de-ayuda');
/*
 * Lo que la ayuda entregada deja en el libro de la plata vive aparte, en
 * server/ayuda-tesoreria.js, como ya viven la ofrenda de un servicio y la
 * cuota de un integrante. Acá quedan los campos con que se decide; allá, qué
 * movimiento le corresponde a cada decisión.
 */
const puente = require('../ayuda-tesoreria');
/*
 * Cómo se compara un texto escrito por una persona y cuándo NO hay que volver
 * a preguntar viven en server/repetido.js: son las mismas reglas de Tesorería,
 * de Traspasos y de las cuatro carpetas de documentos. Escritas otra vez acá,
 * un día esta se olvidaría de comparar sin tildes.
 */
const { comoSeCompara, enPesos, seguiIgual } = require('../repetido');

/** De qué registro sale el beneficiario de esta ayuda. */
const DE_QUIEN = ['Miembro', 'No miembro'];

/**
 * A nombre de quién quedó esta ayuda, y con un solo enlace.
 *
 * El nombre se copia de la ficha en vez de pedirse aparte: escribirlo a mano
 * permitía que la ayuda dijera un nombre y apuntara a otra persona. Y se
 * suelta el enlace del lado que no corresponde, porque si alguien registra la
 * ayuda a nombre de un miembro y después la corrige a un no miembro, el enlace
 * viejo quedaría ahí apuntando a alguien que no recibió nada.
 *
 * Estaba escrito dentro del hook; salió acá cuando el hook pasó a hacer dos
 * cosas, para que la segunda no dependiera de dónde volvía la primera: esta
 * regla termina antes de tiempo en las ayudas viejas —las que no traen tipo de
 * beneficiario— y con las dos juntas eso se llevaba puesta la revisión de la
 * cuenta.
 */
function aNombreDeQuien(data, { existing, db }) {
  const tipo = data.beneficiario_tipo !== undefined
    ? data.beneficiario_tipo
    : existing && existing.beneficiario_tipo;

  const deDonde = tipo === 'Miembro'
    ? { tabla: 'miembros', campo: 'miembro_id', otro: 'no_miembro_id', que: 'El miembro' }
    : tipo === 'No miembro'
      ? { tabla: 'no_miembros', campo: 'no_miembro_id', otro: 'miembro_id', que: 'La persona' }
      : null;

  // Las ayudas registradas antes de que existiera este campo no traen tipo
  // y conservan el nombre que se escribió en su momento: no se tocan.
  if (!deDonde) return null;

  const id = data[deDonde.campo] !== undefined
    ? data[deDonde.campo]
    : existing && existing[deDonde.campo];
  if (!id) return `${deDonde.que} de esta ayuda no está indicado.`;

  const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde.tabla}" WHERE id = ?`).get(id);
  if (!ficha) return `${deDonde.que} de esta ayuda ya no está en el sistema.`;

  // La misma fórmula con que después se pone al día cuando la ficha se
  // corrige (ver server/nombre-del-beneficiario.js): escritas por separado,
  // un día difieren por un espacio y las ayudas quedan «cambiando» solas.
  data.beneficiario = require('../nombre-del-beneficiario').comoSeLlama(ficha);
  data[deDonde.otro] = null;
  return null;
}

/**
 * La ayuda igual a esta que ya estaba anotada, o null si no hay ninguna.
 *
 * «Igual» es: LA MISMA PERSONA, EL MISMO TIPO Y EL MISMO DÍA. Ni el monto ni la
 * descripción entran, y no es un descuido: los dos casos que se quieren atrapar
 * —dos personas atendiendo el mismo mostrador, o alguien que vuelve a
 * registrarla porque no la encontró— casi nunca traen el monto y la descripción
 * tecleados igual. Exigir que coincidan dejaría pasar justo lo que se busca.
 *
 * La fecha SÍ entra, al revés que en las carpetas de documentos. Allá el mismo
 * papel se vuelve a escanear semanas después y exigir la fecha haría fallar la
 * pregunta; acá una ayuda ES un hecho de un día, y la misma canasta al mes
 * siguiente es una entrega nueva y corriente que nadie tiene por qué confirmar.
 *
 * El estado no entra tampoco: una solicitada y otra solicitada el mismo día
 * para lo mismo son igual de sospechosas. Va en el aviso, que es donde sirve.
 *
 * El `id IS NOT ?` es por si acaso, y hoy no se alcanza: para llegar hasta acá
 * el guardado tiene que haber cambiado la persona, el tipo o la fecha, y en ese
 * caso la fila que se está corrigiendo —que todavía guarda los valores viejos—
 * ya no calza con los que se buscan. Se deja escrito igual, como en
 * server/carpetas.js, porque es lo que sostiene la regla si algún día cambian
 * los campos que hacen «la misma»: sin él, una ayuda se avisaría a sí misma
 * como repetida. Romperlo no pone roja ninguna prueba, y queda dicho acá para
 * que nadie lo lea como código vivo que alguien olvidó probar.
 */
function laMismaAyudaYaAnotada(db, { campo, quien, tipo, fecha }, id) {
  if (!campo || !quien || !tipo || !fecha) return null;
  return db
    .prepare(
      `SELECT a.id, a.tipo_ayuda, a.fecha, a.estado, a.valor_estimado, a.created_at,
              u.nombre AS quien_la_anoto
         FROM ayudas_sociales a
         LEFT JOIN usuarios u ON u.id = a.created_by
        WHERE a."${campo}" = ? AND a.fecha = ? AND a.id IS NOT ?
        ORDER BY a.id`
    )
    .all(quien, String(fecha).slice(0, 10), id || 0)
    .find((otra) => comoSeCompara(otra.tipo_ayuda) === comoSeCompara(tipo)) || null;
}

/**
 * El aviso de ayuda repetida, o null si no hay ninguna.
 *
 * Se pregunta, no se bloquea: dos entregas iguales el mismo día existen —dos
 * cajas para una familia grande, un aporte en dos partes— y el sistema no está
 * para discutírselo a quien tiene a la persona enfrente.
 *
 * Lo que no puede es dejarlo pasar en silencio, y el daño va más allá de la
 * cifra: la insignia de la ficha —«3 entregas · la última el 01-08-2026»— es lo
 * que alguien mira antes de decidir si le entrega otra vez. Con una entrega
 * repetida, esa insignia dice que ya recibió más de lo que recibió.
 */
function avisoDeAyudaRepetida(otra, aQuien) {
  const { comoSeLee } = require('../fechas');
  const senas = [
    otra.estado ? otra.estado.toLowerCase() : null,
    Number(otra.valor_estimado) > 0 ? enPesos(otra.valor_estimado) : 'sin monto anotado',
    otra.created_at ? `anotada el ${comoSeLee(String(otra.created_at).slice(0, 10))}` : null,
    otra.quien_la_anoto ? `por ${otra.quien_la_anoto}` : null,
  ].filter(Boolean).join(', ');

  return {
    error:
      `Ya hay una ayuda de ${otra.tipo_ayuda} para ${aQuien} con fecha `
      + `${comoSeLee(String(otra.fecha).slice(0, 10))} (${senas}). `
      + 'Si es esta misma, ábrala en vez de registrarla de nuevo: repetida, su historial dice que '
      + 'recibió más de lo que recibió, y eso es lo que se mira antes de decidir si se le entrega '
      + 'otra vez. Si de verdad fueron dos, confirme.',
    confirmar: 'ayuda_ya_registrada',
  };
}

/** La pregunta completa, tal como la llama el `beforeSave`. */
function preguntaSiSeRepite(data, { existing, db, confirmado }) {
  if (confirmado) return null;

  const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
  const campo = dato('miembro_id') ? 'miembro_id' : dato('no_miembro_id') ? 'no_miembro_id' : null;
  if (!campo) return null;

  const quien = dato(campo);
  const tipo = dato('tipo_ayuda');
  const fecha = dato('fecha');

  /*
   * Al CORREGIR una guardada solo se pregunta si este guardado cambia algo de
   * lo que la hace «la misma». Si no, la repetida ya estaba antes de abrir la
   * ficha y alguien ya dijo que eran dos.
   */
  const sinCambios = seguiIgual(existing, { [campo]: quien, tipo_ayuda: tipo, fecha }, [
    [campo, 'igual'], ['tipo_ayuda', 'texto'], ['fecha', 'fecha'],
  ]);
  if (sinCambios) return null;

  const otra = laMismaAyudaYaAnotada(db, { campo, quien, tipo, fecha }, existing && existing.id);
  return otra ? avisoDeAyudaRepetida(otra, data.beneficiario || (existing && existing.beneficiario) || 'esta persona') : null;
}

module.exports = {
  name: 'ayudas_sociales',
  label: 'Ayudas Sociales',
  labelSingular: 'Ayuda Social',
  icon: '🤝',
  group: 'Atención y ayuda',
  order: 31,
  display: '{tipo_ayuda} — {beneficiario}',
  dateField: 'fecha',
  searchFields: ['beneficiario', 'descripcion', 'tipo_ayuda'],
  listFields: ['fecha', 'beneficiario', 'beneficiario_tipo', 'tipo_ayuda', 'valor_estimado', 'estado', 'iglesia_id'],
  filterFields: ['beneficiario_tipo', 'tipo_ayuda', 'estado', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },

    // ---------------- A quién se le ayuda ----------------
    {
      name: 'beneficiario_tipo', label: '¿A quién se le ayuda?', type: 'select',
      options: DE_QUIEN, required: true, seccion: 'Beneficiario',
      help: 'Si la persona no pertenece a la iglesia, elija «No miembro» y búsquela —o regístrela— en No Miembros.',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros',
      required: true, showIf: { field: 'beneficiario_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'No Miembro', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'beneficiario_tipo', equals: 'No miembro' },
      help: 'Si todavía no tiene ficha, créela en No Miembros: basta con el nombre.',
    },
    {
      name: 'beneficiario', label: 'Beneficiario', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida: queda como constancia de a nombre de quién se entregó.',
    },

    // ---------------- La ayuda ----------------
    {
      name: 'tipo_ayuda', label: 'Tipo de ayuda', type: 'select', required: true, default: 'Alimentos',
      seccion: 'La ayuda',
      options: TIPOS_DE_AYUDA,
    },
    { name: 'descripcion', label: 'Descripción de la ayuda', type: 'textarea' },
    { name: 'valor_estimado', label: 'Valor estimado', type: 'money', min: 0 },
    { name: 'aprobada_por', label: 'Aprobada por', type: 'text' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Solicitada',
      options: ['Solicitada', 'Aprobada', 'Entregada', 'Rechazada'],
    },
    // De qué solicitud salió, cuando salió de una. Lo escribe el sistema al
    // aprobarla; queda a la vista para poder ir a leer lo que se pidió.
    { name: 'solicitud_id', label: 'Solicitud de origen', type: 'ref', ref: 'solicitudes', readonly: true },
    { name: 'soporte', label: 'Soporte / Evidencia', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },

    // ---------------- De dónde salió ----------------
    /*
     * La decisión que antes no existía. Sin ella, una ayuda entregada no decía
     * si la plata había salido de una cuenta de la iglesia o si era mercadería
     * donada, y el libro de la tesorería no se enteraba de ninguna de las dos.
     */
    {
      name: 'salida', label: '¿De dónde salió?', type: 'select',
      options: puente.DE_DONDE, seccion: 'De dónde salió',
      help: 'Al marcarla «Entregada» hay que decirlo. Si salió de una cuenta, el sistema anota solo '
        + 'el egreso en Tesorería; si fue en especie, no anota nada y queda escrito que lo fue.',
    },
    {
      name: 'cuenta_id', label: 'Cuenta de tesorería', type: 'ref', ref: 'cuentas_tesoreria',
      optionsRoute: '/ayudas_sociales/cuentas',
      placeholder: 'Escriba el nombre de la cuenta…',
      showIf: { field: 'salida', equals: puente.DE_UNA_CUENTA },
      help: 'De qué cuenta se descuenta lo entregado. Se ofrecen las cuentas activas de esta iglesia '
        + 'y las de la corporación.',
    },
    /*
     * Cómo se pagó lo dice la ayuda y no va escrito fijo: la ofrenda anotaba
     * «Efectivo» en todos sus movimientos, y con parte de la plata llegando al
     * banco el libro no cuadraba con la cartola. Se arregló allá; no tiene por
     * qué volver a pasar acá.
     */
    {
      name: 'metodo', label: 'Cómo se pagó', type: 'select', default: 'Efectivo',
      options: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
      showIf: { field: 'salida', equals: puente.DE_UNA_CUENTA },
    },
    // El movimiento que dejó en Tesorería, para poder corregirlo y retirarlo
    // con ella. Se maneja desde acá y no se escribe a mano.
    { name: 'movimiento_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    /**
     * Las reglas de una ayuda: a nombre de quién quedó, de dónde salió, si no
     * está anotada ya, y qué le falta si se está entregando.
     *
     * El orden importa. Las dos primeras son reparos: lo que devuelven no se
     * puede guardar de ninguna manera. La tercera es una pregunta que se puede
     * contestar «está bien, guardar así», y el mecanismo de confirmación es uno
     * solo para todo el guardado: si fuera antes, taparía un reparo de verdad
     * con una pregunta que se puede saltar.
     */
    beforeSave(data, { user, isNew, existing, db, confirmado }) {
      const problema = aNombreDeQuien(data, { existing, db });
      if (problema) return problema;
      const cuenta = puente.revisarDeDondeSalio(data, { user, existing, db });
      if (cuenta) return cuenta;

      /*
       * Y después las preguntas, en este orden. La confirmación es una sola
       * para todo el guardado, así que la que se muestra tiene que ser la que
       * más importa:
       *
       *   1. DESHACER UNA ENTREGA borra un hecho que ya se dio por cierto y,
       *      si salió de una cuenta, le mueve el saldo. Es lo más grave.
       *   2. UNA AYUDA REPETIDA dice algo FALSO del historial de una persona,
       *      y con eso se decide si se le entrega otra vez.
       *   3. UNA SIN MONTO dice algo INCOMPLETO, que es menos grave.
       *
       * Es el mismo criterio con que Tesorería pone primero el movimiento
       * repetido: lo que cuesta plata se pregunta antes.
       */
      const seDeshace = puente.avisoSiSeDeshaceLaEntrega({ data, existing, db, confirmado });
      if (seDeshace) return seDeshace;
      const repetida = preguntaSiSeRepite(data, { existing, db, confirmado });
      if (repetida) return repetida;
      return puente.loQueLeFaltaAlEntregar({ data, existing, confirmado });
    },

    /**
     * Deja el libro de la plata calzando con lo que dice la ayuda. Qué
     * movimiento le corresponde a cada caso está en server/ayuda-tesoreria.js.
     */
    afterSave(fila, { db }) {
      puente.sincronizarEgresoDeAyuda(fila, db);
    },

    beforeDelete(fila, { db }) {
      // El egreso de una ayuda que se elimina no puede quedar en el libro
      puente.retirarEgresoDeAyuda(fila.id, db);
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm, scopeClause }) {
    /*
     * Qué ayudas se están mirando: el alcance de quien pregunta más los
     * filtros y el período de la pantalla. Lo arma una sola vez para que el
     * informe no pueda decir un total distinto del que muestra el listado del
     * que salió.
     *
     * Sin alias en la tabla: las condiciones que emite server/alcance.js traen
     * los nombres de columna a secas, y la regla de a quién se ayudó también
     * (ver server/a-quien-se-ayudo.js).
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
      filtro('f_tipo_ayuda', 'tipo_ayuda');
      filtro('f_beneficiario_tipo', 'beneficiario_tipo');
      filtro('f_estado', 'estado');
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

    /*
     * LAS CUENTAS DONDE SE PUEDE ANOTAR EL EGRESO DE UNA AYUDA.
     *
     * Tiene su propia ruta, y no la de Tesorería, por una razón concreta: el
     * selector de cuenta de un movimiento pide permiso de Tesorería, y quien
     * registra las ayudas en el mostrador no lo tiene —el rol de secretario
     * tiene Ayudas Sociales y no tiene Tesorería—. Con la ruta de allá, el
     * desplegable le llegaba vacío justo a quien tiene que llenarlo.
     *
     * Que pueda anotar un egreso sin ser tesorero no es una excepción de este
     * módulo: es lo que ya pasa con la ofrenda de un servicio, que también la
     * registra el secretario y también deja sus movimientos. Quien anota el
     * hecho anota su consecuencia; lo que no puede es andar por Tesorería.
     *
     * Se ofrecen las de la iglesia de la ayuda y las de la corporación —que no
     * son de ninguna—, activas y dentro de su alcance, que es exactamente lo
     * que después deja pasar la revisión al guardar.
     */
    router.get('/ayudas_sociales/cuentas', requirePerm('ayudas_sociales', 'view'), (req, res) => {
      const params = [];
      const where = ["estado = 'Activa'"];
      const suyas = require('../alcance').iglesiasDe(req.user);
      if (suyas.length) {
        where.push(`(iglesia_id IS NULL OR iglesia_id IN (${suyas.map(() => '?').join(',')}))`);
        params.push(...suyas);
      }
      if (req.query.iglesia_id) {
        where.push('(iglesia_id IS NULL OR iglesia_id = ?)');
        params.push(req.query.iglesia_id);
      }
      const filas = db
        .prepare(`SELECT id, nombre, ambito FROM cuentas_tesoreria WHERE ${where.join(' AND ')} ORDER BY ambito, nombre`)
        .all(...params);
      res.json(filas.map((c) => ({ id: c.id, label: `${c.nombre} · ${c.ambito}` })));
    });

    /*
     * EL INFORME DE AYUDAS: a cuántas personas distintas se ha ayudado.
     *
     * Es la pregunta que llega desde afuera —la directiva, una fundación, la
     * cuenta anual— y la que el módulo de No Miembros dijo venir a contestar.
     * Se podía contar cuántas ENTREGAS hubo, porque el listado las trae todas;
     * no cuántas PERSONAS, que no es lo mismo cuando a una se le entregó tres
     * veces. Atención y ayuda era el único grupo del menú que entrega plata y
     * mercadería sin una sola pantalla que las sume: Tesorería tiene su
     * balance y Asistencia su informe.
     *
     * Cómo se cuenta una persona —y por qué no es lo mismo que contar
     * enlaces— está en server/a-quien-se-ayudo.js.
     */
    router.get('/ayudas_sociales/informe', requirePerm('ayudas_sociales', 'view'), (req, res) => {
      const { whereSql, params } = loQueSeEstaMirando(req);
      const aQuien = require('../a-quien-se-ayudo');
      const iglesias = new Map(
        db.prepare('SELECT id, nombre FROM iglesias').all().map((i) => [String(i.id), i.nombre])
      );
      res.json({
        desde: req.query.desde || null,
        hasta: req.query.hasta || null,
        resumen: aQuien.cifrasDe(db, whereSql, params),
        porTipo: aQuien.abiertoPor(db, 'tipo_ayuda', whereSql, params),
        porIglesia: aQuien
          .abiertoPor(db, 'iglesia_id', whereSql, params)
          .map((f) => ({ ...f, nombre: iglesias.get(String(f.clave)) || '(sin iglesia)' })),
        porMes: aQuien.abiertoPor(db, "substr(fecha, 1, 7)", whereSql, params, 'clave'),
        masAyudadas: aQuien.masAyudadas(db, whereSql, params),
      });
    });

    /**
     * LO QUE SE LE HA ENTREGADO A UNA PERSONA, para verlo en su ficha.
     *
     * El módulo de No Miembros existe, con todas sus letras, «por las ayudas
     * sociales»: para saber a cuántas personas distintas se ha ayudado y para
     * ver que a la misma señora se le entregó tres veces. El dato estaba bien
     * guardado —cada ayuda apunta a su ficha— pero no había camino de vuelta:
     * la ficha de una persona a la que se le entregó tres veces no decía nada
     * de eso, y para averiguarlo había que salir de ella, entrar acá, filtrar
     * por su nombre y volver. En el mostrador eso no se hace, y se termina
     * entregando dos veces o no entregando nunca.
     *
     * Sirve para los dos registros, porque la misma persona puede recibir
     * antes y después de inscribirse.
     *
     * DOS CUENTAS, A PROPÓSITO, y por eso van juntas en una sola respuesta:
     *
     *   · EL RESUMEN se calcula en la base sobre TODAS sus ayudas. Es lo que
     *     dice la insignia de la cabecera y no puede depender de cuántas
     *     quepan en la pantalla.
     *   · LA LISTA trae las 200 más recientes. Si hubiera más, el resumen lo
     *     delata —la cuenta no cuadra con las filas— y por eso viaja también
     *     cuántas hay en total.
     *
     * Y «entregas» no es «ayudas»: una solicitada, aprobada o rechazada
     * todavía no es plata ni mercadería que salió. La insignia cuenta las
     * entregadas, que es lo que se pregunta en el mostrador.
     *
     * Pasa por el alcance como cualquier listado: quien no ve una ayuda
     * tampoco la ve desde acá. Sin JOIN y sin alias, porque el alcance escribe
     * los nombres de columna sin apellido (ver server/alcance.js).
     */
    router.get('/ayudas_sociales/de-persona', requirePerm('ayudas_sociales', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const esMiembro = req.query.tipo === 'Miembro';
      const quien = Number(req.query.id) || 0;
      if (!quien) return res.status(400).json({ error: 'Indique de quién son las ayudas.' });

      /*
       * DE QUIÉN SON ESTAS AYUDAS, incluida la que era antes de inscribirse.
       *
       * A una persona se le puede haber entregado algo cuando todavía no
       * pertenecía a la iglesia. Al inscribirse, su ficha de No Miembro no se
       * borra —de ella cuelgan esas entregas— y queda apuntando a la nueva con
       * `miembro_id`. Ese enlace existía y no lo seguía nadie: desde su ficha
       * de miembro se veían CERO ayudas, y las de antes quedaban colgando de
       * una ficha que ya nadie abre. Es la misma señora; su historia no empieza
       * el día que se inscribió.
       *
       * Se sigue hacia atrás, y solo desde el lado del miembro: pedir las de un
       * no miembro trae las suyas y nada más, porque esa ficha es la que las
       * recibió.
       *
       * La subconsulta lleva apellido —`nm.`— a propósito: el alcance escribe
       * los nombres de columna sin él (ver server/alcance.js), y sin el
       * apellido `miembro_id` diría dos cosas distintas según dónde se lea.
       */
      const deQuien = esMiembro
        ? '(miembro_id = ? OR no_miembro_id IN (SELECT nm.id FROM no_miembros nm WHERE nm.miembro_id = ?))'
        : 'no_miembro_id = ?';
      const suyoEs = esMiembro ? [quien, quien] : [quien];

      const donde = (params) => {
        const suyas = alcance.condiciones(module.exports, req.user, params);
        return `WHERE ${deQuien}${suyas ? ` AND (${suyas})` : ''}`;
      };

      const pl = [];
      const lista = db
        .prepare(
          `SELECT id, fecha, tipo_ayuda, descripcion, valor_estimado, estado, iglesia_id, solicitud_id,
                  CASE WHEN no_miembro_id IS NOT NULL AND ${esMiembro ? '1' : '0'} = 1
                       THEN 1 ELSE 0 END AS antes
             FROM ayudas_sociales ${donde(pl)}
            ORDER BY fecha DESC, id DESC LIMIT 200`
        )
        .all(...suyoEs, ...pl);

      const pr = [];
      const r = db
        .prepare(
          `SELECT COUNT(*) AS registradas,
                  SUM(CASE WHEN estado = 'Entregada' THEN 1 ELSE 0 END) AS entregas,
                  SUM(CASE WHEN estado = 'Entregada' THEN COALESCE(valor_estimado, 0) ELSE 0 END) AS entregado,
                  -- Y cuántas de esas no dicen cuánto valían: la suma de abajo
                  -- las cuenta como cero, y sin decirlo parece el total exacto
                  SUM(CASE WHEN estado = 'Entregada' AND COALESCE(valor_estimado, 0) <= 0
                           THEN 1 ELSE 0 END) AS sin_monto,
                  MAX(CASE WHEN estado = 'Entregada' THEN fecha END) AS ultima,
                  SUM(CASE WHEN estado IN ('Solicitada', 'Aprobada') THEN 1 ELSE 0 END) AS en_camino,
                  SUM(CASE WHEN no_miembro_id IS NOT NULL AND ${esMiembro ? '1' : '0'} = 1
                           THEN 1 ELSE 0 END) AS antes
             FROM ayudas_sociales ${donde(pr)}`
        )
        .get(...suyoEs, ...pr);

      res.json({
        ayudas: lista,
        registradas: r.registradas || 0,
        entregas: r.entregas || 0,
        entregado: r.entregado || 0,
        sin_monto: r.sin_monto || 0,
        ultima: r.ultima || null,
        en_camino: r.en_camino || 0,
        antes_de_inscribirse: r.antes || 0,
      });
    });
  },
};
