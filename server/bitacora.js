/**
 * Registro automático en los historiales.
 *
 * Se conecta al motor CRUD: cada vez que se guarda un registro, anota en el
 * historial de quien corresponda lo que ocurrió. Hay tres historiales, uno
 * por cada cosa que tiene vida propia en la organización:
 *
 *   miembros  → bitacora              (la bitácora de cada persona)
 *   iglesias  → historial_iglesias    (la historia de cada congregación)
 *   pastores  → historial_pastores    (el recorrido ministerial)
 *
 * Y aparte de esos tres hay un cuarto libro, que no cuenta una historia sino
 * que responde una pregunta: el **Registro de Cambios**, donde queda anotado
 * quién tocó el dinero y los permisos —altas, cambios y eliminaciones—.
 *
 * Puede desactivarse desde la configuración del sistema
 * (bitacora_automatica), y en ese caso ninguno de los tres se escribe solo.
 */
const { db } = require('./db');
const ajustes = require('./ajustes');

/** La parte de fecha de un valor, o null si no es una fecha. */
const normalizarFecha = (valor) => require('./fechas').normalizar(valor);

/** Nombre de presentación de un miembro. */
function nombreMiembro(id) {
  const m = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  return m ? require('./nombres').paraMostrar(m.nombres, m.apellidos) : null;
}

/**
 * ------------------- La fecha que lleva cada anotación -------------------
 *
 * Un historial contesta «cuándo pasó esto», y hasta la 1.179.0 contestaba
 * «cuándo lo tecleó alguien». Medido sobre una miembro a la que se le hizo la
 * vida entera por la API: sus trece anotaciones automáticas llevaban UNA sola
 * fecha, la del día en que se hicieron, mientras sus fichas decían otra cosa.
 *
 *   la solicitud está fechada el .....  02-03-2026  → se anotaba el 29-08-2026
 *   la ayuda está fechada el .........  10-03-2026  → se anotaba el 29-08-2026
 *   el certificado se emitió el ......  15-03-2026  → se anotaba el 29-08-2026
 *   ingresó al cuerpo el .............  15-01-2026  → se anotaba el 29-08-2026
 *
 * Y no era un detalle de archivo: la pantalla ordena el historial por fecha, así
 * que la única anotación con una fecha escrita por una persona —la visita del 20
 * de marzo— quedaba al FINAL de la lista, debajo del ingreso al cuerpo de enero.
 * El historial de esa señora decía que primero salió del cuerpo y después la
 * visitaron, y que todo pasó el mismo día.
 *
 * La regla, que es la que sigue el resto del sistema:
 *
 *   · Lo que ocurrió y tiene fecha propia se anota EN SU FECHA. La solicitud,
 *     la ayuda, el certificado, el documento, el ingreso al cuerpo, el retiro,
 *     el cargo que se asume: cada uno la lleva escrita en su propia ficha.
 *
 *   · Lo que ocurrió HOY se anota hoy. Un cambio de datos, un cambio de estado,
 *     una aprobación: el hecho es que alguien lo hizo, y lo hizo hoy.
 *
 * Lo que se anote sin fecha —o con algo que no sea una fecha— cae en hoy, que
 * es lo que hacía siempre: la regla agrega precisión donde la hay y no cambia
 * nada donde no la había.
 */

/**
 * Escribe un registro automático en un historial cualquiera: se le indica en
 * qué tabla, con qué columna apunta a su dueño y de quién se trata.
 *
 * `fecha` es la del hecho. Si no viene, o no es una fecha, se usa la de hoy.
 */
function anotarEn(tabla, columna, id, { tipo, descripcion, iglesiaId, usuario, fecha }) {
  if (!id || !ajustes.activo('bitacora_automatica')) return;
  try {
    const tiene = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
    // El dueño primero; las demás, solo si la tabla las tiene. En el historial
    // de una iglesia el dueño ES la iglesia, así que no se repite.
    const pares = [[columna, id], ['tipo', tipo], ['descripcion', descripcion]];
    const opcional = (nombre, valor) => {
      if (nombre !== columna && tiene.has(nombre)) pares.push([nombre, valor]);
    };
    opcional('iglesia_id', iglesiaId || null);
    opcional('origen', 'Automático');
    opcional('registrado_por', usuario ? usuario.nombre : 'Sistema');
    opcional('created_by', usuario ? usuario.id : null);

    // La fecha del hecho si la hay, y si no la de hoy. Se comprueba con la
    // misma función con que el motor valida cualquier fecha del sistema: lo
    // que no sea una fecha de verdad no entra en una columna de fecha.
    const cuando = require('./fechas').normalizar(fecha);
    const columnas = ['fecha', ...pares.map(([c]) => c)].map((c) => `"${c}"`).join(', ');
    const marcas = [cuando ? '?' : "date('now','localtime')", ...pares.map(() => '?')].join(', ');
    const valores = [...(cuando ? [cuando] : []), ...pares.map(([, v]) => v)];
    db.prepare(`INSERT INTO "${tabla}" (${columnas}) VALUES (${marcas})`).run(...valores);
  } catch (e) {
    console.error(`No se pudo anotar en ${tabla}:`, e.message);
  }
}

/** Escribe un registro automático en la bitácora de un miembro. */
function anotar({ miembroId, tipo, descripcion, iglesiaId, usuario, fecha }) {
  if (!miembroId) return;
  if (!nombreMiembro(miembroId)) return; // el miembro ya no existe
  anotarEn('bitacora', 'miembro_id', miembroId, { tipo, descripcion, iglesiaId, usuario, fecha });
}

/** Escribe un registro automático en el historial de una iglesia. */
function anotarIglesia(iglesiaId, datos) {
  anotarEn('historial_iglesias', 'iglesia_id', iglesiaId, { ...datos, iglesiaId });
}

/** Escribe un registro automático en el historial de un pastor. */
function anotarPastor(pastorId, datos) {
  const pastor = pastorId ? db.prepare('SELECT iglesia_id FROM pastores WHERE id = ?').get(pastorId) : null;
  if (!pastor) return; // la ficha ya no existe
  anotarEn('historial_pastores', 'pastor_id', pastorId, { ...datos, iglesiaId: pastor.iglesia_id });
}

