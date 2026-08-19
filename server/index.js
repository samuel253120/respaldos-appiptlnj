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
const { can, ROLES, ACCIONES, MATRIX, permisosDelRol } = require('./permissions');
const { ensureSeed } = require('./seed');
const { ejecutarMigraciones } = require('./migraciones');
const { router: importarRouter } = require('./importar');
const { router: configuracionRouter } = require('./configuracion');
const ajustes = require('./ajustes');

const app = express();
app.set('trust proxy', 1); // detrás de un proxy inverso (Railway, Render, Nginx…)
app.use(express.json({ limit: '10mb' }));

// Verificación de salud para plataformas de despliegue.
// Incluye la versión para poder comprobar qué código está realmente en línea.
const VERSION = require('../package.json').version;
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));

// ---------- Autenticación ----------
app.use('/api/auth', authRouter);

// ---------- Configuración del sistema ----------
app.use('/api/configuracion', configuracionRouter);

// ---------- Metadatos: módulos visibles para el usuario y sus esquemas ----------
/** Porcentaje configurado de un campo que se calcula solo, para mostrarlo en vivo. */
function porcentajeVigente(calcula) {
  if (calcula.tipo !== 'porcentaje') return undefined;
  if (calcula.opcion) {
    const n = Number(ajustes.obtener(calcula.opcion));
    if (Number.isFinite(n)) return n;
  }
  return Number(calcula.porcentaje) || 0;
}

app.get('/api/meta', authRequired, (req, res) => {
  const mods = allModules()
    .filter((m) => can(req.user, m.name, 'view'))
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
      filterFields: m.filterFields,
      defaultSort: m.defaultSort,
      fields: [
        ...m.fields
          .filter((f) => !f.oculto)
          .map(({ name, label, type, required, options, ref, help, default: def, accept, showIf, optionsRoute, readonly, calcula, mostrarEdad }) => ({
            name, label, type, required: !!required, options: options || null, ref: ref || null,
            help: help || null, default: def ?? null, accept: accept || null, showIf: showIf || null,
            optionsRoute: optionsRoute || null, readonly: !!readonly, mostrarEdad: !!mostrarEdad,
            calcula: calcula ? { ...calcula, porcentaje: porcentajeVigente(calcula) } : null,
            computed: false,
          })),
        ...(m.computed || []).map(({ name, label, type, help }) => ({
          name, label, type, help: help || null, computed: true,
          required: false, options: null, ref: null, default: null, accept: null, showIf: null,
          optionsRoute: null, readonly: true, calcula: null,
        })),
      ],
      perms: {
        view: can(req.user, m.name, 'view'),
        create: can(req.user, m.name, 'create'),
        edit: can(req.user, m.name, 'edit'),
        delete: can(req.user, m.name, 'delete'),
      },
    }));
  // Iglesia local en la que trabaja el usuario. Si no tiene una asignada pero
  // el sistema administra una sola, se muestra esa; con varias, "Todas".
  let iglesiaNombre = null;
  if (req.user.iglesia_id) {
    const ig = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(req.user.iglesia_id);
    iglesiaNombre = ig ? ig.nombre : null;
  } else {
    const iglesias = db.prepare('SELECT id, nombre FROM iglesias LIMIT 2').all();
    if (iglesias.length === 1) iglesiaNombre = iglesias[0].nombre;
  }

  // Catálogo para el editor de permisos personalizados (solo administradores)
  let permisosCatalogo = null;
  if (req.user.rol === 'admin') {
    permisosCatalogo = {
      acciones: ACCIONES,
      modulos: allModules().map((m) => ({ name: m.name, label: m.label, group: m.group })),
      porRol: Object.fromEntries(
        ROLES.map((r) => [
          r.value,
          Object.fromEntries(allModules().map((m) => [m.name, permisosDelRol(r.value, m.name)])),
        ])
      ),
    };
  }

  res.json({
    modules: mods,
    roles: ROLES,
    permisosCatalogo,
    // Ajustes que la interfaz necesita para trabajar (no son públicos)
    ajustes: {
      imagen_lado_maximo: Math.min(4000, Math.max(600, Number(ajustes.obtener('imagen_lado_maximo')) || 1600)),
      imagen_calidad: Math.min(100, Math.max(40, Number(ajustes.obtener('imagen_calidad')) || 88)),
    },
    user: { ...req.user, iglesia_nombre: iglesiaNombre },
  });
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
  if (can(req.user, 'tesoreria', 'view')) {
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

  // Próximos cumpleaños: se calculan desde el mes y el día de nacimiento,
  // tomando el próximo que venga (hoy cuenta como cumpleaños de hoy).
  const cumpleanos = proximosCumpleanos(iglesiaId, ajustes.numero('cumpleanos_cantidad', 1, 20));

  const w2 = iglesiaId ? 'WHERE iglesia_id = ?' : '';
  const p2 = iglesiaId ? [iglesiaId] : [];
  const ultimasAsistencias = db
    .prepare(
      `SELECT a.id, a.fecha, a.tipo_reunion, a.cuerpos,
              COALESCE(SUM(CASE WHEN d.estado = 'Presente' THEN 1 ELSE 0 END), 0) AS presentes,
              COUNT(d.id) AS marcados
         FROM asistencias a
         LEFT JOIN asistencia_detalle d ON d.asistencia_id = a.id
        ${w2 ? w2.replace('WHERE iglesia_id = ?', 'WHERE a.iglesia_id = ?') : ''}
        GROUP BY a.id ORDER BY a.fecha DESC LIMIT 5`
    )
    .all(...p2)
    .map((a) => {
      // Los cuerpos convocados se guardan como lista: se resuelven sus nombres
      let ids = [];
      try {
        ids = JSON.parse(a.cuerpos || '[]').map(Number).filter(Boolean);
      } catch (e) {
        ids = [];
      }
      const nombres = ids
        .map((id) => (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(id) || {}).nombre)
        .filter(Boolean);
      return { ...a, cuerpo: nombres.join(' + ') || null };
    });
  const solicitudesRecientes = db
    .prepare(`SELECT id, fecha, solicitante, asunto, estado FROM solicitudes ${w2} ORDER BY fecha DESC LIMIT 5`)
    .all(...p2);

  res.json({ counts, finanzas, cumpleanos, ultimasAsistencias, solicitudesRecientes });
});

