/**
 * Módulo: Integrantes de Cuerpos / Grupos.
 *
 * Una ficha por cada persona en cada cuerpo. Guarda desde cuándo pertenece,
 * en qué estado está —en prueba, activa o retirada—, cuándo se le termina el
 * período de prueba y si paga la cuota mensual o está exenta.
 *
 * No aparece en el menú: se maneja desde la ficha del propio cuerpo, que es
 * donde tiene sentido mirarla. La regla de quién pertenece hoy vive en
 * server/integrantes.js, y de ahí la toman la asistencia, las directivas, los
 * oficiales y los permisos.
 */
const {
  ESTADOS, finDelPeriodoDePrueba, fichaDeIntegrante,
} = require('../integrantes');

module.exports = {
  name: 'integrantes_cuerpo',
  label: 'Integrantes de Cuerpos',
  labelSingular: 'Integrante del cuerpo',
  icon: '🧑‍🤝‍🧑',
  group: 'Organización',
  order: 58,
  menu: false,
  display: '{miembro_id} — {cuerpo_id}',
  dateField: 'fecha_ingreso',
  searchFields: ['motivo_retiro', 'exento_motivo', 'observaciones'],
  listFields: ['cuerpo_id', 'miembro_id', 'estado', 'fecha_ingreso', 'fecha_fin_prueba', 'paga_cuota'],
  filterFields: ['cuerpo_id', 'estado'],
  defaultSort: { field: 'fecha_ingreso', dir: 'desc' },

  computed: [
    {
      name: 'paga_cuota', label: 'Cuota', type: 'texto',
      calc: (fila, { db }) => {
        if (fila.exento_cuota) return 'Exento(a)';
        const cuerpo = db.prepare('SELECT cobra_cuota FROM cuerpos WHERE id = ?').get(fila.cuerpo_id);
        return cuerpo && cuerpo.cobra_cuota ? 'Sí' : 'El cuerpo no cobra';
      },
    },
  ],

  fields: [
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', required: true,
      seccion: 'Quién y dónde',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true, buscador: true,
      help: 'Búsquelo por su nombre, su apellido o su RUT.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'En prueba',
      options: ESTADOS,
      help: 'En prueba: recién ingresado. Activo: integrante oficial. Retirado: ya no pertenece.',
    },
    {
      name: 'fecha_ingreso', label: 'Fecha de ingreso', type: 'date', required: true,
      seccion: 'Período de prueba',
      help: 'Desde cuándo pertenece a este cuerpo. Con ella se cuenta el período de prueba.',
    },
    {
      name: 'fecha_fin_prueba', label: 'Termina el período de prueba', type: 'date', readonly: true,
      futuro: true, noAntesDe: 'fecha_ingreso',
      help: 'Se calcula sola con los meses que define el cuerpo. Antes de esa fecha hay que evaluar su informe.',
    },
    {
      name: 'fecha_oficial', label: 'Pasó a integrante oficial el', type: 'date', readonly: true,
      futuro: true, noAntesDe: 'fecha_ingreso',
      showIf: { field: 'estado', equals: 'Activo' },
      help: 'La fecha en que se aprobó su informe. La pone la evaluación.',
    },
    {
      name: 'exento_cuota', label: 'Exento(a) de pagar la cuota mensual', type: 'boolean',
      seccion: 'Cuota mensual',
      help: 'Para quien, por su situación, no paga la cuota aunque el cuerpo la cobre.',
    },
    {
      name: 'exento_motivo', label: 'Motivo de la exención', type: 'text',
      showIf: { field: 'exento_cuota', equals: '1' },
      sugerencias: ['Situación económica', 'Salud', 'Edad', 'Estudiante', 'Acuerdo de la directiva'],
    },
    {
      name: 'fecha_retiro', label: 'Fecha de retiro', type: 'date', noAntesDe: 'fecha_ingreso',
      seccion: 'Retiro', showIf: { field: 'estado', equals: 'Retirado' },
    },
    {
      name: 'motivo_retiro', label: 'Motivo del retiro', type: 'text',
      showIf: { field: 'estado', equals: 'Retirado' },
      sugerencias: ['Renuncia voluntaria', 'Traslado de iglesia', 'Cambio de ciudad', 'Salud', 'Disciplina', 'Fallecimiento'],
    },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea', seccion: 'Notas' },
    // Se toma del cuerpo, para que los permisos por iglesia funcionen igual
    { name: 'iglesia_id', type: 'number', oculto: true, readonly: true },
    /**
     * Esta ficha la puso la regla de la directiva, no una persona.
     *
     * Importa para una sola cosa, y no es menor: la regla solo puede RETIRAR a
     * quien ella misma metió. Un integrante que alguien agregó a mano —el
     * secretario, la tesorera, alguien que la iglesia decidió que estuviera—
     * no se toca aunque no esté en la categoría «Miembro Líder». Sin esta
     * marca la regla los echaba a todos, que es justo lo que pasó.
     */
    { name: 'automatico', type: 'boolean', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing, id, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const cuerpoId = Number(dato('cuerpo_id'));
      const miembroId = Number(dato('miembro_id'));

      // Una persona no puede tener dos fichas en el mismo cuerpo
      const otra = fichaDeIntegrante(db, cuerpoId, miembroId);
      if (otra && Number(otra.id) !== Number(id)) {
        const m = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(miembroId);
        const quien = m ? `${m.nombres} ${m.apellidos}` : 'esa persona';
        return `${quien} ya tiene su ficha en este cuerpo. Ábrala en vez de crear otra.`;
      }

      const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
      data.iglesia_id = cuerpo ? cuerpo.iglesia_id : null;

      // El fin de la prueba se calcula solo, con los meses que define el cuerpo
      data.fecha_fin_prueba = dato('estado') === 'En prueba'
        ? finDelPeriodoDePrueba(db, cuerpoId, dato('fecha_ingreso'))
        : existing ? existing.fecha_fin_prueba : null;

      if (dato('estado') !== 'Retirado') {
        data.fecha_retiro = null;
        data.motivo_retiro = null;
      } else if (!dato('fecha_retiro')) {
        data.fecha_retiro = new Date().toISOString().slice(0, 10);
      }
      if (!dato('exento_cuota')) data.exento_motivo = null;
      return null;
    },

    /**
     * Una pertenencia con cuotas pagadas no se elimina: ese dinero entró de
     * verdad y su registro tiene que quedar. Para eso está el estado
     * "Retirado", que conserva el recorrido completo de la persona.
     */
    beforeDelete(fila, { db }) {
      const cuotas = db.prepare('SELECT COUNT(*) c FROM cuotas_cuerpo WHERE integrante_id = ?').get(fila.id).c;
      if (cuotas) {
        return `No se puede eliminar: tiene ${cuotas} cuota(s) pagada(s) registrada(s). ` +
          'Márquelo como «Retirado» en vez de eliminarlo, y su historial queda intacto.';
      }
      // Las evaluaciones no valen nada sin la ficha que evalúan: se van con ella
      db.prepare('DELETE FROM evaluaciones_integrantes WHERE integrante_id = ?').run(fila.id);
      return null;
    },
  },
};
