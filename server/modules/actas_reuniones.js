/**
 * Módulo: Actas de Reuniones de Cuerpos / Grupos.
 *
 * Un acta se puede registrar de dos maneras, y las dos valen: adjuntando el
 * documento firmado, o escribiéndola acá mismo. Para lo segundo, el desarrollo
 * y los acuerdos son campos de texto con formato —negrita, cursiva, listas y
 * títulos—, que es como se escribe un acta de verdad.
 *
 * Y las dos maneras se juntan: cuando el documento adjunto es un Word o un PDF
 * con texto, el sistema puede TRAER ese texto al campo de formato, para no
 * escribir de nuevo lo que ya está escrito (ver server/transcribir.js y la
 * ruta /transcribir de más abajo).
 *
 * ENLACE CON LA ASISTENCIA. Un acta se levanta de una reunión, y de esa misma
 * reunión suele haberse pasado lista. Eran dos registros que no se hablaban:
 * el acta traía un campo «Asistentes» que había que llenar a mano, eligiendo
 * miembro por miembro, mientras al lado estaba la lista ya tomada, con quién
 * faltó y quién se justificó —que es justamente lo que un acta necesita decir
 * y lo que el campo manual no podía guardar—.
 *
 * Ahora el acta puede enlazar la actividad. Se ofrecen las actividades a las
 * que ese cuerpo fue convocado, aunque hayan convocado también a otros: el
 * coro puede haber cantado en un aniversario junto a cinco cuerpos más, y esa
 * actividad sirve igual para el acta del coro. Lo que se muestra del enlace sí
 * queda acotado a la gente de ESE cuerpo.
 *
 * Se ven y se crean desde la ficha del propio cuerpo, que es donde se buscan.
 */
const { enLista } = require('../formato');
const { hoy, comoSeLee } = require('../fechas');

/** El único estado que significa algo fuera del sistema: hay un papel firmado. */
const FIRMADA = 'Firmada';

/**
 * Qué está cambiando este guardado, con los nombres que se ven en la pantalla.
 *
 * Los campos salen del propio módulo y no de una lista escrita a mano, para que
 * uno que se agregue mañana entre solo: una lista aparte se olvida, y el olvido
 * acá no se nota —se nota como un acta firmada que un día se dejó cambiar sin
 * preguntar—.
 *
 * Quedan fuera dos clases. Los de SOLO LECTURA, porque los escribe el sistema y
 * no la persona: preguntar por ellos sería preguntar por uno mismo. Y los
 * OCULTOS, entre los que está «Asistentes (escritos a mano)», el campo retirado
 * que la pantalla sigue mandando como lista vacía aunque en la base esté en
 * blanco: contarlo habría hecho que TODO guardado de un acta firmada
 * preguntara, incluso uno que no cambia absolutamente nada.
 */
function loQueCambia(data, existing) {
  const def = require('../registry').getModule('actas_reuniones'); // tardío: evita ciclo con el registro
  const cambia = [];
  for (const f of def.fields) {
    if (f.readonly || f.oculto) continue;
    if (!(f.name in data)) continue;
    if (String(existing[f.name] ?? '') === String(data[f.name] ?? '')) continue;
    cambia.push(f.label);
  }
  return cambia;
}

/**
 * El aviso, que tiene que decir tres cosas: que está firmada, quién y cuándo la
 * firmó, y qué es exactamente lo que este guardado va a cambiar. Sin la tercera
 * la pregunta no se puede contestar: «¿está seguro?» a secas no es información.
 */
