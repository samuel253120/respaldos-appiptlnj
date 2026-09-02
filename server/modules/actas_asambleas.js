/**
 * Módulo: Actas de Asambleas (asambleas generales de la iglesia).
 *
 * Es el documento más formal que este sistema levanta: en una asamblea general
 * se elige directiva, se aprueban los estados financieros y se autoriza vender
 * un inmueble. El acta que sale de acá es la que se le muestra a un banco, a un
 * notario o al Ministerio de Justicia.
 *
 * Se registra de dos maneras, y las dos valen: adjuntando el documento firmado,
 * o escribiéndola acá mismo. Para lo segundo, el desarrollo y los acuerdos son
 * campos de texto CON FORMATO —negrita, cursiva, listas y títulos—, que es como
 * se escribe un acta de verdad: los acuerdos van numerados y los considerandos
 * aparte, y en una caja de texto pelado eso no se puede.
 *
 * Y hay una segunda razón para que sean de texto con formato, que pesa más que
 * la comodidad: lo que se escribe ahí se LIMPIA al guardarlo
 * (server/textorico.js), y esa limpieza es la que le falta al texto pelado. La
 * hoja impresa arma el acta con lo guardado adentro, así que un campo pelado y
 * sin escapar convierte lo que alguien escribe en el código de la hoja. La
 * impresión ahora escapa lo que no es texto con formato —ver loQueDiceElActa en
 * public/app.js—, y esto cierra la misma puerta por el otro lado.
 *
 * Las dos maneras se juntan, igual que en las actas de reunión: cuando el
 * documento adjunto es un Word o un PDF con texto, el sistema puede TRAER ese
 * texto al campo, para no escribir de nuevo lo que ya está escrito (ver
 * server/transcribir.js y la ruta /transcribir de más abajo).
 *
 * QUÉ SIGNIFICA «FIRMADA». Es el único estado que quiere decir algo fuera del
 * sistema: hay un papel firmado, en una carpeta, con la firma de quien presidió
 * y de quien fue secretario. De ahí salen las dos reglas que este módulo
 * comparte con el libro de reuniones —el aviso al cambiar un acta firmada y el
 * aviso al borrar cualquiera— y que viven en server/reglas-del-acta.js, porque son
 * el mismo documento con distinto dueño.
 */
const {
  FIRMADA, camposDeLaFirma, loQueCambia, avisoDeActaFirmada, anotarLaFirma,
  enUnSoloAviso, avisoDeActaQueSeBorra, loDelActaVacia, loDeLasHoras, comoQueda,
} = require('../reglas-del-acta');

/**
 * EL QUÓRUM, QUE ES LO ÚNICO QUE ESTE LIBRO TIENE Y EL DE REUNIONES NO.
 *
 * La reunión de un cuerpo no tiene quórum; una asamblea sí, y es lo que decide
 * si lo que se acordó ahí vale. La casilla «¿Hubo quórum?» existía, venía
 * marcada que sí de fábrica, y no la miraba nadie: medido en la v1.279.0, un
 * acta que decía «no hubo quórum» y traía escrito «Se aprueba la venta del
 * inmueble por unanimidad» entraba con 201 y sin una palabra.
 *
 * Lo que se hace acá es PREGUNTAR, no impedir. Y hay una razón precisa para no
 * impedirlo: si un acuerdo tomado sin quórum es nulo o solo es anulable lo dicen
 * los estatutos de la corporación, no este programa. Además hay un caso
 * legítimo y frecuente —la asamblea que se levanta por falta de quórum, y de la
 * que igual se levanta acta— que quedaría prohibido por error. Preguntando, el
 * acta se puede anotar tal como ocurrió y quien la escribe se entera de lo que
 * está anotando.
 *
 * LO QUE TODAVÍA NO SE HACE, y hay que decirlo: el sistema no CALCULA el
 * quórum. Sabe cuántos miembros tiene cada iglesia, así que podría; lo que no
 * sabe es cuánto es el quórum —la mitad más uno, dos tercios— ni sobre qué
 * padrón se cuenta —los miembros activos, o los que tienen derecho a voto—, y
 * eso lo dicen los estatutos. Mientras tanto la casilla sigue siendo una
 * declaración de quien escribe el acta, y estas dos preguntas son lo que se
 * puede comprobar sin inventar esa regla.
 */

