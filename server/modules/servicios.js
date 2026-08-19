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
 * Configuración → Organización (10% por defecto) y el resto queda para la
 * iglesia local. Si la opción «Registrar la ofrenda en tesorería» está
 * activa, el servicio anota solo esos dos ingresos: el porcentaje apartado
 * en el «Fondo para la corporación» de esa iglesia y el resto en su
 * tesorería general. Los dos movimientos se mantienen al día con el
 * servicio: si se corrige la ofrenda se corrigen, y si se elimina el
 * servicio se van con él.
 */
const { LIBROS, cita } = require('../biblia');
const { fechaLarga } = require('../formato');

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

    // Los dos ingresos que la ofrenda de este servicio dejó en Tesorería
    { name: 'movimiento_iglesia_id', type: 'number', oculto: true, readonly: true },
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
     * Deja en Tesorería los dos ingresos de la ofrenda: lo apartado para la
     * corporación en el fondo de esa iglesia, y el resto en su tesorería
     * general. Se crean, se corrigen o se borran según lo que diga el
     * servicio, para que la tesorería siempre calce con lo registrado.
     */
    afterSave(fila, { db }) {
      const ajustes = require('../ajustes');
      const registrar = ajustes.activo('ofrenda_registra_tesoreria');

      const descripcion = `Ofrenda de ${(fila.tipo || 'servicio').toLowerCase()} del ${fechaLarga(fila.fecha)}`;
      const cuentaDe = (tipo) =>
        db.prepare('SELECT * FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = ?').get(fila.iglesia_id, tipo);

      const lados = [
        {
          columna: 'movimiento_iglesia_id',
          monto: Number(fila.ofrenda_iglesia) || 0,
          cuenta: cuentaDe('General'),
          concepto: descripcion,
        },
        {
          columna: 'movimiento_fondo_id',
          monto: Number(fila.ofrenda_fondo) || 0,
          cuenta: cuentaDe('Fondo para la corporación'),
          concepto: `Aparte para la corporación — ${descripcion.toLowerCase()}`,
        },
      ];

      for (const lado of lados) {
        const guardado = fila[lado.columna]
          ? db.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila[lado.columna])
          : null;

        // Sin ofrenda, sin cuenta donde anotarla o con el registro apagado:
        // no queda movimiento (y se retira el que hubiera).
        if (!registrar || !lado.cuenta || lado.monto <= 0) {
          if (guardado) {
            db.prepare('DELETE FROM tesoreria WHERE id = ?').run(guardado.id);
            db.prepare(`UPDATE servicios SET "${lado.columna}" = NULL WHERE id = ?`).run(fila.id);
          }
          continue;
        }

        if (guardado) {
          db.prepare(
            `UPDATE tesoreria
                SET fecha = ?, tipo = 'Ingreso', categoria = 'Ofrendas', concepto = ?, monto = ?,
                    cuenta_id = ?, iglesia_id = ?, updated_at = datetime('now','localtime')
              WHERE id = ?`
          ).run(fila.fecha, lado.concepto, lado.monto, lado.cuenta.id, fila.iglesia_id, guardado.id);
        } else {
          const info = db
            .prepare(
              `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                                      iglesia_id, notas, servicio_id)
               VALUES (?, 'Ingreso', 'Ofrendas', ?, ?, 'Efectivo', ?, ?, ?, ?)`
            )
            .run(
              fila.fecha, lado.concepto, lado.monto, lado.cuenta.id, fila.iglesia_id,
              'Movimiento generado por el Registro de Servicios.', fila.id
            );
          db.prepare(`UPDATE servicios SET "${lado.columna}" = ? WHERE id = ?`).run(info.lastInsertRowid, fila.id);
        }
      }
    },

    beforeDelete(fila, { db }) {
      // La ofrenda de un servicio que se elimina no puede quedar en tesorería
      db.prepare('DELETE FROM tesoreria WHERE servicio_id = ?').run(fila.id);
      return null;
    },
  },
};
