/**
 * Los tipos de documento que se guardan de un pastor o guía, en el orden en
 * que los pide la iglesia: primero los que acreditan quién es y que está en
 * condiciones de servir, después su matrimonio, y al final su nombramiento y
 * su renuncia. «Otro Documento» es el cajón para lo que no calce en ninguno.
 *
 * Esta es la lista de verdad: la migración que ordena los tipos guardados la
 * toma de acá, para que no haya dos versiones de lo mismo.
 */
const TIPOS_DE_DOCUMENTO = [
  'Carnet de Identidad',
  'Certificado de Antecedentes',
  'Certificado de Inhabilidades',
  'Certificado de Matrimonio Civil',
  'Certificado de Matrimonio Iglesia',
  'Certificado de Nombramiento (Ordenacion)',
  'Carta de Renuncia',
  'Otro Documento',
];


/**
 * Módulo: Documentos del Pastor / Guía.
 *
 * Todo lo que respalda su ministerio y su identificación: su carnet, sus
 * certificados, su nombramiento. Cada documento guarda el archivo y su
 * nombre, para distinguirlos sin abrirlos.
 *
 * Se ven y se agregan desde la ficha del pastor, al pie. La iglesia se hereda
 * de su ficha, que es lo que acota quién puede verlos.
 */
const carpetas = require('../carpetas');

module.exports = {
  name: 'documentos_pastores',
  label: 'Documentos de Pastores',
  labelSingular: 'Documento del pastor',
  icon: '🗂️',
  group: 'Organización',
  order: 56,
  menu: false,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'observaciones'],
  listFields: ['pastor_id', 'tipo', 'nombre', 'fecha', 'archivo'],
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
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Otro Documento',
      options: TIPOS_DE_DOCUMENTO,
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Credencial 2026»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la ficha del pastor.' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, id, existing, db, confirmado }) {
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
      if (isNew && !data.fecha) data.fecha = require('../fechas').hoy();
      // ¿No será el mismo papel que ya está? Ver server/carpetas.js
      return carpetas.preguntaSiSeRepite({
        db, tabla: 'documentos_pastores', campoDueno: 'pastor_id', deQuien: 'este pastor',
        data, id, existing, confirmado,
      });
    },
  },
};
