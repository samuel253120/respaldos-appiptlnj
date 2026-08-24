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
const cifrado = require('../cifrado');
const { ROLES } = require('../permissions');

module.exports = {
  name: 'usuarios',
  label: 'Usuarios',
  labelSingular: 'Usuario',
  icon: '🔐',
  group: 'Administración',
  order: 90,
  display: '{nombre:persona}',
  searchFields: ['nombre', 'rut', 'email'],
  listFields: ['foto', 'rut', 'nombre', 'rol', 'miembro_id', 'iglesias', 'cuerpos', 'activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'foto', label: 'Fotografía de perfil', type: 'file', accept: 'image/*', recorte: 'cuadrado',
      help:
        'La cara con la que se le reconoce en el sistema: sale arriba, junto a su nombre. Se puede sacar con ' +
        'el teléfono, y con «Ajustar» se recorta y se corrige el brillo. Si está enlazado a una ficha de ' +
        'miembro, es la misma foto de esa ficha.',
    },
    {
      name: 'rut', label: 'RUT (usuario de acceso)', type: 'rut', required: true, unique: true,
      help: 'Con o sin puntos, con guion y dígito verificador. Ej: 12.345.678-5',
    },
    {
      name: 'nombre', label: 'Nombre completo', type: 'text', required: true, recorta: 'persona',
      help: 'Si está enlazado a una ficha de miembro, el nombre se toma de allá (donde va separado en nombres y apellidos).',
    },
    {
      name: 'miembro_id', label: 'Su ficha de miembro', type: 'ref', ref: 'miembros',
      help: 'Enlazándolo, el RUT, el nombre, el correo, el teléfono y la foto quedan iguales en los dos módulos. Si tienen el mismo RUT, el sistema la reconoce sola.',
    },
    {
      name: 'password', label: 'Contraseña', type: 'password',
      help: 'Déjelo vacío y se le entrega la contraseña inicial del sistema. Al entrar, la persona tendrá que cambiarla por una suya.',
    },

    // --- Estado del acceso: lo maneja el sistema, no se escribe a mano ---
    { name: 'debe_cambiar_password', label: 'Debe cambiar la contraseña', type: 'boolean', oculto: true },
    { name: 'password_origen', label: 'Origen de la contraseña', type: 'text', oculto: true },
    { name: 'password_cambiada_en', label: 'Contraseña cambiada el', type: 'text', oculto: true },
    {
      // Desde cuándo valen las sesiones de esta cuenta. Al cambiar la
      // contraseña se pone la hora de ese momento, y los pases que se
      // hubieran entregado antes dejan de servir (ver server/auth.js).
      name: 'sesiones_desde', label: 'Sesiones válidas desde', type: 'number', oculto: true,
    },
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
      // Con cuáles de las suyas está trabajando ahora. Lo elige cada persona
      // desde la barra de arriba, no la oficina: por eso no está en el
      // formulario. En blanco significa «todas las que tengo».
      name: 'iglesias_trabajando', label: 'Iglesias con las que está trabajando', type: 'multiref',
      ref: 'iglesias', oculto: true,
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
    const { can } = require('../permissions');

    /**
     * Devolverle la contraseña inicial a otra persona es la llave que permite
     * entrar como ella. Poder corregirle un apellido mal escrito no tendría por
     * qué incluirlo, así que va aparte: además de editar Usuarios hace falta
     * `usuarios_clave`, que de fábrica la tienen todos —nadie pierde nada— y se
     * le puede quitar a quien no corresponda (ver LLAVES en server/permissions.js).
     */
    const conLlaveDeClaves = (req, res, siguiente) => {
      if (!can(req.user, 'usuarios_clave', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para restablecer la contraseña de otras personas' });
      }
      siguiente();
    };

    /** Los perfiles que se pueden asignar hoy (los archivados no se ofrecen). */
    router.get('/perfiles_permisos/activos', requirePerm('usuarios', 'view'), (req, res) => {
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
        puede_restablecer: can(req.user, 'usuarios', 'edit') && can(req.user, 'usuarios_clave', 'view'),
      });
    });

    /**
     * Restablece la cuenta a la contraseña inicial y la devuelve, para que el
     * administrador se la entregue a su dueño. Al entrar con ella, el sistema
     * le obligará a cambiarla.
     */
    router.post('/usuarios/:id(\\d+)/restablecer-clave', requirePerm('usuarios', 'edit'), conLlaveDeClaves, async (req, res, next) => {
      const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
      if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
      try {
        const clave = await claves.restablecer(usuario.id);
        res.json({ ok: true, clave, nombre: usuario.nombre, rut: usuario.rut });
      } catch (e) {
        next(e);
      }
    });

    /** Vuelve a habilitar la recuperación bloqueada por intentos fallidos. */
    router.post('/usuarios/:id(\\d+)/desbloquear-recuperacion', requirePerm('usuarios', 'edit'), conLlaveDeClaves, (req, res) => {
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
      return null;
    },

    /**
     * La contraseña, cifrada antes de abrir la transacción.
     *
     * Va acá y no en `beforeSave` por una sola razón: cifrarla cuesta cerca de
     * una décima de segundo de puro cálculo —a propósito, para que adivinarla
     * también cueste— y el servidor atiende de a una cosa. Hecho dentro del
     * guardado, ese rato lo pagaban TODOS los que estuvieran usando el sistema
     * en ese momento. Medido: guardar un usuario demoraba 93 ms contra los 3 ms
     * de cualquier otro módulo, y esos 93 ms el servidor no atendía a nadie.
     *
     * Acá, en cambio, se puede esperar sin frenar al resto.
     *
     * La que se pone es la que escriba el administrador, o la inicial del
     * sistema. En los dos casos la persona tendrá que cambiarla al entrar,
     * porque una contraseña que otro conoce no es suya.
     */
    async antesDeGuardar(data, { isNew, existing, db }) {
      const claves = require('../claves');
      if (data.password) {
        /**
         * A quién se le está poniendo, con el nombre que la cuenta VA A TENER.
         *
         * No basta con mirar el nombre que viene en la petición: si la cuenta
         * se enlaza con una ficha de miembro, el nombre se toma de allá y el
         * que se mandó se descarta. Mirando solo el enviado, se podía crear la
         * cuenta de «Fernanda Isabel Riquelme» mandando cualquier nombre y la
         * contraseña «Fernanda2026», y la regla que impide que la contraseña
         * sea el propio nombre no se enteraba. Comprobado que pasaba.
         */
        const rut = data.rut !== undefined ? data.rut : existing && existing.rut;
        let comoSeVaALlamar = data.nombre !== undefined ? data.nombre : existing && existing.nombre;
        const enlace = data.miembro_id !== undefined
          ? data.miembro_id
          : (existing && existing.miembro_id) || (rut ? (db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut) || {}).id : null);
        if (enlace) {
          const miembro = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(enlace);
          if (miembro) comoSeVaALlamar = `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim() || comoSeVaALlamar;
        }

        const quien = { rut, nombre: comoSeVaALlamar };
        const problema = claves.revisarClave(data.password, quien);
        if (problema) return problema;
        data.password = await cifrado.cifrar(data.password);
        data.password_origen = 'definida';
        data.debe_cambiar_password = 1;
      } else if (isNew) {
        data.password = await cifrado.cifrar(claves.inicial());
        data.password_origen = 'inicial';
        data.debe_cambiar_password = 1;
      } else {
        delete data.password; // conservar la contraseña actual
      }
      return null;
    },
    /**
     * Lo que cambió aquí se lleva a su ficha de miembro: son la misma persona,
     * así que el RUT, el correo, el teléfono y la foto son los mismos en los
     * dos lados y da igual por dónde se cambien.
     */
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
      igualar('foto', fila.foto);
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
