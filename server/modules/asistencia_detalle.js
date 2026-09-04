/**
 * Módulo: Toma de Asistencia (la marca de cada persona en una actividad).
 *
 * Este módulo manda sobre **quién puede pasar lista**: con permiso para crear
 * y editar aquí, una persona puede tomar la asistencia de una actividad
 * aunque no tenga permiso para crear actividades (eso se rige por el módulo
 * Asistencias).
 *
 * Por cada actividad de un cuerpo queda una fila por integrante, con su
 * estado —Presente, Ausente o Justificado— y, cuando está justificado, el
 * motivo. Los motivos de emergencia, de otra actividad de la iglesia y de
 * "otro motivo" piden además el detalle, para que la justificación diga algo.
 *
 * No se llena aquí una por una, sino marcando la lista en la pantalla de
 * Asistencia, así que este módulo no ocupa lugar en el menú: existe para
 * guardar las marcas y para llevar el permiso de tomarlas.
 */
/**
 * Los motivos que piden explicación.
 *
 * Ya no es una lista escrita acá: cada motivo lo dice en su propia ficha
 * (módulo «Motivos de Ausencia»), así que al agregar «Viaje» la iglesia decide
 * si hay que explicarlo o no, sin tocar el programa. La lista de abajo queda
 * como respaldo para el primer arranque, antes de que la tabla exista.
 */
