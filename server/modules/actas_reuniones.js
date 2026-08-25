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
    { name: 'numero_acta', label: 'Número de acta', type: 'text', required: true, help: 'Ej. 001-2026', seccion: 'Identificación' },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
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
};