/**
 * ¿Dice el acta que hubo quórum?
 *
 * Llega ya normalizada a 1 o a 0: el motor convierte cualquier forma de escribir
 * un sí o un no —«1», «true», true— antes de este gancho (ver `coerce` en
 * server/crud.js), y lo hace por las dos puertas, la pantalla y la importación
 * de planillas. Escribir acá otra vez esa conversión sería repetir una regla que
 * ya tiene dueño; lo que sí hay es una prueba que comprueba que el motor la
 * cumple, porque de eso depende que un «0» de una planilla no se lea como un sí.
 */
const huboQuorum = (data, existing) => Number(comoQueda('hubo_quorum', data, existing)) === 1;

/**
 * ¿Tiene el acta algo escrito en sus acuerdos?
 *
 * También llega limpio: los acuerdos son texto con formato, y un editor que se
 * vacía deja «<p></p>» o «<p><br></p>», que es tan vacío como el blanco aunque
 * no lo parezca. De eso se encarga server/textorico.js antes del guardado, y
 * deja `null`. Mirarlo otra vez acá sería la misma repetición.
 */
const tieneAcuerdos = (data, existing) => String(comoQueda('acuerdos', data, existing) || '').trim() !== '';

/**
 * Más gente en la asamblea que miembros tiene la congregación.
 *
 * El tope de arriba se dejó sin escribir a propósito: un número grande puesto a
 * mano no dice nada. El que sí dice algo lo tiene la base — cuántos miembros
 * tiene esa iglesia—, y una asamblea GENERAL es una reunión de miembros, así que
 * más asistentes que miembros es o un error de tipeo o algo que conviene mirar.
 *
 * Se pregunta y no se prohíbe: puede haber invitados, y puede haber una
 * membresía desactualizada. Lo que no puede pasar es que «5.000 asistentes» en
 * una congregación de 600 entre sin que nadie lo note y salga impreso.
 */
function loDeLosAsistentesQueNoCaben(data, existing, db) {
  const cuantos = Number(comoQueda('total_asistentes', data, existing));
  if (!Number.isFinite(cuantos) || cuantos <= 0) return null;
  const iglesiaId = comoQueda('iglesia_id', data, existing);
  if (!iglesiaId) return null;

  const fila = db.prepare(
    "SELECT COUNT(*) AS n FROM miembros WHERE iglesia_id = ? AND (estado IS NULL OR estado != 'Retirado')"
  ).get(iglesiaId);
  const miembros = (fila && fila.n) || 0;
  if (!miembros || cuantos <= miembros) return null;

  return `El acta anota ${cuantos} asistentes, y esa congregación tiene ${miembros} miembros. `
    + 'Una asamblea general es una reunión de miembros: revise si se le fue un dígito. Si de '
    + 'verdad asistieron más —invitados, o la membresía está por actualizar—, confirme y siga.';
}

/**
 * El acta que cambia de congregación.
 *
 * La iglesia es el único dueño que tiene un acta de asamblea: de ahí sale en qué
 * libro está, quién la ve y qué número le tocaba. Cambiarla no es corregir un
 * dato de la ficha, es mover el acta de un libro a otro.
 *
 * Medido en la v1.281.0: el acta de una asamblea de la Iglesia Central se pasó a
 * la Iglesia Norte con una sola petición, contestó 200 y no dijo nada. Quedó
 * anotada en el libro de una congregación que nunca tuvo esa asamblea.
 *
 * SE PREGUNTA Y NO SE IMPIDE, y acá el motivo es distinto del de las otras
 * reglas: corregir la iglesia de un acta mal anotada es exactamente para lo que
 * el campo tiene que poder cambiarse. Lo que no puede pasar es que se cambie sin
 * que quien lo hace vea las tres cosas que arrastra.
 *
 * EL ALCANCE YA ESTÁ BIEN PUESTO y no es lo que falta: se probó con una
 * secretaria acotada a una iglesia, y crear un acta de otra o mover la suya
 * hacia otra contestan 403 las dos. Esto es para quien alcanza las dos —un
 * administrador de la corporación—, que sí debe poder, pero debería tener que
 * decir que sí.
 */
