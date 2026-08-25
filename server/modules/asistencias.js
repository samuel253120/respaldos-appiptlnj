/**
 * Módulo: Asistencias (la asistencia se toma por cuerpo, en cada actividad).
 *
 * Cada registro es una actividad —una reunión, un ensayo, una salida— a la
 * que asiste **uno o varios cuerpos**. La lista nominal de quién estuvo se
 * guarda en "Toma de Asistencia": una fila por integrante, con su estado
 * (Presente, Ausente o Justificado) y el motivo cuando corresponde.
 *
 * Al pie de cada actividad está "Pasar lista", que muestra a los integrantes
 * de todos los cuerpos convocados, agrupados por cuerpo, y permite marcarlos
 * de una vez.
 *
 * Permisos: crear o modificar actividades se rige por este módulo; **tomar la
 * asistencia** se rige por "Toma de Asistencia", de modo que a alguien se le
 * puede dejar pasar lista sin dejarlo crear actividades.
 *
 * Rutas propias:
 *   GET  /asistencias/agenda      actividades de un período, con su avance
 *   GET  /asistencias/:id/lista   integrantes del cuerpo con su marca
 *   POST /asistencias/:id/lista   guarda todas las marcas de una vez
 *   GET  /asistencias/informe     informes y promedios (general, por cuerpo,
 *                                 por persona)
 *   GET  /asistencias/hoja-mensual  la planilla mensual de un cuerpo: un día
 *                                 por columna, para imprimir apaisada.
 *                                 NO se llama «/planilla»: ese nombre ya lo usa
 *                                 la bajada a Excel que el motor le da a todos
 *                                 los módulos, y se lo comía antes de llegar acá
 */
const nombres = require('../nombres');

