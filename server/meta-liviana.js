/**
 * La descripción del sistema, sin lo que no dice nada.
 *
 * Al entrar, la pantalla pide /api/meta: la lista de módulos con todos sus
 * campos, que es de donde se arma sola toda la interfaz. Pesaba 251 KB, y más
 * de la mitad —144 KB— eran propiedades cuyo valor era «no»:
 *
 *     423 veces  optionsRoute: null
 *     434 veces  sugerencias: null
 *     420 veces  mostrarEdad: false
 *     437 veces  calcula: null
 *
 * La pantalla las lee todas como «no», y un campo que directamente NO VIENE se
 * lee exactamente igual de «no». O sea que viajaban ciento cuarenta kilos para
 * no decir nada, y encima había que leerlos: el navegador de un teléfono se
 * demora en eso más que el servidor en armarlo.
 *
 * Así que se van. Con dos cuidados:
 *
 *   · **El cero y el texto se quedan.** `min: 0` es un límite de verdad —«no
 *     puede ser negativo»— y no una ausencia. Solo se van el nulo, el vacío y
 *     el no definido.
 *
 *   · **El «no» que sí dice algo se queda.** `buscador: false` significa «este
 *     campo NO lleva buscador aunque tenga muchas opciones», que es distinto de
 *     no venir, que significa «decida usted según cuántas opciones haya». La
 *     pantalla los distingue (`f.buscador === false`, en public/app.js), así
 *     que ese se manda tal cual.
 *
 * Si algún día otra propiedad necesita ese mismo trato, se agrega a la lista de
 * abajo y ya: el resto sigue funcionando igual.
 */

/**
 * Propiedades donde el «no» es una decisión y no una ausencia.
 *
 * `enElPapel: false` es el otro caso: significa «este campo NO va en la hoja
 * impresa», que es distinto de no venir —que significa «va, como todos»—.
 */
const EL_NO_DICE_ALGO = new Set(['buscador', 'enElPapel']);

/** Un campo tal como sale al navegador: sin lo que no aporta. */
function sinLoQueNoDiceNada(campo) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(campo)) {
    // Nulo, vacío o sin definir: es lo mismo que no venir
    if (valor === null || valor === '' || valor === undefined) continue;
    // El falso, en cambio, se va salvo donde signifique algo por sí mismo
    if (valor === false && !EL_NO_DICE_ALGO.has(clave)) continue;
    limpio[clave] = valor;
  }
  return limpio;
}

/**
 * LO QUE UN CAMPO LE CUENTA A LA PANTALLA, Y LO QUE SE QUEDA EN EL SERVIDOR.
 *
 * Un módulo declara sus campos con muchas propiedades, y son de dos clases
 * distintas: las que la pantalla necesita para dibujar el formulario, y las
 * que son REGLAS DEL GUARDADO y no le incumben a nadie más —que un RUT sea
 * único, que una fecha no vaya antes de otra, que un campo solo se escriba al
 * crear—. Las primeras viajan; las segundas se quedan acá.
 *
 * Estaban escritas en un solo lugar, sueltas en el destructuring de la ruta
 * /api/meta, y no había forma de notar que a una le faltaba el pasaje. Es lo
 * que pasó con `porDefecto`: el módulo de Formatos de Certificado declaraba el
 * color de fábrica de sus tres campos de color, la pantalla estaba escrita
 * para usarlo, y en el medio no viajaba. Los tres cuadritos se abrían en el
 * mismo azul, así que el marco de un certificado —que se imprime ORO— se veía
 * azul en su propia ficha; y como el cuadrito es un control y no un cartel,
 * tocarlo dejaba el marco azul de verdad. Medido en la v1.309.0 (FC-02).
 *
 * Ahora las dos clases están declaradas, y una prueba comprueba que toda
 * propiedad que algún campo del sistema declare esté en una de las dos listas.
 * Agregar una tercera clase sin decidir a cuál pertenece se pone rojo.
 */
const LO_QUE_VIAJA = [
  'name', 'label', 'type', 'required', 'options', 'sugerencias', 'ref', 'help',
  'default', 'porDefecto', 'accept', 'showIf', 'bloqueadoSi', 'optionsRoute',
  'readonly', 'soloAlCrear', 'calcula', 'mostrarEdad', 'mostrarDia', 'seccion', 'destacado', 'buscador',
  'ancho', 'recorte', 'recorta', 'min', 'max', 'entero', 'sensible',
  'reservado', 'futuro', 'placeholder', 'enElPapel',
];

/**
 * Reglas del guardado. No viajan porque la pantalla no hace nada con ellas: el
 * servidor es el que las hace cumplir, y quien escriba la dirección a mano se
 * topa con la misma comprobación.
 *
 * `soloAlCrear` estaba acá y se pasó a lo que viaja en la v1.382.0. Dejó de ser
 * cierto que la pantalla no hiciera nada con ella: desde que la importación por
 * planilla no escribe campos de solo lectura, el mapeo de columnas tiene que
 * saber cuáles son la excepción —los que sí se aceptan al crear, que es lo que
 * hace una importación— para no ofrecer una columna que el servidor va a
 * descartar ni esconder una que sí acepta.
 */
