/**
 * Autenticación (JWT) y autorización.
 *
 * - POST /api/auth/login  { email, password } -> { token, user }
 * - GET  /api/auth/me     -> usuario actual
 *
 * El middleware `authRequired` valida el token y carga el usuario en
 * req.user. `requirePerm(module, action)` verifica la matriz de permisos.
 *
 * Alcance por iglesia: si el usuario tiene iglesia_id asignada, solo ve y
 * modifica registros de esa iglesia (los administradores sin iglesia
 * asignada ven todas).
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { can } = require('./permissions');
const rutUtil = require('./rut');
const ajustes = require('./ajustes');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';

/** Duración de la sesión, configurable desde la pantalla de configuración. */
function duracionSesion() {
  return `${ajustes.numero('sesion_horas', 1, 720)}h`;
}

/**
 * Con el sistema en mantenimiento solo entran los administradores.
 * Devuelve el aviso a mostrar, o null si el paso está permitido.
 */
function bloqueoPorMantenimiento(usuario) {
  if (!ajustes.activo('mantenimiento_activo')) return null;
  if (usuario && usuario.rol === 'admin') return null;
  return ajustes.obtener('mantenimiento_mensaje') || 'El sistema está en mantenimiento.';
}

function publicUser(u) {
  if (!u) return null;
  const { password, respuesta_secreta, ...rest } = u;
  return {
    ...rest,
    debe_cambiar_password: !!u.debe_cambiar_password,
    tiene_pregunta_secreta: !!u.pregunta_secreta,
  };
}

/** Lo único que se permite mientras la contraseña siga siendo la entregada. */
function rutaDeCambio(req) {
  const camino = req.baseUrl + req.path;
  return ['/api/auth/me', '/api/auth/cambiar-password', '/api/auth/salir'].includes(camino);
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(payload.id);
    if (!user || user.activo === 0) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });

    const aviso = bloqueoPorMantenimiento(user);
    if (aviso) return res.status(503).json({ error: aviso, mantenimiento: true });

    // Con la contraseña que le entregó el administrador solo puede hacer una
    // cosa: cambiarla. El resto del sistema queda cerrado hasta entonces, y
    // se comprueba aquí, no en la pantalla.
    if (user.debe_cambiar_password && !rutaDeCambio(req)) {
      return res.status(403).json({
        error: 'Antes de seguir, cambie su contraseña por una suya.',
        cambiar_password: true,
      });
    }

    req.user = publicUser(user);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function requirePerm(moduleName, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!can(req.user, moduleName, action)) {
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    next();
  };
}

const router = express.Router();

router.post('/login', (req, res) => {
  const body = req.body || {};
  // El identificador de acceso es el RUT. Se acepta también `usuario` o
  // `email` por compatibilidad con clientes anteriores.
  const identificador = String(body.rut || body.usuario || body.email || '').trim();
  const password = body.password;
  if (!identificador || !password) {
    return res.status(400).json({ error: 'RUT y contraseña son requeridos' });
  }

  // Búsqueda por RUT normalizado (acepta con o sin puntos y guion).
  let user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(identificador));

  // Respaldo: cuentas creadas antes de usar el RUT todavía pueden entrar con
  // su correo hasta que se les asigne uno.
  if (!user && identificador.includes('@')) {
    user = db.prepare('SELECT * FROM usuarios WHERE lower(email) = lower(?)').get(identificador);
  }

  if (!user || !user.password || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (user.activo === 0) return res.status(403).json({ error: 'El usuario está inactivo' });

  const aviso = bloqueoPorMantenimiento(user);
  if (aviso) return res.status(503).json({ error: aviso, mantenimiento: true });

  const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: duracionSesion() });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * Cambiar la propia contraseña. Se pide la actual —salvo cuando todavía es la
 * que entregó el administrador y por eso está obligado a cambiarla—, y la
 * nueva tiene que ser distinta: si no, no habría cambiado nada.
 */
