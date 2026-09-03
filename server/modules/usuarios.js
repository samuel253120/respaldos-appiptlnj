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


/** Lo que llega del formulario puede venir como 0, '0', false o 'false'. */
function esVerdad(valor) {
  return !(valor === 0 || valor === '0' || valor === false || valor === 'false');
}

/** Cuántas solicitudes abiertas lleva esa cuenta. */
function solicitudesAbiertasDe(db, usuarioId) {
  try {
    const cerrados = require('./solicitudes').CERRADOS;
    const huecos = cerrados.map(() => '?').join(',');
    return db
      .prepare(`SELECT COUNT(*) AS c FROM solicitudes WHERE responsable_id = ? AND estado NOT IN (${huecos})`)
      .get(usuarioId, ...cerrados).c;
  } catch (e) {
    return 0; // sin el módulo de solicitudes no hay nada que preguntar
  }
}

module.exports = {
  name: 'usuarios',
  label: 'Usuarios',
  labelSingular: 'Usuario',
  icon: '🔐',
  group: 'Sistema',
  order: 72,
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
      // Qué avisos quiere recibir y por dónde. No se edita desde acá sino desde
      // el propio perfil de cada persona: son SUS avisos, y elegirlos por
      // otro no tiene sentido. Va declarado para que la columna exista.
      name: 'avisos', type: 'text', oculto: true, readonly: true,
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

    /*
     * Las tres rutas que siguen trabajan sobre UNA CUENTA pedida por su número,
     * y hasta la 1.98.0 ninguna comprobaba de quién era.
     *
     * Con eso, quien administraba una sola iglesia podía mirar el nombre y el
     * RUT de cualquier cuenta del sistema, y —lo serio— RESTABLECERLE la
     * contraseña y recibirla en la respuesta, con lo que entraba en esa cuenta
     * ajena. Se comprobó en vivo entre dos iglesias: el administrador de una
     * restableció la clave de la secretaria de la otra y entró con ella.
     *
     * El permiso de «Usuarios» dice QUÉ puede hacer; a QUIÉNES alcanza lo dice
     * la asignación de iglesias, y eso faltaba. `registroSuyo` aplica el mismo
     * criterio que el listado de Usuarios —uno siempre se ve a sí mismo, más
     * las cuentas de sus iglesias— y responde por su cuenta cuando no toca.
     */
    const cuentaSuya = (req, res) =>
      require('../alcance').registroSuyo(req, res, 'usuarios', req.params.id, 'Ese usuario');

    /** Cómo está el acceso de esta cuenta: su contraseña y su recuperación. */
    router.get('/usuarios/:id(\\d+)/clave', requirePerm('usuarios', 'view'), (req, res) => {
      const usuario = cuentaSuya(req, res);
      if (!usuario) return;
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
      const usuario = cuentaSuya(req, res);
      if (!usuario) return;
      try {
        const clave = await claves.restablecer(usuario.id);
        res.json({ ok: true, clave, nombre: usuario.nombre, rut: usuario.rut });
      } catch (e) {
        next(e);
      }
    });

    /** Vuelve a habilitar la recuperación bloqueada por intentos fallidos. */
    router.post('/usuarios/:id(\\d+)/desbloquear-recuperacion', requirePerm('usuarios', 'edit'), conLlaveDeClaves, (req, res) => {
      const usuario = cuentaSuya(req, res);
      if (!usuario) return;
      claves.desbloquearRecuperacion(usuario.id);
      res.json({ ok: true });
    });
  },

  hooks: {
    beforeSave(data, { isNew, id, existing, db, confirmado, user }) {
      /**
       * NADIE SE DA A SÍ MISMO LO QUE NO TIENE.
       *
       * El sistema reparte el trabajo a propósito: el campo «Excepciones para
       * esta persona» y el módulo de Perfiles de Permisos existen para que a
       * una secretaria se le pueda dejar mantener las cuentas sin hacerla
       * administradora de todo. Lo que faltaba era lo otro: que ese permiso no
       * se pudiera usar sobre la propia ficha.
       *
       * MEDIDO EN LA v1.316.0, con una cuenta de secretaria a la que se le dio
       * exactamente «usuarios: ver, crear, editar». Tres peticiones seguidas,
       * las tres HTTP 200 y sin un mensaje: se puso «rol: admin», se concedió
       * la llave de la Configuración —que antes le contestaba 403 y pasó a
       * contestarle 200— y le cerró la cuenta al administrador que se lo había
       * dado.
       *
       * El sistema comprobaba con cuidado A QUÉ CUENTAS alcanza cada persona
       * —eso se arregló en la v1.98.0 y la suite de aislamiento lo cuida— pero
       * no QUÉ PUEDE ESCRIBIR dentro de una cuenta que sí alcanza, y la suya
       * siempre la alcanza: «en Usuarios, uno siempre se ve a sí mismo».
       *
       * En cualquier otro módulo, editar de más es un dato mal escrito que se
       * corrige. Acá el dato ES el permiso.
       *
       * Son dos reglas, y hacen falta las dos:
       *
       *   1. SOBRE LA PROPIA FICHA no se tocan el rol, las excepciones ni el
       *      perfil. Es la hermana de la que ya existía —«no puede eliminar su
       *      propio usuario»— y cierra el caso medido.
       *   2. SOBRE LA DE OTRO no se concede lo que uno mismo no tiene. Sin
       *      esta, la primera se rodea con dos cuentas que se suben entre sí.
       *
       * Quitar permisos no se toca: quien administra cuentas tiene que poder
       * hacerlo, y quitar no es escalar.
       */
      const LAS_LLAVES_DE_LA_CASA = ['rol', 'permisos', 'perfil_id'];
      if (!isNew && existing && user) {
        const comoTexto = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
        const cambia = (campo) => data[campo] !== undefined && comoTexto(data[campo]) !== comoTexto(existing[campo]);

        // 1 · sobre la propia ficha
        if (Number(existing.id) === Number(user.id)) {
          const tocados = LAS_LLAVES_DE_LA_CASA.filter(cambia);
          if (tocados.length) {
            return (
              'No puede cambiar su propio rol, su perfil de permisos ni sus excepciones. Lo que una persona '
              + 'puede hacer en el sistema lo decide otra: si de verdad hace falta cambiarlo, pídaselo a quien '
              + 'administre las cuentas. (Sí puede corregir el resto de su ficha.)'
            );
          }
        }

        // 2 · sobre la de otro: no se concede lo que uno no tiene
        if (LAS_LLAVES_DE_LA_CASA.some(cambia)) {
          const { loQueSeGana, nombreDelPermiso, can } = require('../permissions');
          const quedaria = { ...existing };
          for (const campo of LAS_LLAVES_DE_LA_CASA) {
            if (data[campo] !== undefined) quedaria[campo] = data[campo];
          }
          const gana = loQueSeGana(existing, quedaria).filter((x) => {
            const [modulo, accion] = x.split(':');
            return !can(user, modulo, accion);
          });
          if (gana.length) {
            const nombres = gana.slice(0, 3).map(nombreDelPermiso);
            return (
              `Con eso le estaría dando a ${existing.nombre} ${gana.length} permiso(s) que usted no tiene: `
              + nombres.join('; ') + (gana.length > 3 ? `, y ${gana.length - 3} más` : '') + '. '
              + 'Nadie puede conceder lo que no alcanza: pídaselo a quien sí lo tenga.'
            );
          }
        }
      }

      /*
       * DESACTIVAR UNA CUENTA QUE LLEVA SOLICITUDES ABIERTAS.
       *
       * A una cuenta desactivada ya no se le puede asignar una solicitud —la
       * lista de responsables solo trae las activas—, pero una asignación
       * anterior sobrevivía a la baja sin que nada lo dijera. Comprobado:
       * desactivada la cuenta, su solicitud abierta seguía a su nombre. Desde
       * ahí los avisos iban a alguien que ya no entra, no aparecía en la
       * bandeja de nadie, y el recordatorio de «lleva mucho sin respuesta» le
       * llegaba a un buzón que nadie abre.
       *
       * NO SE BLOQUEA: se pregunta. Quien deja la iglesia tiene que perder el
       * acceso hoy, no cuando alguien se acuerde de repartir sus trámites, y
       * negarse a desactivar dejaría abierta una cuenta que ya no debe entrar,
       * que es peor. Así que se dice cuántas lleva y se confirma. Después
       * quedan marcadas en la bandeja y el vigía las recuerda.
       */
      if (!isNew && existing && existing.activo && !esVerdad(data.activo) && data.activo !== undefined && !confirmado) {
        const cuantas = solicitudesAbiertasDe(db, id);
        if (cuantas) {
          /*
           * Se DEVUELVE, no se lanza: un objeto con `confirmar` es la manera en
           * que un gancho hace una pregunta —el dato puede entrar, pero alguien
           * tiene que decir que sí— y la pantalla la convierte en dos botones.
           * Lanzándolo, el motor lo tomaba por una avería y contestaba un 500.
           */
          return {
            error:
              `${existing.nombre} lleva ${cuantas} solicitud(es) todavía abierta(s). Al desactivar la cuenta, `
              + 'nadie va a recibir sus avisos ni las va a ver como suyas. Conviene trasladarlas antes, desde la '
              + 'bandeja de solicitudes. Si igual hay que cerrarle el acceso ahora, confirme: quedan marcadas '
              + 'como «sin responsable activo» para repartirlas después.',
            confirmar: 'solicitudes_sin_responsable_activo',
          };
        }
      }

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
