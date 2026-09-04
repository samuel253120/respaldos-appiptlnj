/**
 * Módulo: Asistencias (la asistencia se toma por cuerpo, en cada actividad).
 *
 * Cada registro es una actividad —una reunión, un ensayo, una salida— a la
 * que asiste **uno o varios cuerpos**. La lista nominal de quién estuvo se
 * guarda en "Toma de Asistencia": una fila por integrante, con su estado
 * (Presente, Ausente o Justificado) y el motivo cuando corresponde.
 *
 * Al pie de cada actividad está "Pasar lista", que muestra a los integrantes
 * de todos los cuerpos convocados, agrupados por cuerpo, y permite marcarlos
 * de una vez.
 *
 * Permisos: crear o modificar actividades se rige por este módulo; **tomar la
 * asistencia** se rige por "Toma de Asistencia", de modo que a alguien se le
 * puede dejar pasar lista sin dejarlo crear actividades.
 *
 * Rutas propias:
 *   GET  /asistencias/agenda      actividades de un período, con su avance
 *   GET  /asistencias/:id/lista   integrantes del cuerpo con su marca
 *   POST /asistencias/:id/lista   guarda todas las marcas de una vez
 *   GET  /asistencias/informe     informes y promedios (general, por cuerpo,
 *                                 por persona)
 *   GET  /asistencias/hoja-mensual  la planilla mensual de un cuerpo: un día
 *                                 por columna, para imprimir apaisada.
 *                                 NO se llama «/planilla»: ese nombre ya lo usa
 *                                 la bajada a Excel que el motor le da a todos
 *                                 los módulos, y se lo comía antes de llegar acá
 */
const nombres = require('../nombres');

/**
 * Qué motivos exigen que se escriba el detalle.
 *
 * No es una lista escrita acá: cada motivo lo dice en su ficha (módulo
 * «Motivos de Ausencia»), así que al agregar «Viaje» la iglesia decide si hay
 * que explicarlo o no, sin tocar el programa.
 *
 * Estaba fija, y eso hacía que el módulo se contradijera consigo mismo: la
 * ficha de una marca suelta respetaba lo configurado —lo lee de la tabla— y la
 * toma de lista, que es por donde entran todas, seguía exigiendo los tres de
 * fábrica. Coincidían por casualidad; el día que la iglesia marcara «Trabajo»
 * como que pide explicación, no iba a pasar nada. Se pide en el momento y no
 * al cargar el archivo, para que un cambio valga en cuanto se guarda.
 */
const motivosConDetalle = () => require('./asistencia_detalle').motivosQuePidenDetalle();

/** Las actividades a las que la iglesia toma asistencia. */
const { TIPOS_DE_ACTIVIDAD } = require('../actividades');