const MOTIVOS_CON_DETALLE = ['Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];

/** Las actividades a las que la iglesia toma asistencia. */
const { TIPOS_DE_ACTIVIDAD } = require('../actividades');

/** Ids de los cuerpos convocados (el multiref se guarda como JSON). */
function idsDeCuerpos(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  try {
    return JSON.parse(valor || '[]').map(Number).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * A qué cuerpos de esta actividad le toca pasar lista a este usuario.
 *
 * A una actividad puede asistir más de un cuerpo. Quien tiene cuerpos
 * asignados solo pasa lista a los suyos: aunque la actividad convoque a
 * siete, él ve y marca únicamente a los de su cuerpo. Sin cuerpos asignados
 * —el caso del administrador— le tocan todos los convocados.
 */
function cuerposQueLeTocan(actividad, usuario) {
  const convocados = idsDeCuerpos(actividad.cuerpos);
  const suyos = require('../alcance').cuerposDe(usuario);
  if (!suyos.length) return convocados;
  return convocados.filter((id) => suyos.includes(Number(id)));
}

/**
 * Integrantes de los cuerpos que le tocan a este usuario en esta actividad,
 * con el cuerpo por el que entra cada uno. Quien está en dos de esos cuerpos
 * aparece una sola vez, en el primero.
 */
function integrantesConvocados(actividad, db, usuario) {
  const { idsDeIntegrantes } = require('../integrantes');
  const mapa = new Map();
  for (const cuerpoId of cuerposQueLeTocan(actividad, usuario)) {
    const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
    if (!cuerpo) continue;
    for (const id of idsDeIntegrantes(db, cuerpo.id)) {
      if (!mapa.has(id)) mapa.set(id, { cuerpo_id: cuerpo.id, cuerpo: cuerpo.nombre });
    }
  }
  return mapa;
}

/**
 * Las marcas que hay ahora mismo en una actividad, de los cuerpos que le
 * tocan a esta persona. Se devuelven al guardar para que la pantalla se ponga
 * al día con lo que hayan marcado los demás mientras tanto.
 */
function marcasVisibles(actividad, db, usuario) {
  const suyos = require('../alcance').cuerposDe(usuario);
  const acota = suyos.length ? ` AND cuerpo_id IN (${suyos.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT miembro_id, estado, motivo, detalle FROM asistencia_detalle
        WHERE asistencia_id = ?${acota}`
    )
    .all(actividad.id, ...(acota ? suyos : []));
}

/** Cuenta las marcas de una actividad. */
function conteo(asistenciaId, db, cuerpos) {
  const acota = cuerpos && cuerpos.length ? ` AND cuerpo_id IN (${cuerpos.map(() => '?').join(',')})` : '';
  const filas = db
    .prepare(`SELECT estado, COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ?${acota} GROUP BY estado`)
    .all(asistenciaId, ...(acota ? cuerpos : []));
  const de = (e) => (filas.find((f) => f.estado === e) || {}).n || 0;
  const presentes = de('Presente');
  const ausentes = de('Ausente');
  const justificados = de('Justificado');
  return { presentes, ausentes, justificados, total: presentes + ausentes + justificados };
}

module.exports = {
  name: 'asistencias',
  label: 'Asistencias',
  labelSingular: 'Actividad',
  icon: '📋',
  group: 'Reuniones',
  order: 10,
  // Todo lo de asistencia —crear actividades, pasar lista e informes— vive en
  // una sola pantalla, la de Asistencia, así que este módulo no ocupa además
  // un lugar propio en el menú.
  menu: false,
  display: '{tipo_reunion} — {fecha}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['tipo_reunion', 'nombre', 'lugar', 'observaciones'],
  listFields: ['fecha', 'cuerpos', 'tipo_reunion', 'nombre', 'presentes', 'ausentes', 'justificados', 'porcentaje'],
  filterFields: ['tipo_reunion'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  computed: [
    { name: 'presentes', label: 'Presentes', type: 'texto', calc: (r, { db }) => String(conteo(r.id, db).presentes) },
    { name: 'ausentes', label: 'Ausentes', type: 'texto', calc: (r, { db }) => String(conteo(r.id, db).ausentes) },
    { name: 'justificados', label: 'Justificados', type: 'texto', calc: (r, { db }) => String(conteo(r.id, db).justificados) },
    {
      name: 'porcentaje', label: 'Asistencia', type: 'badge',
      calc: (r, { db }) => {
        const c = conteo(r.id, db);
        if (!c.total) return { texto: 'Sin lista', nivel: 'gris' };
        const pct = Math.round((c.presentes / c.total) * 100);
        return { texto: `${pct}%`, nivel: pct >= 80 ? 'ok' : pct >= 60 ? 'medio' : 'bajo' };
      },
    },
  ],

  fields: [
    // Una actividad se programa antes de que ocurra: admite fecha adelante.
    { name: 'fecha', label: 'Fecha', type: 'date', required: true, futuro: true },
    {
      name: 'cuerpos', label: 'Cuerpos convocados', type: 'multiref', ref: 'cuerpos', required: true,
      help: 'A una actividad puede asistir más de un cuerpo. Se pasará lista a los integrantes de todos los elegidos.',
    },
    {
      name: 'tipo_reunion', label: 'Actividad', type: 'select', required: true,
      // La que viene elegida se fija en Configuración; si la guardada ya no
      // existe en la lista, se usa la primera y no una que el select no ofrece.
      get default() {
        const suya = require('../ajustes').obtener('asistencia_actividad_defecto');
        return TIPOS_DE_ACTIVIDAD.includes(suya) ? suya : TIPOS_DE_ACTIVIDAD[0];
      },
      options: TIPOS_DE_ACTIVIDAD,
    },
    {
      name: 'nombre', label: 'Nombre de la actividad', type: 'text',
      help: 'Opcional: cómo se llamó esta actividad («Jornada de jóvenes», «Encuentro de varones»). '
        + 'En blanco, se reconoce por su tipo y su cuerpo.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma del cuerpo elegido.',
    },
    { name: 'hora_inicio', label: 'Hora', type: 'time' },
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { existing, db }) {
      const ids = idsDeCuerpos(data.cuerpos !== undefined ? data.cuerpos : existing ? existing.cuerpos : null);
      if (!ids.length) return 'Indique al menos un cuerpo convocado a la actividad';
      // La iglesia se toma del primer cuerpo, para que la actividad y sus
      // integrantes queden en la misma congregación
      const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(ids[0]);
      if (cuerpo && cuerpo.iglesia_id) data.iglesia_id = cuerpo.iglesia_id;
      return null;
    },

    /** Si cambia la fecha, las marcas ya tomadas quedan al día. */
    afterSave(fila, { db }) {
      db.prepare('UPDATE asistencia_detalle SET fecha = ?, iglesia_id = ? WHERE asistencia_id = ?')
        .run(fila.fecha, fila.iglesia_id || null, fila.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(fila.id);
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm, can }) {
    /**
     * Actividades a las que hay que pasar lista, para la pantalla de toma de
     * asistencia: las de los últimos dos meses y las que vienen, con cuántos
     * integrantes convoca cada una y cuántos van marcados.
     *
     * Es lo primero que se abre desde el teléfono, así que responde todo lo
     * necesario de una vez: no hace falta entrar a cada actividad para saber
     * cuál falta.
     */
    /**
     * La agenda de asistencia: las actividades de un período —normalmente el
     * mes que se está mirando en el calendario—, con cuántos integrantes
     * convoca cada una y cuántos van marcados.
     *
     * Es lo que alimenta el módulo de Asistencia completo, así que responde
     * de una vez todo lo que la pantalla necesita: no hace falta entrar a
     * cada actividad para saber cuál falta ni quién puede marcarla.
     */
    router.get('/asistencias/agenda', requirePerm('asistencias', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const params = [];
      const cond = [];
      if (req.query.desde) {
        cond.push('fecha >= ?');
        params.push(String(req.query.desde).slice(0, 10));
      }
      if (req.query.hasta) {
        cond.push('fecha <= ?');
        params.push(String(req.query.hasta).slice(0, 10));
      }
      if (req.query.tipo) {
        cond.push('tipo_reunion = ?');
        params.push(String(req.query.tipo));
      }
      if (req.query.cuerpo_id) {
        cond.push('EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value = ?)');
        params.push(Number(req.query.cuerpo_id));
      }
      const suyo = alcance.condiciones(module.exports, req.user, params);
      if (suyo) cond.push(suyo);

      const filas = db
        .prepare(
          `SELECT * FROM asistencias ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
            ORDER BY fecha DESC, hora_inicio DESC LIMIT 400`
        )
        .all(...params);

      const nombreCuerpo = db.prepare('SELECT id, nombre FROM cuerpos WHERE id = ?');
      const actividades = filas.map((a) => {
        const c = conteo(a.id, db);
        return {
          id: a.id,
          fecha: a.fecha,
          hora_inicio: a.hora_inicio || null,
          tipo_reunion: a.tipo_reunion,
          nombre: a.nombre || null,
          lugar: a.lugar || null,
          observaciones: a.observaciones || null,
          iglesia_id: a.iglesia_id || null,
          cuerpos: idsDeCuerpos(a.cuerpos).map((id) => nombreCuerpo.get(id)).filter(Boolean),
          convocados: integrantesConvocados(a, db).size,
          marcados: c.total,
          presentes: c.presentes,
          ausentes: c.ausentes,
          justificados: c.justificados,
        };
      });

      res.json({
        actividades,
        tipos: TIPOS_DE_ACTIVIDAD,
        puede_marcar: can(req.user, 'asistencia_detalle', 'create') && can(req.user, 'asistencia_detalle', 'edit'),
        puede_crear: can(req.user, 'asistencias', 'create'),
        puede_editar: can(req.user, 'asistencias', 'edit'),
        puede_eliminar: can(req.user, 'asistencias', 'delete'),
      });
    });

    /**
     * Integrantes de todos los cuerpos convocados, con la marca que ya
     * tengan. Quien pertenece a dos de esos cuerpos aparece una sola vez.
     */
    router.get('/asistencias/:id(\\d+)/lista', requirePerm('asistencias', 'view'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!require('../alcance').alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const leTocan = cuerposQueLeTocan(actividad, req.user);
      const convocados = integrantesConvocados(actividad, db, req.user);
      const marcas = db.prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ?').all(actividad.id);
      const porMiembro = new Map(marcas.map((m) => [m.miembro_id, m]));

      // Quien ya tiene marca pero salió del cuerpo se sigue mostrando, siempre
      // que su marca sea de un cuerpo que a esta persona le toque pasar
      const suyos = require('../alcance').cuerposDe(req.user);
      for (const m of marcas) {
        if (convocados.has(m.miembro_id)) continue;
        if (suyos.length && !suyos.includes(Number(m.cuerpo_id))) continue;
        const cuerpo = m.cuerpo_id ? db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(m.cuerpo_id) : null;
        convocados.set(m.miembro_id, {
          cuerpo_id: m.cuerpo_id || null,
          cuerpo: cuerpo ? `${cuerpo.nombre} (ya no figura)` : 'Sin cuerpo',
        });
      }

      const personas = [...convocados.entries()]
        .map(([id, donde]) => {
          const p = db.prepare('SELECT id, nombres, apellidos, rut, foto FROM miembros WHERE id = ?').get(id);
          if (!p) return null;
          const marca = porMiembro.get(id) || {};
          return {
            miembro_id: p.id,
            nombre: nombres.paraMostrar(p.nombres, p.apellidos),
            rut: p.rut || null,
            foto: p.foto || null,
            cuerpo_id: donde.cuerpo_id,
            cuerpo: donde.cuerpo,
            estado: marca.estado || null,
            motivo: marca.motivo || null,
            detalle: marca.detalle || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.cuerpo || '').localeCompare(b.cuerpo || '') || a.nombre.localeCompare(b.nombre));

      const cuerpos = leTocan.map((id) => {
        const c = db.prepare('SELECT id, nombre FROM cuerpos WHERE id = ?').get(id);
        return c ? { id: c.id, nombre: c.nombre } : null;
      }).filter(Boolean);
      // Cuando la actividad convoca a más cuerpos de los que le tocan, se dice
      const convocadosEnTotal = idsDeCuerpos(actividad.cuerpos).length;

      res.json({
        actividad: {
          id: actividad.id, fecha: actividad.fecha, tipo: actividad.tipo_reunion,
          cuerpos,
          solo_los_suyos: cuerpos.length < convocadosEnTotal,
          cuerpos_convocados: convocadosEnTotal,
        },
        personas,
        motivos_con_detalle: MOTIVOS_CON_DETALLE,
        puede_marcar: can(req.user, 'asistencia_detalle', 'create') && can(req.user, 'asistencia_detalle', 'edit'),
      });
    });

    /**
     * Guarda de una vez todas las marcas de la actividad.
     *
     * Se rige por el permiso de "Toma de Asistencia", no por el de crear
     * actividades: quien solo pasa lista no necesita poder crearlas.
     *
     * IMPORTANTE — se mandan **solo las marcas que esa persona cambió**, no la
     * lista entera. Cada marca que llega manda sobre lo guardado para esa
     * persona: con estado, se anota; sin estado, se borra. Si se mandara la
     * lista completa, quien la abrió antes borraría en blanco todo lo que otro
     * hubiera marcado mientras tanto —dos secretarios pasando la misma lista, o
     * la misma persona con el teléfono y el computador abiertos—.
     *
     * La respuesta trae cómo quedó la lista, para que la pantalla se ponga al
     * día con lo que hayan hecho los demás.
     */
    router.post('/asistencias/:id(\\d+)/lista', requirePerm('asistencia_detalle', 'edit'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!require('../alcance').alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const marcas = Array.isArray(req.body && req.body.marcas) ? req.body.marcas : null;
      if (!marcas) return res.status(400).json({ error: 'No se recibió ninguna marca' });

      const validos = ['Presente', 'Ausente', 'Justificado'];
      for (const m of marcas) {
        if (!m.miembro_id) return res.status(400).json({ error: 'Falta indicar a quién corresponde una de las marcas' });
        if (m.estado && !validos.includes(m.estado)) {
          return res.status(400).json({ error: `Estado no válido: ${m.estado}` });
        }
        if (m.estado === 'Justificado') {
          if (!m.motivo) return res.status(400).json({ error: 'Indique el motivo de cada justificación' });
          if (MOTIVOS_CON_DETALLE.includes(m.motivo) && !String(m.detalle || '').trim()) {
            return res.status(400).json({ error: `El motivo "${m.motivo}" necesita que se especifique el detalle` });
          }
        }
      }

      // A qué cuerpo pertenece cada persona en esta actividad (no se toma del
      // cliente: se resuelve aquí, con los cuerpos que le tocan a quien marca)
      const convocados = integrantesConvocados(actividad, db, req.user);

      /**
       * Y no se acepta una marca de alguien que no está convocado.
       *
       * Esta comprobación existía, pero corría dentro de un `if (suyos.length)`:
       * solo se le hacía a quien tiene cuerpos asignados. A la cuenta de
       * administrador —que no tiene ninguno, a propósito— no se le comprobaba
       * nada. Se midió lo que eso permitía:
       *
       *   marcar a un miembro de OTRA iglesia ...  se guardaba, y con la
       *                                            iglesia de la actividad
       *   marcar al miembro número 999999 .......  se guardaba, y sumaba en
       *                                            el porcentaje de asistencia
       *
       * Nadie llega a eso haciendo clic —la pantalla solo muestra a los
       * convocados—, pero es la misma raíz que dejaba datos colgando: lo que
       * la pantalla no ofrece, el servidor igual lo aceptaba. Y ensuciaba
       * justo el dato que después se lee como porcentaje.
       *
       * La regla ahora vale para todos: se marca a quien está convocado en los
       * cuerpos que a uno le tocan. La excepción es corregir una marca que ya
       * está puesta —de un cuerpo que después salió de la actividad, o de
       * alguien que desde entonces se retiró—, porque quitar esa marca es
       * justamente lo que hay que poder hacer.
       */
      const suyos = require('../alcance').cuerposDe(req.user);
      const yaMarcados = new Map(
        db.prepare('SELECT miembro_id, cuerpo_id FROM asistencia_detalle WHERE asistencia_id = ?')
          .all(actividad.id)
          .map((m) => [Number(m.miembro_id), Number(m.cuerpo_id)])
      );
      const ajeno = marcas.find((m) => {
        const id = Number(m.miembro_id);
        if (convocados.has(id)) return false;
        if (!yaMarcados.has(id)) return true; // ni convocado ni marcado antes
        return suyos.length ? !suyos.includes(yaMarcados.get(id)) : false;
      });
      if (ajeno) {
        const quien = db
          .prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?')
          .get(Number(ajeno.miembro_id));
        if (!quien) {
          return res.status(400).json({
            error: `Hay una marca de una persona que no está en el sistema (n.º ${ajeno.miembro_id}).`,
          });
        }
        const nombre = require('../nombres').paraMostrar(quien.nombres, quien.apellidos);
        return res.status(403).json({
          error: suyos.length
            ? `${nombre} no es de los cuerpos que tiene asignados. Solo puede pasar lista a los suyos.`
            : `${nombre} no está en ninguno de los cuerpos convocados a esta actividad.`,
        });
      }
      const guardar = db.transaction(() => {
        const borrar = db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ?');
        const insertar = db.prepare(
          `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, motivo, detalle,
                                           cuerpo_id, fecha, iglesia_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        let guardadas = 0;
        for (const m of marcas) {
          borrar.run(actividad.id, m.miembro_id);
          if (!m.estado) continue; // sin marcar: no queda fila
          const justificado = m.estado === 'Justificado';
          const donde = convocados.get(Number(m.miembro_id));
          insertar.run(
            actividad.id, m.miembro_id, m.estado,
            justificado ? m.motivo : null,
            justificado && MOTIVOS_CON_DETALLE.includes(m.motivo) ? String(m.detalle).trim() : null,
            (donde && donde.cuerpo_id) || yaMarcados.get(Number(m.miembro_id)) || null,
            actividad.fecha, actividad.iglesia_id || null, req.user.id
          );
          guardadas++;
        }
        return guardadas;
      });

      const guardadas = guardar.immediate();
      // Se devuelve cómo quedó la lista completa: así, si mientras esta
      // persona marcaba lo suyo otra marcó lo de ella, la pantalla lo muestra
      // en vez de quedarse con una foto vieja.
      res.json({
        ok: true,
        guardadas,
        marcas: marcasVisibles(actividad, db, req.user),
        ...conteo(actividad.id, db, suyos),
      });
    });

    // ---- La planilla mensual de un cuerpo ----
    /**
     * La planilla mensual de un cuerpo: una columna por día del mes, para
     * imprimir apaisada. El cálculo está en server/planilla-asistencia.js;
     * acá se comprueba lo que se pide y quién lo pide.
     */
    router.get('/asistencias/hoja-mensual', requirePerm('asistencias', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const planillaDeAsistencia = require('../planilla-asistencia');

      const cuerpoId = Number(req.query.cuerpo_id);
      const mes = String(req.query.mes || '').slice(0, 7); // AAAA-MM
      if (!cuerpoId) return res.status(400).json({ error: 'Falta indicar el cuerpo.' });
      if (!planillaDeAsistencia.mesValido(mes)) {
        return res.status(400).json({ error: 'El mes se indica como AAAA-MM (por ejemplo 2026-04).' });
      }

      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.status(404).json({ error: 'Ese cuerpo no existe.' });
      // El mismo alcance del resto —iglesia y cuerpo—: no se mira la planilla
      // de un cuerpo ajeno. `getModule` se pide acá y no arriba para no cerrar
      // un ciclo con el registro de módulos.
      const { getModule } = require('../registry'); // tardío: evita ciclo con el registro
      if (!alcance.alcanza(getModule('cuerpos'), cuerpo, req.user)) {
        return res.status(403).json({ error: 'No tiene acceso a ese cuerpo.' });
      }

      res.json(planillaDeAsistencia.armar(db, cuerpo, mes));
    });

    // ---- Informes y promedios ----
    router.get('/asistencias/informe', requirePerm('asistencias', 'view'), (req, res) => {
      const { tipo = 'general', desde, hasta } = req.query;
      const cuerpoId = req.query.cuerpo_id ? Number(req.query.cuerpo_id) : null;
      const miembroId = req.query.miembro_id ? Number(req.query.miembro_id) : null;

      const cond = ['1 = 1'];
      const params = [];
      const alcance = require('../alcance');
      const suyas = alcance.iglesiasDe(req.user);
      if (suyas.length) {
        cond.push(`d.iglesia_id IN (${suyas.map(() => '?').join(',')})`);
        params.push(...suyas);
      }
      const susCuerpos = alcance.cuerposDe(req.user);
      if (susCuerpos.length) {
        cond.push(`d.cuerpo_id IN (${susCuerpos.map(() => '?').join(',')})`);
        params.push(...susCuerpos);
      }
      if (desde) { cond.push('d.fecha >= ?'); params.push(desde); }
      if (hasta) { cond.push('d.fecha <= ?'); params.push(hasta); }
      if (cuerpoId) { cond.push('d.cuerpo_id = ?'); params.push(cuerpoId); }
      if (miembroId) { cond.push('d.miembro_id = ?'); params.push(miembroId); }
      const where = 'WHERE ' + cond.join(' AND ');

      const porcentajes = (f) => {
        const total = f.presentes + f.ausentes + f.justificados;
        const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
        return {
          ...f, total,
          pct_presente: pct(f.presentes),
          pct_ausente: pct(f.ausentes),
          pct_justificado: pct(f.justificados),
        };
      };
      const SUMAS = `
        COALESCE(SUM(CASE WHEN d.estado = 'Presente'    THEN 1 ELSE 0 END), 0) AS presentes,
        COALESCE(SUM(CASE WHEN d.estado = 'Ausente'     THEN 1 ELSE 0 END), 0) AS ausentes,
        COALESCE(SUM(CASE WHEN d.estado = 'Justificado' THEN 1 ELSE 0 END), 0) AS justificados`;

      const general = porcentajes(
        db.prepare(`SELECT ${SUMAS}, COUNT(DISTINCT d.asistencia_id) AS actividades,
                           COUNT(DISTINCT d.miembro_id) AS personas
                      FROM asistencia_detalle d ${where}`).get(...params)
      );

      const porDia = db
        .prepare(`SELECT d.fecha, ${SUMAS}, COUNT(DISTINCT d.asistencia_id) AS actividades
                    FROM asistencia_detalle d ${where}
                   GROUP BY d.fecha ORDER BY d.fecha DESC LIMIT 400`)
        .all(...params)
        .map(porcentajes);

      // Una por una: en un mismo día puede haber varias actividades, y quien
      // pertenece a varios cuerpos puede estar en una y faltar a otra.
      const porActividad = db
        .prepare(`SELECT d.asistencia_id, d.fecha, a.tipo_reunion AS actividad, ${SUMAS}
                    FROM asistencia_detalle d LEFT JOIN asistencias a ON a.id = d.asistencia_id
                   ${where} GROUP BY d.asistencia_id ORDER BY d.fecha DESC, d.asistencia_id DESC LIMIT 400`)
        .all(...params)
        .map(porcentajes);

      const porCuerpo = db
        .prepare(`SELECT d.cuerpo_id, c.nombre AS cuerpo, ${SUMAS},
                         COUNT(DISTINCT d.asistencia_id) AS actividades
                    FROM asistencia_detalle d LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                   ${where} GROUP BY d.cuerpo_id ORDER BY c.nombre`)
        .all(...params)
        .map(porcentajes);

      const porMiembro = db
        .prepare(`SELECT d.miembro_id, m.nombres, m.apellidos, m.rut, ${SUMAS}
                    FROM asistencia_detalle d LEFT JOIN miembros m ON m.id = d.miembro_id
                   ${where} GROUP BY d.miembro_id ORDER BY m.apellidos, m.nombres`)
        .all(...params)
        .map((f) => porcentajes({ ...f, miembro: nombres.paraMostrar(f.nombres, f.apellidos) }));

      const porMotivo = db
        .prepare(`SELECT COALESCE(d.motivo, 'Sin motivo') AS motivo, COUNT(*) AS n
                    FROM asistencia_detalle d ${where} AND d.estado = 'Justificado'
                   GROUP BY d.motivo ORDER BY n DESC`)
        .all(...params);

      // Cuando alguien pertenece a varios cuerpos, su porcentaje se abre por
      // cuerpo: en uno puede andar al día y en otro no.
      let porMiembroCuerpo = [];
      if (miembroId) {
        porMiembroCuerpo = db
          .prepare(`SELECT d.cuerpo_id, c.nombre AS cuerpo, ${SUMAS},
                           COUNT(DISTINCT d.asistencia_id) AS actividades
                      FROM asistencia_detalle d LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                     ${where} GROUP BY d.cuerpo_id ORDER BY c.nombre`)
          .all(...params)
          .map(porcentajes);
      }

      // En el informe por persona se detallan sus marcas una por una
      let marcas = [];
      if (tipo === 'persona' && miembroId) {
        marcas = db
          .prepare(`SELECT d.fecha, d.estado, d.motivo, d.detalle, a.tipo_reunion AS actividad, c.nombre AS cuerpo
                      FROM asistencia_detalle d
                      LEFT JOIN asistencias a ON a.id = d.asistencia_id
                      LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                     ${where} ORDER BY d.fecha DESC LIMIT 500`)
          .all(...params);
      }

      res.json({
        tipo, desde: desde || null, hasta: hasta || null,
        general, porDia, porActividad, porCuerpo, porMiembro, porMiembroCuerpo, porMotivo, marcas,
      });
    });
  },
};
