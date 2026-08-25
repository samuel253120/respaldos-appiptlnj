/**
 * Módulo: Perfiles de permisos.
 *
 * Un perfil es un juego de permisos con nombre —«Tesorero de cuerpo»,
 * «Secretario de cuerpo»— que se arma una vez y se le asigna a las personas
 * que hacen ese trabajo.
 *
 * El perfil queda ENLAZADO al usuario, no copiado: si mañana se decide que
 * los tesoreros de cuerpo también vean las actas, se cambia el perfil y
 * cambian todos los que lo tienen puesto, sin abrir uno por uno. Para las
 * excepciones —una persona que además necesita algo que su perfil no da— los
 * permisos propios del usuario siguen mandando por encima del perfil.
 *
 * El orden es siempre el mismo, de lo más particular a lo más general:
 *
 *   permisos propios del usuario  →  perfil asignado  →  rol
 *
 * Un perfil que alguien está usando no se puede eliminar: primero hay que
 * sacárselo, para que nadie se quede sin permisos sin darse cuenta.
 */
module.exports = {
  name: 'perfiles_permisos',
  label: 'Perfiles de Permisos',
  labelSingular: 'Perfil de permisos',
  icon: '🎭',
  group: 'Sistema',
  order: 73,
  display: '{nombre}',
  searchFields: ['nombre', 'descripcion'],
  listFields: ['nombre', 'descripcion', 'cuantos_usuarios', 'estado'],
  filterFields: ['estado'],
  defaultSort: { field: 'nombre', dir: 'asc' },

  computed: [
    {
      name: 'cuantos_usuarios', label: 'Usuarios', type: 'texto',
      calc: (fila, { db }) => {
        const n = db.prepare('SELECT COUNT(*) c FROM usuarios WHERE perfil_id = ?').get(fila.id).c;
        return n === 0 ? 'Nadie todavía' : n === 1 ? '1 usuario' : `${n} usuarios`;
      },
    },
  ],

  fields: [
    {
      name: 'nombre', label: 'Nombre del perfil', type: 'text', required: true, unique: true,
      seccion: 'Qué perfil es',
      help: 'Cómo se le dice al trabajo que hace esta persona. Ej: «Tesorero de cuerpo», «Secretaria de cuerpo».',
    },
    {
      name: 'descripcion', label: 'Para qué sirve', type: 'text',
      help: 'Una línea que explique a quién se le pone este perfil.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Activo',
      options: ['Activo', 'Archivado'],
      help: 'Un perfil archivado ya no se ofrece al asignar, pero sigue funcionando para quienes ya lo tienen.',
    },
    {
      name: 'permisos', label: 'Qué puede hacer quien tenga este perfil', type: 'permisos',
      seccion: 'Los permisos',
    },
  ],

  hooks: {
    beforeDelete(fila, { db }) {
      const usando = db.prepare('SELECT COUNT(*) c FROM usuarios WHERE perfil_id = ?').get(fila.id).c;
      if (usando) {
        return `No se puede eliminar: ${usando} usuario(s) tienen este perfil. ` +
          'Cámbieles el perfil primero, o archívelo en vez de eliminarlo.';
      }
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /** Quiénes tienen puesto este perfil, para verlos y sacárselos desde acá. */
    router.get('/perfiles_permisos/:id(\\d+)/usuarios', requirePerm('perfiles_permisos', 'view'), (req, res) => {
      const perfil = db.prepare('SELECT * FROM perfiles_permisos WHERE id = ?').get(req.params.id);
      if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
      const suyos = db
        .prepare(
          `SELECT u.id, u.nombre, u.rut, u.rol, u.activo,
                  (SELECT nombre FROM iglesias WHERE id = u.iglesia_id) AS iglesia
             FROM usuarios u WHERE u.perfil_id = ? ORDER BY u.nombre`
        )
        .all(perfil.id);
      const libres = db
        .prepare(
          `SELECT id, nombre, rut, rol FROM usuarios
            WHERE (perfil_id IS NULL OR perfil_id != ?) AND rol != 'admin'
            ORDER BY nombre`
        )
        .all(perfil.id);
      res.json({ perfil: { id: perfil.id, nombre: perfil.nombre }, usuarios: suyos, disponibles: libres });
    });

    /** Ponerle este perfil a uno o varios usuarios de una vez. */
    router.post('/perfiles_permisos/:id(\\d+)/usuarios', requirePerm('usuarios', 'edit'), (req, res) => {
      const perfil = db.prepare('SELECT * FROM perfiles_permisos WHERE id = ?').get(req.params.id);
      if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
      const ids = Array.isArray(req.body && req.body.usuarios) ? req.body.usuarios.map(Number).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: 'Elija al menos un usuario' });

      const poner = db.prepare(
        "UPDATE usuarios SET perfil_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND rol != 'admin'"
      );
      let puestos = 0;
      for (const id of ids) puestos += poner.run(perfil.id, id).changes;
      res.json({ puestos });
    });

    /** Y sacárselo a uno. */
    router.delete('/perfiles_permisos/:id(\\d+)/usuarios/:usuario(\\d+)', requirePerm('usuarios', 'edit'), (req, res) => {
      const r = db
        .prepare("UPDATE usuarios SET perfil_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND perfil_id = ?")
        .run(req.params.usuario, req.params.id);
      if (!r.changes) return res.status(404).json({ error: 'Ese usuario no tiene puesto este perfil' });
      res.json({ ok: true });
    });
  },
};
