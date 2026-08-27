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
  credencial_por_vencer: {
    label: 'Credenciales por vencer',
    urgente: false,
    ayuda: 'Una credencial de su iglesia que vence dentro del plazo de aviso.',
  },
  respaldo_atrasado: {
    label: 'Respaldo sin bajar y espacio en disco',
    urgente: false,
    // Se ofrece a quien tenga la llave del respaldo, no solo al administrador:
    // es quien puede hacer algo con el aviso (ver avisos/vigia.js).
    llave: 'sistema_respaldo',
    ayuda: 'Hace demasiado que nadie se baja el respaldo completo, o queda poco espacio en el disco.',
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
};

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
      sistema: suyo.sistema === undefined ? true : !!suyo.sistema,
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
  return !!preferenciasDe(usuario)[tipo][canal];
}

/**
 * Crea un aviso para una persona, si no lo tenía ya.
 *
 * Devuelve la fila creada, o null si no había que crear nada —porque esa
 * persona no quiere ese tipo de aviso, o porque ya tiene uno igual sin leer—.
 * Quien llama no necesita preguntar nada de eso: manda el aviso y acá se
 * decide.
 */
function crear({ usuario_id, tipo, clave, titulo, cuerpo, enlace, iglesia_id }) {
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
      `INSERT INTO notificaciones (usuario_id, tipo, clave, titulo, cuerpo, enlace, iglesia_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(usuario_id, tipo, clave || null, titulo, cuerpo || null, enlace || null, iglesia_id || null);
  return db.prepare('SELECT * FROM notificaciones WHERE id = ?').get(r.lastInsertRowid);
}

/** Lo que esta persona no ha leído, y cuántos son. */
function paraLaCampanita(usuarioId, cuantos = 20) {
  const sinLeer = db
    .prepare('SELECT COUNT(*) c FROM notificaciones WHERE usuario_id = ? AND leida = 0')
    .get(usuarioId).c;
  const ultimos = db
    .prepare(
      `SELECT id, tipo, titulo, cuerpo, enlace, leida, created_at
         FROM notificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(usuarioId, cuantos);
  return { sinLeer, ultimos };
}

function marcarLeida(usuarioId, id) {
  return db
    .prepare("UPDATE notificaciones SET leida = 1, leida_en = datetime('now','localtime') WHERE id = ? AND usuario_id = ? AND leida = 0")
    .run(id, usuarioId).changes;
}

function marcarTodasLeidas(usuarioId) {
  return db
    .prepare("UPDATE notificaciones SET leida = 1, leida_en = datetime('now','localtime') WHERE usuario_id = ? AND leida = 0")
    .run(usuarioId).changes;
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
function avisar({ usuario_id, tipo, clave, titulo, cuerpo, enlace, iglesia_id }) {
  const fila = crear({ usuario_id, tipo, clave, titulo, cuerpo, enlace, iglesia_id });
  if (!fila) return null;

  const def = TIPOS[tipo];
  if (!def || !def.urgente) return fila; // los de rutina salen en el resumen del día

  const usuario = db
    .prepare('SELECT id, rol, avisos, permisos, perfil_id FROM usuarios WHERE id = ?')
    .get(usuario_id);
  if (!usuario || !quiere(usuario, tipo, 'navegador')) return fila;

  const navegador = require('./navegador');
  navegador
    .empujar(usuario_id, { titulo, cuerpo, enlace, etiqueta: clave || tipo })
    .then(() => db.prepare('UPDATE notificaciones SET empujada = 1 WHERE id = ?').run(fila.id))
    .catch((e) => console.error(`⚠️  No se pudo empujar el aviso ${fila.id}: ${e.message}`));

  return fila;
}

module.exports = {
  TIPOS, CANALES,
  avisar, crear, paraLaCampanita, marcarLeida, marcarTodasLeidas, limpiarLosViejos,
  preferenciasDe, quiere,
};
