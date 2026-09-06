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
  /**
   * Se ve exactamente donde se ve SU PASTOR, no donde se archivó el papel.
   *
   * Antes lo decidía la columna `iglesia_id` de cada fila, heredada de la ficha
   * del pastor el día que se guardó. Y cuando el pastor se traslada, nada la
   * mueve: los papeles se quedan apuntando a la congregación anterior. Peor
   * todavía, el gancho la recalculaba en CADA guardado, así que el papel al que
   * alguien le corrigiera una coma se mudaba y los que nadie tocó se quedaban.
   *
   * MEDIDO en la v1.429.0, trasladando un pastor del Norte al Sur con tres
   * papeles y ocho líneas de historial, y corrigiéndole después la observación
   * a uno solo:
   *
   *   la secretaria del NORTE  ·  su ficha: NO la ve
   *                               su carpeta: 2 de 3   ·  su historial: 7 de 8
   *   la secretaria del SUR    ·  su ficha: la ve
   *                               su carpeta: 1 de 3   ·  su historial: 1 de 8
   *
   * La congregación que ya no lo tiene seguía viendo sus antecedentes y su
   * ordenación; la que sí, un papel. Y el reparto dependía de a cuál se le tocó
   * una observación (hallazgo SA-02).
   *
   * No se arregla moviendo filas: se arregla preguntándole a la ficha del
   * pastor, que es el mecanismo que este sistema ya tiene y que usan los otros
   * cinco satélites. Lo que quede en `iglesia_id` pasa a ser un dato de archivo
   * —en qué congregación estaba el día que se guardó— y no una llave.
   */
  alcance: { comoSuPadre: { modulo: 'pastores', campo: 'pastor_id' } },

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
      /*
       * La iglesia sale del pastor, y SOLO cuando corresponde ponerla.
       *
       * Al crear, siempre. Al corregir uno guardado, no: la columna dice en qué
       * congregación estaba el pastor el día que se archivó el papel, y
       * recalcularla en cada guardado hacía que arreglarle una coma a la
       * observación de un papel de un pastor trasladado lo mudara de iglesia y
       * partiera su carpeta en dos (hallazgo SA-02). Las dos excepciones son
       * cuando el papel cambia de dueño —entonces se archiva en la carpeta del
       * nuevo— y cuando viene sin iglesia, de una importación o de antes: ahí se
       * aprovecha el guardado para dejarlo completo. Es la misma salvedad que
       * tiene la carpeta de un miembro desde la v1.191.0.
       */
      const pastorId = data.pastor_id !== undefined ? data.pastor_id : existing ? existing.pastor_id : null;
      const cambiaDeDueno = !existing
        || (data.pastor_id !== undefined && Number(data.pastor_id) !== Number(existing.pastor_id));
      if (pastorId && (cambiaDeDueno || !existing.iglesia_id)) {
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
    /** Y no se elimina: la regla entera está en server/lo-que-decia-el-sistema.js */
    beforeDelete(fila) {
      return require('../lo-que-decia-el-sistema').noSeElimina(fila);
    },
  },
};
