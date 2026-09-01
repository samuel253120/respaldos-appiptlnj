/**
 * Módulo: Directivas de Cuerpos (histórico).
 *
 * Cada cuerpo formal elige su directiva por períodos. Aquí queda el registro
 * de todas: la vigente y las anteriores, con sus cargos y el acta de elección.
 *
 * La directiva se compone de: oficial supervisor(a), primer jefe / primera
 * jefa, segundo jefe / segunda jefa, secretario(a), tesorero(a) y, cuando se
 * designa, consejero(a).
 *
 * Los cargos los ocupan **integrantes del propio cuerpo**: sus selectores
 * ofrecen solo a quienes pertenecen al cuerpo elegido, y el servidor lo
 * verifica al guardar.
 *
 * El oficial supervisor(a) es la excepción: viene del cuerpo de oficiales (su
 * nombre se define en Configuración → Organización), porque supervisa a los
 * demás cuerpos desde fuera. Mientras ese cuerpo no exista, ofrece a todos
 * los miembros para no bloquear.
 *
 * Regla: un cuerpo tiene como máximo UNA directiva EN EJERCICIO, y cuál es se
 * calcula de las fechas —no se marca a mano—. Ver server/directiva-en-ejercicio.js:
 * ahí está la única definición, y de ahí leen el estado de cumplimiento del
 * cuerpo, el resumen de su ficha, su panel de directivas y el informe de la
 * importación. Guardar una cuyo período se pise con otro del mismo cuerpo
 * PREGUNTA y dice qué fecha poner; antes finalizaba a las demás en silencio.
 */
const { cuerpoDeOficiales } = require('../oficiales');
const { idsDeIntegrantes: idsDelCuerpo } = require('../integrantes');

/**
 * Miembros que pueden ser oficial supervisor(a): los del cuerpo de oficiales.
 * Si ese cuerpo todavía no existe o no tiene integrantes, se devuelven todos
 * los miembros, para no dejar el campo sin opciones.
 */
function oficialesDisponibles(db, usuario) {
  const { getModule, displayOf } = require('../registry'); // tardío: evita ciclo con el registro
  const miembros = getModule('miembros');

  /*
   * Acotado como cualquier listado, y no por la «iglesia principal».
   *
   * Hasta la 1.98.0 esto filtraba por `usuario.iglesia_id`, que es justamente
   * el campo que server/alcance.js dice que NO acota: es solo la iglesia que
   * se propone al crear un registro. Fallaba por los dos lados: quien no la
   * tenía puesta veía los miembros de TODAS las iglesias, y quien tiene
   * asignado un cuerpo veía la gente de los otros cuerpos de su iglesia. Se
   * comprobó en vivo: la secretaria de un cuerpo tenía acá la lista completa.
   */
  const params = [];
  const donde = require('../alcance').condiciones(miembros, usuario, params);
  const filas = db
    .prepare(`SELECT * FROM miembros ${donde ? `WHERE ${donde}` : ''} ORDER BY id DESC LIMIT 1000`)
    .all(...params);

  const cuerpo = cuerpoDeOficiales(db);
  let permitidos = null;
  if (cuerpo) {
    const ids = idsDelCuerpo(db, cuerpo.id);
    if (ids.length) permitidos = new Set(ids);
  }

  return filas
    .filter((f) => !permitidos || permitidos.has(f.id))
    .map((f) => ({ id: f.id, label: displayOf(miembros, f) }));
}

