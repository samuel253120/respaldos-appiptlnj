/**
 * Módulo: Documentos — la oficina de partes de la institución.
 *
 * Todo lo que entra y todo lo que sale queda anotado acá, con su número
 * correlativo, en el orden en que pasó por la oficina. Es el libro que
 * responde tres preguntas que después nadie puede contestar de memoria:
 * ¿llegó?, ¿cuándo?, ¿qué se hizo con eso?
 *
 * TRES FLUJOS, DOS LIBROS.
 *
 *   Recibido            Lo que llega de afuera. Se numera «REC-001-2026».
 *   Emitido             Lo que la iglesia manda. Se numera «EMI-001-2026».
 *   Interno o de archivo  Lo que no entró ni salió por la oficina: una
 *                       escritura, un contrato, un documento legal que
 *                       simplemente se guarda. No lleva correlativo, porque
 *                       numerarlo mezclaría el archivo con el libro.
 *
 * Los dos correlativos corren POR IGLESIA y se reinician cada año: cada
 * iglesia lleva su propia oficina, igual que lleva su propio libro de actas de
 * asamblea. Y son dos libros y no uno porque así funciona una oficina de
 * partes: mezclar entrada y salida haría imposible decir «el oficio 45 que
 * enviamos».
 *
 * DOS FECHAS, QUE NO SON LA MISMA. La del documento es la que trae escrita
 * quien lo firmó; la de registro es cuándo pasó por la oficina. Una carta
 * fechada el 3 puede llegar el 11, y para un plazo lo que cuenta es el 11.
 *
 * EL NÚMERO ES UNA PROPUESTA, Y NO ES OPCIONAL. El sistema propone el que
 * sigue y se puede cambiar —hay libros que vienen de antes y correspondencia
 * que llegó con su número puesto—, pero en los dos libros que numeran no se
 * puede dejar en blanco: una anotación sin número no se puede citar ni se
 * puede echar de menos, que es lo único para lo que sirve un correlativo. Lo
 * interno queda fuera de la exigencia porque queda fuera de la numeración.
 */

/** Cómo pasó el documento por la oficina. */
const FLUJOS = ['Recibido', 'Emitido', 'Interno o de archivo'];

/** Qué clase de documento es. */
const TIPOS = [
  'Oficio', 'Carta', 'Memorándum', 'Circular', 'Solicitud', 'Informe',
  'Resolución', 'Invitación', 'Convenio o contrato', 'Escritura / Propiedad',
  'Legal', 'Financiero', 'Administrativo', 'Constancia', 'Otro',
];

/** Por dónde llegó o por dónde se mandó. */
const MEDIOS = ['En mano', 'Correo postal', 'Correo electrónico', 'WhatsApp', 'Otro'];

/** En qué va el trámite. */
const ESTADOS = ['Ingresado', 'Derivado', 'En trámite', 'Respondido', 'Despachado', 'Archivado'];

/** Los tres en que el asunto sigue abierto. Los otros tres dicen que terminó. */
const ABIERTOS_DEL_TRAMITE = ESTADOS.slice(0, 3);

/** El estado que se ofrece cuando un documento ya tiene su respuesta despachada. */
const RESPONDIDO = ESTADOS[3];

/**
 * QUÉ CAMPO ES DE QUÉ FLUJO.
 *
 * Un documento cambia de flujo y lo que era del anterior deja de tener sentido:
 * un número de oficina de partes puesto a una escritura afirma que esa
 * escritura entró un día, y un plazo para responder en algo que nadie mandó no
 * es un plazo de nadie. Por eso se limpia, y la regla es correcta.
 *
 * Estaba escrita en tres «if» sueltos dentro del gancho de guardado, que es lo
 * que la hacía invisible: el servidor contestaba 200 y vaciaba cinco campos sin
 * decir una palabra. Acá arriba se lee de una vez, y de esta misma tabla salen
 * las dos cosas —lo que se limpia y lo que se avisa— para que no puedan decir
 * cosas distintas.
 */
const LO_QUE_ES_DE_CADA_FLUJO = {
  Recibido: ['numero', 'remitente', 'recibido_por', 'derivado_a', 'plazo'],
  Emitido: ['numero', 'destinatario', 'firmado_por', 'responde_a'],
  'Interno o de archivo': ['contraparte'],
};

/** Los campos que este flujo NO usa, y que por lo tanto se limpian. */
function loQueNoEsDeEsteFlujo(flujo) {
  const suyos = new Set(LO_QUE_ES_DE_CADA_FLUJO[flujo] || []);
  const todos = new Set(Object.values(LO_QUE_ES_DE_CADA_FLUJO).flat());
  return [...todos].filter((c) => !suyos.has(c));
}

const { comoSeLee } = require('../fechas');
const { enLista } = require('../formato');

const ES_RECIBIDO = { field: 'flujo', equals: 'Recibido' };
const ES_EMITIDO = { field: 'flujo', equals: 'Emitido' };


/**
 * LOS HUECOS DEL LIBRO.
 *
 * Un correlativo sirve para una sola cosa: para que se note si falta algo. Un
 * libro que enumera 001, 002 y 005 y cierra diciendo «constan 3 documentos»
 * está afirmando que están todos, y no lo están.
 *
 * NO SE IMPIDEN LOS HUECOS, y es una decisión: un libro que viene de papel
 * empieza legítimamente en el 47, anular un número es una operación real de
 * oficina, y el módulo deja escribir el número a mano justamente por eso. Lo
 * que corresponde es que la hoja los DECLARE: un hueco explicado deja de
 * parecerse a uno escondido.
 *
 * Se cuentan POR SERIE Y POR AÑO, que es como corre un correlativo: lo que
 * entra y lo que sale llevan libros distintos, y el 001 vuelve a empezar cada
 * enero. Y solo entre el primero y el último anotados: que el libro empiece en
 * el 47 no es un hueco, es dónde empieza.
 *
 * Los números escritos a mano que no siguen el formato no estorban —ni cuentan
 * ni abren hueco—, igual que en la propuesta del número siguiente.
 */
