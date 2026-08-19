/**
 * Rutas web de la configuración del sistema (solo administradores, salvo
 * las opciones públicas que necesita la pantalla de acceso).
 *
 *   GET  /api/configuracion/publica   sin autenticación: aviso de mantenimiento e identidad
 *   GET  /api/configuracion           definiciones + valores actuales
 *   PUT  /api/configuracion           guardar cambios
 */
const express = require('express');
const { authRequired } = require('./auth');
const { OPCIONES, POR_CLAVE, obtener, todas, guardar } = require('./ajustes');

const PLANOS = OPCIONES.flatMap((g) => g.items);

const router = express.Router();


// Lo mínimo que necesita la pantalla de acceso, sin sesión iniciada
router.get('/publica', (req, res) => {
  const publicas = {};
  for (const o of PLANOS) if (o.publica) publicas[o.clave] = obtener(o.clave);
  res.json(publicas);
});

router.get('/', authRequired, (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden ver la configuración' });
  res.json({
    grupos: OPCIONES.map((g) => ({
      grupo: g.grupo,
      items: g.items.map((o) => ({ clave: o.clave, label: o.label, tipo: o.tipo, ayuda: o.ayuda || null, valor: obtener(o.clave) })),
    })),
  });
});

router.put('/', authRequired, (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo los administradores pueden cambiar la configuración' });
  const cambios = req.body || {};
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!POR_CLAVE[clave]) continue;
    const opcion = POR_CLAVE[clave];
    let v = valor;
    if (opcion.tipo === 'boolean') v = valor ? '1' : '0';
    if (opcion.tipo === 'number' && !Number.isFinite(Number(valor))) continue;
    guardar(clave, v, req.user.id);
  }
  res.json({ ok: true, valores: todas() });
});

module.exports = { router };
