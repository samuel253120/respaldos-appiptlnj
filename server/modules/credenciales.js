/**
 * Módulo: Credenciales pastorales.
 *
 * La credencial es el documento de identidad ministerial de un pastor, una
 * pastora o un guía de obra: la firma el Pastor Presidente, se imprime, se
 * plastifica y se lleva encima. De ahí salen casi todas las reglas de este
 * archivo, que a primera vista parecen exageradas para una tarjeta:
 *
 *   · LOS DATOS NO SE ESCRIBEN, SE TOMAN. Nombres, apellidos, RUT, grado,
 *     función, iglesia, categoría y comuna salen del registro de la persona y
 *     del de su iglesia. Escribirlos de nuevo a mano sería pedir que un día no
 *     coincidan.
 *
 *   · Y AL EMITIR SE CONGELAN. La credencial guarda una copia de lo que salió
 *     impreso. Si mañana la persona cambia de iglesia o sube de grado, el papel
 *     que anda en su bolsillo sigue diciendo lo que decía: la ficha cambia, la
 *     credencial emitida no. Para reflejar el cambio se emite una nueva.
 *
 *   · EL NÚMERO LO PONE EL SISTEMA. No se escribe ni se corrige en ninguna
 *     pantalla (ver server/credenciales/serie.js).
 *
 *   · EL ESTADO NO SE GUARDA COMPLETO. «Por vencer» y «Vencida» se calculan de
 *     las fechas cada vez que se miran. Guardarlos obligaría a un proceso
 *     nocturno que los pusiera al día, y el día que ese proceso fallara la
 *     credencial diría «vigente» estando vencida.
 *
 * El diseño impreso está en public/credencial.css y public/app.js; el original
 * aprobado, en docs/credencial-pastor.html.
 */
const serie = require('../credenciales/serie');

/** Con cuánta anticipación se avisa que una credencial está por vencer. */
const DIAS_POR_VENCER = 60;

const hoyISO = () => new Date().toISOString().slice(0, 10);

/**
 * En qué está realmente una credencial.
 *
 * Lo guardado manda cuando es una decisión de alguien —un borrador, una
 * revocación, un reemplazo—; las fechas mandan cuando es el calendario el que
 * decide.
 */
function situacionDe(fila) {
  const guardado = fila.estado || 'Borrador';
  if (guardado !== 'Vigente') return guardado;
  const hoy = hoyISO();
  const vence = fila.fecha_vencimiento;
  if (!vence) return 'Vigente'; // sin vencimiento no caduca sola
  if (vence < hoy) return 'Vencida';
  const faltan = Math.round((new Date(vence) - new Date(hoy)) / 86400000);
  return faltan <= DIAS_POR_VENCER ? 'Por vencer' : 'Vigente';
}

