/**
 * Módulo: Asistencias (la asistencia se toma por cuerpo, en cada actividad).
 *
 * Cada registro es una actividad de un cuerpo o grupo —su reunión, un ensayo,
 * una salida— con la fecha y el lugar. La lista nominal de quién estuvo se
 * guarda en "Detalle de Asistencias": una fila por integrante, con su estado
 * (Presente, Ausente o Justificado) y el motivo cuando corresponde.
 *
 * Al pie de cada actividad está "Pasar lista", que muestra a los integrantes
 * del cuerpo y permite marcarlos a todos de una vez.
 *
 * Rutas propias:
 *   GET  /asistencias/:id/lista   integrantes del cuerpo con su marca
 *   POST /asistencias/:id/lista   guarda todas las marcas de una vez
 *   GET  /asistencias/informe     informes y promedios (general, por cuerpo,
 *                                 por persona)
 */
const MOTIVOS_CON_DETALLE = ['Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];

/** Cuenta las marcas de una actividad. */
function conteo(asistenciaId, db) {
  const filas = db
    .prepare('SELECT estado, COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ? GROUP BY estado')
    .all(asistenciaId);
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
  group: 'Personas',
  order: 22,
  display: '{tipo_reunion} — {fecha}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['tipo_reunion', 'lugar', 'observaciones'],
  listFields: ['fecha', 'cuerpo_id', 'tipo_reunion', 'presentes', 'ausentes', 'justificados', 'porcentaje'],
  filterFields: ['cuerpo_id', 'tipo_reunion'],
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
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', required: true,
      help: 'La asistencia se toma por cuerpo: aquí se elige de cuál se pasará lista.',
    },
    {
      name: 'tipo_reunion', label: 'Actividad', type: 'select', required: true, default: 'Reunión de cuerpo',
      options: [
        'Reunión de cuerpo', 'Ensayo', 'Culto general', 'Escuela Dominical', 'Culto de oración',
        'Ayuno', 'Estudio bíblico', 'Vigilia', 'Evangelismo', 'Actividad especial', 'Otra',
      ],
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
      // La iglesia se toma del cuerpo, para que la lista y el cuerpo calcen
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing ? existing.cuerpo_id : null;
      if (cuerpoId) {
        const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (cuerpo && cuerpo.iglesia_id) data.iglesia_id = cuerpo.iglesia_id;
      }
      return null;
    },

    /** Si cambia la fecha o el cuerpo, las marcas quedan al día. */
    afterSave(fila, { db }) {
      db.prepare('UPDATE asistencia_detalle SET fecha = ?, cuerpo_id = ?, iglesia_id = ? WHERE asistencia_id = ?')
        .run(fila.fecha, fila.cuerpo_id || null, fila.iglesia_id || null, fila.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(fila.id);
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /** Integrantes del cuerpo de una actividad, con la marca que ya tengan. */
    router.get('/asistencias/:id(\\d+)/lista', requirePerm('asistencias', 'view'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (req.user.iglesia_id && actividad.iglesia_id !== req.user.iglesia_id) {
        return res.status(403).json({ error: 'Actividad fuera de su iglesia asignada' });
      }

      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(actividad.cuerpo_id);
      let ids = [];
      if (cuerpo) {
        try {
          ids = JSON.parse(cuerpo.integrantes || '[]').map(Number).filter(Boolean);
        } catch (e) {
          ids = [];
        }
        if (cuerpo.lider_id && !ids.includes(cuerpo.lider_id)) ids.unshift(cuerpo.lider_id);
      }

      const marcas = db.prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ?').all(actividad.id);
      const porMiembro = new Map(marcas.map((m) => [m.miembro_id, m]));
      // Quien ya tiene marca pero salió del cuerpo se sigue mostrando
      for (const m of marcas) if (!ids.includes(m.miembro_id)) ids.push(m.miembro_id);

      const personas = ids
        .map((id) => {
          const p = db.prepare('SELECT id, nombres, apellidos, rut, foto FROM miembros WHERE id = ?').get(id);
          if (!p) return null;
          const marca = porMiembro.get(id) || {};
          return {
            miembro_id: p.id,
            nombre: `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
            rut: p.rut || null,
            foto: p.foto || null,
            estado: marca.estado || null,
            motivo: marca.motivo || null,
            detalle: marca.detalle || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

      res.json({
        actividad: {
          id: actividad.id, fecha: actividad.fecha, tipo: actividad.tipo_reunion,
          cuerpo: cuerpo ? cuerpo.nombre : null, cuerpo_id: actividad.cuerpo_id,
        },
        personas,
        motivos_con_detalle: MOTIVOS_CON_DETALLE,
      });
    });

    /** Guarda de una vez todas las marcas de la actividad. */
    router.post('/asistencias/:id(\\d+)/lista', requirePerm('asistencias', 'edit'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (req.user.iglesia_id && actividad.iglesia_id !== req.user.iglesia_id) {
        return res.status(403).json({ error: 'Actividad fuera de su iglesia asignada' });
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
          insertar.run(
            actividad.id, m.miembro_id, m.estado,
            justificado ? m.motivo : null,
            justificado && MOTIVOS_CON_DETALLE.includes(m.motivo) ? String(m.detalle).trim() : null,
            actividad.cuerpo_id || null, actividad.fecha, actividad.iglesia_id || null, req.user.id
          );
          guardadas++;
        }
        return guardadas;
      });

      const guardadas = guardar();
      res.json({ ok: true, guardadas, ...conteo(actividad.id, db) });
    });

    // ---- Informes y promedios ----
    router.get('/asistencias/informe', requirePerm('asistencias', 'view'), (req, res) => {
      const { tipo = 'general', desde, hasta } = req.query;
      const cuerpoId = req.query.cuerpo_id ? Number(req.query.cuerpo_id) : null;
      const miembroId = req.query.miembro_id ? Number(req.query.miembro_id) : null;

      const cond = ['1 = 1'];
      const params = [];
      if (req.user.iglesia_id) {
        cond.push('d.iglesia_id = ?');
        params.push(req.user.iglesia_id);
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
        .prepare(`SELECT d.fecha, ${SUMAS} FROM asistencia_detalle d ${where}
                  GROUP BY d.fecha ORDER BY d.fecha DESC LIMIT 400`)
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
        .prepare(`SELECT d.miembro_id, (m.nombres || ' ' || m.apellidos) AS miembro, m.rut, ${SUMAS}
                    FROM asistencia_detalle d LEFT JOIN miembros m ON m.id = d.miembro_id
                   ${where} GROUP BY d.miembro_id ORDER BY m.apellidos, m.nombres`)
        .all(...params)
        .map(porcentajes);

      const porMotivo = db
        .prepare(`SELECT COALESCE(d.motivo, 'Sin motivo') AS motivo, COUNT(*) AS n
                    FROM asistencia_detalle d ${where} AND d.estado = 'Justificado'
                   GROUP BY d.motivo ORDER BY n DESC`)
        .all(...params);

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

      res.json({ tipo, desde: desde || null, hasta: hasta || null, general, porDia, porCuerpo, porMiembro, porMotivo, marcas });
    });
  },
};
