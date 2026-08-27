/**
 * Módulo: Solicitudes (peticiones y trámites internos, con seguimiento).
 *
 * Una solicitud no es una ficha que se llena y se archiva: es algo que entra,
 * pasa por las manos de una o varias personas y termina resuelto. Por eso
 * lleva cuatro cosas que una ficha común no necesita:
 *
 *   · SU NÚMERO. `0001-2026`, correlativo por año, lo pone el sistema y no se
 *     escribe a mano (ver server/solicitudes/numero.js). Es cómo se nombra la
 *     solicitud en un acta, en un correo o de viva voz.
 *
 *   · UN RESPONSABLE. Siempre hay alguien a cargo de responderla. Se puede
 *     trasladar a otro usuario, y de ahí a otro, tantas veces como haga falta:
 *     cada traslado queda anotado con quién la pasó, a quién y por qué
 *     (ver la ruta /solicitudes/:id/trasladar).
 *
 *   · SU HISTORIAL. Cada cambio de estado, cada traslado y cada respuesta se
 *     anotan solos en Historial de Solicitudes, y además se pueden escribir
 *     anotaciones a mano. Es el seguimiento: quién hizo qué y cuándo.
 *
 *   · A QUIÉNES INVOLUCRA. El solicitante se elige del registro de Miembros o
 *     del de No Miembros, y aparte se pueden sumar todas las personas que la
 *     solicitud involucre, de cualquiera de los dos registros (ver
 *     personas_solicitud). Así se puede ver todo lo que pidió una persona.
 *
 * Los documentos y las fotografías van en Documentos de Solicitudes, uno por
 * archivo, y no en un campo suelto: una solicitud junta antecedentes a lo
 * largo de su tramitación, y no se sabe de antemano cuántos serán.
 */

/**
 * Los estados por los que pasa una solicitud.
 *
 * El traslado a otro usuario NO es un estado: una solicitud trasladada sigue
 * estando donde estaba —en revisión, en espera— y lo que cambió es quién la
 * tiene. Mezclarlo perdería justamente lo que interesa saber.
 */
const { TIPOS_DE_AYUDA } = require('../tipos-de-ayuda');

const ESTADOS = [
  'Pendiente',
  'En revisión',
  'En espera de antecedentes',
  'Aprobada',
  'Rechazada',
  'Completada',
  'Anulada',
];

/** Con estos estados la solicitud ya no está en trámite. */
const CERRADOS = ['Aprobada', 'Rechazada', 'Completada', 'Anulada'];

/**
 * Le avisa a quien queda a cargo de la solicitud.
 *
 * No se avisa a uno mismo: quien acaba de ingresar la solicitud, o quien la
 * trasladó a otro y se la quedó, ya sabe. Un aviso que dice lo que uno mismo
 * acaba de hacer es la forma más rápida de que la gente deje de mirarlos.
 *
 * En el aviso va el número y el asunto, nunca el detalle: esto puede terminar
 * en la pantalla bloqueada de un teléfono, y hay solicitudes cuyo asunto no
 * tiene por qué leer quien pase al lado. Para el resto está entrar al sistema.
 */
function avisarAlResponsable(db, fila, quienLoHizo, que, motivo) {
  const aQuien = Number(fila.responsable_id || 0);
  if (!aQuien || aQuien === Number(quienLoHizo && quienLoHizo.id)) return;
  try {
    require('../avisos/avisos').avisar({
      usuario_id: aQuien,
      tipo: 'solicitud_asignada',
      clave: `solicitud_a_cargo:${fila.id}:${aQuien}`,
      titulo: `${que} la solicitud ${fila.numero}`,
      cuerpo: `${fila.asunto || ''}${motivo ? ` · ${motivo}` : ''}`.trim().slice(0, 180),
      enlace: `#/m/solicitudes/ficha/${fila.id}`,
      iglesia_id: fila.iglesia_id,
    });
  } catch (e) {
    // Que no se pueda avisar no puede tumbar el guardado de la solicitud
    console.error(`⚠️  No se pudo avisar de la solicitud ${fila.id}: ${e.message}`);
  }
}

