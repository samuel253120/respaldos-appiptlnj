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
const compression = require('compression');
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
const archivos = require('./archivos');
const respaldo = require('./respaldo');
const tiposDeArchivo = require('./tiposdearchivo');
const respaldoAutomatico = require('./respaldo-automatico');
const pendientes = require('./pendientes');

const app = express();
app.set('trust proxy', 1); // detrás de un proxy inverso (Railway, Render, Nginx…)
// Todo viaja comprimido. La pantalla del sistema son unos 300 KB de programa y
// los listados vienen en texto: comprimidos pesan como la cuarta parte, que en
// un teléfono con datos móviles es la diferencia entre entrar y quedarse
// esperando. Al servidor le cuesta poco y lo hace una sola vez por respuesta.
app.use(compression());
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
      genero: m.genero || null,
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
          .map(({ name, label, type, required, options, sugerencias, ref, help, default: def, accept, showIf, optionsRoute, readonly, calcula, mostrarEdad, seccion, destacado, buscador, ancho, recorte, recorta }) => ({
            name, label, type, required: !!required, options: options || null,
            sugerencias: sugerencias || null, ref: ref || null,
            help: help || null, default: def ?? null, accept: accept || null, showIf: showIf || null,
            optionsRoute: optionsRoute || null, readonly: !!readonly, mostrarEdad: !!mostrarEdad,
            seccion: seccion || null, destacado: !!destacado, ancho: ancho || null, recorte: recorte || null,
            recorta: recorta || null,
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
  // Entre cuáles puede elegir para trabajar, y con cuáles está trabajando
  const asignadas = alcance.iglesiasAsignadas(req.user);
  const puedeElegir = asignadas.length
    ? db.prepare(`SELECT id, nombre FROM iglesias WHERE id IN (${asignadas.map(() => '?').join(',')}) ORDER BY nombre`).all(...asignadas)
    : db.prepare('SELECT id, nombre FROM iglesias ORDER BY nombre').all();
  const trabajando = alcance.lista(req.user.iglesias_trabajando).filter((id) => puedeElegir.some((i) => i.id === id));
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
    // Los perfiles, para que el editor sepa de dónde sale lo que no se ajusta
    const perfiles = {};
    try {
      for (const p of db.prepare('SELECT id, nombre, permisos FROM perfiles_permisos').all()) {
        let tabla = {};
        try { tabla = JSON.parse(p.permisos || '{}') || {}; } catch (e) { tabla = {}; }
        perfiles[p.id] = { nombre: p.nombre, permisos: tabla };
      }
    } catch (e) { /* la tabla se crea al arrancar; si aún no está, van vacíos */ }

    permisosCatalogo = {
      acciones: ACCIONES,
      modulos: allModules().map((m) => ({ name: m.name, label: m.label, group: m.group })),
      porRol: Object.fromEntries(
        ROLES.map((r) => [
          r.value,
          Object.fromEntries(allModules().map((m) => [m.name, permisosDelRol(r.value, m.name)])),
        ])
      ),
      perfiles,
    };
  }

  res.json({
    modules: mods,
    roles: ROLES,
    permisosCatalogo,
    // La identidad de la institución: el nombre y el lema que se configuran
    institucion: {
      nombre: ajustes.obtener('iglesia_nombre') || '',
      lema: ajustes.obtener('iglesia_lema') || '',
    },
    // Ajustes que la interfaz necesita para trabajar (no son públicos)
    ajustes: {
      imagen_lado_maximo: Math.min(4000, Math.max(600, Number(ajustes.obtener('imagen_lado_maximo')) || 1600)),
      imagen_calidad: Math.min(100, Math.max(40, Number(ajustes.obtener('imagen_calidad')) || 88)),
    },
    user: {
      ...req.user,
      iglesia_nombre: iglesiaNombre,
      iglesias_asignadas: suyas.length,
      iglesias_disponibles: puedeElegir,
      iglesias_trabajando: trabajando,
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
      nombre: require('./nombres').paraMostrar(m.nombres, m.apellidos),
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

/**
 * Lo que falta por llenar en las fichas de miembros.
 *
 * Pide poder ver Miembros y se acota a lo que esa persona alcanza, igual que
 * el listado: el secretario de un cuerpo ve lo que falta en su cuerpo.
 */
app.get('/api/pendientes', authRequired, (req, res) => {
  if (!can(req.user, 'miembros', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para ver Miembros' });
  }
  res.json(pendientes.resumen(req.user));
});

// ---------- Carga de archivos ----------
const TOPE_ARCHIVO = 15 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  },
});

/**
 * El formato se revisa antes de escribir nada en el disco.
 *
 * Un archivo que no corresponde ni siquiera llega a guardarse: multer corta
 * la subida acá mismo. El contenido se revisa después, ya en el disco, donde
 * están los bytes que hay que mirar.
 */
const upload = multer({
  storage,
  limits: { fileSize: TOPE_ARCHIVO },
  fileFilter: (req, file, cb) => {
    const veredicto = tiposDeArchivo.seAcepta(file.originalname, null);
    if (!veredicto.ok) return cb(Object.assign(new Error(veredicto.motivo), { deFormato: true }));
    cb(null, true);
  },
});

/** Los primeros bytes de un archivo recién guardado, para revisar qué es. */
function primerosBytes(ruta, cuantos = 16) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const buffer = Buffer.alloc(cuantos);
    const leidos = fs.readSync(fd, buffer, 0, cuantos, 0);
    return buffer.slice(0, leidos);
  } catch (e) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

app.post('/api/upload', authRequired, (req, res) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) {
      if (err.deFormato) return res.status(400).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `El archivo pesa más de ${TOPE_ARCHIVO / 1024 / 1024} MB. Redúzcalo o guárdelo con menos calidad.`,
        });
      }
      return res.status(400).json({ error: `No se pudo subir el archivo: ${err.message}` });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    // Una foto tiene que ser una foto: llamarle «foto.jpg» a otra cosa no basta
    const veredicto = tiposDeArchivo.seAcepta(req.file.originalname, primerosBytes(req.file.path));
    if (!veredicto.ok) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* si ya no está, mejor */ }
      return res.status(400).json({ error: veredicto.motivo });
    }

    res.json({ filename: req.file.filename, original: req.file.originalname, url: `/uploads/${req.file.filename}` });
  });
});

