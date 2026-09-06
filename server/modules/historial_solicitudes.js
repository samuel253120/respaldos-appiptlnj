/**
 * Módulo: Historial de Solicitudes.
 *
 * El seguimiento de cada solicitud: cuándo entró, por qué manos pasó, qué se
 * fue resolviendo. Se ve en la propia ficha de la solicitud, en su pestaña.
 *
 * Hay dos clases de anotaciones y conviene no confundirlas:
 *
 *   AUTOMÁTICAS  las escribe el sistema al ocurrir el hecho: el ingreso, cada
 *                cambio de estado, cada traslado, cada respuesta. No se
 *                escriben ni se corrigen a mano, porque son la constancia de
 *                lo que pasó (ver server/solicitudes/seguimiento.js).
 *
 *   MANUALES     las escribe quien tramita, para dejar dicho lo que el sistema
 *                no puede saber: que se llamó por teléfono, que se conversó
 *                con el pastor, que falta un papel.
 */
module.exports = {
  name: 'historial_solicitudes',
  label: 'Historial de Solicitudes',
  labelSingular: 'Anotación de la solicitud',
  icon: '🗒️',
  group: 'Atención y ayuda',
  order: 34,
  menu: false,
  display: '{tipo} — {descripcion}',
  dateField: 'fecha',
  searchFields: ['descripcion', 'tipo'],
  listFields: ['fecha', 'solicitud_id', 'tipo', 'descripcion', 'registrado_por', 'origen'],
  defaultSort: { field: 'id', dir: 'desc' },
  /**
   * Se ve exactamente donde se ve su solicitud.
   *
   * Sin esto, el alcance por cuerpo miraba a la persona que aparece dentro y
   * no al trámite del que cuelga: en una solicitud que sí se puede abrir,
   * el seguimiento quedaba acotado por una regla que no tiene nada que ver con él.
   */
  alcance: { comoSuPadre: { modulo: 'solicitudes', campo: 'solicitud_id' } },

  fields: [
    { name: 'solicitud_id', label: 'Solicitud', type: 'ref', ref: 'solicitudes', required: true },
    // No va marcada como obligatoria: el sistema la pone sola si viene en
    // blanco. Marcarla lo haría al revés —la comprobación de obligatorios
    // corre ANTES del gancho que la rellena—, y una anotación se rechazaría
    // por no traer una fecha que el sistema iba a poner de todos modos.
    { name: 'fecha', label: 'Fecha', type: 'date' },
    {
      name: 'tipo', label: 'Tipo de anotación', type: 'select', required: true, default: 'Gestión',
      options: [
        'Ingreso', 'Gestión', 'Cambio de estado', 'Traslado', 'Respuesta',
        'Documento', 'Contacto con el solicitante', 'Otro',
      ],
    },
    { name: 'descripcion', label: 'Qué pasó', type: 'textarea', required: true },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Las automáticas las escribe el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la solicitud.' },
    // Lo que decía antes una anotación que el sistema escribió y alguien
    // corrigió. Los otros tres historiales ya los tenían; a éste le faltaban,
    // que es por lo que su única respuesta posible era negarse (hallazgo SA-05).
    ...require('../lo-que-decia-el-sistema').CAMPOS,
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing, db }) {
      const solicitudId = data.solicitud_id !== undefined ? data.solicitud_id : existing ? existing.solicitud_id : null;
      if (solicitudId) {
        const s = db.prepare('SELECT iglesia_id FROM solicitudes WHERE id = ?').get(solicitudId);
        if (s && s.iglesia_id) data.iglesia_id = s.iglesia_id;
      }
      if (isNew) {
        // Lo que se escribe desde la pantalla es siempre manual: el «Automático»
        // lo pone el sistema por dentro, y dejarlo elegir permitiría disfrazar
        // una anotación de constancia del sistema.
        data.origen = 'Manual';
        data.registrado_por = user.nombre;
        if (!data.fecha) data.fecha = require('../fechas').hoy();
      }
      /*
       * Y si le están corrigiendo el texto a una que escribió el sistema, queda
       * escrito lo que decía y quién la corrigió.
       *
       * Hasta la v1.433.0 este módulo era el único de los cuatro que se NEGABA a
       * corregirlas, y los otros tres lo permitían guardando el original. Las
       * dos posturas eran defendibles y la diferencia no estaba decidida en
       * ninguna parte: dependía de en qué pestaña estuviera parado quien
       * preguntara. La regla quedó una sola —se corrige dejando dicho lo que
       * decía, y no se elimina— y vive entera en el archivo compartido, con las
       * razones de las dos mitades.
       */
      require('../lo-que-decia-el-sistema').guardarLoQueDecia(data, { existing, user });
      return null;
    },
    /** Y no se elimina: la regla entera está en server/lo-que-decia-el-sistema.js */
    beforeDelete(fila) {
      return require('../lo-que-decia-el-sistema').noSeElimina(fila);
    },
  },
};