/** Ids de los cuerpos convocados (el multiref se guarda como JSON). */
function idsDeCuerpos(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  try {
    return JSON.parse(valor || '[]').map(Number).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * A qué cuerpos de esta actividad le toca pasar lista a este usuario.
 *
 * A una actividad puede asistir más de un cuerpo. Quien tiene cuerpos
 * asignados solo pasa lista a los suyos: aunque la actividad convoque a
 * siete, él ve y marca únicamente a los de su cuerpo. Sin cuerpos asignados
 * —el caso del administrador— le tocan todos los convocados.
 */
function cuerposQueLeTocan(actividad, usuario) {
  const alcance = require('../alcance');
  const convocados = idsDeCuerpos(actividad.cuerpos);
  /*
   * Se pregunta cuerpo por cuerpo y con la pregunta completa —sus cuerpos
   * asignados Y sus iglesias— porque desde la v1.375.0 una actividad puede
   * convocar cuerpos de dos congregaciones y se alcanza desde las dos. A quien
   * tiene iglesia asignada y ningún cuerpo, el caso corriente de una
   * secretaria, antes le tocaban todos los convocados: también los de al lado.
   */
  return convocados.filter((id) => alcance.alcanzaCuerpo(usuario, id));
}

/**
 * Cómo se llama el cuerpo de una marca cuando no se le puede poner nombre.
 *
 * Una marca guarda a qué cuerpo corresponde y puede quedarse sin él: el
 * sistema lo repara al arrancar, pero su propio aviso reconoce que hay casos
 * que no puede resolver —«la persona pertenece a varios de los cuerpos
 * convocados, o a ninguno; se dejaron como estaban»—, y una copia restaurada o
 * una planilla importada traen los suyos.
 *
 * Lo que quedaba así no se veía en NINGUNA vista por cuerpo y no se decía:
 * medido en la v1.378.0 sobre la base cargada, el informe por cuerpo de cuatro
 * meses entregaba UNA fila, con el nombre del cuerpo en blanco y 25.400 marcas
 * dentro. Una fila sin nombre con veinticinco mil marcas no se lee como un
 * aviso: se lee como un cuerpo que se llama así.
 *
 * Así que se nombran, y se nombran acá —una vez, en el servidor— para que lo
 * digan igual la pantalla, la hoja impresa y la planilla que se baja a Excel.
 * Son dos cosas distintas y conviene no confundirlas: la marca que nunca supo
 * de qué cuerpo era, y la que apunta a un cuerpo que ya no está.
 */
const SIN_CUERPO = '(sin cuerpo anotado)';
function comoSeLlamaElCuerpo(fila) {
  if (fila.cuerpo) return fila.cuerpo;
  return fila.cuerpo_id ? `(cuerpo n.º ${fila.cuerpo_id}, ya borrado)` : SIN_CUERPO;
}
/** La misma, para pasársela a un `.map()` sin perder el resto de la fila. */
const conElCuerpoNombrado = (fila) => ({ ...fila, cuerpo: comoSeLlamaElCuerpo(fila) });

/**
 * ── QUÉ ES «LA MISMA ACTIVIDAD» ──
 *
 * Una sola definición, para los dos caminos por los que se crea una actividad:
 * el formulario y la ruta que la repite. La ruta ya se saltaba los días que la
 * tenían y lo decía con todas sus letras —«una lista duplicada es peor que no
 * tenerla: la gente marca en una y el informe cuenta las dos»—; el formulario
 * no preguntaba nada. Medido en la v1.377.0: la misma reunión, el mismo día y
 * el mismo cuerpo, tres veces seguidas, tres 201 y ni una palabra.
 *
 * Dos maneras de comparar habrían sido dos verdades, así que se compara acá y
 * una sola vez. Es la misma cuando coinciden:
 *
 *   · el día,
 *   · el tipo de actividad,
 *   · y AL MENOS UN cuerpo convocado.
 *
 * Lo del «al menos uno» es lo que cambió respecto de la ruta de repetir, que
 * comparaba el JSON de los cuerpos letra por letra: «[3,10]» y «[10,3]» son la
 * misma convocatoria y no se parecían en nada, y una actividad que convoca a
 * tres cuerpos duplica la lista de los tres aunque el cuarto sea distinto.
 *
 * LA HORA DESEMPATA. Un servicio en la mañana y otro en la tarde son dos
 * actividades de verdad del mismo día, y eso es exactamente lo que dice la
 * hora: si las dos la tienen puesta y no es la misma, no se pregunta nada. Si
 * a una le falta, no se sabe, y entonces sí se pregunta.
 */
function esOtraHora(una, otra) {
  return Boolean(una && otra && String(una).slice(0, 5) !== String(otra).slice(0, 5));
}

/**
 * Las actividades que ya existen para esos días, por día.
 *
 * Devuelve un Map fecha -> la primera que coincide. Una sola consulta, porque
 * la ruta de repetir pregunta por doscientas fechas de una vez.
 */
function lasQueYaEstaban(db, { fechas, tipo_reunion, cuerpos, hora_inicio }, exceptoId) {
  const dias = (fechas || []).filter(Boolean);
  const ids = idsDeCuerpos(cuerpos);
  if (!dias.length || !ids.length || !tipo_reunion) return new Map();
  const filas = db
    .prepare(
      `SELECT * FROM asistencias
        WHERE fecha IN (${dias.map(() => '?').join(',')})
          AND tipo_reunion = ?
          AND id <> ?
          AND EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos)
                       WHERE json_each.value IN (${ids.map(() => '?').join(',')}))
        ORDER BY id`
    )
    .all(...dias, tipo_reunion, exceptoId || 0, ...ids);
  const salida = new Map();
  for (const f of filas) {
    if (esOtraHora(hora_inicio, f.hora_inicio)) continue;
    if (!salida.has(f.fecha)) salida.set(f.fecha, f);
  }
  return salida;
}

/**
 * La pregunta que se le hace a quien está creando una que ya existe.
 *
 * Es una PREGUNTA y no un rechazo: dos reuniones del mismo tipo el mismo día
 * existen, y el sistema no está para discutírselo a quien tiene el cuaderno
 * delante. Lo que no puede es dejarlo pasar en silencio.
 *
 * Se le dice todo lo que hace falta para reconocerla —cómo se llama, a qué
 * hora, con qué cuerpos, y si ya tiene lista pasada— y se le ofrece un botón
 * que lleva hasta ella: «ábrala en vez de crearla de nuevo» sin decir dónde
 * está obliga a salir, buscarla a mano y volver a llenar el formulario, que es
 * justo lo que nadie hace.
 */
function avisoDeActividadRepetida(db, otra) {
  const { comoSeLee } = require('../fechas');
  const cuantas = db
    .prepare('SELECT COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ?')
    .get(otra.id).n;
  const nombresDeCuerpos = idsDeCuerpos(otra.cuerpos)
    .map((id) => (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(id) || {}).nombre)
    .filter(Boolean);
  const senas = [
    otra.nombre ? `«${otra.nombre}»` : null,
    otra.hora_inicio ? `a las ${String(otra.hora_inicio).slice(0, 5)}` : 'sin hora anotada',
    nombresDeCuerpos.length ? `con ${nombresDeCuerpos.join(', ')}` : null,
    cuantas ? `y ${cuantas} marca(s) ya tomadas` : 'y todavía sin lista',
  ].filter(Boolean).join(', ');

  return {
    error:
      `Ya hay un ${otra.tipo_reunion} el ${comoSeLee(String(otra.fecha).slice(0, 10))} `
      + `(${senas}). Si es esta misma, ábrala en vez de crearla de nuevo: con dos listas del `
      + 'mismo culto la gente marca en una, el informe cuenta las dos y el porcentaje del cuerpo '
      + 'queda a la mitad sin que nadie haya faltado. Si de verdad fueron dos reuniones distintas '
      + 'ese día, ponga la hora de cada una y confirme.',
    confirmar: 'actividad_repetida',
    ir: { texto: '📋 Abrir la que ya existe', a: `#/m/asistencias/ficha/${otra.id}` },
  };
}

/**
 * ¿A esta persona se le acota lo que ve de una actividad, o lo alcanza todo?
 *
 * Lo alcanza todo quien no tiene ni cuerpos ni iglesias asignadas: el
 * administrador general. A cualquier otro se le acota por los cuerpos que le
 * tocan.
 *
 * Se preguntaba solo por los CUERPOS asignados, y a quien no tenía ninguno se
 * le mostraba la actividad entera. Mientras una actividad fue de una sola
 * congregación eso no se notaba —lo que veía de más era de su propia iglesia—;
 * desde que una actividad puede convocar a dos, sí: la encargada de una
 * congregación veía las cincuenta marcas del cuerpo de la otra.
 */
function loAlcanzaTodo(usuario) {
  const alcance = require('../alcance');
  return !alcance.cuerposDe(usuario).length && !alcance.iglesiasDe(usuario).length;
}

/**
 * En qué iglesia queda anotada una marca: en la DE SU CUERPO.
 *
 * La actividad tiene una sola iglesia —la del primer cuerpo convocado— y esa se
 * le estampaba a todas sus marcas. Cuando la actividad convocaba a cuerpos de
 * dos congregaciones, la asistencia de una quedaba contada en la otra: medido,
 * la marca de un miembro de la iglesia 2 quedó anotada en la 1, y el informe de
 * su propia encargada decía cero presentes ese día.
 *
 * La marca es de una persona EN UN CUERPO, y ese cuerpo tiene su iglesia. La de
 * la actividad queda de respaldo para lo que no tenga cuerpo —una lista vieja,
 * una marca que llegó sin él— porque dejarla en blanco la sacaría de todos los
 * informes.
 */
function laIglesiaDe(cuerpoId, actividad) {
  if (cuerpoId) {
    const suyo = require('../db').db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
    if (suyo && suyo.iglesia_id) return suyo.iglesia_id;
  }
  return actividad.iglesia_id || null;
}

/**
 * La asistencia se lleva POR CUERPO, no por persona.
 *
 * Quien pertenece a dos de los cuerpos convocados aparece una vez EN CADA UNO,
 * y se le marca por separado. No es una duplicación: son dos asistencias
 * distintas, y en la práctica pueden no coincidir. Alguien que está en Damas y
 * en la Directiva le avisa a la Directiva que no va a poder ir —y la Directiva
 * lo anota justificado— pero a Damas no le avisa nada, y Damas lo anota
 * ausente. Las dos cosas son ciertas al mismo tiempo, y cada cuerpo lleva su
 * propia cuenta.
 *
 * Antes había una sola marca por persona y actividad, así que el sistema tenía
 * que elegir un cuerpo —el primero de los convocados— y los demás se quedaban
 * sin nada. El informe ya prometía abrir el porcentaje por cuerpo («en uno
 * puede andar al día y en otro no»), pero los datos no daban para eso.
 *
 * Se devuelve una entrada por CADA par persona-cuerpo, con su clave.
 *
 * Y la persona se identifica por su REGISTRO más su número, no por el número
 * solo: en los grupos también sirve gente que no está inscrita en la membresía
 * (ver server/integrantes.js), y el miembro n.º 7 y el no miembro n.º 7 son
 * dos personas distintas. De ahí la letra que abre la clave: `m7:3` y `n7:3`
 * son dos filas de la lista, no una.
 */
const { clavePersona } = require('../integrantes');

const claveDe = (quien, cuerpoId) => `${clavePersona(quien)}:${Number(cuerpoId) || 0}`;

function integrantesConvocados(actividad, db, usuario) {
  const { personasDelCuerpo } = require('../integrantes');
  const mapa = new Map();
  for (const cuerpoId of cuerposQueLeTocan(actividad, usuario)) {
    const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
    if (!cuerpo) continue;
    for (const p of personasDelCuerpo(db, cuerpo.id)) {
      mapa.set(claveDe(p, cuerpo.id), {
        persona_tipo: p.persona_tipo,
        miembro_id: p.miembro_id,
        no_miembro_id: p.no_miembro_id,
        nombres: p.nombres,
        apellidos: p.apellidos,
        rut: p.rut,
        foto: p.foto,
        cuerpo_id: cuerpo.id,
        cuerpo: cuerpo.nombre,
      });
    }
  }
  return mapa;
}

/**
 * Las marcas que hay ahora mismo en una actividad, de los cuerpos que le
 * tocan a esta persona. Se devuelven al guardar para que la pantalla se ponga
 * al día con lo que hayan marcado los demás mientras tanto.
 */
function marcasVisibles(actividad, db, usuario) {
  const suyos = loAlcanzaTodo(usuario) ? [] : cuerposQueLeTocan(actividad, usuario);
  const acota = suyos.length ? ` AND cuerpo_id IN (${suyos.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT miembro_id, no_miembro_id, cuerpo_id, estado, motivo, detalle,
              COALESCE(visita, 0) AS visita
         FROM asistencia_detalle WHERE asistencia_id = ?${acota}`
    )
    .all(actividad.id, ...(acota ? suyos : []))
    // La clave la arma el servidor: es él quien manda sobre el formato, y así
    // la pantalla no tiene que saber cómo se identifica a alguien de cada registro
    .map((m) => ({ ...m, clave: claveDe(m, m.cuerpo_id) }));
}

/**
 * QUIÉNES son los integrantes de un cuerpo, en clave y sin sus datos.
 *
 * `integrantesConvocados` arma la persona entera —nombre, RUT, foto— porque
 * eso es lo que necesita la lista para marcar. Para CONTAR no hace falta nada
 * de eso, y armarlo es justo lo que hacía cara la agenda: los integrantes de
 * cada cuerpo se recorrían una vez por cada actividad que lo convoca, y en un
 * año son ciento cincuenta y tres actividades sobre los mismos doce cuerpos.
 *
 * El `recuerdo` es un Map de cuerpo → claves que dura lo que dura una
 * respuesta. Así cada cuerpo se recorre UNA vez, no una por actividad.
 */
function clavesDelCuerpo(db, cuerpoId, recuerdo) {
  const id = Number(cuerpoId) || 0;
  const donde = `asistencia:cuerpo:${id}`; // el recuerdo es de todos: cada uno usa su propio espacio
  if (recuerdo && recuerdo.has(donde)) return recuerdo.get(donde);
  const { personasDelCuerpo } = require('../integrantes');
  const claves = new Set(personasDelCuerpo(db, id).map((p) => clavePersona(p)).filter(Boolean));
  if (recuerdo) recuerdo.set(donde, claves);
  return claves;
}

/**
 * EL AVANCE DE UNA ACTIVIDAD, TAL COMO LO VA A VER QUIEN PREGUNTA.
 *
 * «Marcados de convocados» solo quiere decir algo si las dos mitades cuentan
 * la misma gente que la lista que esa persona va a abrir. Antes no lo hacían:
 * el contador de la agenda sumaba TODOS los cuerpos convocados, sin mirar
 * quién preguntaba. A una encargada de un cuerpo de 49 personas, una actividad
 * que convoca a dos cuerpos le decía «200 / 98» —marcas ajenas arriba, gente
 * ajena abajo— y la barra quedaba en 204 %. Medido.
 *
 * Acá se cuenta exactamente lo que `/asistencias/:id/lista` va a mostrar:
 *
 *   · los integrantes de los cuerpos que le TOCAN (los convocados que además
 *     tiene asignados; todos, si no tiene ninguno asignado);
 *   · más quien ya tiene marca aunque haya salido del cuerpo —la lista lo
 *     sigue mostrando, con la etiqueta «(ya no figura)»—, con la misma regla
 *     que usa la lista para decidir si se lo muestra o no.
 *
 * De ahí sale que `marcados` nunca pueda pasar de `convocados`: toda marca que
 * se cuenta arriba tiene su fila abajo.
 */
function avanceDe(actividad, db, usuario, marcas, recuerdo) {
  const leTocan = cuerposQueLeTocan(actividad, usuario).map(Number);
  const todo = loAlcanzaTodo(usuario);

  let convocados = 0;
  for (const cuerpoId of leTocan) convocados += clavesDelCuerpo(db, cuerpoId, recuerdo).size;

  const cuenta = { presentes: 0, ausentes: 0, justificados: 0, visitas: 0 };
  for (const m of marcas) {
    const quien = clavePersona(m);
    if (!quien) continue; // marca sin persona: la lista tampoco la muestra
    /*
     * La visita se cuenta aparte y no entra en ninguna de las dos mitades.
     * No es del cuerpo: ni engrosa el padrón —nadie la esperaba— ni cuenta
     * como marcada, o el avance diría que la lista va más adelantada de lo
     * que va.
     */
    if (Number(m.visita) === 1) { cuenta.visitas += 1; continue; }
    const cuerpoId = Number(m.cuerpo_id) || 0;
    const estaEnElCuerpo = leTocan.includes(cuerpoId) && clavesDelCuerpo(db, cuerpoId, recuerdo).has(quien);
    if (!estaEnElCuerpo) {
      // Salió del cuerpo después de que le marcaran. La lista lo muestra
      // igual, siempre que ese cuerpo sea de los que esta persona pasa.
      if (!todo && !leTocan.includes(cuerpoId)) continue;
      convocados += 1;
    }
    if (m.estado === 'Presente') cuenta.presentes += 1;
    else if (m.estado === 'Ausente') cuenta.ausentes += 1;
    else if (m.estado === 'Justificado') cuenta.justificados += 1;
  }

  const marcados = cuenta.presentes + cuenta.ausentes + cuenta.justificados;
  return { convocados, marcados, ...cuenta };
}

/**
 * El avance de UNA actividad, buscando sus marcas.
 *
 * Es lo que usan los campos calculados del listado, donde no hay una tanda de
 * actividades por la que repartir una sola consulta. El resultado se guarda en
 * el recuerdo de la respuesta: las cuatro columnas —presentes, ausentes,
 * justificados y el porcentaje— preguntan lo mismo, y así se calcula una vez.
 */
function avanceDeUna(actividad, db, usuario, recuerdo) {
  const donde = `asistencia:avance:${actividad.id}`;
  if (recuerdo && recuerdo.has(donde)) return recuerdo.get(donde);
  const marcas = db
    .prepare('SELECT miembro_id, no_miembro_id, cuerpo_id, estado, visita FROM asistencia_detalle WHERE asistencia_id = ?')
    .all(actividad.id);
  const av = avanceDe(actividad, db, usuario, marcas, recuerdo);
  if (recuerdo) recuerdo.set(donde, av);
  return av;
}

/**
 * QUEDA CONSTANCIA DE QUIEN CORRIGIÓ UNA LISTA YA PASADA.
 *
 * Cambiar a alguien de presente a ausente tres meses después no dejaba rastro
 * en ninguna parte: la asistencia no está entre los módulos que vigila el
 * Registro de Cambios, y no puede estarlo. Vigilar la tabla de marcas
 * significaría una línea por persona y por actividad —treinta mil líneas en
 * una iglesia mediana, y de a montones cada vez que alguien guarda—, y eso
 * sepultaría el registro en vez de servirlo.
 *
 * Así que se anota lo que de verdad se quiere poder consultar después: una
 * línea por corrección, con quién la hizo, de qué lista y qué cambió. Pasar
 * una lista por primera vez NO se anota —eso queda en las propias marcas, en
 * `tomada_en` y `tomada_por`—; lo que se anota es haber cambiado lo que ya
 * estaba puesto.
 */
function anotarLaCorreccion(actividad, corregidas, db, usuario) {
  if (!corregidas.length) return;
  const { anotarCambio } = require('../bitacora');
  const nombres = require('../nombres');
  const { personaDeClave } = require('../integrantes');

  const nombreDe = (clave) => {
    const { miembro_id: miembroId, no_miembro_id: noMiembroId } = personaDeClave(String(clave).split(':')[0]);
    const f = noMiembroId
      ? db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(noMiembroId)
      : db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(miembroId);
    return f ? nombres.paraMostrar(f.nombres, f.apellidos) : 'Alguien que ya no está';
  };
  const comoQueda = (estado, motivo) => {
    if (!estado) return 'sin marcar';
    return motivo ? `${estado} (${motivo})` : estado;
  };

  /*
   * Se nombra a los primeros y se cuentan los demás. Una corrección de tres
   * marcas se lee entera; una de ochenta —alguien que rehízo la lista— dejaría
   * una línea de dos mil caracteres que nadie va a leer, así que se resume.
   */
  const ALCANZAN = 5;
  const detalle = corregidas.slice(0, ALCANZAN)
    .map((c) => `${nombreDe(c.clave)}: ${comoQueda(c.antes.estado, c.antes.motivo)} → ${comoQueda(c.ahora.estado, c.ahora.motivo)}`)
    .join(' · ');
  const resto = corregidas.length - ALCANZAN;

  const cuerposTocados = [...new Set(corregidas.map((c) => Number(c.cuerpoId) || 0))]
    .map((id) => (id ? (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(id) || {}).nombre : null))
    .filter(Boolean);
  const deQuien = cuerposTocados.length ? ` de ${cuerposTocados.join(' y ')}` : '';

  anotarCambio({
    def: module.exports,
    accion: 'Corrección de lista',
    fila: actividad,
    usuario,
    detalle: `Corrigió ${corregidas.length} marca(s) de la lista${deQuien}`
      + `: ${detalle}${resto > 0 ? ` · y ${resto} más` : ''}`,
  });
}

/**
 * QUIÉN PASÓ ESTA LISTA Y CUÁNDO, y quién la corrigió después.
 *
 * Se saca de las propias marcas: la primera que se puso —`tomada_en` más
 * antiguo— dice cuándo se tomó la lista y quién la tomó; el `updated_at` más
 * reciente que no coincida con su `tomada_en` dice que alguien la corrigió
 * después, y quién.
 *
 * Acotado a los cuerpos que le tocan a quien pregunta: quien lleva Damas ve
 * quién pasó la lista de Damas, no la del otro cuerpo convocado.
 */
function quienLaPaso(actividad, db, usuario) {
  const leTocan = cuerposQueLeTocan(actividad, usuario).map(Number);
  const cuales = loAlcanzaTodo(usuario) ? null : leTocan; // el administrador ve toda la actividad
  const acota = cuales ? ` AND cuerpo_id IN (${cuales.map(() => '?').join(',')})` : '';
  if (cuales && !cuales.length) return null;

  const nombreDe = (id) => {
    if (!id) return null;
    const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
    return u ? require('../nombres').acortar(u.nombre) : null;
  };

  const primera = db.prepare(
    `SELECT tomada_en, tomada_por FROM asistencia_detalle
      WHERE asistencia_id = ?${acota} AND tomada_en IS NOT NULL
      ORDER BY tomada_en ASC, id ASC LIMIT 1`
  ).get(actividad.id, ...(cuales || []));
  if (!primera) return null;

  /*
   * Una corrección es una marca que se volvió a escribir DESPUÉS de puesta:
   * su última escritura es posterior a la primera vez que se marcó. No hace
   * falta margen ninguno, porque las dos horas las pone el mismo reloj en la
   * misma transacción: en la pasada original salen iguales.
   */
  const ultima = db.prepare(
    `SELECT updated_at, created_by FROM asistencia_detalle
      WHERE asistencia_id = ?${acota} AND updated_at IS NOT NULL
        AND tomada_en IS NOT NULL AND updated_at > tomada_en
      ORDER BY updated_at DESC, id DESC LIMIT 1`
  ).get(actividad.id, ...(cuales || []));

  return {
    en: primera.tomada_en,
    por: nombreDe(primera.tomada_por),
    corregida_en: ultima ? ultima.updated_at : null,
    corregida_por: ultima ? nombreDe(ultima.created_by) : null,
  };
}

/**
 * Cuenta las marcas de una actividad. Las VISITAS van aparte: dejan constancia
 * de que estuvieron, pero no son del cuerpo y no le mueven el porcentaje.
 */
function conteo(asistenciaId, db, cuerpos) {
  const acota = cuerpos && cuerpos.length ? ` AND cuerpo_id IN (${cuerpos.map(() => '?').join(',')})` : '';
  const filas = db
    .prepare(
      `SELECT estado, COALESCE(visita, 0) AS visita, COUNT(*) AS n
         FROM asistencia_detalle WHERE asistencia_id = ?${acota} GROUP BY estado, COALESCE(visita, 0)`
    )
    .all(asistenciaId, ...(acota ? cuerpos : []));
  const de = (e) => (filas.find((f) => f.estado === e && !f.visita) || {}).n || 0;
  const presentes = de('Presente');
  const ausentes = de('Ausente');
  const justificados = de('Justificado');
  const visitas = filas.filter((f) => f.visita).reduce((n, f) => n + f.n, 0);
  return { presentes, ausentes, justificados, visitas, total: presentes + ausentes + justificados };
}

module.exports = {
  name: 'asistencias',
  label: 'Asistencias',
  labelSingular: 'Actividad',
  icon: '📋',
  group: 'Reuniones',
  order: 10,
  // Todo lo de asistencia —crear actividades, pasar lista e informes— vive en
  // una sola pantalla, la de Asistencia, así que este módulo no ocupa además
  // un lugar propio en el menú.
  menu: false,
  display: '{tipo_reunion} — {fecha}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['tipo_reunion', 'nombre', 'lugar', 'observaciones'],
  listFields: ['fecha', 'cuerpos', 'tipo_reunion', 'nombre', 'presentes', 'ausentes', 'justificados', 'porcentaje'],
  filterFields: ['tipo_reunion'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  /*
   * ── UNA ACTIVIDAD PUEDE SER DE DOS CONGREGACIONES ──
   *
   * Su columna `iglesia_id` se toma del PRIMER cuerpo convocado —una actividad
   * tiene que quedar anotada en algún sitio— y eso sirve para decir dónde pasó,
   * no para decidir quién la alcanza. Sin esta línea, una jornada que convoca a
   * un cuerpo de cada iglesia quedaba entera en una de las dos: medido, la
   * encargada de la otra recibía un 403 al abrir la lista de SU PROPIO cuerpo,
   * la actividad no le aparecía en el listado y su informe de ese día decía
   * cero presentes y cero actividades.
   *
   * Se alcanza también por los cuerpos convocados, y «alcanzar un cuerpo» es
   * alcanzarlo con las reglas de siempre: no se abre nada nuevo, se admite lo
   * que esa persona ya podía ver. Es la misma regla con que un traspaso entre
   * dos iglesias se alcanza por sus dos cuentas.
   */
  alcance: { tambienPor: [{ modulo: 'cuerpos', campo: 'cuerpos', varios: true }] },

  computed: [
    { name: 'presentes', label: 'Presentes', type: 'texto', calc: (r, o) => String(avanceDeUna(r, o.db, o.usuario, o.recuerdo).presentes) },
    { name: 'ausentes', label: 'Ausentes', type: 'texto', calc: (r, o) => String(avanceDeUna(r, o.db, o.usuario, o.recuerdo).ausentes) },
    { name: 'justificados', label: 'Justificados', type: 'texto', calc: (r, o) => String(avanceDeUna(r, o.db, o.usuario, o.recuerdo).justificados) },
    {
      /**
       * EL PORCENTAJE ES SOBRE LOS CONVOCADOS, NO SOBRE LOS MARCADOS.
       *
       * Antes se dividía por los marcados, así que una lista recién empezada
       * —una persona de cuarenta y nueve, presente— salía «100 %» y en verde,
       * y la misma marca puesta en ausente la dejaba en «0 %». Ninguno de los
       * dos números describía lo que pasó en esa reunión. Medido.
       *
       * Y una lista a medio pasar ahora se dice como tal —«12 de 49
       * marcados»— en vez de disfrazarse de resultado: el porcentaje recién
       * significa algo cuando están todos marcados. El módulo ya distinguía
       * «Sin lista»; faltaba distinguir «a medias».
       */
      name: 'porcentaje', label: 'Asistencia', type: 'badge',
      calc: (r, { db, usuario, recuerdo }) => {
        const av = avanceDeUna(r, db, usuario, recuerdo);
        if (!av.convocados) return { texto: 'Sin integrantes', nivel: 'gris' };
        if (!av.marcados) return { texto: 'Sin lista', nivel: 'gris' };
        if (av.marcados < av.convocados) {
          return { texto: `${av.marcados} de ${av.convocados} marcados`, nivel: 'parcial' };
        }
        const pct = Math.round((av.presentes / av.convocados) * 100);
        return { texto: `${pct}%`, nivel: pct >= 80 ? 'ok' : pct >= 60 ? 'medio' : 'bajo' };
      },
    },
  ],

  fields: [
    // Una actividad se programa antes de que ocurra: admite fecha adelante.
    { name: 'fecha', label: 'Fecha', type: 'date', required: true, futuro: true },
    {
      name: 'cuerpos', label: 'Cuerpos convocados', type: 'multiref', ref: 'cuerpos', required: true,
      help: 'A una actividad puede asistir más de un cuerpo. Se pasará lista a los integrantes de todos los elegidos.',
    },
    {
      name: 'tipo_reunion', label: 'Actividad', type: 'select', required: true,
      /*
       * Los tipos los mantiene la iglesia (módulo «Tipos de Actividad»), así
       * que salen de una ruta y no de una lista escrita acá. Los que había
       * quedaron sembrados tal cual, y las actividades siguen guardando el
       * NOMBRE: si mañana un tipo se renombra o se desactiva, lo ya registrado
       * sigue diciendo lo que decía.
       */
      optionsRoute: '/tipos_actividad/opciones',
      /*
       * Y la lista se comprueba al guardar, no solo se ofrece (v1.352.0).
       * El desplegable acotaba lo que se ve en el navegador y nada más: por la
       * API entraba cualquier texto —medido: «Tipo Que No Existe», 201— y un
       * informe agrupado por tipo empezaba a mostrar filas que nadie creó.
       * Declarando de qué tabla sale la lista, el motor la comprueba contra
       * ella y de paso deja el nombre escrito como está en la lista.
       */
      opcionesDe: { modulo: 'tipos_actividad', columna: 'nombre', label: 'Tipos de Actividad' },
      // La que viene elegida se fija en Configuración; si la guardada ya no
      // existe en la lista, se usa la primera y no una que el select no ofrece.
      get default() {
        const suya = require('../ajustes').obtener('asistencia_actividad_defecto');
        const hay = require('../actividades').losQueSeUsan();
        return hay.includes(suya) ? suya : (hay[0] || TIPOS_DE_ACTIVIDAD[0]);
      },
    },
    {
      name: 'nombre', label: 'Nombre de la actividad', type: 'text',
      help: 'Opcional: cómo se llamó esta actividad («Jornada de jóvenes», «Encuentro de varones»). '
        + 'En blanco, se reconoce por su tipo y su cuerpo.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma del cuerpo elegido.',
    },
    { name: 'hora_inicio', label: 'Hora', type: 'time' },
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { existing, db, id, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const ids = idsDeCuerpos(dato('cuerpos'));
      if (!ids.length) return 'Indique al menos un cuerpo convocado a la actividad';
      // La iglesia se toma del primer cuerpo, para que la actividad y sus
      // integrantes queden en la misma congregación
      const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(ids[0]);
      if (cuerpo && cuerpo.iglesia_id) data.iglesia_id = cuerpo.iglesia_id;

      /*
       * Y si ya hay una igual ese día, se pregunta (ver «QUÉ ES LA MISMA
       * ACTIVIDAD», arriba). También al editar: mover una actividad al día en
       * que ya está la misma deja las dos listas exactamente igual de
       * duplicadas que crearla de nuevo, y por ese lado no entraba nadie a
       * mirar. La propia actividad no se cuenta como su gemela.
       */
      if (!confirmado) {
        const fecha = dato('fecha');
        const otras = lasQueYaEstaban(db, {
          fechas: [fecha ? String(fecha).slice(0, 10) : null],
          tipo_reunion: dato('tipo_reunion'),
          cuerpos: ids,
          hora_inicio: dato('hora_inicio'),
        }, id);
        const otra = otras.values().next().value;
        if (otra) return avisoDeActividadRepetida(db, otra);
      }
      return null;
    },

    /**
     * Si cambia la fecha, las marcas ya tomadas quedan al día.
     *
     * La iglesia de cada marca sale de SU CUERPO y no de la actividad (ver
     * `laIglesiaDe`): acá se vuelve a poner por si el cuerpo cambió de
     * congregación. Las que no tienen cuerpo se quedan con la de la actividad,
     * que es lo único que se sabe de ellas.
     */
    afterSave(fila, { db }) {
      db.prepare('UPDATE asistencia_detalle SET fecha = ? WHERE asistencia_id = ?').run(fila.fecha, fila.id);
      db.prepare(
        `UPDATE asistencia_detalle
            SET iglesia_id = COALESCE((SELECT iglesia_id FROM cuerpos WHERE id = asistencia_detalle.cuerpo_id), ?)
          WHERE asistencia_id = ?`
      ).run(fila.iglesia_id || null, fila.id);
    },

    /**
     * Borrar una actividad se lleva su lista, y eso se pregunta antes.
     *
     * El gancho hacía el borrado de las marcas él mismo y devolvía `null`: ni
     * preguntaba ni contaba. Medido en la v1.374.0 sobre una actividad con la
     * lista pasada: cincuenta marcas, borrar sin confirmar contestó 200, las
     * cincuenta se fueron, y la constancia del Registro de Cambios nombraba la
     * fecha, los cuerpos, el tipo y el nombre —y ni una palabra de las marcas—.
     *
     * Ahora se pregunta, diciendo cuántas son y de qué reunión, y —esto es lo
     * otro— se dejan de borrar acá: las arrastra el motor, que es quien las
     * CUENTA y deja escrito «Se llevó consigo N registro(s)» en la constancia.
     * Hacerlo a mano era lo que dejaba esa línea muda.
     *
     * Una actividad sin lista no pregunta nada: no hay nada que perder.
     */
    beforeDelete(fila, { db, confirmado }) {
      if (confirmado) return null;
      const cuantas = db
        .prepare('SELECT COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ?')
        .get(fila.id).n;
      if (!cuantas) return null;
      const { comoSeLee } = require('../fechas');
      return {
        error: `Esta actividad tiene ${cuantas} marca(s) de asistencia tomadas`
          + `${fila.fecha ? ` el ${comoSeLee(fila.fecha)}` : ''}, y se van con ella: `
          + 'quién estuvo, quién faltó y quién se justificó, con su motivo. '
          + 'Eso no se puede deshacer, y los informes de ese período dejan de contarlo. '
          + 'Si la actividad no ocurrió, bórrela; si ocurrió y la lista está mal, corrija la lista.',
        confirmar: 'actividad_con_lista',
      };
    },
  },

  extraRoutes(router, { db, requirePerm, can }) {
    /**
     * Actividades a las que hay que pasar lista, para la pantalla de toma de
     * asistencia: las de los últimos dos meses y las que vienen, con cuántos
     * integrantes convoca cada una y cuántos van marcados.
     *
     * Es lo primero que se abre desde el teléfono, así que responde todo lo
     * necesario de una vez: no hace falta entrar a cada actividad para saber
     * cuál falta.
     */
    /**
     * La agenda de asistencia: las actividades de un período —normalmente el
     * mes que se está mirando en el calendario—, con cuántos integrantes
     * convoca cada una y cuántos van marcados.
     *
     * Es lo que alimenta el módulo de Asistencia completo, así que responde
     * de una vez todo lo que la pantalla necesita: no hace falta entrar a
     * cada actividad para saber cuál falta ni quién puede marcarla.
     */
    /**
     * Las actividades a las que fue convocado un cuerpo, para poder enlazarlas
     * desde su acta.
     *
     * Se ofrece la actividad aunque haya convocado a varios cuerpos: el coro
     * puede haber participado en un aniversario junto a otros cinco, y esa
     * actividad es igual de válida para el acta del coro. Lo que después se
     * mira de ella —quién asistió— sí sale acotado a la gente de ese cuerpo
     * (ver la ruta del acta).
     *
     * Salen primero las más recientes, que es lo que se está por levantar en
     * acta, y se acotan con el mismo alcance que todo lo demás.
     */
    router.get('/asistencias/de-cuerpo', requirePerm('asistencias', 'view'), (req, res) => {
      const cuerpoId = Number(req.query.cuerpo_id) || 0;
      if (!cuerpoId) return res.json([]);

      const alcance = require('../alcance');
      const { getModule } = require('../registry'); // tardío: evita ciclo con el registro
      // El cuerpo tiene que ser de los suyos: si no, esta ruta diría qué
      // actividades tiene un cuerpo ajeno con solo escribir su número.
      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.json([]);
      if (!alcance.alcanza(getModule('cuerpos'), cuerpo, req.user)) {
        return res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
      }

      const params = [cuerpoId];
      const cond = ['EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value = ?)'];
      const suyo = alcance.condiciones(module.exports, req.user, params);
      if (suyo) cond.push(suyo);

      const filas = db
        .prepare(`SELECT * FROM asistencias WHERE ${cond.join(' AND ')} ORDER BY fecha DESC, id DESC LIMIT 400`)
        .all(...params);

      res.json(filas.map((a) => ({
        id: a.id,
        // Se nombra como se busca: por la fecha primero, que es lo que uno
        // recuerda de una reunión, y después de qué fue.
        label: `${require('../formato').fechaLarga(a.fecha)} · ${a.tipo_reunion || 'Actividad'}`
          + (a.lugar ? ` (${a.lugar})` : ''),
      })));
    });

    /**
     * Quiénes de UN CUERPO estuvieron en esta actividad.
     *
     * Es lo que mira un acta al enlazar su reunión. La actividad puede haber
     * convocado a seis cuerpos —el coro cantando en un aniversario—, y en el
     * acta del coro tienen que salir los del coro y nadie más: por eso se pide
     * el cuerpo y se recorta por él.
     *
     * Los tres estados van separados, no contados: un acta necesita nombrar a
     * los que faltaron y a los que se excusaron, con su motivo. Ese motivo es
     * justamente el dato que se perdía cuando la lista se escribía a mano en el
     * campo «Asistentes», que solo sabía guardar nombres.
     */
    router.get('/asistencias/:id(\\d+)/por-cuerpo', requirePerm('asistencias', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const { getModule } = require('../registry'); // tardío: evita ciclo con el registro

      const actividad = alcance.registroSuyo(req, res, 'asistencias', req.params.id, 'Esa actividad');
      if (!actividad) return;

      const cuerpoId = Number(req.query.cuerpo_id) || 0;
      if (!cuerpoId) return res.status(400).json({ error: 'Falta decir de qué cuerpo.' });
      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.status(404).json({ error: 'Cuerpo no encontrado' });
      if (!alcance.alcanza(getModule('cuerpos'), cuerpo, req.user)) {
        return res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
      }

      const convocados = idsDeCuerpos(actividad.cuerpos);
      const nombres = require('../nombres');
      const filas = db
        .prepare(
          `SELECT d.estado, d.motivo, d.detalle, m.id, m.nombres, m.apellidos
             FROM asistencia_detalle d
             JOIN miembros m ON m.id = d.miembro_id
            WHERE d.asistencia_id = ? AND d.cuerpo_id = ?
            ORDER BY m.apellidos, m.nombres`
        )
        .all(actividad.id, cuerpoId);

      const comoSale = (f) => ({
        id: f.id,
        nombre: nombres.paraMostrar(f.nombres, f.apellidos),
        motivo: f.motivo || null,
        detalle: f.detalle || null,
      });

      res.json({
        actividad: {
          id: actividad.id,
          tipo: actividad.tipo_reunion,
          fecha: actividad.fecha,
          lugar: actividad.lugar || null,
          cuantos_cuerpos: convocados.length,
        },
        cuerpo: { id: cuerpo.id, nombre: cuerpo.nombre },
        // Se dice si el cuerpo estaba convocado: enlazar una actividad a la que
        // no fue es una equivocación que conviene ver antes de guardar
        convocado: convocados.includes(cuerpoId),
        presentes: filas.filter((f) => f.estado === 'Presente').map(comoSale),
        ausentes: filas.filter((f) => f.estado === 'Ausente').map(comoSale),
        justificados: filas.filter((f) => f.estado === 'Justificado').map(comoSale),
        sin_marcar: filas.length === 0,
      });
    });

    router.get('/asistencias/agenda', requirePerm('asistencias', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const params = [];
      const cond = [];
      if (req.query.desde) {
        cond.push('fecha >= ?');
        params.push(String(req.query.desde).slice(0, 10));
      }
      if (req.query.hasta) {
        cond.push('fecha <= ?');
        params.push(String(req.query.hasta).slice(0, 10));
      }
      if (req.query.tipo) {
        cond.push('tipo_reunion = ?');
        params.push(String(req.query.tipo));
      }
      if (req.query.cuerpo_id) {
        cond.push('EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value = ?)');
        params.push(Number(req.query.cuerpo_id));
      }
      const suyo = alcance.condiciones(module.exports, req.user, params);
      if (suyo) cond.push(suyo);

      const filas = db
        .prepare(
          `SELECT * FROM asistencias ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
            ORDER BY fecha DESC, hora_inicio DESC LIMIT 400`
        )
        .all(...params);

      /*
       * Las marcas de todas las actividades de una vez, y los integrantes de
       * cada cuerpo una sola vez.
       *
       * Antes esto era una consulta por actividad y un recorrido de los
       * integrantes por cada cuerpo de cada actividad: la agenda de un año
       * —153 actividades sobre 12 cuerpos— costaba 300 ms. Ahora es una
       * consulta y doce recorridos.
       */
      const ids = filas.map((a) => a.id);
      const porActividad = new Map(ids.map((id) => [id, []]));
      for (let i = 0; i < ids.length; i += 400) {
        const tanda = ids.slice(i, i + 400);
        if (!tanda.length) break;
        const marcas = db
          .prepare(
            `SELECT asistencia_id, miembro_id, no_miembro_id, cuerpo_id, estado, visita
               FROM asistencia_detalle WHERE asistencia_id IN (${tanda.map(() => '?').join(',')})`
          )
          .all(...tanda);
        for (const m of marcas) porActividad.get(m.asistencia_id).push(m);
      }
      const recuerdo = new Map();

      const nombreCuerpo = db.prepare('SELECT id, nombre FROM cuerpos WHERE id = ?');
      const actividades = filas.map((a) => {
        const av = avanceDe(a, db, req.user, porActividad.get(a.id) || [], recuerdo);
        return {
          id: a.id,
          fecha: a.fecha,
          hora_inicio: a.hora_inicio || null,
          tipo_reunion: a.tipo_reunion,
          nombre: a.nombre || null,
          lugar: a.lugar || null,
          observaciones: a.observaciones || null,
          iglesia_id: a.iglesia_id || null,
          cuerpos: idsDeCuerpos(a.cuerpos).map((id) => nombreCuerpo.get(id)).filter(Boolean),
          convocados: av.convocados,
          marcados: av.marcados,
          presentes: av.presentes,
          ausentes: av.ausentes,
          justificados: av.justificados,
          // Quienes estuvieron sin ser del cuerpo: van aparte del avance
          visitas: av.visitas,
        };
      });

      res.json({
        actividades,
        tipos: TIPOS_DE_ACTIVIDAD,
        // Cada cuánto se puede repetir una actividad. Va desde acá y no escrito
        // en la pantalla: quien manda sobre las reglas es quien las calcula.
        reglas_de_repeticion: require('../asistencia-repeticion').REGLAS,
        puede_marcar: can(req.user, 'asistencia_detalle', 'create') && can(req.user, 'asistencia_detalle', 'edit'),
        puede_crear: can(req.user, 'asistencias', 'create'),
        puede_editar: can(req.user, 'asistencias', 'edit'),
        puede_eliminar: can(req.user, 'asistencias', 'delete'),
      });
    });

    /**
     * Integrantes de todos los cuerpos convocados, con la marca que ya
     * tengan. Quien pertenece a dos de esos cuerpos aparece una sola vez.
     */
    router.get('/asistencias/:id(\\d+)/lista', requirePerm('asistencias', 'view'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!require('../alcance').alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const leTocan = cuerposQueLeTocan(actividad, req.user);
      const convocados = integrantesConvocados(actividad, db, req.user);
      const marcas = db.prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ?').all(actividad.id);
      const porPar = new Map(marcas.map((m) => [claveDe(m, m.cuerpo_id), m]));

      /*
       * Quien ya tiene marca pero salió del cuerpo se sigue mostrando, siempre
       * que su marca sea de un cuerpo que a esta persona le toque pasar. Y las
       * VISITAS, que nunca estuvieron en el cuerpo pero estuvieron ahí.
       *
       * «Que le toque» es la pregunta completa —sus cuerpos y sus iglesias— y
       * no solo la de los cuerpos asignados. Con la pregunta a medias, la
       * encargada de una congregación abría una actividad compartida y recibía
       * las cincuenta marcas del cuerpo de la otra, cada una con su nombre y su
       * estado; medido antes de esto: 51 personas donde le tocaba 1.
       */
      const alcance3 = require('../alcance');
      for (const m of marcas) {
        const clave = claveDe(m, m.cuerpo_id);
        if (!clave || clave.startsWith(':')) continue; // marca sin persona: no se muestra
        if (convocados.has(clave)) continue;
        if (!alcance3.alcanzaCuerpo(req.user, m.cuerpo_id)) continue;
        const cuerpo = m.cuerpo_id ? db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(m.cuerpo_id) : null;
        const esNo = !!Number(m.no_miembro_id);
        const ficha = esNo
          ? db.prepare('SELECT id, nombres, apellidos, rut FROM no_miembros WHERE id = ?').get(m.no_miembro_id)
          : db.prepare('SELECT id, nombres, apellidos, rut, foto FROM miembros WHERE id = ?').get(m.miembro_id);
        if (!ficha) continue;
        const esVisita = Number(m.visita) === 1;
        convocados.set(clave, {
          persona_tipo: esNo ? 'No miembro' : 'Miembro',
          miembro_id: esNo ? null : Number(m.miembro_id),
          no_miembro_id: esNo ? Number(m.no_miembro_id) : null,
          nombres: ficha.nombres,
          apellidos: ficha.apellidos,
          rut: ficha.rut || null,
          foto: ficha.foto || null,
          cuerpo_id: m.cuerpo_id || null,
          visita: esVisita,
          cuerpo: esVisita
            ? (cuerpo ? cuerpo.nombre : 'Sin cuerpo')
            : (cuerpo ? `${cuerpo.nombre} (ya no figura)` : 'Sin cuerpo'),
        });
      }

      /**
       * Una fila por persona Y POR CUERPO.
       *
       * Quien está en dos de los cuerpos convocados sale dos veces, con la
       * etiqueta de cada uno, y se le marca por separado en cada lista: puede
       * quedar justificado en el cuerpo al que avisó y ausente en el que no.
       * La `clave` es lo que identifica a cada fila —el mismo miembro ya no
       * alcanza—, y con ella viaja la marca de ida y de vuelta.
       */
      const personas = [...convocados.entries()]
        .map(([clave, donde]) => {
          const marca = porPar.get(clave) || {};
          return {
            clave,
            persona_tipo: donde.persona_tipo,
            miembro_id: donde.miembro_id || null,
            no_miembro_id: donde.no_miembro_id || null,
            nombre: nombres.paraMostrar(donde.nombres, donde.apellidos),
            rut: donde.rut || null,
            foto: donde.foto || null,
            cuerpo_id: donde.cuerpo_id,
            cuerpo: donde.cuerpo,
            // Estuvo, pero no es del cuerpo: no cuenta en el porcentaje
            visita: !!donde.visita,
            estado: marca.estado || null,
            motivo: marca.motivo || null,
            detalle: marca.detalle || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.cuerpo || '').localeCompare(b.cuerpo || '') || a.nombre.localeCompare(b.nombre));

      const cuerpos = leTocan.map((id) => {
        const c = db.prepare('SELECT id, nombre FROM cuerpos WHERE id = ?').get(id);
        return c ? { id: c.id, nombre: c.nombre } : null;
      }).filter(Boolean);
      // Cuando la actividad convoca a más cuerpos de los que le tocan, se dice
      const convocadosEnTotal = idsDeCuerpos(actividad.cuerpos).length;

      res.json({
        actividad: {
          id: actividad.id, fecha: actividad.fecha, tipo: actividad.tipo_reunion,
          cuerpos,
          solo_los_suyos: cuerpos.length < convocadosEnTotal,
          cuerpos_convocados: convocadosEnTotal,
        },
        personas,
        // Quién pasó esta lista y cuándo, y quién la corrigió después
        tomada: quienLaPaso(actividad, db, req.user),
        motivos_con_detalle: motivosConDetalle(),
        puede_marcar: can(req.user, 'asistencia_detalle', 'create') && can(req.user, 'asistencia_detalle', 'edit'),
      });
    });

    /**
     * A QUIÉN SE PUEDE SUMAR COMO VISITA a una lista.
     *
     * Se busca entre los dos registros —la membresía y quienes sirven sin
     * estar inscritos— de las iglesias que uno alcanza, y se dejan fuera los
     * que ya están en la lista: convocados o ya anotados.
     *
     * Se busca por IGLESIA y no por cuerpo, a diferencia del listado de
     * miembros. Es a propósito: el caso que esto viene a resolver es
     * justamente el de alguien de OTRO cuerpo que pasó, y buscarlo entre los
     * del cuerpo propio no lo encontraría nunca.
     */
    router.get('/asistencias/:id(\\d+)/quien-puede-visitar', requirePerm('asistencia_detalle', 'edit'), (req, res) => {
      const alcance = require('../alcance');
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!alcance.alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const buscar = String(req.query.buscar || '').trim();
      if (buscar.length < 2) return res.json({ gente: [], corto: true });

      const suyas = alcance.iglesiasDe(req.user);
      const porIglesia = suyas.length ? ` AND iglesia_id IN (${suyas.map(() => '?').join(',')})` : '';
      const como = `%${buscar.replace(/[%_]/g, ' ')}%`;
      const soloDigitos = buscar.replace(/[^0-9kK]/g, '');

      const buscarEn = (tabla, tipo) => db
        .prepare(
          `SELECT id, nombres, apellidos, rut, iglesia_id FROM "${tabla}"
            WHERE (nombres || ' ' || COALESCE(apellidos, '') LIKE ?
                   OR REPLACE(REPLACE(COALESCE(rut, ''), '.', ''), '-', '') LIKE ?)${porIglesia}
            ORDER BY apellidos, nombres LIMIT 25`
        )
        .all(como, `%${soloDigitos}%`, ...suyas)
        .map((f) => ({
          persona_tipo: tipo,
          miembro_id: tipo === 'Miembro' ? f.id : null,
          no_miembro_id: tipo === 'Miembro' ? null : f.id,
          nombre: require('../nombres').paraMostrar(f.nombres, f.apellidos),
          rut: f.rut || null,
          clave: clavePersona(tipo === 'Miembro' ? { miembro_id: f.id } : { no_miembro_id: f.id }),
        }));

      // Los que ya están en la lista no se ofrecen: ni los convocados ni los
      // que alguien ya anotó, para no proponer una fila que ya existe
      const yaEstan = new Set([
        ...[...integrantesConvocados(actividad, db, req.user).values()].map((p) => clavePersona(p)),
        ...db.prepare('SELECT miembro_id, no_miembro_id FROM asistencia_detalle WHERE asistencia_id = ?')
          .all(actividad.id).map((m) => clavePersona(m)),
      ]);

      const gente = [...buscarEn('miembros', 'Miembro'), ...buscarEn('no_miembros', 'No miembro')]
        .filter((p) => !yaEstan.has(p.clave))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .slice(0, 25);

      res.json({
        gente,
        // A qué cuerpos se la puede sumar: los que a esta persona le toca pasar
        cuerpos: cuerposQueLeTocan(actividad, req.user)
          .map((id) => db.prepare('SELECT id, nombre FROM cuerpos WHERE id = ?').get(id))
          .filter(Boolean),
      });
    });

    /**
     * Guarda de una vez todas las marcas de la actividad.
     *
     * Se rige por el permiso de "Toma de Asistencia", no por el de crear
     * actividades: quien solo pasa lista no necesita poder crearlas.
     *
     * IMPORTANTE — se mandan **solo las marcas que esa persona cambió**, no la
     * lista entera. Cada marca que llega manda sobre lo guardado para esa
     * persona: con estado, se anota; sin estado, se borra. Si se mandara la
     * lista completa, quien la abrió antes borraría en blanco todo lo que otro
     * hubiera marcado mientras tanto —dos secretarios pasando la misma lista, o
     * la misma persona con el teléfono y el computador abiertos—.
     *
     * La respuesta trae cómo quedó la lista, para que la pantalla se ponga al
     * día con lo que hayan hecho los demás.
     */
    router.post('/asistencias/:id(\\d+)/lista', requirePerm('asistencia_detalle', 'edit'), (req, res) => {
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!require('../alcance').alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const marcas = Array.isArray(req.body && req.body.marcas) ? req.body.marcas : null;
      if (!marcas) return res.status(400).json({ error: 'No se recibió ninguna marca' });

      const validos = ['Presente', 'Ausente', 'Justificado'];
      for (const m of marcas) {
        if (!m.miembro_id && !m.no_miembro_id) {
          return res.status(400).json({ error: 'Falta indicar a quién corresponde una de las marcas' });
        }
        if (m.estado && !validos.includes(m.estado)) {
          return res.status(400).json({ error: `Estado no válido: ${m.estado}` });
        }
        if (m.estado === 'Justificado') {
          if (!m.motivo) return res.status(400).json({ error: 'Indique el motivo de cada justificación' });

          /*
           * Y EL MOTIVO TIENE QUE SER UNO DE LA LISTA (v1.363.0).
           *
           * Ésta es la puerta por la que entran TODAS las marcas: escribe
           * derecho en la base, sin pasar por el guardado del módulo, así que
           * declarar la lista en el campo no alcanzaba acá. Medido antes de
           * esto: «Motivo Que No Existe» entró con un 200, uno desactivado
           * también, y «enfermedad» en minúscula quedó como se escribió
           * —y el informe agrupa por el texto guardado, así que salía como un
           * motivo aparte—.
           *
           * Se pregunta con la MISMA cuenta que usa el motor para los demás
           * desplegables (server/opciones.js): dos maneras de comparar habrían
           * sido dos verdades.
           */
          const cual = require('./asistencia_detalle').LA_LISTA_DE_MOTIVOS;
          const enLaLista = require('../opciones').laFilaDeLaLista(db, cual, m.motivo);
          if (!enLaLista) {
            return res.status(400).json({
              error: `«${m.motivo}» no está en Motivos de Ausencia. Elija uno de la lista, o créelo primero en Motivos de Ausencia.`,
            });
          }
          if (!enLaLista.activo) {
            return res.status(400).json({
              error: `«${enLaLista.valor}» ya no está en uso en Motivos de Ausencia. `
                + 'Elija otro de la lista, o vuelva a marcarlo «En uso» en Motivos de Ausencia.',
            });
          }
          m.motivo = enLaLista.valor;   // una sola forma de escribirlo

          // A la FILA, no a una lista de nombres: ver `pideExplicacion` en
          // server/modules/asistencia_detalle.js.
          if (require('./asistencia_detalle').pideExplicacion(db, m.motivo)
              && !String(m.detalle || '').trim()) {
            return res.status(400).json({ error: `El motivo "${m.motivo}" necesita que se especifique el detalle` });
          }
        }
      }

      // A qué cuerpo pertenece cada persona en esta actividad (no se toma del
      // cliente: se resuelve aquí, con los cuerpos que le tocan a quien marca)
      const convocados = integrantesConvocados(actividad, db, req.user);

      /**
       * Y no se acepta una marca de alguien que no está convocado.
       *
       * Esta comprobación existía, pero corría dentro de un `if (suyos.length)`:
       * solo se le hacía a quien tiene cuerpos asignados. A la cuenta de
       * administrador —que no tiene ninguno, a propósito— no se le comprobaba
       * nada. Se midió lo que eso permitía:
       *
       *   marcar a un miembro de OTRA iglesia ...  se guardaba, y con la
       *                                            iglesia de la actividad
       *   marcar al miembro número 999999 .......  se guardaba, y sumaba en
       *                                            el porcentaje de asistencia
       *
       * Nadie llega a eso haciendo clic —la pantalla solo muestra a los
       * convocados—, pero es la misma raíz que dejaba datos colgando: lo que
       * la pantalla no ofrece, el servidor igual lo aceptaba. Y ensuciaba
       * justo el dato que después se lee como porcentaje.
       *
       * La regla ahora vale para todos: se marca a quien está convocado en los
       * cuerpos que a uno le tocan. La excepción es corregir una marca que ya
       * está puesta —de un cuerpo que después salió de la actividad, o de
       * alguien que desde entonces se retiró—, porque quitar esa marca es
       * justamente lo que hay que poder hacer.
       */
      /**
       * Una marca que llega SIN cuerpo se resuelve acá.
       *
       * Pasa con los teléfonos que todavía tienen guardada la versión anterior
       * de la pantalla: el aparato sigue mandando lo de antes —solo la
       * persona— hasta que la aplicación se le actualiza, y esas listas no se
       * pueden perder. Se le pone el primero de los cuerpos convocados al que
       * esa persona pertenece, que es exactamente lo que hacía el sistema
       * antes; los demás cuerpos quedan sin marcar, como quedaban entonces.
       */
      const primerCuerpoDe = (quien) => {
        for (const cuerpoId of cuerposQueLeTocan(actividad, req.user)) {
          if (convocados.has(claveDe(quien, cuerpoId))) return cuerpoId;
        }
        return null;
      };
      for (const m of marcas) {
        if (m.cuerpo_id === undefined || m.cuerpo_id === null || m.cuerpo_id === '') {
          m.cuerpo_id = primerCuerpoDe(m);
        }
      }

      const yaMarcados = new Map(
        db.prepare('SELECT miembro_id, no_miembro_id, cuerpo_id, visita FROM asistencia_detalle WHERE asistencia_id = ?')
          .all(actividad.id)
          .map((m) => [claveDe(m, m.cuerpo_id), m])
      );

      /*
       * LAS VISITAS: quien estuvo sin ser del cuerpo.
       *
       * La comprobación de abajo —solo se marca a quien está convocado— es la
       * que impide ensuciar el porcentaje con gente que no corresponde, y se
       * queda. A una visita no se le aplica porque una visita es, por
       * definición, alguien que no está convocado; a cambio lleva sus propias
       * dos reglas:
       *
       *   · se suma a la lista de un cuerpo QUE A UNO LE TOCA PASAR, no a
       *     cualquiera de la actividad;
       *   · y la persona tiene que ser de una IGLESIA que uno alcance. No se
       *     pide que sea de sus cuerpos, porque el caso es justamente el de
       *     alguien de otro cuerpo que pasó.
       *
       * Una marca que ya está guardada como visita sigue siéndolo aunque la
       * corrección no lo repita: así, corregirle el estado a una visita no la
       * convierte en integrante del cuerpo sin que nadie lo pida.
       */
      const leTocan = cuerposQueLeTocan(actividad, req.user).map(Number);
      const alcance2 = require('../alcance');
      for (const m of marcas) {
        const yaEsta = yaMarcados.get(claveDe(m, m.cuerpo_id));
        if (yaEsta && Number(yaEsta.visita) === 1) m.visita = true;
        if (!m.visita) continue;
        if (!leTocan.includes(Number(m.cuerpo_id))) {
          return res.status(403).json({
            error: 'Una visita se suma a la lista de un cuerpo que le toca pasar a usted.',
          });
        }
        const esNo = !!Number(m.no_miembro_id);
        const ficha = esNo
          ? db.prepare('SELECT id, nombres, apellidos, iglesia_id FROM no_miembros WHERE id = ?').get(Number(m.no_miembro_id))
          : db.prepare('SELECT id, nombres, apellidos, iglesia_id FROM miembros WHERE id = ?').get(Number(m.miembro_id));
        if (!ficha) return res.status(400).json({ error: 'Esa visita no está en el sistema.' });
        if (!alcance2.alcanzaIglesia(req.user, ficha.iglesia_id)) {
          return res.status(403).json({ error: 'Esa persona no es de una iglesia que usted tenga asignada.' });
        }
      }

      // La comprobación es por PAR persona-cuerpo: marcar a alguien en un
      // cuerpo al que no pertenece es tan ajeno como marcar a un desconocido
      const ajeno = marcas.find((m) => {
        if (m.visita) return false; // una visita no está convocada: de eso se trata
        const clave = claveDe(m, m.cuerpo_id);
        if (convocados.has(clave)) return false;
        if (!yaMarcados.has(clave)) return true; // ni convocado ni marcado antes
        // Corregir una marca ya puesta se permite solo si su cuerpo le toca:
        // la pregunta completa, sus cuerpos Y sus iglesias. Con la pregunta a
        // medias, la encargada de una congregación podía corregir las marcas
        // del cuerpo de la otra en una actividad compartida.
        return !require('../alcance').alcanzaCuerpo(req.user, yaMarcados.get(clave).cuerpo_id);
      });
      if (ajeno) {
        const esNo = !!Number(ajeno.no_miembro_id);
        const quien = esNo
          ? db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(Number(ajeno.no_miembro_id))
          : db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(Number(ajeno.miembro_id));
        if (!quien) {
          return res.status(400).json({
            error: `Hay una marca de una persona que no está en el sistema `
              + `(n.º ${esNo ? ajeno.no_miembro_id : ajeno.miembro_id}).`,
          });
        }
        const nombre = require('../nombres').paraMostrar(quien.nombres, quien.apellidos);
        return res.status(403).json({
          error: loAlcanzaTodo(req.user)
            ? `${nombre} no está en ninguno de los cuerpos convocados a esta actividad.`
            : `${nombre} no es de los cuerpos que a usted le toca pasar. Solo puede pasar lista a los suyos.`,
        });
      }
      /*
       * Cómo estaba cada marca ANTES de guardar.
       *
       * Sirve para dos cosas que no se pueden hacer después de borrar: saber
       * qué cambió de verdad —para anotarlo en el Registro de Cambios— y
       * arrastrar cuándo se marcó por primera vez y quién la marcó.
       */
      const comoEstaba = new Map(
        db.prepare(
          `SELECT miembro_id, no_miembro_id, cuerpo_id, estado, motivo, tomada_en, tomada_por
             FROM asistencia_detalle WHERE asistencia_id = ?`
        ).all(actividad.id).map((m) => [claveDe(m, m.cuerpo_id), m])
      );

      const corregidas = [];   // lo que ya estaba puesto y quedó distinto
      const guardar = db.transaction(() => {
        /**
         * Se borra y se inserta por PAR persona-cuerpo.
         *
         * Antes se borraba por persona, así que marcarla en un cuerpo le
         * borraba la marca del otro: eran incompatibles sin que nada lo
         * dijera. Ahora cada cuerpo lleva la suya, y la misma persona puede
         * quedar justificada en uno y ausente en el otro.
         */
        const borrar = db.prepare(
          `DELETE FROM asistencia_detalle
            WHERE asistencia_id = ? AND COALESCE(miembro_id, 0) = ? AND COALESCE(no_miembro_id, 0) = ?
              AND COALESCE(cuerpo_id, 0) = ?`
        );
        const insertar = db.prepare(
          `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, no_miembro_id,
                                           estado, motivo, detalle,
                                           cuerpo_id, fecha, iglesia_id, created_by,
                                           tomada_en, tomada_por, updated_at, visita)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const ahora = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
        let guardadas = 0;
        for (const m of marcas) {
          const clave = claveDe(m, m.cuerpo_id);
          const donde = convocados.get(clave);
          const yaEsta = yaMarcados.get(clave);
          // Una visita no está entre los convocados: su cuerpo es aquel a cuya
          // lista se la sumó, que ya se comprobó que le toca a quien marca
          const cuerpoId = m.visita
            ? Number(m.cuerpo_id) || null
            : (donde && donde.cuerpo_id) || (yaEsta && Number(yaEsta.cuerpo_id)) || null;
          // La marca es de UNO de los dos registros: el otro lado va en blanco
          const noMiembroId = Number(m.no_miembro_id) || null;
          const miembroId = noMiembroId ? null : Number(m.miembro_id) || null;
          const antes = comoEstaba.get(clave);
          if (antes && (antes.estado !== (m.estado || null) || (antes.motivo || null) !== (m.motivo || null))) {
            corregidas.push({ clave, cuerpoId, antes, ahora: m });
          }
          borrar.run(actividad.id, miembroId || 0, noMiembroId || 0, Number(cuerpoId) || 0);
          if (!m.estado) continue; // sin marcar: no queda fila
          const justificado = m.estado === 'Justificado';
          insertar.run(
            actividad.id, noMiembroId ? 'No miembro' : 'Miembro', miembroId, noMiembroId, m.estado,
            justificado ? m.motivo : null,
            justificado && motivosConDetalle().includes(m.motivo) ? String(m.detalle).trim() : null,
            cuerpoId, actividad.fecha, laIglesiaDe(cuerpoId, actividad), req.user.id,
            // La marca se vuelve a escribir, pero se queda con la fecha y el
            // nombre de la primera vez: es lo único que dice cuándo se tomó
            // esta lista, porque `created_at` pasa a ser el de la corrección.
            (antes && antes.tomada_en) || ahora,
            (antes && antes.tomada_por) || req.user.id,
            /*
             * La hora de ESTA escritura, puesta a mano y con el mismo reloj
             * que `tomada_en`. Dejarla en el valor por omisión de la columna
             * la calcula en otro momento, y una lista larga podía cruzar el
             * cambio de segundo: la marca quedaba escrita «después» de haber
             * sido puesta, y la pantalla anunciaba una corrección que nadie
             * había hecho. Con las dos del mismo reloj, en la primera pasada
             * son iguales y una corrección es exactamente lo que se ve
             * distinto.
             */
            ahora,
            m.visita ? 1 : 0
          );
          guardadas++;
        }
        return guardadas;
      });

      const guardadas = guardar.immediate();
      anotarLaCorreccion(actividad, corregidas, db, req.user);
      // Se devuelve cómo quedó la lista completa: así, si mientras esta
      // persona marcaba lo suyo otra marcó lo de ella, la pantalla lo muestra
      // en vez de quedarse con una foto vieja.
      res.json({
        ok: true,
        guardadas,
        marcas: marcasVisibles(actividad, db, req.user),
        tomada: quienLaPaso(actividad, db, req.user),
        // El conteo, acotado a lo que a esta persona le toca: los mismos
        // cuerpos con que se le arma la lista y se le devuelven las marcas
        ...conteo(actividad.id, db, loAlcanzaTodo(req.user) ? null : cuerposQueLeTocan(actividad, req.user)),
      });
    });

    /**
     * REPITE UNA ACTIVIDAD EN LAS FECHAS QUE LE SIGUEN.
     *
     * Se copia una actividad QUE YA EXISTE, no unos datos que llegan sueltos.
     * Es a propósito: esa actividad ya pasó por el motor —sus cuerpos son de
     * los que esta persona alcanza, su iglesia es una de las suyas, su tipo
     * está en uso—, así que copiarla no puede colar nada que crearla a mano no
     * dejaría pasar. Nada de eso hay que volver a comprobar acá.
     *
     * Cada fecha da una actividad INDEPENDIENTE. No se arma una serie con
     * dueño: cambiarle el lugar a un domingo o suspender otro es lo que pasa de
     * verdad, y una serie obligaría a preguntar en cada pantalla si el cambio
     * es de una o de todas.
     */
    router.post('/asistencias/:id(\\d+)/repetir', requirePerm('asistencias', 'create'), (req, res) => {
      const repeticion = require('../asistencia-repeticion');
      const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(req.params.id);
      if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada' });
      if (!require('../alcance').alcanza(module.exports, actividad, req.user)) {
        return res.status(403).json({ error: 'Esa actividad está fuera de lo que tiene asignado' });
      }

      const regla = String((req.body && req.body.regla) || '');
      const hasta = String((req.body && req.body.hasta) || '').slice(0, 10);
      if (!repeticion.REGLAS.some((r) => r.valor === regla)) {
        return res.status(400).json({ error: 'Indique cada cuánto se repite.' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        return res.status(400).json({ error: 'Indique hasta qué fecha se repite.' });
      }
      if (hasta <= actividad.fecha) {
        return res.status(400).json({ error: 'La fecha de término tiene que ser posterior a la de la actividad.' });
      }

      const fechas = repeticion.fechasQueSiguen(actividad.fecha, regla, hasta);
      if (!fechas.length) {
        return res.status(400).json({ error: 'Entre esas dos fechas no se repite ninguna vez.' });
      }

      /*
       * Un día que ya tiene esta misma actividad no se duplica.
       *
       * Pasa al repetir dos veces lo mismo —se probó, se borró la mitad y se
       * volvió a intentar—, y una lista duplicada es peor que no tenerla: la
       * gente marca en una y el informe cuenta las dos.
       *
       * La pregunta la contesta `lasQueYaEstaban` (ver «QUÉ ES LA MISMA
       * ACTIVIDAD», arriba), que es la misma que usa el formulario desde la
       * v1.378.0. Acá se comparaba el JSON de los cuerpos letra por letra, así
       * que «[3,10]» y «[10,3]» —la misma convocatoria— no se parecían en
       * nada; ahora basta con que compartan un cuerpo, que es de quien se
       * duplicaría la lista. La diferencia se ve: acá no se pregunta, se salta
       * el día y se dice cuántos fueron.
       */
      const yaEstaban = new Set(lasQueYaEstaban(db, {
        fechas,
        tipo_reunion: actividad.tipo_reunion,
        cuerpos: actividad.cuerpos,
        hora_inicio: actividad.hora_inicio,
      }, actividad.id).keys());
      const porCrear = fechas.filter((f) => !yaEstaban.has(f));

      const crear = db.prepare(
        `INSERT INTO asistencias (fecha, hora_inicio, tipo_reunion, nombre, cuerpos, lugar, observaciones,
                                  iglesia_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const creadas = db.transaction(() => {
        const ids = [];
        for (const fecha of porCrear) {
          ids.push(crear.run(
            fecha, actividad.hora_inicio || null, actividad.tipo_reunion, actividad.nombre || null,
            actividad.cuerpos, actividad.lugar || null, actividad.observaciones || null,
            actividad.iglesia_id || null, req.user.id
          ).lastInsertRowid);
        }
        return ids;
      }).immediate();

      /*
       * UNA línea en el Registro de Cambios, no cuarenta.
       *
       * Las actividades se vigilan —cambiarle la fecha o los cuerpos a una que
       * ya tiene lista pasada no puede pasar en silencio—, pero armar el
       * calendario del año escribiría cuarenta líneas iguales y taparía todo lo
       * demás. Se anota el acto, que es lo que se va a buscar después.
       */
      if (creadas.length) {
        require('../bitacora').anotarCambio({
          def: module.exports,
          accion: 'Repetición',
          fila: actividad,
          usuario: req.user,
          detalle: `Creó ${creadas.length} actividad(es) más, ${repeticion.comoSeLee(actividad.fecha, regla)}`
            + `, hasta el ${hasta}`,
        });
      }

      res.json({
        ok: true,
        creadas: creadas.length,
        ya_estaban: yaEstaban.size,
        hasta: porCrear.length ? porCrear[porCrear.length - 1] : actividad.fecha,
        tope: fechas.length >= repeticion.TOPE,
        como_se_lee: repeticion.comoSeLee(actividad.fecha, regla),
      });
    });

    // ---- La planilla mensual de un cuerpo ----
    /**
     * La planilla mensual de un cuerpo: una columna por día del mes, para
     * imprimir apaisada. El cálculo está en server/planilla-asistencia.js;
     * acá se comprueba lo que se pide y quién lo pide.
     */
    router.get('/asistencias/hoja-mensual', requirePerm('asistencias', 'view'), (req, res) => {
      const alcance = require('../alcance');
      const planillaDeAsistencia = require('../planilla-asistencia');

      const cuerpoId = Number(req.query.cuerpo_id);
      const mes = String(req.query.mes || '').slice(0, 7); // AAAA-MM
      if (!cuerpoId) return res.status(400).json({ error: 'Falta indicar el cuerpo.' });
      if (!planillaDeAsistencia.mesValido(mes)) {
        return res.status(400).json({ error: 'El mes se indica como AAAA-MM (por ejemplo 2026-04).' });
      }

      const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.status(404).json({ error: 'Ese cuerpo no existe.' });
      // El mismo alcance del resto —iglesia y cuerpo—: no se mira la planilla
      // de un cuerpo ajeno. `getModule` se pide acá y no arriba para no cerrar
      // un ciclo con el registro de módulos.
      const { getModule } = require('../registry'); // tardío: evita ciclo con el registro
      if (!alcance.alcanza(getModule('cuerpos'), cuerpo, req.user)) {
        return res.status(403).json({ error: 'No tiene acceso a ese cuerpo.' });
      }

      res.json(planillaDeAsistencia.armar(db, cuerpo, mes));
    });

    // ---- Informes y promedios ----
    router.get('/asistencias/informe', requirePerm('asistencias', 'view'), (req, res) => {
      const { tipo = 'general', desde, hasta } = req.query;
      const cuerpoId = req.query.cuerpo_id ? Number(req.query.cuerpo_id) : null;
      const miembroId = req.query.miembro_id ? Number(req.query.miembro_id) : null;
      const noMiembroId = req.query.no_miembro_id ? Number(req.query.no_miembro_id) : null;
      // El informe por persona sirve para las dos: quien está inscrito y quien
      // sirve en un grupo sin estarlo
      const unaPersona = noMiembroId || miembroId;

      const cond = ['1 = 1'];
      const params = [];
      const alcance = require('../alcance');
      const suyas = alcance.iglesiasDe(req.user);
      if (suyas.length) {
        cond.push(`d.iglesia_id IN (${suyas.map(() => '?').join(',')})`);
        params.push(...suyas);
      }
      const susCuerpos = alcance.cuerposDe(req.user);
      if (susCuerpos.length) {
        cond.push(`d.cuerpo_id IN (${susCuerpos.map(() => '?').join(',')})`);
        params.push(...susCuerpos);
      }
      if (desde) { cond.push('d.fecha >= ?'); params.push(desde); }
      if (hasta) { cond.push('d.fecha <= ?'); params.push(hasta); }
      /*
       * POR TIPO DE ACTIVIDAD.
       *
       * Se podía acotar por cuerpo, por persona y por período, pero no por
       * tipo: con doce tipos configurados no había manera de contestar «¿cómo
       * anda la asistencia al Estudio Bíblico?», que es justo la pregunta que
       * hace que valga la pena tener tipos. Comprobado: pedir el informe
       * acotado a «Ensayo» devolvía las mismas 30.000 marcas que sin acotar,
       * porque el parámetro no existía.
       *
       * El tipo vive en la actividad, no en la marca. Va como subconsulta y no
       * como JOIN para que la condición sirva igual en las siete consultas de
       * abajo, algunas de las cuales ya traen sus propias uniones.
       *
       * Y se llama `tipo_actividad`, no `tipo`: `tipo` ya está tomado por QUÉ
       * INFORME se pide —general, por cuerpo, por persona—. Se probó con el
       * mismo nombre y las dos cosas se pisaron: el informe general se pedía a
       * sí mismo acotado a las actividades de tipo «general», que no existen,
       * y salía en cero. Se vio en la pantalla, no en las pruebas: ahí el
       * nombre habría estado igual de equivocado en los dos lados.
       */
      if (req.query.tipo_actividad) {
        cond.push('d.asistencia_id IN (SELECT id FROM asistencias WHERE tipo_reunion = ?)');
        params.push(String(req.query.tipo_actividad));
      }
      if (cuerpoId) { cond.push('d.cuerpo_id = ?'); params.push(cuerpoId); }
      if (noMiembroId) { cond.push('d.no_miembro_id = ?'); params.push(noMiembroId); }
      else if (miembroId) { cond.push('d.miembro_id = ?'); params.push(miembroId); }
      /*
       * Las VISITAS quedan fuera de los porcentajes del informe.
       *
       * Una visita deja constancia de que estuvo, pero no es del cuerpo: si
       * entrara en la cuenta, un domingo con quince visitas le subiría el
       * cumplimiento a un cuerpo que no hizo nada distinto. Se cuentan aparte,
       * más abajo.
       */
      const sinVisitas = 'COALESCE(d.visita, 0) = 0';
      const where = 'WHERE ' + cond.concat(sinVisitas).join(' AND ');
      const whereConVisitas = 'WHERE ' + cond.join(' AND ');

      const porcentajes = (f) => {
        const total = f.presentes + f.ausentes + f.justificados;
        const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
        return {
          ...f, total,
          pct_presente: pct(f.presentes),
          pct_ausente: pct(f.ausentes),
          pct_justificado: pct(f.justificados),
        };
      };
      const SUMAS = `
        COALESCE(SUM(CASE WHEN d.estado = 'Presente'    THEN 1 ELSE 0 END), 0) AS presentes,
        COALESCE(SUM(CASE WHEN d.estado = 'Ausente'     THEN 1 ELSE 0 END), 0) AS ausentes,
        COALESCE(SUM(CASE WHEN d.estado = 'Justificado' THEN 1 ELSE 0 END), 0) AS justificados`;

      /*
       * Cuántas personas distintas. Se cuenta por registro y número —'m7',
       * 'n7'—, no por número: el miembro n.º 7 y el no miembro n.º 7 son dos
       * personas, y contarlas como una dejaba corto el total de los grupos.
       */
      const QUIEN = `CASE WHEN d.no_miembro_id IS NOT NULL THEN 'n' || d.no_miembro_id
                          ELSE 'm' || d.miembro_id END`;
      const general = porcentajes(
        db.prepare(`SELECT ${SUMAS}, COUNT(DISTINCT d.asistencia_id) AS actividades,
                           COUNT(DISTINCT ${QUIEN}) AS personas
                      FROM asistencia_detalle d ${where}`).get(...params)
      );

      const porDia = db
        .prepare(`SELECT d.fecha, ${SUMAS}, COUNT(DISTINCT d.asistencia_id) AS actividades
                    FROM asistencia_detalle d ${where}
                   GROUP BY d.fecha ORDER BY d.fecha DESC LIMIT 400`)
        .all(...params)
        .map(porcentajes);

      // Una por una: en un mismo día puede haber varias actividades, y quien
      // pertenece a varios cuerpos puede estar en una y faltar a otra.
      const porActividad = db
        .prepare(`SELECT d.asistencia_id, d.fecha, a.tipo_reunion AS actividad, ${SUMAS}
                    FROM asistencia_detalle d LEFT JOIN asistencias a ON a.id = d.asistencia_id
                   ${where} GROUP BY d.asistencia_id ORDER BY d.fecha DESC, d.asistencia_id DESC LIMIT 400`)
        .all(...params)
        .map(porcentajes);

      /*
       * A CUÁNTA GENTE SE CONVOCÓ, para poder decir cuándo la lista quedó a
       * medio pasar.
       *
       * Los porcentajes de este informe se reparten entre los MARCADOS: de
       * quienes quedaron anotados, tanto por ciento estuvo. Es lo que
       * corresponde para un promedio de un período, pero en la fila de UNA
       * actividad engaña: una lista recién empezada —una persona de cuarenta
       * y nueve, presente— salía «100 %», y ese 100 % no describe nada de lo
       * que pasó en esa reunión. Medido.
       *
       * Con el padrón al lado, la pantalla puede decirlo: «1 de 49 marcados».
       * El porcentaje se deja como está —cambiarlo cambiaría el significado de
       * todas las demás filas—; lo que se agrega es con qué compararlo.
       *
       * En el informe de UNA PERSONA no se agrega: ahí «marcados» es ella
       * sola, y compararla con el padrón del cuerpo no diría nada.
       */
      if (!unaPersona) {
        const recuerdo = new Map();
        const traerActividad = db.prepare('SELECT * FROM asistencias WHERE id = ?');
        for (const f of porActividad) {
          const act = traerActividad.get(f.asistencia_id);
          if (!act) continue;
          const leTocan = cuerposQueLeTocan(act, req.user).map(Number);
          const cuales = cuerpoId ? leTocan.filter((c) => c === cuerpoId) : leTocan;
          let convocados = 0;
          for (const c of cuales) convocados += clavesDelCuerpo(db, c, recuerdo).size;
          f.convocados = convocados;
        }
      }

      const porCuerpo = db
        .prepare(`SELECT d.cuerpo_id, c.nombre AS cuerpo, ${SUMAS},
                         COUNT(DISTINCT d.asistencia_id) AS actividades
                    FROM asistencia_detalle d LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                   ${where} GROUP BY d.cuerpo_id ORDER BY c.nombre`)
        .all(...params)
        .map(porcentajes)
        .map(conElCuerpoNombrado);

      // Una fila por persona, salga del registro que salga
      const porMiembro = db
        .prepare(`SELECT d.miembro_id, d.no_miembro_id,
                         COALESCE(m.nombres, n.nombres) AS nombres,
                         COALESCE(m.apellidos, n.apellidos) AS apellidos,
                         COALESCE(m.rut, n.rut) AS rut, ${SUMAS}
                    FROM asistencia_detalle d
                    LEFT JOIN miembros m ON m.id = d.miembro_id
                    LEFT JOIN no_miembros n ON n.id = d.no_miembro_id
                   ${where} GROUP BY ${QUIEN} ORDER BY apellidos, nombres`)
        .all(...params)
        .map((f) => porcentajes({
          ...f,
          miembro: nombres.paraMostrar(f.nombres, f.apellidos),
          persona_tipo: f.no_miembro_id ? 'No miembro' : 'Miembro',
        }));

      const porMotivo = db
        .prepare(`SELECT COALESCE(d.motivo, 'Sin motivo') AS motivo, COUNT(*) AS n
                    FROM asistencia_detalle d ${where} AND d.estado = 'Justificado'
                   GROUP BY d.motivo ORDER BY n DESC`)
        .all(...params);

      // Cuando alguien pertenece a varios cuerpos, su porcentaje se abre por
      // cuerpo: en uno puede andar al día y en otro no.
      let porMiembroCuerpo = [];
      if (unaPersona) {
        porMiembroCuerpo = db
          .prepare(`SELECT d.cuerpo_id, c.nombre AS cuerpo, ${SUMAS},
                           COUNT(DISTINCT d.asistencia_id) AS actividades
                      FROM asistencia_detalle d LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                     ${where} GROUP BY d.cuerpo_id ORDER BY c.nombre`)
          .all(...params)
          .map(porcentajes)
          .map(conElCuerpoNombrado);
      }

      /*
       * Cuántas visitas hubo, y quiénes. Van aparte de todo lo demás: no
       * suman en ningún porcentaje, pero de una visita lo que se quiere saber
       * es justamente que estuvo.
       */
      const visitas = db
        .prepare(`SELECT COUNT(*) AS n FROM asistencia_detalle d ${whereConVisitas} AND COALESCE(d.visita, 0) = 1`)
        .get(...params).n;

      // En el informe por persona se detallan sus marcas una por una
      let marcas = [];
      if (tipo === 'persona' && unaPersona) {
        /*
         * El detalle SÍ trae sus visitas, marcadas como tales.
         *
         * Sus porcentajes no las cuentan —no son de su cuerpo—, pero «estuve
         * como visita en el Coro el 4 de marzo» es información suya y no tiene
         * por qué desaparecer de su propia hoja.
         */
        marcas = db
          .prepare(`SELECT d.fecha, d.estado, d.motivo, d.detalle, COALESCE(d.visita, 0) AS visita,
                           a.tipo_reunion AS actividad, c.nombre AS cuerpo
                      FROM asistencia_detalle d
                      LEFT JOIN asistencias a ON a.id = d.asistencia_id
                      LEFT JOIN cuerpos c ON c.id = d.cuerpo_id
                     ${whereConVisitas} ORDER BY d.fecha DESC LIMIT 500`)
          .all(...params)
          .map(conElCuerpoNombrado);
      }

      res.json({
        tipo, desde: desde || null, hasta: hasta || null,
        // Por qué tipo de actividad quedó acotado, para que la pantalla y la
        // hoja impresa lo digan: un informe acotado que no se anuncia se lee
        // como si fuera el de todo
        tipo_actividad: req.query.tipo_actividad ? String(req.query.tipo_actividad) : null,
        visitas,
        general, porDia, porActividad, porCuerpo, porMiembro, porMiembroCuerpo, porMotivo, marcas,
      });
    });
  },
};

/**
 * Aparte de la definición del módulo, para no mezclarla con ella: son las
 * piezas que deciden quién aparece al pasar lista y cuánto lleva marcado esa
 * lista, y lo que hacen no se puede comprobar desde afuera sin levantar media
 * aplicación.
 */
module.exports.integrantesConvocados = integrantesConvocados;
module.exports.avanceDe = avanceDe;
/*
 * Y cómo se leen los cuerpos convocados de una actividad. Lo pide el libro de
 * actas para comprobar que el acta enlace la reunión a la que ese cuerpo fue;
 * el dueño de lo que significa ese campo es este módulo, así que la lectura
 * sale de acá y no se copia allá.
 */
module.exports.idsDeCuerpos = idsDeCuerpos;
/*
 * Y las dos preguntas que este módulo contesta sobre sí mismo y que conviene
 * poder hacerle sueltas: qué es «la misma actividad» y cómo se nombra el cuerpo
 * de una marca que no lo tiene.
 */
module.exports.lasQueYaEstaban = lasQueYaEstaban;
module.exports.comoSeLlamaElCuerpo = comoSeLlamaElCuerpo;
module.exports.SIN_CUERPO = SIN_CUERPO;