function losHuecosDelLibro(filas) {
  const { partirNumero, prefijoDe } = require('../numeracion');
  const prefijos = {
    Recibido: prefijoDe('documentos_recibidos'),
    Emitido: prefijoDe('documentos_emitidos'),
  };

  const series = new Map();
  let sinNumero = 0;
  for (const f of filas) {
    if (!prefijos[f.flujo]) continue; // lo interno no lleva correlativo
    const escrito = String(f.numero || '').trim();
    if (!escrito) { sinNumero++; continue; }
    const partes = partirNumero(escrito, prefijos[f.flujo]);
    if (!partes) continue; // numerado a su manera: no cuenta ni estorba
    const clave = `${f.flujo}|${partes.anio}`;
    if (!series.has(clave)) series.set(clave, { flujo: f.flujo, anio: partes.anio, numeros: new Set() });
    series.get(clave).numeros.add(partes.n);
  }

  const faltan = [];
  for (const { flujo, anio, numeros } of series.values()) {
    const puestos = [...numeros].sort((a, b) => a - b);
    const desde = puestos[0];
    const hasta = puestos[puestos.length - 1];
    const perdidos = [];
    for (let n = desde; n <= hasta; n++) if (!numeros.has(n)) perdidos.push(n);
    if (perdidos.length) {
      faltan.push({
        flujo,
        anio,
        desde: `${prefijos[flujo]}${String(desde).padStart(3, '0')}-${anio}`,
        hasta: `${prefijos[flujo]}${String(hasta).padStart(3, '0')}-${anio}`,
        cuantos: perdidos.length,
        // Los primeros, para poder nombrarlos: una lista de cuarenta números no
        // se lee, y lo que hace falta saber es cuáles hay que ir a buscar.
        numeros: perdidos.slice(0, 12).map((n) => `${prefijos[flujo]}${String(n).padStart(3, '0')}-${anio}`),
      });
    }
  }
  faltan.sort((a, b) => (a.flujo === b.flujo ? a.anio.localeCompare(b.anio) : a.flujo.localeCompare(b.flujo)));
  return { faltan, sinNumero };
}

/**
 * El libro armado: las anotaciones en su orden y la cuenta del cierre.
 *
 * Está aparte de la ruta para poder probarlo suelto. Un libro que numere mal,
 * que ordene mal o que deje algo fuera no se nota mirándolo: se nota el día
 * que hay que probar con él que un documento entró, y ese día ya no se puede
 * arreglar.
 *
 * SIEMPRE DE UNA IGLESIA. Un libro que mezclara la matriz con las sedes
 * tendría dos veces el número 001 en la misma página, y no sería el libro de
 * nadie.
 */
function armarElLibro(db, { iglesiaId, anio, flujo }) {
  const anioPedido = String(anio || '').trim();
  const cual = String(flujo || '').trim();

  const condiciones = ['d.iglesia_id = ?'];
  const params = [Number(iglesiaId)];

  if (FLUJOS.includes(cual)) {
    condiciones.push('d.flujo = ?');
    params.push(cual);
  } else {
    // El libro son las entradas y las salidas: lo de archivo no pasó por la
    // oficina y no lleva número, así que no forma parte del correlativo
    condiciones.push("d.flujo IN ('Recibido', 'Emitido')");
  }

  if (/^\d{4}$/.test(anioPedido)) {
    /*
     * Por la fecha de REGISTRO, no por la del documento: es la que dice cuándo
     * pasó por la oficina y la que ordena el libro. Una carta fechada en
     * diciembre que llegó en enero pertenece al libro de enero, y buscarla en
     * el del año anterior no la encontraría.
     */
    condiciones.push("strftime('%Y', COALESCE(d.fecha_registro, d.fecha)) = ?");
    params.push(anioPedido);
  }

  const filas = db
    .prepare(
      `SELECT d.id, d.numero, d.flujo, d.fecha, d.fecha_registro, d.tipo, d.titulo,
              d.remitente, d.destinatario, d.referencia, d.folios, d.estado, d.medio,
              c.nombre AS cuerpo
         FROM documentos d
         LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY COALESCE(d.fecha_registro, d.fecha), d.id`
    )
    .all(...params);

  const iglesia = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(Number(iglesiaId));
  const cuenta = (f) => filas.filter((x) => x.flujo === f).length;

  /** Los años que este libro tiene escritos, para poder elegir sin adivinar. */
  const anios = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', COALESCE(fecha_registro, fecha)) AS anio
         FROM documentos
        WHERE iglesia_id = ? AND COALESCE(fecha_registro, fecha) IS NOT NULL
        ORDER BY anio DESC`
    )
    .all(Number(iglesiaId))
    .map((f) => f.anio)
    .filter(Boolean);

  const libro = {
    iglesia: iglesia ? iglesia.nombre : '',
    anio: /^\d{4}$/.test(anioPedido) ? anioPedido : null,
    flujo: FLUJOS.includes(cual) ? cual : null,
    anios,
    filas,
    resumen: {
      total: filas.length,
      recibidos: cuenta('Recibido'),
      emitidos: cuenta('Emitido'),
      // Los de archivo se cuentan aparte porque el cierre tiene que poder
      // contar LO QUE LA HOJA MUESTRA: pidiendo solo el archivo interno decía
      // «constan 2 documento(s): 0 recibido(s) y 0 emitido(s)», las dos cosas
      // en la misma línea y debajo las dos firmas.
      internos: cuenta('Interno o de archivo'),
      folios: filas.reduce((n, f) => n + (Number(f.folios) || 0), 0),
      huecos: losHuecosDelLibro(filas),
    },
  };

  /*
   * Y CÓMO SE DICE, que viaja con el libro y no lo escribe cada hoja.
   *
   * El cierre y la declaración de lo que falta son la parte que AFIRMA algo, y
   * hay dos maneras de sacar el libro del sistema: la vista de impresión y el
   * PDF. Las dos tienen que decir exactamente lo mismo, así que las palabras se
   * escriben una sola vez (ver server/libro-en-palabras.js).
   */
  libro.enPalabras = require('../libro-en-palabras').enPalabras(libro);
  return libro;
}

/**
 * Lo que se le dice a alguien antes de borrar un documento.
 *
 * Se nombra el documento, de quién venía, qué trae adentro y —lo propio de
 * este módulo— QUÉ LE PASA AL LIBRO. Un acta que se borra deja un libro sin
 * ella; un documento numerado deja además un hueco en un correlativo, que es
 * lo único que un libro de partes tiene para demostrar que no falta nada.
 *
 * Lo interno no abre hueco, porque no lleva número, y eso también se dice: si
 * no, la advertencia diría lo mismo para las dos cosas y dejaría de informar.
 */
function avisoDelDocumentoQueSeBorra(fila, db) {
  const cual = fila.numero ? `el documento n.º ${fila.numero}` : 'un documento sin número';
  const cuando = fila.fecha_registro ? ` registrado el ${comoSeLee(fila.fecha_registro)}` : '';

  // De quién venía o a quién iba: en un oficio es la mitad del dato
  const contraparte = fila.flujo === 'Emitido' ? fila.destinatario : fila.remitente;
  const conQuien = contraparte
    ? `, ${fila.flujo === 'Emitido' ? 'dirigido a' : 'de'} ${contraparte}`
    : '';

  // Y qué trae adentro: no es lo mismo una ficha en blanco que un oficio
  // escrito, con su referencia, sus folios y el papel escaneado
  const trae = [];
  if (fila.referencia) trae.push(`su n.º de origen (${fila.referencia})`);
  if (fila.folios) trae.push(`${fila.folios} folio(s)`);
  if (fila.descripcion) trae.push('la descripción');
  if (fila.observaciones) trae.push('las observaciones');
  if (fila.archivo) trae.push('el documento escaneado');
  const conQue = trae.length ? ` Trae ${enLista(trae)}.` : ' No tiene nada escrito ni adjunto.';

  const elArchivo = fila.archivo ? ' El escaneo se borra del servidor junto con él.' : '';

  /*
   * Y el trámite abierto, que es lo que hace pensar dos veces: un documento
   * que todavía debe respuesta —y con más razón si tiene plazo— no es un
   * registro mal anotado que convenga borrar.
   */
  const abierto = ABIERTOS_DEL_TRAMITE.includes(String(fila.estado || ''))
    ? ` Está «${fila.estado}»${fila.plazo ? `, con plazo para responder el ${comoSeLee(fila.plazo)}` : ''}.`
    : '';

  /*
   * Lo del hueco va al final y en su propia frase, porque es lo único que esta
   * pregunta sabe y el «¿está seguro?» del navegador no.
   */
  const elLibro = fila.numero
    ? ` El libro queda con un hueco en el correlativo: si el documento existió, «Archivado» lo`
      + ' conserva sin sacarlo del libro.'
    : ' No lleva correlativo, así que el libro no queda con ningún hueco.';

  return `Va a eliminar ${cual}${cuando}${conQuien}.${conQue}${elArchivo}${abierto}`
    + ` Lo que decía queda copiado en el Registro de Cambios.${elLibro}`;
}

/**
 * Lo que se le dice a alguien antes de vaciarle campos por cambiar el flujo.
 *
 * Solo se nombra lo que DE VERDAD tiene algo escrito: avisar de cinco campos
 * cuando cuatro están vacíos convierte la pregunta en un trámite, y una
 * pregunta que sale siempre se aprieta sin leer.
 */
function avisoDelFlujoQueCambia(campos, deQue, aQue) {
  // Los rótulos salen de la propia declaración de más abajo —se lee al
  // preguntar, no al arrancar— para que un campo que se renombre no deje este
  // aviso hablando de otra cosa.
  const nombres = campos.map((c) => {
    const f = (module.exports.fields || []).find((x) => x.name === c);
    return `«${f ? f.label : c}»`;
  });
  const uno = campos.length === 1;
  return `Va a pasar este documento de «${deQue}» a «${aQue}», y eso vacía ${enLista(nombres)}:`
    + ` ${uno ? 'ese dato es' : 'esos datos son'} del flujo anterior`
    + ` y no ${uno ? 'tiene' : 'tienen'} dónde ir en el nuevo.`
    + (campos.includes('numero')
      ? ' El número se libera y el libro vuelve a ofrecerlo, así que la anotación desaparece del correlativo.'
      : '');
}

/**
 * Mandar un PDF para que se baje, con su nombre puesto.
 *
 * El nombre va DOS VECES a propósito: la primera la entiende cualquier
 * navegador, la segunda lleva las tildes y las eñes sin romperse. Y sin caché:
 * el libro cambia cada vez que se anota algo, y un archivo guardado por el
 * navegador diría que constan cuatro documentos cuando ya hay cinco.
 */
function mandarElPdf(res, comoSeLlama, armar) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${comoSeLlama.replace(/[^\x20-\x7E]/g, '_')}"; `
    + `filename*=UTF-8''${encodeURIComponent(comoSeLlama)}`
  );
  res.setHeader('Cache-Control', 'private, no-store');
  return armar().pipe(res);
}

