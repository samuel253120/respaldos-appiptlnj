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
 * Y HACER LA FICHA NO ALCANZÓ PARA CONTESTARLO. El enlace quedó puesto —cada
 * ayuda apunta a su ficha— pero no había camino de vuelta: la ficha de la
 * persona con tres entregas no decía la palabra «ayuda» ni una vez, y para
 * averiguarlo había que salir de ella, entrar a Ayudas Sociales, filtrar por
 * su nombre y volver. En el mostrador eso no se hace. Ahora su ficha lo dice
 * arriba —«3 entregas · la última el 12-03-2026»— y lo abre en su pestaña de
 * Ayudas, sin salir de donde uno la está mirando (ver la ruta
 * `/ayudas_sociales/de-persona`).
 *
 * Es un registro aparte del de Miembros, a propósito. No son miembros y no
 * tienen que aparecer en los listados de la membresía, ni en los informes de
 * asistencia, ni en las estadísticas de la congregación, ni contarse entre los
 * miembros. Son personas de las que la iglesia lleva una ficha porque las
 * atiende, y nada más.
 *
 * Y NO TIENE HISTORIAL PROPIO, POR AHORA. Un miembro tiene su bitácora —una
 * línea por cada cosa que le pasa— y esta ficha no. No es un descuido ni un
 * defecto: donde no hay línea de historial no queda ninguna afirmación falsa,
 * y lo que la iglesia hizo por esta persona se ve igual en su pestaña
 * «Ayudas», que muestra los registros vivos. Darle bitácora propia es una
 * pieza del tamaño de un módulo —su tabla, su pestaña y su parte en la hoja
 * impresa—, así que era una decisión de la corporación y no mía: contestada
 * el 31-08-2026, por ahora no se hace.
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
 *
 * Y ese enlace se sigue de vuelta. Guardarlo no bastaba: nadie lo leía, así
 * que desde su ficha de miembro se veían CERO ayudas y las de antes quedaban
 * colgando de una ficha que ya nadie abre. Ahora su ficha de miembro las
 * muestra todas —las de antes marcadas como tales, porque son la misma
 * persona en otra etapa y no lo mismo—, esta ficha avisa arriba que la
 * persona ya se inscribió y con qué ficha seguir, y una ayuda nueva anotada
 * desde acá se le carga a la ficha que vive.
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

/* ===========================================================================
 * LA MISMA SEÑORA, ANOTADA DOS VECES
 *
 * Medido: se creó «Ana Torres» tres veces seguidas en la misma iglesia y el
 * sistema contestó 201, 201 y 201 sin preguntar nada. En Miembros la segunda
 * vez pregunta. Y acá hace más falta que allá, porque acá NINGUNA de las 60
 * fichas de prueba tiene RUT: sin RUT, lo único que puede evitar el repetido
 * es que el sistema pregunte.
 *
 * Cada ficha repetida se lleva un pedazo del historial —dos entregas cuelgan
 * de una y la tercera de otra—, y la cuenta de «a cuántas personas distintas
 * se ha ayudado» empieza a ser mentira sin que nadie se entere.
 *
 * ── CUÁNDO SE PREGUNTA, Y POR QUÉ NO SIEMPRE ──
 *
 * Con apellido, se compara como en Miembros: primer nombre más apellidos.
 *
 * Sin apellido —que acá es lo normal: 12 de 60 fichas de prueba no lo tienen—
 * se compara el nombre COMPLETO, y solo contra las que tampoco lo tienen.
 * «María» pregunta por «María», y no por «María Elena», que es otra señora.
 *
 * Lo que NO se pregunta es el caso mezclado: una ficha «María» a secas y una
 * «María González». Podrían ser la misma que la segunda vez sí dio su
 * apellido, pero también dos cualesquiera, y en un registro del barrio los
 * nombres de pila se repiten: preguntar ahí dispararía el aviso en casi cada
 * ficha nueva y la gente aprendería a apretar «seguir» sin leer, que es peor
 * que no preguntar. Queda dicho acá para que se sepa que es una decisión y no
 * un olvido.
 *
 * Y no bloquea: pregunta. Dos vecinas que se llaman igual existen.
 * =========================================================================== */