module.exports = {
  name: 'credenciales',
  label: 'Credenciales',
  labelSingular: 'Credencial',
  genero: 'f', // «una credencial»: la regla por la terminación no lo acierta
  icon: '🪪',
  group: 'Documentación',
  order: 44,
  display: '{serie_completa} — {snap_apellidos} {snap_nombres}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['serie', 'snap_nombres', 'snap_apellidos', 'snap_rut'],
  listFields: ['serie_completa', 'snap_apellidos', 'snap_nombres', 'snap_grado', 'iglesia_id', 'fecha_vencimiento', 'situacion'],
  filterFields: ['estado', 'iglesia_id'],
  defaultSort: { field: 'id', dir: 'desc' },

  computed: [
    {
      name: 'serie_completa', label: 'N.º de serie', type: 'text',
      calc: (r) => serie.conDigito(r.serie, r.serie_dv),
    },
    {
      name: 'situacion', label: 'Situación', type: 'badge',
      calc: (r) => situacionDe(r),
    },
  ],

  fields: [
    /* ---------------- lo que pone el sistema ---------------- */
    {
      name: 'serie', label: 'N.º de serie', type: 'text', readonly: true, unique: true,
      seccion: 'Identificación de la credencial',
      help: 'Lo asigna el sistema al emitirla y no se puede escribir ni corregir. Corre de forma continua: no se reinicia con el año y ningún número se reutiliza.',
    },
    { name: 'serie_dv', label: 'Dígito verificador', type: 'text', readonly: true, oculto: true },
    { name: 'correlativo', label: 'Correlativo', type: 'number', readonly: true, oculto: true },

    /* ---------------- de quién es ---------------- */
    {
      name: 'pastor_id', label: 'Pastor, pastora o guía de obra', type: 'ref', ref: 'pastores', required: true,
      seccion: 'Titular',
      help: 'De su ficha salen la fotografía, el grado, la función, el RUT y la iglesia. Si algo está mal, se corrige allá y se emite de nuevo.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true, readonly: true,
      help: 'Se toma de la ficha del titular.',
    },

    /* ---------------- la copia congelada de lo impreso ---------------- */
    {
      name: 'snap_nombres', label: 'Nombres', type: 'text', readonly: true,
      seccion: 'Lo que dice el papel',
      help: 'Lo que salió impreso. Queda congelado al emitir: si la ficha cambia, esta credencial sigue diciendo lo mismo.',
    },
    { name: 'snap_apellidos', label: 'Apellidos', type: 'text', readonly: true },
    { name: 'snap_rut', label: 'RUT', type: 'text', readonly: true },
    { name: 'snap_grado', label: 'Grado ministerial', type: 'text', readonly: true },
    { name: 'snap_funcion', label: 'Cargo o función', type: 'text', readonly: true },
    { name: 'snap_categoria', label: 'Categoría de la iglesia', type: 'text', readonly: true },
    { name: 'snap_iglesia', label: 'Nombre de la iglesia', type: 'text', readonly: true },
    { name: 'snap_comuna', label: 'Comuna', type: 'text', readonly: true },
    { name: 'snap_foto', label: 'Fotografía usada', type: 'file', accept: 'image/*', readonly: true, oculto: true },

    /* ---------------- vigencia ---------------- */
    {
      name: 'fecha_emision', label: 'Fecha de entrega', type: 'date', required: true,
      seccion: 'Vigencia',
    },
    {
      name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', required: true,
      futuro: true, noAntesDe: 'fecha_emision',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Borrador',
      options: ['Borrador', 'Vigente', 'Revocada', 'Reemplazada'],
      help: '«Por vencer» y «Vencida» no se ponen a mano: los calcula el sistema a partir de la fecha de vencimiento.',
    },
    {
      name: 'motivo_revocacion', label: 'Motivo de la revocación', type: 'textarea',
      showIf: { field: 'estado', equals: 'Revocada' },
      help: 'Obligatorio al revocar. Queda en el registro de cambios: pérdida, robo, cese del cargo.',
    },
    {
      name: 'reemplaza_a', label: 'Reemplaza a la credencial', type: 'ref', ref: 'credenciales',
      readonly: true, oculto: true,
    },

    /* ---------------- encuadre de la fotografía ---------------- */
    // Se guardan para que al reimprimir salga idéntica a la primera vez.
    { name: 'foto_zoom', label: 'Acercamiento de la foto', type: 'number', oculto: true, default: 1 },
    { name: 'foto_x', label: 'Posición horizontal', type: 'number', oculto: true, default: 50 },
    { name: 'foto_y', label: 'Posición vertical', type: 'number', oculto: true, default: 50 },
    { name: 'foto_brillo', label: 'Brillo', type: 'number', oculto: true, default: 100 },
    { name: 'foto_contraste', label: 'Contraste', type: 'number', oculto: true, default: 100 },

    { name: 'notas', label: 'Notas internas', type: 'textarea', seccion: 'Notas' },
  ],

  situacionDe,
  DIAS_POR_VENCER,
};