router.post('/cambiar-password', authRequired, (req, res) => {
  const claves = require('./claves');
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  const { actual, nueva } = req.body || {};

  if (!user.debe_cambiar_password) {
    if (!actual || !bcrypt.compareSync(String(actual), user.password)) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
  }
  const problema = claves.revisarLargo(nueva);
  if (problema) return res.status(400).json({ error: problema });
  if (bcrypt.compareSync(String(nueva), user.password)) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que ser distinta de la actual' });
  }

  claves.establecer(user.id, nueva, 'usuario');
  const actualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
  res.json({ ok: true, user: publicUser(actualizado) });
});

/** La pregunta secreta de la propia cuenta, y cómo está la recuperación. */
router.get('/pregunta-secreta', authRequired, (req, res) => {
  const claves = require('./claves');
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  res.json({ ...claves.estadoRecuperacion(user), estado_clave: claves.estado(user) });
});

/** Definir (o quitar) la pregunta secreta de la propia cuenta. */
router.post('/pregunta-secreta', authRequired, (req, res) => {
  const claves = require('./claves');
  const { pregunta, respuesta, quitar } = req.body || {};
  if (quitar) {
    claves.quitarPregunta(req.user.id);
    return res.json({ ok: true, tiene_pregunta: false });
  }
  const problema = claves.guardarPregunta(req.user.id, pregunta, respuesta);
  if (problema) return res.status(400).json({ error: problema });
  res.json({ ok: true, tiene_pregunta: true });
});

/**
 * Recuperar la contraseña olvidada, desde la pantalla de acceso: primero se
 * pide la pregunta de esa cuenta y después se responde eligiendo una nueva.
 */
router.post('/recuperar/pregunta', (req, res) => {
  const claves = require('./claves');
  const ajustes = require('./ajustes');
  if (!ajustes.activo('recuperacion_activa')) {
    return res.status(400).json({ error: 'La recuperación por pregunta está desactivada. Pida al administrador que le restablezca la contraseña.' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(String((req.body || {}).rut || '')));
  if (!user || !user.activo) {
    return res.status(404).json({ error: 'No hay una cuenta activa con ese RUT.' });
  }
  const estado = claves.estadoRecuperacion(user);
  if (!estado.tiene_pregunta) {
    return res.status(400).json({ error: 'Esa cuenta no tiene pregunta de recuperación. Pida al administrador que le restablezca la contraseña.' });
  }
  if (estado.bloqueada) {
    return res.status(423).json({ error: 'La recuperación quedó bloqueada por demasiados intentos. Pida al administrador que la habilite.' });
  }
  res.json({ pregunta: estado.pregunta, intentos_restantes: estado.maximo - estado.intentos });
});

router.post('/recuperar', (req, res) => {
  const claves = require('./claves');
  const ajustes = require('./ajustes');
  if (!ajustes.activo('recuperacion_activa')) {
    return res.status(400).json({ error: 'La recuperación por pregunta está desactivada.' });
  }
  const { rut, respuesta, nueva } = req.body || {};
  const user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(String(rut || '')));
  if (!user || !user.activo) return res.status(404).json({ error: 'No hay una cuenta activa con ese RUT.' });

  const estado = claves.estadoRecuperacion(user);
  if (!estado.tiene_pregunta) return res.status(400).json({ error: 'Esa cuenta no tiene pregunta de recuperación.' });
  if (estado.bloqueada) {
    return res.status(423).json({ error: 'La recuperación quedó bloqueada por demasiados intentos. Pida al administrador que la habilite.' });
  }
  const problema = claves.revisarLargo(nueva);
  if (problema) return res.status(400).json({ error: problema });

  if (!claves.respuestaCorrecta(user, respuesta)) {
    const quedan = estado.maximo - (estado.intentos + 1);
    return res.status(401).json({
      error: quedan > 0
        ? `La respuesta no coincide. Le quedan ${quedan} intento(s).`
        : 'La respuesta no coincide y se agotaron los intentos. Pida al administrador que le restablezca la contraseña.',
    });
  }

  // La eligió su dueño: no hay nada que cambiar en el primer ingreso
  claves.establecer(user.id, nueva, 'usuario');
  res.json({ ok: true });
});

module.exports = { router, authRequired, requirePerm, JWT_SECRET, bloqueoPorMantenimiento };
