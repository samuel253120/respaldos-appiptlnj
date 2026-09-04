/**
 * Módulo: Toma de Asistencia (la marca de cada persona en una actividad).
 *
 * Este módulo manda sobre **quién puede pasar lista**: con permiso para crear
 * y editar aquí, una persona puede tomar la asistencia de una actividad
 * aunque no tenga permiso para crear actividades (eso se rige por el módulo
 * Asistencias).
 *
 * Por cada actividad de un cuerpo queda una fila por integrante, con su
 * estado —Presente, Ausente o Justificado— y, cuando está justificado, el
 * motivo. Los motivos de emergencia, de otra actividad de la iglesia y de
 * "otro motivo" piden además el detalle, para que la justificación diga algo.
 *
 * No se llena aquí una por una, sino marcando la lista en la pantalla de
 * Asistencia, así que este módulo no ocupa lugar en el menú: existe para
 * guardar las marcas y para llevar el permiso de tomarlas.
 */
/**
 * Los motivos que piden explicación.
 *
 * Ya no es una lista escrita acá: cada motivo lo dice en su propia ficha
 * (módulo «Motivos de Ausencia»), así que al agregar «Viaje» la iglesia decide
 * si hay que explicarlo o no, sin tocar el programa. La lista de abajo queda
 * como respaldo para el primer arranque, antes de que la tabla exista.
 */
