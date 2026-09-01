/**
 * Módulo: Deudas y Compromisos.
 *
 * Lo que la organización DEBE y lo que le deben, que hasta la 1.247.0 no vivía
 * en ninguna parte. Tesorería lleva el movimiento de la plata —lo que ya
 * ocurrió— y eso está bien; lo que faltaba era el otro lugar, donde vive lo
 * que está comprometido.
 *
 * QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO. Siguiendo dos casos reales de la
 * corporación sobre el sistema andando:
 *
 *   un hermano presta $ 400.000 y se le devuelve
 *     → el balance de la reunión decía «entraron $ 1.400.000, salieron
 *       $ 1.400.000» donde la iglesia reunió y gastó un millón: 40 % inflado,
 *       porque un préstamo entra como ingreso corriente;
 *     → la caja de un cuerpo con un préstamo de $ 150.000 decía tener
 *       $ 150.000 propios, teniendo cero y debiendo todo.
 *
 *   sillas por $ 500.000 en seis cuotas
 *     → anotar la compra entera dejaba la caja en $ -366.666, y con razón:
 *       esa plata no salió de ahí;
 *     → anotar solo las cuotas dejaba la caja perfecta y el compromiso
 *       invisible: pagadas dos de seis, el sistema sabía que se gastaron
 *       $ 166.666 y nada más —ni cuánto se debía, ni cuántas cuotas faltaban,
 *       ni con quién era la deuda—.
 *
 * LAS DOS DIRECCIONES. Se anota lo que se debe y lo que se prestó, como el
 * inventario anota lo prestado a la iglesia y lo que la iglesia prestó. Lo
 * dice `direccion`, y se lee siempre RESPECTO DE LA CAJA de la ficha.
 *
 * DE QUIÉN ES LA DEUDA LO DICE LA CAJA, como en todo lo demás de Finanzas: la
 * corporación, una iglesia local o un cuerpo. No hay un campo suelto que
 * pueda contradecirla, que es el mismo motivo por el que un movimiento toma su
 * iglesia y su cuerpo de la cuenta y no de quien lo escribe.
 *
 * CERRAR UNA DEUDA ES OTRA COSA QUE ANOTARLA, y por eso lleva su propia llave
 * (`deudas_cerrar` en server/permissions.js). Anotar que se debe es trabajo de
 * todos los días; declarar que ya no se debe es cerrar el asunto.
 *
 * LO QUE ESTA VERSIÓN TODAVÍA NO TRAE, y viene enseguida: el plan de cuotas
 * —una fila por cuota, y marcarla pagada deja su movimiento—, que los informes
 * cuenten aparte la plata prestada, el aviso del panel y la hoja impresa.
 */

/** Hacia dónde va la deuda, leída desde la caja de esta ficha. */
const POR_PAGAR = 'Por pagar';
const POR_COBRAR = 'Por cobrar';
const DIRECCIONES = [POR_PAGAR, POR_COBRAR];

/**
 * De qué clase es. Una compra a crédito solo existe hacia el lado de pagar:
 * la organización no le vende a nadie a plazo.
 */
const CLASES_POR_PAGAR = ['Préstamo en dinero', 'Compra a crédito', 'Crédito de una institución'];
const CLASES_POR_COBRAR = ['Préstamo en dinero'];
const CLASES = [...new Set([...CLASES_POR_PAGAR, ...CLASES_POR_COBRAR])];

/** Con quién es la deuda. */
const UNA_PERSONA = 'Una persona';
const UNA_INSTITUCION = 'Una institución';
const CONTRAPARTES = [UNA_PERSONA, UNA_INSTITUCION];

/** En qué estado está. Cerrarla es lo que pide la llave. */
const VIGENTE = 'Vigente';
const CERRADAS = ['Pagada', 'Condonada'];
const ESTADOS = [VIGENTE, ...CERRADAS];

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/** Con quién es esta deuda, en una línea. */
function conQuien(fila) {
  if (!fila) return '';
  return fila.contraparte_tipo === UNA_INSTITUCION
    ? String(fila.institucion || '').trim()
    : String(fila.contraparte || '').trim();
}

