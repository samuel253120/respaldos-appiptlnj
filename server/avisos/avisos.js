/**
 * Los avisos del sistema: qué se le dice a quién, y cuándo.
 *
 * Un aviso es una cosa que le pasó a ALGUIEN en particular y que quiere
 * enterarse: le trasladaron una solicitud, una credencial que emitió está por
 * vencer, hace dos meses que nadie baja el respaldo. No es el registro de
 * cambios —eso anota todo lo que pasa, para revisarlo después— sino lo poco
 * que hay que poner delante de los ojos de una persona concreta.
 *
 * DOS COSAS QUE PARECEN DETALLE Y NO LO SON:
 *
 *   · LA CLAVE. Cada aviso lleva una clave que dice de qué es: por ejemplo
 *     `credencial_vence:12`. El vigía se asoma todos los días, y sin la clave
 *     la misma credencial generaría un aviso nuevo cada mañana hasta vencer.
 *     Con ella, el aviso se crea UNA vez: mientras siga sin leerse, no se
 *     repite. Es la diferencia entre un sistema que avisa y uno que se vuelve
 *     ruido que nadie mira.
 *
 *   · LO QUE VA ESCRITO. El aviso puede terminar en la pantalla bloqueada de
 *     un teléfono, donde lo ve cualquiera que pase. Por eso lleva el hecho y
 *     el enlace —«Se le trasladó la solicitud 0045-2026»— y nunca el dato:
 *     ni el RUT, ni el motivo de una ayuda social, ni nada de salud. Para eso
 *     está entrar al sistema.
 */
const { db } = require('../db');

/**
 * Los tipos de aviso, y cómo se comporta cada uno.
 *
 * `urgente` decide cuándo sale por el navegador: los urgentes salen en el
 * momento, y los de rutina se juntan en el resumen del día. Un traslado de
 * solicitud interrumpe; un cumpleaños, no.
 *
 * `llave` marca los que solo tienen sentido para quien puede hacer algo con
 * ellos: el aviso de que el respaldo está atrasado le sirve a quien puede
 * bajarlo. Antes esto decía «soloAdmin» y miraba el rol, así que a quien se le
 * concedía la llave del respaldo el aviso no le llegaba igual.
 */
