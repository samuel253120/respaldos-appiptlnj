/**
 * Módulo: Miembros (membresía de cada iglesia).
 *
 * La edad se calcula sola a partir de la fecha de nacimiento: no se guarda,
 * se resuelve cada vez que se lee la ficha, así nunca queda desactualizada.
 *
 * Las fechas de matrimonio (civil y religioso) solo aparecen cuando el estado
 * civil es "Casado(a)". Si más adelante cambia el estado, el dato no se
 * pierde: queda guardado, solo deja de mostrarse.
 *
 * Los documentos del miembro (carnet, ficha de registro, ficha de
 * actualización, etc.) van en su propio módulo, para poder adjuntar todos los
 * que hagan falta a una misma persona.
 *
 * Trato: cada miembro muestra cómo se le dice —Hermano, Hermana, Oficial,
 * Guía de Obra, Pastor o Pastora—, calculado según su género, si pertenece al
 * cuerpo de oficiales y qué cargo tiene en Pastores / Guías (ver
 * server/tratamiento.js).
 * Se puede fijar a mano cuando corresponda otro trato.
 *
 * Matrimonio: al vincular a dos miembros como cónyuges, el vínculo se
 * devuelve solo en la ficha del otro, y las fechas de matrimonio se copian a
 * quien las tenga en blanco, para no registrarlas dos veces.
 *
 * Acceso al sistema: a un miembro se le puede crear su usuario desde su
 * propia ficha. Quedan enlazados, y el RUT, el nombre, el correo y el
 * teléfono se mantienen iguales en los dos módulos, se cambien donde se
 * cambien.
 *
 * La ficha viene ordenada por secciones: identificación, adulto responsable
 * (solo para menores de 18, según la fecha de nacimiento), educación y
 * trabajo, estado civil y familia, contacto, vida en la iglesia, contacto de
 * emergencia, información médica y notas.
 *
 * Los datos de salud y la nota importante van marcados como `sensible`: el
 * historial deja constancia de que cambiaron, sin copiar su contenido.
 */
const { TRATAMIENTOS, tratamientoDe } = require('../tratamiento');

/** Por dónde llegó cada persona a la iglesia. */
const FORMAS_DE_INGRESO = [
  'Servicio General',
  'Redes Sociales',
  'Traslado de Iglesia',
  'Nacido en la Iglesia',
  'Campaña Evangelística',
  'Invitación de Hermano(a)',
  'Otro',
];

/**
 * Cómo participa cada persona en la vida de la iglesia. No es lo mismo que su
 * estado (activo, inactivo…): una persona activa puede ser oyente, y un menor
 * de edad sigue siendo miembro.
 */
const TIPOS_DE_MIEMBRO = [
  'Miembro Nuevo', 'Miembro Menor de Edad', 'Miembro Oyente', 'Miembro Activo', 'Miembro Líder',
];

/** Con qué entra quien recién se registra, mientras nadie diga otra cosa. */
const TIPO_DE_ENTRADA = 'Miembro Nuevo';

/** El que le toca a quien todavía no cumple 18. */
const TIPO_DE_MENOR = 'Miembro Menor de Edad';

/**
 * Deja al día el usuario del sistema enlazado a este miembro: comparten el
 * RUT, el nombre, el correo, el teléfono y la foto. Si el miembro pasa a fallecido o
 * trasladado, su acceso queda desactivado.
 */
