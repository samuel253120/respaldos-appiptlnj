/**
 * Módulo: No Miembros (personas que no pertenecen a la iglesia).
 *
 * Existe por las ayudas sociales. La mayoría de las ayudas que se entregan no
 * son para miembros: son para gente del barrio que llegó a pedir. Hasta ahora
 * el beneficiario se escribía a mano en la ayuda, así que no había forma de
 * saber a cuántas personas distintas se ha ayudado, ni de ver que a la misma
 * señora se le entregó tres veces, ni de encontrar su teléfono el día que hay
 * que avisarle algo. Cada ayuda era un nombre suelto.
 *
 * Es un registro aparte del de Miembros, a propósito. No son miembros y no
 * tienen que aparecer en los listados de la membresía, ni en los informes de
 * asistencia, ni en las estadísticas de la congregación, ni contarse entre los
 * miembros. Son personas de las que la iglesia lleva una ficha porque las
 * atiende, y nada más.
 *
 * LO QUE ESTA FICHA NO EXIGE ES TAN IMPORTANTE COMO LO QUE GUARDA. En la
 * práctica casi nunca se obtienen todos los datos: se entrega una caja de
 * mercadería y la persona no anda con el carnet, o no quiere dar el teléfono.
 * Por eso lo único obligatorio es el nombre; el RUT, el apellido, el teléfono
 * y todo lo demás quedan opcionales, y la ficha se guarda igual con lo poco
 * que se haya obtenido. Una ficha a medias sirve; una ayuda sin registrar,
 * no.
 *
 * El RUT es opcional, pero cuando se escribe se valida y no puede repetirse:
 * es lo único que permite darse cuenta de que la persona que viene hoy ya
 * tiene ficha de la vez pasada.
 *
 * ---------------------------------------------------------------------------
 * TAMBIÉN SIRVEN EN LOS GRUPOS
 *
 * Un grupo de la iglesia —el equipo de aseo, el de sonido, el apoyo social— no
 * exige estar inscrito en la membresía, y de hecho en muchos sirve gente que
 * no lo está. Esa gente entra al grupo desde acá: la ficha de integrante
 * pregunta de qué registro sale la persona y la busca en este. En los CUERPOS
 * no, porque un cuerpo es formal y se compone de miembros (ver
 * server/integrantes.js).
 *
 * Y de acá se sale, cuando la persona se inscribe: el botón «Inscribir como
 * miembro» le crea su ficha en el registro oficial con lo que ya se sabía de
 * ella y le lleva sus grupos y su asistencia, conservando las fechas. Sin ese
 * paso, cada inscripción obligaba a rehacer el historial a mano —y en la
 * práctica se perdía—. Esta ficha NO se borra: queda apuntando a la nueva,
 * porque las ayudas que se le entregaron cuando no era miembro cuelgan de
 * ella y siguen siendo ciertas.
 */

/** Años cumplidos a la fecha de hoy, o nada si la fecha no sirve. */
function edadEnAnios(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(nace.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nace.getFullYear();
  const mes = hoy.getMonth() - nace.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nace.getDate())) anios--;
  return anios >= 0 && anios < 130 ? anios : null;
}

/** Cuánto se acerca esta persona a la iglesia, si es que se acerca. */
const CERCANIA = ['No asiste', 'Asiste ocasionalmente', 'Asiste con frecuencia'];

