/**
 * Módulo: Certificados (bautismo, presentación, matrimonio, membresía…).
 * Imprimible.
 *
 * De qué clases hay, qué dice cada una y cómo se ve la hoja NO está acá: lo
 * mantiene la iglesia en «Formatos de Certificado». Acá queda cada certificado
 * emitido, con su número, su titular y sus fechas.
 *
 * ---------------------------------------------------------------------------
 * NO TODOS LOS CERTIFICADOS PIDEN LOS MISMOS DATOS
 *
 * Uno de membresía se resuelve con el nombre y la fecha. Uno de PRESENTACIÓN
 * DE NIÑOS no: dice cuándo nació el niño, quién lo presentó, quiénes son sus
 * padres y sus dos parejas de padrinos. Y uno de MATRIMONIO nombra a los dos
 * cónyuges en una sola frase.
 *
 * Cuál de las tres formas tiene la hoja lo dice la DISPOSICIÓN del formato
 * elegido, y de ahí sale también qué campos pide esta ficha. La disposición se
 * copia acá al guardar por dos razones, y las dos importan:
 *
 *   · La hoja se arma al imprimir. Sin la disposición escrita en el propio
 *     certificado, cambiarle la disposición al formato cambiaría la forma de
 *     todos los que ya están firmados y entregados.
 *   · Los campos que se muestran dependen de ella (showIf), y para eso tiene
 *     que ser un dato de esta ficha.
 *
 * Y NO SE EMITE A MEDIAS (punto 17.5): la comprobación de que están los datos
 * que la disposición necesita se hace en el servidor, no en la pantalla. Un
 * certificado de matrimonio a nombre de una sola persona es un papel que hay
 * que rehacer.
 *
 * ---------------------------------------------------------------------------
 * Y NADA DE LO QUE LE PASA A UN CERTIFICADO EMITIDO PASA EN SILENCIO. Anularlo
 * se pregunta, devolverle la validez se pregunta, borrarlo se pregunta, y
 * cambiarle el tipo —que suelta los datos que la hoja nueva no tiene dónde
 * poner— también. Las tres primeras son decisiones sobre un papel que puede
 * estar en manos de alguien, y ninguna de las tres lo recoge; la cuarta borra
 * datos que después no vuelven. Las frases empiezan igual —cuál es— y cada una
 * dice qué cambia y qué no. Si un mismo guardado tiene dos cosas que advertir,
 * las dice LAS DOS en un solo aviso (ver server/una-sola-pregunta.js).
 *
 * Y NO SE BORRA SIN PREGUNTAR, ni se borra en silencio. Un certificado es lo
 * único de este sistema que se firma, se sella y sale del edificio: borrarlo
 * libera su número —que el sistema volverá a proponer— y deja fuera del
 * alcance de nadie lo que decía. La pregunta lo dice, y `camposAlBorrar`
 * conserva la ficha entera en el Registro de Cambios. Para dejar un
 * certificado sin efecto CONSERVANDO su número está «Anulado».
 */
/** El estado de lo que ya no vale. El otro es «Emitido». */
const ANULADO = 'Anulado';

/**
 * Lo que se le dice a alguien antes de borrar un certificado.
 *
 * MEDIDO en la v1.293.0: `DELETE /certificados/6` contestaba 200 sin una
 * palabra, y de los dieciséis datos que traía esa ficha quedaban SEIS en el
 * Registro de Cambios —los del listado—. No quedaban la fecha del bautismo,
 * que es lo que el papel certifica, ni el oficiante que lo firmó, ni el texto
 * propio, ni la nota que decía «Se entregó en mano el 3 de marzo».
 *
 * Es el mismo arreglo que la oficina de partes cerró en la v1.286.0, y acá
 * pesa más: un documento de la oficina de partes es la anotación de algo que
 * pasó; un certificado ES el documento.
 *
 * LA PREGUNTA DICE TRES COSAS, y las tres hacen falta:
 *
 *   · CUÁL es —número, tipo y titular—, porque se borra desde un listado
 *     donde todas las filas se parecen.
 *   · QUÉ SE LLEVA. No es lo mismo una ficha a medio escribir que un
 *     certificado con su oficiante, su texto y sus padrinos.
 *   · Y QUÉ PASA CON EL NÚMERO, que es lo único que esta pregunta sabe y el
 *     «¿está seguro?» del navegador no: el número vuelve a ofrecerse, y si el
 *     papel ya se entregó quedan dos en circulación diciendo ser el mismo.
 *     Por eso nombra ANULAR, que es la operación que conserva el número.
 */