/**
 * EL DOCUMENTO QUE CAMBIA DE OFICINA.
 *
 * Cada congregación lleva su propia oficina de partes y su propio correlativo,
 * igual que lleva su propio libro de actas de asamblea. Por eso cambiarle la
 * iglesia a un documento no es corregir un campo: es sacar una anotación de un
 * libro y meterla en otro.
 *
 * Medido en la v1.288.0: un PUT con la otra iglesia contestaba 200 y sin una
 * palabra. El alcance sí funcionaba —quien está acotado a una congregación no
 * puede hacerlo, y contesta 403—, así que esto es para quien alcanza las dos,
 * que es justamente quien puede mover un documento sin darse cuenta.
 *
 * DETECTARLO es lo que se comparte con el libro de asambleas: la mudanza es la
 * misma y está en server/cambio-de-iglesia.js. La frase no —ahí está dicho por
 * qué—, y acá hay además algo que un acta no tiene: el libro de destino recibe
 * una anotación de algo que no pasó por esa ventanilla.
 *
 * Lo que este aviso NO dice es que el número pueda estar tomado allá. Eso el
 * motor lo revisa antes que este gancho y rechaza el traslado nombrando la
 * iglesia, así que preguntar por algo que después no va a poder ocurrir sería
 * peor que rechazarlo.
 */
function loDeLaIglesiaQueCambia(mudanza, existing) {
  const cual = existing.numero ? ` n.º ${existing.numero}` : '';
  const elLibro = existing.numero
    ? `El número se va con él: en el libro de ${mudanza.deDonde} queda el hueco, y en el de `
      + `${mudanza.aDonde} entra una anotación de algo que no pasó por esa ventanilla. `
    : 'No lleva correlativo, así que ningún libro queda con un hueco. ';

  return `El documento${cual} está anotado en la oficina de partes de ${mudanza.deDonde} y va a `
    + `pasar a la de ${mudanza.aDonde}. ${elLibro}`
    + 'Cambia también quién puede verlo: pasa a estar entre lo de esa otra congregación.';
}

