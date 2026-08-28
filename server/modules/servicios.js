/**
 * Módulo: Registro de Servicios (cultos).
 *
 * Deja constancia de cada servicio realizado en la iglesia: a qué hora
 * empezó y terminó, quién coordinó, quién leyó el salmo y cuál, quién
 * predicó y sobre qué pasaje, cuánta gente asistió y cuánto se ofrendó.
 *
 * Horario: un servicio puede cruzar la medianoche —una vigilia empieza a las
 * diez de la noche y termina de madrugada—, y por eso una hora de término
 * anterior a la de inicio se entiende como del día siguiente y no como un
 * error. La hoja impresa lo dice entero: «22:00 a 02:30 del día siguiente».
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

/*
 * El horario de un servicio, sabiendo que hay servicios que cruzan la
 * medianoche.
 *
 * «Servicio Vigilia» es uno de los tipos que este mismo módulo ofrece, y una
 * vigilia empieza a las diez de la noche y termina de madrugada. Así que una
 * hora de término anterior a la de inicio no es un error: es el día siguiente.
 */
const MINUTOS_DE_UN_DIA = 24 * 60;

/** Las horas se guardan como «HH:MM», pero de una importación pueden venir con segundos. */
function hhmm(hora) {
  const partes = /^(\d{1,2}):(\d{2})/.exec(String(hora == null ? '' : hora).trim());
  if (!partes) return '';
  const h = Number(partes[1]);
  const m = Number(partes[2]);
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return '';
  return `${String(h).padStart(2, '0')}:${partes[2]}`;
}

const enMinutos = (hora) => {
  const texto = hhmm(hora);
  return texto ? Number(texto.slice(0, 2)) * 60 + Number(texto.slice(3)) : null;
};

/** Si el término es anterior al inicio, el servicio terminó al día siguiente. */
function terminaAlDiaSiguiente(inicio, termino) {
  const a = enMinutos(inicio);
  const b = enMinutos(termino);
  return a !== null && b !== null && b < a;
}

/** Cuánto duró, en minutos, contando el cruce de la medianoche. */
function cuantoDuro(inicio, termino) {
  const a = enMinutos(inicio);
  const b = enMinutos(termino);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + MINUTOS_DE_UN_DIA - a;
}

/** «22:00 a 02:30 del día siguiente», que es como se dice. */
function horarioEnPalabras(inicio, termino) {
  const desde = hhmm(inicio);
  const hasta = hhmm(termino);
  if (!desde && !hasta) return '';
  if (!hasta) return desde;
  if (!desde) return `hasta las ${hasta}`;
  return `${desde} a ${hasta}${terminaAlDiaSiguiente(inicio, termino) ? ' del día siguiente' : ''}`;
}

/** «4 horas y 30 minutos», para decirlo en un aviso. */
function duracionEnPalabras(minutos) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  const enHoras = horas === 1 ? '1 hora' : `${horas} horas`;
  const enMinutosSueltos = resto === 1 ? '1 minuto' : `${resto} minutos`;
  if (!horas) return enMinutosSueltos;
  return resto ? `${enHoras} y ${enMinutosSueltos}` : enHoras;
}

/**
 * Más que esto y se pregunta. No es un tope: es el largo a partir del cual lo
 * más probable es que la hora esté mal escrita y no que el servicio haya
 * durado eso. Una vigilia de las diez de la noche a las ocho de la mañana dura
 * diez horas y pasa sin que nadie tenga que confirmar nada.
 */