function avisoDeActaFirmada(existing, data, cambia) {
  const quien = existing.firmada_por ? ` por ${existing.firmada_por}` : '';
  const cuando = existing.fecha_firma ? ` el ${comoSeLee(existing.fecha_firma)}` : '';
  const cual = existing.numero_acta ? ` n.º ${existing.numero_acta}` : '';
  const firmada = `El acta${cual} está firmada${quien}${cuando}.`;

  // Dejar de estar firmada es lo más grave que puede pasarle, así que va
  // adelante y el resto de los cambios queda como añadidura.
  const nuevoEstado = data.estado !== undefined ? data.estado : existing.estado;
  if (nuevoEstado !== FIRMADA) {
    const otros = cambia.filter((c) => c !== 'Estado');
    return `${firmada} Va a dejar de estarlo: pasa a «${nuevoEstado}», y con eso se borra la constancia `
      + `de quién la firmó y cuándo.${otros.length ? ` Además cambia ${enLista(otros)}.` : ''} `
      + 'Si lo que quiere es corregirla, hágalo sin sacarle la firma.';
  }
  return `${firmada} Va a cambiar ${enLista(cambia)}. Desde ahora el papel que se firmó dirá una cosa `
    + 'y el sistema otra, y quien tenga una copia impresa no va a saberlo. El cambio queda anotado en el '
    + 'Registro de Cambios.';
}

/**
 * Una reunión que termina antes de empezar.
 *
 * Los dos campos de hora entraban sin que nadie los mirara: «empieza a las
 * 21:00 y termina a las 19:00» contestaba 201, y la hoja impresa salía diciendo
 * «Hora: 21:00 a 19:00». Es el mismo par que en las directivas se comprueba
 * desde hace tiempo, pero ahí son fechas y acá horas, y nadie las miraba.
 *
 * PREGUNTA, NO RECHAZA, y eso no es por costumbre de la casa: es que una
 * reunión que empieza a las 23:00 y termina a las 00:30 del día siguiente es
 * perfectamente normal —una vigilia, una asamblea larga— y una regla escrita
 * como «término > inicio» la rechazaría siendo correcta. No hay manera de
 * distinguir el error del caso legítimo mirando los datos, así que se pregunta,
 * que es justamente lo que un ser humano sí sabe contestar.
 *
 * Devuelve el texto del aviso, o nulo si no hay nada que decir. No lo devuelve
 * ya envuelto en `{ error, confirmar }` porque puede terminar sumado al aviso
 * del acta firmada: la marca de «guardar igual» es UNA sola por guardado, y
 * dos preguntas separadas dejarían pasar la segunda sin que nadie la lea.
 */
function loDeLasHoras(data, existing) {
  const deAntes = (campo) => (data[campo] !== undefined ? data[campo] : existing && existing[campo]);
  /*
   * En minutos desde la medianoche, y no comparando el texto: la pantalla manda
   * siempre «09:30» y la API no siempre, y comparadas como texto «9:30» sale
   * MAYOR que «21:00» —el 9 va después del 2— así que una reunión de las 21:00
   * a las 9:30 pasaría sin que nadie la mirara.
   */
  const enMinutos = (h) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '').trim());
    if (!m) return null;
    const hora = Number(m[1]);
    const minuto = Number(m[2]);
    if (hora > 23 || minuto > 59) return null;
    return hora * 60 + minuto;
  };
  /** Para decirla en el aviso como se lee en la ficha. */
  const comoSeLee = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  const inicio = enMinutos(deAntes('hora_inicio'));
  const fin = enMinutos(deAntes('hora_fin'));
  /*
   * Con una sola hora anotada no hay nada que comparar, y está bien que así
   * sea: muchas actas dicen a qué hora empezó la reunión y no a qué hora
   * terminó. Se comprueba contra `null` a propósito y no con `!inicio`: las
   * 00:00 son cero minutos, y una reunión que empieza a medianoche existe.
   */
  if (inicio === null || fin === null) return null;

  if (inicio === fin) {
    return `El acta dice que la reunión empezó y terminó a las ${comoSeLee(inicio)}, o sea que no `
      + 'duró nada. Revise las horas.';
  }
  if (fin < inicio) {
    return `El acta dice que la reunión empezó a las ${comoSeLee(inicio)} y terminó a las `
      + `${comoSeLee(fin)}. Si de verdad terminó pasada la medianoche, confirme; si no, corrija las horas.`;
  }
  return null;
}