module.exports = {
  name: 'solicitudes',
  label: 'Solicitudes',
  labelSingular: 'Solicitud',
  icon: '📨',
  group: 'Atención y ayuda',
  order: 30,
  display: '{numero} — {asunto}',
  dateField: 'fecha',
  searchFields: ['numero', 'asunto', 'solicitante', 'descripcion'],
  listFields: ['numero', 'fecha', 'solicitante', 'tipo', 'asunto', 'estado', 'responsable_id', 'iglesia_id'],
  filterFields: ['estado', 'tipo', 'responsable_id', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  printable: true,
  ESTADOS,
  CERRADOS,

  /**
   * QUIÉN VE UNA SOLICITUD, cuando quien mira tiene cuerpos asignados.
   *
   * El alcance por cuerpo tiene una regla general que casi siempre acierta: si
   * un módulo lleva `miembro_id`, ese campo dice DE QUIÉN ES la ficha, y se
   * muestra solo lo de la gente de sus cuerpos. Vale para la bitácora de un
   * miembro, para sus documentos, para sus certificados.
   *
   * Acá no. En una solicitud el `miembro_id` dice quién la PRESENTÓ; de la
   * solicitud responde otra persona. Con la regla general, a quien tiene un
   * cuerpo asignado se le escondían las solicitudes que llevaba él mismo si el
   * solicitante era de otro cuerpo —y TODAS las de gente no inscrita, que ni
   * siquiera tienen ese número—. El sistema le avisaba «quedó a su cargo la
   * solicitud 0002», lo perseguía por no responderla, y al abrir el enlace le
   * contestaba que está fuera de lo que tiene asignado. Medido: de tres
   * solicitudes a su nombre, veía una.
   *
   * Así que además de las de su gente, ve las que tiene a cargo. No se abre
   * nada más: lo que se deja de esconder es lo que ya era suyo.
   */
  alcance: { tambienSuyo: 'responsable_id' },
  fields: [
    {
      name: 'numero', label: 'N.º de solicitud', type: 'text', readonly: true, unique: true,
      help: 'Lo pone el sistema al ingresarla: correlativo por año. No se escribe ni se corrige a mano.',
    },
    { name: 'fecha', label: 'Fecha de la solicitud', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },

    // ---------------- Quién la presenta ----------------
    {
      name: 'solicitante_tipo', label: '¿Quién la presenta?', type: 'select',
      options: ['Miembro', 'No miembro'], required: true, seccion: 'Solicitante',
      help: 'Si quien la presenta no pertenece a la iglesia, elija «No miembro» y búsquelo —o regístrelo— en No Miembros.',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros',
      required: true, showIf: { field: 'solicitante_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'No Miembro', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'solicitante_tipo', equals: 'No miembro' },
      help: 'Si todavía no tiene ficha, créela en No Miembros: basta con el nombre.',
    },
    {
      name: 'solicitante', label: 'Solicitante', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida: queda como constancia de a nombre de quién se ingresó.',
    },

    // ---------------- Qué pide ----------------
    {
      name: 'tipo', label: 'Tipo de solicitud', type: 'select', required: true, default: 'Otro',
      seccion: 'La solicitud',
      options: [
        'Traslado de membresía', 'Certificado', 'Credencial', 'Ayuda social',
        'Permiso / Licencia', 'Uso de instalaciones', 'Materiales / Equipo',
        'Audiencia con liderazgo', 'Otro',
      ],
    },
    { name: 'asunto', label: 'Asunto', type: 'text', required: true },
    { name: 'descripcion', label: 'Descripción detallada', type: 'textarea' },

    /*
     * Lo que hace falta para que, al aprobarla, la ayuda se registre sola.
     *
     * Solo aparecen en las solicitudes de ayuda social, y el tipo se exige
     * únicamente ahí: el motor no reclama un campo obligatorio que su «showIf»
     * tiene escondido. Sin el tipo, la ayuda nacería como «Otro» —que no dice
     * nada— y habría que ir a corregirla a mano, que es justo el trabajo que
     * esto viene a ahorrar.
     */
    {
      name: 'ayuda_tipo', label: 'Tipo de ayuda que se pide', type: 'select',
      options: TIPOS_DE_AYUDA, required: true,
      showIf: { field: 'tipo', equals: 'Ayuda social' },
      help: 'Al aprobar la solicitud, la ficha en Ayudas Sociales se crea sola con este tipo.',
    },
    {
      name: 'ayuda_monto', label: 'Valor estimado de la ayuda', type: 'money', min: 0,
      showIf: { field: 'tipo', equals: 'Ayuda social' },
      help: 'Opcional. Pasa tal cual a la ayuda cuando se apruebe.',
    },

    // ---------------- Cómo va ----------------
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Pendiente',
      options: ESTADOS, seccion: 'Tramitación',
    },
    {
      name: 'responsable_id', label: 'Responsable', type: 'ref', ref: 'usuarios',
      // La lista sale de una ruta propia y NO de /usuarios/options a propósito.
      // Esa ruta entrega, además del nombre, el RUT y el correo de cada
      // usuario para poder buscar por ahí; usarla acá se los entregaría a
      // cualquiera que administre solicitudes, que es gente que ni siquiera
      // entra al módulo de Usuarios. Acá solo hacen falta los nombres.
      optionsRoute: '/solicitudes/responsables',
      help: 'Quién tiene que responderla. Para pasarla a otro use «Trasladar», que deja constancia de por qué.',
    },
    {
      name: 'respuesta', label: 'Respuesta / Resolución', type: 'textarea',
      help: 'Qué se resolvió. Al cerrar la solicitud queda anotada en su historial.',
    },
    { name: 'fecha_respuesta', label: 'Fecha de respuesta', type: 'date', noAntesDe: 'fecha', readonly: true,
      help: 'La pone el sistema el día en que la solicitud se cierra.' },

    // La ayuda que generó esta solicitud, si generó alguna. La escribe el
    // sistema y es lo que impide que se cree una segunda al volver a guardar.
    { name: 'ayuda_social_id', label: 'Ayuda social generada', type: 'ref', ref: 'ayudas_sociales', readonly: true },
  ],

  hooks: {
    /**
     * Le pone el número, copia el nombre del solicitante y deja constancia de
     * lo que cambió.
     *
     * El nombre se copia de la ficha en vez de pedirse aparte: escribirlo a
     * mano permitía que la solicitud dijera un nombre y apuntara a otra
     * persona. Y se suelta el enlace del lado que no corresponde, porque si
     * alguien la ingresa a nombre de un miembro y después la corrige a un no
     * miembro, el enlace viejo quedaría apuntando a quien no pidió nada.
     */
    beforeSave(data, { isNew, existing, user, db }) {
      const tipo = data.solicitante_tipo !== undefined
        ? data.solicitante_tipo
        : existing && existing.solicitante_tipo;

      const deDonde = tipo === 'Miembro'
        ? { tabla: 'miembros', campo: 'miembro_id', otro: 'no_miembro_id', que: 'El miembro' }
        : tipo === 'No miembro'
          ? { tabla: 'no_miembros', campo: 'no_miembro_id', otro: 'miembro_id', que: 'La persona' }
          : null;

      // Las solicitudes ingresadas antes de que existiera este campo no traen
      // tipo y conservan el nombre que se escribió en su momento: no se tocan.
      if (deDonde) {
        const id = data[deDonde.campo] !== undefined
          ? data[deDonde.campo]
          : existing && existing[deDonde.campo];
        if (!id) return `${deDonde.que} que presenta esta solicitud no está indicado.`;
        const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde.tabla}" WHERE id = ?`).get(id);
        if (!ficha) return `${deDonde.que} que presenta esta solicitud ya no está en el sistema.`;
        data.solicitante = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
        data[deDonde.otro] = null;
      }

      if (isNew) {
        if (!data.numero) {
          const anio = Number(String(data.fecha || '').slice(0, 4)) || new Date().getFullYear();
          data.numero = require('../solicitudes/numero').siguiente(anio);
        }
        // Quien la ingresa queda a cargo mientras no se diga otra cosa: una
        // solicitud sin responsable es una solicitud que nadie mira.
        if (!data.responsable_id) data.responsable_id = user.id;
      }

      // La fecha de respuesta la pone el sistema el día en que se cierra, y se
      // borra si la solicitud vuelve a abrirse.
      const nuevoEstado = data.estado !== undefined ? data.estado : existing && existing.estado;
      const estabaCerrada = existing && CERRADOS.includes(existing.estado);
      const quedaCerrada = CERRADOS.includes(nuevoEstado);
      if (quedaCerrada && !estabaCerrada) data.fecha_respuesta = new Date().toISOString().slice(0, 10);
      if (!quedaCerrada && estabaCerrada) data.fecha_respuesta = null;

      /*
       * CERRAR la solicitud de otro pide la misma llave que trasladarla.
       *
       * La llave se llama «Trasladar y cerrar solicitudes de otros» desde que
       * existe, pero solo guardaba el traslado: cerrar era un cambio de estado
       * como cualquier otro, así que cualquiera con permiso de editar el módulo
       * podía dar por resuelta una solicitud que llevaba otro. El permiso
       * prometía una cosa y hacía la mitad.
       *
       * Se comprueba acá y no en una ruta aparte porque cerrar no es una
       * acción propia: es guardar la ficha con otro estado, y el guardado es
       * por donde pasa. Quien la tiene a cargo la cierra siempre —es su
       * trabajo—, y reabrirla se trata igual: sacar de «Aprobada» algo que
       * otro resolvió es tan delicado como cerrarlo.
       */
      if (!isNew && existing && quedaCerrada !== estabaCerrada) {
        const esElResponsable = Number(existing.responsable_id) === Number(user && user.id);
        if (!esElResponsable && !require('../permissions').can(user, 'solicitudes_tramitar', 'view')) {
          return quedaCerrada
            ? 'Esta solicitud está a cargo de otra persona: solo puede cerrarla quien la lleva, '
              + 'o quien tenga permiso para tramitar las de otros.'
            : 'Esta solicitud está a cargo de otra persona: solo puede reabrirla quien la lleva, '
              + 'o quien tenga permiso para tramitar las de otros.';
        }
      }

      return null;
    },

    /** Lo que cambió queda anotado en el historial de la solicitud. */
    afterSave(fila, { isNew, existing, user, db }) {
      const seguimiento = require('../solicitudes/seguimiento');
      if (isNew) {
        seguimiento.anotar(db, fila.id, {
          tipo: 'Ingreso',
          descripcion: `Solicitud ${fila.numero} ingresada a nombre de ${fila.solicitante || 'quien corresponda'}.` +
            (fila.responsable_id ? ` Queda a cargo de ${seguimiento.nombreDelUsuario(db, fila.responsable_id)}.` : ''),
          user,
        });
        avisarAlResponsable(db, fila, user, 'Quedó a su cargo');
        return;
      }
      if (existing && existing.estado !== fila.estado) {
        seguimiento.anotar(db, fila.id, {
          tipo: 'Cambio de estado',
          descripcion: `De «${existing.estado || 'sin estado'}» a «${fila.estado}».` +
            (CERRADOS.includes(fila.estado) && fila.respuesta ? ` Resolución: ${fila.respuesta}` : ''),
          user,
        });
      }
      if (existing && Number(existing.responsable_id || 0) !== Number(fila.responsable_id || 0)) {
        seguimiento.anotar(db, fila.id, {
          tipo: 'Traslado',
          descripcion: `Pasa de ${seguimiento.nombreDelUsuario(db, existing.responsable_id)} ` +
            `a ${seguimiento.nombreDelUsuario(db, fila.responsable_id)}.`,
          user,
        });
        avisarAlResponsable(db, fila, user, 'Le trasladaron');
      }
      if (existing && (existing.respuesta || '') !== (fila.respuesta || '') && fila.respuesta) {
        seguimiento.anotar(db, fila.id, {
          tipo: 'Respuesta',
          descripcion: fila.respuesta,
          user,
        });
      }

      /*
       * Y si es una ayuda social que se acaba de conceder, se registra sola en
       * Ayudas Sociales. El porqué y las tres decisiones que lo rodean —se
       * crea una vez, no se borra sola, queda anotada— están en
       * server/solicitud-ayuda.js.
       */
      const ayudaId = require('../solicitud-ayuda').generarSiCorresponde(fila, { db, user, existing });
      if (ayudaId) {
        seguimiento.anotar(db, fila.id, {
          tipo: 'Cambio de estado',
          descripcion:
            `Se registró la ayuda social n.º ${ayudaId} con lo que dice esta solicitud. ` +
            'Si algo cambia, se corrige allá: esta solicitud ya no la vuelve a generar.',
          user,
        });
      }
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /**
     * A quién se le puede encargar una solicitud: los usuarios con el acceso
     * activo, solo con su nombre.
     *
     * Existe para no tener que abrir /usuarios/options a quien administra
     * solicitudes: esa ruta entrega también el RUT y el correo de cada
     * usuario, para poder buscar por ahí, y acá no hacen ninguna falta.
     */
    router.get('/solicitudes/responsables', requirePerm('solicitudes', 'view'), (req, res) => {
      // Y solo las cuentas que esta persona alcanza: entregaba los nombres de
      // TODAS las del sistema, incluidas las de otras iglesias. Una solicitud
      // tampoco se le puede endosar a alguien de una iglesia que no se
      // administra, así que acotarlo arregla las dos cosas de una vez.
      const params = [];
      const suyas = require('../alcance').condicionesDeUsuarios(req.user, params);
      const filas = db
        .prepare(
          `SELECT usuarios.id, usuarios.nombre FROM usuarios
            WHERE usuarios.activo = 1${suyas ? ` AND ${suyas}` : ''}
            ORDER BY usuarios.nombre`
        )
        .all(...params);
      res.json(filas.map((u) => ({ id: u.id, label: u.nombre })));
    });

    /**
     * Trasladar la solicitud a otro usuario.
     *
     * La traslada quien la tiene en sus manos, o el administrador. Nadie puede
     * sacarle de encima una solicitud a otro ni endosársela sin que quede
     * claro quién lo hizo: por eso no basta con poder editar el módulo.
     *
     * El motivo se exige. Un traslado sin motivo, leído tres meses después, no
     * dice nada, y el historial existe justamente para que se entienda por qué
     * la solicitud anduvo dando vueltas.
     */
    router.post('/solicitudes/:id(\\d+)/trasladar', requirePerm('solicitudes', 'edit'), (req, res) => {
      const seguimiento = require('../solicitudes/seguimiento');
      const alcance = require('../alcance');
      const { can } = require('../permissions');
      const fila = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
      if (!fila) return res.status(404).json({ error: 'Esa solicitud no existe.' });
      if (!alcance.alcanza(module.exports, fila, req.user)) {
        return res.status(403).json({ error: 'No tiene acceso a esa solicitud.' });
      }
      if (module.exports.CERRADOS.includes(fila.estado)) {
        return res.status(400).json({ error: `La solicitud está ${fila.estado.toLowerCase()}: ya no se traslada.` });
      }

      /*
       * Quién puede moverla: quien la tiene a cargo, siempre; y quien tenga la
       * llave de tramitar las de otros.
       *
       * Antes decía «o el administrador», escrito así, con el rol adentro del
       * código. Eso obligaba a hacer administrador de TODO a quien solo tenía
       * que coordinar solicitudes y destrabar las que quedaban paradas. Con
       * una llave propia eso se concede solo. De fábrica la tiene el
       * administrador y nadie más, así que nada cambia mientras no se
       * conceda a propósito.
       */
      const esElResponsable = Number(fila.responsable_id) === Number(req.user.id);
      if (!esElResponsable && !can(req.user, 'solicitudes_tramitar', 'view')) {
        return res.status(403).json({
          error: 'Solo puede trasladarla quien la tiene a cargo, o quien tenga permiso para tramitar las de otros.',
        });
      }

      const hacia = Number(req.body && req.body.responsable_id);
      const motivo = String((req.body && req.body.motivo) || '').trim();
      if (!hacia) return res.status(400).json({ error: 'Indique a qué usuario se traslada.' });
      if (!motivo) return res.status(400).json({ error: 'Escriba por qué se traslada: el historial sin motivo no sirve de nada.' });
      if (hacia === Number(fila.responsable_id)) {
        return res.status(400).json({ error: 'La solicitud ya está a cargo de esa persona.' });
      }
      const destino = db.prepare('SELECT id, nombre, activo FROM usuarios WHERE id = ?').get(hacia);
      if (!destino) return res.status(400).json({ error: 'Ese usuario no existe.' });
      if (destino.activo === 0) return res.status(400).json({ error: 'Ese usuario no tiene el acceso activo.' });

      db.transaction(() => {
        db.prepare("UPDATE solicitudes SET responsable_id = ?, updated_at = datetime('now','localtime'), updated_by = ?, version = version + 1 WHERE id = ?")
          .run(hacia, req.user.id, fila.id);
        seguimiento.anotar(db, fila.id, {
          tipo: 'Traslado',
          descripcion: `Pasa de ${seguimiento.nombreDelUsuario(db, fila.responsable_id)} a ${destino.nombre}. Motivo: ${motivo}`,
          user: req.user,
        });
      }).immediate();

      avisarAlResponsable(db, { ...fila, responsable_id: hacia }, req.user, 'Le trasladaron', motivo);

      res.json({ ok: true, responsable_id: hacia, responsable: destino.nombre });
    });
  },
};
