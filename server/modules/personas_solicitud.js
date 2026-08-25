/**
 * Módulo: Personas de la Solicitud.
 *
 * Una solicitud rara vez es de una sola persona. Un traslado de membresía
 * involucra al que se va y a quien lo recibe; una ayuda social, al que la pide
 * y a su grupo familiar; una audiencia, a los tres que la piden juntos. Acá se
 * anota a toda esa gente, y para cada uno qué papel tiene en el asunto.
 *
 * Cada persona sale de uno de los dos registros —Miembros o No Miembros—, y se
 * elige primero de cuál: así se puede abrir la ficha de cualquiera de ellos y
 * ver todo lo que se ha tramitado a su nombre, sin que las personas de la
 * comunidad se mezclen con la membresía.
 *
 * Se ven y se agregan desde la propia ficha de la solicitud, en su pestaña.
 */
module.exports = {
  name: 'personas_solicitud',
  label: 'Personas de la Solicitud',
  labelSingular: 'Persona de la solicitud',
  icon: '🧑‍🤝‍🧑',
  group: 'Atención y ayuda',
  order: 32,
  menu: false,
  display: '{persona}',
  searchFields: ['persona', 'relacion', 'observaciones'],
  listFields: ['solicitud_id', 'persona', 'persona_tipo', 'relacion'],
  defaultSort: { field: 'id', dir: 'asc' },
  fields: [
    { name: 'solicitud_id', label: 'Solicitud', type: 'ref', ref: 'solicitudes', required: true },
    {
      name: 'persona_tipo', label: '¿De qué registro?', type: 'select',
      options: ['Miembro', 'No miembro'], required: true,
      help: 'Si la persona no pertenece a la iglesia, elíjala en No Miembros.',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros',
      required: true, showIf: { field: 'persona_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'No Miembro', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'persona_tipo', equals: 'No miembro' },
      help: 'Si todavía no tiene ficha, créela en No Miembros: basta con el nombre.',
    },
    {
      name: 'persona', label: 'Persona', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida.',
    },
    {
      name: 'relacion', label: 'Qué papel tiene', type: 'text',
      sugerencias: [
        'Beneficiario', 'Cónyuge', 'Hijo(a)', 'Padre / Madre', 'Grupo familiar',
        'Presenta la solicitud junto al solicitante', 'Iglesia de destino', 'Testigo', 'Otro',
      ],
      help: 'Se elige de la lista o se escribe como corresponda.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true, help: 'Se toma de la solicitud.' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, existing, db }) {
      const solicitudId = data.solicitud_id !== undefined ? data.solicitud_id : existing ? existing.solicitud_id : null;
      if (solicitudId) {
        const s = db.prepare('SELECT iglesia_id FROM solicitudes WHERE id = ?').get(solicitudId);
        if (s && s.iglesia_id) data.iglesia_id = s.iglesia_id;
      }

      const tipo = data.persona_tipo !== undefined ? data.persona_tipo : existing && existing.persona_tipo;
      const deDonde = tipo === 'Miembro'
        ? { tabla: 'miembros', campo: 'miembro_id', otro: 'no_miembro_id', que: 'El miembro' }
        : tipo === 'No miembro'
          ? { tabla: 'no_miembros', campo: 'no_miembro_id', otro: 'miembro_id', que: 'La persona' }
          : null;
      if (!deDonde) return 'Indique de qué registro sale esta persona.';

      const id = data[deDonde.campo] !== undefined ? data[deDonde.campo] : existing && existing[deDonde.campo];
      if (!id) return `${deDonde.que} no está indicado.`;
      const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde.tabla}" WHERE id = ?`).get(id);
      if (!ficha) return `${deDonde.que} ya no está en el sistema.`;
      // El nombre se copia de la ficha, y se suelta el enlace del lado que no
      // corresponde: si no, al corregir de miembro a no miembro quedaría el
      // enlace viejo apuntando a alguien que no tiene nada que ver.
      data.persona = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
      data[deDonde.otro] = null;
      return null;
    },
    /** Que se sume a alguien queda anotado en el seguimiento. */
    afterSave(fila, { isNew, user, db }) {
      if (!isNew) return;
      require('../solicitudes/seguimiento').anotar(db, fila.solicitud_id, {
        tipo: 'Gestión',
        descripcion: `Se sumó a ${fila.persona}${fila.relacion ? ` (${fila.relacion})` : ''} a la solicitud.`,
        user,
      });
    },
  },
};