const HORAS_QUE_YA_SON_MUCHAS = 12;

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
    /*
     * El horario va armado y no como dos horas sueltas: «22:00 a 02:30», en la
     * hoja impresa, se lee como un error de tipeo si no se dice de qué día es
     * cada una.
     *
     * No va en el listado, y se probó: la frase entera parte en cuatro líneas
     * la fila de cada vigilia y en dos la de todos los demás servicios, porque
     * la columna es angosta. El listado sigue mostrando la hora de inicio, que
     * es la que se busca de un vistazo, y el horario completo se ve donde hay
     * espacio para leerlo.
     */
    {
      name: 'horario', label: 'Horario', type: 'texto',
      calc: (r) => horarioEnPalabras(r.hora_inicio, r.hora_termino),
    },
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
    /*
     * El porcentaje con que se calculó queda GUARDADO en el servicio.
     *
     * Antes no: el aporte se recalculaba en cada guardado con el porcentaje que
     * rigiera ese día. Medido en la revisión del módulo: un servicio de marzo de
     * $200.000 con el 10% tenía $20.000 de aporte; se cambió el ajuste al 20% y
     * bastó con corregirle la HORA DE INICIO para que el aporte pasara a $40.000
     * y los movimientos de tesorería de un mes cerrado se reescribieran solos.
     *
     * Lo que se aportó entonces es un hecho. Se anota con el servicio, se ve, y
     * se cambia a mano cuando de verdad hay que cambiarlo.
     */
    {
      name: 'ofrenda_porcentaje', label: 'Porcentaje del aporte (%)', type: 'number', min: 0, max: 100,
      help:
        'El que rige al registrar el servicio, tomado de Configuración → Organización. Queda guardado acá: '
        + 'si mañana la organización cambia el porcentaje, este servicio conserva el suyo. Cámbielo solo si '
        + 'este servicio en particular aportó otro.',
    },
    {
      name: 'ofrenda_fondo', label: 'Aporte a la corporación', type: 'money', readonly: true,
      calcula: {
        tipo: 'porcentaje', campo: 'ofrenda_total',
        porcentajeCampo: 'ofrenda_porcentaje', opcion: 'ofrenda_porcentaje_fondo',
      },
      help:
        'Se calcula solo, con el porcentaje de acá arriba. En Tesorería sale como egreso de la cuenta de la ' +
        'iglesia y entra al «Fondo para la corporación».',
    },
    {
      name: 'ofrenda_iglesia', label: 'Queda para la iglesia', type: 'money', readonly: true,
      calcula: { tipo: 'resta', campos: ['ofrenda_total', 'ofrenda_fondo'] },
      help: 'Total de la ofrenda menos el aporte a la corporación. Es lo que le queda a la cuenta de la iglesia.',
    },

    // ---- Cierre ----
    {
      name: 'hora_termino', label: 'Hora de término', type: 'time', seccion: 'Cierre',
      help: 'Si el servicio terminó de madrugada —una vigilia—, anótela igual: se entiende que fue del día siguiente.',
    },
    { name: 'observaciones', label: 'Observaciones generales', type: 'textarea' },

    // Los tres movimientos que la ofrenda de este servicio dejó en Tesorería
    { name: 'movimiento_iglesia_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_aporte_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_fondo_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing, confirmado }) {
      const dato = (nombre) => (data[nombre] !== undefined ? data[nombre] : existing ? existing[nombre] : null);

      /*
       * Un servicio que todavía no tiene porcentaje se queda con el que rige
       * hoy. De ahí en adelante es suyo: cambiar el ajuste de la organización no
       * le toca lo que ya aportó.
       *
       * Va acá y no como `default` del campo porque el valor no es fijo: sale de
       * Configuración, y un `default` se escribe una vez en la declaración.
       */
      const suPorcentaje = dato('ofrenda_porcentaje');
      if (suPorcentaje === null || suPorcentaje === undefined || suPorcentaje === '') {
        data.ofrenda_porcentaje = require('../ajustes').numero('ofrenda_porcentaje_fondo', 0, 100);
      }
      /*
       * Acá se rechazaba todo servicio cuya hora de término fuera anterior a
       * la de inicio, comparando las dos como si fueran del mismo día. Con eso
       * una vigilia —22:00 a 02:30— no se podía registrar, y quien la
       * registraba tenía tres salidas y las tres malas: dejar la hora en
       * blanco, inventar una, o no anotar el servicio.
       *
       * Ahora un término anterior al inicio se entiende como del día
       * siguiente, que es lo que efectivamente pasó. El error de tipeo que la
       * regla quería atajar se sigue atajando, por el otro lado: si el
       * servicio sale durando más de doce horas se pregunta antes de guardar,
       * y quien sabe que duró eso lo confirma.
       */
      const inicio = dato('hora_inicio');
      const termino = dato('hora_termino');
      const duro = cuantoDuro(inicio, termino);
      if (duro !== null && duro > HORAS_QUE_YA_SON_MUCHAS * 60 && !confirmado) {
        return {
          error:
            `Este servicio queda durando ${duracionEnPalabras(duro)}: de las ${hhmm(inicio)} a las `
            + `${hhmm(termino)}${terminaAlDiaSiguiente(inicio, termino) ? ' del día siguiente' : ''}. `
            + 'Si la hora está mal escrita, corríjala; si el servicio de verdad duró eso, confirme.',
          confirmar: 'el_servicio_duro_muchas_horas',
        };
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