/**
 * Los archivos subidos: fotos, carnets, certificados, actas escaneadas.
 *
 * Antes se entregaban a quien los pidiera. Ahora hay que tener sesión abierta
 * y que el archivo pertenezca a algo que esa persona pueda ver (ver
 * server/archivos.js). Se sirven con caché privada: el navegador de cada uno
 * guarda los suyos —una foto no cambia—, pero ningún intermediario los
 * comparte con otro.
 */
app.get('/uploads/:archivo', authRequired, (req, res) => {
  const nombre = path.basename(String(req.params.archivo)); // nunca salir de la carpeta
  const permiso = archivos.puedeVer(nombre, req.user);
  if (!permiso.ok) return res.status(403).json({ error: permiso.motivo });
  // El tipo lo pone el sistema desde su propia lista, nunca el nombre del
  // archivo, y solo las fotos y los PDF se abren en pantalla (ver
  // server/tiposdearchivo.js)
  const cabeceras = { 'Cache-Control': 'private, max-age=86400', ...tiposDeArchivo.comoSeEntrega(nombre) };
  res.sendFile(path.join(UPLOADS_DIR, nombre), { headers: cabeceras }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Archivo no encontrado' });
  });
});

// ---------- Respaldo: bajarse todo el sistema en un archivo ----------
/** Solo el administrador: el respaldo lleva absolutamente todo. */
function soloAdministrador(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede descargar el respaldo del sistema' });
  }
  next();
}

app.get('/api/respaldo/info', authRequired, soloAdministrador, (req, res) => {
  res.json({ ...respaldo.tamano(), nombre: respaldo.nombreDelPaquete() });
});

app.get('/api/respaldo', authRequired, soloAdministrador, async (req, res) => {
  try {
    await respaldo.enviar(res);
  } catch (e) {
    console.error('⚠️  No se pudo armar el respaldo:', e);
    if (!res.headersSent) res.status(500).json({ error: `No se pudo armar el respaldo: ${e.message}` });
  }
});

/**
 * El respaldo que se hace solo: cómo va y qué copias hay guardadas.
 *
 * Existe para que no haya que creerle al sistema: se ve la fecha de la última
 * copia, cuántas se conservan y lo que pesa cada una, y se puede bajar
 * cualquiera de ellas.
 */
app.get('/api/respaldo/automatico', authRequired, soloAdministrador, (req, res) => {
  res.json(respaldoAutomatico.estado());
});

/** Hacer la copia ahora mismo, sin esperar a la noche. */
app.post('/api/respaldo/automatico', authRequired, soloAdministrador, async (req, res) => {
  const hecho = await respaldoAutomatico.hacerCopia({ forzada: true });
  if (!hecho.hecho) return res.status(500).json({ error: `No se pudo hacer la copia: ${hecho.motivo}` });
  res.json({ ...hecho, estado: respaldoAutomatico.estado() });
});

/** Bajarse una de las copias guardadas. */
app.get('/api/respaldo/automatico/:archivo', authRequired, soloAdministrador, (req, res) => {
  const ruta = respaldoAutomatico.rutaDe(req.params.archivo);
  if (!ruta) return res.status(404).json({ error: 'Esa copia ya no está' });
  res.download(ruta, path.basename(ruta));
});

// ---------- Importación masiva desde archivos ----------
app.use('/api/importar', importarRouter);

// ---------- Traspaso desde el sistema anterior ----------
app.use('/api/importacion', require('./importacion/web').router);

// ---------- CRUD genérico de todos los módulos ----------
app.use('/api', buildRouter());

// ---------- Frontend ----------
/**
 * Los archivos del programa (el guion, los estilos, los iconos) no cambian
 * hasta que se publica una versión nueva, así que el navegador los guarda por
 * una semana y deja de pedirlos en cada visita: quien entra dos veces al día
 * solo descarga los datos. Se llaman con el número de versión detrás
 * (app.js?v=1.43.1), que es lo que hace que al publicar una versión nueva
 * todos reciban la nueva y no la guardada.
 *
 * La página que los llama —index.html— no se guarda nunca, para que ese
 * número de versión siempre llegue fresco.
 */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UNA_SEMANA = 7 * 24 * 60 * 60 * 1000;
const PAGINA = fs
  .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replace(/__VERSION__/g, encodeURIComponent(VERSION));
/** La página del sistema, con el número de versión ya puesto. */
const paginaPrincipal = (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(PAGINA);
};
app.get('/index.html', paginaPrincipal);
app.use(
  express.static(PUBLIC_DIR, {
    index: false, // la página la arma paginaPrincipal, con la versión puesta
    maxAge: UNA_SEMANA,
    setHeaders: (res, ruta) => {
      if (ruta.endsWith('.html') || ruta.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  paginaPrincipal(req, res);
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
  try {
    respaldoAutomatico.programar();
  } catch (e) {
    console.error(`⚠️  El respaldo automático no quedó programado: ${e.message}`);
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