function loDeLaIglesiaQueCambia(data, existing, db) {
  const antes = existing && existing.iglesia_id;
  const despues = data.iglesia_id !== undefined ? data.iglesia_id : antes;
  /*
   * Sin «de dónde» no hay mudanza: un acta que se está creando no viene de
   * ningún libro, y ese es el caso que cubre el primer `!antes`. Se probó
   * poniendo delante un `if (!existing) return null` y no cambiaba nada —lo que
   * quiere decir que sobraba—, así que la intención se dice acá y no se escribe
   * dos veces.
   */
  if (!antes || !despues || Number(antes) === Number(despues)) return null;

  const nombre = (id) => {
    const f = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id);
    return f ? f.nombre : `la iglesia n.º ${id}`;
  };
  const cual = existing.numero_acta ? ` n.º ${existing.numero_acta}` : '';

  /*
   * El número va con el acta, y es único DENTRO de cada iglesia, así que en el
   * libro nuevo el suyo puede estar tomado. Eso NO se dice acá: desde la
   * v1.283.0 el motor lo revisa antes que este gancho y RECHAZA el traslado con
   * su propio aviso, nombrando el libro —«Ya existe otra acta de asamblea con
   * ese Número de acta en «Iglesia Norte»»—. Preguntar «¿está seguro?» por un
   * traslado que después no va a poder ocurrir sería peor que rechazarlo: se
   * probó, y la primera versión de este aviso traía esa advertencia adentro
   * hasta que el arreglo del motor la dejó sin alcanzar nunca.
   */
  return `El acta${cual} está en el libro de ${nombre(antes)} y va a pasar al de ${nombre(despues)}. `
    + `El número se va con ella, y en el libro de ${nombre(antes)} queda el hueco. `
    + 'Cambia también quién puede verla: pasa a estar entre lo de esa otra congregación.';
}

/**
 * Sin quórum, pero con acuerdos.
 *
 * Se avisa cuando el acta QUEDA así, no solo cuando la casilla cambia: un acta
 * que ya estaba sin quórum y a la que recién ahora se le escriben los acuerdos
 * es exactamente el mismo caso, y mirar solo el cambio lo dejaría pasar.
 */
function loDeLosAcuerdosSinQuorum(data, existing) {
  if (huboQuorum(data, existing) || !tieneAcuerdos(data, existing)) return null;
  return 'El acta dice que NO hubo quórum, y trae acuerdos escritos. Si los estatutos piden '
    + 'quórum para acordar, lo que se anote acá no va a valer aunque quede escrito. Si la '
    + 'asamblea se levantó sin acordar nada, deje los acuerdos en blanco y anote en el '
    + 'desarrollo que se levantó por falta de quórum.';
}

/**
 * Quórum declarado, pero sin gente que lo sostenga.
 *
 * No se compara contra el padrón —eso es lo que falta decidir— sino contra sí
 * misma: un acta que afirma que hubo quórum tiene que decir con cuánta gente.
 * Cero, o el campo en blanco, es la contradicción que sí se puede ver sin saber
 * cuánto es el quórum de esa corporación.
 *
 * PERO SOLO CUANDO EL ACTA YA ESTÁ AFIRMANDO ALGO, y esto es lo importante. La
 * casilla viene marcada que sí de fábrica, así que un acta recién creada —número,
 * fecha, tipo e iglesia, que es lo único obligatorio— dice «hubo quórum» sin que
 * nadie lo haya declarado, y todavía no dice con cuánta gente porque todavía no
 * dice nada. Se probó sin esta condición: TODA acta nueva preguntaba, y un aviso
 * que sale siempre enseña a apretar «guardar igual» sin leerlo, que es la manera
 * de que el día que importe tampoco se lea.
 *
 * Se considera que el acta afirma algo cuando trae acuerdos escritos, o cuando
 * dejó de ser un borrador: en los dos casos es un documento que alguien va a
 * leer, y ahí la contradicción pesa.
 */
function loDelQuorumSinGente(data, existing) {
  if (!huboQuorum(data, existing)) return null;

  const estado = comoQueda('estado', data, existing) || 'Borrador';
  if (!tieneAcuerdos(data, existing) && estado === 'Borrador') return null;

  const cuantos = comoQueda('total_asistentes', data, existing);
  if (cuantos !== null && cuantos !== undefined && cuantos !== '' && Number(cuantos) > 0) return null;
  const enBlanco = cuantos === null || cuantos === undefined || cuantos === '';
  return `El acta dice que hubo quórum y ${enBlanco ? 'no dice cuántos asistieron' : 'anota 0 asistentes'}. `
    + 'El quórum se cuenta con gente: escriba el total de asistentes, o destilde la casilla.';
}