function avisoDelCertificadoQueSeBorra(fila) {
  const { comoSeLee } = require('../fechas');
  const { enLista } = require('../formato');

  /*
   * Qué trae adentro. Los datos de las hojas de presentación y de matrimonio
   * se cuentan juntos y no uno por uno: «los padres y los padrinos» dice lo
   * que hay que saber, y siete nombres seguidos en una pregunta no se leen.
   */
  const trae = [];
  if (fila.fecha_evento) trae.push(`la fecha del evento (${comoSeLee(fila.fecha_evento)})`);
  if (fila.oficiante_id) trae.push('el oficiante que lo firma');
  if (fila.texto) trae.push('un texto propio');
  if (fila.conyuge) trae.push('el otro cónyuge');
  const deLaHoja = ['fecha_nacimiento', 'padre', 'madre', 'padrino_1', 'madrina_1', 'padrino_2', 'madrina_2']
    .filter((c) => fila[c]);
  if (deLaHoja.length) trae.push('los datos de la presentación (los padres y los padrinos)');
  if (fila.notas) trae.push('las notas internas');
  const conQue = trae.length ? ` Trae ${enLista(trae)}.` : ' No tiene nada más escrito.';

  /* Que haya salido de una solicitud es la respuesta que se le dio a alguien */
  const deLaSolicitud = fila.solicitud_id
    ? ' Salió de una solicitud, y esa solicitud quedará diciendo que se emitió algo que ya no está.'
    : '';

  const anulado = fila.estado === ANULADO
    ? ' Ya está anulado, así que el papel entregado ya no vale — pero la fila es la constancia de que existió.'
    : '';

  const elNumero = fila.numero
    ? ` El número ${fila.numero} vuelve a quedar disponible y el sistema lo va a proponer de nuevo:`
      + ' si el papel ya se entregó, quedan dos certificados en circulación diciendo ser el mismo.'
      + ' Para dejarlo sin efecto conservando el número está «Anulado».'
    : ' No lleva número, así que no libera ninguno.';

  return `Va a eliminar ${cualEs(fila)}.${conQue}${deLaSolicitud}${anulado}`
    + ` Lo que decía queda copiado en el Registro de Cambios.${elNumero}`;
}

/**
 * Cómo se nombra un certificado dentro de un aviso.
 *
 * Las tres preguntas de este módulo —anular, volver a valer y borrar— empiezan
 * igual, y tienen que empezar igual: se contestan desde un listado o desde un
 * formulario donde todas las fichas se parecen, y lo primero que hace falta
 * saber es cuál es ésta.
 */
function cualEs(fila) {
  const { comoSeLee } = require('../fechas');
  const cual = fila.numero ? `el certificado n.º ${fila.numero}` : 'un certificado sin número';
  const deQue = fila.tipo ? ` de ${fila.tipo}` : '';
  const deQuien = fila.nombre_titular ? `, a nombre de ${fila.nombre_titular}` : '';
  const cuando = fila.fecha_emision ? `, emitido el ${comoSeLee(fila.fecha_emision)}` : '';
  return `${cual}${deQue}${deQuien}${cuando}`;
}

