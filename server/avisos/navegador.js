/**
 * Los avisos que llegan al teléfono o al computador aunque el sistema esté
 * cerrado.
 *
 * Usan el mecanismo estándar de los navegadores (Web Push). El navegador de
 * cada persona guarda una «suscripción» —una dirección propia, de un solo uso,
 * con dos llaves— y el servidor le manda ahí los avisos, cifrados de punta a
 * punta: el servicio del navegador que los transporta no puede leerlos.
 *
 * LAS LLAVES VAPID. Identifican a ESTE servidor ante los navegadores. Se
 * generan solas la primera vez y se guardan en la configuración, así no hay
 * nada que instalar ni configurar a mano. Se puede fijar a mano con las
 * variables VAPID_PUBLICA y VAPID_PRIVADA, que manda sobre lo guardado.
 *
 * OJO CON CAMBIARLAS: si cambian, TODAS las suscripciones dejan de valer y
 * cada persona tiene que volver a activar los avisos en su perfil. Por eso se
 * generan una vez y se dejan quietas, igual que la clave de las credenciales.
 *
 * En iPhone hay una condición del sistema operativo que no depende de
 * nosotros: los avisos solo funcionan si la persona agregó la aplicación a su
 * pantalla de inicio. En Android y en el computador basta con dar permiso.
 */
const webpush = require('web-push');
const { db } = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS notificacion_suscripciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    aparato TEXT,
    fallos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    usada_en TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_suscripciones_usuario ON notificacion_suscripciones (usuario_id);
`);

/** Lee un valor de la configuración sin pasar por la pantalla de ajustes. */
const guardado = (clave) => {
  const f = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  return f ? f.valor : null;
};

let llaves = null;

/**
 * Las llaves de este servidor, generándolas la primera vez.
 *
 * No se declaran en la pantalla de Configuración a propósito: la privada es un
 * secreto, no una opción que alguien tenga que mirar ni entender.
 */
function lasLlaves() {
  if (llaves) return llaves;
  const deLaVariable = process.env.VAPID_PUBLICA && process.env.VAPID_PRIVADA;
  if (deLaVariable) {
    llaves = { publica: process.env.VAPID_PUBLICA, privada: process.env.VAPID_PRIVADA };
  } else {
    let publica = guardado('push_vapid_publica');
    let privada = guardado('push_vapid_privada');
    if (!publica || !privada) {
      const nuevas = webpush.generateVAPIDKeys();
      publica = nuevas.publicKey;
      privada = nuevas.privateKey;
      const poner = db.prepare(
        `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
      );
      poner.run('push_vapid_publica', publica);
      poner.run('push_vapid_privada', privada);
      console.log('🔔 avisos: se generaron las llaves para los avisos del navegador (una sola vez).');
    }
    llaves = { publica, privada };
  }
  // El «asunto» es a quién reclamarle si este servidor manda de más. No se
  // manda ningún correo desde acá: es una dirección de contacto, nada más.
  webpush.setVapidDetails(
    process.env.VAPID_CONTACTO || 'mailto:sistema@iglesia.local',
    llaves.publica,
    llaves.privada
  );
  return llaves;
}

/** La llave pública, que es la que necesita el navegador para suscribirse. */
const llavePublica = () => lasLlaves().publica;

/** Guarda —o deja al día— la suscripción de un navegador. */
function suscribir(usuarioId, suscripcion, aparato) {
  const { endpoint, keys } = suscripcion || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) return null;
  db.prepare(
    `INSERT INTO notificacion_suscripciones (usuario_id, endpoint, p256dh, auth, aparato)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
       aparato = excluded.aparato, fallos = 0, ultimo_error = NULL`
  ).run(usuarioId, endpoint, keys.p256dh, keys.auth, (aparato || '').slice(0, 120));
  return db.prepare('SELECT * FROM notificacion_suscripciones WHERE endpoint = ?').get(endpoint);
}

