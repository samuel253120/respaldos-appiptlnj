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
/**
 * La misma persona, sumada dos veces a la misma solicitud.
 *
 * El módulo comprobaba con cuidado de qué registro sale cada persona, que la
 * ficha exista y soltaba el enlace del lado que no corresponde. Lo que no
 * miraba era si esa persona YA ESTABA en esa solicitud.
 *
 * MEDIDO en la v1.431.0, la misma miembro con el mismo papel, tres veces:
 *
 *   POST /personas_solicitud {miembro_id: 1, relacion: Beneficiario} ..... 201
 *   POST /personas_solicitud {miembro_id: 1, relacion: Beneficiario} ..... 201
 *   POST /personas_solicitud {miembro_id: 1, relacion: Beneficiario} ..... 201
 *   la solicitud quedó con 3 personas, las tres «Rosa Díaz Fuentes»
 *   y la tramitación con la misma línea escrita tres veces
 *
 * Importa porque una solicitud de ayuda social se cuenta por las personas que
 * alcanza: el grupo familiar de una entrega es lo que decide de qué tamaño es.
 * Con la misma persona repetida, la pestaña miente sobre a cuánta gente llega
 * el asunto. Y no hace falta que nadie se equivoque a propósito: basta con dos
 * personas tramitando la misma solicitud, o con volver atrás en el navegador
 * (hallazgo SA-04).
 *
 * ── DOS RESPUESTAS DISTINTAS, PORQUE SON DOS CASOS DISTINTOS ──
 *
 * MISMA PERSONA, MISMO PAPEL: se rechaza. No es un caso legítimo por ninguna
 * vía —nadie es dos veces el beneficiario del mismo trámite— y confirmarlo no
 * arreglaría nada: dejaría dos filas idénticas que después nadie sabe cuál
 * borrar. Es la única cosa de este archivo que se prohíbe.
 *
 * MISMA PERSONA, OTRO PAPEL: se pregunta. Pasa de verdad —la misma persona
 * puede ser cónyuge en un traslado y testigo en el mismo trámite— y el sistema
 * no está para discutírselo a quien tiene el expediente en la mano. Es el
 * mismo criterio de los papeles repetidos de una carpeta (server/carpetas.js),
 * de Tesorería y de Traspasos: se devuelve un objeto con `confirmar` y el motor
 * lo convierte en dos botones.
 *
 * SIN PAPEL ESCRITO cuenta como un papel más: dos filas de la misma persona,
 * las dos en blanco, son el caso de arriba y se rechazan.
 */
function laMismaPersonaOtraVez({ db, solicitudId, campo, id, quien, relacion, yoSoy, confirmado }) {
  if (!solicitudId || !id) return null;
  const { comoSeCompara } = require('../repetido');

  const otras = db
    .prepare(`SELECT id, relacion FROM personas_solicitud
               WHERE solicitud_id = ? AND "${campo}" = ? AND id IS NOT ?`)
    .all(solicitudId, id, yoSoy || 0);
  if (!otras.length) return null;

  const mismoPapel = otras.find((o) => comoSeCompara(o.relacion) === comoSeCompara(relacion));
  if (mismoPapel) {
    const como = String(relacion || '').trim();
    return `${quien} ya está en esta solicitud${como ? ` como «${como}»` : ', sin papel anotado'}. `
      + 'Una misma persona no se anota dos veces con el mismo papel: si lo que hay que corregir es '
      + 'ese papel, ábrala y corríjalo; si de verdad tiene otro papel además, anótelo con ese papel.';
  }

  if (confirmado) return null;
  const papeles = otras
    .map((o) => (String(o.relacion || '').trim() ? `«${String(o.relacion).trim()}»` : 'sin papel anotado'))
    .join(' y ');
  return {
    error:
      `${quien} ya figura en esta solicitud como ${papeles}. Una misma persona puede tener dos papeles `
      + '—cónyuge de quien se traslada y testigo del mismo trámite, por ejemplo—, pero si es la misma '
      + 'anotación repetida, la solicitud va a decir que alcanza a más gente de la que alcanza. '
      + 'Si de verdad tiene los dos papeles, confirme.',
    confirmar: 'esa_persona_ya_esta_en_la_solicitud',
  };
}

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
  /**
   * Se ve exactamente donde se ve su solicitud.
   *
   * Sin esto, el alcance por cuerpo miraba a la persona que aparece dentro y
   * no al trámite del que cuelga: en una solicitud que sí se puede abrir,
   * desaparecían de la pestaña las personas que no fueran de sus cuerpos.
   */
  alcance: { comoSuPadre: { modulo: 'solicitudes', campo: 'solicitud_id' } },

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
    beforeSave(data, { isNew, existing, db, confirmado }) {
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

      return laMismaPersonaOtraVez({
        db, solicitudId, campo: deDonde.campo, id, quien: data.persona,
        relacion: data.relacion !== undefined ? data.relacion : existing && existing.relacion,
        yoSoy: existing ? existing.id : 0, confirmado,
      });
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
