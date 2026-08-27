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
 *
 * De la ficha del cuerpo cuelgan además sus integrantes —cada uno con su
 * estado y su período de prueba, en el módulo "integrantes_cuerpo"—, su
 * tesorería, sus cuotas mensuales y sus actas de reunión.
 *
 * ---------------------------------------------------------------------------
 * DOS COSAS EN LAS QUE UN GRUPO NO SE PARECE A UN CUERPO
 *
 * 1. QUIÉN LO DIRIGE. A un cuerpo lo dirige un miembro inscrito: es formal, y
 *    de sus integrantes sale su directiva. A un grupo lo puede dirigir alguien
 *    que no está en la membresía —el hermano que lleva el equipo de sonido—,
 *    que se busca en el registro aparte (módulo «No Miembros»).
 *
 * 2. LA CUOTA. Un cuerpo nace cobrando cuota mensual; un grupo, no. Casi
 *    ningún grupo cobra, y hasta ahora nacían cobrando igual que los cuerpos:
 *    si nadie se acordaba de apagarlo, su gente quedaba con una deuda que
 *    nunca existió. Se puede encender en el grupo que sí cobre.
 */
const { REGISTROS } = require('../integrantes');

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
  order: 52,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion', 'lider'],
  listFields: ['foto', 'nombre', 'tipo', 'iglesia_id', 'lider', 'estado', 'cumplimiento'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  computed: [
    {
      name: 'cumplimiento', label: 'Cumplimiento', type: 'badge',
      help: 'Se calcula con el reglamento, la directiva vigente y el estado del cuerpo.',
      calc: (fila, { db }) => evaluarCumplimiento(fila, db),
    },
  ],
  fields: [
    {
      name: 'foto', label: 'Fotografía del cuerpo / grupo', type: 'file', accept: 'image/*',
      recorte: 'cuadrado',
      help: 'La foto con la que se reconoce a este cuerpo o grupo. Al subirla se ajusta sola de tamaño.',
    },
    { name: 'nombre', label: 'Nombre', type: 'text', required: true, help: 'Ej: Damas, Caballeros, Jóvenes, Coro, Escuela Dominical…' },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Cuerpo',
      options: ['Cuerpo', 'Grupo'],
      help: 'CUERPO: entidad formal, con reglamento, deberes y derechos. GRUPO: agrupación de servicio o ayuda, sin reglamento ni obligaciones formales.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'lider_tipo', label: '¿Quién lo dirige?', type: 'select',
      default: 'Miembro', options: REGISTROS,
      help: 'La segunda opción es para el hermano o la hermana que dirige un GRUPO sin estar '
        + 'inscrito en la membresía. Un cuerpo lo dirige un miembro inscrito: es formal, y de sus '
        + 'integrantes sale su directiva.',
    },
    {
      name: 'lider_id', label: 'Líder / Encargado', type: 'ref', ref: 'miembros',
      showIf: { field: 'lider_tipo', equals: 'Miembro' },
    },
    {
      name: 'lider_no_miembro_id', label: 'Encargado(a) no inscrito(a)', type: 'ref', ref: 'no_miembros',
      showIf: { field: 'lider_tipo', equals: 'No miembro' },
      help: 'Se busca en el registro de No Miembros. Si todavía no tiene ficha, créela ahí: basta con el nombre.',
    },
    {
      name: 'lider', label: 'Quién lo dirige', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida, para que el listado y el buscador digan el '
        + 'nombre sin tener que mirar dos registros.',
    },
    {
      name: 'reune_lideres', label: 'Este cuerpo reúne a los miembros líderes de su iglesia', type: 'boolean',
      help: 'Es la directiva. Quien pase a la categoría «Miembro Líder» entra solo, y quien la deje sale solo. '
        + 'Se marca en un solo cuerpo por iglesia.',
    },
    { name: 'fecha_creacion', label: 'Fecha de creación', type: 'date' },

    // --- Cómo entra y cómo aporta cada integrante ---
    {
      name: 'meses_prueba', label: 'Meses de período de prueba', type: 'number',
      seccion: 'Ingreso de integrantes',
      help: 'Cuánto dura la prueba de quien entra a este cuerpo, antes de evaluar su informe. En blanco, se usan los meses de Configuración → Organización.', min: 0, max: 60,
    },
    {
      /*
       * Sin `default` a propósito: cuánto vale de fábrica depende del tipo, y
       * eso se decide en beforeSave. Un cuerpo nace cobrando y un grupo no.
       */
      name: 'cobra_cuota', label: 'Este cuerpo cobra cuota mensual', type: 'boolean',
      seccion: 'Cuota mensual',
      help: 'Los cuerpos nacen cobrando y los grupos no, porque casi ninguno cobra. Enciéndalo en el '
        + 'grupo que sí cobre, o apáguelo en el cuerpo que no. Un integrante suelto se exime desde su propia ficha.',
    },
    {
      name: 'cuota_mensual', label: 'Monto de la cuota', type: 'money', min: 0,
      showIf: { field: 'cobra_cuota', equals: '1' },
      help: 'Lo que le corresponde pagar cada mes a cada integrante de este cuerpo.',
    },

    // --- Propios de los cuerpos formales ---
    {
      name: 'fecha_constitucion', label: 'Fecha de constitución formal', type: 'date', noAntesDe: 'fecha_creacion',
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
  hooks: {
    /**
     * La directiva es una sola por iglesia.
     *
     * Con dos cuerpos marcados, un miembro líder entraría a los dos y saldría
     * de los dos, y ninguna de las dos listas sería «la directiva». Se dice
     * cuál lo tiene ya, para poder ir a destildarlo si de verdad se quiere
     * cambiar.
     */
    beforeSave(data, { id, existing, isNew, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const tipo = dato('tipo') || 'Cuerpo';
      const iglesiaId = dato('iglesia_id');

      /*
       * De fábrica un cuerpo cobra cuota y un grupo no.
       *
       * No se declara como `default` del campo porque depende del tipo. Solo
       * vale al crear y solo si no viene dicho: quien mande el dato manda.
       */
      if (isNew && (data.cobra_cuota === undefined || data.cobra_cuota === null || data.cobra_cuota === '')) {
        data.cobra_cuota = tipo === 'Grupo' ? 0 : 1;
      }

      /*
       * A un GRUPO lo puede dirigir alguien que no está inscrito.
       *
       * A un cuerpo no: es una entidad formal, y de sus integrantes sale su
       * directiva. Como en la ficha de integrante, la persona sale de uno de
       * los dos registros y el enlace del otro lado se suelta: si no, corregir
       * de un registro al otro dejaría el enlace viejo apuntando a alguien que
       * ya no dirige nada.
       */
      const liderTipo = REGISTROS.includes(dato('lider_tipo')) ? dato('lider_tipo') : 'Miembro';
      data.lider_tipo = liderTipo;
      if (liderTipo === 'No miembro' && tipo !== 'Grupo') {
        return 'Un cuerpo lo dirige un miembro inscrito: es una entidad formal y de sus integrantes '
          + 'sale su directiva. Para poner de encargado a alguien que no está en la membresía, el '
          + 'tipo tiene que ser Grupo.';
      }

      const deDonde = liderTipo === 'No miembro'
        ? { tabla: 'no_miembros', campo: 'lider_no_miembro_id', otro: 'lider_id' }
        : { tabla: 'miembros', campo: 'lider_id', otro: 'lider_no_miembro_id' };
      const quien = Number(dato(deDonde.campo));
      data[deDonde.otro] = null;
      if (!quien) {
        // Un cuerpo puede no tener líder puesto todavía: eso es legítimo
        data[deDonde.campo] = null;
        data.lider = null;
      } else {
        const ficha = db
          .prepare(`SELECT nombres, apellidos, iglesia_id FROM "${deDonde.tabla}" WHERE id = ?`)
          .get(quien);
        if (!ficha) return 'La persona que se puso como líder ya no está en el sistema.';
        if (liderTipo === 'No miembro' && ficha.iglesia_id && iglesiaId
            && Number(ficha.iglesia_id) !== Number(iglesiaId)) {
          return 'Esa persona está registrada en otra iglesia. Cada iglesia lleva a los suyos.';
        }
        data[deDonde.campo] = quien;
        data.lider = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
      }

      const marcada = dato('reune_lideres');
      if (!marcada) return null;
      if (!iglesiaId) return null;

      const otra = db
        .prepare('SELECT id, nombre FROM cuerpos WHERE iglesia_id = ? AND reune_lideres = 1 AND id <> ?')
        .get(iglesiaId, id || 0);
      if (otra) {
        return `"${otra.nombre}" ya es la directiva de esta iglesia. Destíldelo ahí antes de marcar este, ` +
          'para que los miembros líderes no queden en dos cuerpos a la vez.';
      }
      return null;
    },

    /**
     * Cada cuerpo estrena dos cuentas: su tesorería general y la de las
     * cuotas de sus integrantes, que se manejan aparte.
     */
    afterSave(fila, { isNew, existing, user, db }) {
      if (isNew) require('../cuentas-de-cuerpos').crearLasQueFalten(db, fila);

      /**
       * Recién marcado como directiva: entran los líderes que ya lo eran.
       *
       * Sin esto la casilla solo valdría de ahí en adelante, y la directiva
       * arrancaría vacía teniendo la iglesia sus líderes registrados desde
       * antes. Se corre solo cuando la marca CAMBIA a puesta, no en cada
       * guardado: si no, cada vez que alguien corrigiera el teléfono del
       * cuerpo volvería a meter a los que se hubieran retirado a mano.
       */
      const seAcabaDeMarcar = fila.reune_lideres && (isNew || !(existing && existing.reune_lideres));
      if (seAcabaDeMarcar) require('../directiva').alMarcarUnCuerpo(db, fila, user);
    },
  },

  extraRoutes(router, { db, requirePerm, can }) {
    /**
     * El cuerpo del que se está pidiendo el panel, comprobando que sea uno de
     * los suyos.
     *
     * Estas rutas se pidieron siempre desde la ficha de un cuerpo que la
     * persona ya estaba viendo, así que parecía que bastaba con el permiso del
     * módulo. No basta: escribiendo la dirección a mano, quien tiene asignado
     * un cuerpo alcanzaba la gente, las cuotas y la plata de otro. El alcance
     * se comprueba acá, como en cualquier otra consulta.
     */
    const cuerpoDelUsuario = (req, res) => {
      const fila = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(req.params.id);
      if (!fila) {
        res.status(404).json({ error: 'Cuerpo no encontrado' });
        return null;
      }
      if (!require('../alcance').alcanza(module.exports, fila, req.user)) {
        res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
        return null;
      }
      return fila;
    };

    /**
     * Cada panel de la ficha pide SU permiso, no el del cuerpo.
     *
     * Los paneles se pintan dentro de la ficha del cuerpo, y por eso pedían
     * solo «Cuerpos → ver». Con eso, a quien se le quitaba Integrantes de
     * Cuerpos o Cuotas de Cuerpos igual los veía completos acá: el permiso
     * estaba puesto en el editor y no servía de nada, que es peor que no
     * tenerlo. Escribir en ellos sí exigía lo que corresponde; leer, no.
     *
     * Cada llave que se pide de más se nombra, para que el que se topa con un
     * 403 sepa cuál le falta.
     */
    const conPermisoDe = (...llaves) => (req, res, siguiente) => {
      for (const [modulo, accion, comoSeLlama] of llaves) {
        if (!can(req.user, modulo, accion)) {
          return res.status(403).json({ error: `No tiene permiso para ver ${comoSeLlama}` });
        }
      }
      siguiente();
    };

    const VE_INTEGRANTES = conPermisoDe(['integrantes_cuerpo', 'view', 'los integrantes de los cuerpos']);
    // Las cuotas son plata del cuerpo: hacen falta las dos cosas
    const VE_CUOTAS = conPermisoDe(
      ['cuotas_cuerpo', 'view', 'las cuotas de los cuerpos'],
      ['tesoreria_cuerpo', 'view', 'la tesorería de los cuerpos']
    );
    const COBRA_CUOTAS = conPermisoDe(['tesoreria_cuerpo', 'view', 'la tesorería de los cuerpos']);

    // Detalle del cumplimiento de un cuerpo, para mostrarlo en su ficha
    router.get('/cuerpos/:id(\\d+)/cumplimiento', requirePerm('cuerpos', 'view'), (req, res) => {
      const fila = cuerpoDelUsuario(req, res);
      if (!fila) return;
      res.json(evaluarCumplimiento(fila, db));
    });

    /**
     * La gente del cuerpo, para el panel de su ficha: cada uno con su estado,
     * su período de prueba y si le corresponde pagar cuota. Vienen todos,
     * retirados incluidos, y la pantalla decide a quién muestra.
     */
    router.get('/cuerpos/:id(\\d+)/integrantes', requirePerm('cuerpos', 'view'), VE_INTEGRANTES, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      const { integrantesDe } = require('../integrantes');
      const hoy = new Date().toISOString().slice(0, 10);

      const gente = integrantesDe(db, cuerpo.id, { conRetirados: true }).map((f) => ({
        id: f.id,
        persona_tipo: f.persona_tipo,
        miembro_id: f.miembro_id || null,
        no_miembro_id: f.no_miembro_id || null,
        nombre: require('../nombres').paraMostrar(f.nombres, f.apellidos),
        rut: f.rut || null,
        foto: f.foto || null,
        estado: f.estado,
        fecha_ingreso: f.fecha_ingreso,
        fecha_fin_prueba: f.fecha_fin_prueba,
        fecha_oficial: f.fecha_oficial,
        fecha_retiro: f.fecha_retiro,
        motivo_retiro: f.motivo_retiro,
        exento_cuota: !!f.exento_cuota,
        exento_motivo: f.exento_motivo,
        lidera: f.persona_tipo === 'No miembro'
          ? Number(cuerpo.lider_no_miembro_id) === Number(f.no_miembro_id)
          : Number(cuerpo.lider_id) === Number(f.miembro_id),
        prueba_vencida: f.estado === 'En prueba' && !!f.fecha_fin_prueba && f.fecha_fin_prueba < hoy,
        evaluaciones: db
          .prepare('SELECT COUNT(*) n FROM evaluaciones_integrantes WHERE integrante_id = ?')
          .get(f.id).n,
      }));

      res.json({
        cuerpo: {
          id: cuerpo.id, nombre: cuerpo.nombre, tipo: cuerpo.tipo,
          cobra_cuota: !!cuerpo.cobra_cuota, cuota_mensual: cuerpo.cuota_mensual,
          meses_prueba: cuerpo.meses_prueba,
        },
        integrantes: gente,
        resumen: {
          activos: gente.filter((g) => g.estado === 'Activo').length,
          en_prueba: gente.filter((g) => g.estado === 'En prueba').length,
          retirados: gente.filter((g) => g.estado === 'Retirado').length,
          prueba_vencida: gente.filter((g) => g.prueba_vencida).length,
          no_inscritos: gente.filter((g) => g.persona_tipo === 'No miembro' && g.estado !== 'Retirado').length,
        },
        puede_editar: can(req.user, 'integrantes_cuerpo', 'edit'),
        puede_agregar: can(req.user, 'integrantes_cuerpo', 'create'),
        /*
         * Solo en un GRUPO se puede sumar a alguien que no está inscrito en la
         * membresía, y solo si además puede mirar ese registro: la lista de No
         * Miembros no se le abre a cualquiera (son fichas de gente en situación
         * vulnerable). La regla de verdad la aplica el servidor al guardar;
         * esto es para que la pantalla no ofrezca lo que va a ser rechazado.
         */
        admite_no_inscritos: cuerpo.tipo === 'Grupo' && can(req.user, 'no_miembros', 'view'),
      });
    });

    /**
     * La planilla de cuotas de un año: una fila por integrante y una columna
     * por mes, con lo que ya está pagado. Los retirados no salen, y quien está
     * exento —o pertenece a un cuerpo que no cobra— sale marcado como tal.
     */
    router.get('/cuerpos/:id(\\d+)/cuotas', requirePerm('cuerpos', 'view'), VE_CUOTAS, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      const anio = Number(req.query.anio) || new Date().getFullYear();
      const { integrantesDe } = require('../integrantes');

      const pagos = db
        .prepare('SELECT integrante_id, mes, monto, fecha_pago FROM cuotas_cuerpo WHERE cuerpo_id = ? AND anio = ?')
        .all(cuerpo.id, anio);

      const filas = integrantesDe(db, cuerpo.id).map((f) => {
        const suyos = pagos.filter((p) => Number(p.integrante_id) === Number(f.id));
        const meses = {};
        for (const p of suyos) meses[p.mes] = { monto: p.monto, fecha: p.fecha_pago };
        return {
          id: f.id,
          persona_tipo: f.persona_tipo,
          miembro_id: f.miembro_id || null,
          no_miembro_id: f.no_miembro_id || null,
          nombre: require('../nombres').paraMostrar(f.nombres, f.apellidos),
          estado: f.estado,
          exento: !!f.exento_cuota,
          exento_motivo: f.exento_motivo,
          meses,
          pagados: suyos.length,
          total: suyos.reduce((t, p) => t + (Number(p.monto) || 0), 0),
        };
      });

      res.json({
        anio,
        cobra_cuota: !!cuerpo.cobra_cuota,
        cuota_mensual: cuerpo.cuota_mensual,
        filas,
        total_recaudado: filas.reduce((t, f) => t + f.total, 0),
        puede_cobrar: can(req.user, 'cuotas_cuerpo', 'create') && can(req.user, 'tesoreria_cuerpo', 'view'),
      });
    });

    /** Marcar que alguien pagó su cuota de un mes, desde la propia planilla. */
    router.post('/cuerpos/:id(\\d+)/cuotas', requirePerm('cuotas_cuerpo', 'create'), COBRA_CUOTAS, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      // Y que el integrante sea de este cuerpo: si no, se estaría cobrando en
      // el libro de uno la cuota de otro.
      const suyo = db
        .prepare('SELECT id FROM integrantes_cuerpo WHERE id = ? AND cuerpo_id = ?')
        .get(req.body && req.body.integrante_id, cuerpo.id);
      if (!suyo) return res.status(404).json({ error: 'Esa persona no es integrante de este cuerpo.' });

      const { registrarPago } = require('../cuotas');
      const r = registrarPago(db, {
        integranteId: req.body && req.body.integrante_id,
        anio: req.body && req.body.anio,
        mes: req.body && req.body.mes,
        usuarioId: req.user && req.user.id,
      });
      if (r.error) return res.status(400).json({ error: r.error });
      res.json(r.cuota);
    });

    /** Y deshacerlo, cuando se marcó por equivocación. */
    router.delete('/cuerpos/:id(\\d+)/cuotas/:cuota(\\d+)', requirePerm('cuotas_cuerpo', 'delete'), COBRA_CUOTAS, (req, res) => {
      if (!cuerpoDelUsuario(req, res)) return;
      const { borrarPago } = require('../cuotas');
      const cuota = db.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ? AND cuerpo_id = ?')
        .get(req.params.cuota, req.params.id);
      if (!cuota) return res.status(404).json({ error: 'Esa cuota no es de este cuerpo.' });
      const r = borrarPago(db, cuota.id);
      if (r.error) return res.status(400).json({ error: r.error });
      res.json({ ok: true });
    });
  },
};