const CON_DETALLE_DE_FABRICA = ['Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];

/** De qué registro sale la persona: miembro inscrito o no. */
const { REGISTROS } = require('../integrantes');

/** Dónde vive la lista de motivos, dicho una sola vez. */
const LA_LISTA_DE_MOTIVOS = { modulo: 'motivos_ausencia', columna: 'nombre', label: 'Motivos de Ausencia' };

/**
 * ¿ESTE motivo pide explicación? Se le pregunta a su FILA, no a una lista de
 * nombres.
 *
 * La comprobación de obligatorios del motor decide si el detalle hace falta
 * mirando `showIf`, que compara el motivo contra una lista de NOMBRES exactos.
 * Y esa comprobación corre ANTES de que el motivo quede escrito como está en la
 * lista, así que bastaba con escribirlo distinto para que no calzara con
 * ninguno y el detalle dejara de exigirse.
 *
 * MEDIDO en la v1.363.0, con el motivo ya comprobado contra la tabla:
 *
 *   «Otro motivo» sin explicación ............ 400 · lo exige
 *   «otro motivo» sin explicación ............ 201 · GUARDADA, detalle en blanco
 *   «OTRO MOTIVO» sin explicación ............ 201 · GUARDADA, detalle en blanco
 *
 * Las tres quedaban con el mismo motivo escrito —el de la lista— y solo la
 * primera con explicación. Preguntándole a la fila, la caja de las letras deja
 * de decidir nada: es la casilla «Pide explicación» de esa fila la que manda.
 */
function pideExplicacion(db, motivo) {
  const fila = require('../opciones').laFilaDeLaLista(db, LA_LISTA_DE_MOTIVOS, motivo);
  if (!fila) return false;
  const suya = db
    .prepare('SELECT pide_detalle FROM motivos_ausencia WHERE nombre = ? LIMIT 1')
    .get(fila.valor);
  return !!(suya && suya.pide_detalle);
}

function motivosQuePidenDetalle() {
  try {
    const { db } = require('../db');
    const filas = db.prepare('SELECT nombre FROM motivos_ausencia WHERE pide_detalle = 1').all();
    // Sin ninguno marcado no se cae de vuelta a la lista vieja: que la iglesia
    // no quiera exigir explicación en ningún motivo es una decisión legítima.
    if (filas) return filas.map((f) => f.nombre);
  } catch (e) {
    /* sin tabla todavía */
  }
  return CON_DETALLE_DE_FABRICA.slice();
}

module.exports = {
  name: 'asistencia_detalle',
  label: 'Toma de Asistencia',
  labelSingular: 'Marca de asistencia',
  icon: '✔️',
  group: 'Reuniones',
  order: 12,
  menu: false,
  display: '{estado}',
  searchFields: ['detalle'],
  listFields: ['asistencia_id', 'persona_tipo', 'miembro_id', 'no_miembro_id', 'estado', 'motivo', 'detalle'],
  filterFields: ['estado', 'motivo', 'cuerpo_id', 'persona_tipo'],
  /*
   * La fecha del módulo. No es una etiqueta: es lo que hace que la base cree
   * su índice sola (ver indexar() en server/db.js).
   *
   * Esta es la tabla que más crece de todo el sistema —una fila por persona y
   * por actividad—, y es sobre la que se arma el informe de asistencia, que
   * pregunta siete veces por un rango de fechas. Sin declararla, no había
   * índice por fecha y acotar el informe no servía de nada: medido con diez
   * años de datos, pedir solo el año en curso costaba 59 ms igual que pedirlo
   * todo, porque la base recorría las 124.812 marcas de todas maneras. Con el
   * índice puesto, ese mismo informe baja a 0,1 ms.
   */
  dateField: 'fecha',
  defaultSort: { field: 'id', dir: 'desc' },
  fields: [
    { name: 'asistencia_id', label: 'Actividad', type: 'ref', ref: 'asistencias', required: true },
    /*
     * De qué registro sale la persona de esta marca.
     *
     * En los grupos también sirve gente que no está inscrita en la membresía
     * —ver server/integrantes.js—, y a esa gente hay que poder marcarla
     * presente o ausente igual que a los demás, o la lista del grupo queda
     * incompleta. Cada marca apunta a uno de los dos registros, nunca a los
     * dos: el número solo no alcanza, porque el miembro n.º 7 y el no miembro
     * n.º 7 son dos personas distintas.
     */
    {
      name: 'persona_tipo', label: 'Registro de la persona', type: 'select',
      required: true, default: 'Miembro', options: REGISTROS,
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true,
      showIf: { field: 'persona_tipo', equals: 'Miembro' },
    },
    {
      name: 'no_miembro_id', label: 'Persona no inscrita', type: 'ref', ref: 'no_miembros',
      required: true, showIf: { field: 'persona_tipo', equals: 'No miembro' },
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Presente',
      options: ['Presente', 'Ausente', 'Justificado'],
    },
    {
      name: 'motivo', label: 'Motivo de la justificación', type: 'select',
      // Los mantiene la iglesia (módulo «Motivos de Ausencia»).
      optionsRoute: '/motivos_ausencia/opciones',
      /*
       * Y la lista se comprueba al guardar, no solo se ofrece (v1.363.0). El
       * desplegable acotaba lo que se ve en el navegador y nada más: por la API
       * entraba cualquier texto —medido: «Motivo Que No Existe», 201—, entraba
       * uno desactivado, y «enfermedad» en minúscula quedaba como se escribió,
       * partiendo en dos el informe de asistencia por motivo. Declarando de qué
       * tabla sale la lista, el motor la comprueba contra ella y de paso deja
       * el nombre escrito como está en la lista.
       */
      opcionesDe: { modulo: 'motivos_ausencia', columna: 'nombre', label: 'Motivos de Ausencia' },
      showIf: { field: 'estado', equals: 'Justificado' },
      required: true,
    },
    {
      name: 'detalle', label: 'Detalle del motivo', type: 'text',
      // Cuáles piden explicación lo dice cada motivo en su ficha, no una lista
      // escrita acá: al agregar «Viaje» la iglesia decide si hay que explicarlo.
      // Se lee al armar la pantalla, no al arrancar: así, marcar un motivo como
      // «pide explicación» vale en cuanto se guarda.
      get showIf() { return { field: 'motivo', in: motivosQuePidenDetalle() }; },
      required: true,
      help: 'Obligatorio en los motivos que estén marcados como que piden explicación.',
    },
    // Se copian de la actividad, para poder filtrar e informar sin cruzar tablas
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true },
    { name: 'fecha', label: 'Fecha', type: 'date', readonly: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true },

    /*
     * CUÁNDO SE MARCÓ ESTO POR PRIMERA VEZ, Y QUIÉN LO MARCÓ.
     *
     * Guardar una lista BORRA y vuelve a insertar la marca de cada persona.
     * Es lo correcto para que dos personas puedan marcar a la vez —cada una
     * manda solo lo suyo y nadie borra en blanco lo del otro—, pero tenía un
     * costo que no se veía: `created_at` y `created_by` pasaban a ser los de
     * la última corrección, así que del día en que se tomó la lista no
     * quedaba nada. Comprobado: corregir una marca tres meses después dejaba
     * las cuatro marcas con fechas distintas y ninguna era la del día.
     *
     * Estos dos se ARRASTRAN al reinsertar: la marca se vuelve a escribir,
     * pero se queda con la fecha y el nombre de la primera vez. Entre los dos
     * pares se lee la historia completa de cada marca: `tomada_en` cuándo se
     * marcó, `updated_at` cuándo se corrigió por última vez.
     *
     * Van ocultos porque no se llenan a mano: los pone la toma de lista.
     */
    { name: 'tomada_en', label: 'Marcada el', type: 'text', readonly: true, oculto: true },
    { name: 'tomada_por', label: 'Marcada por', type: 'ref', ref: 'usuarios', readonly: true, oculto: true },

    /*
     * ESTUVO, PERO NO ES DEL CUERPO.
     *
     * La lista sale de los integrantes de los cuerpos convocados, y quien
     * llegó sin pertenecer a ninguno —una visita, alguien de otro cuerpo que
     * pasó, un familiar— no se podía anotar: el servidor contestaba «no está
     * en ninguno de los cuerpos convocados a esta actividad».
     *
     * Esa regla está bien: es la que impide ensuciar el porcentaje con gente
     * que no corresponde. Lo que faltaba era la otra mitad. Una marca de
     * visita deja constancia de que estuvo —que es lo que se quiere saber de
     * una visita— y queda FUERA de todos los porcentajes: del avance de la
     * lista, del informe y de la planilla del cuerpo. Así no le altera el
     * cumplimiento a nadie.
     *
     * Se guarda con el cuerpo a cuya lista se la sumó, no en blanco: es «la
     * lista de Damas del 12 de marzo, con tres visitas», y es lo que hace que
     * la encargada de Damas la vea y la pueda corregir.
     */
    { name: 'visita', label: 'Visita', type: 'boolean', readonly: true, default: 0 },
  ],

  hooks: {
    beforeSave(data, { id, existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const asistenciaId = dato('asistencia_id');

      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(asistenciaId);
      if (!actividad) return 'La actividad indicada no existe';

      // La marca apunta a uno de los dos registros, y se suelta el otro lado
      const tipo = REGISTROS.includes(dato('persona_tipo')) ? dato('persona_tipo') : 'Miembro';
      data.persona_tipo = tipo;
      const campo = tipo === 'No miembro' ? 'no_miembro_id' : 'miembro_id';
      const otro = tipo === 'No miembro' ? 'miembro_id' : 'no_miembro_id';
      const personaId = Number(dato(campo));
      if (!personaId) return 'Falta indicar a quién corresponde esta marca';
      data[campo] = personaId;
      data[otro] = null;

      /**
       * Una sola marca por persona EN CADA CUERPO de la actividad.
       *
       * No una por persona: la asistencia se lleva por cuerpo. Quien está en
       * Damas y en la Directiva tiene una marca en cada una, y pueden no
       * coincidir —justificado donde avisó, ausente donde no—.
       */
      const cuerpoId = dato('cuerpo_id');
      const repetida = db
        .prepare(
          `SELECT id FROM asistencia_detalle
            WHERE asistencia_id = ? AND "${campo}" = ? AND COALESCE(cuerpo_id, 0) = ? AND id != ?`
        )
        .get(asistenciaId, personaId, Number(cuerpoId) || 0, id || 0);
      if (repetida) return 'Esa persona ya tiene su marca en este cuerpo para esta actividad';

      /*
       * Lo que no es justificación no lleva motivo ni detalle. Y si lo es, la
       * explicación se le pide a la FILA del motivo y no a una lista de
       * nombres: ver `pideExplicacion`. Esto corre después de que el motor haya
       * dejado el motivo escrito como está en la lista, que es justamente lo
       * que le faltaba a la comprobación de obligatorios.
       */
      if (dato('estado') !== 'Justificado') {
        data.motivo = null;
        data.detalle = null;
      } else if (!pideExplicacion(db, dato('motivo'))) {
        data.detalle = null;
      } else if (!String(dato('detalle') || '').trim()) {
        return `El motivo «${dato('motivo')}» necesita que se especifique el detalle: `
          + 'está marcado como que pide explicación en Motivos de Ausencia.';
      }

      // El cuerpo lo trae la marca; si no viene, se cae al de la actividad
      // (las de un solo cuerpo lo llevan en su ficha)
      if (data.cuerpo_id === undefined) data.cuerpo_id = cuerpoId || actividad.cuerpo_id || null;
      data.fecha = actividad.fecha || null;
      data.iglesia_id = actividad.iglesia_id || null;
      return null;
    },
  },
};

// Se conserva el nombre de siempre para quien lo consulta de afuera (la
// migración que siembra la lista lo usa para saber cuáles piden explicación).
module.exports.MOTIVOS_CON_DETALLE = CON_DETALLE_DE_FABRICA;
module.exports.motivosQuePidenDetalle = motivosQuePidenDetalle;
module.exports.pideExplicacion = pideExplicacion;
module.exports.LA_LISTA_DE_MOTIVOS = LA_LISTA_DE_MOTIVOS;
