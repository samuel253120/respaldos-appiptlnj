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

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';
const TOKEN_TTL = '12h';

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
    req.user = publicUser(user);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function requirePerm(moduleName, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!can(req.user.rol, moduleName, action)) {
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    next();
  };
}

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
  const user = db.prepare('SELECT * FROM usuarios WHERE lower(email) = lower(?)').get(String(email).trim());
  if (!user || !user.password || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (user.activo === 0) return res.status(403).json({ error: 'El usuario está inactivo' });
  const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router, authRequired, requirePerm, JWT_SECRET };