function desuscribir(usuarioId, endpoint) {
  return db
    .prepare('DELETE FROM notificacion_suscripciones WHERE usuario_id = ? AND endpoint = ?')
    .run(usuarioId, endpoint).changes;
}

/**
 * Desengancha TODOS los aparatos de una persona.
 *
 * Hace falta porque un aparato solo se puede desenganchar por su nombre —la
 * dirección que le dio el servicio del navegador— y esa dirección la conoce
 * únicamente el navegador que la pidió. Si alguien activó los avisos en un
 * computador que ya no usa, o en una dirección anterior del sistema, o limpió
 * los datos del sitio, esa suscripción queda huérfana: el servidor le sigue
 * mandando avisos y no hay ningún navegador que pueda pedir su baja. Esto es
 * la única salida para esos casos.
 */
function desuscribirTodos(usuarioId) {
  return db.prepare('DELETE FROM notificacion_suscripciones WHERE usuario_id = ?').run(usuarioId).changes;
}

/** Cuántos aparatos tiene enganchados esta persona. */
const cuantosAparatos = (usuarioId) =>
  db.prepare('SELECT COUNT(*) c FROM notificacion_suscripciones WHERE usuario_id = ?').get(usuarioId).c;

/**
 * Manda un aviso a todos los aparatos de una persona.
 *
 * Una suscripción muerta —el navegador se desinstaló, la persona limpió los
 * datos del sitio— se borra en cuanto el servicio del navegador lo dice (404 o
 * 410). Si no se borraran, cada aviso intentaría mandarse a direcciones que ya
 * no existen y la lista crecería para siempre.
 *
 * No se espera a que termine para responderle a nadie: quien crea el aviso ya
 * lo dejó guardado en el sistema, y esto es el extra.
 *
 * «comoMandarlo» solo existe para las pruebas: deja apuntar a un servicio de
 * mentira levantado en la misma máquina. En el sistema andando nadie se lo
 * pasa, y entonces web-push habla con el servicio de verdad del navegador.
 */
async function empujar(usuarioId, { titulo, cuerpo, enlace, etiqueta }, comoMandarlo) {
  const suyas = db.prepare('SELECT * FROM notificacion_suscripciones WHERE usuario_id = ?').all(usuarioId);
  if (!suyas.length) return { mandados: 0, borrados: 0, fallados: 0, porque: null };
  lasLlaves();

  const carga = JSON.stringify({ titulo, cuerpo: cuerpo || '', enlace: enlace || '/', etiqueta: etiqueta || 'aviso' });
  let mandados = 0;
  let borrados = 0;
  // Un envío puede fallar sin que la suscripción esté muerta: el servicio del
  // navegador caído, sin salida a internet, un cortafuegos. Eso hay que
  // devolverlo, no confundirlo con «no hay ningún aparato».
  let fallados = 0;
  let porque = null;

  await Promise.all(
    suyas.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
          comoMandarlo || undefined
        );
        db.prepare("UPDATE notificacion_suscripciones SET fallos = 0, ultimo_error = NULL, usada_en = datetime('now','localtime') WHERE id = ?").run(s.id);
        mandados++;
      } catch (e) {
        const codigo = e && e.statusCode;
        if (codigo === 404 || codigo === 410) {
          db.prepare('DELETE FROM notificacion_suscripciones WHERE id = ?').run(s.id);
          borrados++;
          return;
        }
        const razon = String((e && e.message) || e).slice(0, 200);
        db.prepare('UPDATE notificacion_suscripciones SET fallos = fallos + 1, ultimo_error = ? WHERE id = ?')
          .run(razon, s.id);
        fallados++;
        porque = porque || razon;
      }
    })
  );
  return { mandados, borrados, fallados, porque };
}

module.exports = { llavePublica, suscribir, desuscribir, desuscribirTodos, cuantosAparatos, empujar };
