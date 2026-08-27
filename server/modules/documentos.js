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
 * EL NÚMERO ES UNA PROPUESTA. El sistema propone el que sigue y se puede
 * cambiar: hay libros que vienen de antes y correspondencia que llegó con su
 * número puesto.
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

const ES_RECIBIDO = { field: 'flujo', equals: 'Recibido' };
const ES_EMITIDO = { field: 'flujo', equals: 'Emitido' };

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
  display: '{numero} — {titulo}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['numero', 'titulo', 'descripcion', 'etiquetas', 'remitente', 'destinatario', 'referencia'],
  listFields: ['numero', 'flujo', 'fecha_registro', 'titulo', 'tipo', 'de_o_para', 'estado', 'iglesia_id', 'archivo'],
  filterFields: ['flujo', 'tipo', 'estado'],
  defaultSort: { field: 'fecha_registro', dir: 'desc' },

  computed: [
    {
      /*
       * Una sola columna para «de quién» o «para quién»: en un listado que
       * mezcla entradas y salidas, dos columnas quedarían medio vacías cada
       * una, y lo que uno busca es siempre la contraparte.
       */
      name: 'de_o_para', label: 'De / Para', type: 'texto',
      calc: (fila) => (fila.flujo === 'Emitido' ? fila.destinatario : fila.remitente) || '',
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
      // Lo interno no lleva correlativo: ofrecer la caja invitaría a poner uno
      // que el sistema después descarta, sin decir por qué
      showIf: { field: 'flujo', in: ['Recibido', 'Emitido'] },
      help: 'Lo propone el sistema al elegir la iglesia y el flujo, y se puede cambiar. No puede repetirse ' +
        'dentro de la misma iglesia. Cambiar el prefijo en Configuración empieza una serie nueva: del libro ' +
        'se cuentan solo los números que siguen el formato de hoy.',
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
      name: 'folios', label: 'Folios', type: 'number', seccion: 'El documento',
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
      help: 'El documento recibido que este contesta. Es lo que después permite seguir el hilo completo.',
    },
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo (si aplica)', type: 'ref', ref: 'cuerpos', seccion: 'El trámite' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea', seccion: 'El trámite' },
  ],

  hooks: {
    beforeSave(data, { existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const flujo = String(dato('flujo') || 'Recibido');

      /*
       * Lo que no entró ni salió por la oficina no lleva correlativo: un
       * número de oficina de partes puesto a una escritura dice que esa
       * escritura entró un día, y no entró.
       */
      if (flujo === 'Interno o de archivo') data.numero = null;

      // La fecha de registro, si no se puso: el día del documento, o hoy
      if (flujo !== 'Interno o de archivo' && !dato('fecha_registro')) {
        data.fecha_registro = dato('fecha') || new Date().toISOString().slice(0, 10);
      }

      // Un documento no puede responderse a sí mismo
      const responde = Number(dato('responde_a')) || 0;
      if (responde && existing && Number(existing.id) === responde) {
        return 'Un documento no puede ser la respuesta de sí mismo.';
      }
      if (flujo !== 'Emitido') data.responde_a = null;

      // Lo que solo aplica al otro flujo no se queda escrito de antes
      if (flujo !== 'Recibido') {
        data.remitente = null;
        data.recibido_por = null;
        data.derivado_a = null;
        data.plazo = null;
      }
      if (flujo !== 'Emitido') {
        data.destinatario = null;
        data.firmado_por = null;
      }

      const folios = dato('folios');
      if (folios !== null && folios !== undefined && folios !== '') {
        const n = Number(folios);
        data.folios = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      }
      return null;
    },

    beforeDelete(fila, { db }) {
      const respuestas = db
        .prepare('SELECT COUNT(*) AS c FROM documentos WHERE responde_a = ?')
        .get(fila.id).c;
      if (respuestas) {
        return (
          `Este documento es al que responden ${respuestas.toLocaleString('es-CL')} documento(s) emitido(s), ` +
          'y borrarlo dejaría esas respuestas sin decir a qué contestan. Márquelo como «Archivado».'
        );
      }
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
  },
};

module.exports.FLUJOS = FLUJOS;
module.exports.TIPOS = TIPOS;