const { comoSeCompara } = require('../repetido');

/** Con qué dato se distingue a una persona de otra que se llama igual. */
function comoSeDistingue(ficha) {
  if (ficha.rut) return `RUT ${ficha.rut}`;
  if (ficha.fecha_nacimiento) {
    const [a, m, d] = String(ficha.fecha_nacimiento).slice(0, 10).split('-');
    return `nacida el ${d}-${m}-${a}`;
  }
  return 'sin RUT ni fecha de nacimiento';
}

/**
 * Las fichas de esta misma iglesia que se llaman igual que la que se guarda.
 *
 * Se traen las de la iglesia y se comparan acá y no en la consulta, por lo
 * mismo que en Miembros: el LOWER de SQLite no sabe de tildes, y las tildes
 * son justamente lo que hay que pasar por alto.
 */
function lasQueSeLlamanIgual(db, ficha, id) {
  if (!ficha.iglesia_id) return [];
  const nombres = comoSeCompara(ficha.nombres);
  const apellidos = comoSeCompara(ficha.apellidos);
  if (!nombres) return [];

  const iguales = (otra) => {
    const suyoNombres = comoSeCompara(otra.nombres);
    const suyoApellidos = comoSeCompara(otra.apellidos);
    if (apellidos && suyoApellidos) {
      return suyoNombres.split(' ')[0] === nombres.split(' ')[0] && suyoApellidos === apellidos;
    }
    if (!apellidos && !suyoApellidos) return suyoNombres === nombres;
    return false; // el caso mezclado: ver el comentario de arriba
  };

  return db
    .prepare(
      `SELECT id, nombres, apellidos, rut, fecha_nacimiento, miembro_id
         FROM no_miembros WHERE iglesia_id = ? AND id IS NOT ?`
    )
    .all(ficha.iglesia_id, id || 0)
    .filter((otra) => iguales(otra)
      // dos RUT distintos son dos personas distintas: no hay nada que preguntar
      && !(otra.rut && ficha.rut && otra.rut !== ficha.rut));
}

/**
 * ¿Y ese RUT no será de alguien que ya está inscrito?
 *
 * El RUT es opcional acá, y cuando se escribe se valida y no se repite
 * DENTRO de este registro. El otro registro no se miraba. Medido: una
 * ficha de no miembro con el RUT de un miembro inscrito se aceptaba (201)
 * y ese RUT quedaba existiendo en los dos registros a la vez, sin que
 * nadie lo supiera. El sistema sí se daba cuenta —«Ya hay un miembro
 * inscrito con ese RUT»— pero recién al apretar «Inscribir como miembro»,
 * que puede ser meses después.
 *
 * Un RUT es único por definición, así que casi siempre es la misma
 * persona; pero también puede ser un dígito mal tecleado en cualquiera de
 * las dos fichas, y bloquear dejaría a alguien sin poder registrar la
 * entrega que tiene en la mano. Se pregunta, y se ofrece abrir la ficha de
 * miembro, que es lo que hay que hacer cuando es la misma.
 *
 * NO SE NOMBRA A QUIEN NO SE ALCANZA A VER. Si el miembro es de una
 * iglesia que esta persona no administra, se dice que ese RUT ya está
 * inscrito y nada más: el aviso no puede ser la puerta por la que se
 * averigüe quién es quién en otra congregación.
 */
