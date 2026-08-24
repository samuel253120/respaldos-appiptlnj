/**
 * El historial de una solicitud: quién hizo qué, y cuándo.
 *
 * Las anotaciones se escriben solas cuando pasa algo —se ingresa, cambia de
 * estado, se traslada, se responde— y también a mano, desde la propia ficha,
 * para dejar dicho lo que el sistema no puede saber: que se llamó por
 * teléfono, que se conversó con el pastor, que falta un papel.
 *
 * Vive aparte del módulo porque lo usan tres sitios —el guardado, la ruta de
 * traslado y la migración que numera lo que ya existía— y porque así se puede
 * probar sin levantar el servidor.
 */

/** Cómo se nombra a un usuario en el historial. */
function nombreDelUsuario(db, id) {
  if (!id) return 'nadie en particular';
  const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
  return (u && u.nombre) || `el usuario ${id}`;
}

/**
 * Anota algo en el historial de una solicitud.
 *
 * Escribe directo en la tabla y no por el CRUD a propósito: esto corre dentro
 * de la transacción del guardado, y pasar por el motor entero para dejar una
 * línea abriría una segunda transacción encima de la primera.
 *
 * `origen` distingue lo que anotó el sistema de lo que escribió una persona:
 * en una tramitación que duró tres meses, saber cuál es cuál es la diferencia
 * entre un historial que se entiende y una lista de frases sueltas.
 */
function anotar(db, solicitudId, { tipo, descripcion, user, origen = 'Automático', fecha }) {
  const solicitud = db.prepare('SELECT iglesia_id FROM solicitudes WHERE id = ?').get(solicitudId);
  db.prepare(
    `INSERT INTO historial_solicitudes
       (solicitud_id, fecha, tipo, descripcion, origen, registrado_por, iglesia_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    solicitudId,
    fecha || new Date().toISOString().slice(0, 10),
    tipo,
    descripcion,
    origen,
    (user && user.nombre) || 'el sistema',
    (solicitud && solicitud.iglesia_id) || null,
    (user && user.id) || null
  );
}

module.exports = { anotar, nombreDelUsuario };
