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

/** De qué registro sale el beneficiario de esta ayuda. */
const DE_QUIEN = ['Miembro', 'No miembro'];

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
  ],

  hooks: {
    /**
     * Deja escrito el nombre de quien recibió la ayuda, y solo uno de los dos
     * enlaces.
     *
     * El nombre se copia de la ficha en vez de pedirse aparte: escribirlo a
     * mano permitía que la ayuda dijera un nombre y apuntara a otra persona.
     * Y se suelta el enlace del lado que no corresponde, porque si alguien
     * registra la ayuda a nombre de un miembro y después la corrige a un no
     * miembro, el enlace viejo quedaría ahí apuntando a alguien que no recibió
     * nada.
     */
    beforeSave(data, { isNew, existing, db }) {
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
        ultima: r.ultima || null,
        en_camino: r.en_camino || 0,
        antes_de_inscribirse: r.antes || 0,
      });
    });
  },
};