const TIPOS = {
  solicitud_asignada: {
    label: 'Solicitudes que me asignan o me trasladan',
    urgente: true,
    ayuda: 'Cuando una solicitud queda a su cargo, sea al ingresarla o porque se la trasladaron.',
  },
  solicitud_sin_respuesta: {
    label: 'Solicitudes mías que llevan mucho sin respuesta',
    urgente: false,
    ayuda: 'Una solicitud a su cargo que sigue abierta pasados los días que se indiquen en Configuración.',
  },
  solicitud_sin_responsable: {
    label: 'Solicitudes que quedaron sin nadie que las lleve',
    urgente: false,
    // Solo a quien puede repartirlas: para el resto es un aviso sobre algo que
    // no está en sus manos (ver avisos/vigia.js)
    llave: 'solicitudes_tramitar',
    ayuda: 'Solicitudes abiertas cuyo responsable ya no entra al sistema, porque se desactivó su cuenta.',
  },
  ayuda_sin_entregar: {
    label: 'Ayudas pedidas que siguen sin entregarse',
    urgente: false,
    /*
     * Solo a quien administra las ayudas: para el resto es un aviso sobre algo
     * que no está en sus manos, igual que la solicitud sin responsable.
     */
    llave: 'ayudas_sociales',
    ayuda:
      'Una ayuda que quedó «Solicitada» o «Aprobada» y sigue así pasados los días que se indiquen en '
      + 'Configuración. Es lo único que el sistema entrega a una persona y no avisaba nadie: una '
      + 'familia que pidió mercadería en marzo podía seguir esperando sin que se notara.',
  },
  credencial_por_vencer: {
    label: 'Credenciales por vencer',
    urgente: false,
    ayuda: 'Una credencial de su iglesia que vence dentro del plazo de aviso.',
  },
  documento_por_vencer: {
    label: 'Documentos de la carpeta por vencer',
    urgente: false,
    ayuda:
      'Un documento de la carpeta de alguien —el carnet, sobre todo— que vence dentro del plazo de aviso '
      + 'o que ya venció. Sirve para pedir el papel nuevo antes del trámite y no el día del trámite.',
  },
  prestamo_por_devolver: {
    label: 'Cosas prestadas que hay que devolver',
    urgente: false,
    // Solo a quien lleva el inventario: para el resto es un aviso sobre algo
    // que no está en sus manos, igual que la ayuda sin entregar
    llave: 'inventarios',
    ayuda:
      'Un artículo del inventario anotado como «Prestado» cuya fecha de devolución se acerca o ya '
      + 'pasó. Es lo que un hermano le prestó a la iglesia y hay que devolverle: sin este aviso, de '
      + 'un préstamo nadie se acuerda hasta que el dueño lo va a pedir.',
  },
  respaldo_atrasado: {
    label: 'Respaldo sin bajar y espacio en disco',
    urgente: false,
    // Se ofrece a quien tenga la llave del respaldo, no solo al administrador:
    // es quien puede hacer algo con el aviso (ver avisos/vigia.js).
    llave: 'sistema_respaldo',
    ayuda: 'Hace demasiado que nadie se baja el respaldo completo, o queda poco espacio en el disco.',
  },
  cuerpo_oficiales_sin_armar: {
    label: 'El cuerpo de oficiales no está armado',
    urgente: false,
    // A quien entra a Configuración, que es donde se arregla: para el resto es
    // un aviso sobre algo que no está en sus manos
    llave: 'sistema_configuracion',
    ayuda:
      'Configuración espera un cuerpo de oficiales y no existe, o existe y no tiene integrantes. '
      + 'De ahí salen los oficiales supervisores de las directivas, así que mientras tanto se puede '
      + 'elegir a cualquier miembro y ese cargo no se puede comprobar.',
  },
  cumpleanos_hoy: {
    label: 'Cumpleaños del día',
    urgente: false,
    ayuda: 'Quiénes cumplen años hoy en las iglesias que tiene asignadas.',
  },
  cuotas_atrasadas: {
    label: 'Cuotas atrasadas',
    urgente: false,
    ayuda: 'Integrantes de cuerpos con cuotas al debe.',
  },
  faltas_seguidas: {
    label: 'Quien lleva muchas faltas seguidas',
    urgente: false,
    ayuda:
      'Integrantes de sus cuerpos que llevan seguidas tantas faltas como diga Configuración. '
      + 'Es de lo poco que avisa a tiempo de que alguien se está alejando; cuando se nota sin ayuda, '
      + 'ya pasaron meses. El aviso dice cuántas de esas faltas fueron justificadas.',
  },
  mensaje: {
    label: 'Mensajes de la administración',
    urgente: true,
    /*
     * Este no se puede apagar en la campanita.
     *
     * Los demás avisos los escribe el sistema mirando los datos: si a alguien
     * no le sirven, que los apague. Un mensaje lo escribe una PERSONA para
     * otra, y quien lo manda no tiene manera de saber que no llegó —no hay
     * acuse de recibo—. Poder silenciarlo en secreto convierte cada mensaje en
     * una moneda al aire.
     *
     * El teléfono sí se puede apagar: sonar es una interrupción y eso es cosa
     * de cada uno. La constancia queda igual en la campanita.
     */
    siempre: true,
    ayuda:
      'Lo que le escriba quien administra el sistema. La campanita no se puede apagar —es donde '
      + 'queda la constancia— pero el aviso en el teléfono sí.',
  },
  cumplio_la_mayoria: {
    label: 'Menores que ya cumplieron 18 años',
    urgente: false,
    ayuda:
      'Fichas que siguen como "Miembro Menor de Edad" después de cumplir los 18. Nadie vuelve a '
      + 'abrir esas fichas, así que el tipo se queda viejo solo, y de él sale quién compone la '
      + 'directiva de la iglesia.',
  },
};