/**
 * Lo que se le dice a alguien antes de anular un certificado.
 *
 * MEDIDO en la v1.294.0: `PUT {estado: «Anulado»}` sobre un certificado emitido
 * contestaba 200 sin una palabra. Anular es la operación CORRECTA —el número
 * se conserva, la fila no desaparece, el libro sigue cuadrando— y por eso es la
 * que este módulo recomienda en vez de borrar; pero es una decisión sobre un
 * papel que puede estar en manos de alguien.
 *
 * La frase dice lo que el sistema SÍ hace y, sobre todo, LO QUE NO PUEDE HACER:
 * ninguna de estas dos operaciones recoge el papel entregado. Esa copia sigue
 * circulando sin el sello, y quien anula tiene que saberlo para ir a buscarla.
 */
function avisoDelCertificadoQueSeAnula(fila) {
  return `Va a anular ${cualEs(fila)}. El número no se libera: la fila queda como constancia de que`
    + ' existió. Desde ahora su hoja sale con el sello «ANULADO» y la fecha de hoy, y bajo cada'
    + ' línea de firma dice que ese papel no vale. Lo que el sistema no puede hacer es recoger el'
    + ' que ya se entregó: esa copia sigue circulando sin el sello.';
}

/**
 * Y antes de devolverle la validez a uno anulado.
 *
 * Es la misma puerta en el otro sentido, y pesa igual o más: un certificado que
 * vuelve a «Emitido» deja de llevar el sello y se imprime otra vez como uno
 * válido. Además se borra su fecha de anulación —tiene que borrarse; uno que
 * vale no puede seguir diciendo cuándo dejó de valer—, así que en la ficha no
 * queda dicho que alguna vez se anuló. Queda en el Registro de Cambios, que es
 * otro lugar y hay que ir a buscarlo.
 */
function avisoDelCertificadoQueVuelveAValer(fila) {
  const { comoSeLee } = require('../fechas');
  const desde = fila.fecha_anulacion ? ` desde el ${comoSeLee(fila.fecha_anulacion)}` : '';
  return `${cualEs(fila).replace(/^el /, 'El ')} está anulado${desde}. Al volverlo a «Emitido» su hoja`
    + ' deja de llevar el sello y se imprime otra vez como un certificado válido, y se borra la fecha'
    + ' de anulación: en la ficha no quedará dicho que alguna vez se anuló, solo en el Registro de'
    + ' Cambios.';
}

/**
 * Lo que se le dice a alguien antes de vaciarle datos por cambiarle el tipo.
 *
 * Cada forma de hoja pide sus propios datos, y el módulo suelta los que sobran
 * al cambiar de tipo. LA REGLA ES CORRECTA —un cónyuge no significa nada en un
 * certificado de membresía, y dejarlo guardado ahí lo haría aparecer de vuelta
 * el día que alguien vuelva a cambiar el tipo—. Lo que faltaba era avisar.
 *
 * MEDIDO en la v1.295.0: un matrimonio a nombre de dos pasado a «Membresía»
 * contestaba 200 y el cónyuge quedaba en nulo; una presentación de niños
 * pasada a «Bautismo» perdía de una vez la fecha de nacimiento, los dos padres
 * y las dos parejas de padrinos — siete datos, sin una palabra.
 *
 * SOLO SE NOMBRA LO QUE DE VERDAD TIENE ALGO ESCRITO. Avisar de siete campos
 * cuando seis están vacíos convierte la pregunta en un trámite, y una pregunta
 * que sale siempre se aprieta sin leer. Es la misma frase, y la misma razón,
 * con que la oficina de partes cerró su OP-06 en la v1.287.0.
 */
