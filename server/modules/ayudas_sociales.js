/**
 * Módulo: Ayudas Sociales (apoyo a miembros y a la comunidad).
 *
 * A QUIÉN SE LE AYUDÓ. Antes el beneficiario era un nombre escrito a mano y,
 * aparte, un enlace opcional a un miembro. Eso dejaba dos problemas: se podían
 * llenar los dos, o ninguno, y quedaba una ayuda sin saber bien de quién era;
 * y la mayoría de las ayudas —que son para gente que no pertenece a la
 * iglesia— quedaban como un nombre suelto, sin ficha detrás, así que no había
 * manera de ver el historial de una persona ni de saber a cuántas se ha
 * ayudado.
 *
 * Ahora se elige primero SI ES MIEMBRO O NO, y según eso aparece el selector
 * que corresponde: Miembros o No Miembros. Uno de los dos, nunca los dos, y
 * siempre uno: no se puede registrar una ayuda sin decir para quién.
 *
 * El nombre del beneficiario se sigue guardando en `beneficiario`, pero ya no
 * se escribe: lo copia el sistema de la ficha elegida al guardar. Así los
 * listados, la búsqueda y las ayudas que ya estaban registradas siguen
 * funcionando igual, y el nombre queda como constancia de a nombre de quién se
 * entregó, aunque después la ficha se corrija.
 */

const { TIPOS_DE_AYUDA } = require('../tipos-de-ayuda');

/** De qué registro sale el beneficiario de esta ayuda. */
const DE_QUIEN = ['Miembro', 'No miembro'];

module.exports = {
  name: 'ayudas_sociales',
  label: 'Ayudas Sociales',
  labelSingular: 'Ayuda Social',
  icon: '🤝',
  group: 'Atención y ayuda',
  order: 31,
  display: '{tipo_ayuda} — {beneficiario}',
  dateField: 'fecha',
  searchFields: ['beneficiario', 'descripcion', 'tipo_ayuda'],
  listFields: ['fecha', 'beneficiario', 'beneficiario_tipo', 'tipo_ayuda', 'valor_estimado', 'estado', 'iglesia_id'],
  filterFields: ['beneficiario_tipo', 'tipo_ayuda', 'estado', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },

    // ---------------- A quién se le ayuda ----------------
    {
      name: 'beneficiario_tipo', label: '¿A quién se le ayuda?', type: 'select',
      options: DE_QUIEN, required: true, seccion: 'Beneficiario',
      help: 'Si la persona no pertenece a la iglesia, elija «No miembro» y búsquela —o regístrela— en No Miembros.',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros',
      required: true, showIf: { field: 'beneficiario_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'No Miembro', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'beneficiario_tipo', equals: 'No miembro' },
      help: 'Si todavía no tiene ficha, créela en No Miembros: basta con el nombre.',
    },
    {
      name: 'beneficiario', label: 'Beneficiario', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida: queda como constancia de a nombre de quién se entregó.',
    },

    // ---------------- La ayuda ----------------
    {
      name: 'tipo_ayuda', label: 'Tipo de ayuda', type: 'select', required: true, default: 'Alimentos',
      seccion: 'La ayuda',
      options: TIPOS_DE_AYUDA,
    },
    { name: 'descripcion', label: 'Descripción de la ayuda', type: 'textarea' },
    { name: 'valor_estimado', label: 'Valor estimado', type: 'money', min: 0 },
    { name: 'aprobada_por', label: 'Aprobada por', type: 'text' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Solicitada',
      options: ['Solicitada', 'Aprobada', 'Entregada', 'Rechazada'],
    },
    // De qué solicitud salió, cuando salió de una. Lo escribe el sistema al
    // aprobarla; queda a la vista para poder ir a leer lo que se pidió.
    { name: 'solicitud_id', label: 'Solicitud de origen', type: 'ref', ref: 'solicitudes', readonly: true },
    { name: 'soporte', label: 'Soporte / Evidencia', type: 'file' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  hooks: {
    /**
     * Deja escrito el nombre de quien recibió la ayuda, y solo uno de los dos
     * enlaces.
     *
     * El nombre se copia de la ficha en vez de pedirse aparte: escribirlo a
     * mano permitía que la ayuda dijera un nombre y apuntara a otra persona.
     * Y se suelta el enlace del lado que no corresponde, porque si alguien
     * registra la ayuda a nombre de un miembro y después la corrige a un no
     * miembro, el enlace viejo quedaría ahí apuntando a alguien que no recibió
     * nada.
     */
    beforeSave(data, { isNew, existing, db }) {
      const tipo = data.beneficiario_tipo !== undefined
        ? data.beneficiario_tipo
        : existing && existing.beneficiario_tipo;

      const deDonde = tipo === 'Miembro'
        ? { tabla: 'miembros', campo: 'miembro_id', otro: 'no_miembro_id', que: 'El miembro' }
        : tipo === 'No miembro'
          ? { tabla: 'no_miembros', campo: 'no_miembro_id', otro: 'miembro_id', que: 'La persona' }
          : null;

      // Las ayudas registradas antes de que existiera este campo no traen tipo
      // y conservan el nombre que se escribió en su momento: no se tocan.
      if (!deDonde) return null;

      const id = data[deDonde.campo] !== undefined
        ? data[deDonde.campo]
        : existing && existing[deDonde.campo];
      if (!id) return `${deDonde.que} de esta ayuda no está indicado.`;

      const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde.tabla}" WHERE id = ?`).get(id);
      if (!ficha) return `${deDonde.que} de esta ayuda ya no está en el sistema.`;

      data.beneficiario = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
      data[deDonde.otro] = null;
      return null;
    },
  },
};