function sincronizarUsuario(fila, db) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(fila.id);
  if (!usuario) return;

  const nombre = `${fila.nombres || ''} ${fila.apellidos || ''}`.trim();
  const cambios = [];
  const valores = [];
  const igualar = (columna, valor) => {
    if ((valor || null) === (usuario[columna] || null)) return;
    cambios.push(`"${columna}" = ?`);
    valores.push(valor || null);
  };
  igualar('nombre', nombre);
  igualar('rut', fila.rut);
  igualar('email', fila.email);
  igualar('telefono', fila.telefono);
  igualar('foto', fila.foto);

  // Quien ya no está en la iglesia no debe poder entrar al sistema
  if (['Fallecido', 'Trasladado'].includes(fila.estado) && usuario.activo) {
    cambios.push('activo = ?');
    valores.push(0);
  }
  if (!cambios.length) return;
  db.prepare(`UPDATE usuarios SET ${cambios.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...valores, usuario.id);
}

/**
 * Dos fichas de la misma persona.
 *
 * El RUT es único, pero no obligatorio, y en una base traída de otro sistema
 * casi nadie lo trae. Sin RUT, dos fichas de la misma persona son dos personas
 * distintas para el sistema. Medido antes de esto: se creó «Zzprueba Duplicada
 * Del Carmen» dos veces seguidas en la misma iglesia y las dos entraron con un
 * 201, sin una palabra.
 *
 * Lo que cuesta no es la fila de más: su asistencia queda partida en dos y
 * ninguna de las dos fichas muestra su historia completa, se le puede emitir
 * dos veces el mismo certificado, y entra dos veces al cuerpo y cuenta dos
 * veces entre los convocados. Cuando alguien se da cuenta, hay que juntar a
 * mano lo que quedó colgando de cada una. Y como buscar «María González» hoy
 * no encuentra a María González, el paso siguiente natural es justamente
 * crearla de nuevo.
 *
 * ── Con qué se compara ──
 *
 * Misma iglesia, mismo PRIMER nombre y mismos apellidos, sin mirar tildes ni
 * mayúsculas. El primer nombre y no todos, porque el segundo se escribe unas
 * veces sí y otras no —«María José» y «María» son la misma señora—. Los
 * apellidos COMPLETOS y no solo el primero: medido sobre las 603 fichas
 * cargadas, comparar solo el primer apellido daba 1.726 choques —«Luis Pérez
 * Soto» contra «Luis Pérez González», que no son la misma persona ni de
 * lejos— y comparar los dos da 185. Nueve veces menos ruido, y lo que se
 * descarta es justo aquello en que los apellidos no coinciden.
 *
 * ── Cuándo NO pregunta ──
 *
 * Si las dos fichas traen RUT y son distintos, son dos personas distintas y no
 * hay nada que preguntar: en la base cargada eso solo deja fuera 1.726 avisos
 * inútiles. Si el RUT es el mismo, no llega hasta acá: lo ataja antes la regla
 * de campo único.
 *
 * Y al editar solo se revisa cuando este guardado cambia el nombre o la
 * iglesia. Revisarlo siempre castigaría a quien viene a corregir un teléfono
 * por una ficha repetida que ya estaba y que a lo mejor ni conoce —el mismo
 * error que se arregló en las reglas del trato pastoral, unas líneas más
 * abajo—.
 *
 * ── Y no bloquea: pregunta ──
 *
 * Dos hermanas llamadas igual existen. Se devuelve un objeto con `confirmar`,
 * que el motor convierte en dos botones en vez de en un aviso rojo. Al
 * importar una planilla no hay a quién preguntarle quinientas veces, así que
 * la fila queda marcada y quien importa la revisa en la vista previa, que es
 * como el sistema resuelve todas las preguntas por planilla (ver
 * server/importar.js).
 */
function comoSeCompara(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

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
 * Se traen las de la iglesia y se comparan acá, porque SQLite no sabe ignorar
 * las tildes y son justamente lo que hay que ignorar. Medido: 1,5 ms sobre una
 * iglesia de 600 fichas y 8,9 ms sobre una de 4.400. Se paga solo al crear una
 * ficha o al cambiarle el nombre, que es algo que se hace de a una y a mano.
 */
function lasQueSeLlamanIgual(db, ficha, id) {
  const nombre = comoSeCompara(ficha.nombres).split(' ')[0];
  const apellidos = comoSeCompara(ficha.apellidos);
  if (!nombre || !apellidos || !ficha.iglesia_id) return [];

  return db
    .prepare('SELECT id, nombres, apellidos, rut, fecha_nacimiento FROM miembros WHERE iglesia_id = ? AND id IS NOT ?')
    .all(ficha.iglesia_id, id || 0)
    .filter((otra) => comoSeCompara(otra.nombres).split(' ')[0] === nombre
      && comoSeCompara(otra.apellidos) === apellidos
      // dos RUT distintos son dos personas distintas: no hay nada que preguntar
      && !(otra.rut && ficha.rut && otra.rut !== ficha.rut));
}

/** El aviso, o null si no hay ninguna que se llame igual. */
function avisoDeFichaRepetida(db, ficha, id) {
  const iguales = lasQueSeLlamanIgual(db, ficha, id);
  if (!iguales.length) return null;

  const listadas = iguales.slice(0, 3)
    .map((o) => `${o.nombres} ${o.apellidos} (${comoSeDistingue(o)})`).join('; ');
  const yMas = iguales.length > 3 ? `, y ${iguales.length - 3} más` : '';

  return {
    error:
      (iguales.length === 1
        // Con una sola no se repite el nombre: ya está escrito en el
        // formulario que la persona está mirando
        ? `Ya hay una ficha de ${iguales[0].nombres} ${iguales[0].apellidos} en esta iglesia `
          + `(${comoSeDistingue(iguales[0])}). `
        : `Ya hay ${iguales.length} fichas con ese mismo nombre en esta iglesia: ${listadas}${yMas}. `)
      + 'Si es la misma persona, abra la que ya existe en vez de crear otra: así su asistencia, sus '
      + 'certificados y su historial quedan en un solo lugar. Si de verdad son dos personas distintas, '
      + 'confirme.',
    confirmar: 'miembro_con_el_mismo_nombre',
  };
}

/** Años cumplidos a la fecha de hoy. */
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

/**
 * Qué tipo le corresponde a alguien por su edad, si es que la edad lo decide.
 *
 * Solo la minoría de edad manda: un menor es «Miembro Menor de Edad» y punto
 * —así lo dejó la migración que completó los que ya estaban, en la 1.60.x—.
 * De los 18 para arriba la edad no decide nada: nuevo, oyente, activo o líder
 * lo elige la iglesia, y por eso acá se devuelve null en vez de inventar uno.
 */
function tipoQueLeCorresponde(fechaNacimiento) {
  const anios = edadEnAnios(fechaNacimiento);
  if (anios == null) return null;
  return anios < 18 ? TIPO_DE_MENOR : null;
}

/** Meses cumplidos, para los menores de un año. */
function mesesDeVida(fechaNacimiento) {
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  const hoy = new Date();
  let meses = (hoy.getFullYear() - nace.getFullYear()) * 12 + (hoy.getMonth() - nace.getMonth());
  if (hoy.getDate() < nace.getDate()) meses--;
  return Math.max(0, meses);
}

module.exports = {
  name: 'miembros',
  label: 'Miembros',
  labelSingular: 'Miembro',
  icon: '🧍',
  group: 'Personas',
  order: 20,
  display: '{nombres:primero} {apellidos}',
  /*
   * La dirección entra en la búsqueda: los dos registros de gente guardan la
   * misma clase de persona y se buscaban distinto —No miembros sí buscaba por
   * dirección y Miembros no—, así que «Los Aromos» encontraba a los visitantes
   * de esa calle y no a los miembros. Sirve para las visitas por sector, que
   * es justo para lo que la propia ficha dice que se pide la dirección.
   *
   * Y no abre nada: quien no tiene permiso para VER la dirección tampoco la
   * puede usar para buscar (ver server/sensibles.js).
   */
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email', 'direccion'],
  listFields: ['foto', 'tratamiento', 'nombres', 'apellidos', 'rut', 'edad', 'tipo_miembro', 'iglesia_id', 'estado'],
  filterFields: ['tipo_miembro', 'estado', 'iglesia_id'],
  /**
   * «Los de este cuerpo, con su teléfono» no se contestaba desde acá.
   *
   * La ficha de cada persona muestra en qué cuerpos participa, pero el listado
   * no se podía acotar a uno: había que abrir el cuerpo, mirar sus
   * integrantes, y volver a Miembros a buscar a cada uno. Con esto la pregunta
   * se contesta donde está la gente, y la planilla que se baja trae lo mismo
   * que se está viendo.
   *
   * Cuenta quien pertenece HOY —activo o en prueba—: a quien se retiró no se
   * le sigue contando entre los del cuerpo.
   */
  filtrosPropios: [
    {
      nombre: 'cuerpo_id', label: 'Cuerpo o grupo', tipo: 'ref', ref: 'cuerpos',
      donde: (valor) => ({
        sql: `id IN (SELECT miembro_id FROM integrantes_cuerpo
                      WHERE cuerpo_id = ? AND miembro_id IS NOT NULL
                        AND estado IN ('Activo', 'En prueba'))`,
        params: [Number(valor) || 0],
      }),
    },
  ],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  printable: true,
  computed: [
    {
      name: 'tratamiento', label: 'Trato', type: 'texto',
      calc: (r, { db }) => tratamientoDe(r, db),
    },
    {
      /**
       * Lo que quedó pendiente entre esta ficha y la de su cónyuge.
       *
       * Vincular el matrimonio de un pastor y registrarlo en Pastores / Guías
       * son dos actos distintos, y pueden pasar meses entre uno y otro. En ese
       * rato la pareja queda a medias: él figura como pastor y ella sigue con
       * trato de hermana. Guardar la ficha ya no se bloquea por eso —bloquear
       * castigaba a quien venía a corregir un teléfono— así que se dice acá,
       * arriba de la ficha, que es donde alguien puede hacer algo.
       *
       * Cuesta poco: la ficha que no tiene cónyuge —que son casi todas— se
       * responde sin mirar la base.
       */
      name: 'pareja_pendiente', label: 'Pendiente con su cónyuge', type: 'texto',
      calc: (r, { db }) => {
        if (!r.conyuge_id) return '';
        const { esPastorRegistrado, esPastorPorSiMismo } = require('../tratamiento');
        const otro = db.prepare('SELECT id, nombres, apellidos, genero, rut FROM miembros WHERE id = ?').get(r.conyuge_id);
        if (!otro) return 'La persona que figura como su cónyuge ya no está en Miembros.';
        if (!esPastorRegistrado(otro, db) && !esPastorRegistrado(r, db)) return '';
        const falta = [r, otro].find((quien) => quien && !esPastorPorSiMismo(quien, db));
        if (!falta) return '';
        const trato = falta.genero === 'Femenino' ? 'Pastora' : 'Pastor';
        const quien = Number(falta.id) === Number(r.id) ? 'Esta persona' : `${falta.nombres} ${falta.apellidos}`;
        return `${quien} todavía no tiene trato de ${trato}, y su cónyuge sí figura en Pastores / Guías. ` +
          `Regístrele su ficha en Pastores / Guías, o fíjele el trato de ${trato} en su ficha.`;
      },
    },
    {
      /**
       * Quién responde por este menor, venga de donde venga.
       *
       * La ficha, la impresión y quien pregunte tienen que ver UNA respuesta,
       * no dos campos que a veces están y a veces no. Cuesta poco: la ficha
       * que no tiene adulto elegido —que son casi todas, porque los menores
       * son unos pocos— se responde sin mirar la base.
       */
      name: 'responsable', label: 'Adulto responsable', type: 'texto',
      calc: (r, { db }) => {
        if (!r.responsable_id) return r.responsable_nombre || '';
        const quien = db
          .prepare('SELECT nombres, apellidos, rut, telefono FROM miembros WHERE id = ?')
          .get(r.responsable_id);
        if (!quien) return r.responsable_nombre || '';
        const datos = [quien.rut, quien.telefono].filter(Boolean).join(' · ');
        return `${quien.nombres} ${quien.apellidos}`.trim() + (datos ? ` (${datos})` : '');
      },
    },
    {
      name: 'edad', label: 'Edad', type: 'texto',
      // La edad no es una columna, pero la fecha de nacimiento sí: ordenar por
      // edad es ordenar por ella al revés. Sin esto, pedir el listado por edad
      // no ordenaba nada y nadie avisaba.
      ordenarPor: { campo: 'fecha_nacimiento', invertido: true },
      calc: (r) => {
        const a = edadEnAnios(r.fecha_nacimiento);
        if (a == null) return '';
        if (a > 0) return `${a} año${a === 1 ? '' : 's'}`;
        const m = mesesDeVida(r.fecha_nacimiento); // los más pequeños, en meses
        return `${m} mes${m === 1 ? '' : 'es'}`;
      },
    },
  ],
  fields: [
    // ---------------- Identificación ----------------
    {
      name: 'foto', label: 'Foto', type: 'file', accept: 'image/*', seccion: 'Identificación',
      reservado: 'miembros_foto',
      recorte: 'cuadrado',
      help: 'Se puede sacar con el teléfono: al subirla se ajusta sola de tamaño para que cargue rápido.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true, reservado: 'miembros_identidad',
      help: 'Con o sin puntos. Se valida el dígito verificador y evita miembros repetidos.',
    },
    { name: 'nombres', label: 'Nombres', recorta: 'primero', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    {
      name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', reservado: 'miembros_identidad',
      mostrarEdad: true, help: 'La edad se calcula sola.',
    },
    {
      name: 'genero', label: 'Sexo', type: 'select',
      options: ['Femenino', 'Masculino'],
    },
    {
      /*
       * Va al FINAL de la identificación, y no antes del nombre.
       *
       * Estaba cuarto en la pantalla —después de la foto, la iglesia y el
       * RUT— o sea que lo primero que se decidía al registrar a alguien era
       * una excepción que casi nadie debe tocar: el trato lo calcula el
       * sistema solo. Quien lo necesita lo encuentra igual acá abajo; quien
       * no, deja de tener que decidir sobre algo que no entiende antes de
       * haber escrito el nombre.
       */
      name: 'tratamiento_personalizado', label: 'Trato (fijado a mano)', type: 'select',
      options: TRATAMIENTOS,
      help: 'Solo si le corresponde un trato distinto del que calcula el sistema. En blanco, se calcula solo.',
    },

    /*
     * ------- Adulto responsable (solo para menores de 18) -------
     *
     * El adulto responsable se ELIGE de la membresía cuando está registrado, y
     * se escribe a mano solo cuando no lo está.
     *
     * Antes solo se escribía. Una madre con tres hijos quedaba tecleada tres
     * veces, con su RUT tecleado tres veces, y si cambiaba de teléfono había
     * que corregirlo en cuatro fichas. No se podía pedir «el grupo familiar de
     * los González» para una visita, ni saber de un niño quién lo viene a
     * buscar sin abrir su ficha y leerla.
     *
     * Elegida la ficha, el nombre, el RUT y el teléfono se BORRAN de acá: no
     * se guardan dos veces. Se leen de la ficha de esa persona, que es donde
     * se mantienen al día. El parentesco se queda, porque no es un dato de
     * ella sino del vínculo.
     */
    {
      name: 'responsable_id', label: 'Adulto responsable (registrado)', type: 'ref', ref: 'miembros',
      seccion: 'Adulto responsable (menor de edad)', showIf: { field: 'fecha_nacimiento', menorDe: 18 },
      help: 'Quién responde por este miembro mientras sea menor de 18 años. '
        + 'Si está en la membresía, elíjalo acá: sus datos se leen de su ficha y no hay que escribirlos.',
    },
    {
      name: 'responsable_nombre', label: 'Nombre y apellido del adulto responsable', type: 'text',
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
      help: 'Solo si NO está en la membresía. Al elegirlo arriba, esto se borra solo.',
    },
    {
      name: 'responsable_rut', label: 'RUT del adulto responsable', type: 'rut',
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
    },
    {
      name: 'responsable_parentesco', label: 'Parentesco con el menor', type: 'text',
      sugerencias: ['Madre', 'Padre', 'Abuelo(a)', 'Tío(a)', 'Hermano(a)', 'Tutor(a) legal'],
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
      help: 'Se elige de la lista o se escribe como corresponda (abuela, tía, madrina…).',
    },
    {
      name: 'responsable_telefono', label: 'Teléfono del adulto responsable', type: 'tel',
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
    },

    // ---------------- Educación y trabajo ----------------
    {
      name: 'nivel_educacional', label: 'Nivel educacional', type: 'select',
      seccion: 'Educación y trabajo',
      options: [
        'Sin estudios formales',
        'Básica en curso', 'Básica incompleta', 'Básica completa',
        'Media en curso', 'Media incompleta', 'Media completa',
        'Técnica en curso', 'Técnica incompleta', 'Técnica completa',
        'Universitaria en curso', 'Universitaria incompleta', 'Universitaria completa',
        'Postgrado',
      ],
      help: '«En curso» es quien está estudiando ahora; «incompleta», quien la dejó.',
    },
    {
      name: 'titulo_estudios', label: 'Título o estudios cursados', type: 'text',
      help: 'Ej: Técnico en enfermería, Profesor de Historia…',
    },
    {
      name: 'ocupacion', label: 'Profesión u oficio', type: 'text',
      help: 'A qué se dedica hoy. Ej: gásfiter, contadora, dueña de casa, estudiante.',
    },
    { name: 'lugar_trabajo', label: 'Lugar de trabajo o estudio', type: 'text' },

    // ---------------- Estado civil y familia ----------------
    {
      name: 'estado_civil', label: 'Estado civil', type: 'select', seccion: 'Estado civil y familia',
      options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)', 'Divorciado(a)'],
    },
    {
      name: 'fecha_matrimonio_civil', label: 'Fecha de matrimonio civil', type: 'date', noAntesDe: 'fecha_nacimiento',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    {
      name: 'fecha_matrimonio_religioso', label: 'Fecha de matrimonio por la iglesia', type: 'date', noAntesDe: 'fecha_nacimiento',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    {
      name: 'conyuge_nombre', label: 'Nombre del cónyuge', type: 'text',
      showIf: { field: 'estado_civil', in: ['Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)'] },
      help: 'Se anota esté o no registrado como miembro.',
    },
    {
      name: 'conyuge_id', label: 'Cónyuge (miembro)', type: 'ref', ref: 'miembros',
      showIf: { field: 'estado_civil', in: ['Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)'] },
      help: 'Si además está registrado, elíjalo aquí: el vínculo queda en las dos fichas.',
    },

    // ---------------- Contacto ----------------
    // Reservados: se puede quitar el permiso `miembros_contacto` a quien tenga
    // que consultar el registro sin llevarse los teléfonos y las direcciones de
    // la congregación. De fábrica lo tienen todos (ver server/sensibles.js).
    { name: 'telefono', label: 'Teléfono', type: 'tel', seccion: 'Contacto', reservado: 'miembros_contacto' },
    { name: 'email', label: 'Correo electrónico', type: 'email', reservado: 'miembros_contacto' },
    { name: 'direccion', label: 'Dirección', type: 'text', reservado: 'miembros_contacto' },

    // ---------------- Vida en la iglesia ----------------
    {
      name: 'forma_ingreso', label: 'Forma de ingreso', type: 'select', seccion: 'Vida en la iglesia',
      options: FORMAS_DE_INGRESO,
      help: 'Por dónde llegó a esta iglesia.',
    },
    { name: 'fecha_ingreso', label: 'Fecha de ingreso a la iglesia', type: 'date', noAntesDe: 'fecha_nacimiento' },
    { name: 'fecha_conversion', label: 'Fecha de conversión', type: 'date', noAntesDe: 'fecha_nacimiento' },
    { name: 'fecha_bautismo', label: 'Fecha de bautismo', type: 'date', noAntesDe: 'fecha_nacimiento' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'En disciplina', 'Trasladado', 'Fallecido'],
    },
    /*
     * ------- De una salida quedaba el resultado, no adónde ni cuándo -------
     *
     * El estado decía «Trasladado» o «Fallecido» y ahí terminaba. No había
     * dónde anotar a qué iglesia se fue, ni desde cuándo, ni la fecha de
     * fallecimiento. «Cuántos se trasladaron este año y a qué iglesias» es una
     * pregunta de informe anual, y había que reconstruirla leyendo bitácoras
     * una por una. Cuando la iglesia que recibe pide el traslado, tampoco
     * había dónde anotar que se mandó.
     *
     * Aparecen solos según el estado, como las fechas de matrimonio cuando se
     * marca «Casado(a)». Y como aquellas: si el estado cambia después, lo
     * escrito NO se borra —queda guardado, solo deja de mostrarse—, que es la
     * regla de esta ficha desde el principio.
     */
    {
      name: 'fecha_salida', label: 'Fecha del traslado', type: 'date',
      noAntesDe: 'fecha_nacimiento', showIf: { field: 'estado', equals: 'Trasladado' },
      help: 'Desde cuándo dejó de ser parte de esta congregación.',
    },
    {
      name: 'iglesia_destino_id', label: 'Iglesia que la recibe', type: 'ref', ref: 'iglesias',
      showIf: { field: 'estado', equals: 'Trasladado' },
      help: 'Si es una de la organización, elíjala acá.',
    },
    {
      name: 'iglesia_destino', label: 'O el nombre de la iglesia, si es de fuera', type: 'text',
      showIf: { field: 'estado', equals: 'Trasladado' },
      help: 'Solo si NO es una de la organización. Al elegirla arriba, esto se borra solo.',
    },
    {
      name: 'fecha_fallecimiento', label: 'Fecha de fallecimiento', type: 'date',
      noAntesDe: 'fecha_nacimiento', showIf: { field: 'estado', equals: 'Fallecido' },
    },
    {
      /**
       * De este campo cuelga quién entra solo a la directiva de la iglesia
       * (ver server/directiva.js), y estaba en blanco en TODAS las fichas de
       * la base cargada: 603 de 603. Un campo del que depende una regla
       * automática y que nadie llena es una regla que no se está aplicando,
       * sin que nadie lo note. Ahora nace con un valor —el que corresponda a
       * la edad, ver `tipoQueLeCorresponde`— y el panel avisa de las fichas
       * que lo tienen en blanco.
       */
      name: 'tipo_miembro', label: 'Tipo de miembro', type: 'select',
      options: TIPOS_DE_MIEMBRO, default: TIPO_DE_ENTRADA,
      help: 'Menor de edad: quien todavía no cumple 18 años. Oyente: asiste sin estar en plena membresía.',
    },

    // ---------------- Contacto de emergencia ----------------
    {
      name: 'emergencia_nombre', label: 'Nombre del contacto', type: 'text',
      seccion: 'Contacto de emergencia',
      help: 'A quién avisar en caso de emergencia.',
    },
    {
      name: 'emergencia_parentesco', label: 'Parentesco', type: 'text',
      sugerencias: ['Cónyuge', 'Esposo', 'Esposa', 'Madre', 'Padre', 'Hijo(a)', 'Hermano(a)',
        'Abuelo(a)', 'Nieto(a)', 'Tío(a)', 'Sobrino(a)', 'Amigo(a)', 'Vecino(a)'],
      help: 'Se elige de la lista o se escribe como corresponda (hija, esposo, nieta…).',
    },
    { name: 'emergencia_telefono', label: 'Teléfono del contacto', type: 'tel' },

    // ---------------- Información médica ----------------
    {
      name: 'enfermedades', label: 'Enfermedades', type: 'textarea', sensible: true,
      seccion: 'Información médica',
      help: 'Diagnósticos o condiciones que conviene conocer (diabetes, hipertensión, epilepsia…).',
    },
    { name: 'alergias', label: 'Alergias', type: 'textarea', sensible: true },
    {
      name: 'indicaciones_medicas', label: 'Indicaciones médicas', type: 'textarea', sensible: true,
      help: 'Medicamentos, cuidados o qué hacer ante una emergencia.',
    },

    // ---------------- Notas ----------------
    {
      name: 'nota_importante', label: 'Nota importante', type: 'textarea', sensible: true,
      destacado: true, seccion: 'Notas',
      help: 'Lo que no se puede pasar por alto de esta persona. Se muestra destacado al abrir su ficha.',
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Los cuerpos y grupos en los que participa este miembro, para verlos en
     * su ficha sin tener que abrir uno por uno. Se busca tanto entre los
     * integrantes como entre quienes los lideran.
     */
    router.get('/miembros/:id(\\d+)/cuerpos', requirePerm('miembros', 'view'), (req, res) => {
      // La ficha tiene que ser de las suyas: por acá salían los nombres de los
      // cuerpos de otra iglesia —y de otros cuerpos de la misma— con solo
      // escribir el número en la dirección.
      if (!require('../alcance').registroSuyo(req, res, 'miembros', req.params.id, 'Esa ficha')) return;
      const id = Number(req.params.id);
      const { cuerposDe } = require('../integrantes');

      // Los que lidera cuentan aunque no tengan ficha de integrante
      const suyos = new Map();
      for (const c of db.prepare('SELECT id, nombre, tipo, estado FROM cuerpos WHERE lider_id = ? ORDER BY nombre').all(id)) {
        suyos.set(c.id, { id: c.id, nombre: c.nombre, tipo: c.tipo, estado: c.estado, lidera: true, en: 'Activo' });
      }
      for (const f of cuerposDe(db, id, { conRetirados: true })) {
        // El motivo del retiro se manda para poder decir POR QUÉ salió: la
        // pantalla mostraba los cuerpos retirados igual que los vigentes, así
        // que la ficha de quien falleció seguía leyéndose como si perteneciera.
        const salida = { motivo: f.motivo_retiro || null, el: f.fecha_retiro || null };
        const ya = suyos.get(f.cuerpo_id);
        if (ya) { ya.en = f.estado; ya.desde = f.fecha_ingreso; ya.salida = salida; continue; }
        suyos.set(f.cuerpo_id, {
          id: f.cuerpo_id, nombre: f.nombre, tipo: f.tipo, estado: f.estado_cuerpo,
          lidera: false, en: f.estado, desde: f.fecha_ingreso, salida,
        });
      }
      res.json({ cuerpos: [...suyos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)) });
    });

    /**
     * De qué menores responde esta persona.
     *
     * Es la vuelta del vínculo: la ficha del niño dice quién responde por él,
     * y la de la madre tiene que decir por quiénes responde ella. Sin esto el
     * vínculo se ve desde un solo lado y no sirve para lo que se quería —«el
     * grupo familiar de los González», «a quién le aviso si pasa algo en la
     * actividad de los chicos»—.
     *
     * Se pregunta al abrir cualquier ficha, así que se midió: 0,05 ms con 600
     * fichas y 0,87 ms con 10.000. SQLite prefiere recorrer la tabla antes que
     * usar el índice, y a esos números da igual: no hay nada que optimizar acá.
     */
    router.get('/miembros/:id(\\d+)/a-cargo', requirePerm('miembros', 'view'), (req, res) => {
      // La ficha tiene que ser de las suyas, como en cualquier otra consulta
      if (!require('../alcance').registroSuyo(req, res, 'miembros', req.params.id, 'Esa ficha')) return;
      const menores = db
        .prepare(
          `SELECT id, nombres, apellidos, fecha_nacimiento, responsable_parentesco, estado
             FROM miembros WHERE responsable_id = ? ORDER BY fecha_nacimiento DESC, apellidos, nombres`
        )
        .all(Number(req.params.id));
      res.json({
        menores: menores.map((m) => ({
          ...m,
          edad: edadEnAnios(m.fecha_nacimiento),
          // Se dice cuando ya cumplió 18: el vínculo se queda escrito —es
          // parte de su historia— pero deja de ser una responsabilidad vigente
          ya_es_mayor: edadEnAnios(m.fecha_nacimiento) >= 18,
        })),
      });
    });

    /** Cómo está el acceso al sistema de este miembro. */
    router.get('/miembros/:id(\\d+)/usuario', requirePerm('miembros', 'view'), (req, res) => {
      // Entrega el nombre, el RUT y el rol de la cuenta enlazada: la ficha
      // tiene que ser de las suyas, como en cualquier otra consulta.
      const miembro = require('../alcance').registroSuyo(req, res, 'miembros', req.params.id, 'Esa ficha');
      if (!miembro) return;
      const usuario = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(miembro.id)
        || (miembro.rut ? db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(miembro.rut) : null);
      res.json({
        puede_designar: require('../permissions').can(req.user, 'usuarios', 'create'),
        tiene_rut: !!miembro.rut,
        usuario: usuario
          ? { id: usuario.id, nombre: usuario.nombre, rut: usuario.rut, rol: usuario.rol, activo: !!usuario.activo, enlazado: !!usuario.miembro_id }
          : null,
      });
    });

    /**
     * Designa a este miembro como usuario del sistema: crea su cuenta con sus
     * mismos datos y la contraseña inicial, que tendrá que cambiar al entrar.
     * Si ya existe una cuenta con su RUT, solo se enlaza.
     */
    router.post('/miembros/:id(\\d+)/usuario', requirePerm('usuarios', 'create'), async (req, res, next) => {
      const bcryptjs = require('bcryptjs');
      const miembro = db.prepare('SELECT * FROM miembros WHERE id = ?').get(req.params.id);
      if (!miembro) return res.status(404).json({ error: 'Miembro no encontrado' });
      if (!require('../alcance').alcanza(module.exports, miembro, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      if (!miembro.rut) {
        return res.status(400).json({ error: 'Para entrar al sistema se necesita el RUT: complételo en su ficha.' });
      }

      const yaEnlazado = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(miembro.id);
      if (yaEnlazado) return res.json({ ok: true, usuario_id: yaEnlazado.id, creado: false });

      const conSuRut = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(miembro.rut);
      if (conSuRut) {
        db.prepare('UPDATE usuarios SET miembro_id = ? WHERE id = ?').run(miembro.id, conSuRut.id);
        return res.json({ ok: true, usuario_id: conSuRut.id, creado: false, enlazado: true });
      }

      // Se le entrega la contraseña inicial del sistema, la misma para todos:
      // al entrar con ella, el sistema le obliga a cambiarla por una suya.
      const inicial = require('../claves').inicial();
      /**
       * Se cifra ANTES de escribir, y esperando de verdad.
       *
       * Cifrar cuesta cerca de una décima de segundo a propósito, y el
       * servidor atiende de a una cosa: hecho de corrido, ese rato lo pagan
       * todos los que estén usando el sistema, no solo quien está designando
       * al miembro.
       */
      let info;
      try {
        const cifrada = await require('../cifrado').cifrar(inicial);
        info = db
          .prepare(
            `INSERT INTO usuarios (rut, nombre, password, password_origen, debe_cambiar_password,
                                   rol, iglesia_id, email, telefono, activo, miembro_id, created_by)
             VALUES (?, ?, ?, 'inicial', 1, 'consulta', ?, ?, ?, 1, ?, ?)`
          )
          .run(
            miembro.rut,
            `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim(),
            cifrada,
            miembro.iglesia_id || null,
            miembro.email || null,
            miembro.telefono || null,
            miembro.id,
            req.user.id
          );
      } catch (e) {
        /**
         * Dos clics seguidos, o dos personas designando al mismo miembro.
         *
         * Entre la comprobación de más arriba y este INSERT hay ahora una
         * espera de verdad —los ochenta milisegundos que cuesta cifrar—, y en
         * ese rato cabe otra petición idéntica. La primera crea la cuenta; la
         * segunda choca contra el RUT, que es único.
         *
         * No es un error que haya que mostrar: lo que esa persona quería —que
         * el miembro tenga cuenta— ya está hecho. Se busca la que quedó y se
         * contesta como si se hubiera encontrado enlazada, que es lo que la
         * pantalla espera.
         *
         * Y si el fallo es otro, va al manejador de errores. Antes no iba a
         * ninguna parte: la petición se quedaba colgada sin respuesta hasta
         * que el navegador se cansaba. Comprobado: de tres clics a la vez, dos
         * no recibían nada nunca.
         */
        const laQueGano = db.prepare('SELECT id FROM usuarios WHERE rut = ?').get(miembro.rut);
        if (!laQueGano) return next(e);
        db.prepare('UPDATE usuarios SET miembro_id = ? WHERE id = ? AND miembro_id IS NULL')
          .run(miembro.id, laQueGano.id);
        return res.json({ ok: true, usuario_id: laQueGano.id, creado: false, enlazado: true });
      }

      res.status(201).json({ ok: true, usuario_id: info.lastInsertRowid, creado: true, password: inicial, rut: miembro.rut });
    });
  },

  hooks: {
    beforeSave(data, { id, existing, db, confirmado }) {
      const rutDe = (d, e) => (d.rut !== undefined ? d.rut : e ? e.rut : null);

      /*
       * ¿No será la misma persona que ya está? Ver arriba, en
       * `avisoDeFichaRepetida`, por qué se compara así y por qué pregunta en
       * vez de bloquear.
       *
       * Al editar solo se mira si ESTE guardado cambia el nombre o la iglesia:
       * revisarlo siempre trancaría a quien viene a corregir un teléfono.
       */
      if (!confirmado) {
        const antesDeGuardar = existing || {};
        const cambiaElNombre = ['nombres', 'apellidos', 'iglesia_id']
          .some((campo) => data[campo] !== undefined
            && comoSeCompara(data[campo]) !== comoSeCompara(antesDeGuardar[campo]));
        if (!id || cambiaElNombre) {
          const repetida = avisoDeFichaRepetida(db, { ...antesDeGuardar, ...data }, id);
          if (repetida) return repetida;
        }
      }
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && id && Number(conyuge) === Number(id)) {
        return 'Un miembro no puede figurar como su propio cónyuge';
      }

      /**
       * El cónyuge de quien está en Pastores / Guías es del sexo opuesto; y si
       * el cargo es pastoral, nunca queda con trato de Hermano, Hermana ni
       * Oficial: es Pastor o Pastora. Al guía de obra no se le aplica esto
       * último, porque su cónyuge sigue siendo hermano o hermana.
       *
       * Estas dos comprobaciones miran a DOS fichas y a lo que diga Pastores /
       * Guías, y eso puede cambiar sin que esta ficha se toque: se registra al
       * marido en Pastores un mes después de haber vinculado el matrimonio, y
       * desde ese momento la ficha de la señora queda en falta.
       *
       * Antes se exigían en todo guardado, y el resultado era que esa ficha no
       * se dejaba guardar más: ni para corregirle el teléfono, ni la dirección,
       * ni nada. Se topó tres veces probando, así que en el uso real aparece.
       * Y castigaba a quien venía a arreglar otra cosa por algo que no hizo y
       * que a lo mejor ni sabía.
       *
       * Ahora se exigen cuando este guardado es el que está armando o
       * cambiando el vínculo —o el sexo, del que dependen—. Si el vínculo ya
       * venía así, no se bloquea: se avisa arriba de la ficha, que es donde se
       * puede hacer algo al respecto.
       */
      const { estaEnPastores, esPastorRegistrado } = require('../tratamiento');
      const antes = existing || {};
      const cambiaElVinculo = data.conyuge_id !== undefined
        && Number(data.conyuge_id || 0) !== Number(antes.conyuge_id || 0);
      const cambiaElSexo = data.genero !== undefined && data.genero !== antes.genero;
      const revisarLaPareja = !id || cambiaElVinculo || cambiaElSexo;

      if (conyuge && revisarLaPareja) {
        const otro = db.prepare('SELECT id, nombres, apellidos, genero, rut FROM miembros WHERE id = ?').get(conyuge);
        if (!otro) return 'La persona indicada como cónyuge no existe';
        const yo = { id, rut: rutDe(data, existing), genero: data.genero !== undefined ? data.genero : existing ? existing.genero : null };
        const alguienEstaEnPastores = estaEnPastores(otro, db) || (id && estaEnPastores(yo, db));
        if (alguienEstaEnPastores) {
          if (!otro.genero || !yo.genero) {
            return 'Para vincular el matrimonio de alguien registrado en Pastores / Guías, las dos fichas necesitan tener su género registrado.';
          }
          if (otro.genero === yo.genero) {
            return `El cónyuge tiene que ser del sexo opuesto: ${otro.nombres} ${otro.apellidos} figura como ${otro.genero.toLowerCase()}.`;
          }
        }
        // Los dos tienen que tener trato de pastor o pastora por su propio
        // registro: el pastor se casa con la pastora, no con una hermana.
        if (esPastorRegistrado(otro, db) || (id && esPastorRegistrado(yo, db))) {
          const { esPastorPorSiMismo } = require('../tratamiento');
          /**
           * Cómo va a quedar esta ficha después de guardar, no cómo está.
           *
           * Antes se leía de la base por el id, y eso fallaba por los dos
           * lados: al CREAR una ficha ya vinculada no había id que leer, así
           * que la comprobación se saltaba entera y la pareja a medias entraba
           * igual; y al editar se leía el trato viejo, así que fijarle el trato
           * de Pastora en el mismo guardado que arma el vínculo no servía de
           * nada —justo lo que el propio aviso le dice a uno que haga—.
           */
          const completo = { ...(existing || {}), ...data, id };
          for (const quien of [completo, otro]) {
            if (!quien || esPastorPorSiMismo(quien, db)) continue;
            const trato = quien.genero === 'Femenino' ? 'Pastora' : 'Pastor';
            return `${quien.nombres} ${quien.apellidos} todavía no tiene trato de ${trato}. ` +
              `Regístrele su ficha en Pastores / Guías, o fíjele el trato de ${trato} en su ficha, y vuelva a intentarlo.`;
          }
        }
      }

      /**
       * El adulto responsable, cuando se elige de la membresía.
       *
       * Tres cosas que no pueden pasar y una que sí: nadie responde por sí
       * mismo; la ficha elegida tiene que existir; y tiene que ser de la misma
       * iglesia, porque a quien no se alcanza no se le puede ni mirar el
       * teléfono el día que hay que llamarlo.
       *
       * Que el adulto sea mayor de edad NO se exige: un hermano de diecisiete
       * que trae a la menor a las actividades es la persona a la que hay que
       * llamar, y negarse a anotarlo no la protege de nada. Se anota y listo.
       */
      const responsable = data.responsable_id !== undefined
        ? data.responsable_id
        : existing ? existing.responsable_id : null;
      if (responsable) {
        if (id && Number(responsable) === Number(id)) {
          return 'Un miembro no puede figurar como su propio adulto responsable.';
        }
        const quien = db.prepare('SELECT id, nombres, apellidos, iglesia_id FROM miembros WHERE id = ?').get(responsable);
        if (!quien) return 'La persona indicada como adulto responsable no está en Miembros.';
        const suIglesia = data.iglesia_id !== undefined ? data.iglesia_id : existing ? existing.iglesia_id : null;
        if (suIglesia && quien.iglesia_id && Number(quien.iglesia_id) !== Number(suIglesia)) {
          return `${quien.nombres} ${quien.apellidos} está registrado(a) en otra iglesia. `
            + 'El adulto responsable tiene que ser de la misma.';
        }
        /*
         * Y sus datos NO se copian: se borran de acá. Guardarlos dos veces es
         * garantizar que un día digan cosas distintas —el teléfono cambia en
         * una ficha y no en la otra— y ahí ya no se sabe cuál es el bueno.
         */
        data.responsable_nombre = null;
        data.responsable_rut = null;
        data.responsable_telefono = null;
      }

      /**
       * El tipo de miembro y la edad no pueden decir cosas distintas.
       *
       * Nada revisaba esto: se podía dejar «Miembro Menor de Edad» puesto en
       * alguien de 45 años, y —lo que pasa de verdad— el menor que cumple 18
       * se queda con el tipo de menor para siempre, porque nadie vuelve a
       * abrir su ficha. De ese campo cuelga quién entra a la directiva.
       *
       * Al CREAR, el tipo se pone solo cuando la edad lo decide: un menor nace
       * como «Miembro Menor de Edad» aunque el formulario ofreciera otro.
       *
       * Al EDITAR se PREGUNTA, no se corrige a la fuerza: la iglesia puede
       * tener sus razones, y cambiarle el tipo a alguien por debajo sin
       * avisar es peor que dejarlo contradictorio. Y se pregunta solo cuando
       * ESTE guardado toca el tipo o la fecha: si no, corregir un teléfono
       * volvería a preguntar lo mismo cada vez.
       */
      const nace = data.fecha_nacimiento !== undefined
        ? data.fecha_nacimiento
        : existing ? existing.fecha_nacimiento : null;
      const tipo = data.tipo_miembro !== undefined
        ? data.tipo_miembro
        : existing ? existing.tipo_miembro : null;
      const leToca = tipoQueLeCorresponde(nace);

      if (!id && leToca && tipo !== leToca) {
        data.tipo_miembro = leToca;
      } else if (id && !confirmado && tipo) {
        const tocaElTipo = data.tipo_miembro !== undefined && data.tipo_miembro !== (existing || {}).tipo_miembro;
        const tocaLaFecha = data.fecha_nacimiento !== undefined
          && data.fecha_nacimiento !== (existing || {}).fecha_nacimiento;
        const anios = edadEnAnios(nace);
        if ((tocaElTipo || tocaLaFecha) && anios != null) {
          if (tipo === TIPO_DE_MENOR && anios >= 18) {
            return {
              error: `Tiene ${anios} años y quedaría como "${TIPO_DE_MENOR}". `
                + 'De ese tipo depende quién entra a la directiva de la iglesia. '
                + 'Si de todas maneras corresponde, confirme.',
              confirmar: 'tipo_miembro_no_calza_con_la_edad',
            };
          }
          if (tipo !== TIPO_DE_MENOR && anios < 18) {
            return {
              error: `Todavía no cumple 18 años —tiene ${anios}— y quedaría como "${tipo}". `
                + `A los menores les corresponde "${TIPO_DE_MENOR}". Si de todas maneras corresponde, confirme.`,
              confirmar: 'tipo_miembro_no_calza_con_la_edad',
            };
          }
        }
      }

      /**
       * Cuando alguien se va, dónde queda anotado adónde.
       *
       * La iglesia de destino se ELIGE cuando es una de la organización, y se
       * escribe a mano solo cuando no lo es. Elegida, el texto se borra: lo
       * mismo guardado dos veces termina diciendo cosas distintas.
       *
       * Y se PREGUNTA cuando se marca un traslado sin decir adónde. Es el
       * único momento en que alguien lo sabe: dos semanas después, no lo sabe
       * nadie. No se bloquea —a veces de verdad no se sabe— pero se pregunta
       * una vez, cuando se está marcando.
       */
      const estadoNuevo = data.estado !== undefined ? data.estado : (existing || {}).estado;
      const seVaAhora = data.estado !== undefined && data.estado !== (existing || {}).estado;

      if (estadoNuevo === 'Trasladado') {
        const destinoId = data.iglesia_destino_id !== undefined
          ? data.iglesia_destino_id
          : (existing || {}).iglesia_destino_id;
        const destinoTexto = data.iglesia_destino !== undefined
          ? data.iglesia_destino
          : (existing || {}).iglesia_destino;

        if (destinoId) {
          const suIglesia = data.iglesia_id !== undefined ? data.iglesia_id : (existing || {}).iglesia_id;
          if (suIglesia && Number(destinoId) === Number(suIglesia)) {
            return 'La iglesia que la recibe no puede ser la misma de la que se va.';
          }
          data.iglesia_destino = null;
        } else if (seVaAhora && !String(destinoTexto || '').trim() && !confirmado) {
          return {
            error: 'No quedó anotado a qué iglesia se traslada. Es el único momento en que alguien lo '
              + 'sabe: después hay que reconstruirlo leyendo el historial. Si de verdad no se sabe, confirme.',
            confirmar: 'traslado_sin_destino',
          };
        }
      }

      // A quien el ministerio le impone un trato —Guía de Obra por su cargo,
      // Pastor o Pastora por el suyo o por su cónyuge— no se le puede fijar a
      // mano el de Hermano, Hermana u Oficial.
      const manual = data.tratamiento_personalizado;
      if (manual && ['Hermano', 'Hermana', 'Oficial'].includes(manual) && id) {
        const { tratoMinisterial, CARGO_GUIA } = require('../tratamiento');
        const fila = { ...(existing || {}), ...data, id };
        const impuesto = tratoMinisterial(fila, db);
        if (impuesto) {
          const porque = impuesto === CARGO_GUIA
            ? 'por su cargo en Pastores / Guías'
            : 'por su ficha en Pastores / Guías o por su cónyuge';
          return `A esta persona le corresponde el trato de ${impuesto} —${porque}—, así que no puede quedar como "${manual}".`;
        }
      }

      // Si esta persona tiene además ficha de pastor, su RUT tiene que ser el
      // mismo en las dos: es la misma persona en los dos registros.
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      if (id && rut) {
        const pastor = db.prepare('SELECT nombres, apellidos, rut FROM pastores WHERE miembro_id = ?').get(id);
        if (pastor && pastor.rut && pastor.rut !== rut) {
          return `El RUT no coincide con el de su ficha en Pastores / Guías (${pastor.nombres} ${pastor.apellidos}: ${pastor.rut}). ` +
            'Corrija el que esté equivocado.';
        }
      }
      return null;
    },

    /**
     * El matrimonio se ve desde los dos lados: al vincular a alguien, su
     * cónyuge queda apuntando de vuelta, se sueltan los vínculos anteriores
     * que quedaran colgando y se copian las fechas de matrimonio a quien las
     * tenga en blanco.
     */
    afterSave(fila, { db, user }) {
      sincronizarUsuario(fila, db);

      /**
       * Quien ya no está en la iglesia sale de sus cuerpos.
       *
       * Va antes que la regla de la directiva: las dos pueden querer retirar
       * la misma ficha, y la primera es la que deja escrito el motivo. La
       * regla entera —y qué pasa si el estado se vuelve atrás— está en
       * server/ya-no-esta.js.
       */
      require('../ya-no-esta').alGuardarUnMiembro(db, fila, user);

      /**
       * Los miembros líderes componen la directiva de su iglesia.
       *
       * No es una lista que alguien mantenga: al pasar a esa categoría la
       * persona entra sola al cuerpo de la directiva, y al dejarla sale sola.
       * La regla entera —y por qué— está en server/directiva.js.
       */
      require('../directiva').alGuardarUnMiembro(db, fila, user);

      const conyugeId = fila.conyuge_id || null;

      // Quien estuviera vinculado a esta persona y ya no corresponda, se suelta
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(fila.id, conyugeId || 0);
      if (!conyugeId) return;

      const conyuge = db.prepare('SELECT * FROM miembros WHERE id = ?').get(conyugeId);
      if (!conyuge) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(fila.id);
        return;
      }

      // Si la otra persona venía vinculada a alguien más, ese vínculo se suelta
      if (conyuge.conyuge_id && Number(conyuge.conyuge_id) !== Number(fila.id)) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(conyuge.conyuge_id);
      }

      const campos = ['conyuge_id = ?'];
      const valores = [fila.id];
      for (const f of ['fecha_matrimonio_civil', 'fecha_matrimonio_religioso']) {
        if (fila[f] && !conyuge[f]) {
          campos.push(`"${f}" = ?`);
          valores.push(fila[f]);
        }
      }
      db.prepare(`UPDATE miembros SET ${campos.join(', ')} WHERE id = ?`).run(...valores, conyuge.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);

      /*
       * Los menores a su cargo no se quedan apuntando a una ficha que ya no
       * está, pero tampoco se quedan sin adulto responsable: su nombre y su
       * RUT vuelven a escribirse a mano, que es de donde salieron. Soltar el
       * vínculo a secas dejaría a un menor sin nadie anotado, y eso es
       * justamente lo que la iglesia tiene que poder responder.
       */
      const nombre = `${fila.nombres || ''} ${fila.apellidos || ''}`.trim();
      db.prepare(
        `UPDATE miembros
            SET responsable_id = NULL,
                responsable_nombre = COALESCE(NULLIF(TRIM(COALESCE(responsable_nombre,'')), ''), ?),
                responsable_rut = COALESCE(responsable_rut, ?),
                responsable_telefono = COALESCE(responsable_telefono, ?)
          WHERE responsable_id = ?`
      ).run(nombre || null, fila.rut || null, fila.telefono || null, fila.id);
      return null;
    },
  },
};

/**
 * Las categorías, aparte de la definición del módulo: las usa el ajuste que
 * decide cuál de ellas compone la directiva (ver server/ajustes.js). Teniendo
 * una sola lista, agregar una categoría la deja ofrecida también ahí.
 */
module.exports.TIPOS_DE_MIEMBRO = TIPOS_DE_MIEMBRO;
module.exports.TIPO_DE_MENOR = TIPO_DE_MENOR;
module.exports.tipoQueLeCorresponde = tipoQueLeCorresponde;