const SOLO_DEL_SERVIDOR = [
  'unique',                   // no puede repetirse (el RUT)
  'noAntesDe',                // esta fecha no va antes de aquella
  'companeroDe',              // dos campos que no pueden ser la misma persona
  'alcanceLoDecideElModulo',  // el alcance de esta referencia lo resuelve el módulo
  'oculto',                   // el campo no sale del servidor: se filtra antes
  /*
   * Contra qué tabla se comprueba al guardar, cuando la lista del desplegable
   * no está escrita en el módulo sino guardada en un módulo que mantiene la
   * iglesia. La pantalla no lo necesita: ella ya pide las opciones por
   * `optionsRoute`, que es la misma lista vista desde el otro lado. Esto es la
   * comprobación del guardado, y de ésas no viaja ninguna.
   */
  'opcionesDe',
  /*
   * De qué módulo COPIA su texto este campo —el detalle del Registro de
   * Cambios, la descripción de la bitácora de un miembro—. Es una regla de
   * lectura: con ella el servidor recorta las cifras reservadas que ese texto
   * traiga y no deja buscar por él sin las llaves. A la pantalla no le
   * incumbe: lo que le llega ya viene recortado (ver server/sensibles.js).
   */
  'copiaDe',
];

/**
 * Un campo del módulo, tal como lo ve la pantalla.
 *
 * Vive acá y no en la ruta que lo usa para que se pueda probar sin levantar el
 * servidor: es una función de un campo a otro campo, y lo que hay que
 * comprobar de ella es justamente qué deja pasar.
 */
function comoLoVeLaPantalla(campo, { salud = null, porcentajeVigente = () => undefined } = {}) {
  const {
    name, label, type, required, options, sugerencias, ref, help, default: def,
    porDefecto, accept, showIf, bloqueadoSi, optionsRoute, readonly, soloAlCrear, calcula,
    mostrarEdad, mostrarDia, seccion, destacado, buscador, ancho, recorte, recorta, min, max,
    entero, sensible, reservado, futuro, placeholder, enElPapel,
  } = campo;
  return {
    name, label, type, required: !!required, options: options || null,
    // Los límites viajan para que el formulario avise antes de mandar. Quien
    // manda igual —o escribe la dirección a mano— se topa con la misma
    // comprobación en el servidor, que es la que manda.
    min: min === undefined ? null : min, max: max === undefined ? null : max,
    // Y si se cuenta en enteros: el teclado del teléfono se abre sin coma, y el
    // aviso sale mientras se escribe en vez de al guardar.
    entero: !!entero,
    // Si el campo admite fecha adelante, el calendario no le pone tope de hoy
    futuro: !!futuro,
    // Para que la pantalla sepa cuáles esconder cuando el servidor no se los
    // mandó a esta persona (ver server/sensibles.js). `sensible` es la forma
    // antigua de decir «reservado a los datos de salud».
    sensible: !!sensible,
    reservado: reservado || (sensible ? salud : null),
    sugerencias: sugerencias || null, ref: ref || null,
    help: help || null, default: def ?? null, accept: accept || null, showIf: showIf || null,
    /*
     * EL COLOR DE FÁBRICA DE UN CAMPO DE COLOR.
     *
     * No es lo mismo que `default`: un color en blanco significa «el del
     * sistema» y así se guarda —vacío—, así que no lleva valor por defecto. Lo
     * que la pantalla necesita saber es en qué color abrir el cuadrito de
     * elegir y qué poner de pista en la caja, para que quien mire la ficha vea
     * el color que ESA hoja imprime.
     */
    porDefecto: porDefecto || null,
    // «Este campo deja de poder escribirse cuando la ficha llega a tal estado».
    // La pantalla lo dibuja bloqueado; el servidor contesta si igual llega (ver
    // estaBloqueado en server/crud.js).
    bloqueadoSi: bloqueadoSi || null,
    optionsRoute: optionsRoute || null, readonly: !!readonly,
    /*
     * Y la única excepción a «de solo lectura»: se acepta al CREAR y nunca más.
     * Viaja desde la v1.382.0 porque el mapeo de columnas de la importación
     * tiene que distinguirla —importar crea—, y sin eso escondería una columna
     * que el servidor sí acepta.
     */
    soloAlCrear: !!soloAlCrear, mostrarEdad: !!mostrarEdad,
    /*
     * «Y ponle el día de la semana delante»: el listado dibuja «Sáb. 29-08-2026»
     * en vez de «29-08-2026». Es del listado y no de la ficha, y por eso lo
     * decide el módulo campo por campo (ver `diaAbreviado` en public/app.js).
     */
    mostrarDia: !!mostrarDia,
    seccion: seccion || null, destacado: !!destacado, ancho: ancho || null, recorte: recorte || null,
    recorta: recorta || null,
    // Lo que dice la casilla vacía de un buscador de referencias. Sin esto, la
    // de una cuenta de tesorería pedía «el nombre, el apellido o el RUT», que
    // para una cuenta no quiere decir nada.
    placeholder: placeholder || null,
    /*
     * «Este campo NO va en la hoja impresa». El falso dice algo y por eso viaja
     * (ver EL_NO_DICE_ALGO más arriba); no venir significa lo contrario, que va
     * como todos.
     *
     * Iba solo para los campos calculados, que es donde se estrenó, y un campo
     * corriente que lo declaraba se imprimía igual: la pantalla nunca se
     * enteraba. Se vio al mandar a imprimir una ayuda social y encontrar sus
     * notas privadas en la hoja.
     */
    enElPapel: enElPapel === undefined ? null : !!enElPapel,
    buscador: buscador === undefined ? null : !!buscador,
    calcula: calcula ? { ...calcula, porcentaje: porcentajeVigente(calcula) } : null,
    computed: false,
  };
}

module.exports = {
  sinLoQueNoDiceNada, EL_NO_DICE_ALGO,
  LO_QUE_VIAJA, SOLO_DEL_SERVIDOR, comoLoVeLaPantalla,
};
