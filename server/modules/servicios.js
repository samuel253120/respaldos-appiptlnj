/**
 * Módulo: Registro de Servicios (cultos).
 *
 * Deja constancia de cada servicio realizado en la iglesia: a qué hora
 * empezó y terminó, quién coordinó, quién leyó el salmo y cuál, quién
 * predicó y sobre qué pasaje, cuánta gente asistió y cuánto se ofrendó.
 *
 * Personas: coordinador, salmista y predicador son campos de tipo "persona".
 * Se buscan entre los miembros registrados, pero también se puede escribir
 * el nombre de alguien que no está en el registro (un visitante, un
 * predicador invitado). Cuando la persona sí es miembro, queda enlazada a
 * su ficha.
 *
 * Ofrenda: entra completa a la tesorería de la iglesia y de ahí sale el
 * aporte para la corporación —el porcentaje definido en Configuración →
 * Organización, 10% por defecto—. Si la opción «Registrar la ofrenda en
 * tesorería» está activa, el servicio deja tres movimientos: el ingreso de
 * la ofrenda completa en la cuenta general de la iglesia, el egreso del
 * aporte de esa misma cuenta y el ingreso del aporte en su «Fondo para la
 * corporación». Se explica en server/ofrenda-tesoreria.js. Los tres se
 * mantienen al día con el servicio: si se corrige la ofrenda se corrigen, y
 * si se elimina el servicio se van con él.
 */
const { LIBROS, cita } = require('../biblia');
const { sincronizarOfrenda } = require('../ofrenda-tesoreria');

/** Los servicios que celebra la iglesia. */
const TIPOS_DE_SERVICIO = [
  'Servicio General',
  'Clase de Dorcas',
  'Servicio Especial',
  'Servicio Vigilia',
  'Otro',
];