function avisoDelTipoQueCambia(campos, deQue, aQue, deLaHoja, aLaHoja) {
  const { enLista } = require('../formato');
  // Los rótulos salen de la propia declaración de más abajo —se leen al
  // preguntar, no al arrancar— para que un campo que se renombre no deje este
  // aviso hablando de otra cosa.
  const nombres = campos.map((c) => {
    const f = (module.exports.fields || []).find((x) => x.name === c);
    return `«${f ? f.label : c}»`;
  });
  const uno = campos.length === 1;
  /*
   * Las hojas se nombran entre comillas y con su nombre tal cual. En minúscula
   * y sin comillas la frase salía torcida —«de la hoja matrimonio a la
   * clásica»—, y estos tres nombres son rótulos, no sustantivos comunes.
   */
  const cambiaLaHoja = deLaHoja !== aLaHoja ? ` —de la hoja «${deLaHoja}» a la «${aLaHoja}»—` : '';
  return `Va a cambiar el tipo de este certificado de «${deQue}» a «${aQue}»${cambiaLaHoja},`
    + ` y eso vacía ${enLista(nombres)}: ${uno ? 'ese dato es' : 'esos datos son'} de la hoja anterior`
    + ` y no ${uno ? 'tiene' : 'tienen'} dónde ir en la nueva.`;
}

