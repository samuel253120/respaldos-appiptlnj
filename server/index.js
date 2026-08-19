/**
 * Servidor principal del Sistema de Gestión de Iglesias.
 *
 * Arranque:  npm start   (o npm run dev para reinicio automático)
 * Variables: PORT (3000), DATA_DIR (./data), JWT_SECRET
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, UPLOADS_DIR } = require('./db');
const { router: authRouter, authRequired } = require('./auth');
const { buildRouter } = require('./crud');
const { allModules } = require('./registry');
const { can, ROLES } = require('./permissions');
const { ensureSeed } = require('./seed');
const { ejecutarMigraciones } = require('./migraciones');

const app = express();
app.set('trust proxy', 1); // detrás de un proxy inverso (Railway, Render, Nginx…)
app.use(express.json({ limit: '10mb' }));

// Verificación de salud para plataformas de despliegue
app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- Autenticación ----------
app.use('/api/auth', authRouter);

// ---------- Metadatos: módulos visibles para el usuario y sus esquemas ----------
app.get('/api/meta', authRequired, (req, res) => {
  const mods = allModules()
    .filter((m) => can(req.user.rol, m.name, 'view'))
    .map((m) => ({
      name: m.name,
      label: m.label,
      labelSingular: m.labelSingular,
      icon: m.icon,
      group: m.group,
      order: m.order,
      display: m.display,
      printable: !!m.printable,
      dateField: m.dateField || null,
      searchFields: m.searchFields,
      listFields: m.listFields,
      defaultSort: m.defaultSort,
      fields: m.fields.map(({ name, label, type, required, options, ref, help, default: def, accept }) => ({
        name, label, type, required: !!required, options: options || null, ref: ref || null, help: help || null, default: def ?? null, accept: accept || null,
      })),
      perms: {
        view: can(req.user.rol, m.name, 'view'),
        create: can(req.user.rol, m.name, 'create'),
        edit: can(req.user.rol, m.name, 'edit'),
        delete: can(req.user.rol, m.name, 'delete'),
      },
    }));
  res.json({ modules: mods, roles: ROLES, user: req.user });
});

// ---------- Panel de control ----------
app.get('/api/dashboard', authRequired, (req, res) => {
  const iglesiaId = req.user.iglesia_id || null;
  const scoped = (table, hasIglesia = true) => {
    if (iglesiaId && hasIglesia) {
      return db.prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE iglesia_id = ?`).get(iglesiaId).c;
    }
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  };

  const counts = {
    iglesias: iglesiaId ? 1 : scoped('iglesias', false),
    miembros: scoped('miembros'),
    cuerpos: scoped('cuerpos'),
    pastores: scoped('pastores'),
    solicitudes_pendientes: iglesiaId
      ? db.prepare("SELECT COUNT(*) AS c FROM solicitudes WHERE estado IN ('Pendiente','En revisión') AND iglesia_id = ?").get(iglesiaId).c
      : db.prepare("SELECT COUNT(*) AS c FROM solicitudes WHERE estado IN ('Pendiente','En revisión')").get().c,
    certificados: scoped('certificados'),
  };

  let finanzas = null;
  if (can(req.user.rol, 'tesoreria', 'view')) {
    const mes = new Date().toISOString().slice(0, 7); // YYYY-MM
    const w = iglesiaId ? 'AND iglesia_id = ?' : '';
    const p = iglesiaId ? [iglesiaId] : [];
    const row = (tipo, mesOnly) =>
      db
        .prepare(`SELECT COALESCE(SUM(monto),0) AS t FROM tesoreria WHERE tipo = ? ${mesOnly ? "AND substr(fecha,1,7) = ?" : ''} ${w}`)
        .get(tipo, ...(mesOnly ? [mes] : []), ...p).t;
    finanzas = {
      mes,
      ingresos_mes: row('Ingreso', true),
      egresos_mes: row('Egreso', true),
      ingresos_total: row('Ingreso', false),
      egresos_total: row('Egreso', false),
    };
    finanzas.balance_total = finanzas.ingresos_total - finanzas.egresos_total;
  }

  const w2 = iglesiaId ? 'WHERE iglesia_id = ?' : '';
  const p2 = iglesiaId ? [iglesiaId] : [];
  const ultimasAsistencias = db
    .prepare(`SELECT id, fecha, tipo_reunion, total_general FROM asistencias ${w2} ORDER BY fecha DESC LIMIT 5`)
    .all(...p2);
  const solicitudesRecientes = db
    .prepare(`SELECT id, fecha, solicitante, asunto, estado FROM solicitudes ${w2} ORDER BY fecha DESC LIMIT 5`)
    .all(...p2);

  res.json({ counts, finanzas, ultimasAsistencias, solicitudesRecientes });
});

// ---------- Carga de archivos ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.post('/api/upload', authRequired, upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
  res.json({ filename: req.file.filename, original: req.file.originalname, url: `/uploads/${req.file.filename}` });
});

app.use('/uploads', express.static(UPLOADS_DIR));

// ---------- CRUD genérico de todos los módulos ----------
app.use('/api', buildRouter());

// ---------- Frontend ----------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Manejo de errores no capturados en rutas
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

ejecutarMigraciones();
ensureSeed();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sistema de Gestión de Iglesias escuchando en el puerto ${PORT}`);
  console.log('   (al publicar en internet, este puerto debe coincidir con el "Target port" del dominio)');
});