function avisoDeRutYaInscrito(data, { existing, db, usuario }) {
  const rut = data.rut !== undefined ? data.rut : existing && existing.rut;
  if (!rut) return null;
  const ya = db.prepare('SELECT id, nombres, apellidos, iglesia_id FROM miembros WHERE rut = ?').get(rut);
  if (!ya) return null;

  const suyas = require('../alcance').iglesiasDe(usuario);
  const loAlcanza = !suyas.length || suyas.includes(Number(ya.iglesia_id));
  if (!loAlcanza) {
    return {
      error: 'Ese RUT ya está inscrito como miembro, en una iglesia que usted no administra. '
        + 'Si es la misma persona, esta ficha va a quedar repetida en los dos registros: '
        + 'confírmelo con la oficina antes de seguir.',
      confirmar: 'rut_de_un_miembro',
    };
  }
  const nombre = `${ya.nombres || ''} ${ya.apellidos || ''}`.trim();
  return {
    error: `Ese RUT es de ${nombre}, que ya está inscrito como miembro. Si es la misma persona, `
      + 'lo que se le entregue va en su ficha de miembro: esta quedaría repetida y su historial '
      + 'partido en dos. Si el RUT quedó mal escrito en alguna de las dos, corríjalo.',
    confirmar: 'rut_de_un_miembro',
    ir: { texto: '👤 Abrir su ficha de miembro', a: `#/m/miembros/ficha/${ya.id}` },
  };
}

/**
 * CUÁNTO SE LE HA ENTREGADO A CADA FICHA, para el listado.
 *
 * El listado mostraba nombre, apellido, RUT, teléfono, si se acerca y la
 * iglesia. Medido sobre 60 fichas: 73 de las 125 celdas con título estaban en
 * blanco —el 58 %—, y el RUT lo estaba en las 60, porque quien llega al
 * mostrador casi nunca anda con el carnet. Se miraba todos los días una grilla
 * con la mitad de los casilleros vacíos, y lo único que este registro existe
 * para saber —cuántas veces se le ha entregado algo a esta persona— no estaba
 * en ninguna columna.
 *
 * UNA SOLA CONSULTA PARA TODO EL LISTADO. Un cálculo por fila serían veinticinco
 * consultas por página; acá se agrupan las entregas una vez y se guardan en el
 * `recuerdo`, que dura lo que dura la respuesta (ver server/crud.js). Es el
 * mismo camino que usa la agenda de asistencia para no recorrer un cuerpo por
 * cada actividad.
 */
function loEntregadoAcadaFicha(db, recuerdo) {
  const donde = 'no_miembros:entregas';
  if (recuerdo && recuerdo.has(donde)) return recuerdo.get(donde);
  const mapa = new Map();
  try {
    const filas = db
      .prepare(
        `SELECT no_miembro_id AS id, COUNT(*) AS veces, MAX(fecha) AS ultima
           FROM ayudas_sociales
          WHERE no_miembro_id IS NOT NULL AND estado = 'Entregada'
          GROUP BY no_miembro_id`
      )
      .all();
    for (const f of filas) mapa.set(f.id, f);
  } catch (e) {
    // Sin el módulo de ayudas el listado sale igual, con la columna en cero:
    // una pantalla no se cae porque falte algo que solo la acompaña.
  }
  if (recuerdo) recuerdo.set(donde, mapa);
  return mapa;
}

/**
 * El aviso, o null si no hay ninguna que se llame igual.
 *
 * Se dice CUÁNTAS ENTREGAS tiene anotadas la que ya existe, porque es el
 * argumento de verdad para abrir esa en vez de crear otra: crear una nueva no
 * pierde el historial, lo parte en dos, y eso desde el formulario no se ve.
 */