/**
 * La firma se anota sola, y se borra sola.
 *
 * Solo cuando el estado CAMBIA: así, editar un acta que ya estaba firmada
 * conserva la fecha y el nombre de cuando se firmó de verdad, en vez de
 * correrlos al día de la última corrección.
 */
function anotarLaFirma(data, existing, user) {
  const antes = existing ? existing.estado : null;
  const despues = data.estado !== undefined ? data.estado : antes;
  if (despues === antes) return;
  if (despues === FIRMADA) {
    data.firmada_por = (user && user.nombre) || null;
    data.fecha_firma = hoy();
  } else if (antes === FIRMADA) {
    data.firmada_por = null;
    data.fecha_firma = null;
  }
}

module.exports = {
  name: 'actas_reuniones',
  label: 'Actas de Reuniones',
  labelSingular: 'Acta de Reunión',
  icon: '📝',
  group: 'Documentación',
  order: 60,
  display: 'Acta {numero_acta} — {fecha}',
  dateField: 'fecha',
  printable: true,
  /*
   * Se busca también en el DESARROLLO, que es el campo más largo del acta y el
   * que llena el botón «Transcribir» cuando trae el texto del documento
   * adjunto. Faltaba, y el efecto era el peor posible: se transcribía un acta
   * escaneada de doce párrafos, quedaba entera adentro del sistema, y buscar
   * cualquier palabra de esos doce párrafos no la encontraba. La función que
   * hace valioso al módulo era la que producía contenido invisible.
   *
   * Que sea texto con formato no lo estorba: los acuerdos también lo son y ya
   * estaban en la lista.
   */
  searchFields: ['numero_acta', 'agenda', 'desarrollo', 'acuerdos', 'presidida_por'],
  listFields: ['numero_acta', 'fecha', 'cuerpo_id', 'iglesia_id', 'presidida_por', 'estado'],
  /*
   * Lo que se conserva de un acta que se borra, además de su cabecera.
   *
   * El Registro de Cambios guardaba de una eliminación los campos del LISTADO,
   * que es una lista pensada para que quepa en columnas. Medido sobre un acta
   * firmada que decía «Se aprueba comprar sillas por $9.000.000»: quedaron seis
   * datos de cabecera y ni una palabra de lo acordado. Un libro de actas es
   * justamente el módulo donde lo que hay que conservar es lo que no cabe en
   * una columna.
   *
   * Va también el nombre del documento adjunto: el archivo se borra del disco
   * junto con la ficha (server/crud.js), así que su nombre es lo único que
   * puede quedar de él.
   */
  camposAlBorrar: ['lugar', 'hora_inicio', 'hora_fin', 'secretario',
    'firmada_por', 'fecha_firma', 'agenda', 'desarrollo', 'acuerdos', 'documento'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    {
      name: 'numero_acta', label: 'Número de acta', type: 'text', required: true,
      // Único dentro del cuerpo: cada cuerpo lleva su propio libro, así que el
      // 001 del coro y el 001 de las dorcas son dos actas distintas y las dos
      // válidas. Repetirlo DENTRO de un mismo libro sí es un error.
      unique: 'cuerpo_id',
      help: 'Lo propone el sistema, y se puede cambiar. Ej. 001-2026',
      seccion: 'Identificación',
    },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      /*
       * No lo escribe nadie: sale del cuerpo elegido, en cada guardado. Se
       * muestra —y se sigue pudiendo filtrar por él en el listado— porque de
       * este campo depende QUIÉN VE ESTA ACTA (ver server/alcance.js).
       *
       * Deja de ser obligatorio porque deja de pedirse: lo garantiza el
       * gancho de más abajo, no quien llena el formulario. Un campo de solo
       * lectura llega vacío al guardado, y exigirlo dejaría de entrar toda
       * acta nueva.
       */
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'La de su cuerpo. Si el acta se pasa a un cuerpo de otra iglesia, ésta cambia con él.',
    },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text', seccion: 'Dónde y quiénes' },
    { name: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
    { name: 'hora_fin', label: 'Hora de finalización', type: 'time' },
    { name: 'presidida_por', label: 'Presidida por', type: 'text' },
    { name: 'secretario', label: 'Secretario(a)', type: 'text' },
    {
      name: 'asistencia_id', label: 'Asistencia de la reunión', type: 'ref', ref: 'asistencias',
      // Solo las actividades a las que este cuerpo fue convocado. La ruta se
      // resuelve con el cuerpo que tenga puesto el formulario en ese momento.
      optionsRoute: '/asistencias/de-cuerpo?cuerpo_id={cuerpo_id}',
      help: 'De acá salen los asistentes del acta: quién fue, quién no y quién se justificó.',
    },
    /*
     * Los asistentes escritos a mano: retirado del formulario, conservado en la
     * base.
     *
     * Era un campo donde se elegía miembro por miembro, y ofrecía a TODA la
     * gente de la iglesia, no a la del cuerpo del acta: al levantar un acta de
     * Ciclistas aparecía el listado completo de la congregación. Se comprobó en
     * el sistema andando.
     *
     * Se podría haber acotado la lista al cuerpo, pero el campo sobra: la
     * asistencia enlazada dice lo mismo y más —quién faltó y quién se excusó,
     * con su motivo—, y sale de la lista que alguien ya pasó en vez de pedir
     * que se escriba dos veces. Dos maneras de anotar lo mismo terminan
     * discrepando, y entonces no se sabe cuál vale.
     *
     * `oculto` lo saca del formulario, del listado y de las planillas, pero NO
     * borra la columna ni lo que ya esté guardado: un acta antigua que traiga
     * su lista escrita a mano la conserva y la sigue imprimiendo igual (ver
     * printActa). Se retira de lo que se ofrece, no de lo que se guardó.
     */
    {
      name: 'asistentes', label: 'Asistentes (escritos a mano)', type: 'multiref', ref: 'miembros',
      oculto: true,
    },
    {
      name: 'agenda', label: 'Agenda / Orden del día', type: 'textarea',
      seccion: 'El acta',
      help: 'Los puntos que se trataron. Se puede dejar en blanco si el acta va adjunta.',
    },
    {
      name: 'desarrollo', label: 'Desarrollo de la reunión', type: 'richtext',
      help: 'El acta escrita acá mismo, con formato. Se puede dejar en blanco si va adjunta.',
    },
    { name: 'acuerdos', label: 'Acuerdos y compromisos', type: 'richtext' },
    { name: 'documento', label: 'Documento adjunto (escaneada/firmada)', type: 'file', seccion: 'Documento y estado' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Borrador',
      options: ['Borrador', 'Aprobada', 'Firmada'],
      help: 'Al pasarla a «Firmada» queda anotado quién la firmó y qué día. Después, cambiarle algo pregunta.',
    },
    /*
     * QUIÉN LA FIRMÓ Y CUÁNDO. No los escribe nadie: los pone el sistema en el
     * guardado que lleva el acta a «Firmada», y los borra en el que la saca de
     * ahí. Firmar es un acto con fecha y con responsable, y hasta acá lo único
     * que quedaba de él era una palabra en un desplegable, que cualquiera podía
     * poner y sacar sin dejar más rastro que una línea del Registro de Cambios
     * —donde nadie va a mirar por un acta que se ve normal—.
     *
     * Se borran al dejar de estar firmada, a propósito: un acta en «Borrador»
     * que siguiera diciendo «la firmó Fulana el 25 de agosto» estaría mintiendo,
     * y de las dos mentiras posibles ésa es la peligrosa.
     */
    // Sin `seccion`: van dentro de «Documento y estado», que abrió el adjunto.
    // Repetirla acá no los mete ahí, abre una segunda sección con el mismo
    // título, y la ficha salía con el encabezado dos veces. Se vio en pantalla.
    { name: 'firmada_por', label: 'Firmada por', type: 'text', readonly: true },
    { name: 'fecha_firma', label: 'Fecha de la firma', type: 'date', readonly: true },
  ],

  extraRoutes(router, { db, requirePerm }) {
    /*
     * Quién estuvo en la reunión NO se pide acá sino a la propia actividad
     * (/asistencias/:id/por-cuerpo). Tiene que poder mirarse mientras se elige
     * la actividad en el formulario, o sea ANTES de que el acta exista: una
     * ruta colgada del acta no serviría para lo que más importa, que es ver a
     * quién se está enlazando antes de comprometerse.
     */

    /** El acta pedida, comprobando que sea de las que esa persona alcanza. */
    const actaSuya = (req, res) =>
      require('../alcance').registroSuyo(req, res, 'actas_reuniones', req.params.id, 'Esa acta');

    /**
     * Qué número le toca a la próxima acta de este cuerpo.
     *
     * Es una propuesta para el formulario, no una reserva: dos personas
     * creando un acta a la vez reciben el mismo número, y la segunda se topa
     * al guardar con que ya está usado —para eso está el «unique» del campo—.
     * Reservar números de verdad obligaría a guardar algo antes de que exista
     * el acta, y a limpiar los que nadie llegó a usar; no vale la pena para un
     * libro donde se levantan dos actas al mes.
     */
    router.get('/actas_reuniones/proximo-numero', requirePerm('actas_reuniones', 'create'), (req, res) => {
      const cuerpoId = Number(req.query.cuerpo_id) || 0;
      if (!cuerpoId) return res.json({ numero: null });
      // El cuerpo tiene que ser de los suyos: si no, esta ruta diría cuántas
      // actas lleva un cuerpo ajeno con solo escribir su número.
      const alcance = require('../alcance');
      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.json({ numero: null });
      if (!alcance.alcanza(require('../registry').getModule('cuerpos'), cuerpo, req.user)) {
        return res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
      }
      res.json({ numero: require('../numeracion').proximoNumero('actas_reuniones', cuerpoId, req.query.fecha) });
    });

    /**
     * El acta completa, como PDF que se baja.
     *
     * Pide las dos llaves que corresponden: la del módulo, para ver el acta, y
     * la de imprimir, porque esto ES sacar el documento del sistema —igual que
     * la pantalla de impresión, que ya la exigía—. Y el acta tiene que estar
     * dentro de lo que esa persona alcanza, como cualquier otra consulta.
     */
    router.get('/actas_reuniones/:id(\\d+)/pdf', requirePerm('actas_reuniones', 'view'), (req, res, next) => {
      if (!require('../permissions').can(req.user, 'datos_impresion', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para imprimir ni descargar documentos.' });
      }
      const acta = actaSuya(req, res);
      if (!acta) return;
      try {
        const { generar, nombreDelArchivo } = require('../pdf/acta');
        const archivo = nombreDelArchivo(acta);
        res.setHeader('Content-Type', 'application/pdf');
        // El nombre va dos veces a propósito: la primera la entiende cualquier
        // navegador, la segunda lleva las tildes y las eñes sin romperse.
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${archivo.replace(/[^\x20-\x7E]/g, '_')}"; `
          + `filename*=UTF-8''${encodeURIComponent(archivo)}`
        );
        res.setHeader('Cache-Control', 'private, no-store');
        generar(acta, { quien: req.user && req.user.nombre }).pipe(res);
      } catch (e) {
        next(e);
      }
    });

    /**
     * Trae al campo de formato el texto del documento adjunto.
     *
     * Va como acción aparte y no al guardar, a propósito: reemplaza lo que haya
     * escrito en el desarrollo, y esa es una decisión de quien redacta, no algo
     * que deba pasarle encima sin avisar. Devuelve el texto y NO lo guarda; la
     * pantalla lo pone en el editor y la persona revisa antes de guardar.
     */
    router.post('/actas_reuniones/:id(\\d+)/transcribir', requirePerm('actas_reuniones', 'edit'), async (req, res, next) => {
      const acta = actaSuya(req, res);
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
     * LA IGLESIA SALE DEL CUERPO, SIEMPRE.
     *
     * Eran dos campos que el formulario pedía por separado, como si fueran
     * independientes. No lo son: cada cuerpo pertenece a una iglesia y a una
     * sola, así que la iglesia de un acta no es un dato propio —es la de su
     * cuerpo—. Nadie comprobaba que coincidieran, y se podía guardar el acta
     * de un cuerpo de la Iglesia Central anotada en la Iglesia Norte.
     *
     * Lo que se rompe con eso no es la ficha: es quién la ve. De este campo
     * sale el alcance (server/alcance.js), y el alcance pide las dos cosas
     * —la iglesia Y el cuerpo—. Un acta con el cuerpo correcto y la iglesia
     * de otra congregación no pasa el filtro de nadie: no la ve el líder de
     * su propio cuerpo, porque esa iglesia no es suya, y no la busca quien
     * administra la otra, donde aparece un acta de un cuerpo que allá no
     * existe. Medido antes de esto: de las ocho actas del cuerpo n.º 14 que
     * había en la base, su propio líder veía siete. La octava era la mal
     * anotada, y no avisaba nada.
     *
     * Se deduce en CADA guardado y no solo cuando el campo viene vacío,
     * porque son dos puertas y las dos estaban abiertas. Medido en la
     * v1.270.0: crear un acta mandando una iglesia distinta de la de su
     * cuerpo contestaba 201 y quedaba así; y cambiarle el cuerpo a un acta ya
     * guardada —que es lo que hace el formulario, mandando la ficha entera
     * con el `iglesia_id` que ya traía cargado— contestaba 200 y la dejaba
     * anotada en la iglesia anterior.
     *
     * Es el mismo arreglo que la v1.263.0 le hizo a las directivas, por el
     * mismo motivo y con la misma lección: lo que se copió hay que volver a
     * mirarlo.
     */
    beforeSave(data, { db, user, existing, confirmado }) {
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing && existing.cuerpo_id;
      if (cuerpoId) {
        // El cuerpo ya se comprobó antes de llegar acá: que exista (referenciasRotas)
        // y que sea de los suyos (referenciasFueraDeAlcance). Acá solo se lee.
        const suCuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (suCuerpo) data.iglesia_id = suCuerpo.iglesia_id;
      }

      /*
       * UN ACTA FIRMADA NO SE CAMBIA SIN QUE ALGUIEN LO DIGA.
       *
       * «Firmada» era una palabra que se elegía de una lista, como se elegiría
       * un color, y no significaba nada. Medido en la v1.270.0: un acta nacía
       * Firmada (201), se le cambiaban los acuerdos de $2.000.000 a $9.000.000
       * ya firmada (200), y volvía a Borrador (200), todo sin una pregunta.
       *
       * Un acta firmada es un documento que existe en papel, con las firmas de
       * quien presidió y de quien la redactó. Que el registro diga una cosa y
       * el papel diga otra es el problema entero de llevar un libro de actas
       * digital, y por eso lo que falta no es la huella —el Registro de Cambios
       * ya anota la edición, con el texto del antes y el después— sino la
       * PUERTA: nadie avisaba que se estaba modificando algo ya firmado, y
       * nadie tiene por qué ir a mirar el historial de un acta que se ve normal.
       *
       * Pregunta, no impide: es lo que se decidió y es lo que hace el resto del
       * sistema. Una coma mal puesta en un acta firmada se arregla; lo que no
       * puede pasar es que se arregle sin que quien lo hace sepa qué está
       * tocando. Crear un acta ya firmada tampoco se pregunta: así es como se
       * carga el libro viejo, que está firmado hace años.
       */
      /*
       * Las dos preguntas de un guardado, y por qué van juntas.
       *
       * La marca de «guardar igual» es UNA por guardado: si se preguntara
       * primero por el acta firmada y después por las horas, quien confirma la
       * primera pasaría la segunda sin haberla leído nunca. Así que cuando las
       * dos aplican se dicen en el mismo aviso, y la más grave —tocar un
       * documento ya firmado— va adelante.
       */
      const porLasHoras = confirmado ? null : loDeLasHoras(data, existing);

      if (existing && existing.estado === FIRMADA && !confirmado) {
        const cambia = loQueCambia(data, existing);
        if (cambia.length) {
          const aviso = avisoDeActaFirmada(existing, data, cambia);
          return {
            error: porLasHoras ? `${aviso} Y otra cosa: ${porLasHoras}` : aviso,
            confirmar: 'acta_firmada',
          };
        }
      }
      if (porLasHoras) return { error: porLasHoras, confirmar: 'horas_del_acta' };

      anotarLaFirma(data, existing, user);
      return null;
    },

    /**
     * BORRAR UN ACTA PREGUNTA, Y LA PREGUNTA DICE QUÉ SE VA.
     *
     * Un acta con su agenda escrita, su desarrollo, sus acuerdos y el escaneo
     * firmado adentro se borraba con un 200 y sin una palabra del servidor. La
     * única barrera era el «¿está seguro?» genérico del navegador: el mismo que
     * aparece al borrar una categoría de tesorería vacía. Y una firmada tampoco
     * decía nada.
     *
     * El escaneo se va con ella —eso está bien hecho: un archivo sin ficha es
     * basura en el disco—, pero sumado a lo anterior significaba que un clic de
     * más se llevaba el acta firmada y su escaneo sin decir qué se estaba
     * llevando. Es la misma pieza que la 1.264.0 le puso a las directivas.
     */
    beforeDelete(fila, { db, confirmado }) {
      if (confirmado) return null;

      const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(fila.cuerpo_id);
      const cual = fila.numero_acta ? `el acta n.º ${fila.numero_acta}` : 'un acta sin número';
      const cuando = fila.fecha ? ` del ${comoSeLee(fila.fecha)}` : '';
      const deQuien = cuerpo ? ` de "${cuerpo.nombre}"` : '';

      // En qué estado se va. Una firmada dice además quién la firmó y cuándo,
      // que es el dato que hace pensar dos veces antes de confirmar.
      const firmada = fila.estado === FIRMADA;
      const porQuien = fila.firmada_por ? ` por ${fila.firmada_por}` : '';
      const elDia = fila.fecha_firma ? ` el ${comoSeLee(fila.fecha_firma)}` : '';
      const enQueEstado = firmada
        ? `, que está FIRMADA${porQuien}${elDia}`
        : `, en estado ${fila.estado || 'Borrador'}`;

      // Y qué trae adentro: no es lo mismo una ficha recién creada en blanco
      // que un acta escrita entera con su escaneo.
      const trae = [];
      if (fila.agenda) trae.push('su agenda');
      if (fila.desarrollo) trae.push('el desarrollo escrito');
      if (fila.acuerdos) trae.push('los acuerdos');
      if (fila.documento) trae.push('el documento escaneado');
      const conQue = trae.length
        ? ` Trae ${enLista(trae)}.`
        : ' No tiene nada escrito ni adjunto.';

      const elArchivo = fila.documento
        ? ' El escaneo se borra del servidor junto con ella.'
        : '';

      return {
        /*
         * Lo que se dice al final es DÓNDE cae cada mitad de la pérdida, y no
         * «esto no se puede deshacer»: eso ya lo dijo el navegador en su
         * primer «¿Eliminar este registro?», y repetirlo gasta la única frase
         * que esta pregunta tiene para decir algo que la otra no sabe.
         */
        error: `Va a eliminar ${cual}${cuando}${deQuien}${enQueEstado}.${conQue}${elArchivo}`
          + ' Lo que decía queda copiado en el Registro de Cambios; el libro de ese cuerpo, en'
          + ' cambio, queda sin ella.',
        confirmar: 'acta_que_se_borra',
      };
    },
  },
};