/**
 * Lo que falta por decir de la otra parte, o null.
 *
 * Se exige la que corresponde al tipo elegido y se suelta la otra: quien
 * anota primero a un hermano y después lo corrige a una casa comercial dejaría
 * el nombre viejo ahí, apuntando a alguien que no prestó nada. Es la misma
 * regla que usa una ayuda social con su beneficiario.
 */
function laOtraParte(data, { existing }) {
  const valor = (campo) => (data[campo] !== undefined ? data[campo] : existing ? existing[campo] : null);
  const tipo = valor('contraparte_tipo');
  if (!tipo) return 'Indique con quién es esta deuda: una persona o una institución';

  if (tipo === UNA_PERSONA) {
    if (!String(valor('contraparte') || '').trim()) {
      return 'Indique con qué persona es esta deuda';
    }
    data.institucion = null;
  } else {
    if (!String(valor('institucion') || '').trim()) {
      return 'Indique con qué institución es esta deuda: el banco, la casa comercial, la empresa';
    }
    data.contraparte = null;
    data.contraparte_id = null;
  }
  return null;
}

/**
 * Lo que impide cerrar una deuda, o null.
 *
 * Cerrar es declarar que ya no se debe, y eso no es lo mismo que anotar que se
 * debe: lleva su propia llave. Se comprueba sobre el estado que queda después
 * de este guardado y solo cuando ESTE guardado la cierra —si ya estaba cerrada
 * y alguien le corrige una coma, no se le pide nada—.
 */
function loQueImpideCerrarla(data, { existing, user }) {
  const ahora = data.estado !== undefined ? data.estado : existing ? existing.estado : VIGENTE;
  if (!CERRADAS.includes(ahora)) return null;
  if (existing && CERRADAS.includes(existing.estado)) return null;
  if (require('../permissions').can(user, 'deudas_cerrar', 'view')) return null;
  return (
    'No tiene la llave para dar por cerrada una deuda. Puede anotarla y corregirla; declarar que ya '
    + 'no se debe la cierra, y eso se concede aparte en «Permisos».'
  );
}

