/**
 * Las contraseñas del sistema: cómo se entregan, cómo se cambian y cómo se
 * recuperan.
 *
 * Tres reglas que el sistema hace cumplir en todas partes:
 *
 * 1. **Nunca se guarda una contraseña en claro.** Se guarda su huella
 *    (bcrypt), que sirve para comprobarla pero no para leerla. Por eso el
 *    sistema no puede mostrarle a nadie —tampoco al administrador— la
 *    contraseña que una persona eligió: en su lugar se restablece.
 * 2. **Una contraseña que otro conoce no es suya.** La que entrega el
 *    administrador —la inicial del sistema o una que escriba— obliga a
 *    cambiarla en el primer ingreso.
 * 3. **Siempre hay una salida.** Quien la olvide la recupera con su pregunta
 *    secreta, o el administrador se la restablece a la inicial.
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const ajustes = require('./ajustes');

/** Cuántos intentos fallidos de recuperación se toleran antes de bloquearla. */
const INTENTOS_MAXIMOS = 5;

/** La contraseña inicial que definió el administrador. */
function inicial() {
  return (ajustes.obtener('password_inicial') || 'Iglesia2026').trim() || 'Iglesia2026';
}

/** Largo mínimo exigido a una contraseña propia. */
function largoMinimo() {
  return ajustes.numero('password_minimo', 4, 40);
}

/** Devuelve el problema con una contraseña, o null si sirve. */
function revisarLargo(clave) {
  const texto = String(clave || '');
  const minimo = largoMinimo();
  if (texto.length < minimo) return `La contraseña debe tener al menos ${minimo} caracteres`;
  return null;
}

/**
 * Deja una contraseña puesta en una cuenta.
 *
 * `origen` dice de dónde salió, que es lo único que después se puede contar
 * de ella: 'inicial' (la del sistema, que el administrador conoce),
 * 'definida' (una que escribió el administrador) o 'usuario' (la eligió su
 * dueño, y entonces nadie más la conoce).
 */
function establecer(usuarioId, clave, origen) {
  const propia = origen === 'usuario';
  db.prepare(
    `UPDATE usuarios
        SET password = ?, password_origen = ?, debe_cambiar_password = ?,
            password_cambiada_en = ?, recuperacion_intentos = 0,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(
    bcrypt.hashSync(String(clave), 10),
    origen,
    propia ? 0 : 1,
    propia ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    usuarioId
  );
}

/** Restablece la cuenta a la contraseña inicial y devuelve cuál es. */
function restablecer(usuarioId) {
  const clave = inicial();
  establecer(usuarioId, clave, 'inicial');
  return clave;
}

/**
 * Cómo está la contraseña de una cuenta, para contárselo al administrador
 * sin revelar lo que no se puede revelar.
 */
function estado(usuario) {
  if (!usuario) return null;
  const origen = usuario.password_origen || (usuario.password ? 'usuario' : null);
  if (origen === 'inicial') {
    return {
      origen,
      texto: 'Tiene la contraseña inicial del sistema',
      clave: inicial(), // se puede mostrar: es la que el administrador definió para todos
      nivel: 'medio',
      detalle: 'Todavía no ha entrado a cambiarla por una suya.',
    };
  }
  if (origen === 'definida') {
    return {
      origen,
      texto: 'Tiene una contraseña puesta por el administrador',
      clave: null,
      nivel: 'medio',
      detalle: 'Es la que se escribió al crear o editar la cuenta. El sistema no la guarda en claro, así que no puede mostrarla: si se perdió, restablézcala.',
    };
  }
  return {
    origen: 'usuario',
    texto: usuario.password_cambiada_en
      ? `La cambió su dueño el ${String(usuario.password_cambiada_en).slice(0, 10)}`
      : 'La eligió su dueño',
    clave: null,
    nivel: 'ok',
    detalle: 'El sistema guarda solo su huella, no la contraseña: nadie puede leerla, tampoco el administrador. Si la olvidó, recupérela con su pregunta o restablézcala.',
  };
}

/** Cómo está la recuperación por pregunta secreta de una cuenta. */
function estadoRecuperacion(usuario) {
  const intentos = Number(usuario.recuperacion_intentos || 0);
  return {
    activa: ajustes.activo('recuperacion_activa'),
    tiene_pregunta: !!usuario.pregunta_secreta,
    pregunta: usuario.pregunta_secreta || null,
    bloqueada: intentos >= INTENTOS_MAXIMOS,
    intentos,
    maximo: INTENTOS_MAXIMOS,
  };
}

/** Guarda la pregunta y la respuesta de recuperación (la respuesta, cifrada). */
function guardarPregunta(usuarioId, pregunta, respuesta) {
  const limpia = String(respuesta || '').trim();
  if (!String(pregunta || '').trim()) return 'Escriba la pregunta.';
  if (limpia.length < 3) return 'La respuesta es demasiado corta.';
  db.prepare(
    `UPDATE usuarios SET pregunta_secreta = ?, respuesta_secreta = ?, recuperacion_intentos = 0,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(String(pregunta).trim(), bcrypt.hashSync(normalizar(limpia), 10), usuarioId);
  return null;
}

/** Quita la pregunta de recuperación de una cuenta. */
function quitarPregunta(usuarioId) {
  db.prepare(
    `UPDATE usuarios SET pregunta_secreta = NULL, respuesta_secreta = NULL, recuperacion_intentos = 0 WHERE id = ?`
  ).run(usuarioId);
}

/**
 * La respuesta se compara sin distinguir mayúsculas, tildes ni espacios de
 * más: quien la escribió hace un año no tiene por qué acordarse de cómo la
 * escribió exactamente.
 */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿La respuesta es la correcta? Lleva la cuenta de los intentos fallidos. */
function respuestaCorrecta(usuario, respuesta) {
  if (!usuario.respuesta_secreta) return false;
  const acierta = bcrypt.compareSync(normalizar(respuesta), usuario.respuesta_secreta);
  db.prepare('UPDATE usuarios SET recuperacion_intentos = ? WHERE id = ?')
    .run(acierta ? 0 : Number(usuario.recuperacion_intentos || 0) + 1, usuario.id);
  return acierta;
}

/** Vuelve a habilitar la recuperación de una cuenta bloqueada por intentos. */
function desbloquearRecuperacion(usuarioId) {
  db.prepare('UPDATE usuarios SET recuperacion_intentos = 0 WHERE id = ?').run(usuarioId);
}

module.exports = {
  INTENTOS_MAXIMOS, inicial, largoMinimo, revisarLargo, establecer, restablecer,
  estado, estadoRecuperacion, guardarPregunta, quitarPregunta, respuestaCorrecta,
  desbloquearRecuperacion, normalizar,
};