module.exports = {
  name: 'servicios',
  label: 'Registro de Servicios',
  labelSingular: 'Servicio',
  icon: '🕊️',
  group: 'Reuniones',
  order: 11,
  display: '{fecha} — {tipo}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['coordinador', 'salmista', 'predicador', 'observaciones'],
  listFields: ['fecha', 'hora_inicio', 'tipo', 'predicador', 'cita_mensaje', 'asistencia_total', 'ofrenda_total'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  // Citas armadas al leer, para verlas de un vistazo en el listado y al imprimir
  computed: [
    {
      name: 'cita_salmo', label: 'Salmo leído', type: 'texto',
      calc: (r) => cita(r.salmo_libro, r.salmo_capitulo, r.salmo_versiculo_inicial, r.salmo_versiculo_final),
    },
    {
      name: 'cita_mensaje', label: 'Pasaje del mensaje', type: 'texto',
      calc: (r) => cita(r.mensaje_libro, r.mensaje_capitulo, r.mensaje_versiculo_inicial, r.mensaje_versiculo_final),
    },
  ],

  fields: [
    // Un servicio se agenda antes de celebrarse: admite fecha adelante.
    { name: 'fecha', label: 'Fecha', type: 'date', required: true, futuro: true, seccion: 'Fecha y hora' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    {
      name: 'tipo', label: 'Tipo de servicio', type: 'select', default: TIPOS_DE_SERVICIO[0],
      options: TIPOS_DE_SERVICIO,
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },

    // ---- Coordinación ----
    {
      name: 'coordinador', label: 'Coordinador(a)', type: 'persona', ref: 'miembros', buscador: true,
      seccion: 'Coordinador',
      help: 'Búsquelo entre los miembros o escriba el nombre si no está registrado.',
    },

    // ---- Salmo (devocional) ----
    {
      name: 'salmista', label: 'Salmista (quien leyó el salmo)', type: 'persona', ref: 'miembros', buscador: true,
      seccion: 'Salmista',
      help: 'Búsquelo entre los miembros o escriba el nombre si no está registrado.',
    },
    {
      name: 'salmo_libro', label: 'Salmo: libro', type: 'select', options: LIBROS, buscador: true,
      seccion: 'Lectura del salmo', ancho: 'completo', help: 'Escriba las primeras letras del libro.',
    },
    { name: 'salmo_capitulo', label: 'Salmo: capítulo', type: 'number' },
    { name: 'salmo_versiculo_inicial', label: 'Salmo: versículo inicial', type: 'number' },
    { name: 'salmo_versiculo_final', label: 'Salmo: versículo final', type: 'number' },

    // ---- Mensaje ----
    {
      name: 'predicador', label: 'Predicador(a)', type: 'persona', ref: 'miembros', buscador: true,
      seccion: 'Predicador',
      help: 'Búsquelo entre los miembros o escriba el nombre si no está registrado.',
    },
    /*
     * Acá iba «Tema del mensaje», un texto libre. Se sacó porque la iglesia no
     * lo usa: el registro del servicio dice quién predicó y sobre qué pasaje, y
     * el tema no se anotaba nunca.
     *
     * La columna sigue en la base con lo que hubiera guardado —el motor agrega
     * columnas y no las quita, y acá no se borra nada—: si algún día vuelve a
     * hacer falta, se declara de nuevo el campo y lo escrito reaparece.
     *
     * La sección «Mensaje bíblico» la abre ahora el libro, que era lo que hacía
     * el campo que se fue.
     */
    {
      name: 'mensaje_libro', label: 'Mensaje: libro', type: 'select', options: LIBROS, buscador: true,
      seccion: 'Mensaje bíblico', ancho: 'completo', help: 'Escriba las primeras letras del libro.',
    },
    { name: 'mensaje_capitulo', label: 'Mensaje: capítulo', type: 'number' },
    { name: 'mensaje_versiculo_inicial', label: 'Mensaje: versículo inicial', type: 'number' },
    { name: 'mensaje_versiculo_final', label: 'Mensaje: versículo final', type: 'number' },

    // ---- Asistencia ----
    { name: 'asistencia_adultos', label: 'Asistencia de adultos', type: 'number', seccion: 'Asistencia' },
    { name: 'asistencia_ninos', label: 'Asistencia de niños', type: 'number' },
    {
      name: 'asistencia_total', label: 'Total general de asistencia', type: 'number', readonly: true,
      calcula: { tipo: 'suma', campos: ['asistencia_adultos', 'asistencia_ninos'] },
      help: 'Se suma solo: adultos más niños.',
    },

    // ---- Ofrenda ----
    {
      name: 'ofrenda_total', label: 'Ofrenda recibida (total)', type: 'money', seccion: 'Ofrenda',
      help: 'Todo lo que se recibió. Entra completo a la tesorería de la iglesia.', min: 0,
    },
    {
      name: 'ofrenda_fondo', label: 'Aporte a la corporación', type: 'money', readonly: true,
      calcula: { tipo: 'porcentaje', campo: 'ofrenda_total', opcion: 'ofrenda_porcentaje_fondo' },
      help:
        'Se calcula solo, con el porcentaje definido en Configuración → Organización. En Tesorería sale como ' +
        'egreso de la cuenta de la iglesia y entra al «Fondo para la corporación».',
    },
    {
      name: 'ofrenda_iglesia', label: 'Queda para la iglesia', type: 'money', readonly: true,
      calcula: { tipo: 'resta', campos: ['ofrenda_total', 'ofrenda_fondo'] },
      help: 'Total de la ofrenda menos el aporte a la corporación. Es lo que le queda a la cuenta de la iglesia.',
    },

    // ---- Cierre ----
    { name: 'hora_termino', label: 'Hora de término', type: 'time', seccion: 'Cierre' },
    { name: 'observaciones', label: 'Observaciones generales', type: 'textarea' },

    // Los tres movimientos que la ofrenda de este servicio dejó en Tesorería
    { name: 'movimiento_iglesia_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_aporte_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_fondo_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing }) {
      const dato = (nombre) => (data[nombre] !== undefined ? data[nombre] : existing ? existing[nombre] : null);
      const inicio = dato('hora_inicio');
      const termino = dato('hora_termino');
      if (inicio && termino && termino < inicio) {
        return 'La hora de término no puede ser anterior a la hora de inicio';
      }
      for (const pasaje of ['salmo', 'mensaje']) {
        const desde = Number(dato(`${pasaje}_versiculo_inicial`));
        const hasta = Number(dato(`${pasaje}_versiculo_final`));
        if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta && desde && hasta < desde) {
          return `En ${pasaje === 'salmo' ? 'el salmo' : 'el mensaje'}, el versículo final no puede ser anterior al inicial`;
        }
      }
      return null;
    },

    /**
     * Deja la tesorería calzando con la ofrenda de este servicio. Cómo se
     * anota —y por qué en tres movimientos— está en ofrenda-tesoreria.js.
     */
    afterSave(fila, { db }) {
      sincronizarOfrenda(fila, db);
    },

    beforeDelete(fila, { db }) {
      // La ofrenda de un servicio que se elimina no puede quedar en tesorería
      db.prepare('DELETE FROM tesoreria WHERE servicio_id = ?').run(fila.id);
      return null;
    },
  },
};