module.exports = {
  name: 'no_miembros',
  label: 'No Miembros',
  labelSingular: 'No Miembro',
  icon: '👤',
  group: 'Personas',
  ayudaPermiso:
    'Fichas de personas que la iglesia atiende sin que pertenezcan a la membresía: quienes reciben '
    + 'ayudas sociales y quienes sirven en un grupo sin estar inscritos. Son datos de gente en '
    + 'situación vulnerable. Sin este permiso no se puede sumar a un grupo a alguien no inscrito.',
  order: 21, // justo debajo de Miembros, que es el 20
  display: '{nombres} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email', 'direccion'],
  listFields: ['nombres', 'apellidos', 'rut', 'telefono', 'asistencia', 'iglesia_id'],
  filterFields: ['asistencia', 'iglesia_id'],
  defaultSort: { field: 'apellidos', dir: 'asc' },

  /**
   * El `miembro_id` de esta ficha NO dice de quién es: dice en qué ficha de
   * miembro se convirtió al inscribirse. Con la regla general del alcance por
   * cuerpo, a quien tiene un cuerpo asignado se le escondía todo el registro
   * salvo las poquísimas fichas de gente que además se inscribió y quedó en
   * uno de sus cuerpos. Estas fichas se acotan por iglesia y nada más, que es
   * como estaban antes de que existiera esa columna.
   */
  alcance: { porMiembro: false },
  computed: [
    {
      name: 'edad', label: 'Edad', type: 'texto',
      calc: (r) => {
        const a = edadEnAnios(r.fecha_nacimiento);
        return a == null ? '' : `${a} año${a === 1 ? '' : 's'}`;
      },
    },
  ],
  fields: [
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true,
      help: 'Cuál iglesia lleva esta ficha. Es lo que hace que cada iglesia vea las suyas.' },

    // ---------------- Identificación ----------------
    { name: 'nombres', label: 'Nombres', type: 'text', required: true, seccion: 'Identificación',
      help: 'Lo único obligatorio. Si solo se supo el nombre de pila, con eso basta para guardar la ficha.' },
    { name: 'apellidos', label: 'Apellidos', type: 'text',
      help: 'Opcional: muchas veces no se alcanzan a preguntar.' },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true, reservado: 'miembros_identidad',
      help: 'Opcional. Si se escribe, se valida el dígito verificador y no se admite repetido: ' +
        'es lo que permite darse cuenta de que esta persona ya tenía ficha.',
    },
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', mostrarEdad: true,
      help: 'Opcional. La edad se calcula sola.', reservado: 'miembros_identidad' },
    { name: 'genero', label: 'Sexo', type: 'select', options: ['Femenino', 'Masculino'] },

    // ---------------- Contacto ----------------
    { name: 'telefono', label: 'Teléfono', type: 'text', seccion: 'Contacto',
      help: 'Opcional. Si no se obtuvo, la ficha se guarda igual.' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },

    // ---------------- Vínculo con la iglesia ----------------
    {
      name: 'referido_por', label: 'Quién la refirió', type: 'persona', ref: 'miembros',
      seccion: 'Vínculo con la iglesia',
      help: 'Se busca entre los miembros, o se escribe el nombre a mano si quien la refirió no está registrado.',
    },
    { name: 'asistencia', label: 'Se acerca a la iglesia', type: 'select', options: CERCANIA,
      help: 'Para distinguir a quien solo vino a pedir de quien ya se está acercando.' },
    { name: 'conocido_desde', label: 'Se le conoce desde', type: 'date' },

    { name: 'notas', label: 'Notas', type: 'textarea', seccion: 'Notas' },

    /*
     * Se inscribió, y esta es su ficha de miembro.
     *
     * La ficha de acá no se borra al inscribirse: las ayudas que se le
     * entregaron cuando no era miembro cuelgan de ella. Queda marcada y
     * apuntando a la nueva, para que nadie la vuelva a usar por error.
     */
    {
      name: 'miembro_id', label: 'Se inscribió como miembro', type: 'ref', ref: 'miembros',
      readonly: true,
      help: 'Lo escribe el sistema al inscribirla. Desde ese momento su ficha viva es la de Miembros.',
    },
  ],

  hooks: {
    /**
     * Una ficha que ya se inscribió no se borra: es de donde cuelgan las
     * ayudas que se le entregaron cuando todavía no era miembro.
     */
    beforeDelete(fila, { db }) {
      if (fila.miembro_id) {
        return 'Esta persona ya se inscribió como miembro. Su ficha de acá queda como constancia '
          + 'de las ayudas que se le entregaron antes: no se elimina.';
      }
      const enGrupos = db
        .prepare("SELECT COUNT(*) c FROM integrantes_cuerpo WHERE no_miembro_id = ? AND estado != 'Retirado'")
        .get(fila.id).c;
      if (enGrupos) {
        return `No se puede eliminar: pertenece a ${enGrupos} grupo(s). `
          + 'Sáquela de ellos primero, o márquela como retirada.';
      }
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /**
     * «Ahora sí se inscribió»: de No Miembro a miembro de la iglesia.
     *
     * Es el paso que evita el problema que trae permitir gente de fuera en los
     * grupos: alguien empieza sirviendo en el equipo de sonido, se convierte,
     * se bautiza y se inscribe. Sin esto termina con dos fichas —una en cada
     * registro— y su historial de grupo colgando de la que ya no se usa.
     *
     * Lo que hace, todo en una transacción:
     *   1. crea su ficha en Miembros con lo que ya se sabía de ella
     *   2. le pasa sus pertenencias a grupos, con las fechas y los estados
     *   3. le pasa sus marcas de asistencia, para que su porcentaje no parta de cero
     *   4. deja la ficha de acá apuntando a la nueva, sin borrarla
     *
     * Pide los dos permisos: crear miembros y editar el registro aparte. Crear
     * un miembro es entrar al registro oficial de la iglesia, y eso no lo hace
     * quien solo administra las ayudas.
     */
    router.post('/no_miembros/:id(\\d+)/inscribir', requirePerm('miembros', 'create'), (req, res) => {
      const { can } = require('../permissions');
      if (!can(req.user, 'no_miembros', 'edit')) {
        return res.status(403).json({ error: 'No tiene permiso para modificar el registro de No Miembros.' });
      }
      const ficha = db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(req.params.id);
      if (!ficha) return res.status(404).json({ error: 'Esa ficha no existe.' });
      if (!require('../alcance').alcanza(module.exports, ficha, req.user)) {
        return res.status(403).json({ error: 'Esa ficha está fuera de lo que tiene asignado.' });
      }
      if (ficha.miembro_id) {
        return res.status(409).json({
          error: 'Esta persona ya está inscrita como miembro.',
          miembro_id: ficha.miembro_id,
        });
      }
      // Apellidos: Miembros los exige, y acá son opcionales a propósito
      if (!String(ficha.apellidos || '').trim()) {
        return res.status(400).json({
          error: 'Para inscribirla como miembro falta su apellido. Complételo en esta ficha y vuelva a intentarlo.',
        });
      }
      // El RUT no se puede repetir en el registro oficial
      if (ficha.rut) {
        const ya = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(ficha.rut);
        if (ya) {
          return res.status(409).json({
            error: 'Ya hay un miembro inscrito con ese RUT. Revise si es la misma persona.',
            miembro_id: ya.id,
          });
        }
      }

      const inscribir = db.transaction(() => {
        const nuevo = db
          .prepare(
            `INSERT INTO miembros (iglesia_id, nombres, apellidos, rut, fecha_nacimiento, genero,
                                   telefono, direccion, email, estado, tipo_miembro, fecha_ingreso,
                                   notas, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', 'Miembro Nuevo', ?, ?, ?)`
          )
          .run(
            ficha.iglesia_id, ficha.nombres, ficha.apellidos, ficha.rut || null,
            ficha.fecha_nacimiento || null, ficha.genero || null,
            ficha.telefono || null, ficha.direccion || null, ficha.email || null,
            new Date().toISOString().slice(0, 10),
            `Inscrita desde el registro de No Miembros${ficha.notas ? `. ${ficha.notas}` : ''}`,
            req.user.id
          );
        const miembroId = Number(nuevo.lastInsertRowid);

        // Sus grupos, con sus fechas y sus estados intactos
        const grupos = db
          .prepare('UPDATE integrantes_cuerpo SET miembro_id = ?, no_miembro_id = NULL, persona_tipo = ? WHERE no_miembro_id = ?')
          .run(miembroId, 'Miembro', ficha.id).changes;

        // Y su asistencia, para que su porcentaje no parta de cero
        const marcas = db
          .prepare('UPDATE asistencia_detalle SET miembro_id = ?, no_miembro_id = NULL, persona_tipo = ? WHERE no_miembro_id = ?')
          .run(miembroId, 'Miembro', ficha.id).changes;

        db.prepare('UPDATE no_miembros SET miembro_id = ? WHERE id = ?').run(miembroId, ficha.id);
        return { miembroId, grupos, marcas };
      });

      const hecho = inscribir.immediate();
      require('../bitacora').anotar({
        miembroId: hecho.miembroId, tipo: 'Anotación', iglesiaId: ficha.iglesia_id, usuario: req.user,
        descripcion: 'Queda inscrita en el registro de miembros. Venía del registro de No Miembros.',
      });
      res.json({ ok: true, ...hecho });
    });
  },
};