module.exports = {
  name: 'deudas',
  label: 'Deudas y Compromisos',
  labelSingular: 'Deuda',
  icon: '🤝',
  group: 'Finanzas',
  order: 46,
  printable: true,
  display: '{concepto}',
  dateField: 'fecha',
  searchFields: ['concepto', 'contraparte', 'institucion', 'notas'],
  /*
   * Una deuda se recuerda por su monto, igual que un gasto. Va en
   * `buscaTambien` por lo mismo que en Tesorería: el motor pegaría el decimal
   * del número, y quien no ve los montos tampoco los busca a tientas.
   */
  buscaTambien: [{ sql: 'CAST(monto AS INTEGER)', reservado: 'tesoreria_montos' }],
  listFields: ['fecha', 'direccion', 'clase', 'concepto', 'quien', 'monto', 'falta', 'proxima', 'estado'],
  filterFields: ['direccion', 'clase', 'estado', 'cuenta_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  computed: [
    {
      /*
       * Con quién es, en una sola columna. Son dos campos en la base —una
       * persona enlazada o una institución escrita— y en el listado tienen que
       * verse como una sola cosa: quien mira una lista de deudas pregunta «¿a
       * quién?», no «¿de qué tipo es la contraparte?».
       */
      name: 'quien', label: 'Con quién', type: 'texto',
      calc: (fila) => conQuien(fila),
    },
    {
      /*
       * Lo que falta pagar, que es la pregunta que trae a alguien a esta
       * pantalla. Sale de restarle a la deuda lo que suman sus movimientos, y
       * no de una cifra guardada: una cifra guardada hay que acordarse de
       * corregirla cada vez que entra un peso, y un día no se corrige.
       */
      name: 'falta', label: 'Falta pagar', type: 'money', reservado: 'tesoreria_montos',
      calc: (fila, { db }) => require('../plan-de-cuotas').planDe(db, fila).resumen.falta,
    },
    {
      name: 'proxima', label: 'Próxima cuota', type: 'badge',
      calc: (fila, { db }) => {
        if (CERRADAS.includes(fila.estado)) return null;
        const { resumen } = require('../plan-de-cuotas').planDe(db, fila);
        if (!resumen.proxima) return null;
        const atrasadas = resumen.atrasadas;
        const cual = `${resumen.proxima.numero} de ${resumen.cuotas}`;
        return atrasadas
          ? { texto: `${cual} · atrasada`, nivel: 'vencida' }
          : { texto: `${cual} · ${require('../fechas').comoSeLee(resumen.proxima.vence || '')}`, nivel: '' };
      },
    },
  ],

  fields: [
    {
      name: 'direccion', label: 'Dirección', type: 'select', required: true, default: POR_PAGAR,
      options: DIRECCIONES, seccion: 'Qué deuda es',
      help: 'Se lee respecto de la caja de más abajo: «Por pagar» es lo que esa caja debe, y «Por '
        + 'cobrar» lo que le deben a ella.',
    },
    {
      /*
       * Sin `options` a mano: la lista sale de la ruta, que la acota según la
       * dirección. Declarar las dos cosas dejaría escrita una lista que no
       * manda —lo pilló la prueba que existe justamente para eso— y el día que
       * las dos dijeran cosas distintas nadie sabría cuál vale.
       */
      name: 'clase', label: 'Clase', type: 'select', required: true, default: CLASES[0],
      optionsRoute: '/deudas/clases?direccion={direccion}',
      help: 'Un préstamo en dinero entra a la caja; una compra a crédito no —llega la cosa y queda '
        + 'el compromiso—. Una compra a crédito solo existe hacia el lado de pagar.',
    },
    {
      name: 'concepto', label: 'Concepto', type: 'text', required: true,
      help: 'Para qué es, dicho como se dice: «Sillas para el templo», «Préstamo para la reparación del techo».',
    },
    {
      name: 'monto', label: 'Monto total', type: 'money', required: true, min: 1,
      reservado: 'tesoreria_montos', seccion: 'Cuánto y cuándo',
      help: 'Lo que se debe en total, no la cuota.',
    },
    { name: 'fecha', label: 'Fecha en que se contrajo', type: 'date', required: true },
    {
      name: 'fecha_vencimiento', label: 'Fecha comprometida de pago', type: 'date',
      // Futura por definición, y no puede caer antes de contraerse la deuda:
      // las dos reglas las aplica el motor (ver server/fechas.js)
      futuro: true, noAntesDe: 'fecha',
      help: 'Cuándo se comprometió pagarla. Si no hay plazo —«cuando se pueda»—, se deja en blanco.',
    },
    {
      name: 'cuotas', label: 'En cuántas cuotas', type: 'number', required: true, default: 1,
      min: 1, max: 120, seccion: 'El plan de pagos',
      help: 'Una sola cuota es pagarla de una vez. El sistema arma el plan mensual y lo que sobra de '
        + 'la división va a la última, para que las cuotas sumen exactamente el total.',
    },
    {
      name: 'primera_cuota', label: 'Vence la primera', type: 'date',
      // Una cuota se pacta hacia adelante: sin esto el motor la rechazaría por
      // «todavía no llega», que es la regla correcta para el libro de la plata
      // y la equivocada para un compromiso
      futuro: true,
      help: 'Desde ahí se cuentan las demás, mes a mes. Cada cuota se puede corregir después.',
    },
    {
      name: 'cuenta_id', label: 'Caja de esta deuda', type: 'ref', ref: 'cuentas_tesoreria', required: true,
      optionsRoute: '/cuentas_tesoreria/activas', seccion: 'De quién es',
      placeholder: 'Escriba el nombre de la cuenta…',
      help: 'De quién es la deuda: la caja de la corporación, la de una iglesia o la de un cuerpo. '
        + 'Es la misma caja por la que pasa o pasará su plata.',
    },
    {
      name: 'contraparte_tipo', label: 'Con quién es', type: 'select', required: true, default: UNA_PERSONA,
      options: CONTRAPARTES, seccion: 'Con quién',
    },
    {
      name: 'contraparte', label: 'Persona', type: 'persona', ref: 'miembros', buscador: true,
      showIf: { field: 'contraparte_tipo', equals: UNA_PERSONA },
      help: 'Si está en la membresía se enlaza a su ficha; si no, se escribe el nombre.',
    },
    {
      name: 'institucion', label: 'Institución', type: 'text',
      showIf: { field: 'contraparte_tipo', equals: UNA_INSTITUCION },
      help: 'El banco, la casa comercial, la empresa.',
    },
    {
      name: 'contacto', label: 'Teléfono o correo', type: 'text',
      help: 'Para poder ubicar a quien corresponde cuando haya que pagar o cobrar.',
    },
    {
      name: 'documento', label: 'Documento firmado', type: 'file', seccion: 'Respaldo',
      help: 'El pagaré, el contrato o la hoja que se firmó, escaneada o fotografiada.',
    },
    {
      name: 'inventario_id', label: 'Artículo del inventario', type: 'ref', ref: 'inventarios',
      help: 'Opcional: lo que se compró, si está inventariado. Anotar la deuda no depende de haberlo '
        + 'inventariado primero.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: VIGENTE,
      options: ESTADOS, seccion: 'Cómo está',
      help: 'Darla por Pagada o Condonada la cierra, y eso pide su propia llave.',
    },
    {
      name: 'fecha_cierre', label: 'Fecha en que se cerró', type: 'date',
      noAntesDe: 'fecha',
      showIf: { field: 'estado', in: CERRADAS },
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
    // De la caja, como en Tesorería: son los que deciden el alcance y no se
    // escriben a mano, para que no puedan contradecir a la cuenta
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma de la caja elegida. Las cajas de la corporación no pertenecen a una iglesia.',
    },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true,
      help: 'Se toma de la caja elegida, igual que la iglesia.',
    },
  ],

  hooks: {
    beforeSave(data, { user, existing, db }) {
      // La caja manda: de ella salen la iglesia y el cuerpo de esta deuda
      const cuentaId = data.cuenta_id !== undefined ? data.cuenta_id : existing ? existing.cuenta_id : null;
      if (!cuentaId) return 'Indique la caja de esta deuda';
      const cuenta = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
      if (!cuenta) return 'La caja indicada no existe';

      if (!require('../alcance').alcanzaIglesia(user, cuenta.iglesia_id)) {
        return `La caja "${cuenta.nombre}" no está entre las iglesias que administra`;
      }

      /*
       * Una caja cerrada no recibe deudas nuevas, por lo mismo que no recibe
       * movimientos: contraer una deuda a nombre de una caja que la
       * organización ya dio por terminada es anotar algo que después nadie va a
       * poder pagar desde ahí. Las suyas se siguen corrigiendo.
       */
      const cambiaDeCaja = !existing || String(existing.cuenta_id) !== String(cuentaId);
      if (cambiaDeCaja) {
        const cerrada = require('../cuenta-cerrada').avisoSiEstaCerrada(cuenta);
        if (cerrada) return cerrada;
      }

      data.iglesia_id = cuenta.iglesia_id || null;
      data.cuerpo_id = cuenta.cuerpo_id || null;

      const direccion = data.direccion !== undefined
        ? data.direccion : existing ? existing.direccion : POR_PAGAR;
      const clase = data.clase !== undefined ? data.clase : existing ? existing.clase : null;
      if (direccion === POR_COBRAR && !CLASES_POR_COBRAR.includes(clase)) {
        return `Una deuda «${POR_COBRAR}» solo puede ser un préstamo en dinero: la organización no `
          + 'vende a plazo. Cambie la clase o la dirección.';
      }

      const falta = laOtraParte(data, { existing });
      if (falta) return falta;

      const noPuedeCerrar = loQueImpideCerrarla(data, { existing, user });
      if (noPuedeCerrar) return noPuedeCerrar;

      /*
       * Al cerrarla se le pone la fecha del día si nadie la escribió: una deuda
       * cerrada sin fecha no dice cuándo se saldó, que es justo lo que se le
       * pregunta después. Y al reabrirla se suelta, para que no quede diciendo
       * que se cerró un día en que sigue viva.
       */
      const estado = data.estado !== undefined ? data.estado : existing ? existing.estado : VIGENTE;
      if (CERRADAS.includes(estado)) {
        if (!data.fecha_cierre && !(existing && existing.fecha_cierre)) {
          data.fecha_cierre = require('../fechas').hoy();
        }
      } else if (existing && CERRADAS.includes(existing.estado)) {
        data.fecha_cierre = null;
      }

      return null;
    },

    /**
     * Ya guardada: su plan de cuotas y el movimiento que le corresponde.
     *
     * El plan se arma UNA VEZ y de ahí en adelante solo se agrega o se quita al
     * final, sin tocar lo que alguien corrigió a mano (ver
     * server/plan-de-cuotas.js). El desembolso se crea, se corrige o se retira
     * con la ficha, como el egreso de una ayuda social.
     */
    afterSave(fila, { user, db }) {
      require('../plan-de-cuotas').ponerLasQueFalten(db, fila);
      require('../deuda-tesoreria').ponerElDesembolso(db, fila, user);
    },

    /**
     * Una deuda con pagos anotados no se borra.
     *
     * Sus pagos son movimientos de tesorería de verdad —plata que salió de una
     * caja— y borrarlos con la ficha sería hacer desaparecer del libro un
     * dinero que se movió. El desembolso sí se va con ella: existe solo porque
     * la deuda existe, igual que el egreso de una ayuda social.
     */
    beforeDelete(fila, { db }) {
      const pagos = require('../deuda-tesoreria').losPagosDe(db, fila.id);
      if (pagos.length) {
        return `Esta deuda tiene ${pagos.length} pago(s) anotado(s), que son movimientos de `
          + 'tesorería. Retire primero esos pagos desde su plan de cuotas: borrarla ahora haría '
          + 'desaparecer del libro una plata que sí se movió.';
      }
      const desembolso = require('../deuda-tesoreria').elDesembolsoDe(db, fila.id);
      if (desembolso) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(desembolso.id);
      db.prepare('DELETE FROM cuotas_deuda WHERE deuda_id = ?').run(fila.id);
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Las clases que se pueden elegir según la dirección. Una compra a crédito
     * no existe hacia el lado de cobrar, y ofrecerla sería ofrecer un error.
     */
    router.get('/deudas/clases', requirePerm('deudas', 'view'), (req, res) => {
      const cuales = req.query.direccion === POR_COBRAR ? CLASES_POR_COBRAR : CLASES_POR_PAGAR;
      res.json(cuales.map((c) => ({ id: c, label: c })));
    });

    /** La deuda pedida, comprobando que sea de las que esta persona alcanza. */
    const laSuya = (req, res) =>
      require('../alcance').registroSuyo(req, res, 'deudas', req.params.id, 'Esa deuda');

    /**
     * El plan de cuotas de una deuda: una fila por cuota con lo que se pactó,
     * lo que se lleva pagado y en qué está. Es lo que pinta la planilla.
     */
    router.get('/deudas/:id(\\d+)/plan', requirePerm('deudas', 'view'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;
      const plan = require('../plan-de-cuotas').planDe(db, deuda);
      const puente = require('../deuda-tesoreria');
      return res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos', {
        ...plan,
        pagos: puente.losPagosDe(db, deuda.id).map((m) => ({
          id: m.id, fecha: m.fecha, monto: m.monto, metodo: m.metodo,
          cuota_id: m.cuota_id, concepto: m.concepto,
        })),
        desembolso: puente.elDesembolsoDe(db, deuda.id),
        puede_pagar: require('../permissions').can(req.user, 'deudas', 'edit'),
      }, ['cuotas', 'resumen', 'a_cuenta', 'pagos', 'desembolso', 'monto', 'montos', 'pagado',
          'falta', 'total', 'pactado', 'proxima']));
    });

    /**
     * Anotar un pago. Deja su movimiento en la caja de la deuda, enlazado, y
     * de sumarlos sale cuánto falta.
     *
     * Pide el permiso de EDITAR la deuda y no el de cerrarla: pagar una cuota
     * es llevar la deuda al día, no darla por saldada. La llave de cerrar se
     * pide cuando alguien declara que ya no se debe.
     */
    router.post('/deudas/:id(\\d+)/pagos', requirePerm('deudas', 'edit'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;

      const monto = Math.round(Number(req.body.monto) || 0);
      if (monto <= 0) return res.status(400).json({ error: 'Indique cuánto se pagó' });
      // Un pago es un hecho, así que la fecha se revisa como la de cualquier
      // movimiento: sin `futuro`, porque no se paga mañana, se paga y se anota
      const fecha = String(req.body.fecha || require('../fechas').hoy()).slice(0, 10);
      const problema = require('../fechas').revisar({ label: 'Fecha del pago' }, fecha);
      if (problema) return res.status(400).json({ error: problema });

      const cuotaId = req.body.cuota_id ? Number(req.body.cuota_id) : null;
      if (cuotaId && !db.prepare('SELECT id FROM cuotas_deuda WHERE id = ? AND deuda_id = ?').get(cuotaId, deuda.id)) {
        return res.status(400).json({ error: 'Esa cuota no es de esta deuda' });
      }

      const cerrada = require('../cuenta-cerrada')
        .avisoSiEstaCerrada(db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(deuda.cuenta_id));
      if (cerrada) return res.status(400).json({ error: `${cerrada}, así que este pago no quedaría anotado en ninguna parte.` });

      /*
       * Y la misma pregunta que hace cualquier egreso que deja la caja en rojo.
       * Esta ruta escribe el movimiento derecho, sin pasar por el guardado de
       * Tesorería, así que la regla hay que pedirla acá: si no, pagar desde el
       * plan sería la manera de saltarse lo que el formulario frena. Es la
       * misma puerta de atrás que se cerró en el botón «Crear su ficha de
       * miembro» de Pastores.
       */
      const confirmado = req.body.igual_asi === true || req.body.igual_asi === 'true' || req.body.igual_asi === 1;
      if (!confirmado) {
        const enRojo = require('../saldos').avisoSiQuedaEnRojo(deuda.cuenta_id, {
          tipo: require('../deuda-tesoreria').losSignosDe(deuda).pago,
          monto, fecha, queEs: 'Este pago',
        });
        if (enRojo) return res.status(400).json(enRojo);
      }

      const movimiento = require('../deuda-tesoreria').anotarUnPago(db, deuda, {
        cuotaId, fecha, monto, metodo: req.body.metodo, notas: req.body.notas,
      }, req.user);
      return res.status(201).json({ ok: true, movimiento_id: movimiento.id });
    });

    /** Retirar un pago mal anotado: se va él y se va su movimiento. */
    router.delete('/deudas/:id(\\d+)/pagos/:mov(\\d+)', requirePerm('deudas', 'edit'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;
      const quitado = require('../deuda-tesoreria').retirarUnPago(db, deuda.id, Number(req.params.mov));
      if (!quitado) return res.status(404).json({ error: 'Ese pago no es de esta deuda' });
      return res.json({ ok: true });
    });
  },

  // Lo que hace falta afuera: las reglas y los rótulos, en un solo lugar
  POR_PAGAR, POR_COBRAR, DIRECCIONES, CLASES, CLASES_POR_PAGAR, CLASES_POR_COBRAR,
  UNA_PERSONA, UNA_INSTITUCION, VIGENTE, CERRADAS, ESTADOS, conQuien, enPesos,
};
