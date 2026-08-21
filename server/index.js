/**
 * Servidor principal del Sistema de Gestión de Iglesias.
 *
 * Arranque:  npm start   (o npm run dev para reinicio automático)
 * Variables: PORT (3000), DATA_DIR (./data), JWT_SECRET
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, DATA_DIR, UPLOADS_DIR } = require('./db');
const { router: authRouter, authRequired } = require('./auth');
const { buildRouter } = require('./crud');
const { allModules } = require('./registry');
const { can, ROLES, ACCIONES, MATRIX, permisosDelRol } = require('./permissions');
const { ensureSeed } = require('./seed');
const { ejecutarMigraciones } = require('./migraciones');
const { router: importarRouter } = require('./importar');
const { router: configuracionRouter } = require('./configuracion');
const ajustes = require('./ajustes');
const alcance = require('./alcance');

const app = express();
app.set('trust proxy', 1); // detrás de un proxy inverso (Railway, Render, Nginx…)
app.use(express.json({ limit: '10mb' }));

// Verificación de salud para plataformas de despliegue.
// Incluye la versión para poder comprobar qué código está realmente en línea.
const VERSION = require('../package.json').version;
app.get('/health', (req, res) => {
  // Además de responder, revisa lo que más falla en un servidor: que la base
  // conteste y que al volumen le quede espacio. Siempre devuelve 200 mientras
  // el sistema pueda contestar —el estado va en el contenido—, para que la
  // plataforma no esconda la explicación detrás de un error en blanco.
  const salud = { ok: true, version: VERSION, base: 'ok', disco: null };
  try {
    db.prepare('SELECT COUNT(*) AS c FROM usuarios').get();
  } catch (e) {
    salud.ok = false;
    salud.base = e.message;
  }
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    const disco = fs.statfsSync(DATA_DIR);
    const libres = disco.bavail * disco.bsize;
    salud.disco = `${Math.round(libres / 1048576)} MB libres`;
    if (libres < 20 * 1048576) {
      salud.ok = false;
      salud.aviso = 'Queda muy poco espacio en el volumen: haga sitio antes de que el sistema no pueda guardar.';
    }
  } catch (e) {
    salud.ok = false;
    salud.disco = e.message;
  }
  res.json(salud);
});

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
      menu: m.menu !== false, // los que se ven dentro de otra ficha no ocupan lugar en el menú
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
          .map(({ name, label, type, required, options, sugerencias, ref, help, default: def, accept, showIf, optionsRoute, readonly, calcula, mostrarEdad, seccion, destacado, buscador }) => ({
            name, label, type, required: !!required, options: options || null,
            sugerencias: sugerencias || null, ref: ref || null,
            help: help || null, default: def ?? null, accept: accept || null, showIf: showIf || null,
            optionsRoute: optionsRoute || null, readonly: !!readonly, mostrarEdad: !!mostrarEdad,
            seccion: seccion || null, destacado: !!destacado,
            buscador: buscador === undefined ? null : !!buscador,
            calcula: calcula ? { ...calcula, porcentaje: porcentajeVigente(calcula) } : null,
            computed: false,
          })),
        ...(m.computed || []).map(({ name, label, type, help }) => ({
          name, label, type, help: help || null, computed: true,
          required: false, options: null, sugerencias: null, ref: null, default: null, accept: null, showIf: null,
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
  const suyas = alcance.iglesiasDe(req.user);
  const nombreDe = (id) => (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id) || {}).nombre;
  if (suyas.length === 1) {
    iglesiaNombre = nombreDe(suyas[0]) || null;
  } else if (suyas.length > 1) {
    const principal = alcance.iglesiaPrincipal(req.user);
    iglesiaNombre = principal
      ? `${nombreDe(principal)} y ${suyas.length - 1} más`
      : `${suyas.length} iglesias asignadas`;
  } else {
    const iglesias = db.prepare('SELECT id, nombre FROM iglesias LIMIT 2').all();
    if (iglesias.length === 1) iglesiaNombre = iglesias[0].nombre;
  }

  // Cuerpos asignados: lo que ve el usuario queda acotado a ellos
  const susCuerpos = alcance.cuerposDe(req.user).map((id) =>
    (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(id) || {}).nombre
  ).filter(Boolean);

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
    user: {
      ...req.user,
      iglesia_nombre: iglesiaNombre,
      iglesias_asignadas: suyas.length,
      cuerpos_asignados: susCuerpos,
    },
  });
});

// ---------- Panel de control ----------
app.get('/api/dashboard', authRequired, (req, res) => {
  const susIglesias = alcance.iglesiasDe(req.user);
  const susCuerpos = alcance.cuerposDe(req.user);
  const iglesiaId = alcance.iglesiaPrincipal(req.user);

  /** `WHERE` que deja solo lo que el usuario tiene asignado. */
  const filtro = (tabla, campoIglesia = 'iglesia_id') => {
    const cond = [];
    const params = [];
    if (susIglesias.length && campoIglesia) {
      cond.push(`${campoIglesia} IN (${susIglesias.map(() => '?').join(',')})`);
      params.push(...susIglesias);
    }
    if (susCuerpos.length && tabla === 'cuerpos') {
      cond.push(`id IN (${susCuerpos.map(() => '?').join(',')})`);
      params.push(...susCuerpos);
    }
    if (susCuerpos.length && tabla === 'miembros') {
      const ids = alcance.miembrosDeCuerpos(susCuerpos);
      cond.push(ids.length ? `id IN (${ids.map(() => '?').join(',')})` : '1 = 0');
      params.push(...ids);
    }
    return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
  };

  const scoped = (table, hasIglesia = true) => {
    const { sql, params } = filtro(table, hasIglesia ? 'iglesia_id' : null);
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}" ${sql}`).get(...params).c;
  };

  const counts = {
    iglesias: susIglesias.length || scoped('iglesias', false),
    miembros: scoped('miembros'),
    cuerpos: scoped('cuerpos'),
    pastores: scoped('pastores'),
    solicitudes_pendientes: (() => {
      const { sql, params } = filtro('solicitudes');
      const donde = sql ? `${sql} AND` : 'WHERE';
      return db.prepare(`SELECT COUNT(*) AS c FROM solicitudes ${donde} estado IN ('Pendiente','En revisión')`).get(...params).c;
    })(),
    certificados: scoped('certificados'),
  };

  let finanzas = null;
  if (can(req.user, 'tesoreria', 'view')) {
    const mes = new Date().toISOString().slice(0, 7); // YYYY-MM
    const marcas = susIglesias.map(() => '?').join(',');
    const w = susIglesias.length ? `AND iglesia_id IN (${marcas})` : '';
    const p = susIglesias;
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
  const cumpleanos = proximosCumpleanos(susIglesias, susCuerpos, ajustes.numero('cumpleanos_cantidad', 1, 20));

  const marcas2 = susIglesias.map(() => '?').join(',');
  const w2 = susIglesias.length ? `WHERE iglesia_id IN (${marcas2})` : '';
  const p2 = susIglesias;
  const ultimasAsistencias = db
    .prepare(
      `SELECT a.id, a.fecha, a.tipo_reunion, a.cuerpos,
              COALESCE(SUM(CASE WHEN d.estado = 'Presente' THEN 1 ELSE 0 END), 0) AS presentes,
              COUNT(d.id) AS marcados
         FROM asistencias a
         LEFT JOIN asistencia_detalle d ON d.asistencia_id = a.id
        ${w2 ? w2.replace('WHERE iglesia_id', 'WHERE a.iglesia_id') : ''}
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
function proximosCumpleanos(iglesias, cuerpos, cuantos) {
  const where = ["fecha_nacimiento IS NOT NULL", "fecha_nacimiento != ''", "(estado IS NULL OR estado NOT IN ('Fallecido', 'Trasladado'))"];
  const params = [];
  if (iglesias.length) {
    where.push(`iglesia_id IN (${iglesias.map(() => '?').join(',')})`);
    params.push(...iglesias);
  }
  if (cuerpos.length) {
    const ids = alcance.miembrosDeCuerpos(cuerpos);
    where.push(ids.length ? `id IN (${ids.map(() => '?').join(',')})` : '1 = 0');
    params.push(...ids);
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

// ---------- Traspaso desde el sistema anterior ----------
app.use('/api/importacion', require('./importacion/web').router);

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

/**
 * El arranque no se detiene por un tropiezo al preparar los datos.
 *
 * Antes, si una migración o la carga inicial fallaban, el proceso moría antes
 * de escuchar y la plataforma respondía "Application failed to respond": nadie
 * podía entrar y no se veía por qué. Ahora se anota el problema y el sistema
 * levanta igual, para poder entrar a revisarlo.
 */
function prepararDatos() {
  try {
    ejecutarMigraciones();
  } catch (e) {
    console.error(`⚠️  Las migraciones no se pudieron completar: ${e.message}`);
  }
  try {
    ensureSeed();
  } catch (e) {
    console.error(`⚠️  Los datos iniciales no se pudieron crear: ${e.message}`);
  }
}

prepararDatos();

// Un error no atrapado no debe tumbar el servidor: se anota y se sigue
process.on('uncaughtException', (e) => console.error('⚠️  Error no atrapado:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('⚠️  Promesa rechazada sin atender:', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sistema de Gestión de Iglesias v${VERSION} escuchando en el puerto ${PORT}`);
  console.log('   (al publicar en internet, este puerto debe coincidir con el "Target port" del dominio)');
});