/**
 * Cuánto texto viaja al teléfono.
 *
 * El aviso que sale al teléfono llevaba el cuerpo ENTERO. Con un mensaje escrito
 * a mano eso son hasta dos mil caracteres, y dos cosas iban mal con eso:
 *
 *   · en la pantalla bloqueada se leen dos líneas y el resto no se ve nunca, así
 *     que lo demás viaja para nada;
 *
 *   · y la carga tiene techo. Con el largo máximo y palabras acentuadas daba
 *     4.317 bytes contra los 4.096 que garantiza el estándar de avisos del
 *     navegador: el servicio lo rechaza, el error se atrapa donde se empuja y
 *     queda solo en el registro del servidor. Quien lo mandó ve «llegó a 40»
 *     igual.
 *
 * Con un extracto, la carga no se acerca nunca al techo y en el teléfono se lee
 * lo mismo que se leía. El texto completo está en la campanita y en «Mis
 * mensajes», que es donde se va a buscar.
 */
const LARGO_EN_EL_TELEFONO = 160;

/** Un texto recortado a lo que se alcanza a leer en una pantalla bloqueada. */
function paraElTelefono(texto) {
  const t = String(texto || '').trim();
  if (t.length <= LARGO_EN_EL_TELEFONO) return t;
  // Se corta en un espacio, no a mitad de palabra
  const cortado = t.slice(0, LARGO_EN_EL_TELEFONO);
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return `${(ultimoEspacio > LARGO_EN_EL_TELEFONO - 30 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

/** Los canales por los que puede salir un aviso. */
const CANALES = {
  sistema: { label: 'En el sistema', ayuda: 'La campanita de arriba. Siempre está: es donde queda la constancia.' },
  navegador: { label: 'En el teléfono o el computador', ayuda: 'Como los avisos de cualquier aplicación, aunque el sistema esté cerrado.' },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    clave TEXT,
    titulo TEXT NOT NULL,
    cuerpo TEXT,
    de TEXT,
    enlace TEXT,
    iglesia_id INTEGER,
    leida INTEGER NOT NULL DEFAULT 0,
    leida_en TEXT,
    empujada INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS ix_notificaciones_usuario ON notificaciones (usuario_id, leida, id DESC);
  CREATE INDEX IF NOT EXISTS ix_notificaciones_clave ON notificaciones (usuario_id, clave);
`);

/*
 * Esta tabla es de las hechas a mano, así que las columnas nuevas hay que
 * agregarlas acá: en una base que ya venía andando, «CREATE TABLE IF NOT
 * EXISTS» no la toca y la columna no aparecería nunca.
 */
for (const [columna, tipo] of [['de', 'TEXT']]) {
  const tiene = db.prepare('PRAGMA table_info(notificaciones)').all().some((c) => c.name === columna);
  if (!tiene) db.exec(`ALTER TABLE notificaciones ADD COLUMN ${columna} ${tipo}`);
}

/**
 * Qué avisos quiere recibir esta persona y por dónde.
 *
 * De fábrica llegan todos por el sistema, y por el navegador solo los
 * urgentes: un aviso que suena en el teléfono es una interrupción, y la
 * primera impresión de alguien que estrena esto no puede ser el teléfono
 * sonando por un cumpleaños.
 */
function preferenciasDe(usuario) {
  let guardadas = {};
  try {
    guardadas = JSON.parse(usuario.avisos || '{}') || {};
  } catch (e) {
    guardadas = {};
  }
  const salida = {};
  for (const [tipo, def] of Object.entries(TIPOS)) {
    const suyo = guardadas[tipo] || {};
    salida[tipo] = {
      // Un tipo con `siempre` no se puede apagar en la campanita: se responde
      // encendido pase lo que pase, para que la pantalla lo muestre así
      sistema: def.siempre ? true : suyo.sistema === undefined ? true : !!suyo.sistema,
      navegador: suyo.navegador === undefined ? !!def.urgente : !!suyo.navegador,
    };
  }
  return salida;
}

/** ¿Le corresponde a esta persona un aviso de este tipo, por este canal? */
function quiere(usuario, tipo, canal) {
  const def = TIPOS[tipo];
  if (!def) return false;
  if (def.llave && !require('../permissions').can(usuario, def.llave, 'view')) return false;
  // Los que no se pueden apagar en el sistema: ver `siempre` en TIPOS
  if (def.siempre && canal === 'sistema') return true;
  return !!preferenciasDe(usuario)[tipo][canal];
}

