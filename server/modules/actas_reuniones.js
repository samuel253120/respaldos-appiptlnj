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
  searchFields: ['numero_acta', 'agenda', 'acuerdos', 'presidida_por'],
  listFields: ['numero_acta', 'fecha', 'cuerpo_id', 'iglesia_id', 'presidida_por', 'estado'],
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
    },
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
    beforeSave(data, { db, existing }) {
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing && existing.cuerpo_id;
      if (!cuerpoId) return null;
      // El cuerpo ya se comprobó antes de llegar acá: que exista (referenciasRotas)
      // y que sea de los suyos (referenciasFueraDeAlcance). Acá solo se lee.
      const suCuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (suCuerpo) data.iglesia_id = suCuerpo.iglesia_id;
      return null;
    },
  },
};