/**
 * Los miembros que cumplen años más pronto, ordenados por lo que falta.
 *
 * Se mira solo el mes y el día: el año que viene o este, según corresponda.
 * Quien cumple hoy encabeza la lista. No se incluye a los fallecidos ni a los
 * trasladados, porque ya no son parte de la congregación.
 */
function proximosCumpleanos(iglesiaId, cuantos) {
  const where = ["fecha_nacimiento IS NOT NULL", "fecha_nacimiento != ''", "(estado IS NULL OR estado NOT IN ('Fallecido', 'Trasladado'))"];
  const params = [];
  if (iglesiaId) {
    where.push('iglesia_id = ?');
    params.push(iglesiaId);
  }
  const filas = db
    .prepare(`SELECT id, nombres, apellidos, foto, fecha_nacimiento, telefono FROM miembros WHERE ${where.join(' AND ')}`)
    .all(...params);

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const MS_DIA = 24 * 60 * 60 * 1000;

  const conFecha = [];
  for (const m of filas) {
    const partes = String(m.fecha_nacimiento).slice(0, 10).split('-');
    const mes = Number(partes[1]);
    const dia = Number(partes[2]);
    const anioNace = Number(partes[0]);
    if (!mes || !dia || !anioNace) continue;

    // El próximo cumpleaños: este año si aún no pasa, si no el siguiente.
    // El 29 de febrero se celebra el 28 en los años que no son bisiestos.
    const armar = (anio) => {
      const f = new Date(anio, mes - 1, dia);
      if (f.getMonth() !== mes - 1) f.setDate(0); // 29-feb en año común → 28-feb
      f.setHours(0, 0, 0, 0);
      return f;
    };
    let proximo = armar(hoy.getFullYear());
    if (proximo < hoy) proximo = armar(hoy.getFullYear() + 1);

    conFecha.push({
      id: m.id,
      nombre: `${m.nombres || ''} ${m.apellidos || ''}`.trim(),
      foto: m.foto || null,
      telefono: m.telefono || null,
      fecha: `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, '0')}-${String(proximo.getDate()).padStart(2, '0')}`,
      dia,
      mes,
      dias: Math.round((proximo - hoy) / MS_DIA),
      cumple: proximo.getFullYear() - anioNace, // los años que cumplirá
    });
  }

  conFecha.sort((a, b) => a.dias - b.dias || a.nombre.localeCompare(b.nombre));
  return conFecha.slice(0, Math.max(1, Math.min(20, cuantos || 4)));
}

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

// ---------- Importación masiva desde archivos ----------
app.use('/api/importar', importarRouter);

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
  console.log(`✅ Sistema de Gestión de Iglesias v${VERSION} escuchando en el puerto ${PORT}`);
  console.log('   (al publicar en internet, este puerto debe coincidir con el "Target port" del dominio)');
});