/**
 * Qué queda anotado en el Registro de Cambios.
 *
 * La regla tiene dos partes, y la diferencia entre las dos es a propósito:
 * anotarlo todo llenaría el registro de ruido y taparía justo lo que se
 * quiere encontrar.
 *
 * **Todo lo que se borra, en cualquier módulo.** Borrar es raro y no se
 * deshace, y con la ficha se va también su propio historial: si mañana falta
 * un miembro de la lista, el Registro de Cambios es el único lugar donde
 * puede quedar quién lo borró y qué decía. Por eso la eliminación se anota
 * aunque el módulo no esté en la lista de abajo.
 *
 * **Las creaciones y los cambios, solo donde importan**: el dinero, las
 * llaves del sistema y lo que no lleva historial propio —los cuerpos, sus
 * directivas, sus actas y quiénes los integran—. Miembros, pastores e
 * iglesias no están acá porque cada uno tiene su propia bitácora, que cuenta
 * lo mismo con más detalle y en el lugar donde se busca.
 */
const MODULOS_VIGILADOS = [
  // El dinero
  'tesoreria', 'cuentas_tesoreria', 'traspasos', 'cuotas_cuerpo', 'ayudas_sociales',
  /*
   * Y LAS PALABRAS CON QUE SE ESCRIBE EL DINERO.
   *
   * Las categorías de tesorería no son un módulo de listas más: son el
   * vocabulario con que queda clasificado cada peso que entra y sale. No
   * estaban acá, y eso dejaba anotada justo la operación que el módulo no deja
   * hacer y sin anotar las dos que sí cambian las cosas en silencio.
   *
   * MEDIDO en la v1.341.0, catorce cambios hechos en una misma sesión:
   *
   *   7 categorías borradas ........ 7 anotadas
   *   1 categoría renombrada ....... 0 anotadas
   *   6 categorías desactivadas .... 0 anotadas
   *
   * Los siete borrados quedaban porque TODO lo que se borra se anota, en
   * cualquier módulo —la regla de más arriba—, y borrar es precisamente lo que
   * el módulo frena cuando importa. Renombrar y desactivar, que son las dos que
   * pueden cambiar en silencio cómo queda clasificada la plata de la iglesia,
   * no dejaban rastro en ninguna parte: si dentro de un año el informe anual no
   * cuadra con el del año pasado, el Registro de Cambios no tenía la respuesta.
   *
   * Son pocas líneas al año —una iglesia tiene veintitantas categorías y las
   * toca de vez en cuando—, así que no hay ruido que temer acá.
   */
  'categorias_tesoreria',
  // Las llaves
  'usuarios', 'perfiles_permisos',
  // Lo que no tiene historial propio
  'cuerpos', 'directivas', 'actas_reuniones', 'actas_asambleas', 'integrantes_cuerpo',
  // Los documentos de identidad ministerial: quién la creó, la emitió, la
  // revocó y la volvió a imprimir tiene que poder consultarse después
  'credenciales',
  /*
   * La actividad, no sus marcas.
   *
   * Cambiarle la fecha o los cuerpos convocados a una actividad que ya tiene
   * lista pasada mueve o deja huérfanas las marcas de mucha gente, y eso no
   * dejaba rastro en ninguna parte. Son unas ciento cincuenta al año: cabe de
   * sobra en el registro.
   */
  'asistencias',
  /*
   * Y LA LISTA CON QUE SE CLASIFICAN.
   *
   * Es más discutible que en tesorería —la asistencia no es el libro de la
   * plata— pero renombrar o desactivar un tipo cambia cómo se lee un informe de
   * años, y desde la v1.353.0 renombrar uno en uso ARRASTRA las actividades a
   * su nombre nuevo. Que eso no dejara rastro en ninguna parte era justo lo que
   * pasaba con las categorías de tesorería antes de la v1.346.0.
   *
   * Son unas quince y se tocan de año en año: no hay ruido que temer.
   */
  'tipos_actividad',
];

/**
 * Lo único que se borra sin quedar anotado.
 *
 * Las marcas de asistencia se borran de a montones cada vez que alguien
 * corrige una lista, y anotarlas una por una sepultaría el registro. El
 * propio Registro de Cambios no se puede borrar, así que la línea sobra,
 * pero se deja escrita para que nadie la agregue por descuido.
 *
 * Que no se anote MARCA POR MARCA no significa que corregir una lista pase sin
 * dejar rastro: la toma de lista anota UNA línea por corrección —«Corrigió 2
 * marca(s) de la lista de Damas: Juan Pérez: Presente → Ausente»—, que es lo
 * que de verdad se quiere poder consultar después. Ver `anotarLaCorreccion` en
 * server/modules/asistencias.js. Por lo mismo, `asistencia_detalle` tampoco
 * puede entrar en MODULOS_VIGILADOS: serían treinta mil líneas.
 */
const BORRADOS_QUE_NO_SE_ANOTAN = ['asistencia_detalle', 'registro_cambios'];

