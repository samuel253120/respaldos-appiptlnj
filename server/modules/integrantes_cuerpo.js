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
 *
 * ---------------------------------------------------------------------------
 * DE QUÉ REGISTRO SALE LA PERSONA
 *
 * La ficha empieza preguntándolo, porque no todos los que sirven en la iglesia
 * están inscritos en la membresía:
 *
 *   Miembro de la iglesia   Lo de siempre, y lo normal. Se busca en el
 *                           registro oficial de miembros.
 *   No es miembro           Un hermano o una hermana que sirve en un grupo sin
 *                           estar inscrito. Se busca en el registro aparte
 *                           (módulo «No Miembros»), donde lo único obligatorio
 *                           es el nombre.
 *
 * Y esto SOLO VALE EN LOS GRUPOS. Un cuerpo es una entidad formal: tiene
 * reglamento, deberes y derechos, y de sus integrantes sale su directiva. No
 * puede componerse de gente que no pertenece a la iglesia, así que en un
 * cuerpo la opción ni se ofrece y el servidor la rechaza aunque llegue.
 */
const {
  ESTADOS, REGISTROS, finDelPeriodoDePrueba, fichaDePersona,
} = require('../integrantes');

module.exports = {
  name: 'integrantes_cuerpo',
  label: 'Integrantes de Cuerpos',
  labelSingular: 'Integrante del cuerpo',
  icon: '🧑‍🤝‍🧑',
  group: 'Organización',
  ayudaPermiso:
    'Quién pertenece a cada cuerpo y a cada grupo. Al cuerpo marcado como directiva entran y salen ' +
    'solos los de la categoría configurada, y esas fichas las maneja el sistema. Para sumar a un ' +
    'GRUPO a alguien que no está inscrito en la membresía hace falta, además, poder ver No Miembros.',
  order: 58,
  menu: false,
  display: '{persona} — {cuerpo_id}',
  dateField: 'fecha_ingreso',
  searchFields: ['persona', 'motivo_retiro', 'exento_motivo', 'observaciones'],
  listFields: ['cuerpo_id', 'persona', 'persona_tipo', 'estado', 'fecha_ingreso', 'fecha_fin_prueba', 'paga_cuota'],
  filterFields: ['cuerpo_id', 'persona_tipo', 'estado'],
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
      name: 'persona_tipo', label: '¿Quién entra al cuerpo o grupo?', type: 'select',
      required: true, default: 'Miembro', options: REGISTROS,
      help: 'La segunda opción es para el hermano o la hermana que sirve en un grupo sin estar '
        + 'inscrito en la membresía. Solo se admite en los GRUPOS: un cuerpo se compone de miembros.',
    },
    {
      name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true, buscador: true,
      showIf: { field: 'persona_tipo', equals: 'Miembro' },
      help: 'Búsquelo por su nombre, su apellido o su RUT.',
    },
    {
      name: 'no_miembro_id', label: 'Persona no inscrita', type: 'ref', ref: 'no_miembros',
      required: true, buscador: true,
      showIf: { field: 'persona_tipo', equals: 'No miembro' },
      help: 'Se busca en el registro de No Miembros. Si todavía no tiene ficha, créela ahí: '
        + 'basta con el nombre.',
    },
    {
      name: 'persona', label: 'Persona', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida, para que la pertenencia diga siempre el '
        + 'mismo nombre que el registro de donde salió.',
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
    beforeSave(data, { existing, id, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const cuerpoId = Number(dato('cuerpo_id'));
      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);

      /*
       * QUIEN SALE DEL CUERPO PUEDE ESTAR DEJANDO UN CARGO VACANTE.
       *
       * Medido antes de esto: retirar del cuerpo al tesorero de la directiva
       * vigente contestaba 200 sin decir nada, la directiva seguía nombrándolo,
       * y su cumplimiento no lo mencionaba. El sistema lo sabía —las dos tablas
       * están ahí— y no lo decía en ninguna parte.
       *
       * Va al principio del gancho porque es lo que se pierde: lo de más abajo
       * son datos mal puestos que se corrigen escribiendo otra cosa, y esto es
       * un cargo que queda sin nadie. Se pregunta y no se prohíbe —la persona
       * se va, y eso el sistema no lo puede discutir— pero quien lo anota tiene
       * que enterarse ahora, que es cuando puede hacer algo.
       */
      if (!confirmado && existing && existing.estado !== 'Retirado' && dato('estado') === 'Retirado') {
        const aviso = require('../cargos-de-la-directiva')
          .avisoDeQueOcupaUnCargo(db, { cuerpoId, miembroId: existing.miembro_id, comoSale: 'se retira del cuerpo' });
        if (aviso) return aviso;
      }

      /**
       * De qué registro sale la persona, y solo de uno.
       *
       * Se suelta el enlace del lado que no corresponde. Si alguien crea la
       * ficha apuntando a un miembro y después la corrige a un no miembro, el
       * enlace viejo quedaría ahí señalando a alguien que no pertenece al
       * grupo, y las cuotas y la asistencia lo seguirían contando.
       */
      const tipo = REGISTROS.includes(dato('persona_tipo')) ? dato('persona_tipo') : 'Miembro';
      data.persona_tipo = tipo;
      const deDonde = tipo === 'No miembro'
        ? { tabla: 'no_miembros', campo: 'no_miembro_id', otro: 'miembro_id', que: 'La persona' }
        : { tabla: 'miembros', campo: 'miembro_id', otro: 'no_miembro_id', que: 'El miembro' };

      /**
       * Un CUERPO no admite gente de fuera de la membresía.
       *
       * No es una preferencia de pantalla: es lo que distingue a un cuerpo de
       * un grupo. El cuerpo tiene reglamento, deberes y derechos, y su
       * directiva sale de sus propios integrantes. La pantalla ya no ofrece la
       * opción cuando el destino es un cuerpo, pero la regla se comprueba acá
       * igual, porque lo que la pantalla no ofrece el servidor lo tiene que
       * rechazar de todas maneras.
       */
      if (tipo === 'No miembro' && cuerpo && cuerpo.tipo !== 'Grupo') {
        return `«${cuerpo.nombre}» es un cuerpo, no un grupo, y se compone de miembros inscritos. `
          + 'Para sumar a alguien que no está en la membresía, hágalo en un grupo.';
      }

      const personaId = Number(dato(deDonde.campo));
      if (!personaId) return `${deDonde.que} de esta ficha no está indicado.`;
      const ficha = db
        .prepare(`SELECT nombres, apellidos, iglesia_id FROM "${deDonde.tabla}" WHERE id = ?`)
        .get(personaId);
      if (!ficha) return `${deDonde.que} de esta ficha ya no está en el sistema.`;

      /**
       * CADA IGLESIA LLEVA LOS SUYOS, Y ESO VALE PARA LOS DOS REGISTROS.
       *
       * La regla estaba escrita y se aplicaba SOLO a la gente del registro
       * aparte —«Esa persona está registrada en otra iglesia»—, que es el caso
       * raro. Al miembro inscrito, que es el caso normal, no se le preguntaba
       * nada. Medido en la v1.393.0, una persona de la Iglesia Norte a un
       * cuerpo de la Iglesia Central:
       *
       *   no inscrita ... formulario 400 · planilla rechazada
       *   miembro ....... formulario 201 · planilla «correctas: 1»
       *
       * Y la ficha quedaba diciendo que esa persona es de la iglesia del
       * cuerpo, así que contaba como una más: aparecía en la lista del cuerpo y
       * en su planilla de cuotas, o sea que la iglesia empezaba a cobrarle una
       * cuota mensual a alguien que no es suyo. Con una consecuencia peor: la
       * encargada de ese cuerpo NO puede abrir la ficha de esa persona —403,
       * «está fuera de lo que tiene asignado»— y sin embargo veía su nombre y
       * su RUT en la lista de su propio cuerpo.
       *
       * SOLO SE FRENA EL GUARDADO QUE LO PROVOCA, que es la regla del motor
       * para todas las comprobaciones de este tipo: una ficha que ya venía
       * cruzada —de una carga vieja, de un cuerpo que se mudó de iglesia— se
       * tiene que poder seguir guardando para corregirle una fecha o una nota.
       * Lo que se rechaza es crear la ficha, cambiarle la persona o mudarla a
       * un cuerpo de otra iglesia.
       *
       * Y se compara contra LA FICHA GUARDADA y no contra lo que trajo el
       * formulario: el propio gancho ya le escribió `persona_tipo` a `data`
       * unas líneas más arriba, así que preguntarle a `data` qué venía habría
       * dado siempre que sí, y una nota corregida en una ficha vieja se habría
       * quedado sin guardar.
       */
      const seEstaArmando = !existing
        || Number(personaId) !== Number(existing[deDonde.campo])
        || tipo !== existing.persona_tipo
        || Number(cuerpoId) !== Number(existing.cuerpo_id);
      if (seEstaArmando && cuerpo && ficha.iglesia_id
          && Number(ficha.iglesia_id) !== Number(cuerpo.iglesia_id)) {
        const suya = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(ficha.iglesia_id);
        const laDelCuerpo = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(cuerpo.iglesia_id);
        const quien = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim() || 'Esa persona';
        return `${quien} figura en «${suya ? suya.nombre : 'otra iglesia'}» y «${cuerpo.nombre}» es de `
          + `«${laDelCuerpo ? laDelCuerpo.nombre : 'otra'}». Cada iglesia lleva los suyos: si la persona se `
          + 'cambió de iglesia, corrija primero eso en su ficha.';
      }

      data[deDonde.campo] = personaId;
      data[deDonde.otro] = null;
      data.persona = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();

      // Una persona no puede tener dos fichas en el mismo cuerpo
      const otra = fichaDePersona(db, cuerpoId, { [deDonde.campo]: personaId });
      if (otra && Number(otra.id) !== Number(id)) {
        return `${data.persona || 'Esa persona'} ya tiene su ficha en este cuerpo. `
          + 'Ábrala en vez de crear otra.';
      }

      /**
       * A quien ya no está en la iglesia no se le vuelve a inscribir.
       *
       * Al marcar una ficha como Fallecido o Trasladado, sus fichas de
       * integrante se retiran solas (ver server/ya-no-esta.js). Sin esta
       * comprobación esa salida se podía deshacer desde acá sin querer —basta
       * abrir la ficha de integrante y ponerle «Activo»— y la persona volvía a
       * la lista del cuerpo, a la planilla del mes y al aviso de faltas.
       *
       * Solo estorba si la ficha va a quedar VIGENTE: dejarla retirada, o
       * corregirle la fecha de retiro, tiene que seguir siendo posible.
       */
      if (tipo === 'Miembro' && dato('estado') !== 'Retirado') {
        const { yaNoEsta } = require('../ya-no-esta');
        const persona = db.prepare('SELECT estado FROM miembros WHERE id = ?').get(personaId);
        if (yaNoEsta(persona)) {
          return `${data.persona || 'Esa persona'} figura como ${String(persona.estado).toLowerCase()} `
            + 'en su ficha de miembro, así que ya no pertenece a los cuerpos de la iglesia. '
            + 'Si sigue participando, corrija primero su estado en Miembros.';
        }
      }

      data.iglesia_id = cuerpo ? cuerpo.iglesia_id : null;

      // El fin de la prueba se calcula solo, con los meses que define el cuerpo
      data.fecha_fin_prueba = dato('estado') === 'En prueba'
        ? finDelPeriodoDePrueba(db, cuerpoId, dato('fecha_ingreso'))
        : existing ? existing.fecha_fin_prueba : null;

      if (dato('estado') !== 'Retirado') {
        data.fecha_retiro = null;
        data.motivo_retiro = null;
      } else if (!dato('fecha_retiro')) {
        data.fecha_retiro = require('../fechas').hoy();
      }
      if (!dato('exento_cuota')) data.exento_motivo = null;
      return null;
    },

    /**
     * Una pertenencia con cuotas pagadas no se elimina: ese dinero entró de
     * verdad y su registro tiene que quedar. Para eso está el estado
     * "Retirado", que conserva el recorrido completo de la persona.
     */
    beforeDelete(fila, { db, confirmado }) {
      /*
       * La otra puerta: borrar la ficha en vez de retirarla deja el mismo cargo
       * sin nadie, y por acá no pasaba ninguna comprobación. Cerrar una sola de
       * las dos puertas es lo mismo que no cerrar ninguna, que es la lección de
       * la 1.249.0 con la planilla de cuotas.
       */
      if (!confirmado) {
        const aviso = require('../cargos-de-la-directiva')
          .avisoDeQueOcupaUnCargo(db, { cuerpoId: fila.cuerpo_id, miembroId: fila.miembro_id, comoSale: 'sale del cuerpo' });
        if (aviso) return aviso;
      }
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