const CON_DETALLE_DE_FABRICA = ['Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];

/** De qué registro sale la persona: miembro inscrito o no. */
const { REGISTROS } = require('../integrantes');

/** Dónde vive la lista de motivos, dicho una sola vez. */
const LA_LISTA_DE_MOTIVOS = { modulo: 'motivos_ausencia', columna: 'nombre', label: 'Motivos de Ausencia' };

/**
 * ── LOS TRES ESTADOS DE UNA MARCA, DICHOS UNA SOLA VEZ ──
 *
 * Estaban escritos en cinco sitios: acá como opciones del campo, en la toma de
 * lista como lista de válidos, en la pantalla como los tres botones, y dos
 * veces más en la hoja mensual —el peso con que se resuelve un día de dos
 * actividades y la letra S/J/N—. Coincidían, que es lo que pasa hasta que
 * alguien toca uno: el día que la iglesia quiera un cuarto estado —«Atrasado»
 * es el que siempre aparece— el formulario lo aceptaría y la toma de lista lo
 * rechazaría, que es la manera más incómoda de descubrirlo.
 *
 * El dueño de lo que significa un estado es este módulo, así que se declaran
 * acá y los demás preguntan.
 */
const ESTADOS = ['Presente', 'Ausente', 'Justificado'];

/**
 * Cuál gana cuando hay dos marcas el mismo día, de mejor a peor.
 *
 * UN DÍA, UNA COLUMNA en la hoja mensual: si el cuerpo tuvo el ensayo en la
 * mañana y el culto en la tarde, la columna dice lo mejor de las dos. Es otro
 * orden que el de arriba —ahí manda cómo se ofrecen en pantalla, acá cuál pesa
 * más— y por eso son dos listas y no una ordenada de cualquier modo.
 */
const DE_MEJOR_A_PEOR = ['Presente', 'Justificado', 'Ausente'];

/**
 * Con qué letra se escribe cada estado en la planilla de siempre.
 *
 * S estuvo, J justificó, N faltó. Es la hoja que la iglesia llevaba a mano y
 * esas son sus letras; van acá porque son otra forma de nombrar el estado, no
 * una decisión de la hoja.
 */
const LETRA_DE = { Presente: 'S', Justificado: 'J', Ausente: 'N' };

/**
 * ¿ESTE motivo pide explicación? Se le pregunta a su FILA, no a una lista de
 * nombres.
 *
 * La comprobación de obligatorios del motor decide si el detalle hace falta
 * mirando `showIf`, que compara el motivo contra una lista de NOMBRES exactos.
 * Y esa comprobación corre ANTES de que el motivo quede escrito como está en la
 * lista, así que bastaba con escribirlo distinto para que no calzara con
 * ninguno y el detalle dejara de exigirse.
 *
 * MEDIDO en la v1.363.0, con el motivo ya comprobado contra la tabla:
 *
 *   «Otro motivo» sin explicación ............ 400 · lo exige
 *   «otro motivo» sin explicación ............ 201 · GUARDADA, detalle en blanco
 *   «OTRO MOTIVO» sin explicación ............ 201 · GUARDADA, detalle en blanco
 *
 * Las tres quedaban con el mismo motivo escrito —el de la lista— y solo la
 * primera con explicación. Preguntándole a la fila, la caja de las letras deja
 * de decidir nada: es la casilla «Pide explicación» de esa fila la que manda.
 */
function pideExplicacion(db, motivo) {
  const fila = require('../opciones').laFilaDeLaLista(db, LA_LISTA_DE_MOTIVOS, motivo);
  if (!fila) return false;
  const suya = db
    .prepare('SELECT pide_detalle FROM motivos_ausencia WHERE nombre = ? LIMIT 1')
    .get(fila.valor);
  return !!(suya && suya.pide_detalle);
}

function motivosQuePidenDetalle() {
  try {
    const { db } = require('../db');
    const filas = db.prepare('SELECT nombre FROM motivos_ausencia WHERE pide_detalle = 1').all();
    // Sin ninguno marcado no se cae de vuelta a la lista vieja: que la iglesia
    // no quiera exigir explicación en ningún motivo es una decisión legítima.
    if (filas) return filas.map((f) => f.nombre);
  } catch (e) {
    /* sin tabla todavía */
  }
  return CON_DETALLE_DE_FABRICA.slice();
}

module.exports = {
  name: 'asistencia_detalle',
  label: 'Toma de Asistencia',
  labelSingular: 'Marca de asistencia',
  icon: '✔️',
  group: 'Reuniones',
  order: 12,
  menu: false,
  display: '{estado}',
  searchFields: ['detalle'],
  listFields: ['asistencia_id', 'persona_tipo', 'miembro_id', 'no_miembro_id', 'estado', 'motivo', 'detalle'],
  filterFields: ['estado', 'motivo', 'cuerpo_id', 'persona_tipo'],
  /*
   * La fecha del módulo. No es una etiqueta: es lo que hace que la base cree
   * su índice sola (ver indexar() en server/db.js).
   *
   * Esta es la tabla que más crece de todo el sistema —una fila por persona y
   * por actividad—, y es sobre la que se arma el informe de asistencia, que
   * pregunta siete veces por un rango de fechas. Sin declararla, no había
   * índice por fecha y acotar el informe no servía de nada: medido con diez
   * años de datos, pedir solo el año en curso costaba 59 ms igual que pedirlo
   * todo, porque la base recorría las 124.812 marcas de todas maneras. Con el
   * índice puesto, ese mismo informe baja a 0,1 ms.
   */
  dateField: 'fecha',
  defaultSort: { field: 'id', dir: 'desc' },

  /*
   * ── LA MARCA SE ESCRIBE PASANDO LISTA, NO A MANO ──
   *
   * La primera línea de este archivo lo dice desde siempre: «no se llena aquí
   * una por una, sino marcando la lista en la pantalla de Asistencia». Lo que
   * no estaba dicho en ninguna parte que el programa mirara es que ESA es la
   * única puerta. El módulo no tiene entrada en el menú, pero viaja entero en
   * la descripción del sistema, así que la pantalla genérica lo atendía como a
   * los otros cuarenta —listado, ficha, formulario, y los botones de crear,
   * editar y borrar dibujados—, y la importación por planilla también.
   *
   * Y esa segunda puerta no hacía ninguna de las cinco cosas que hace la toma
   * de lista. MEDIDO en la v1.380.0, sobre la base cargada:
   *
   *   · corregirle el estado a una marca la MUDABA DE IGLESIA —el gancho la
   *     sellaba con la de la actividad, deshaciendo la v1.375.0—: la encargada
   *     de la otra congregación pasó de ver «1 presente · 1 actividad» a
   *     «0 · 0», y de 200 a 403 al abrir la marca de su propia integrante;
   *   · toda marca creada por la ficha nacía SIN CUERPO, se mandara el que se
   *     mandara —el campo es de solo lectura, así que se descartaba, y el
   *     respaldo del gancho apuntaba a `actividad.cuerpo_id`, una columna que
   *     dejó de existir cuando una actividad pasó a convocar a varios—, y una
   *     marca sin cuerpo no aparece en ninguna vista por cuerpo (v1.379.0);
   *   · no se comprobaba que la persona estuviera convocada: ocho personas de
   *     otro cuerpo llevaron una reunión de 28/56 (50 %) a 36/64 (56 %), y el
   *     cuerpo, que tiene 56 integrantes, pasó a decir que convocó a 64. Por la
   *     toma de lista, las mismas ocho dan 403;
   *   · no quedaba constancia: la misma corrección deja una línea en el
   *     Registro de Cambios por la toma de lista —«Corrigió 1 marca(s)…»— y
   *     CERO por la ficha. Borrar una marca a mano tampoco dejaba nada.
   *
   * Se cierra la puerta en vez de repetir en ella las cinco comprobaciones,
   * por dos razones. La primera es la de siempre: dos maneras de comprobar
   * habrían sido dos verdades, y la que vale es la de la ruta que pasa lista.
   * La segunda es que esa ficha nunca fue una puerta estable —guardar una
   * lista BORRA y vuelve a insertar la marca de cada persona, que es lo que
   * permite que dos personas marquen a la vez, así que cada marca estrena
   * número: medido, la marca 30001 pasó a ser la 30005 al volver a guardar la
   * misma lista, y el enlace a su ficha contestó 404—.
   *
   * LEER no se toca: el listado, la ficha, los filtros y la planilla siguen
   * igual, con el mismo alcance de siempre. Lo que se cierra es escribir.
   *
   * Y esto NO toca el permiso de tomar asistencia. Ese permiso vive en este
   * módulo —«crear» y «editar» aquí es lo que deja pasar lista— y lo pregunta
   * la propia ruta de la lista con `can()`, que mira los permisos de la
   * persona, no lo que el módulo admite por su puerta genérica.
   */
  soloLectura: {
    alGuardar: 'Las marcas de asistencia se escriben pasando lista en la pantalla de Asistencia, '
      + 'no una por una: ahí se comprueba que la persona esté convocada, se le pone su cuerpo y su '
      + 'iglesia, y queda constancia de quién la marcó.',
    alBorrar: 'Una marca no se borra suelta: corrija la lista de esa actividad en la pantalla de '
      + 'Asistencia, que deja escrito qué cambió y quién lo cambió.',
  },
  fields: [
    { name: 'asistencia_id', label: 'Actividad', type: 'ref', ref: 'asistencias', required: true },
    /*
     * De qué registro sale la persona de esta marca.
     *
     * En los grupos también sirve gente que no está inscrita en la membresía
     * —ver server/integrantes.js—, y a esa gente hay que poder marcarla
     * presente o ausente igual que a los demás, o la lista del grupo queda
     * incompleta. Cada marca apunta a uno de los dos registros, nunca a los
     * dos: el número solo no alcanza, porque el miembro n.º 7 y el no miembro
     * n.º 7 son dos personas distintas.
     */
    {
      name: 'persona_tipo', label: 'Registro de la persona', type: 'select',
      required: true, default: 'Miembro', options: REGISTROS,
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true,
      showIf: { field: 'persona_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'Persona no inscrita', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'persona_tipo', equals: 'No miembro' },
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: ESTADOS[0],
      options: ESTADOS,
    },
    {
      name: 'motivo', label: 'Motivo de la justificación', type: 'select',
      // Los mantiene la iglesia (módulo «Motivos de Ausencia»).
      optionsRoute: '/motivos_ausencia/opciones',
      /*
       * Y la lista se comprueba al guardar, no solo se ofrece (v1.363.0). El
       * desplegable acotaba lo que se ve en el navegador y nada más: por la API
       * entraba cualquier texto —medido: «Motivo Que No Existe», 201—, entraba
       * uno desactivado, y «enfermedad» en minúscula quedaba como se escribió,
       * partiendo en dos el informe de asistencia por motivo. Declarando de qué
       * tabla sale la lista, el motor la comprueba contra ella y de paso deja
       * el nombre escrito como está en la lista.
       */
      opcionesDe: { modulo: 'motivos_ausencia', columna: 'nombre', label: 'Motivos de Ausencia' },
      showIf: { field: 'estado', equals: 'Justificado' },
      required: true,
    },
    {
      name: 'detalle', label: 'Detalle del motivo', type: 'text',
      // Cuáles piden explicación lo dice cada motivo en su ficha, no una lista
      // escrita acá: al agregar «Viaje» la iglesia decide si hay que explicarlo.
      // Se lee al armar la pantalla, no al arrancar: así, marcar un motivo como
      // «pide explicación» vale en cuanto se guarda.
      get showIf() { return { field: 'motivo', in: motivosQuePidenDetalle() }; },
      required: true,
      /*
       * Y VA BAJO LLAVE, porque es donde aterriza un motivo de salud.
       *
       * Es texto libre y obligatorio: cuando el motivo es «Emergencia» o «Otro
       * motivo», el sistema exige escribir por qué alguien no fue. La ficha de
       * un miembro tiene sus campos médicos detrás de la llave de salud; esto
       * no tenía ninguna. Medido en la v1.382.0: una secretaria a la que la
       * ficha de esa misma persona le llega SIN enfermedades ni alergias leía
       * entera la explicación, daba con ella buscando una palabra suya y la
       * bajaba en la planilla.
       *
       * La llave es propia y no la de salud (ver `asistencia_explicacion` en
       * server/permissions.js): lo que se escribe acá a veces es una
       * enfermedad y a veces un viaje, y quien responde por la asistencia no
       * es necesariamente quien responde por la ficha médica.
       *
       * La pantalla de pasar lista NO pasa por este recorte, a propósito: ahí
       * la explicación se escribe y se corrige, y quien pasa la lista de su
       * cuerpo tiene delante a esas personas igual. Lo que se cierra es
       * recorrer, buscar y bajar en planilla las treinta mil del sistema.
       */
      reservado: 'asistencia_explicacion',
      help: 'Obligatorio en los motivos que estén marcados como que piden explicación. '
        + 'Escriba lo justo: esto queda guardado y lo lee quien tenga la llave «Explicación de una '
        + 'justificación». Si el motivo es de salud, basta con decirlo así.',
    },
    // Se copian de la actividad, para poder filtrar e informar sin cruzar tablas
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true },
    { name: 'fecha', label: 'Fecha', type: 'date', readonly: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true },

    /*
     * CUÁNDO SE MARCÓ ESTO POR PRIMERA VEZ, Y QUIÉN LO MARCÓ.
     *
     * Guardar una lista BORRA y vuelve a insertar la marca de cada persona.
     * Es lo correcto para que dos personas puedan marcar a la vez —cada una
     * manda solo lo suyo y nadie borra en blanco lo del otro—, pero tenía un
     * costo que no se veía: `created_at` y `created_by` pasaban a ser los de
     * la última corrección, así que del día en que se tomó la lista no
     * quedaba nada. Comprobado: corregir una marca tres meses después dejaba
     * las cuatro marcas con fechas distintas y ninguna era la del día.
     *
     * Estos dos se ARRASTRAN al reinsertar: la marca se vuelve a escribir,
     * pero se queda con la fecha y el nombre de la primera vez. Entre los dos
     * pares se lee la historia completa de cada marca: `tomada_en` cuándo se
     * marcó, `updated_at` cuándo se corrigió por última vez.
     *
     * Van ocultos porque no se llenan a mano: los pone la toma de lista.
     */
    { name: 'tomada_en', label: 'Marcada el', type: 'text', readonly: true, oculto: true },
    { name: 'tomada_por', label: 'Marcada por', type: 'ref', ref: 'usuarios', readonly: true, oculto: true },

    /*
     * ESTUVO, PERO NO ES DEL CUERPO.
     *
     * La lista sale de los integrantes de los cuerpos convocados, y quien
     * llegó sin pertenecer a ninguno —una visita, alguien de otro cuerpo que
     * pasó, un familiar— no se podía anotar: el servidor contestaba «no está
     * en ninguno de los cuerpos convocados a esta actividad».
     *
     * Esa regla está bien: es la que impide ensuciar el porcentaje con gente
     * que no corresponde. Lo que faltaba era la otra mitad. Una marca de
     * visita deja constancia de que estuvo —que es lo que se quiere saber de
     * una visita— y queda FUERA de todos los porcentajes: del avance de la
     * lista, del informe y de la planilla del cuerpo. Así no le altera el
     * cumplimiento a nadie.
     *
     * Se guarda con el cuerpo a cuya lista se la sumó, no en blanco: es «la
     * lista de Damas del 12 de marzo, con tres visitas», y es lo que hace que
     * la encargada de Damas la vea y la pueda corregir.
     */
    { name: 'visita', label: 'Visita', type: 'boolean', readonly: true, default: 0 },
  ],

  /*
   * SIN GANCHO DE GUARDADO, y a propósito.
   *
   * Tenía uno de sesenta renglones —normalizaba el registro de la persona,
   * impedía dos marcas de la misma persona en el mismo cuerpo, exigía la
   * explicación del motivo que la pide, y sellaba el cuerpo, la fecha y la
   * iglesia—. Con la puerta cerrada (ver `soloLectura`, arriba) no lo llamaba
   * nadie: la toma de lista escribe derecho en la base, sin pasar por el
   * guardado del módulo, y la importación por planilla se rechaza antes de
   * mirar las filas.
   *
   * Un gancho que no se alcanza es peor que ninguno: parece que protege. Las
   * cuatro reglas que hacía valer viven donde de verdad se aplican, en
   * `POST /asistencias/:id/lista` (server/modules/asistencias.js):
   *
   *   · el registro de la persona y su cuerpo los resuelve `integrantesConvocados`;
   *   · una sola marca por par persona-cuerpo la garantiza el borrar-e-insertar
   *     por ese mismo par;
   *   · el motivo se comprueba contra su lista y la explicación se le pide a la
   *     FILA del motivo, con la misma `pideExplicacion` que exporta este archivo;
   *   · la fecha sale de la actividad y la iglesia sale del CUERPO de la marca
   *     (`laIglesiaDe`), que es lo que el gancho hacía mal.
   */
};

// Se conserva el nombre de siempre para quien lo consulta de afuera (la
// migración que siembra la lista lo usa para saber cuáles piden explicación).
module.exports.MOTIVOS_CON_DETALLE = CON_DETALLE_DE_FABRICA;
module.exports.motivosQuePidenDetalle = motivosQuePidenDetalle;
module.exports.pideExplicacion = pideExplicacion;
module.exports.LA_LISTA_DE_MOTIVOS = LA_LISTA_DE_MOTIVOS;
/*
 * Y los tres estados, para que no vuelvan a estar escritos en cinco sitios: los
 * piden la toma de lista (server/modules/asistencias.js), la hoja mensual
 * (server/planilla-asistencia.js) y la pantalla, que los saca de las opciones
 * declaradas arriba, que son estas mismas.
 */
module.exports.ESTADOS = ESTADOS;
module.exports.DE_MEJOR_A_PEOR = DE_MEJOR_A_PEOR;
module.exports.LETRA_DE = LETRA_DE;