function avisoDeFichaRepetida(db, ficha, id) {
  const iguales = lasQueSeLlamanIgual(db, ficha, id);
  if (!iguales.length) return null;

  const susAyudas = (otra) => db
    .prepare("SELECT COUNT(*) c FROM ayudas_sociales WHERE no_miembro_id = ? AND estado = 'Entregada'")
    .get(otra.id).c;

  const senas = (otra) => {
    const partes = [comoSeDistingue(otra)];
    const entregas = susAyudas(otra);
    if (entregas) partes.push(`${entregas} entrega${entregas === 1 ? '' : 's'} anotada${entregas === 1 ? '' : 's'}`);
    if (otra.miembro_id) partes.push('ya inscrita como miembro');
    return partes.join(', ');
  };

  const listadas = iguales.slice(0, 3).map((o) => `${o.nombres} ${o.apellidos || ''}`.trim() + ` (${senas(o)})`).join('; ');
  const yMas = iguales.length > 3 ? `, y ${iguales.length - 3} más` : '';

  return {
    error:
      (iguales.length === 1
        ? `Ya hay una ficha de ${`${iguales[0].nombres} ${iguales[0].apellidos || ''}`.trim()} en esta iglesia `
          + `(${senas(iguales[0])}). `
        : `Ya hay ${iguales.length} fichas con ese mismo nombre en esta iglesia: ${listadas}${yMas}. `)
      + 'Si es la misma persona, abra la que ya existe en vez de crear otra: así todo lo que se le ha '
      + 'entregado queda en una sola ficha y se puede ver junto. Si de verdad son dos personas '
      + 'distintas, confirme.',
    confirmar: 'miembro_con_el_mismo_nombre',
    /*
     * Y se ofrece abrirla. «Abra la que ya existe» sin decir dónde obliga a
     * salir, buscarla a mano y volver a llenar el formulario: en la práctica
     * nadie lo hace y se aprieta «seguir», que es el único botón que hace
     * algo. Con varias iguales se lleva a la primera, que es por donde hay
     * que empezar a mirar.
     */
    ir: { texto: '👤 Abrir la que ya existe', a: `#/m/no_miembros/ficha/${iguales[0].id}` },
  };
}

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
  /*
   * Lo que se mira todos los días.
   *
   * Sale el RUT: en este registro está en blanco SIEMPRE —60 de 60 fichas de
   * prueba— porque quien llega al mostrador no anda con el carnet, y el módulo
   * lo dice en su encabezado. Sigue en la ficha y se sigue buscando por él.
   *
   * Entran las dos columnas por las que este registro existe: cuántas veces se
   * le ha entregado algo y cuándo fue la última. La primera nunca va en blanco
   * —un cero es un dato, no un hueco— y es lo que se pregunta en el mostrador.
   */
  listFields: ['nombres', 'apellidos', 'telefono', 'entregas', 'ultima_ayuda', 'asistencia', 'iglesia_id'],
  /**
   * Los de un grupo, preguntado desde acá. Igual que en Miembros, pero por el
   * otro enlace de la ficha de integrante: esta gente no está en la membresía.
   */
  filtrosPropios: [
    {
      nombre: 'cuerpo_id', label: 'Cuerpo o grupo', tipo: 'ref', ref: 'cuerpos',
      donde: (valor) => ({
        sql: `id IN (SELECT no_miembro_id FROM integrantes_cuerpo
                      WHERE cuerpo_id = ? AND no_miembro_id IS NOT NULL
                        AND estado IN ('Activo', 'En prueba'))`,
        params: [Number(valor) || 0],
      }),
    },
    /*
     * Quién ya se inscribió y quién no.
     *
     * Una ficha que se inscribió no se borra —de ella cuelgan las entregas de
     * cuando esa persona todavía no era miembro— pero su ficha viva es la
     * otra, y en el listado se veía igual que las demás. La ficha misma lo
     * avisa arriba desde la 1.173.0; acá va lo que ese aviso no puede dar:
     * separar las que siguen siendo de este registro de las que ya no.
     *
     * Va de filtro y no de columna, a propósito: este listado se acaba de
     * limpiar de columnas que están casi siempre en blanco, y una que solo
     * dice algo en un puñado de fichas sería otra de esas.
     */
    {
      nombre: 'ya_inscrita', label: 'Se inscribió', tipo: 'select',
      opciones: ['Todavía no', 'Ya se inscribió'],
      donde: (valor) => ({
        sql: valor === 'Ya se inscribió' ? 'miembro_id IS NOT NULL' : 'miembro_id IS NULL',
        params: [],
      }),
    },
  ],
  filterFields: ['asistencia', 'iglesia_id'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  /*
   * La ficha se imprime.
   *
   * Quien va a entregar la caja de mercadería sale con una hoja: el nombre, la
   * dirección, el teléfono y qué se le llevó. Esa hoja se estaba escribiendo a
   * mano copiando de la pantalla, porque la ficha de un miembro tenía su botón
   * de imprimir y esta no. El sistema ya sabe sacar fichas con el formato
   * formal de la organización —lo hace en Miembros, en Pastores y en Cuerpos—:
   * lo único que faltaba era encender la llave y que la hoja llevara además
   * las entregas, que es lo que la hace servir para ir a la casa.
   */
  printable: true,

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
    {
      name: 'entregas', label: 'Entregas', type: 'texto', ancho: 'mini', enElPapel: false,
      calc: (r, { db, recuerdo }) => {
        const suyo = loEntregadoAcadaFicha(db, recuerdo).get(r.id);
        // Cero y no vacío: que a esta señora no se le haya entregado nada es
        // un dato, y de los que más se miran.
        return String(suyo ? suyo.veces : 0);
      },
    },
    {
      name: 'ultima_ayuda', label: 'Última entrega', type: 'texto', enElPapel: false,
      calc: (r, { db, recuerdo }) => {
        const suyo = loEntregadoAcadaFicha(db, recuerdo).get(r.id);
        // Escrita como se lee y no como la guarda la base: la columna de al
        // lado dice «3» y esta tiene que decir «20-07-2026», no «2026-07-20».
        return suyo && suyo.ultima ? require('../fechas').comoSeLee(suyo.ultima) : '';
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
    /*
     * Y no antes de que naciera.
     *
     * Cada fecha se revisaba sola y bien —2030 se rechaza porque no ha
     * llegado, 1890 porque no se anotan fechas tan antiguas— pero no se
     * comparaban entre sí: medido, una ficha nacida el 15-06-2010 y conocida
     * desde el 01-03-2005 se guardaba sin decir nada, y quedaba diciendo que a
     * esa señora se la conoce desde hace veintiún años y tiene dieciséis. Es
     * el error de tecleo de siempre —el año equivocado— y no cuesta nada
     * atajarlo: el mecanismo ya estaba y a este campo no se le había pedido.
     */
    { name: 'conocido_desde', label: 'Se le conoce desde', type: 'date',
      noAntesDe: 'fecha_nacimiento' },

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
     * ¿No será la misma señora que ya está anotada? Ver arriba, en
     * `avisoDeFichaRepetida`, cuándo se pregunta y por qué no siempre.
     *
     * Al editar solo se mira si ESTE guardado cambia el nombre o la iglesia:
     * revisarlo siempre trancaría a quien viene a anotarle el teléfono que por
     * fin dio, que es la mitad de lo que se hace en este registro.
     */
    beforeSave(data, { id, existing, db, confirmado, user }) {
      if (confirmado) return null;
      const porElRut = avisoDeRutYaInscrito(data, { existing, db, usuario: user });
      if (porElRut) return porElRut;
      const antesDeGuardar = existing || {};
      const cambiaElNombre = ['nombres', 'apellidos', 'iglesia_id']
        .some((campo) => data[campo] !== undefined
          && comoSeCompara(data[campo]) !== comoSeCompara(antesDeGuardar[campo]));
      if (!id || cambiaElNombre) {
        const repetida = avisoDeFichaRepetida(db, { ...antesDeGuardar, ...data }, id);
        if (repetida) return repetida;
      }
      return null;
    },

    /**
     * Corregirle el nombre a la ficha se lo corrige donde se copió.
     *
     * El nombre que muestran su ayuda, el grupo que encarga, su ficha de
     * integrante, su cuota pagada y la solicitud que presentó es una copia que
     * se sacó de acá el día que se guardó. Sin esto, corregir «Soto» por
     * «Sotto» dejaba todo eso diciendo el apellido malo, y desde ahí no se
     * podía arreglar: esos campos son de solo lectura. El porqué de reescribir
     * la copia —y no mostrar el nombre vivo— está en
     * server/el-nombre-copiado.js.
     */
    afterSave(fila, { db }) {
      require('../el-nombre-copiado').ponerAlDiaElNombre(db, 'no_miembros', fila.id);
    },

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
