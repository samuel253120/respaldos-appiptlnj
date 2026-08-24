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
  group: 'Documentación',
  order: 45,
  display: '{numero} — {asunto}',
  dateField: 'fecha',
  searchFields: ['numero', 'asunto', 'solicitante', 'descripcion'],
  listFields: ['numero', 'fecha', 'solicitante', 'tipo', 'asunto', 'estado', 'responsable_id', 'iglesia_id'],
  filterFields: ['estado', 'tipo', 'responsable_id', 'iglesia_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  printable: true,
  ESTADOS,
  CERRADOS,
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
      const filas = db
        .prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre')
        .all();
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
      const fila = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
      if (!fila) return res.status(404).json({ error: 'Esa solicitud no existe.' });
      if (!alcance.alcanza(module.exports, fila, req.user)) {
        return res.status(403).json({ error: 'No tiene acceso a esa solicitud.' });
      }
      if (module.exports.CERRADOS.includes(fila.estado)) {
        return res.status(400).json({ error: `La solicitud está ${fila.estado.toLowerCase()}: ya no se traslada.` });
      }

      const esElResponsable = Number(fila.responsable_id) === Number(req.user.id);
      const esAdmin = req.user.rol === 'admin';
      if (!esElResponsable && !esAdmin) {
        return res.status(403).json({
          error: 'Solo puede trasladarla quien la tiene a cargo, o el administrador.',
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
      })();

      avisarAlResponsable(db, { ...fila, responsable_id: hacia }, req.user, 'Le trasladaron', motivo);

      res.json({ ok: true, responsable_id: hacia, responsable: destino.nombre });
    });
  },
};
