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
 *
 * Y ponerle o sacarle un perfil a alguien ES cambiarle los permisos, así que
 * las dos rutas que lo hacen desde acá piden lo mismo que la ficha de usuario:
 * nadie se lo toca a sí mismo, nadie le concede a otro lo que él no tiene, y
 * el cambio queda anotado en el Registro de Cambios (ver las rutas, abajo).
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
      /**
       * CUÁNTA GENTE LLEVA ESTE PERFIL, DE LA QUE QUIEN MIRA PUEDE VER.
       *
       * Desde la v1.98.0 las tres rutas de este módulo están acotadas: quien
       * administra una iglesia ve, en la ficha de un perfil, solo las cuentas
       * de sus iglesias. Esta columna quedó fuera de aquel arreglo y contaba la
       * tabla entera.
       *
       * MEDIDO EN LA v1.327.0, con un administrador de una sola iglesia, en la
       * misma pantalla y sobre el mismo perfil:
       *
       *   en el listado ............. «2 usuarios»
       *   en la ficha de ese perfil . 0 cuentas
       *
       * No se filtraban nombres —la ficha sí estaba bien acotada— pero sí un
       * número: cuánta gente de otras iglesias lleva ese perfil. Y dejaba la
       * pantalla contradiciéndose sola, que es lo que en la práctica hace que
       * nadie confíe en la cifra.
       *
       * Cuando quien mira tiene iglesias asignadas, la columna lo dice: «1 de
       * los suyos». Sin iglesias asignadas se ven todas, y entonces el número
       * es el de todos y se dice a secas.
       */
      name: 'cuantos_usuarios', label: 'Usuarios', type: 'texto',
      calc: (fila, { db, usuario }) => {
        const params = [fila.id];
        const suyas = usuario ? require('../alcance').condicionesDeUsuarios(usuario, params) : null;
        const n = db
          .prepare(`SELECT COUNT(*) c FROM usuarios WHERE perfil_id = ?${suyas ? ` AND ${suyas}` : ''}`)
          .get(...params).c;
        if (!suyas) return n === 0 ? 'Nadie todavía' : n === 1 ? '1 usuario' : `${n} usuarios`;
        return n === 0 ? 'Nadie de los suyos' : n === 1 ? '1 de los suyos' : `${n} de los suyos`;
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
    /**
     * LO QUE SE GUARDA ES LO QUE EL SISTEMA COMPRUEBA.
     *
     * El editor de permisos existe para que «lo que se ve ahí sea exactamente
     * lo que el sistema comprueba, sin nada escondido», y la pantalla cumple:
     * solo ofrece los módulos y las llaves que existen, con sus cuatro
     * acciones. Lo que no había era nada que revisara lo que LLEGA.
     *
     * MEDIDO EN LA v1.327.0, por la API:
     *
     *   {"modulo_que_no_existe":["view"], "miembros":["volar","view"],
     *    "*":["view","create","edit","delete"]}   →  201, guardado tal cual
     *
     * Los dos primeros son inofensivos: nadie pregunta por un módulo que no
     * existe ni por una acción que no existe. El tercero no lo es tanto. En la
     * tabla de los ROLES, «*» significa «todo»; en un perfil NO SE MIRA NUNCA
     * —`can` pregunta por el nombre del módulo y nada más—, así que quien lo
     * escriba creerá que concedió el sistema entero y no habrá concedido nada.
     * Un perfil que miente hacia el lado seguro sigue siendo un perfil que
     * miente.
     *
     * Se limpia en vez de negarse, y por una razón: los nombres de los módulos
     * cambian con los años, y negarse dejaría un perfil viejo imposible de
     * volver a guardar. Lo que sobra se cae, y lo que queda guardado se
     * devuelve en la respuesta, que es donde quien lo mandó lo ve.
     */
    beforeSave(data) {
      if (data.permisos === undefined || data.permisos === null) return null;
      const { todoLoQueSePuedePermitir } = require('../permissions');
      let tabla;
      try {
        tabla = typeof data.permisos === 'string' ? JSON.parse(data.permisos) : data.permisos;
      } catch (e) {
        tabla = null;
      }
      if (!tabla || typeof tabla !== 'object') return null;

      const limpia = {};
      for (const cosa of todoLoQueSePuedePermitir()) {
        if (!Array.isArray(tabla[cosa.name])) continue;
        // Solo las acciones que ESA cosa admite: una llave que solo se ve no
        // tiene «eliminar», y guardárselo sería otra vez decir algo que no es
        limpia[cosa.name] = cosa.acciones.filter((a) => tabla[cosa.name].includes(a));
      }
      // Como texto: acá el motor ya convirtió el campo a JSON, y devolverle un
      // objeto deja la escritura sin poder guardar
      data.permisos = Object.keys(limpia).length ? JSON.stringify(limpia) : null;
      return null;
    },

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
    /*
     * Las tres rutas de acá manejan CUENTAS DE USUARIO desde la ficha del
     * perfil, y hasta la 1.98.0 ninguna miraba de qué iglesia era cada cuenta.
     *
     * El perfil sí es de toda la organización —uno solo, que se le pone a
     * quien sea—, pero las cuentas no. Así, quien administraba una iglesia
     * veía acá el nombre, el RUT, el rol y la iglesia de TODAS las cuentas del
     * sistema, y podía cambiarle los permisos a cualquiera de ellas. Era la
     * puerta de atrás de un listado de Usuarios que sí estaba acotado.
     *
     * Se acota con el mismo criterio que ese listado. La tabla va sin alias a
     * propósito: las condiciones nombran sus columnas como `usuarios.…`.
     */
    const soloLasSuyas = (req, params) =>
      require('../alcance').condicionesDeUsuarios(req.user, params);

    /** Quiénes tienen puesto este perfil, para verlos y sacárselos desde acá. */
    router.get('/perfiles_permisos/:id(\\d+)/usuarios', requirePerm('perfiles_permisos', 'view'), (req, res) => {
      const perfil = db.prepare('SELECT * FROM perfiles_permisos WHERE id = ?').get(req.params.id);
      if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });

      const pSuyos = [perfil.id];
      const alcanceSuyos = soloLasSuyas(req, pSuyos);
      const suyos = db
        .prepare(
          `SELECT usuarios.id, usuarios.nombre, usuarios.rut, usuarios.rol, usuarios.activo,
                  (SELECT nombre FROM iglesias WHERE id = usuarios.iglesia_id) AS iglesia
             FROM usuarios
            WHERE usuarios.perfil_id = ?${alcanceSuyos ? ` AND ${alcanceSuyos}` : ''}
            ORDER BY usuarios.nombre`
        )
        .all(...pSuyos);

      /*
       * Las que se pueden marcar para ponerles el perfil: las que no lo tienen,
       * que no son administradores —un administrador no lleva perfil— y que
       * SIGUEN ACTIVAS.
       *
       * Lo último faltaba: hasta la 1.327.0 la lista traía también las cuentas
       * dadas de baja. No abría nada —una cuenta desactivada no entra al
       * sistema, y eso está probado desde la v1.323.0— pero es ruido en una
       * lista que se usa para decidir, y contradice el criterio del resto del
       * sistema: la lista de responsables de una solicitud, por ejemplo, solo
       * trae las activas.
       *
       * La ruta que asigna SÍ acepta una cuenta desactivada si se le manda su
       * número, y se deja así a propósito: preparar la cuenta de alguien que
       * empieza el lunes y activarla ese día es un caso de verdad. Lo que no
       * corresponde es ofrecerla entre las que hay para elegir.
       */
      const pLibres = [perfil.id];
      const alcanceLibres = soloLasSuyas(req, pLibres);
      const libres = db
        .prepare(
          `SELECT usuarios.id, usuarios.nombre, usuarios.rut, usuarios.rol FROM usuarios
            WHERE (usuarios.perfil_id IS NULL OR usuarios.perfil_id != ?) AND usuarios.rol != 'admin'
              AND usuarios.activo = 1
              ${alcanceLibres ? `AND ${alcanceLibres}` : ''}
            ORDER BY usuarios.nombre`
        )
        .all(...pLibres);
      res.json({ perfil: { id: perfil.id, nombre: perfil.nombre }, usuarios: suyos, disponibles: libres });
    });

    /**
     * PONERLE O SACARLE UN PERFIL A ALGUIEN ES CAMBIARLE LOS PERMISOS.
     *
     * Y por eso estas dos rutas tienen que pedir lo mismo que pide la ficha de
     * usuario, donde ese cambio pasa por el gancho de guardado. Hasta la
     * 1.327.0 no lo pedían, porque escriben `UPDATE usuarios SET perfil_id`
     * directo contra la base y así no tocan ni el gancho ni la bitácora.
     *
     * MEDIDO EN LA v1.327.0, con una cuenta de secretaria a la que se le dio
     * exactamente «usuarios: ver, crear, editar» y ningún permiso sobre este
     * módulo —el listado de perfiles le contestaba 403—:
     *
     *   antes ..... GET /configuracion .................... 403
     *               POST /perfiles_permisos/6/usuarios      200 {"puestos":1}
     *   después ... GET /configuracion .................... 200
     *               Registro de Cambios .... 95 antes, 95 después
     *
     * Se dio a sí misma un perfil que le abrió la Configuración del sistema, y
     * no quedó anotado en ninguna parte. Por su ficha, la misma persona recibe
     * el aviso de la v1.317.0 —«No puede cambiar su propio rol, su perfil de
     * permisos ni sus excepciones»— y el cambio sí se anota.
     *
     * Son las mismas dos reglas de aquella versión, y hacen falta las dos:
     *
     *   1. SOBRE LA PROPIA CUENTA no se toca el perfil. Lo que una persona
     *      puede hacer en el sistema lo decide otra.
     *   2. SOBRE LA DE OTRO no se concede lo que uno mismo no tiene. Sin esta,
     *      la primera se rodea con dos cuentas que se suben entre sí.
     *
     * Se miran las dos en los DOS sentidos —al poner y al sacar—, porque un
     * perfil también puede QUITAR lo que el rol daba: sacárselo devuelve esos
     * permisos, y eso es ganar. `loQueSeGana` lo resuelve solo, comparando la
     * cuenta antes y después.
     */
    const alGuardarElPerfil = (req, cuenta, perfilNuevo) => {
      const { loQueSeGana, nombreDelPermiso, can } = require('../permissions');
      if (Number(cuenta.id) === Number(req.user.id)) {
        return 'No puede ponerse ni quitarse a sí mismo un perfil de permisos. Lo que una persona '
          + 'puede hacer en el sistema lo decide otra: si de verdad hace falta, pídaselo a quien '
          + 'administre las cuentas.';
      }
      const gana = loQueSeGana(cuenta, { ...cuenta, perfil_id: perfilNuevo })
        .filter((x) => { const [modulo, accion] = x.split(':'); return !can(req.user, modulo, accion); });
      if (gana.length) {
        const nombres = gana.slice(0, 3).map(nombreDelPermiso);
        return `Con eso le estaría dando a ${cuenta.nombre} ${gana.length} permiso(s) que usted no tiene: `
          + nombres.join('; ') + (gana.length > 3 ? `, y ${gana.length - 3} más` : '') + '. '
          + 'Nadie puede conceder lo que no alcanza: pídaselo a quien sí lo tenga.';
      }
      return null;
    };

    /**
     * Y queda anotado, con el nombre del perfil y el de la persona.
     *
     * El Registro de Cambios vigila Usuarios y Perfiles de Permisos justamente
     * porque son las llaves del sistema. Estas dos rutas no pasan por el motor,
     * así que la línea se escribe acá a mano, con el mismo texto que deja el
     * motor cuando el cambio se hace desde la ficha.
     */
    const dejarAnotado = (req, cuenta, antes, ahora) => {
      const comoSeLlama = (id) => {
        if (!id) return '(vacío)';
        const p = db.prepare('SELECT nombre FROM perfiles_permisos WHERE id = ?').get(id);
        return p ? p.nombre : `#${id}`;
      };
      require('../bitacora').anotarCambio({
        def: require('../registry').getModule('usuarios'),
        accion: 'Cambio',
        fila: cuenta,
        usuario: req.user,
        detalle: `Perfil de permisos: ${comoSeLlama(antes)} → ${comoSeLlama(ahora)}`,
      });
    };

    /** Ponerle este perfil a uno o varios usuarios de una vez. */
    router.post('/perfiles_permisos/:id(\\d+)/usuarios', requirePerm('usuarios', 'edit'), (req, res) => {
      const perfil = db.prepare('SELECT * FROM perfiles_permisos WHERE id = ?').get(req.params.id);
      if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
      const ids = Array.isArray(req.body && req.body.usuarios) ? req.body.usuarios.map(Number).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: 'Elija al menos un usuario' });

      /*
       * Un perfil archivado no se le pone a nadie nuevo, tampoco desde acá. La
       * misma regla que la ficha de usuario, y por lo mismo: hasta la 1.327.0
       * archivarlo solo lo escondía del desplegable, y esta ruta se lo ponía
       * igual a quien se le pidiera —medido, «{"puestos":1}»—.
       */
      if (perfil.estado !== 'Activo') {
        return res.status(400).json({
          error: `El perfil "${perfil.nombre}" está archivado: la iglesia decidió no volver a usarlo, `
            + 'así que no se le puede poner a nadie más. Quien ya lo tiene lo conserva. Si hace falta '
            + 'volver a usarlo, cámbielo a Activo.',
        });
      }

      /*
       * Se comprueba cuenta por cuenta, no en el UPDATE: así se puede decir
       * cuántas quedaron fuera en vez de que desaparezcan sin explicación.
       * Cambiarle el perfil a alguien es cambiarle los permisos, y eso no se
       * hace en silencio sobre una cuenta que uno no administra.
       */
      const alcance = require('../alcance');
      const poner = db.prepare(
        "UPDATE usuarios SET perfil_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND rol != 'admin'"
      );
      const def = require('../registry').getModule('usuarios');
      let puestos = 0;
      let ajenas = 0;
      const frenadas = [];
      for (const id of ids) {
        const cuenta = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
        if (!cuenta) continue;
        if (!alcance.alcanza(def, cuenta, req.user)) { ajenas++; continue; }
        /*
         * Un administrador no lleva perfil, y hasta la 1.327.0 esta ruta lo
         * resolvía en el propio UPDATE —«AND rol != 'admin'»—, así que la
         * cuenta se saltaba y la respuesta era 200 con un cero adentro: «salió
         * bien» y no había pasado nada. Ahora se dice, con el mismo motivo que
         * da la ficha de usuario.
         */
        if (cuenta.rol === 'admin') {
          frenadas.push(`${cuenta.nombre} es administrador, y un administrador no lleva perfil de permisos: `
            + 'su rol ya le da todo lo que el sistema puede dar, y un perfil solo podría quitarle cosas. '
            + 'Si hay que recortarle algo, use las «Excepciones para esta persona» en su ficha.');
          continue;
        }
        const aviso = alGuardarElPerfil(req, cuenta, perfil.id);
        if (aviso) { frenadas.push(aviso); continue; }
        const cambio = poner.run(perfil.id, id).changes;
        if (cambio) {
          dejarAnotado(req, cuenta, cuenta.perfil_id, perfil.id);
          puestos += cambio;
        }
      }
      /*
       * Si algo se frenó y no se puso nada, se contesta el PORQUÉ y no un
       * número: es un cambio de permisos que alguien pidió a propósito y tiene
       * derecho a saber por qué no se hizo.
       */
      if (frenadas.length && !puestos) return res.status(403).json({ error: frenadas[0] });
      if (ajenas && !puestos) {
        return res.status(403).json({
          error: ajenas === 1
            ? 'Esa cuenta está fuera de lo que tiene asignado'
            : `Esas ${ajenas} cuentas están fuera de lo que tiene asignado`,
        });
      }
      res.json({ puestos, ajenas, frenadas: frenadas.length });
    });

    /** Y sacárselo a uno. */
    router.delete('/perfiles_permisos/:id(\\d+)/usuarios/:usuario(\\d+)', requirePerm('usuarios', 'edit'), (req, res) => {
      const cuenta = require('../alcance').registroSuyo(req, res, 'usuarios', req.params.usuario, 'Ese usuario');
      if (!cuenta) return;
      const aviso = alGuardarElPerfil(req, cuenta, null);
      if (aviso) return res.status(403).json({ error: aviso });
      const r = db
        .prepare("UPDATE usuarios SET perfil_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND perfil_id = ?")
        .run(req.params.usuario, req.params.id);
      if (!r.changes) return res.status(404).json({ error: 'Ese usuario no tiene puesto este perfil' });
      dejarAnotado(req, cuenta, Number(req.params.id), null);
      res.json({ ok: true });
    });
  },
};
