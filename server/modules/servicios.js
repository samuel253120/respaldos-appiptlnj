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
 * Ofrenda: del total recibido se aparta solo el porcentaje definido en
 * Configuración → Organización (10% por defecto), que va a otro fondo de
 * tesorería, y el resto queda para la iglesia local.
 */
const { LIBROS, cita } = require('../biblia');

module.exports = {
  name: 'servicios',
  label: 'Registro de Servicios',
  labelSingular: 'Servicio',
  icon: '🕊️',
  group: 'Servicios',
  order: 15,
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
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    {
      name: 'tipo', label: 'Tipo de servicio', type: 'select', default: 'Culto general',
      options: ['Culto general', 'Escuela Dominical', 'Culto de oración', 'Ayuno', 'Estudio bíblico', 'Vigilia', 'Evangelismo', 'Servicio especial', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },

    // ---- Coordinación ----
    {
      name: 'coordinador', label: 'Coordinador(a)', type: 'persona', ref: 'miembros',
      help: 'Elíjalo de la lista de miembros o escriba el nombre si no está registrado.',
    },

    // ---- Salmo (devocional) ----
    {
      name: 'salmista', label: 'Salmista (quien leyó el salmo)', type: 'persona', ref: 'miembros',
      help: 'Elíjalo de la lista de miembros o escriba el nombre si no está registrado.',
    },
    { name: 'salmo_libro', label: 'Salmo: libro', type: 'select', options: LIBROS },
    { name: 'salmo_capitulo', label: 'Salmo: capítulo', type: 'number' },
    { name: 'salmo_versiculo_inicial', label: 'Salmo: versículo inicial', type: 'number' },
    { name: 'salmo_versiculo_final', label: 'Salmo: versículo final', type: 'number' },

    // ---- Mensaje ----
    {
      name: 'predicador', label: 'Predicador(a)', type: 'persona', ref: 'miembros',
      help: 'Elíjalo de la lista de miembros o escriba el nombre si no está registrado.',
    },
    { name: 'mensaje_titulo', label: 'Tema del mensaje', type: 'text' },
    { name: 'mensaje_libro', label: 'Mensaje: libro', type: 'select', options: LIBROS },
    { name: 'mensaje_capitulo', label: 'Mensaje: capítulo', type: 'number' },
    { name: 'mensaje_versiculo_inicial', label: 'Mensaje: versículo inicial', type: 'number' },
    { name: 'mensaje_versiculo_final', label: 'Mensaje: versículo final', type: 'number' },

    // ---- Asistencia ----
    { name: 'asistencia_adultos', label: 'Asistencia de adultos', type: 'number' },
    { name: 'asistencia_ninos', label: 'Asistencia de niños', type: 'number' },
    {
      name: 'asistencia_total', label: 'Total general de asistencia', type: 'number', readonly: true,
      calcula: { tipo: 'suma', campos: ['asistencia_adultos', 'asistencia_ninos'] },
      help: 'Se suma solo: adultos más niños.',
    },

    // ---- Ofrenda ----
    { name: 'ofrenda_total', label: 'Ofrenda recibida (total)', type: 'money' },
    {
      name: 'ofrenda_fondo', label: 'Aparte para el fondo', type: 'money', readonly: true,
      calcula: { tipo: 'porcentaje', campo: 'ofrenda_total', opcion: 'ofrenda_porcentaje_fondo' },
      help: 'Se calcula solo, con el porcentaje definido en Configuración → Organización. Va al otro fondo de tesorería.',
    },
    {
      name: 'ofrenda_iglesia', label: 'Queda para la iglesia', type: 'money', readonly: true,
      calcula: { tipo: 'resta', campos: ['ofrenda_total', 'ofrenda_fondo'] },
      help: 'Total de la ofrenda menos lo que se aparta para el fondo.',
    },

    // ---- Cierre ----
    { name: 'hora_termino', label: 'Hora de término', type: 'time' },
    { name: 'observaciones', label: 'Observaciones generales', type: 'textarea' },
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
  },
};
