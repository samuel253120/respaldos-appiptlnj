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
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing, db }) {
      // Lo que anotó el sistema tampoco se edita: si se pudiera corregir el
      // texto de «pasó de Pendiente a Aprobada», el historial dejaría de ser
      // constancia de nada.
      if (!isNew && existing && existing.origen === 'Automático') {
        return 'Esa anotación la dejó el sistema al ocurrir el hecho: no se modifica. Escriba una anotación nueva.';
      }
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
        if (!data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      }
      return null;
    },
    /** Lo que el sistema anotó no se corrige ni se borra: es la constancia. */
    beforeDelete(fila) {
      if (fila.origen === 'Automático') {
        return 'Esa anotación la dejó el sistema al ocurrir el hecho: es la constancia de lo que pasó y no se elimina.';
      }
      return null;
    },
  },
};