/** Integrantes de un cuerpo (los que pertenecen hoy, más su líder), como opciones. */
function integrantesDeCuerpo(db, cuerpoId) {
  const { getModule, displayOf } = require('../registry'); // tardío: evita ciclo con el registro
  const miembros = getModule('miembros');
  if (!cuerpoId) return [];

  return idsDelCuerpo(db, cuerpoId)
    .map((id) => db.prepare('SELECT * FROM miembros WHERE id = ?').get(id))
    .filter(Boolean)
    .map((f) => ({
      id: f.id,
      label: displayOf(miembros, f),
      buscar: `${displayOf(miembros, f)} ${f.rut || ''} ${f.telefono || ''}`.trim(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Ids de quienes pueden ocupar un cargo en la directiva de este cuerpo. */
function idsDeIntegrantes(db, cuerpoId) {
  return new Set(integrantesDeCuerpo(db, cuerpoId).map((o) => o.id));
}

/*
 * Los cargos se leen de server/cargos-de-la-directiva.js y no se escriben acá.
 * Estaban en tres lugares —este módulo, la bitácora y el panel de la ficha, este
 * último con las etiquetas escritas distinto— y el cargo que se agregue mañana
 * habría quedado fuera de dos de ellos sin que nada lo dijera.
 */
const { LOS_DEL_CUERPO } = require('../cargos-de-la-directiva');

module.exports = {
  name: 'directivas',
  label: 'Directivas de Cuerpos',
  labelSingular: 'Directiva',
  icon: '🏅',
  group: 'Organización',
  order: 53,
  display: '{periodo}',
  dateField: 'fecha_inicio',
  printable: true,
  searchFields: ['periodo', 'otros_cargos', 'notas'],
  /*
   * En el listado va `situacion` y no `estado`: el guardado dice lo que alguien
   * escribió alguna vez y la situación dice lo que pasa hoy. El campo sigue
   * existiendo —y sigue sirviendo para filtrar— pero mostrarlo acá era lo que
   * hacía que una directiva vencida en 2019 se leyera «Vigente» de un vistazo.
   */
  listFields: ['cuerpo_id', 'periodo', 'primer_jefe_id', 'secretario_id', 'fecha_inicio', 'fecha_termino', 'situacion'],
  defaultSort: { field: 'fecha_inicio', dir: 'desc' },
  computed: [
    {
      /*
       * ELECTA mientras no asume · EN EJERCICIO entre sus dos fechas ·
       * TERMINADA después · REEMPLAZADA cuando su período sigue abierto pero
       * otra posterior ya asumió · FINALIZADA si alguien la cerró a mano.
       *
       * SÍ SALE EN EL PAPEL, y es el campo guardado el que deja de salir. La
       * hoja imprimía «Estado: Vigente» en la hoja de una directiva terminada
       * en 2019, que es el mismo defecto de la pantalla trasladado a algo que
       * se firma y se archiva. Lo que se calcula vale para el día en que se
       * imprime, y la hoja dice ese día al pie —«Emitido el …»—, igual que las
       * cifras de la hoja de una iglesia.
       */
      name: 'situacion', label: 'Situación', type: 'badge',
      help: 'Sale de las fechas del período, no de una casilla: una directiva empieza a ejercer y deja de hacerlo sin que nadie guarde nada.',
      calc: (fila, opciones) => require('../directiva-en-ejercicio').insigniaDeSituacion(fila, opciones),
    },
  ],
  fields: [
    { name: 'cuerpo_id', label: 'Cuerpo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'periodo', label: 'Período', type: 'text', required: true, help: 'Ej: 2026 – 2027' },
    // Una directiva puede quedar electa para asumir más adelante.
    { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true, futuro: true },
    {
      /*
       * SE EDITA, y es a propósito: los períodos se extienden y se acortan a
       * cada rato —una directiva sigue medio año más porque la elección se
       * atrasó, otra termina antes porque se disolvió— y correr esta fecha es
       * exactamente lo que pasó. Cerrar una directiva es ponerle el día en que
       * terminó, no marcar una casilla que no dice cuándo.
       */
      name: 'fecha_termino', label: 'Fecha de término', type: 'date', futuro: true, noAntesDe: 'fecha_inicio',
      help: 'Hasta cuándo dirige. De acá sale que la directiva esté en ejercicio, así que extender o acortar el período se hace corriendo esta fecha. En blanco, no vence nunca.',
    },
    // --- Integrantes de la directiva ---
    {
      name: 'oficial_supervisor_id', label: 'Oficial supervisor(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/oficiales',
      help: 'Integrante del cuerpo de oficiales designado para supervisar este cuerpo.',
    },
    {
      name: 'primer_jefe_id', label: 'Primer jefe / Primera jefa', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}',
      help: 'Se elige entre los integrantes del cuerpo.',
    },
    { name: 'segundo_jefe_id', label: 'Segundo jefe / Segunda jefa', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'secretario_id', label: 'Secretario(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'tesorero_id', label: 'Tesorero(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'consejero_id', label: 'Consejero(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}', help: 'Cargo adicional, no siempre se designa.' },
    { name: 'otros_cargos', label: 'Otros cargos', type: 'textarea', help: 'Opcional. Ej: Directora de música: Ana Soto' },
    { name: 'acta_eleccion', label: 'Acta de elección', type: 'file' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      /*
       * CIERRA, PERO NO ABRE. «Finalizada» da por cerrada la directiva aunque
       * su período siga corriendo —una elección anulada, una directiva
       * disuelta—; «Vigente» no la pone en ejercicio si sus fechas dicen otra
       * cosa. Esa mitad es la que faltaba: una marcada «Vigente» cuyo término
       * pasó en 2019 seguía diciendo que mandaba.
       *
       * Se conserva con sus dos valores de siempre —ninguna fila hubo que
       * tocar— y sigue sirviendo de filtro en el listado. En el papel no sale:
       * ahí va la situación, que es la que dice algo. Ver «Situación», arriba.
       */
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Vigente', enElPapel: false,
      options: ['Vigente', 'Finalizada'],
      help: 'Normalmente no se toca. La situación real —electa, en ejercicio o terminada— sale de las fechas; esto solo sirve para cerrar una directiva antes de tiempo cuando no se le quiere poner fecha.',
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  extraRoutes(router, { db, base, requirePerm }) {
    // Las dos rutas de acá llenan selectores del formulario de directivas, así
    // que hay que poder ver directivas para pedirlas. Antes solo comprobaban el
    // alcance —de qué iglesia y de qué cuerpo—, no el permiso, y eso dejaba que
    // alguien a quien se le hubiera cerrado el módulo igual leyera sus listas.
    router.get(`${base}/oficiales`, requirePerm('directivas', 'view'), (req, res) => {
      res.json(oficialesDisponibles(db, req.user));
    });

    // Integrantes del cuerpo elegido: de ahí salen los cargos de su directiva.
    // Sin cuerpo no hay a quién ofrecer, y el selector lo dice.
    router.get(`${base}/integrantes`, requirePerm('directivas', 'view'), (req, res) => {
      const cuerpoId = Number(req.query.cuerpo_id) || null;
      if (!cuerpoId) return res.json([]);
      const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.json([]);
      const alcance = require('../alcance');
      // La iglesia y el cuerpo: quien tiene asignado un cuerpo no puede
      // listar la gente de otro, aunque sea de la misma iglesia.
      if (!alcance.alcanzaIglesia(req.user, cuerpo.iglesia_id) || !alcance.alcanzaCuerpo(req.user, cuerpoId)) {
        return res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
      }
      res.json(integrantesDeCuerpo(db, cuerpoId));
    });
  },
  hooks: {
    beforeSave(data, { db, id, existing, isNew, confirmado }) {
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing && existing.cuerpo_id;
      if (!cuerpoId) return null;

      // Heredar la iglesia del cuerpo
      if (data.iglesia_id === undefined || data.iglesia_id === null) {
        const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (cuerpo) data.iglesia_id = cuerpo.iglesia_id;
      }

      // Los cargos los ocupan integrantes del propio cuerpo. Solo se revisa lo
      // que se está cambiando ahora: si alguien salió del cuerpo después de
      // haber sido electo, su directiva anterior se puede seguir corrigiendo.
      const permitidos = idsDeIntegrantes(db, cuerpoId);
      for (const { campo, label: cargo } of LOS_DEL_CUERPO) {
        const valor = data[campo];
        if (valor === undefined || valor === null || valor === '') continue;
        const cambia = !existing || String(existing[campo] || '') !== String(valor);
        if (!cambia) continue;
        if (!permitidos.has(Number(valor))) {
          const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpoId);
          const persona = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(valor);
          const quien = persona ? `${persona.nombres} ${persona.apellidos}`.trim() : `#${valor}`;
          return `${quien} no es integrante de "${cuerpo ? cuerpo.nombre : 'ese cuerpo'}", así que no puede ser ${cargo} de su directiva. Agréguelo primero al cuerpo.`;
        }
      }

      /*
       * UNA SOLA EN EJERCICIO POR CUERPO, preguntando en vez de reescribir.
       *
       * Acá había un UPDATE que marcaba «Finalizada» a las demás del cuerpo, en
       * silencio, cada vez que se guardaba una como vigente. Sobre el papel
       * cumplía la regla; en la práctica, registrar la directiva ELECTA para
       * asumir el año siguiente destituía a la que estaba gobernando, y la
       * organización quedaba sin directiva en ejercicio por haber anotado bien
       * su próxima elección.
       *
       * Ahora quién ejerce se calcula de las fechas, así que no hay nada que
       * reescribir: lo que puede pasar es que dos períodos se PISEN, y eso se
       * pregunta. El aviso dice qué fecha poner —el día antes de que la nueva
       * asuma— y deja seguir, porque puede ser a propósito mientras se hace la
       * entrega. Lo que no hace es correrle la fecha a nadie por su cuenta: de
       * esa fecha depende desde cuándo un cuerpo tiene otra directiva.
       */
      const enEjercicio = require('../directiva-en-ejercicio');
      const comoQueda = {
        cuerpo_id: cuerpoId,
        estado: data.estado !== undefined ? data.estado : existing && existing.estado,
        fecha_inicio: data.fecha_inicio !== undefined ? data.fecha_inicio : existing && existing.fecha_inicio,
        fecha_termino: data.fecha_termino !== undefined ? data.fecha_termino : existing && existing.fecha_termino,
        periodo: data.periodo !== undefined ? data.periodo : existing && existing.periodo,
      };
      const sePisan = enEjercicio.lasQueSePisan(db, comoQueda, id);
      if (sePisan.length && !confirmado) {
        return { error: enEjercicio.avisoDeTraslape(comoQueda, sePisan), confirmar: 'directiva_que_se_pisa' };
      }

      /*
       * Y QUE NO QUEDE SIN QUIEN LA ENCABECE.
       *
       * Los seis cargos eran opcionales, así que una directiva con el cuerpo, el
       * período y la fecha, y nadie adentro, entraba con 201 y dejaba al cuerpo
       * cumpliendo su requisito de tener directiva.
       *
       * Se pregunta y no se prohíbe: anotar el período antes que los nombres es
       * corriente —el acta llega después—, y prohibirlo obligaría a inventar un
       * jefe para poder guardar, que es peor. Va DESPUÉS del traslape porque el
       * «igual así» es uno solo para todo el guardado: quién dirige el cuerpo
       * cuesta más de deshacer que un cargo que se completa mañana.
       *
       * SOLO CUANDO ESTE GUARDADO LA DEJA ASÍ: al crearla, o al quitarle el jefe
       * a una que lo tenía. Corregirle una nota a una directiva vieja que ya
       * estaba sin jefe NO vuelve a preguntar, y no es una omisión: el estado de
       * cumplimiento del cuerpo lo dice todo el tiempo, en su ficha y en el
       * listado, sin que nadie tenga que contestar nada. Un aviso que sale en
       * cada guardado enseña a apretar «Está bien» sin leer, y entonces deja de
       * avisar de lo que importa —es la misma razón por la que la cuota sin
       * monto no se pregunta al crear un cuerpo—.
       */
      const cargos = require('../cargos-de-la-directiva');

      /*
       * EL OFICIAL SUPERVISOR, que era el único cargo sin comprobar en el
       * servidor. Va antes que la pregunta del jefe porque son dos clases de
       * problema distintas: acá hay un dato PUESTO MAL —alguien que no es
       * oficial figurando como supervisor, y eso se ve bien en la pantalla— y
       * más abajo hay un dato QUE FALTA, que el cumplimiento del cuerpo deja
       * dicho todo el tiempo sin que nadie conteste nada. Lo que se ve bien y
       * está mal pesa más que lo que se ve mal y está a la vista.
       */
      /*
       * Lo que ESTE guardado trae, sin respaldo en la ficha anterior: como la
       * pregunta solo sale cuando el supervisor CAMBIA, tomarlo de la ficha
       * anterior cuando no viene daba siempre el mismo valor que ya tenía, y se
       * salía por esa comparación igual. Quitar aquel respaldo no cambiaba nada,
       * que es la definición de una línea que no decide.
       */
      const noEsOficial = cargos.avisoSiNoEsOficial(db,
        { supervisorId: data.oficial_supervisor_id, existing, confirmado });
      if (noEsOficial) return noEsOficial;

      const conCargos = { ...(existing || {}), ...data };
      const loPierdeAhora = isNew || cargos.tieneQuienLaEncabece(existing);
      if (!cargos.tieneQuienLaEncabece(conCargos) && loPierdeAhora && !confirmado) {
        return { error: cargos.avisoSinQuienLaEncabece(conCargos), confirmar: 'directiva_sin_jefe' };
      }

      /*
       * Y QUE NO QUEDE UNA SOLA PERSONA EN VARIOS CARGOS. Va al final de las
       * tres porque es la que menos cuesta deshacer —se reparte un cargo y
       * listo— y porque las otras dos hablan de que la directiva no exista o no
       * tenga cabeza, que es más grave que tenerla mal repartida.
       */
      if (!confirmado) {
        const repetidos = cargos.avisoDeCargosRepetidos(db, conCargos, existing);
        if (repetidos) return repetidos;
      }
      return null;
    },
  },
};
