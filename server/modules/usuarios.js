/**
 * Módulo: Usuarios del sistema.
 *
 * El identificador de acceso es el RUT: no cambia y es único por persona
 * (el correo electrónico sí puede cambiar, por eso es solo un dato de
 * contacto). El RUT se valida con su dígito verificador y se guarda
 * normalizado como "12345678-9".
 *
 * - La contraseña se cifra con bcrypt antes de guardar (hook beforeSave):
 *   el sistema nunca la guarda en claro, ni siquiera para el administrador.
 * - Al crear una cuenta sin escribir contraseña, se le entrega la CONTRASEÑA
 *   INICIAL definida en Configuración → Acceso. Igual que una escrita a mano
 *   por el administrador, obliga a cambiarla en el primer ingreso: una
 *   contraseña que otro conoce no es suya.
 * - Al editar, dejar la contraseña vacía la mantiene sin cambios.
 * - No se puede eliminar el propio usuario ni el último administrador.
 *
 * Un usuario puede estar **enlazado a su ficha de miembro**: entonces los
 * datos que comparten —RUT, nombre, correo y teléfono— se mantienen iguales
 * en los dos módulos, se cambien donde se cambien. El nombre se escribe en
 * Miembros, que es donde va separado en nombres y apellidos.
 *
 * Alcance: a cada usuario se le puede asignar **una o varias iglesias** y,
 * dentro de ellas, **uno o varios cuerpos**. Solo ve y administra los datos de
 * lo que tenga asignado; sin iglesias asignadas ve todas, y sin cuerpos
 * asignados ve todos los de sus iglesias (ver server/alcance.js).
 */
const bcrypt = require('bcryptjs');
const { ROLES } = require('../permissions');