module.exports = {
  name: 'certificados',
  label: 'Certificados',
  labelSingular: 'Certificado',
  icon: '📜',
  group: 'Documentación',
  ayudaPermiso:
    'Los certificados emitidos. Crear uno es emitir un documento que se firma y se entrega; su ' +
    'número lo propone el sistema y no se puede repetir dentro de la iglesia.',
  order: 63,
  display: '{tipo} — {numero}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['numero', 'nombre_titular', 'tipo'],
  listFields: ['numero', 'tipo', 'nombre_titular', 'fecha_emision', 'iglesia_id', 'estado'],

  /**
   * Lo que se conserva de un certificado cuando se borra.
   *
   * La constancia del borrado guardaba, por omisión, los campos del LISTADO
   * —seis—, que es una lista pensada para caber en columnas y no para
   * conservar nada. Medido en la v1.293.0 sobre un certificado de bautismo
   * completo: de dieciséis datos escritos quedaban seis, y no estaban la
   * FECHA DEL BAUTISMO —que es lo que el papel certifica—, el oficiante que
   * lo firmó, el texto propio ni la nota que decía cuándo se entregó en mano.
   *
   * Acá van los otros: los de cualquier certificado, los de las dos hojas que
   * piden más —la presentación de niños y el matrimonio— y de dónde salió.
   * Un certificado borrado no se puede volver a mirar; esta línea es lo único
   * que queda de él, y tiene que alcanzar para rehacerlo.
   */
  camposAlBorrar: ['fecha_evento', 'oficiante_id', 'miembro_id', 'solicitud_id', 'disposicion',
    'ciudad', 'texto', 'fecha_anulacion', 'notas',
    'fecha_nacimiento', 'padre', 'madre', 'padrino_1', 'madrina_1', 'padrino_2', 'madrina_2',
    'conyuge'],
  defaultSort: { field: 'fecha_emision', dir: 'desc' },
  fields: [
    {
      name: 'numero', label: 'Número', type: 'text', required: true, unique: 'iglesia_id',
      help: 'Lo propone el sistema al elegir la iglesia, y se puede cambiar. No puede repetirse ' +
        'dentro de la misma iglesia. El prefijo se fija en Configuración.',
    },
    {
      name: 'tipo', label: 'Tipo de certificado', type: 'select', required: true,
      // Los mantiene la iglesia (módulo «Formatos de Certificado»): de ahí sale
      // también el texto y el diseño de la hoja al imprimir
      optionsRoute: '/formatos_certificado/opciones',
      help: 'Se administran en Formatos de Certificado, junto con su texto y su diseño.',
    },
    { name: 'iglesia_id', label: 'Iglesia que emite', type: 'ref', ref: 'iglesias', required: true },
    /*
     * De qué solicitud salió, si salió de alguna.
     *
     * Lo pone la solicitud al ofrecer el paso siguiente, y es lo que permite
     * que su ficha diga «ya se emitió» en vez de volver a ofrecerlo. Se ve y no
     * se escribe: quien emite a mano no tiene por qué inventar un enlace.
     */
    {
      name: 'solicitud_id', label: 'Solicitud que lo originó', type: 'ref', ref: 'solicitudes',
      // Se acepta al crear y nunca más: se sabe en el momento en que se emite,
      // y cambiarlo después sería reescribir de dónde salió
      readonly: true, soloAlCrear: true,
      help: 'Se pone solo cuando se emite desde una solicitud aprobada. En su seguimiento queda anotado.',
    },
    { name: 'miembro_id', label: 'Miembro (si está registrado)', type: 'ref', ref: 'miembros' },
    { name: 'nombre_titular', label: 'Nombre del titular', type: 'text', required: true, help: 'Nombre completo tal como aparecerá en el certificado' },
    { name: 'fecha_evento', label: 'Fecha del evento (bautismo, boda, etc.)', type: 'date' },
    { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', required: true },
    { name: 'oficiante_id', label: 'Oficiante / Firma', type: 'ref', ref: 'pastores' },

    /*
     * Qué forma tiene la hoja. La copia el sistema del formato elegido, y de
     * ella dependen los campos de más abajo. Va oculta: no es algo que se
     * elija acá, sino en el formato.
     */
    {
      name: 'disposicion', label: 'Forma de la hoja', type: 'text', readonly: true,
      help: 'La trae el tipo elegido, y de ella dependen los datos que pide esta ficha. '
        + 'Se cambia en la ficha del formato, no acá.',
    },

    /* ── Lo que pide la presentación de niños ───────────────────── */
    {
      name: 'fecha_nacimiento', label: 'Fecha de nacimiento del niño(a)', type: 'date',
      seccion: 'Los datos del niño(a)',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padre', label: 'Padre', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
      help: 'Nombre completo, como va a salir impreso.',
    },
    {
      name: 'madre', label: 'Madre', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padrino_1', label: 'Padrino', type: 'text',
      seccion: 'Los padrinos',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
      help: 'Opcional. Se imprimen de a pares; el par que quede vacío no sale en la hoja.',
    },
    {
      name: 'madrina_1', label: 'Madrina', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padrino_2', label: 'Segundo padrino', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'madrina_2', label: 'Segunda madrina', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },

    /* ── Lo que pide el matrimonio ──────────────────────────────── */
    {
      name: 'conyuge', label: 'El otro cónyuge', type: 'text',
      seccion: 'El matrimonio',
      showIf: { field: 'disposicion', equals: 'Matrimonio' },
      help: 'El certificado nombra a los dos: arriba va el titular y acá quien se casa con él o con ella.',
    },

    /*
     * La ciudad donde se entrega, congelada al emitir.
     *
     * Sale de la iglesia, pero se copia: si mañana la iglesia se muda, los
     * certificados que ya se entregaron siguen diciendo dónde se entregaron.
     */
    /* ── Lo que sale impreso ─────────────────────────────────────
     *
     * ESTA SECCIÓN TIENE QUE ESTAR DECLARADA, y no es cosmética.
     *
     * En este formulario, un campo que no dice a qué sección pertenece se
     * queda dentro de la que estaba abierta. Los cinco campos de acá abajo
     * —la ciudad, el texto, el estado, la fecha de anulación y las notas— no
     * la declaraban, así que caían dentro de «El matrimonio», que solo se
     * muestra cuando la disposición es Matrimonio. Resultado, medido en la
     * v1.294.0 sobre un certificado de bautismo: el campo ESTADO no aparecía
     * en la pantalla. Anular desde el formulario era imposible salvo en los
     * certificados de matrimonio.
     */
    { name: 'ciudad', label: 'Ciudad', type: 'text', readonly: true, seccion: 'Lo que sale impreso' },
    {
      name: 'texto', label: 'Texto del certificado', type: 'textarea',
      help: 'Solo si este certificado tiene que decir algo distinto. Vacío usa el texto del formato, ' +
        'que es lo habitual: así, corregir una redacción se hace una vez en el formato y no certificado por certificado.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Emitido',
      seccion: 'El estado y las notas',
      options: ['Emitido', 'Anulado'],
      help: 'Anular no borra: el número se conserva y la hoja sale con su sello, diciendo que '
        + 'ese papel ya no vale.',
    },
    /*
     * CUÁNDO SE ANULÓ, para que el sello lo pueda decir.
     *
     * Lo estampa el sistema al cambiar el estado, no se escribe a mano: es lo
     * mismo que hacen las actas con «Firmada por» y su fecha desde la v1.272.0.
     * Un sello que dice «ANULADO» y no dice cuándo deja la pregunta de vuelta
     * en quien recibe el papel.
     *
     * Solo al CAMBIAR de estado. Volver a guardar un certificado que ya estaba
     * anulado no re-estampa la fecha: la anulación ocurrió el día que ocurrió,
     * y re-escribirla en cada guardado la convertiría en «la última vez que
     * alguien tocó esta ficha», que es otra cosa.
     */
    {
      name: 'fecha_anulacion', label: 'Fecha de anulación', type: 'date', readonly: true,
      showIf: { field: 'estado', equals: 'Anulado' },
      help: 'La anota el sistema al anularlo, y sale impresa en el sello de la hoja.',
    },
    { name: 'notas', label: 'Notas internas', type: 'textarea' },
  ],

  hooks: {
    /**
     * Lo que salió de una solicitud queda anotado en su seguimiento.
     *
     * Que un documento haya nacido de una solicitud es la mitad de la respuesta
     * que se le dio a quien pidió: si no queda dicho ahí, la solicitud aparece
     * aprobada y sin rastro de qué se hizo con ella.
     */
    afterSave(fila, { isNew, existing, user, db }) {
      if (!fila.solicitud_id) return;
      if (!isNew && existing && Number(existing.solicitud_id) === Number(fila.solicitud_id)) return;
      require('../solicitudes/paso-siguiente')
        .anotarQueSalio(db, fila.solicitud_id, 'certificados', fila, user);
    },
    /**
     * Un certificado no se emite a medias (punto 17.5).
     *
     * Acá se resuelve la disposición —la forma de la hoja— a partir del
     * formato elegido, se congela la ciudad de la iglesia, y se comprueba que
     * estén los datos que esa disposición necesita. La pantalla ya los pide,
     * pero la comprobación vive en el servidor: un certificado de matrimonio a
     * nombre de una sola persona, o uno de presentación sin los padres, es un
     * papel firmado y entregado que hay que rehacer.
     *
     * Lo que sobra se suelta. Si alguien empieza un certificado de matrimonio,
     * escribe al cónyuge y después lo cambia a uno de membresía, ese nombre no
     * puede quedar guardado ahí: no significa nada en la hoja nueva y aparece
     * de vuelta el día que alguien vuelva a cambiarle el tipo.
     */
    beforeSave(data, { existing, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);

      const formato = db
        .prepare('SELECT * FROM formatos_certificado WHERE nombre = ?')
        .get(dato('tipo'));
      const { DISPOSICIONES } = require('./formatos_certificado');
      const como = formato && DISPOSICIONES.includes(formato.disposicion)
        ? formato.disposicion
        : 'Clásica';
      data.disposicion = como;

      const DE_NINOS = ['fecha_nacimiento', 'padre', 'madre', 'padrino_1', 'madrina_1', 'padrino_2', 'madrina_2'];
      const DE_BODA = ['conyuge'];
      const sobran = como === 'Presentación de niños' ? DE_BODA
        : como === 'Matrimonio' ? DE_NINOS
          : [...DE_NINOS, ...DE_BODA];

      /*
       * Qué se pierde de verdad con este guardado (ver
       * `avisoDelTipoQueCambia`). Se mira ANTES de soltarlo, y sobre lo que
       * QUEDARÍA —lo que llega en esta petición, o lo que ya había—, que es lo
       * que de verdad se va a perder. Solo en fichas que ya existen: en una
       * nueva no hay nada que perder, y el formulario ni siquiera muestra esos
       * campos si la hoja no los pide.
       */
      const seSueltan = !existing ? [] : sobran.filter((c) => {
        const v = dato(c);
        return v !== null && v !== undefined && v !== '';
      });

      for (const campo of sobran) data[campo] = null;

      const limpio = (n) => String(dato(n) || '').trim();
      if (como === 'Presentación de niños') {
        if (!limpio('padre') && !limpio('madre')) {
          return 'Un certificado de presentación de niños nombra a sus padres. Escriba al menos uno.';
        }
        const nace = limpio('fecha_nacimiento');
        const evento = limpio('fecha_evento');
        if (nace && evento && nace > evento) {
          return 'La fecha de nacimiento no puede ser posterior a la de la presentación.';
        }
      }
      if (como === 'Matrimonio' && !limpio('conyuge')) {
        return 'Un certificado de matrimonio nombra a los dos cónyuges. Falta escribir el otro.';
      }

      /**
       * Y NO SE EMITE SIN EL DÍA, cuando la hoja lo va a nombrar.
       *
       * MEDIDO en la v1.296.0: un certificado de bautismo sin fecha del evento
       * se emitía con un 201, y su hoja salía diciendo «Certifica que fue
       * bautizado(a) en las aguas […] el día , en Iglesia Central». La frase se
       * cierra sola y el hueco pasa desapercibido hasta que el papel está
       * firmado.
       *
       * LA REGLA NO ES «LA FECHA DEL EVENTO ES OBLIGATORIA», y no puede serlo:
       * un certificado de membresía dice «es miembro en plena comunión de tal
       * iglesia» y no nombra ningún día. La regla es la que se puede comprobar
       * mirando lo que ESTA hoja va a imprimir: si su texto nombra la fecha del
       * evento —de cualquiera de las cuatro maneras en que se puede escribir— y
       * la fecha está en blanco, no se emite. Así vale también para los
       * formatos que la iglesia escriba mañana.
       *
       * Vale para las tres hojas: la clásica la nombra entera y las de
       * presentación y matrimonio la nombran partida en día, mes y año, que es
       * lo que hace la frase con los espacios en blanco.
       */
      if (!limpio('fecha_evento')) {
        const loQueSeImprime = [
          dato('texto') || (formato && formato.texto),
          formato && formato.titulo,
          formato && formato.texto_fecha,
          formato && formato.epigrafe,
          formato && formato.rotulo_titular,
        ].filter(Boolean).join(' ');
        if (/\{(fecha_evento|ev_dia|ev_mes|ev_anio)\}/.test(loQueSeImprime)) {
          return 'El texto de este certificado nombra el día del evento, y está en blanco: la hoja '
            + 'saldría con un hueco en esa frase —«… el día , en …»—. Escriba la fecha del evento, o '
            + `saque ese dato del texto del formato «${dato('tipo')}».`;
        }
      }

      /*
       * Y la fecha de la anulación, que es lo que el sello imprime.
       *
       * Se mira el estado que QUEDA contra el que había: al anular se estampa
       * el día, y al volver a «Emitido» se borra —un certificado que vuelve a
       * valer no puede seguir diciendo cuándo se anuló—.
       */
      const estadoAntes = existing ? existing.estado : null;
      const estadoAhora = dato('estado');

      /**
       * CAMBIARLE EL ESTADO A UN CERTIFICADO QUE YA EXISTE SE PREGUNTA.
       *
       * Las dos direcciones, y las dos por lo mismo: son decisiones sobre un
       * papel que puede estar en manos de alguien, y ninguna de las dos lo
       * recoge. Anular contestaba 200 sin una palabra —medido en la v1.294.0—,
       * y desanular también, borrando de paso la fecha de la anulación.
       *
       * SOLO CUANDO YA EXISTE. Crear uno directamente como «Anulado» es
       * legítimo —así se registra un certificado viejo que en el libro de papel
       * ya estaba dado de baja— y no cambia nada de lo que hubiera: quien lo
       * está escribiendo acaba de elegir ese estado en el formulario, y
       * preguntárselo ahí es ruido que se aprende a contestar que sí.
       */
      /**
       * TODO LO QUE HAY QUE ADVERTIR DE ESTE GUARDADO, EN UNA SOLA PREGUNTA.
       *
       * La marca de «guardar igual» es UNA para toda la petición: no dice a
       * qué reparo contesta, dice que sí a todo. Preguntando de a una, quien
       * confirma la primera pasa la segunda sin haberla leído (ver
       * server/una-sola-pregunta.js). Y acá se pueden juntar: cambiar el tipo
       * de un certificado y anularlo en el mismo guardado es raro, pero el
       * formulario deja hacer las dos cosas antes de apretar «Guardar».
       *
       * El aviso del TIPO va primero porque es el que destruye: lo del estado
       * se deshace volviendo a cambiarlo, y los datos soltados no vuelven.
       */
      const avisos = [];

      if (seSueltan.length) {
        avisos.push({
          clave: 'certificado_que_cambia_de_tipo',
          texto: avisoDelTipoQueCambia(seSueltan, existing.tipo, dato('tipo'), existing.disposicion || 'Clásica', como),
        });
      }

      if (existing && estadoAhora !== estadoAntes) {
        if (estadoAhora === ANULADO) {
          avisos.push({
            clave: 'certificado_que_se_anula',
            texto: avisoDelCertificadoQueSeAnula(existing),
          });
        } else if (estadoAntes === ANULADO) {
          avisos.push({
            clave: 'certificado_que_vuelve_a_valer',
            texto: avisoDelCertificadoQueVuelveAValer(existing),
          });
        }
      }

      if (avisos.length && !confirmado) {
        return {
          error: require('../una-sola-pregunta').enUnSoloAviso(avisos),
          confirmar: avisos[0].clave,
        };
      }

      if (estadoAhora !== estadoAntes) {
        if (estadoAhora === ANULADO) data.fecha_anulacion = require('../fechas').hoy();
        else if (estadoAntes === ANULADO) data.fecha_anulacion = null;
      }

      // La ciudad se congela al emitir: si mañana la iglesia se muda, los
      // certificados entregados siguen diciendo dónde se entregaron
      if (!limpio('ciudad')) {
        const iglesia = db.prepare('SELECT ciudad FROM iglesias WHERE id = ?').get(dato('iglesia_id'));
        data.ciudad = (iglesia && iglesia.ciudad) || null;
      }
      return null;
    },

    /**
     * Borrar un certificado se pregunta (ver `avisoDelCertificadoQueSeBorra`).
     *
     * NO SE PROHÍBE, y es a propósito: un certificado mal emitido —el tipo
     * equivocado, la iglesia equivocada, uno creado dos veces por apretar dos
     * veces— hay que poder borrarlo, y prohibirlo dejaría el libro lleno de
     * fichas que nadie puede sacar. Lo que hacía falta es que quien borra vea
     * qué se lleva y sepa que existe la otra operación.
     */
    beforeDelete(fila, { confirmado }) {
      if (confirmado) return null;
      return { error: avisoDelCertificadoQueSeBorra(fila), confirmar: 'certificado_que_se_borra' };
    },
  },

  extraRoutes(router, { requirePerm }) {
    /**
     * Qué número le toca al próximo certificado de esta iglesia.
     *
     * ES UNA PROPUESTA. Se escribía entero a mano, y eso tiene los mismos dos
     * problemas que tenía en las actas: hay que ir a mirar cuál fue el último,
     * y basta una distracción para repetir uno. En un certificado pesa más:
     * se firma, se sella y se entrega, y dos con el mismo número son dos
     * papeles en circulación que dicen ser el mismo.
     *
     * El campo se deja escribir igual, siempre: hay certificados que vienen
     * numerados de antes, y libros que empiezan en otro número.
     */
    router.get('/certificados/proximo-numero', requirePerm('certificados', 'create'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.json({ numero: null });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      res.json({
        numero: require('../numeracion').proximoNumero('certificados', iglesiaId, req.query.fecha_emision),
      });
    });
  },
};
