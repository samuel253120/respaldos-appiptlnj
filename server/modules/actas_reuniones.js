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
      help: 'Enlaza la lista que se pasó ese día: quién asistió, quién no y quién se justificó.',
    },
    {
      name: 'asistentes', label: 'Asistentes (escritos a mano)', type: 'multiref', ref: 'miembros',
      help: 'Solo hace falta si no se pasó lista de esa reunión. Si enlazó la asistencia, se usa esa.',
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