/** Escribe una línea en el Registro de Cambios. */
function anotarCambio({ def, accion, fila, detalle, usuario }) {
  try {
    const { displayOf } = require('./registry');
    db.prepare(
      `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id, created_by)
       VALUES (date('now','localtime'), strftime('%H:%M','now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      def.label,
      accion,
      displayOf(def, fila).slice(0, 120),
      fila.id || null,
      detalle || null,
      usuario ? usuario.nombre : 'Sistema',
      fila.iglesia_id || null,
      usuario ? usuario.id : null
    );
  } catch (e) {
    console.error('No se pudo anotar en el registro de cambios:', e.message);
  }
}

/**
 * Un valor escrito como lo lee una persona: la plata con su signo y sus miles,
 * y una referencia con el nombre de aquello a lo que apunta, no con su número.
 * «Cuenta: 5» no le dice nada a nadie; «Cuenta: Tesorería general», sí.
 */
function legible(campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '(vacío)';
  if (campo.type === 'money') {
    const n = Number(valor);
    return Number.isFinite(n) ? `$\u00a0${n.toLocaleString('es-CL')}` : String(valor);
  }
  if (campo.type === 'number') {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toLocaleString('es-CL') : String(valor);
  }
  /*
   * Una fecha, como se lee acá y no como la guarda la base.
   *
   * Era lo único que se le escapaba a esta función: la plata salía con su
   * signo y sus miles, un enlace con el nombre de aquello a lo que apunta, una
   * lista con todos sus nombres, un sí o un no en vez de un uno o un cero… y
   * las fechas salían tal cual, «2005-11-06». Medido sobre la base de prueba:
   * 87 de 205 líneas del Registro de Cambios llevaban una fecha así escrita.
   *
   * Y no son las líneas que menos importan. Los ocho campos de fecha de una
   * ficha de miembro son el nacimiento, la conversión, el bautismo, el ingreso
   * a la iglesia, los dos matrimonios, el traslado y el fallecimiento: justo
   * las que alguien va a leer en voz alta.
   *
   * Lo que no sea una fecha de verdad se deja como está: en una columna vieja
   * puede haber cualquier cosa, y traducirla a medias sería inventar.
   */
  if (campo.type === 'date') {
    const { normalizar, comoSeLee } = require('./fechas');
    const fecha = normalizar(valor);
    return fecha ? comoSeLee(fecha) : String(valor);
  }
  if (campo.type === 'ref' && campo.ref) {
    try {
      const { getModule, displayOf } = require('./registry');
      const refDef = getModule(campo.ref);
      const fila = refDef && db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(valor);
      if (fila) return displayOf(refDef, fila);
    } catch (e) {
      /* si no se puede resolver, queda el número */
    }
  }
  /*
   * Un campo de varios enlaces se guarda como JSON —`[2,5]`—, y así salía
   * escrito en el registro: «Cuerpos convocados: [2]». Acá se resuelve a los
   * nombres, que es lo que el registro existe para poder leer después.
   */
  if (campo.type === 'multiref' && campo.ref) {
    try {
      const { getModule, displayOf } = require('./registry');
      const refDef = getModule(campo.ref);
      const ids = Array.isArray(valor) ? valor : JSON.parse(valor || '[]');
      if (refDef && Array.isArray(ids)) {
        const nombres = ids
          .map((id) => db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(Number(id)))
          .map((fila, i) => (fila ? displayOf(refDef, fila) : `#${ids[i]}`));
        return nombres.length ? nombres.join(', ') : '(ninguno)';
      }
    } catch (e) {
      /* si no se puede resolver, queda el texto tal cual */
    }
  }
  if (campo.type === 'boolean') return String(valor) === '1' ? 'Sí' : 'No';
  return String(valor);
}

/**
 * Un resumen de lo que traía un registro, para que su eliminación no quede
 * como una línea muda: el que revisa después necesita saber qué se borró.
 *
 * De los campos marcados como `sensible` —las enfermedades, las alergias, la
 * nota importante— se deja constancia de que traían algo, pero no de qué:
 * el Registro de Cambios lo leen el pastor y el tesorero, y los datos de
 * salud de una persona no tienen por qué quedar copiados ahí para siempre.
 *
 * ── QUÉ CAMPOS ENTRAN ──
 *
 * Por omisión, los del LISTADO. Es una elección heredada que para casi todos
 * los módulos alcanza —lo que identifica una ficha suele ser lo que se ve en
 * la tabla—, pero es una lista pensada para que quepa en columnas, no para
 * conservar nada. Medido en un acta de reunión firmada, con su agenda, su
 * desarrollo, sus acuerdos y el escaneo adjunto: de todo eso, la constancia
 * del borrado guardaba seis datos de cabecera y ni una palabra de lo acordado.
 * El acta decía qué se compró y por cuánto, y de eso no quedaba nada en
 * ninguna parte del sistema.
 *
 * Por eso un módulo puede nombrar además, en `camposAlBorrar`, lo que quiere
 * que se conserve de sus fichas cuando desaparecen. Van después de los del
 * listado, que es como se lee: primero de qué ficha se trata, después qué
 * decía. Y lo que el módulo pide expresamente se guarda AUNQUE SEA UN
 * ARCHIVO: el nombre de un adjunto no dice nada en una tabla —por eso los
 * archivos no entran solos—, pero cuando el archivo se borró con la ficha, su
 * nombre es justamente lo único que queda de él.
 *
 * SOLO AL BORRAR, y de ahí el nombre. Esta misma función arma también la línea
 * de la CREACIÓN, y ahí el texto completo del acta sobra: la ficha existe, se
 * abre y se lee. Copiarlo igual llenaba el registro de párrafos repetidos que
 * nadie iba a mirar dos veces. Es la única copia lo que hay que guardar, no
 * cualquier copia.
 */