module.exports = {
  name: 'usuarios',
  label: 'Usuarios',
  labelSingular: 'Usuario',
  icon: '🔐',
  group: 'Administración',
  order: 90,
  display: '{nombre}',
  searchFields: ['nombre', 'rut', 'email'],
  listFields: ['rut', 'nombre', 'rol', 'miembro_id', 'iglesias', 'cuerpos', 'activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'rut', label: 'RUT (usuario de acceso)', type: 'rut', required: true, unique: true,
      help: 'Con o sin puntos, con guion y dígito verificador. Ej: 12.345.678-5',
    },
    {
      name: 'nombre', label: 'Nombre completo', type: 'text', required: true,
      help: 'Si está enlazado a una ficha de miembro, el nombre se toma de allá (donde va separado en nombres y apellidos).',
    },
    {
      name: 'miembro_id', label: 'Su ficha de miembro', type: 'ref', ref: 'miembros',
      help: 'Enlazándolo, el RUT, el nombre, el correo y el teléfono quedan iguales en los dos módulos. Si tienen el mismo RUT, el sistema la reconoce sola.',
    },
    {
      name: 'password', label: 'Contraseña', type: 'password',
      help: 'Déjelo vacío y se le entrega la contraseña inicial del sistema. Al entrar, la persona tendrá que cambiarla por una suya.',
    },

    // --- Estado del acceso: lo maneja el sistema, no se escribe a mano ---
    { name: 'debe_cambiar_password', label: 'Debe cambiar la contraseña', type: 'boolean', oculto: true },
    { name: 'password_origen', label: 'Origen de la contraseña', type: 'text', oculto: true },
    { name: 'password_cambiada_en', label: 'Contraseña cambiada el', type: 'text', oculto: true },
    { name: 'pregunta_secreta', label: 'Pregunta de recuperación', type: 'text', oculto: true },
    // Se guarda cifrada y nunca sale del servidor: el motor no devuelve los
    // campos de tipo contraseña
    { name: 'respuesta_secreta', label: 'Respuesta de recuperación', type: 'password', oculto: true },
    { name: 'recuperacion_intentos', label: 'Intentos de recuperación', type: 'number', oculto: true },
    {
      name: 'rol', label: 'Rol', type: 'select', required: true, default: 'consulta',
      options: ROLES.map((r) => ({ value: r.value, label: r.label })),
    },
    {
      name: 'iglesias', label: 'Iglesias que administra', type: 'multiref', ref: 'iglesias',
      help: 'Solo verá los datos de estas iglesias. Sin ninguna marcada, ve todas.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia principal', type: 'ref', ref: 'iglesias',
      help: 'Con cuál trabaja por omisión (la que se propone al crear registros). Tiene que estar entre las de arriba.',
    },
    {
      name: 'cuerpos', label: 'Cuerpos que administra', type: 'multiref', ref: 'cuerpos',
      help: 'Opcional. Marcando alguno, dentro de sus iglesias solo verá lo de esos cuerpos: sus integrantes, actividades, actas, inventario y directivas. Sin ninguno, ve todos los de sus iglesias.',
    },
    { name: 'email', label: 'Correo electrónico (contacto, opcional)', type: 'email' },
    { name: 'telefono', label: 'Teléfono (opcional)', type: 'tel' },
    { name: 'activo', label: 'Activo', type: 'boolean', default: 1 },
    {
      name: 'perfil_id', label: 'Perfil de permisos', type: 'ref', ref: 'perfiles_permisos',
      optionsRoute: '/perfiles_permisos/activos',
      seccion: 'Qué puede hacer',
      help:
        'El trabajo que hace esta persona: «Tesorero de cuerpo», «Secretaria de cuerpo»… El perfil queda ' +
        'enlazado, así que si se cambia el perfil cambian todos los que lo tienen. En blanco, manda su rol.',
    },
    {
      name: 'permisos', label: 'Excepciones para esta persona', type: 'permisos',
      help:
        'Solo para lo que se salga de su perfil. Lo que se ajuste acá manda sobre el perfil y sobre el rol; ' +
        'lo que no, sigue lo que diga el perfil (o el rol, si no tiene perfil).',
    },
  ],
  extraRoutes(router, { db, requirePerm }) {
    const claves = require('../claves');

    /** Los perfiles que se pueden asignar hoy (los archivados no se ofrecen). */
    router.get('/perfiles_permisos/activos', (req, res) => {
      res.json(
        db.prepare("SELECT id, nombre AS label FROM perfiles_permisos WHERE estado = 'Activo' ORDER BY nombre").all()
      );
    });

    /** Cómo está el acceso de esta cuenta: su contraseña y su recuperación. */
    router.get('/usuarios/:id(\\d+)/clave', requirePerm('usuarios', 'view'), (req, res) => {
      const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
      if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
      res.json({
        nombre: usuario.nombre,
        rut: usuario.rut,
        clave: claves.estado(usuario),
        recuperacion: claves.estadoRecuperacion(usuario),
        puede_restablecer: require('../permissions').can(req.user, 'usuarios', 'edit'),
      });
    });

    /**
     * Restablece la cuenta a la contraseña inicial y la devuelve, para que el
     * administrador se la entregue a su dueño. Al entrar con ella, el sistema
     * le obligará a cambiarla.
     */
    router.post('/usuarios/:id(\\d+)/restablecer-clave', requirePerm('usuarios', 'edit'), (req, res) => {
      const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
      if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
      const clave = claves.restablecer(usuario.id);
      res.json({ ok: true, clave, nombre: usuario.nombre, rut: usuario.rut });
    });

    /** Vuelve a habilitar la recuperación bloqueada por intentos fallidos. */
    router.post('/usuarios/:id(\\d+)/desbloquear-recuperacion', requirePerm('usuarios', 'edit'), (req, res) => {
      const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(req.params.id);
      if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
      claves.desbloquearRecuperacion(usuario.id);
      res.json({ ok: true });
    });
  },

  hooks: {
    beforeSave(data, { isNew, id, existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const lista = (v) => {
        if (Array.isArray(v)) return v.map(Number).filter(Boolean);
        try {
          return JSON.parse(v || '[]').map(Number).filter(Boolean);
        } catch (e) {
          return [];
        }
      };

      const iglesias = lista(dato('iglesias'));
      const principal = dato('iglesia_id') ? Number(dato('iglesia_id')) : null;

      // La iglesia principal tiene que ser una de las asignadas
      if (principal && iglesias.length && !iglesias.includes(principal)) {
        const ig = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(principal);
        return `La iglesia principal (${ig ? ig.nombre : '#' + principal}) tiene que estar entre las iglesias que administra`;
      }
      // Con una sola iglesia asignada, esa queda de principal sin tener que repetirla
      if (!principal && iglesias.length === 1) data.iglesia_id = iglesias[0];

      // Los cuerpos asignados tienen que ser de sus iglesias
      const cuerpos = lista(dato('cuerpos'));
      if (cuerpos.length && iglesias.length) {
        for (const cuerpoId of cuerpos) {
          const c = db.prepare('SELECT nombre, iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
          if (c && c.iglesia_id && !iglesias.includes(Number(c.iglesia_id))) {
            return `El cuerpo "${c.nombre}" no pertenece a las iglesias que administra este usuario`;
          }
        }
      }

      // Enlace con su ficha de miembro: si no se indicó, se busca por RUT
      const rut = dato('rut');
      let enlace = dato('miembro_id');
      if (!enlace && rut) {
        const m = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut);
        if (m) {
          data.miembro_id = m.id;
          enlace = m.id;
        }
      }
      if (enlace) {
        const miembro = db.prepare('SELECT * FROM miembros WHERE id = ?').get(enlace);
        if (!miembro) return 'La ficha de miembro indicada no existe';

        // Al enlazar dos fichas que ya tienen RUT, tienen que ser el mismo:
        // si no, no son la misma persona. Una vez enlazadas, corregir el RUT
        // en cualquiera de las dos lo corrige también en la otra.
        const reciénEnlazado = !existing || Number(existing.miembro_id || 0) !== Number(enlace);
        if (reciénEnlazado && rut && miembro.rut && miembro.rut !== rut) {
          return `El RUT no coincide con el de su ficha de miembro (${miembro.nombres} ${miembro.apellidos}: ${miembro.rut}). ` +
            'Corrija el que esté equivocado, o enlace la ficha que corresponda.';
        }
        // El nombre se escribe en Miembros, que lo lleva separado
        data.nombre = `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim() || data.nombre;
        const otro = db.prepare('SELECT id, nombre FROM usuarios WHERE miembro_id = ? AND id != ?').get(enlace, id || 0);
        if (otro) return `Esa ficha de miembro ya está enlazada al usuario "${otro.nombre}"`;
      }

      if (data.email) {
        data.email = String(data.email).trim().toLowerCase();
        const dup = db
          .prepare('SELECT id FROM usuarios WHERE lower(email) = ? AND id != ?')
          .get(data.email, id || 0);
        if (dup) return 'Ya existe un usuario con ese correo electrónico';
      }
      // La contraseña: la que escriba el administrador, o la inicial del
      // sistema. En los dos casos la persona tendrá que cambiarla al entrar,
      // porque una contraseña que otro conoce no es suya.
      const claves = require('../claves');
      if (data.password) {
        const problema = claves.revisarLargo(data.password);
        if (problema) return problema;
        data.password = bcrypt.hashSync(String(data.password), 10);
        data.password_origen = 'definida';
        data.debe_cambiar_password = 1;
      } else if (isNew) {
        data.password = bcrypt.hashSync(claves.inicial(), 10);
        data.password_origen = 'inicial';
        data.debe_cambiar_password = 1;
      } else {
        delete data.password; // conservar la contraseña actual
      }
      return null;
    },
    /** Lo que cambió aquí se lleva a su ficha de miembro. */
    afterSave(fila, { db }) {
      if (!fila.miembro_id) return;
      const miembro = db.prepare('SELECT * FROM miembros WHERE id = ?').get(fila.miembro_id);
      if (!miembro) return;

      const cambios = [];
      const valores = [];
      const igualar = (columna, valor) => {
        const actual = miembro[columna];
        if ((valor || null) === (actual || null)) return;
        cambios.push(`"${columna}" = ?`);
        valores.push(valor || null);
      };
      igualar('rut', fila.rut);
      igualar('email', fila.email);
      igualar('telefono', fila.telefono);
      if (!cambios.length) return;
      db.prepare(`UPDATE miembros SET ${cambios.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(...valores, miembro.id);
    },

    beforeDelete(row, { user, db }) {
      if (row.id === user.id) return 'No puede eliminar su propio usuario';
      if (row.rol === 'admin') {
        const admins = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin' AND activo = 1").get().c;
        if (admins <= 1) return 'No se puede eliminar el último administrador del sistema';
      }
      return null;
    },
  },
};