/**
 * Crea un aviso para una persona, si no lo tenía ya.
 *
 * `de` dice de parte de quién viene. Los avisos que escribe el sistema mirando
 * los datos no lo llevan —no vienen de nadie: los hace el sistema—, pero un
 * mensaje escrito a mano sí, y sin eso se lee como si lo dijera «el sistema».
 * El sistema no cambia la hora de una reunión: la cambia una persona a la que
 * uno le puede preguntar.
 *
 * Devuelve la fila creada, o null si no había que crear nada —porque esa
 * persona no quiere ese tipo de aviso, o porque ya tiene uno igual sin leer—.
 * Quien llama no necesita preguntar nada de eso: manda el aviso y acá se
 * decide.
 */
function crear({ usuario_id, tipo, clave, titulo, cuerpo, de, enlace, iglesia_id }) {
  // Con los permisos y el perfil, no solo el rol: `quiere()` consulta la llave
  // del tipo de aviso, y sin estas dos columnas decidiría por el rol a secas.
  const usuario = db
    .prepare('SELECT id, rol, activo, avisos, permisos, perfil_id FROM usuarios WHERE id = ?')
    .get(usuario_id);
  if (!usuario || usuario.activo === 0) return null;
  if (!quiere(usuario, tipo, 'sistema')) return null;

  if (clave) {
    // Mientras siga sin leerse, el mismo asunto no vuelve a avisar. Una vez
    // leído sí puede volver: si la credencial sigue por vencer el mes que
    // viene, es razonable recordarlo.
    const yaEsta = db
      .prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ? AND leida = 0')
      .get(usuario_id, clave);
    if (yaEsta) return null;
  }

  const r = db
    .prepare(
      `INSERT INTO notificaciones (usuario_id, tipo, clave, titulo, cuerpo, de, enlace, iglesia_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(usuario_id, tipo, clave || null, titulo, cuerpo || null, de || null, enlace || null, iglesia_id || null);
  return db.prepare('SELECT * FROM notificaciones WHERE id = ?').get(r.lastInsertRowid);
}

/**
 * Lo que esta persona no ha leído, y cuántos son.
 *
 * ── POR QUÉ LOS SIN LEER VAN PRIMERO ──
 *
 * La campanita traía los últimos veinte, sin más. Con veintisiete sin leer, el
 * número rojo decía veintisiete y la lista dejaba llegar a veinte: siete avisos
 * sin abrir que no había cómo alcanzar por ninguna parte, y una cuenta que no
 * bajaba a cero aunque uno leyera todo lo que veía.
 *
 * Ahora lo sin leer va primero —que es lo que el número promete— y se dice si
 * quedaron más atrás, para poder pedirlos.
 */
function paraLaCampanita(usuarioId, cuantos = 20) {
  const tope = Math.min(Number(cuantos) || 20, 100);
  const sinLeer = db
    .prepare('SELECT COUNT(*) c FROM notificaciones WHERE usuario_id = ? AND leida = 0')
    .get(usuarioId).c;
  // Se pide uno de más solo para saber si hay más: así la pantalla puede
  // ofrecer «ver más» sin tener que preguntar de nuevo
  const traidos = db
    .prepare(
      `SELECT id, tipo, titulo, cuerpo, de, enlace, leida, created_at
         FROM notificaciones WHERE usuario_id = ?
        ORDER BY leida ASC, id DESC LIMIT ?`
    )
    .all(usuarioId, tope + 1);
  return { sinLeer, ultimos: traidos.slice(0, tope), hayMas: traidos.length > tope };
}

/**
 * Los mensajes que le han escrito a esta persona.
 *
 * La contraparte de «lo que se ha mandado», del otro lado. Un mensaje escrito
 * por alguien no es un aviso más: se lee, se responde y se vuelve a buscar
 * —«¿a qué hora era la reunión?»—, y la campanita no sirve para eso, porque
 * muestra un puñado y mezcla los avisos que hace el sistema.
 *
 * ── DE DÓNDE SALEN ──
 *
 * De la lista de destinatarios que guarda cada mensaje, no de los avisos: los
 * avisos leídos se borran solos a los noventa días, y con ellos se iba lo que
 * uno quería volver a leer. Ahora la lista no se borra.
 *
 * Con una excepción: un mensaje RETIRADO del que no queda aviso es uno que se
 * retiró antes de que esta persona lo abriera, y eso es justamente lo que
 * retirar quiere decir. Los que alcanzó a leer antes del retiro le siguen
 * quedando, porque ya los vio.
 */
const DE_LOS_MIOS = `
    FROM mensajes_destinatarios d
    JOIN mensajes_enviados m ON m.id = d.mensaje_id
    LEFT JOIN notificaciones n ON n.usuario_id = d.usuario_id AND n.clave = 'mensaje:' || m.id
   WHERE d.usuario_id = ? AND (n.id IS NOT NULL OR m.retirado_en IS NULL)`;

function recibidos(usuarioId, { limit = 30, offset = 0 } = {}) {
  const tope = Math.min(Number(limit) || 30, 100);
  const desde = Math.max(Number(offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) c ${DE_LOS_MIOS}`).get(usuarioId).c;
  const mensajes = db
    .prepare(
      `SELECT n.id, m.titulo, m.cuerpo, m.enlace,
              -- el nombre tal como iba en el aviso; si ya no está, el de ahora
              COALESCE(n.de, (SELECT nombre FROM usuarios WHERE id = m.enviado_por)) AS de,
              CASE WHEN n.id IS NULL THEN 1 ELSE n.leida END AS leida,
              m.created_at
       ${DE_LOS_MIOS}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(usuarioId, tope, desde);
  return { total, mensajes, hayMas: desde + mensajes.length < total };
}

/**
 * Lo que hay que anotar en otra parte cuando un aviso se lee.
 *
 * Un aviso leído se borra solo a los noventa días, así que lo que haya que
 * saber DESPUÉS sobre esa lectura hay que anotarlo ahora. Hoy lo necesita una
 * sola cosa: los mensajes escritos a mano, que le dicen a quien los mandó
 * cuántos los abrieron; ese número salía de contar avisos y por eso se
 * volvía cero solo. Va acá, en las dos únicas puertas por donde un aviso pasa a
 * leído, y no en las rutas, para que valga desde donde sea que se marque.
 *
 * Si falla, el aviso queda leído igual: es lo que la persona pidió, y una
 * cuenta que no se pudo llevar no puede deshacerlo.
 */
function anotarQueSeLeyo(claves) {
  const utiles = claves.filter(Boolean);
  if (!utiles.length) return;
  try {
    require('./mensajes').anotarLectura(utiles);
  } catch (e) {
    console.error(`⚠️  No se pudo anotar la lectura de un aviso: ${e.message}`);
  }
}

function marcarLeida(usuarioId, id) {
  /*
   * Primero qué era, después marcarlo: una vez marcado ya no se distingue de
   * uno que estaba leído desde antes, y la lectura se contaría dos veces.
   *
   * El «leida = 0» de esta consulta es lo único que hace falta para eso: si ya
   * estaba leído no devuelve nada y no se anota. Comprobar ADEMÁS que el UPDATE
   * cambió una fila sería cuidarse de que alguien lo marcara entremedio, y
   * entremedio no corre nada: la base es síncrona y el servidor tiene un solo
   * hilo. Esa comprobación de más se escribió, se rompió a propósito para ver
   * qué prueba caía, y no cayó ninguna: era código muerto.
   */
  const suyo = db
    .prepare('SELECT clave FROM notificaciones WHERE id = ? AND usuario_id = ? AND leida = 0')
    .get(id, usuarioId);
  const cambios = db
    .prepare("UPDATE notificaciones SET leida = 1, leida_en = datetime('now','localtime') WHERE id = ? AND usuario_id = ? AND leida = 0")
    .run(id, usuarioId).changes;
  if (suyo) anotarQueSeLeyo([suyo.clave]);
  return cambios;
}

function marcarTodasLeidas(usuarioId) {
  const suyas = db
    .prepare('SELECT clave FROM notificaciones WHERE usuario_id = ? AND leida = 0 AND clave IS NOT NULL')
    .all(usuarioId)
    .map((f) => f.clave);
  const cambios = db
    .prepare("UPDATE notificaciones SET leida = 1, leida_en = datetime('now','localtime') WHERE usuario_id = ? AND leida = 0")
    .run(usuarioId).changes;
  // Lo que decide qué se anota es el «leida = 0» de la consulta de arriba, igual
  // que en `marcarLeida`: sin nada sin leer no trae ninguna clave y no se anota
  // nada. Preguntar además por `cambios` no cubre ningún caso.
  anotarQueSeLeyo(suyas);
  return cambios;
}

/**
 * Los avisos leídos hace mucho se borran solos.
 *
 * Un aviso leído ya cumplió: lo que pasó queda en el registro de cambios y en
 * el historial de cada ficha, que es donde se va a buscar. Guardarlos para
 * siempre haría crecer la base sin que nadie los mire nunca.
 */
function limpiarLosViejos(dias = 90) {
  return db
    .prepare(`DELETE FROM notificaciones WHERE leida = 1 AND leida_en < date('now','localtime', ?)`)
    .run(`-${Number(dias) || 90} days`).changes;
}

/**
 * La puerta por la que avisa todo el sistema.
 *
 * Deja el aviso guardado —eso es lo que importa y no puede fallar— y, si el
 * aviso es de los que interrumpen y esa persona los quiere en el teléfono, lo
 * empuja además al navegador.
 *
 * El empujón NO se espera. Mandar un aviso a los aparatos de alguien puede
 * demorar segundos si el servicio del navegador anda lento, y quien está
 * guardando una solicitud no tiene por qué esperar eso. Si falla, el aviso ya
 * está en la campanita igual.
 */
function avisar({ usuario_id, tipo, clave, titulo, cuerpo, de, enlace, iglesia_id, urgente }) {
  const fila = crear({ usuario_id, tipo, clave, titulo, cuerpo, de, enlace, iglesia_id });
  if (!fila) return null;

  const def = TIPOS[tipo];
  if (!def) return fila;
  /*
   * Casi siempre lo urgente lo decide el TIPO. Pero hay avisos que lo deciden
   * uno por uno: un mensaje escrito a mano puede ser «la reunión se cambió a
   * las 8» o «cuando puedan, revisen las fichas». Quien lo escribe sabe cuál
   * de los dos es; el tipo, no.
   */
  const interrumpe = urgente === undefined ? !!def.urgente : !!urgente;
  if (!interrumpe) return fila; // los de rutina salen en el resumen del día

  const usuario = db
    .prepare('SELECT id, rol, avisos, permisos, perfil_id FROM usuarios WHERE id = ?')
    .get(usuario_id);
  if (!usuario || !quiere(usuario, tipo, 'navegador')) return fila;

  const navegador = require('./navegador');
  /*
   * En el teléfono, de quién viene va al principio del texto. En el título no:
   * el título es lo poco que se alcanza a leer en una pantalla bloqueada, y
   * gastarlo en un nombre puede dejar fuera justamente lo que había que decir.
   */
  const loQueSeLee = paraElTelefono(de ? `${de}: ${cuerpo || ''}` : cuerpo);
  navegador
    .empujar(usuario_id, { titulo, cuerpo: loQueSeLee, enlace, etiqueta: clave || tipo })
    .then(() => db.prepare('UPDATE notificaciones SET empujada = 1 WHERE id = ?').run(fila.id))
    .catch((e) => console.error(`⚠️  No se pudo empujar el aviso ${fila.id}: ${e.message}`));

  return fila;
}

module.exports = {
  TIPOS, CANALES,
  avisar, crear, paraLaCampanita, marcarLeida, marcarTodasLeidas, limpiarLosViejos,
  preferenciasDe, quiere, recibidos, paraElTelefono, LARGO_EN_EL_TELEFONO,
};