/**
 * EL HILO NO CRUZA DOS OFICINAS.
 *
 * Un documento emitido puede decir a qué documento recibido contesta, y eso es
 * lo que después permite seguir el hilo completo. Medido en la v1.288.0: un
 * emitido de la Iglesia Central podía responder a un recibido de la Iglesia
 * Norte, y quedaba enlazado con un 201.
 *
 * La regla es simple y no admite un «guardar igual»: son la misma oficina o no
 * son el mismo hilo. Un libro de partes que enlaza hacia otro libro no puede
 * decir, leyéndolo, qué se hizo con lo que le llegó.
 *
 * DOS COSAS QUE YA ESTABAN Y NO SE REPITEN ACÁ: que el documento exista lo
 * revisa el motor —referencias rotas— antes que este gancho, y que esté dentro
 * del alcance de quien guarda, también. Por eso la medición dio 201 y no otra
 * cosa: el administrador alcanza las dos congregaciones.
 *
 * De ahí que acá no se compruebe que el otro documento exista: cuando este
 * gancho corre, ya está comprobado. Se escribió primero con un «por las dudas»
 * y se sacó al romperlo a propósito —no había manera de llegar con la mano
 * vacía, y una rama que no se puede alcanzar tampoco se puede probar—. La
 * garantía quedó escrita como prueba, que es donde se nota si algún día deja
 * de valer.
 */
function loDeLaRespuestaQueCruza(otro, iglesiaId, db) {
  const suyo = (id) => {
    const f = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id);
    return f ? f.nombre : `la iglesia n.º ${id}`;
  };
  const cual = otro.numero ? `«${otro.numero}»` : `«${otro.titulo || `documento n.º ${otro.id}`}»`;

  if (Number(otro.iglesia_id) !== Number(iglesiaId)) {
    return `${cual} está anotado en la oficina de partes de ${suyo(otro.iglesia_id)}, y este `
      + `documento se está anotando en la de ${suyo(iglesiaId)}. Una respuesta y lo que responde `
      + 'son de la misma oficina: el hilo se sigue dentro de un libro, no entre dos. Elija un '
      + 'documento recibido de esta misma iglesia.';
  }
  if (String(otro.flujo) !== 'Recibido') {
    return `${cual} no es un documento recibido: está anotado como «${otro.flujo}». Lo que se `
      + 'contesta es lo que llegó por la ventanilla, y eso es lo único que esta casilla ofrece.';
  }
  return null;
}

/**
 * Y el mismo hilo, roto por el otro lado: mudando el documento en vez del enlace.
 *
 * Sin esto la regla de arriba se saltaría sola. Se anota la respuesta como
 * corresponde —las dos de la misma iglesia—, y después se le cambia la iglesia
 * a una de las dos: el enlace queda cruzando dos oficinas, que es exactamente
 * lo que no se pudo hacer de frente.
 *
 * Es una NEGATIVA y no una pregunta, por lo mismo que negarse a borrar un
 * documento que otros contestan: no hay un «sí, igual» que lo deje bien. Y
 * tiene salida, que se dice: quitar el enlace, mover, y volver a enlazar con
 * el que corresponda allá.
 */
function loDelHiloQueSeQuedaAtras(existing, respondeA, mudanza, db) {
  if (respondeA) {
    const otro = db.prepare('SELECT numero, titulo FROM documentos WHERE id = ?').get(respondeA);
    const cual = otro && otro.numero ? `«${otro.numero}»` : 'otro documento';
    return `Este documento contesta a ${cual}, que se queda en la oficina de partes de `
      + `${mudanza.deDonde}. Una respuesta y lo que responde son de la misma oficina, así que `
      + `para llevarlo a ${mudanza.aDonde} hay que quitarle antes el enlace «Responde al `
      + 'documento», y volver a enlazarlo allá con el que corresponda.';
  }

  const respuestas = db
    .prepare('SELECT id, numero FROM documentos WHERE responde_a = ?')
    .all(existing.id);
  if (respuestas.length) {
    const cuales = enLista(respuestas.map((r) => (r.numero ? `«${r.numero}»` : `n.º ${r.id}`)));
    return `A este documento le responden ${cuales}, que se quedan en la oficina de partes de `
      + `${mudanza.deDonde}. Llevarlo a ${mudanza.aDonde} dejaría esas respuestas apuntando a `
      + 'otro libro. Quíteles antes el enlace «Responde al documento».';
  }
  return null;
}

