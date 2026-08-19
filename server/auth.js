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
  const { password, ...rest } = u;
  return rest;
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

module.exports = { router, authRequired, requirePerm, JWT_SECRET, bloqueoPorMantenimiento };