module.exports = {
  name: 'actas_asambleas',
  label: 'Actas de Asambleas',
  labelSingular: 'Acta de Asamblea',
  icon: '🏛️',
  group: 'Documentación',
  order: 61,
  display: 'Asamblea {numero_acta} — {fecha}',
  dateField: 'fecha',
  printable: true,
  // Con el desarrollo, por lo mismo que en las actas de reunión: es donde cae
  // el texto que se transcribe del documento adjunto (ver ese módulo).
  searchFields: ['numero_acta', 'agenda', 'desarrollo', 'acuerdos', 'presidida_por'],
  listFields: ['numero_acta', 'fecha', 'tipo', 'iglesia_id', 'total_asistentes', 'estado'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    {
      name: 'numero_acta', label: 'Número de acta', type: 'text', required: true, seccion: 'Identificación',
      // Único dentro de la iglesia: la asamblea es de la congregación entera,
      // así que su libro es uno por iglesia.
      unique: 'iglesia_id',
      help: 'Lo propone el sistema, y se puede cambiar. Ej. AS-001-2026',
    },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo de asamblea', type: 'select', required: true, default: 'Ordinaria',
      options: ['Ordinaria', 'Extraordinaria'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text', seccion: 'Dónde y quiénes' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    { name: 'hora_fin', label: 'Hora de finalización', type: 'time' },
    { name: 'presidida_por', label: 'Presidida por', type: 'text' },
    { name: 'secretario', label: 'Secretario(a)', type: 'text' },
    /*
     * Cuánta gente vino, con su piso.
     *
     * Sin el `min` entraba cualquier cosa: medido en la v1.280.0, «−50
     * asistentes» contestaba 201 y así quedaba impreso en la hoja. El motor sabe
     * hacer esto desde siempre y contesta con un aviso escrito para una persona;
     * lo que faltaba era declararlo. El mismo dato en Servicios —«Asistencia de
     * adultos», «Asistencia de niños»— ya lo declaraba, así que no era una
     * decisión de la organización: era una línea que en este módulo no se
     * escribió.
     *
     * Sin `max`: un tope grande sería un número inventado, y el que de verdad
     * dice algo —cuánta gente tiene esa congregación— se mira en el gancho, que
     * puede leerlo de la base y preguntar en vez de prohibir.
     */
    { name: 'total_asistentes', label: 'Total de asistentes', type: 'number', min: 0 },
    { name: 'hubo_quorum', label: '¿Hubo quórum?', type: 'boolean', default: 1 },
    { name: 'agenda', label: 'Agenda / Orden del día', type: 'textarea', seccion: 'El acta' },
    // Con formato, como en las actas de reunión: un acta de asamblea se escribe
    // con sus acuerdos numerados. Y de paso se limpia al guardar.
    { name: 'desarrollo', label: 'Desarrollo de la asamblea', type: 'richtext' },
    { name: 'acuerdos', label: 'Acuerdos y resoluciones', type: 'richtext' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Borrador',
      options: ['Borrador', 'Aprobada', 'Firmada'], seccion: 'Documento y estado',
    },
    { name: 'documento', label: 'Documento adjunto (escaneada/firmada)', type: 'file' },
    // Los declara el compartido, para que los dos libros de actas los lleven
    // iguales (ver server/reglas-del-acta.js, que explica por qué van sin sección)
    ...camposDeLaFirma(),
  ],

  /*
   * QUÉ SE COPIA AL REGISTRO DE CAMBIOS CUANDO EL ACTA SE BORRA.
   *
   * Lo que quedaba anotado eran las seis columnas del listado: número, fecha,
   * tipo, iglesia, total de asistentes y estado. O sea, la cabecera. De la
   * decisión de la asamblea no quedaba una palabra — medido con un acta que
   * decía «Se aprueba la venta por 118 votos a favor»: se borró, y ese acuerdo
   * no quedó en ninguna parte.
   *
   * El adjunto se va con el registro y no se puede copiar acá; lo escrito sí, y
   * es lo que hace la diferencia entre una eliminación y una pérdida. Va el
   * nombre del archivo igual, para que se sepa qué se fue.
   */
  camposAlBorrar: ['lugar', 'hora_inicio', 'hora_fin', 'presidida_por', 'secretario',
    'hubo_quorum', 'firmada_por', 'fecha_firma', 'agenda', 'desarrollo', 'acuerdos', 'documento'],

  /*
   * LAS CUATRO SECCIONES DEL FORMULARIO.
   *
   * Eran dieciocho campos en una sola tirada, sin un título que los separara,
   * mientras el formulario del acta de reunión —el mismo motor, el mismo tipo de
   * documento— declara sus cuatro desde hace tiempo. Un campo CONTINÚA la última
   * sección declarada, así que basta con nombrarla en el primero de cada grupo:
   * repetirla en los demás abriría una sección nueva con el mismo título, que es
   * lo que ya pasó una vez y se vio en la pantalla y no en una prueba.
   *
   *   Identificación ...... número, fecha, tipo, iglesia
   *   Dónde y quiénes ..... lugar, horas, quién presidió, secretario,
   *                         asistentes y quórum
   *   El acta ............. agenda, desarrollo, acuerdos
   *   Documento y estado .. estado, adjunto, y la constancia de la firma
   */

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Qué número le toca a la próxima acta de asamblea de esta iglesia.
     *
     * Es una propuesta, igual que en las actas de reunión: se puede cambiar, y
     * si dos personas la piden a la vez la segunda se topa al guardar con que
     * ese número ya está usado (ver server/numeracion.js).
     */
    router.get('/actas_asambleas/proximo-numero', requirePerm('actas_asambleas', 'create'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.json({ numero: null });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      res.json({ numero: require('../numeracion').proximoNumero('actas_asambleas', iglesiaId, req.query.fecha) });
    });

    /**
     * El acta de asamblea, en PDF.
     *
     * La misma pieza que las actas de reunión —server/pdf/acta.js sabe hacer las
     * dos desde la v1.283.0— y por el mismo motivo: de los dos caminos para
     * sacar un acta del sistema, la vista de impresión depende de que el
     * navegador imprima bien, y el PDF sale igual siempre y se baja de una. Es
     * el documento que se manda a un banco o a un notario.
     *
     * Pide el permiso de IMPRIMIR y no el de ver, porque esto es sacar el
     * documento del sistema; y el acta tiene que estar dentro de lo que esa
     * persona alcanza, como cualquier otra consulta.
     */
    router.get('/actas_asambleas/:id(\\d+)/pdf', requirePerm('actas_asambleas', 'view'), (req, res, next) => {
      if (!require('../permissions').can(req.user, 'datos_impresion', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para imprimir ni descargar documentos.' });
      }
      const acta = require('../alcance').registroSuyo(req, res, 'actas_asambleas', req.params.id, 'Esa acta');
      if (!acta) return;
      try {
        const { generar, nombreDelArchivo } = require('../pdf/acta');
        const archivo = nombreDelArchivo(acta, 'actas_asambleas');
        res.setHeader('Content-Type', 'application/pdf');
        // El nombre va dos veces a propósito: la primera la entiende cualquier
        // navegador, la segunda lleva las tildes y las eñes sin romperse.
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${archivo.replace(/[^\x20-\x7E]/g, '_')}"; `
          + `filename*=UTF-8''${encodeURIComponent(archivo)}`
        );
        res.setHeader('Cache-Control', 'private, no-store');
        generar(acta, { quien: req.user && req.user.nombre, modulo: 'actas_asambleas' }).pipe(res);
      } catch (e) {
        next(e);
      }
    });

    /**
     * Traer al acta el texto del documento que se le adjuntó.
     *
     * La misma ruta que las actas de reunión, por el mismo motivo: el acta de
     * la asamblea suele llegar escaneada o en Word, y volver a escribirla en el
     * sistema es trabajo hecho dos veces. Lo que trae es una PROPUESTA que
     * queda en el campo sin guardarse: se revisa y se guarda, o no.
     *
     * Pide permiso de EDITAR y no de ver, porque lo que hace es llenar un campo
     * del acta; y pasa por el alcance, que es lo que impide leerle el adjunto a
     * un acta de otra congregación.
     */
    router.post('/actas_asambleas/:id(\\d+)/transcribir', requirePerm('actas_asambleas', 'edit'), async (req, res, next) => {
      const acta = require('../alcance').registroSuyo(req, res, 'actas_asambleas', req.params.id, 'Esa acta');
      if (!acta) return;
      if (!acta.documento) {
        return res.status(400).json({ error: 'Esta acta no tiene ningún documento adjunto que transcribir.' });
      }
      try {
        const leido = await require('../transcribir').delArchivo(acta.documento);
        if (leido.error) return res.status(400).json({ error: leido.error });
        res.json({ texto: leido.texto, palabras: leido.palabras, de: leido.de });
      } catch (e) {
        next(e);
      }
    });
  },

  hooks: {
    /**
     * Antes de guardar: si el acta está firmada, decir qué se va a cambiar.
     *
     * «Firmada» quiere decir que hay un papel firmado en una carpeta. Medido en
     * la v1.278.0: a un acta de asamblea guardada como Firmada se le podían dar
     * vuelta los acuerdos —de «se aprueba la compra del terreno» a «se
     * rechaza»— y el sistema contestaba 200 sin decir una palabra; y devolverla
     * a «Borrador», lo mismo. Desde ese momento el papel dice una cosa y el
     * sistema otra, y quien tenga la copia impresa no tiene manera de saberlo.
     *
     * SE PREGUNTA Y NO SE PROHÍBE. Corregir un acta firmada es legítimo —una
     * cifra mal transcrita, un apellido— y prohibirlo obligaría a borrarla y
     * escribirla de nuevo, que es peor. Lo que no puede pasar es que ocurra sin
     * que nadie lo vea.
     *
     * Y la constancia de la firma la escribe el sistema: quién la firmó y qué
     * día salen de quien hizo el cambio de estado, no de un campo que alguien
     * llena. Se estampan solo cuando el estado CAMBIA, y se borran si el acta
     * deja de estar firmada: una fecha de firma en un acta que volvió a
     * borrador estaría mintiendo.
     */
    beforeSave(data, { user, existing, confirmado, db }) {
      /*
       * TODAS LAS ADVERTENCIAS DE UN GUARDADO VAN EN UN SOLO AVISO, NUMERADAS.
       *
       * La marca de «guardar igual» es UNA para toda la petición: preguntando de
       * a una, quien confirma la primera pasaría las demás sin haberlas leído.
       * Van ordenadas por gravedad —el acta firmada primero, porque es la que
       * habla de un papel que ya existe afuera—. Es la lección que dejó el libro
       * de reuniones en la 1.276.0.
       */
      if (!confirmado) {
        const avisos = [];

        if (existing && existing.estado === FIRMADA) {
          const cambia = loQueCambia('actas_asambleas', data, existing);
          if (cambia.length) {
            avisos.push({ clave: 'acta_firmada', texto: avisoDeActaFirmada(existing, data, cambia) });
          }
        }

        const sinQuorum = loDeLosAcuerdosSinQuorum(data, existing);
        if (sinQuorum) avisos.push({ clave: 'asamblea_sin_quorum', texto: sinQuorum });

        const sinGente = loDelQuorumSinGente(data, existing);
        if (sinGente) avisos.push({ clave: 'quorum_sin_asistentes', texto: sinGente });

        const seMuda = loDeLaIglesiaQueCambia(data, existing, db);
        if (seMuda) avisos.push({ clave: 'acta_que_cambia_de_iglesia', texto: seMuda });

        const noCaben = loDeLosAsistentesQueNoCaben(data, existing, db);
        if (noCaben) avisos.push({ clave: 'asistentes_que_no_caben', texto: noCaben });

        const horas = loDeLasHoras(data, existing, 'la asamblea');
        if (horas) avisos.push({ clave: 'horas_del_acta', texto: horas });

        const vacia = loDelActaVacia(data, existing);
        if (vacia) avisos.push({ clave: 'acta_sin_nada', texto: vacia });

        if (avisos.length) {
          return { error: enUnSoloAviso(avisos), confirmar: avisos[0].clave };
        }
      }
      anotarLaFirma(data, existing, user);
      return null;
    },

    /**
     * Antes de borrar: decir qué se lleva puesto.
     *
     * La misma pieza que el libro de reuniones, con lo único que cambia entre
     * los dos: de quién es el acta. Acá es de la congregación entera.
     */
    beforeDelete(fila, { db, confirmado }) {
      if (confirmado) return null;

      const iglesia = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(fila.iglesia_id);
      // «de la asamblea ordinaria de Iglesia Central» y no «de Iglesia Central
      // (asamblea ordinaria)»: se lee de corrido, que es lo que se necesita en
      // una frase que alguien va a leer una sola vez y apurado.
      const cual = fila.tipo ? `la asamblea ${String(fila.tipo).toLowerCase()}` : 'la asamblea';
      return {
        error: avisoDeActaQueSeBorra(fila, {
          deQuien: iglesia ? ` de ${cual} de ${iglesia.nombre}` : ` de ${cual}`,
          elLibro: 'el libro de esa congregación',
        }),
        confirmar: 'acta_que_se_borra',
      };
    },
  },
};