module.exports = {
  name: 'documentos',
  label: 'Oficina de Partes',
  labelSingular: 'Documento',
  icon: '🗂️',
  group: 'Documentación',
  order: 62,
  ayudaPermiso:
    'El libro de lo que entra y lo que sale de la institución. Cada documento recibido o emitido ' +
    'lleva su correlativo, y borrar uno deja un hueco en el libro: para eso está el estado «Archivado».',
  /*
   * El libro completo, para leerlo de corrido y para imprimirlo. La ficha
   * sirve para trabajar un documento; el libro, para mostrarlos todos.
   */
  pantallaExtra: { ruta: '#/documentos/libro', label: '📖 Ver el libro' },
  display: '{numero} — {titulo}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['numero', 'titulo', 'descripcion', 'etiquetas', 'remitente', 'destinatario',
    'contraparte', 'referencia'],
  listFields: ['numero', 'flujo', 'fecha_registro', 'titulo', 'tipo', 'de_o_para', 'estado', 'iglesia_id', 'archivo'],
  filterFields: ['flujo', 'tipo', 'estado'],
  defaultSort: { field: 'fecha_registro', dir: 'desc' },

  /*
   * Lo que se conserva de un documento cuando su ficha desaparece.
   *
   * La constancia de una eliminación se arma con los campos del LISTADO, que
   * es una lista pensada para caber en columnas. Medido en la v1.285.0 sobre
   * una denuncia de la Superintendencia con cuarenta folios: quedaban SIETE
   * datos de cabecera —el número, el flujo, la fecha de registro, la materia,
   * el tipo, el estado y la iglesia— y ni el remitente, ni la referencia con
   * que venía, ni los folios, ni la descripción, ni el escaneo.
   *
   * De un oficio, lo que hay que poder demostrar después es QUIÉN LO MANDÓ,
   * CON QUÉ NÚMERO y QUÉ DECÍA. Nada de eso quedaba.
   *
   * El `archivo` va en la lista aunque ya esté en el listado: los adjuntos no
   * entran solos en la constancia —el nombre de un archivo no dice nada en una
   * tabla—, pero cuando el archivo se borró junto con la ficha, su nombre es lo
   * único que queda de él.
   */
  camposAlBorrar: ['fecha', 'referencia', 'folios', 'remitente', 'destinatario', 'contraparte', 'medio',
    'recibido_por', 'firmado_por', 'descripcion', 'etiquetas', 'observaciones',
    'derivado_a', 'plazo', 'responde_a', 'cuerpo_id', 'archivo'],

  computed: [
    {
      /*
       * Una sola columna para «de quién» o «para quién»: en un listado que
       * mezcla entradas y salidas, dos columnas quedarían medio vacías cada
       * una, y lo que uno busca es siempre la contraparte.
       */
      name: 'de_o_para', label: 'De / Para', type: 'texto',
      calc: (fila) => (fila.flujo === 'Emitido' ? fila.destinatario
        : fila.flujo === 'Interno o de archivo' ? fila.contraparte
          : fila.remitente) || '',
    },
  ],

  fields: [
    /* ── El registro ────────────────────────────────────────────── */
    {
      name: 'flujo', label: 'Cómo pasó por la oficina', type: 'select', required: true,
      default: 'Recibido', options: FLUJOS, seccion: 'El registro',
      help: 'Recibido y Emitido llevan correlativo, cada uno en su libro. «Interno o de archivo» es lo que ' +
        'solo se guarda —una escritura, un contrato— y no lleva número.',
    },
    {
      name: 'numero', label: 'N.º de la oficina de partes', type: 'text', unique: 'iglesia_id',
      seccion: 'El registro',
      /*
       * OBLIGATORIO, PERO SOLO EN LOS DOS LIBROS QUE NUMERAN.
       *
       * Un libro de partes es un correlativo: es lo único que permite decir,
       * dos años después, que un documento entró tal día y que no falta
       * ninguno entre medio. Sin número, una anotación no se puede citar ni se
       * puede echar de menos. Los otros tres libros que este sistema numera
       * —las actas de reunión, las de asamblea y los certificados— lo exigen
       * desde siempre; este, que es el que existe PARA ser un correlativo, no
       * lo exigía: se guardaba con la casilla en blanco y el libro lo imprimía
       * con un guion, debajo de un cierre que decía «constan 5 documento(s)».
       *
       * El «solo en los dos libros» no hace falta escribirlo: lo interno no
       * lleva correlativo, su casilla no se muestra, y el motor no exige un
       * campo cuyo `showIf` no aplica —ni el navegador tampoco, que le quita el
       * obligatorio a lo que esconde—. Así que basta con las dos palabras de
       * abajo y la condición que ya estaba.
       *
       * Sigue siendo UNA PROPUESTA: el sistema ofrece el que sigue y se puede
       * escribir otro. Lo que ya no se puede es dejarlo vacío.
       */
      required: true,
      // Lo interno no lleva correlativo: ofrecer la caja invitaría a poner uno
      // que el sistema después descarta, sin decir por qué
      showIf: { field: 'flujo', in: ['Recibido', 'Emitido'] },
      help: 'Lo propone el sistema al elegir la iglesia y el flujo, y se puede cambiar, pero no dejar en ' +
        'blanco: el libro es un correlativo. No puede repetirse dentro de la misma iglesia. Cambiar el ' +
        'prefijo en Configuración empieza una serie nueva: del libro se cuentan solo los números que ' +
        'siguen el formato de hoy.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia que lo registra', type: 'ref', ref: 'iglesias', required: true,
      seccion: 'El registro',
      help: 'Cada iglesia lleva su propia oficina de partes, con su propio correlativo.',
    },
    {
      name: 'fecha_registro', label: 'Fecha de registro', type: 'date', seccion: 'El registro',
      help: 'Cuándo pasó por la oficina: cuándo se recibió o cuándo se despachó. Para un plazo, esta es la ' +
        'que cuenta.',
    },
    {
      name: 'estado', label: 'Estado del trámite', type: 'select', default: 'Ingresado',
      options: ESTADOS, seccion: 'El registro',
    },

    /* ── El documento ───────────────────────────────────────────── */
    { name: 'titulo', label: 'Materia / Asunto', type: 'text', required: true, seccion: 'El documento' },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', default: 'Carta',
      options: TIPOS, seccion: 'El documento',
    },
    {
      name: 'fecha', label: 'Fecha del documento', type: 'date', seccion: 'El documento',
      help: 'La que trae escrita quien lo firmó. Puede ser anterior a la de registro: una carta fechada el 3 ' +
        'puede llegar el 11.',
    },
    {
      name: 'referencia', label: 'N.º con que viene el documento', type: 'text', seccion: 'El documento',
      help: 'El número que le puso quien lo envía —«Oficio N.º 123/2026»—, para poder citarlo al responder. ' +
        'No es el de nuestra oficina.',
    },
    {
      /*
       * FOLIOS: hojas contadas, y por eso enteras y al menos una.
       *
       * Medido en la v1.289.0: «−8» entraba con 201 y quedaba en blanco, «2,7»
       * se guardaba como 3, y «ocho» desaparecía sin una palabra. Los tres
       * salían del mismo lado: el dato se arreglaba en silencio en vez de
       * decirse. Y el cierre del libro suma esta columna, así que un descarte
       * callado deja la suma corta sin que nadie se entere.
       *
       * El informe proponía un mínimo de CERO, por analogía con los asistentes
       * de una asamblea. Acá es UNO, y la diferencia importa: que a una
       * asamblea no llegara nadie es un dato verdadero, pero un documento de
       * cero hojas no es un documento. Con cero, el aviso del motor sería «no
       * puede ser negativo» y un 0 entraría a sumar nada al libro.
       */
      name: 'folios', label: 'Folios', type: 'number', seccion: 'El documento',
      min: 1, entero: true,
      help: 'Cuántas hojas se recibieron o se despacharon, contando anexos.',
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea', seccion: 'El documento' },
    { name: 'archivo', label: 'Documento digitalizado', type: 'file', seccion: 'El documento' },
    {
      name: 'etiquetas', label: 'Etiquetas', type: 'text', seccion: 'El documento',
      help: 'Palabras clave separadas por coma, para dar con él después.',
    },

    /* ── Quién lo manda / a quién va ────────────────────────────── */
    {
      name: 'remitente', label: 'Remitente', type: 'text', seccion: 'Quién lo manda / a quién va',
      showIf: ES_RECIBIDO, help: 'La institución o la persona que lo envía.',
    },
    {
      name: 'destinatario', label: 'Destinatario', type: 'text', seccion: 'Quién lo manda / a quién va',
      showIf: ES_EMITIDO, help: 'La institución o la persona a quien va dirigido.',
    },
    {
      /*
       * CON QUIÉN ES un documento que no entró ni salió por la oficina.
       *
       * «Interno o de archivo» es, según este mismo módulo, donde van «una
       * escritura, un contrato, un documento legal que simplemente se guarda»,
       * y a un contrato se le pregunta con quién se firmó. No tenía dónde
       * decirlo: el remitente solo se muestra en lo recibido y el destinatario
       * solo en lo emitido, así que un contrato de arriendo quedaba guardado
       * sin la otra parte —y lo que se mandara por la API se borraba—.
       *
       * Es un campo propio y no el remitente con otro nombre: a un contrato no
       * lo «envía» nadie. Y va por dentro del mismo bloque, porque contesta la
       * misma pregunta que los otros dos, solo que para el tercer flujo.
       */
      name: 'contraparte', label: 'Con quién es', type: 'text',
      seccion: 'Quién lo manda / a quién va',
      showIf: { field: 'flujo', equals: 'Interno o de archivo' },
      help: 'La otra parte: con quién se firmó el contrato, de quién es la escritura, ante quién se '
        + 'constituyó. Lo que se guarda sin haber entrado ni salido igual es de alguien.',
    },
    {
      name: 'medio', label: 'Por dónde', type: 'select', options: MEDIOS,
      seccion: 'Quién lo manda / a quién va',
    },
    {
      name: 'recibido_por', label: 'Quién lo recibió', type: 'persona', ref: 'miembros',
      seccion: 'Quién lo manda / a quién va', showIf: ES_RECIBIDO,
    },
    {
      name: 'firmado_por', label: 'Quién lo firma', type: 'persona', ref: 'miembros',
      seccion: 'Quién lo manda / a quién va', showIf: ES_EMITIDO,
    },

    /* ── El trámite ─────────────────────────────────────────────── */
    {
      name: 'derivado_a', label: 'Derivado a', type: 'persona', ref: 'miembros', seccion: 'El trámite',
      showIf: ES_RECIBIDO, help: 'A quién se le pasó para que lo vea o lo responda.',
    },
    {
      name: 'plazo', label: 'Plazo para responder', type: 'date', futuro: true, seccion: 'El trámite',
      showIf: ES_RECIBIDO,
    },
    {
      name: 'responde_a', label: 'Responde al documento', type: 'ref', ref: 'documentos',
      seccion: 'El trámite', showIf: ES_EMITIDO,
      /*
       * La lista ofrece SOLO lo recibido por esta misma oficina. Hasta la
       * v1.288.0 ofrecía cualquier documento del sistema —de cualquier iglesia
       * y de cualquier flujo—, y el servidor lo aceptaba: un emitido de la
       * Central quedaba contestando un recibido de la Norte.
       *
       * El «además» es el enlace que esta ficha YA TENÍA. Sin él, abrir un
       * documento cuyo enlace apunta a algo que la lista ya no ofrece —quedó de
       * antes de esta regla, o el otro documento pasó a archivo— lo mostraría
       * en blanco y lo perdería al guardar. Es el mismo arreglo que la 1.232.0
       * le hizo a las iglesias inactivas.
       */
      optionsRoute: '/documentos/para-responder?iglesia_id={iglesia_id}&ademas={responde_a}',
      help: 'El documento recibido que este contesta, de esta misma oficina de partes. '
        + 'Es lo que después permite seguir el hilo completo.',
    },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos', seccion: 'El trámite' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea', seccion: 'El trámite' },
  ],

  hooks: {
    beforeSave(data, { existing, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const flujo = String(dato('flujo') || 'Recibido');

      // La fecha de registro, si no se puso: el día del documento, o hoy
      if (flujo !== 'Interno o de archivo' && !dato('fecha_registro')) {
        data.fecha_registro = dato('fecha') || require('../fechas').hoy();
      }

      /*
       * ── LO QUE NO SE PREGUNTA, SE NIEGA ──
       *
       * Primero las negativas del hilo de la respuesta, que no tienen un
       * «guardar igual» que las arregle. Van antes que las preguntas a
       * propósito: preguntar «¿está seguro?» por un guardado que después se va
       * a rechazar igual es hacer contestar dos veces para lo mismo.
       *
       * `quedaRespondiendo` es el enlace COMO QUEDA, no el que llega: si este
       * mismo guardado cambia el flujo, el enlace se vacía unas líneas más
       * abajo —no es del flujo nuevo— y no hay nada que revisar de él.
       */
      const seLimpian = loQueNoEsDeEsteFlujo(flujo);
      const quedaRespondiendo = seLimpian.includes('responde_a') ? 0 : Number(dato('responde_a')) || 0;

      // Un documento no puede responderse a sí mismo
      if (quedaRespondiendo && existing && Number(existing.id) === quedaRespondiendo) {
        return 'Un documento no puede ser la respuesta de sí mismo.';
      }

      /*
       * Y no puede responder a uno de otra oficina, ni a algo que no llegó por
       * la ventanilla. Se revisa SOLO CUANDO EL ENLACE CAMBIA, que es la misma
       * regla que usan los desplegables y las fechas del motor: se frena el
       * guardado que empeora las cosas, no el que simplemente no arregla algo
       * que ya estaba. Sin esto, corregirle el teléfono a un documento viejo
       * mal enlazado sería imposible, y el enlace no es lo que se está tocando.
       */
      const enlaceDeAntes = Number((existing && existing.responde_a) || 0);
      if (quedaRespondiendo && quedaRespondiendo !== enlaceDeAntes) {
        const otro = db
          .prepare('SELECT id, numero, titulo, flujo, iglesia_id FROM documentos WHERE id = ?')
          .get(quedaRespondiendo);
        const iglesiaId = dato('iglesia_id');
        if (otro && iglesiaId) {
          const reparo = loDeLaRespuestaQueCruza(otro, iglesiaId, db);
          if (reparo) return reparo;
        }
      }

      /*
       * La mudanza de iglesia, que se mira una sola vez y sirve para las dos
       * cosas: para negarse cuando arrastraría un enlace, y para preguntar
       * cuando no.
       */
      const mudanza = require('../cambio-de-iglesia').laMudanza(data, existing, db);
      if (mudanza) {
        const roto = loDelHiloQueSeQuedaAtras(existing, quedaRespondiendo, mudanza, db);
        if (roto) return roto;
      }

      /*
       * Lo que es del otro flujo se limpia, y ANTES SE AVISA.
       *
       * Medido en la v1.286.0: se mandaba una sola cosa —el flujo— y volvían
       * cinco campos en nulo, con un 200 y sin una palabra. Ahora se pregunta,
       * y se nombra solo lo que de verdad tenía algo escrito: una pregunta que
       * sale siempre se aprieta sin leer.
       *
       * Solo al CAMBIAR de flujo. Al crear no hay nada que perder, y guardar un
       * documento sin tocarle el flujo no puede preguntar nada: sería el aviso
       * que sale en cada guardado, que es la manera más segura de que deje de
       * leerse.
       */
      const cambiaDeFlujo = existing && String(existing.flujo || '') !== flujo;
      if (!confirmado) {
        /*
         * Las dos preguntas de este guardado salen JUNTAS, numeradas y en un
         * solo aviso. La marca de «guardar igual» es una para toda la
         * petición: preguntando de a una, quien contesta la primera pasaría la
         * segunda sin haberla leído (ver server/una-sola-pregunta.js). Un
         * documento que cambia de flujo Y de iglesia en el mismo guardado es
         * raro, pero es de las dos que se pueden perder de vista.
         */
        const avisos = [];

        if (cambiaDeFlujo) {
          const conAlgo = seLimpian.filter((c) => {
            const v = dato(c);
            return v !== null && v !== undefined && v !== '';
          });
          if (conAlgo.length) {
            avisos.push({
              clave: 'documento_que_cambia_de_flujo',
              texto: avisoDelFlujoQueCambia(conAlgo, existing.flujo, flujo),
            });
          }
        }

        if (mudanza) {
          avisos.push({
            clave: 'documento_que_cambia_de_iglesia',
            texto: loDeLaIglesiaQueCambia(mudanza, existing),
          });
        }

        if (avisos.length) {
          return {
            error: require('../una-sola-pregunta').enUnSoloAviso(avisos),
            confirmar: avisos[0].clave,
          };
        }
      }
      for (const campo of seLimpian) {
        data[campo] = null;
        /*
         * Y el enlace del campo de persona, que va aparte. Sin esto quedaba a
         * medias: «Derivado a» en blanco y `derivado_a_id` apuntando todavía a
         * alguien, así que la ficha mostraba el nombre —lo rehace el motor
         * desde el enlace— mientras la base decía que no había nadie.
         */
        if (`${campo}_id` in (existing || {}) || data[`${campo}_id`] !== undefined) {
          data[`${campo}_id`] = null;
        }
      }

      /*
       * Acá estaba el arreglo callado de los folios: lo que no fuera un número
       * mayor que cero se guardaba como nulo, y lo demás se redondeaba. Desde
       * la v1.290.0 no hace falta —el campo declara su mínimo y que es entero,
       * y el motor lo dice en vez de arreglarlo—, que es donde tiene que estar
       * para que valga igual por la planilla y por el formulario.
       */
      return null;
    },

    beforeDelete(fila, { db, confirmado }) {
      /*
       * Primero la negativa, que no se pregunta: si este documento es el que
       * otros contestan, borrarlo dejaría esas respuestas sin decir a qué
       * responden. Eso no lo arregla un «sí, igual».
       */
      const respuestas = db
        .prepare('SELECT COUNT(*) AS c FROM documentos WHERE responde_a = ?')
        .get(fila.id).c;
      if (respuestas) {
        return (
          `Este documento es al que responden ${respuestas.toLocaleString('es-CL')} documento(s) emitido(s), ` +
          'y borrarlo dejaría esas respuestas sin decir a qué contestan. Márquelo como «Archivado».'
        );
      }

      /*
       * Y después la pregunta. Medido en la v1.285.0: una denuncia de la
       * Superintendencia con cuarenta folios, su escaneo y su descripción se
       * borraba con un 200 y sin una palabra del servidor. La única barrera era
       * el «¿Eliminar este registro?» del navegador, el mismo que sale al
       * borrar un tipo de actividad.
       *
       * Este módulo YA SABÍA que esto importaba: su propia ayuda de permisos
       * dice, con estas palabras, que «borrar uno deja un hueco en el libro:
       * para eso está el estado Archivado». Lo decía en la pantalla de
       * permisos, donde lo lee quien reparte llaves, y no en el momento de
       * borrar, que es donde hace falta.
       */
      if (!confirmado) return { error: avisoDelDocumentoQueSeBorra(fila, db), confirmar: 'documento_que_se_borra' };
      return null;
    },
  },

  extraRoutes(router, { requirePerm }) {
    /**
     * Qué número le toca al próximo documento de este libro.
     *
     * Se pide el flujo además de la iglesia porque son DOS libros: lo que
     * entra y lo que sale se numeran por separado.
     */
    router.get('/documentos/proximo-numero', requirePerm('documentos', 'create'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      const flujo = String(req.query.flujo || '');
      if (!iglesiaId || !flujo || flujo === 'Interno o de archivo') return res.json({ numero: null });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      const serie = flujo === 'Emitido' ? 'documentos_emitidos' : 'documentos_recibidos';
      res.json({
        numero: require('../numeracion').proximoNumero(serie, iglesiaId, req.query.fecha_registro),
      });
    });

    /**
     * EL LIBRO, COMO ARCHIVO QUE SE BAJA.
     *
     * Medido en la v1.290.0: la vista de impresión salía bien —membrete,
     * cierre y firmas—, y las dos rutas de PDF contestaban 404. Un libro de
     * partes es lo que se manda por correo a un auditor o a un abogado, y para
     * eso había que imprimir a PDF desde el navegador, que agrega la cabecera y
     * el pie que ese navegador quiera y depende del aparato de cada uno.
     *
     * Pide lo mismo que la hoja de la pantalla —la iglesia, y que esté entre
     * las suyas— MÁS el permiso de imprimir: esto es sacar el libro del
     * sistema, que es otra cosa que mirarlo. Es la misma regla que las dos
     * clases de acta.
     */
    router.get('/documentos/libro/pdf', requirePerm('documentos', 'view'), (req, res, next) => {
      if (!require('../permissions').can(req.user, 'datos_impresion', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para imprimir ni descargar documentos.' });
      }
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.status(400).json({ error: 'Indique de qué iglesia es el libro' });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      try {
        const libro = armarElLibro(require('../db').db, {
          iglesiaId, anio: req.query.anio, flujo: req.query.flujo,
        });
        const pdf = require('../pdf/oficina-de-partes');
        mandarElPdf(res, pdf.nombreDelLibro(libro), () =>
          pdf.generarLibro(libro, { quien: req.user && req.user.nombre }));
      } catch (e) {
        next(e);
      }
    });

    /**
     * Y UN DOCUMENTO SUELTO, con lo que la tabla del libro no puede llevar: la
     * descripción entera, las observaciones y el hilo de la respuesta.
     *
     * Es la hoja que se adjunta a un correo cuando alguien pregunta por un
     * oficio en particular. La ruta tiene que ir ANTES que la del hilo por el
     * orden en que express prueba las rutas, y el `(\d+)` está para que
     * «/documentos/libro» no se lea como un documento llamado «libro».
     */
    router.get('/documentos/:id(\\d+)/pdf', requirePerm('documentos', 'view'), (req, res, next) => {
      if (!require('../permissions').can(req.user, 'datos_impresion', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para imprimir ni descargar documentos.' });
      }
      const fila = require('../alcance')
        .registroSuyo(req, res, 'documentos', Number(req.params.id), 'Ese documento');
      if (!fila) return undefined;
      try {
        const pdf = require('../pdf/oficina-de-partes');
        return mandarElPdf(res, pdf.nombreDelDocumento(fila), () =>
          pdf.generarDocumento(fila, { quien: req.user && req.user.nombre }));
      } catch (e) {
        return next(e);
      }
    });

    /**
     * EL HILO DE ESTE DOCUMENTO: a qué contesta, y quién lo contesta.
     *
     * De acá sale lo que la ficha ofrece. Medido en la v1.289.0: se registraba
     * la respuesta a un oficio, quedaba enlazada con un 201, y el oficio seguía
     * diciendo «Ingresado». Los seis estados incluyen «Respondido», que está
     * ahí para este momento exacto, y no lo ponía nadie.
     *
     * SE OFRECE, NO SE HACE. El estado es de quien lleva el trámite: hay
     * respuestas parciales —se contesta lo que se puede y el asunto sigue
     * abierto—, y un sistema que cierre el trámite solo porque se despachó una
     * carta estaría afirmando algo que no le consta. Es lo mismo que hace el
     * módulo de Solicitudes al aprobar una: ofrece el paso siguiente con lo
     * que ya sabe, y lo da quien corresponde.
     */
    router.get('/documentos/:id/el-hilo', requirePerm('documentos', 'view'), (req, res) => {
      const db = require('../db').db;
      const fila = require('../alcance')
        .registroSuyo(req, res, 'documentos', Number(req.params.id), 'Ese documento');
      if (!fila) return undefined; // registroSuyo ya contestó 404 o 403

      const columnas = 'id, numero, titulo, flujo, estado, fecha_registro';
      const contesta = fila.responde_a
        ? db.prepare(`SELECT ${columnas} FROM documentos WHERE id = ?`).get(fila.responde_a)
        : null;
      const loContestan = db
        .prepare(`SELECT ${columnas} FROM documentos WHERE responde_a = ? ORDER BY COALESCE(fecha_registro, fecha), id`)
        .all(fila.id);

      res.json({
        estado: fila.estado,
        abierto: ABIERTOS_DEL_TRAMITE.includes(String(fila.estado || '')),
        contesta: contesta
          ? { ...contesta, abierto: ABIERTOS_DEL_TRAMITE.includes(String(contesta.estado || '')) }
          : null,
        loContestan,
        // Qué estado propone la ficha, para que la pantalla no lo invente.
        seMarcaComo: RESPONDIDO,
      });
    });

    /**
     * QUÉ SE PUEDE CONTESTAR: lo recibido por ESTA oficina, y nada más.
     *
     * Un documento emitido contesta a uno recibido, y los dos son del mismo
     * libro. La lista de la que se elige tiene que decir eso mismo: hasta la
     * v1.288.0 el selector pedía `/documentos/options`, que trae los mil
     * últimos documentos de todas las iglesias que alcance quien mira, y de
     * los tres flujos.
     *
     * `ademas` es el enlace que la ficha ya tenía, para no perderlo al abrirla
     * (ver el campo). Va DENTRO del alcance y no fuera: así este «además»
     * tampoco sirve para leer el número de un documento que no le toca a quien
     * pregunta.
     */
    router.get('/documentos/para-responder', requirePerm('documentos', 'view'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      const ademas = Number(req.query.ademas) || 0;
      if (!iglesiaId) return res.json([]);
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }

      const db = require('../db').db;
      const params = [];
      const suyo = require('../alcance').condiciones(module.exports, req.user, params);
      params.push(iglesiaId);
      if (ademas) params.push(ademas);
      const cond = [
        ...(suyo ? [suyo] : []),
        `((iglesia_id = ? AND flujo = 'Recibido')${ademas ? ' OR id = ?' : ''})`,
      ];

      const filas = db
        .prepare(`SELECT id, numero, titulo, fecha_registro, remitente FROM documentos
                  WHERE ${cond.join(' AND ')}
                  ORDER BY COALESCE(fecha_registro, fecha) DESC, id DESC LIMIT 400`)
        .all(...params);

      res.json(filas.map((d) => ({
        id: d.id,
        // Como se cita y como se busca: primero el número, que es lo que uno
        // tiene a mano —«contesto el oficio 45»—, y después de qué se trataba.
        label: `${d.numero || 's/n'} · ${d.titulo || 'Sin título'}`
          + (d.remitente ? ` (de ${d.remitente})` : ''),
        buscar: [d.numero, d.titulo, d.remitente, d.fecha_registro].filter(Boolean).join(' '),
      })));
    });

    /**
     * El libro, para leerlo entero o imprimirlo.
     *
     * Un libro de partes se lleva POR IGLESIA: por eso la iglesia es
     * obligatoria y no hay un «todas». Un libro que mezclara la matriz con las
     * sedes tendría dos veces el número 001 en la misma página y no sería el
     * libro de nadie.
     *
     * El orden es el del libro: por fecha de registro, y a igualdad de fecha
     * por el orden en que se registraron. Es el orden en que las cosas
     * pasaron, que es lo que un libro certifica.
     */
    router.get('/documentos/libro', requirePerm('documentos', 'view'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.status(400).json({ error: 'Indique de qué iglesia es el libro' });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      res.json(armarElLibro(require('../db').db, {
        iglesiaId, anio: req.query.anio, flujo: req.query.flujo,
      }));
    });
  },
};

module.exports.FLUJOS = FLUJOS;
module.exports.armarElLibro = armarElLibro;
module.exports.losHuecosDelLibro = losHuecosDelLibro;
module.exports.TIPOS = TIPOS;