function resumenDe(def, fila, alBorrar) {
  const pedidos = alBorrar ? (def.camposAlBorrar || []) : [];
  /*
   * Sin repetir: un campo puede estar en las DOS listas y entonces salía dos
   * veces en la misma línea. Pasa con los adjuntos y es casi obligado que
   * pase: un módulo que muestra el archivo en su listado y además quiere
   * conservar su nombre al borrar tiene que nombrarlo en los dos sitios, porque
   * los archivos no entran solos en la constancia. Se vio en la Oficina de
   * Partes, cuyo listado muestra el escaneo: la constancia del borrado decía
   * «Documento digitalizado: …» al principio y otra vez al final.
   */
  return [...new Set([...(def.listFields || []), ...pedidos])]
    .map((nombre) => {
      const campo = def.fields.find((f) => f.name === nombre);
      if (!campo || campo.type === 'password') return null;
      if (campo.type === 'file' && !pedidos.includes(nombre)) return null;
      if (campo.sensible) {
        const traia = fila[nombre];
        return traia === null || traia === undefined || traia === '' ? null : `${campo.label}: (tenía dato)`;
      }
      const valor = fila[nombre];
      if (valor === null || valor === undefined || valor === '') return null;
      return `${campo.label}: ${legible(campo, valor)}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * Lista legible de los campos que cambiaron entre dos versiones de un
 * registro. De los campos marcados como `sensible` —los datos de salud, la
 * nota importante— solo se deja constancia de que cambiaron: su contenido no
 * se copia al historial.
 */
/**
 * ¿Estos dos valores dicen lo mismo?
 *
 * Comparados como texto a secas, una LISTA MÚLTIPLE vacía no se parece a sí
 * misma: en la base está en blanco y el formulario la manda como «[]», y el
 * registro anotaba un cambio que no ocurrió. Medido en un acta de reunión: su
 * primera edición —cualquiera, aunque solo se corrigiera una coma— dejaba la
 * línea «Asistentes (escritos a mano): (vacío) → (ninguno)», de un campo que ya
 * ni siquiera se muestra en el formulario. Quien lee el registro entiende que
 * alguien tocó los asistentes; no cambió nada, cambió la manera de escribir
 * «nada».
 *
 * Es menor y corroe justo lo que hace útil a un registro de cambios: que cada
 * línea signifique algo. Si la mitad son ruido, se deja de leer.
 *
 * Se comparan los ids y no el texto, así que «[]», el blanco y el nulo son lo
 * mismo. El ORDEN se conserva a propósito: ninguna de las listas de este
 * sistema lo usa hoy, pero ordenarlas acá escondería un cambio real el día que
 * alguna sí lo use, y ese es el error caro de los dos.
 */
function mismoValor(campo, uno, otro) {
  if (campo.type === 'multiref') {
    const ids = (v) => {
      if (Array.isArray(v)) return v.map(Number).filter(Boolean).join(',');
      try { return JSON.parse(v || '[]').map(Number).filter(Boolean).join(','); } catch (e) { return String(v ?? ''); }
    };
    return ids(uno) === ids(otro);
  }
  return String(uno ?? '') === String(otro ?? '');
}

function cambios(def, antes, despues) {
  const lista = [];
  for (const f of def.fields) {
    if (f.type === 'password' || f.name === 'foto') continue;
    if (!(f.name in despues)) continue;
    const previo = antes[f.name];
    const nuevo = despues[f.name];
    if (mismoValor(f, previo, nuevo)) continue;
    if (f.sensible) {
      lista.push(`${f.label}: ${nuevo ? 'actualizada' : 'borrada'}`);
      continue;
    }
    lista.push(`${f.label}: ${legible(f, previo)} → ${legible(f, nuevo)}`);
  }
  return lista;
}

/**
 * Se llama desde el motor CRUD después de guardar un registro de cualquier
 * módulo. Traduce el hecho a una anotación en la bitácora del miembro.
 */
/**
 * Lo que se le anota a alguien cuando su ficha de integrante cambia de estado.
 *
 * Hay DOS caminos que llevan al mismo hecho: cambiarle el estado a mano en su
 * ficha, y aprobar o rechazar su evaluación de período de prueba. Los dos
 * tienen que dejar escrito lo mismo, así que el texto se arma en un solo sitio
 * y no en cada camino, donde podrían separarse sin que nadie lo note.
 */
function loQueLePasaAlIntegrante(estado, nombreCuerpo, { motivo, hasta } = {}) {
  if (estado === 'Activo') {
    return { tipo: 'Anotación', descripcion: `Queda como integrante oficial de "${nombreCuerpo}".` };
  }
  if (estado === 'Retirado') {
    return {
      tipo: 'Salida de cuerpo',
      descripcion: `Sale de "${nombreCuerpo}"${motivo ? ` (${motivo})` : ''}.`,
    };
  }
  if (estado === 'En prueba') {
    // La evaluación que extiende la prueba sabe hasta cuándo; el cambio a mano no.
    const { comoSeLee } = require('./fechas');
    return {
      tipo: 'Anotación',
      descripcion: hasta
        ? `Se le extiende el período de prueba en "${nombreCuerpo}" hasta el ${comoSeLee(hasta)}.`
        : `Vuelve a período de prueba en "${nombreCuerpo}".`,
    };
  }
  return null;
}

/**
 * El paso que decidió una evaluación de período de prueba.
 *
 * La evaluación mueve la ficha del integrante con un UPDATE directo —tiene que
 * hacerlo, porque escribe campos de solo lectura—, y por ese camino el motor no
 * se entera: medido contra el servidor, aprobar la evaluación de una miembro
 * dejaba su ficha en Activo con su fecha y su bitácora con las mismas dos
 * anotaciones de antes. La decisión más importante que se toma sobre alguien en
 * un cuerpo era la única que no quedaba escrita en su historial.
 *
 * Se anota con la FECHA DE LA EVALUACIÓN, que es el día en que se decidió y la
 * misma que queda en la ficha.
 */
function anotarPasoDeIntegrante(integranteId, { estado, fecha, usuario, hasta }) {
  const ficha = integranteId
    ? db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(integranteId)
    : null;
  if (!ficha) return;
  const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);
  const que = loQueLePasaAlIntegrante(estado, cuerpo ? cuerpo.nombre : 'un cuerpo',
    { motivo: ficha.motivo_retiro, hasta });
  if (!que) return;
  // A quien no está inscrito en la membresía no se le anota nada: en los grupos
  // sirve gente de fuera del registro, y esa gente no tiene bitácora. De eso ya
  // se encarga `anotar`, que se niega sin miembro.
  anotar({ miembroId: ficha.miembro_id, iglesiaId: ficha.iglesia_id, usuario, fecha, ...que });
}

function registrarGuardado(def, { isNew, antes, despues, datos, user }) {
  const iglesia = despues.iglesia_id || null;

  // 0. El dinero y las llaves, en el Registro de Cambios
  if (MODULOS_VIGILADOS.includes(def.name)) {
    if (isNew) {
      anotarCambio({ def, accion: 'Creación', fila: despues, usuario: user, detalle: resumenDe(def, despues) });
    } else {
      const lista = cambios(def, antes, datos);
      if (lista.length) {
        anotarCambio({ def, accion: 'Cambio', fila: despues, usuario: user, detalle: lista.join(' · ') });
      }
    }
  }

  // 1. El propio miembro: alta y cambios de sus datos
  if (def.name === 'miembros') {
    if (isNew) {
      anotar({ miembroId: despues.id, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: 'Alta del miembro en el sistema.' });
    } else {
      let lista = cambios(def, antes, datos);

      /*
       * ---------------- El bautismo es un hecho de su vida ----------------
       *
       * «Bautismo» estaba entre los quince tipos que ofrece el desplegable y
       * NADIE lo escribía: anotarle el bautismo a una ficha dejaba «Cambio de
       * datos · Fecha de bautismo: (vacío) → 06-11-2005», perdido entre los
       * teléfonos y las direcciones, y fechado el día del tecleo. En una
       * bitácora de iglesia eso es de lo poco que tiene que poder mostrarse
       * aparte, y el sistema lo conoce: la ficha tiene su campo.
       *
       * Sale con su tipo, con su fecha —la del bautismo, no la de hoy— y en su
       * propia anotación, y se saca de la línea de cambios para que el mismo
       * hecho no quede dicho dos veces.
       *
       * Solo cuando se anota por PRIMERA vez. Corregir una fecha de bautismo
       * mal escrita no es un bautismo: eso sí es un cambio de datos, y ahí se
       * queda.
       */
      const seBautizo = datos.fecha_bautismo !== undefined
        && !normalizarFecha(antes.fecha_bautismo)
        && normalizarFecha(despues.fecha_bautismo);
      if (seBautizo) {
        anotar({
          miembroId: despues.id, tipo: 'Bautismo', iglesiaId: iglesia, usuario: user,
          fecha: seBautizo,
          descripcion: 'Queda anotado su bautismo.',
        });
        lista = lista.filter((c) => !c.startsWith('Fecha de bautismo:'));
      }

      if (lista.length) {
        const cambioEstado = lista.find((c) => c.startsWith('Estado:'));
        anotar({
          miembroId: despues.id, iglesiaId: iglesia, usuario: user,
          tipo: cambioEstado ? 'Cambio de estado' : 'Cambio de datos',
          descripcion: lista.join(' · '),
        });
      }
    }
    return;
  }

  // 2. La iglesia: su alta y los cambios de sus datos
  if (def.name === 'iglesias') {
    if (isNew) {
      anotarIglesia(despues.id, { tipo: 'Anotación', usuario: user,
        descripcion: `Se registra la iglesia "${despues.nombre || ''}" en el sistema.`.replace(' ""', '') });
    } else {
      const lista = cambios(def, antes, datos);
      if (lista.length) {
        anotarIglesia(despues.id, { tipo: 'Cambio de datos', usuario: user, descripcion: lista.join(' · ') });
      }
    }
    return;
  }

  // 3. El pastor: su alta, su cargo, su traslado y los demás cambios
  if (def.name === 'pastores') {
    const quien = require('./nombres').paraMostrar(despues.nombres, despues.apellidos);
    if (isNew) {
      anotarPastor(despues.id, { tipo: 'Anotación', usuario: user,
        descripcion: `Se registra a ${quien} en Pastores / Guías${despues.cargo ? ` como ${despues.cargo}` : ''}.` });
      return;
    }
    if (datos.cargo !== undefined && antes.cargo !== despues.cargo) {
      anotarPastor(despues.id, {
        tipo: 'Cambio de cargo', usuario: user,
        descripcion: `Pasa de ${antes.cargo || '(sin cargo)'} a ${despues.cargo || '(sin cargo)'}.`,
      });
    }
    if (datos.iglesia_id !== undefined && antes.iglesia_id !== despues.iglesia_id) {
      const nombreDe = (id) => {
        const i = id ? db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id) : null;
        return i ? i.nombre : '(sin iglesia)';
      };
      anotarPastor(despues.id, {
        tipo: 'Traslado de iglesia', usuario: user,
        descripcion: `De ${nombreDe(antes.iglesia_id)} a ${nombreDe(despues.iglesia_id)}.`,
      });
    }
    const otros = cambios(def, antes, datos).filter((c) => !c.startsWith('Cargo:') && !c.startsWith('Iglesia:'));
    if (otros.length) {
      anotarPastor(despues.id, { tipo: 'Cambio de datos', usuario: user, descripcion: otros.join(' · ') });
    }
    return;
  }

  // 4. Documentos adjuntos a una iglesia o a un pastor
  if (def.name === 'documentos_iglesias' && isNew && despues.iglesia_id) {
    anotarIglesia(despues.iglesia_id, {
      tipo: 'Documento', usuario: user, fecha: despues.fecha,
      descripcion: `Se adjuntó "${despues.nombre || despues.tipo || 'un documento'}" (${despues.tipo || ''}).`,
    });
    return;
  }
  if (def.name === 'documentos_pastores' && isNew && despues.pastor_id) {
    anotarPastor(despues.pastor_id, {
      tipo: 'Documento', usuario: user, fecha: despues.fecha,
      descripcion: `Se adjuntó "${despues.nombre || despues.tipo || 'un documento'}" (${despues.tipo || ''}).`,
    });
    return;
  }

  // 5. Cuerpos: quién queda a cargo
  if (def.name === 'cuerpos') {
    const nombre = despues.nombre || 'un cuerpo';
    // Solo cuando el líder es un miembro inscrito: un grupo lo puede dirigir
    // alguien del registro aparte, y esa persona no tiene bitácora
    if (despues.lider_id && (isNew || antes.lider_id !== despues.lider_id)) {
      anotar({ miembroId: despues.lider_id, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: `Queda como líder / encargado de "${nombre}".` });
    }
    return;
  }

  // 5b. Integrantes de cuerpos: ingreso, paso a oficial, retiro
  if (def.name === 'integrantes_cuerpo') {
    const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(despues.cuerpo_id);
    const nombre = cuerpo ? cuerpo.nombre : 'un cuerpo';
    const quien = Number(despues.miembro_id);
    /*
     * La bitácora es el historial del MIEMBRO. En los grupos ahora también
     * sirve gente que no está inscrita en la membresía, y esa gente no tiene
     * bitácora: su pertenencia queda en la ficha del grupo y nada más.
     */
    if (!quien) return;
    const estado = despues.estado;
    // Cada uno de estos tres hechos lleva su fecha escrita en la propia ficha
    // del integrante, y es la que corresponde: alguien puede anotar en octubre
    // que la señora entró en enero, y el historial tiene que decir enero.
    if (isNew) {
      anotar({ miembroId: quien, tipo: 'Ingreso a cuerpo', iglesiaId: iglesia, usuario: user,
        fecha: despues.fecha_ingreso,
        descripcion: estado === 'En prueba'
          ? `Ingresa a "${nombre}" en período de prueba.`
          : `Ingresa a "${nombre}".` });
      return;
    }
    if (antes.estado === estado) return;    // solo interesa el cambio de estado
    const que = loQueLePasaAlIntegrante(estado, nombre, { motivo: despues.motivo_retiro });
    if (!que) return;
    /*
     * De estos tres, solo el retiro trae su fecha escrita en la ficha.
     *
     * «Pasó a integrante oficial el» existe, pero es de solo lectura: la pone
     * la evaluación, y por ese camino no se pasa por acá —se pasa por
     * `anotarPasoDeIntegrante`, que sí la usa—. Acá se llega cuando alguien le
     * cambia el estado a mano, y entonces ese campo viene vacío: lo que está
     * pasando es que alguien la marcó Activa hoy. Volver a período de prueba a
     * mano tampoco tiene fecha propia, y pasa hoy igual.
     */
    anotar({ miembroId: quien, iglesiaId: iglesia, usuario: user,
      fecha: estado === 'Retirado' ? despues.fecha_retiro : null, ...que });
    return;
  }

  /*
   * 6. Directivas: el cargo que alguien asume, Y EL QUE ALGUIEN DEJA.
   *
   * Hasta la 1.264.0 solo se anotaba la mitad de arriba. Medido: cambiándole
   * el tesorero a una directiva, al que entraba le quedaba su «Asume como
   * Tesorero(a)» y al que salía no le quedaba nada —tres líneas antes, tres
   * después—, así que su historial seguía diciendo que asumió un cargo que
   * hoy tiene otra persona, sin nada que lo explicara. Y lo mismo al VACIAR
   * un cargo: la directiva se quedaba sin tesorero y en el historial de quien
   * lo era no pasaba nada. Es el mismo defecto que tenían las cuatro carpetas
   * hasta la 1.209.0 —el alta dejaba línea y la baja ninguna— y se arregla
   * igual: cada hecho tiene dos mitades y las dos se anotan.
   */
  if (def.name === 'directivas') {
    const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(despues.cuerpo_id);
    const nombreCuerpo = cuerpo ? cuerpo.nombre : 'un cuerpo';
    const periodo = despues.periodo || '';
    // La lista vive en un solo lugar: escrita también acá, el cargo que se
    // agregara mañana entraría al sistema sin quedarle anotado a nadie
    for (const { campo, label: cargo } of require('./cargos-de-la-directiva').CARGOS) {
      const nuevo = despues[campo];
      const previo = isNew ? null : antes[campo];
      if (nuevo === previo) continue;
      if (nuevo) {
        anotar({
          miembroId: nuevo, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
          fecha: despues.fecha_inicio,   // se asume el cargo cuando empieza el período
          descripcion: `Asume como ${cargo} de "${nombreCuerpo}" — período ${periodo}.`.trim(),
        });
      }
      if (previo) {
        /*
         * La fecha es la de HOY y no la de inicio del período, al revés que la
         * de arriba: el cargo se asume cuando el período empieza, pero se deja
         * el día en que alguien lo cambia. Poner ahí `fecha_inicio` haría que
         * el historial dijera que lo dejó el mismo día que lo asumió.
         */
        anotar({
          miembroId: previo, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
          descripcion: `Deja el cargo de ${cargo} de "${nombreCuerpo}" — período ${periodo}.`.trim(),
        });
      }
    }
    return;
  }

  // 7. Módulos que apuntan a un miembro (la tabla está más abajo: LO_QUE_LE_PASA)
  const traductor = LO_QUE_LE_PASA[def.name] && LO_QUE_LE_PASA[def.name].alta;
  if (traductor && despues.miembro_id) {
    // Solo al crear, o cuando cambia el estado de una solicitud o ayuda
    const cambioEstado = !isNew && antes && antes.estado !== despues.estado;
    if (isNew || cambioEstado) {
      const { tipo, texto, cuando } = traductor(despues);
      anotar({
        miembroId: despues.miembro_id, tipo, iglesiaId: iglesia, usuario: user,
        // Al crear, la fecha del hecho. Al cambiar de estado, hoy: lo que se
        // anota entonces es que alguien la aprobó o la cerró, y eso pasa hoy.
        fecha: isNew ? cuando : null,
        descripcion: (isNew ? '' : 'Actualización — ') + texto,
      });
    }
  }
}

/**
 * Se llama desde el motor CRUD antes de eliminar un registro.
 *
 * Se anota **en cualquier módulo**, con un resumen de lo que traía: una vez
 * borrado ya no hay dónde ir a mirarlo, y su propio historial se fue con él.
 *
 * Si el borrado se llevó cosas por delante —las fichas de integrante de un
 * cuerpo, las marcas de asistencia de un miembro— eso se anota en la misma
 * entrada y no en una por fila. Son consecuencia de un solo acto, y ponerlas
 * sueltas llenaría el registro de doscientas líneas que dicen lo mismo. Pero
 * anotarlas hace falta: son las que después explican por qué desapareció algo
 * que nadie borró a mano.
 */
function registrarEliminado(def, fila, user, arrastre) {
  if (BORRADOS_QUE_NO_SE_ANOTAN.includes(def.name)) return;
  let detalle = resumenDe(def, fila, true);
  if (arrastre && arrastre.arrastradas) {
    const lista = (arrastre.detalle || []).join(', ');
    detalle += `${detalle ? ' — ' : ''}Se llevó consigo ${arrastre.arrastradas} registro(s)${lista ? `: ${lista}` : ''}.`;
  }
  /*
   * Y lo que NO se llevó pero dejó a medias: los enlaces que quedaron vacíos.
   *
   * Es la otra mitad de la misma frase. Borrar a quien era tesorero de una
   * directiva no borra la directiva —así está decidido en server/dependencias.js
   * y así debe ser—, pero la deja sin tesorero, y hasta la 1.264.0 eso no se
   * anotaba en ninguna parte: la directiva amanecía con un cargo vacío que nadie
   * había quitado. El registro del borrado es el único lugar donde puede quedar,
   * porque la ficha de la que se soltó no se toca a propósito.
   */
  if (arrastre && arrastre.sueltas) {
    const cuales = (arrastre.detalleSueltas || []).join(', ');
    detalle += `${detalle ? ' — ' : ''}Dejó vacío(s) ${arrastre.sueltas} enlace(s) que lo nombraban${cuales ? `: ${cuales}` : ''}.`;
  }
  anotarCambio({ def, accion: 'Eliminación', fila, usuario: user, detalle });

  /*
   * Y si lo que se quitó fue un papel de una carpeta, en el historial de su
   * dueño: de la persona, de la iglesia, del pastor o de la solicitud.
   *
   * El de arriba es el libro del sistema; este es el libro de cada ficha, y es
   * el que sale impreso en su hoja. Adjuntar dejaba línea y quitar no dejaba
   * ninguna, así que el historial quedaba diciendo que se adjuntó un carnet
   * que hoy no está, sin nada que lo explicara. Medido, en las cuatro
   * carpetas: al adjuntar sube una línea; al borrar, ninguna.
   *
   * La fecha es la de HOY y no la del documento, al revés que la de adjuntar:
   * un carnet de 2020 se adjuntó en 2020, pero se quitó el día que alguien lo
   * quitó. Y se dice de cuándo era el papel, porque una carpeta puede tener
   * dos que se llamen igual —se pregunta, pero quien confirma pasa— y hay que
   * saber cuál se fue.
   *
   * Cada carpeta escribe con las comillas de su propio «se adjuntó», para que
   * las dos líneas se lean como una sola historia: las de las fichas usan
   * comillas rectas y el seguimiento de una solicitud, angulares.
   *
   * Cuando lo que se borra es la ficha entera, su carpeta se va con ella y acá
   * no llega ninguna fila de documento: el motor anota el borrado de la ficha
   * con lo que se llevó consigo, y no una línea por papel. Aun así, ninguno de
   * estos escribe en el historial de una ficha que ya no existe.
   */
  /*
   * Y si lo que se borró era algo que le había dejado una línea a una persona
   * —una solicitud, una ayuda, un certificado—, la línea de la baja.
   *
   * Sin esto, el historial seguía afirmando lo que ya no era cierto. En una
   * ayuda es lo más delicado: la línea dice que a alguien se le entregó algo, y
   * sobrevivía al registro que la sostenía. La fecha es la de HOY y no la del
   * hecho, igual que en la carpeta: la ayuda era del 14 de julio, pero se
   * eliminó el día que alguien la eliminó.
   *
   * `anotar` no escribe si la persona ya no está: cuando se borra la ficha
   * entera, sus ayudas se van con ella y esto no crea líneas huérfanas.
   */
  const suyo = LO_QUE_LE_PASA[def.name];
  if (suyo && suyo.baja && fila.miembro_id) {
    const { tipo, texto } = suyo.baja(fila);
    anotar({
      miembroId: fila.miembro_id, tipo, iglesiaId: fila.iglesia_id || null,
      usuario: user, descripcion: texto,
    });
  }

  const carpeta = LAS_CARPETAS[def.name];
  if (carpeta && fila[carpeta.campo]) {
    const { comoSeLee } = require('./fechas');
    const cuando = fila.fecha ? `, del ${comoSeLee(String(fila.fecha).slice(0, 10))}` : '';
    const [abre, cierra] = carpeta.comillas || ['"', '"'];
    const cual = fila.nombre || fila.tipo || 'un documento';
    carpeta.anota(fila[carpeta.campo], {
      tipo: 'Documento',
      iglesiaId: fila.iglesia_id || null,
      usuario: user,
      descripcion: `Se quitó ${abre}${cual}${cierra} (${fila.tipo || ''}${cuando}) de su carpeta.`,
    });
  }
}

/**
 * LO QUE LE PASA A UNA PERSONA Y QUEDA EN SU HISTORIAL.
 *
 * Cuatro módulos apuntan a un miembro y le dejan una línea: lo que pidió, lo
 * que se le entregó, lo que se le certificó y lo que se le guardó en su
 * carpeta. Cada uno dice además CUÁNDO ocurrió lo suyo, que no es cuándo se
 * tecleó: una ayuda del 10 de marzo anotada en agosto es del 10 de marzo.
 *
 * ── Y LA LÍNEA DE LA BAJA ──
 *
 * Cada uno tiene DOS mitades, el alta y la baja, y hasta la 1.209.0 solo la
 * carpeta tenía las dos. Los otros tres dejaban su línea al crearse y ninguna
 * al borrarse, así que el historial quedaba afirmando algo que ya no era
 * cierto. En una ayuda es lo más delicado de todo: la línea que queda dice que
 * a una persona se le entregó algo, y esa afirmación sobrevivía al registro que
 * la sostenía. Medido: tres líneas antes de borrar, tres después.
 *
 * Escrito como tabla y no como cuatro condiciones seguidas por lo mismo que
 * LAS_CARPETAS: lo que cambia entre ellos es el texto, no la regla.
 *
 * La carpeta de documentos no lleva `baja` acá: la suya vive en LAS_CARPETAS,
 * que sabe además escribirla en la iglesia, el pastor o la solicitud de la que
 * cuelgue. Ponerla en los dos lugares dejaría dos líneas por un solo hecho.
 */
const LO_QUE_LE_PASA = {
  solicitudes: {
    alta: (r) => ({ tipo: 'Solicitud', cuando: r.fecha, texto: `Solicitud "${r.asunto || r.tipo}" (${r.estado || 'Pendiente'}).` }),
    baja: (r) => ({ tipo: 'Solicitud', texto: `Se eliminó la solicitud "${r.asunto || r.tipo || ''}" (${r.estado || ''}).` }),
  },
  ayudas_sociales: {
    alta: (r) => ({ tipo: 'Ayuda social', cuando: r.fecha, texto: `Ayuda social: ${r.tipo_ayuda || ''} — ${r.estado || ''}.` }),
    baja: (r) => ({
      tipo: 'Ayuda social',
      texto: `Se eliminó el registro de la ayuda social: ${r.tipo_ayuda || ''} — ${r.estado || ''}`
        + `${cuandoEra(r.fecha)}${enPesosSiHay(r.valor_estimado)}.`,
    }),
  },
  certificados: {
    alta: (r) => ({ tipo: 'Certificado', cuando: r.fecha_emision, texto: `Certificado de ${r.tipo || ''} N.º ${r.numero || ''}.` }),
    baja: (r) => ({ tipo: 'Certificado', texto: `Se eliminó el certificado de ${r.tipo || ''} N.º ${r.numero || ''}.` }),
  },
  documentos_miembros: {
    alta: (r) => ({ tipo: 'Documento', cuando: r.fecha, texto: `Se adjuntó "${r.nombre || r.tipo || 'un documento'}" (${r.tipo || ''}).` }),
  },
};

/** «, del 14-07-2026», o nada si no traía fecha. */
function cuandoEra(fecha) {
  if (!fecha) return '';
  return `, del ${require('./fechas').comoSeLee(String(fecha).slice(0, 10))}`;
}

/** « ($ 45.000)», o nada si no traía monto: cero no es un monto. */
function enPesosSiHay(monto) {
  const n = Number(monto) || 0;
  return n > 0 ? ` ($ ${Math.round(n).toLocaleString('es-CL')})` : '';
}

/**
 * Las cuatro carpetas del sistema: de quién cuelga cada una y dónde escribe.
 *
 * Escrito como tabla y no como cuatro condiciones seguidas porque lo que
 * cambia entre ellas son tres datos, no la regla. La de una solicitud escribe
 * en su seguimiento, que es su historial y vive aparte (server/solicitudes).
 */
const LAS_CARPETAS = {
  documentos_miembros: {
    campo: 'miembro_id',
    anota: (id, datos) => anotar({ miembroId: id, ...datos }),
  },
  documentos_iglesias: {
    campo: 'iglesia_id',
    anota: (id, datos) => anotarIglesia(id, datos),
  },
  documentos_pastores: {
    campo: 'pastor_id',
    anota: (id, datos) => anotarPastor(id, datos),
  },
  documentos_solicitudes: {
    campo: 'solicitud_id',
    comillas: ['«', '»'],
    anota: (id, datos) => {
      // Solo si la solicitud sigue existiendo: si se borró entera, su
      // seguimiento se fue con ella y esto crearía una línea huérfana.
      if (!db.prepare('SELECT 1 FROM solicitudes WHERE id = ?').get(id)) return;
      require('./solicitudes/seguimiento').anotar(db, id, {
        tipo: datos.tipo, descripcion: datos.descripcion, user: datos.usuario,
      });
    },
  },
};

/**
 * La credencial de un pastor, anotada en su bitácora de miembro.
 *
 * «Credencial» era el otro tipo que se ofrecía y nadie escribía, y además
 * prometía algo que el módulo no daba: las credenciales se emiten a los
 * PASTORES, y lo que hacen queda en el Registro de Cambios. Pero un pastor
 * puede tener enlazada su ficha de miembro —la columna existe y se usa—, y
 * cuando la tiene, que le emitan o le revoquen su credencial es un hecho de su
 * vida en la organización, no solo un movimiento de oficina.
 *
 * Se anotan esos dos y no los cuatro actos de la credencial. Reemplazarla ya
 * lo cuenta la emisión de la nueva, y haberla mandado a la impresora es un acto
 * de oficina que no dice nada de la persona: los dos siguen quedando donde
 * corresponde, en el Registro de Cambios.
 *
 * Sin ficha de miembro enlazada no se anota nada, que es lo mismo que hace el
 * resto del sistema con quien no está en la membresía.
 */
function anotarCredencial({ pastorId, texto, fecha, usuario }) {
  const pastor = pastorId
    ? db.prepare('SELECT miembro_id, iglesia_id FROM pastores WHERE id = ?').get(pastorId)
    : null;
  /*
   * La única guardia que decide algo: sin fila no hay `miembro_id` que leer.
   *
   * Preguntar además si viene el `pastorId`, o si la ficha trae enlazado un
   * miembro, no cambiaba nada —se comprobó rompiéndolas y no cayó ninguna
   * prueba—: `anotar` no escribe cuando no se le dice de quién es la
   * anotación, que es la misma regla que el resto del sistema aplica a quien
   * no está en la membresía. Dos condiciones que parecen cuidar algo y no
   * cuidan nada son peor que no tenerlas.
   */
  if (!pastor) return;
  anotar({
    miembroId: pastor.miembro_id, tipo: 'Credencial', iglesiaId: pastor.iglesia_id,
    usuario, fecha, descripcion: texto,
  });
}

module.exports = {
  anotar, anotarIglesia, anotarPastor, anotarCredencial, registrarGuardado, registrarEliminado,
  // Para los actos que no son «guardar una ficha» y aun así tienen que quedar
  // anotados: emitir una credencial, revocarla, volver a imprimirla.
  anotarCambio,
  // El paso que decide una evaluación de período de prueba, que mueve la ficha
  // del integrante con un UPDATE directo y no pasa por el motor.
  anotarPasoDeIntegrante,
  // Qué módulos deja anotados el Registro de Cambios, para poder comprobar que
  // uno esté en la lista sin tener que provocar el guardado entero.
  MODULOS_VIGILADOS,
};
