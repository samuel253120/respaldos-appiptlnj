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
const { comoSeLee } = require('../fechas');

/*
 * Lo de la firma y lo que se pierde al borrar un acta son las mismas reglas que
 * en el libro de asambleas, y viven juntas en server/reglas-del-acta.js: son el
 * mismo documento con distinto dueño, y una regla copiada hay que arreglarla
 * dos veces (esa lección la dejó escrita la directiva, más abajo).
 */
const {
  FIRMADA, camposDeLaFirma, loQueCambia, avisoDeActaFirmada, anotarLaFirma,
  enUnSoloAviso, avisoDeActaQueSeBorra, loDelActaVacia, loDeLasHoras,
} = require('../reglas-del-acta');

/**
 * La asistencia enlazada tiene que ser de una reunión a la que ese cuerpo fue.
 *
 * El desplegable ofrece correctamente solo las actividades a las que el cuerpo
 * fue convocado, y la pantalla avisa al elegirla —«X no estaba convocado a esa
 * actividad»—. Pero la regla vivía solo ahí: por la API, un acta del cuerpo 14
 * se guardaba con la asistencia de una actividad que convocó a los cuerpos 10 y
 * 3, y contestaba 201.
 *
 * El daño es acotado y conviene decirlo: como no hay marcas de asistencia de
 * ese cuerpo en esa actividad, el acta impresa no muestra ninguna lista. Queda
 * un enlace que no dice nada y que afirma, en silencio, que el acta se levantó
 * de una reunión a la que el cuerpo no fue.
 *
 * Se pregunta porque hay un caso legítimo: el cuerpo asistió igual y la lista
 * de convocados quedó incompleta. Lo que no puede pasar es que el módulo se dé
 * por bueno un dato que su propia pantalla marca en rojo.
 */
function loDeLaAsistenciaEnlazada(data, existing, db) {
  const deAntes = (campo) => (data[campo] !== undefined ? data[campo] : existing && existing[campo]);
  const asistenciaId = deAntes('asistencia_id');
  const cuerpoId = deAntes('cuerpo_id');
  /*
   * Sin asistencia enlazada no hay nada que comprobar, que es el caso de la
   * mayoría de las actas. El corte es por AHORRARSE LA CONSULTA y no porque
   * abajo fuera a fallar —buscar el id nulo devuelve nada y la línea siguiente
   * ya lo atiende—: se deja dicho porque una rotura a propósito de esta línea no
   * pone roja ninguna prueba, y sin esta nota parece de más y se borra.
   */
  if (!asistenciaId || !cuerpoId) return null;

  // Que la actividad exista ya lo comprobó el motor antes de llegar acá
  // (referenciasRotas); si aun así no está, no hay nada que decir de ella.
  const actividad = db.prepare('SELECT cuerpos, tipo_reunion, fecha FROM asistencias WHERE id = ?').get(asistenciaId);
  if (!actividad) return null;
  const convocados = require('./asistencias').idsDeCuerpos(actividad.cuerpos);
  if (convocados.includes(Number(cuerpoId))) return null;

  const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpoId);
  const cual = [actividad.tipo_reunion, actividad.fecha ? `del ${comoSeLee(actividad.fecha)}` : '']
    .filter(Boolean).join(' ');
  return `La actividad enlazada${cual ? ` (${cual})` : ''} no convocó a `
    + `"${cuerpo ? cuerpo.nombre : 'ese cuerpo'}". De ahí salen los asistentes del acta, así que no `
    + 'va a mostrar ninguna lista. Si el cuerpo asistió igual, confirme; si no, elija la reunión que '
    + 'corresponde.';
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
    // Los declara el compartido, para que los dos libros de actas los lleven
    // iguales (ver server/reglas-del-acta.js, que explica por qué van sin sección)
    ...camposDeLaFirma(),
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
       * TODAS LAS PREGUNTAS DE UN GUARDADO, EN UN SOLO AVISO.
       *
       * La marca de «guardar igual» es UNA por guardado. Preguntando de a una
       * —la primera que aplique, y las demás en el intento siguiente— quien
       * confirma la primera pasaría las otras sin haberlas leído nunca. Así que
       * se juntan todas, ordenadas de la más grave a la menos, y la clave con
       * que la pantalla decide el título es la de la más grave.
       */
      if (!confirmado) {
        const avisos = [];
        if (existing && existing.estado === FIRMADA) {
          const cambia = loQueCambia('actas_reuniones', data, existing);
          if (cambia.length) avisos.push({ clave: 'acta_firmada', texto: avisoDeActaFirmada(existing, data, cambia) });
        }
        const ajena = loDeLaAsistenciaEnlazada(data, existing, db);
        if (ajena) avisos.push({ clave: 'asistencia_de_otra_reunion', texto: ajena });
        const vacia = loDelActaVacia(data, existing);
        if (vacia) avisos.push({ clave: 'acta_sin_nada', texto: vacia });
        const horas = loDeLasHoras(data, existing, 'la reunión');
        if (horas) avisos.push({ clave: 'horas_del_acta', texto: horas });

        if (avisos.length) return { error: enUnSoloAviso(avisos), confirmar: avisos[0].clave };
      }

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

      // De quién es el acta: acá, del cuerpo que la levantó
      const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(fila.cuerpo_id);
      return {
        error: avisoDeActaQueSeBorra(fila, {
          deQuien: cuerpo ? ` de "${cuerpo.nombre}"` : '',
          elLibro: 'el libro de ese cuerpo',
        }),
        confirmar: 'acta_que_se_borra',
      };
    },
  },
};
