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
 * aviso al borrar cualquiera— y que viven en server/acta-firmada.js, porque son
 * el mismo documento con distinto dueño.
 */
const {
  FIRMADA, camposDeLaFirma, loQueCambia, avisoDeActaFirmada,
  anotarLaFirma, enUnSoloAviso, avisoDeActaQueSeBorra,
} = require('../acta-firmada');

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

/** Cómo queda un campo después de este guardado: lo que llega, o lo que ya estaba. */
const comoQueda = (campo, data, existing) => (
  data[campo] !== undefined ? data[campo] : existing && existing[campo]);

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
      name: 'numero_acta', label: 'Número de acta', type: 'text', required: true,
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
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    { name: 'hora_fin', label: 'Hora de finalización', type: 'time' },
    { name: 'presidida_por', label: 'Presidida por', type: 'text' },
    { name: 'secretario', label: 'Secretario(a)', type: 'text' },
    { name: 'total_asistentes', label: 'Total de asistentes', type: 'number' },
    { name: 'hubo_quorum', label: '¿Hubo quórum?', type: 'boolean', default: 1 },
    { name: 'agenda', label: 'Agenda / Orden del día', type: 'textarea' },
    // Con formato, como en las actas de reunión: un acta de asamblea se escribe
    // con sus acuerdos numerados. Y de paso se limpia al guardar.
    { name: 'desarrollo', label: 'Desarrollo de la asamblea', type: 'richtext' },
    { name: 'acuerdos', label: 'Acuerdos y resoluciones', type: 'richtext' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Borrador',
      options: ['Borrador', 'Aprobada', 'Firmada'],
    },
    { name: 'documento', label: 'Documento adjunto (escaneada/firmada)', type: 'file' },
    // Los declara el compartido, para que los dos libros de actas los lleven
    // iguales (ver server/acta-firmada.js, que explica por qué van sin sección)
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
    beforeSave(data, { user, existing, confirmado }) {
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
