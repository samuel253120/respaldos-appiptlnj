/**
 * Módulo: Historial del Pastor / Guía.
 *
 * El recorrido ministerial de cada persona: su ordenación, los ascensos de
 * cargo, los nombramientos, los traslados de una iglesia a otra, las
 * licencias y lo que se quiera dejar anotado.
 *
 * Los registros automáticos los genera server/bitacora.js —en especial los
 * cambios de cargo y de iglesia—; los manuales se escriben desde su ficha.
 */
module.exports = {
  name: 'historial_pastores',
  label: 'Historial de Pastores',
  labelSingular: 'Registro del historial',
  icon: '🗒️',
  group: 'Organización',
  order: 57,
  menu: false,
  display: '{tipo} — {descripcion}',
  dateField: 'fecha',
  searchFields: ['descripcion', 'tipo'],
  listFields: ['fecha', 'pastor_id', 'tipo', 'descripcion', 'origen'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'pastor_id', label: 'Pastor / Guía', type: 'ref', ref: 'pastores', required: true },
        /*
     * NO va marcada como obligatoria: el sistema la pone sola si viene en
     * blanco, unas líneas más abajo. Marcarla lo hace al revés —la
     * comprobación de obligatorios del motor corre ANTES del gancho que la
     * rellena (server/crud.js)— y entonces el relleno no se ejecuta nunca: la
     * anotación se rechaza por no traer una fecha que el sistema tenía puesta
     * para ponerle.
     *
     * MEDIDO en la v1.429.0, la misma anotación sin fecha por las tres puertas:
     * el historial de una solicitud contestaba 201 y la ponía en el día de hoy;
     * éste y el del pastor contestaban 400, «El campo "Fecha" es obligatorio».
     * El razonamiento estaba escrito hace tiempo en historial_solicitudes.js,
     * que es el único de los tres que no cayó en la trampa (hallazgo SA-01).
     */
    { name: 'fecha', label: 'Fecha', type: 'date' },
    {
      name: 'tipo', label: 'Tipo de registro', type: 'select', required: true, default: 'Anotación',
      options: [
        'Anotación', 'Ordenación', 'Cambio de cargo', 'Nombramiento', 'Traslado de iglesia',
        'Licencia', 'Reconocimiento', 'Disciplina', 'Capacitación', 'Cambio de datos',
        'Documento', 'Otro',
      ],
    },
    {
      name: 'descripcion', label: 'Descripción', type: 'textarea', required: true,
      /*
       * Por lo mismo que en la bitácora de un miembro: la descripción de un
       * cambio de datos copia lo que decía la ficha del pastor, con su RUT, su
       * teléfono y su dirección, que en su propia pantalla tienen llave
       * (ver server/sensibles.js).
       */
      copiaDe: 'pastores',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la ficha del pastor.' },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Los registros automáticos los genera el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    ...require('../lo-que-decia-el-sistema').CAMPOS,
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing, db }) {
      const pastorId = data.pastor_id !== undefined ? data.pastor_id : existing ? existing.pastor_id : null;
      if (pastorId) {
        const pastor = db.prepare('SELECT iglesia_id FROM pastores WHERE id = ?').get(pastorId);
        if (pastor && pastor.iglesia_id) data.iglesia_id = pastor.iglesia_id;
      }
      if (isNew) {
        data.origen = data.origen || 'Manual';
        data.registrado_por = user.nombre;
        if (!data.fecha) data.fecha = require('../fechas').hoy();
      }
      // Corregir a mano lo que anotó el sistema deja constancia de lo que decía
      require('../lo-que-decia-el-sistema').guardarLoQueDecia(data, { existing, user });
      return null;
    },
  },
};
