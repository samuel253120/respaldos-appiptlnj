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
  listFields: ['fecha', 'direccion', 'clase', 'concepto', 'quien', 'monto', 'cuenta_id', 'estado'],
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
  },

  // Lo que hace falta afuera: las reglas y los rótulos, en un solo lugar
  POR_PAGAR, POR_COBRAR, DIRECCIONES, CLASES, CLASES_POR_PAGAR, CLASES_POR_COBRAR,
  UNA_PERSONA, UNA_INSTITUCION, VIGENTE, CERRADAS, ESTADOS, conQuien, enPesos,
};
