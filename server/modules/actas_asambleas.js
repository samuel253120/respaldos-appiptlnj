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
 */
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
  ],

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
};
