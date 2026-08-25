/**
 * Módulo: Toma de Asistencia (la marca de cada persona en una actividad).
 *
 * Este módulo manda sobre **quién puede pasar lista**: con permiso para crear
 * y editar aquí, una persona puede tomar la asistencia de una actividad
 * aunque no tenga permiso para crear actividades (eso se rige por el módulo
 * Asistencias).
 *
 * Por cada actividad de un cuerpo queda una fila por integrante, con su
 * estado —Presente, Ausente o Justificado— y, cuando está justificado, el
 * motivo. Los motivos de emergencia, de otra actividad de la iglesia y de
 * "otro motivo" piden además el detalle, para que la justificación diga algo.
 *
 * No se llena aquí una por una, sino marcando la lista en la pantalla de
 * Asistencia, así que este módulo no ocupa lugar en el menú: existe para
 * guardar las marcas y para llevar el permiso de tomarlas.
 */
const MOTIVOS_CON_DETALLE = ['Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];

module.exports = {
  name: 'asistencia_detalle',
  label: 'Toma de Asistencia',
  labelSingular: 'Marca de asistencia',
  icon: '✔️',
  group: 'Reuniones',
  order: 12,
  menu: false,
  display: '{estado}',
  searchFields: ['detalle'],
  listFields: ['asistencia_id', 'miembro_id', 'estado', 'motivo', 'detalle'],
  filterFields: ['estado', 'motivo', 'cuerpo_id'],
  /*
   * La fecha del módulo. No es una etiqueta: es lo que hace que la base cree
   * su índice sola (ver indexar() en server/db.js).
   *
   * Esta es la tabla que más crece de todo el sistema —una fila por persona y
   * por actividad—, y es sobre la que se arma el informe de asistencia, que
   * pregunta siete veces por un rango de fechas. Sin declararla, no había
   * índice por fecha y acotar el informe no servía de nada: medido con diez
   * años de datos, pedir solo el año en curso costaba 59 ms igual que pedirlo
   * todo, porque la base recorría las 124.812 marcas de todas maneras. Con el
   * índice puesto, ese mismo informe baja a 0,1 ms.
   */
  dateField: 'fecha',
  defaultSort: { field: 'id', dir: 'desc' },
  fields: [
    { name: 'asistencia_id', label: 'Actividad', type: 'ref', ref: 'asistencias', required: true },
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Presente',
      options: ['Presente', 'Ausente', 'Justificado'],
    },
    {
      name: 'motivo', label: 'Motivo de la justificación', type: 'select',
      options: ['Trabajo', 'Enfermedad', 'Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'],
      showIf: { field: 'estado', equals: 'Justificado' },
      required: true,
    },
    {
      name: 'detalle', label: 'Detalle del motivo', type: 'text',
      showIf: { field: 'motivo', in: MOTIVOS_CON_DETALLE },
      required: true,
      help: 'Obligatorio en emergencias, en otra actividad de la iglesia y en otro motivo.',
    },
    // Se copian de la actividad, para poder filtrar e informar sin cruzar tablas
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true },
    { name: 'fecha', label: 'Fecha', type: 'date', readonly: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true },
  ],

  hooks: {
    beforeSave(data, { id, existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const asistenciaId = dato('asistencia_id');
      const miembroId = dato('miembro_id');

      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(asistenciaId);
      if (!actividad) return 'La actividad indicada no existe';

      // Una sola marca por persona en cada actividad
      const repetida = db
        .prepare('SELECT id FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ? AND id != ?')
        .get(asistenciaId, miembroId, id || 0);
      if (repetida) return 'Esa persona ya tiene su marca en esta actividad';

      // Lo que no es justificación no lleva motivo ni detalle
      if (dato('estado') !== 'Justificado') {
        data.motivo = null;
        data.detalle = null;
      } else if (!MOTIVOS_CON_DETALLE.includes(dato('motivo'))) {
        data.detalle = null;
      }

      data.cuerpo_id = actividad.cuerpo_id || null;
      data.fecha = actividad.fecha || null;
      data.iglesia_id = actividad.iglesia_id || null;
      return null;
    },
  },
};

module.exports.MOTIVOS_CON_DETALLE = MOTIVOS_CON_DETALLE;
