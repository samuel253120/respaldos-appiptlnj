/**
 * Conexión a la base de datos (SQLite) y auto-migración.
 *
 * Al iniciar, por cada módulo registrado se crea su tabla si no existe y se
 * agregan las columnas que falten (ALTER TABLE). Esto hace el sistema
 * MODIFICABLE: agregar un campo a un módulo solo requiere declararlo en su
 * archivo de server/modules/ y reiniciar; la columna se crea sola sin perder
 * datos existentes.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { allModules } = require('./registry');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

let db;

/**
 * Cómo se comporta la base cuando hay varias personas trabajando a la vez.
 *
 * WAL es lo que permite que unos lean mientras otro escribe: sin él, cada
 * guardado dejaría esperando a todos los demás. Lo otro son medidas para que
 * nadie quede esperando de más:
 *
 *   busy_timeout   si justo dos guardados coinciden, el segundo espera su
 *                  turno hasta 8 segundos en vez de fallar al instante.
 *   synchronous    con WAL, NORMAL es lo recomendado: la base nunca se daña,
 *                  y a cambio de esperar menos en cada guardado, un corte de
 *                  luz en el peor momento podría llevarse los últimos
 *                  segundos de trabajo.
 *   cache_size     20 MB de páginas en memoria: los listados que se abren una
 *                  y otra vez ya no vuelven al disco.
 *   mmap_size      leer la base como si fuera memoria, que es más rápido.
 *   temp_store     los ordenamientos temporales se hacen en memoria.
 */
function afinar() {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');
  try {
    db.pragma('mmap_size = 268435456');
  } catch (e) {
    /* algunos sistemas de archivos no lo permiten; se sigue igual */
  }
}

try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'iglesias.db'));
  afinar();
  console.log(`💾 Datos en: ${DATA_DIR}${espacioLibre()}`);
} catch (e) {
  const sitio = espacioLibre().trim();
  const explicacion =
    `No se pudo abrir la base de datos en "${DATA_DIR}"${sitio ? ` ${sitio}` : ''}. ` +
    'Revise que la variable DATA_DIR apunte exactamente a la ruta (Mount Path) del volumen ' +
    'del servicio, que el volumen esté conectado y que quede espacio libre en él.';
  console.error(`\n❌ ${explicacion}\n   Detalle técnico: ${e.message}\n`);
  avisarEnPantalla(explicacion, e.message);
  // Sin base de datos no hay sistema que levantar, pero el proceso queda vivo
  // sirviendo la explicación: así, en vez de un error en blanco de la
  // plataforma, se ve en el navegador qué hay que arreglar.
  process.on('uncaughtException', () => {});
  throw e;
}

/**
 * Servidor mínimo de avería: cuando no hay base de datos, responde a todo con
 * la explicación, para que quien entre sepa qué pasa sin mirar los registros
 * del servidor.
 */
function avisarEnPantalla(explicacion, detalle) {
  try {
    const http = require('http');
    const puerto = process.env.PORT || 3000;
    http
      .createServer((req, res) => {
        if (req.url === '/health') {
          // 200 a propósito: el proceso está vivo y puede explicar qué pasa.
          // Si respondiera con error, la plataforma escondería la explicación.
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, base: detalle, detalle: explicacion }));
        }
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
           <title>Sistema fuera de servicio</title>
           <div style="font-family:system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 22px;color:#0f172a">
             <h1 style="font-size:22px">⚠️ El sistema no pudo abrir su base de datos</h1>
             <p style="line-height:1.6;font-size:15px">${explicacion}</p>
             <p style="line-height:1.6;font-size:13px;color:#64748b">Detalle técnico: ${detalle}</p>
             <p style="line-height:1.6;font-size:13px;color:#64748b">
               Los datos no se han perdido: están en el volumen. En cuanto el volumen vuelva a estar
               disponible y con espacio, el sistema arranca solo.</p>
           </div>`
        );
      })
      .listen(puerto, () => console.error(`   Aviso publicado en el puerto ${puerto}.`));
  } catch (err) {
    /* si ni eso se puede, queda el mensaje en el registro */
  }
}

/**
 * Cuánto espacio le queda al volumen. Se dice en el arranque porque un disco
 * lleno es la causa más común de que un sistema que venía funcionando deje de
 * responder: SQLite no puede ni abrir la base cuando no queda sitio.
 */
function espacioLibre() {
  try {
    const disco = fs.statfsSync(DATA_DIR);
    const libres = Math.round((disco.bavail * disco.bsize) / 1048576);
    return libres < 50 ? ` — ⚠️ solo ${libres} MB libres, haga sitio` : ` (${libres} MB libres)`;
  } catch (e) {
    return '';
  }
}

/** Tipo de columna SQL para cada tipo de campo del sistema. */
function sqlType(field) {
  switch (field.type) {
    case 'number':
    case 'money':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'ref':
      return 'INTEGER';
    default:
      // text, textarea, richtext (HTML acotado), date, time, select,
      // multiref (JSON), file, email, tel, password, rut, permisos (JSON)
      return 'TEXT';
  }
}

function migrate() {
  for (const def of allModules()) {
    const cols = def.fields.map((f) => `"${f.name}" ${sqlType(f)}`).join(', ');
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${def.name}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${cols}${cols ? ',' : ''}
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        created_by INTEGER,
        updated_by INTEGER
      )`
    );
    // Agregar columnas nuevas declaradas después de creada la tabla.
    const existing = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    for (const f of def.fields) {
      if (!existing.has(f.name)) {
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${f.name}" ${sqlType(f)}`);
      }
    }
    for (const extra of ['created_at', 'updated_at', 'created_by', 'updated_by']) {
      if (!existing.has(extra) && existing.size) {
        const tipo = extra === 'created_by' || extra === 'updated_by' ? 'INTEGER' : 'TEXT';
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${extra}" ${tipo}`);
      }
    }
  }
}

/**
 * Índices: lo que hace que un listado no tenga que revisar la tabla entera.
 *
 * Sin ellos, buscar las asistencias de una iglesia obliga a la base a mirar
 * las treinta mil marcas una por una, y como el servidor atiende de a una
 * petición, ese rato lo esperan todos los que están conectados. Con ellos, va
 * derecho a las que corresponden.
 *
 * Se deducen del propio esquema, así que un módulo nuevo o un campo nuevo
 * quedan cubiertos sin que nadie se acuerde de agregarlos:
 *
 *   · cada campo de referencia (la iglesia, el cuerpo, el miembro, la
 *     cuenta…), que es por donde se acota y se enlaza todo;
 *   · el campo de fecha del módulo y el campo por el que ordena su listado;
 *   · la pareja iglesia + fecha, que es como se pide casi siempre;
 *   · los campos únicos (el RUT, el correo), para que comprobar que no se
 *     repiten sea instantáneo;
 *   · las columnas de archivo, por las que se averigua de qué ficha es una
 *     foto o un documento cuando alguien pide abrirlo.
 *
 * Los campos únicos llevan índice, no restricción: si en los datos ya
 * traídos de antes hay un repetido, el sistema lo señala al guardar en vez de
 * negarse a arrancar.
 */
function indexar() {
  let creados = 0;
  const crear = (tabla, nombre, expresion) => {
    try {
      const antes = db.prepare('SELECT COUNT(*) AS c FROM sqlite_master WHERE type = ? AND name = ?').get('index', nombre).c;
      db.exec(`CREATE INDEX IF NOT EXISTS "${nombre}" ON "${tabla}" (${expresion})`);
      if (!antes) creados++;
    } catch (e) {
      console.error(`⚠️  No se pudo crear el índice ${nombre}: ${e.message}`);
    }
  };

  for (const def of allModules()) {
    const columnas = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    const hay = (n) => n && columnas.has(n);

    for (const f of def.fields) {
      if (f.type === 'ref' && hay(f.name)) crear(def.name, `ix_${def.name}_${f.name}`, `"${f.name}"`);
      if ((f.unique || f.type === 'rut') && hay(f.name)) crear(def.name, `ix_${def.name}_${f.name}_unico`, `lower("${f.name}")`);
      // Las columnas de archivo: por ellas se averigua de qué ficha es una
      // foto o un documento, para saber quién puede abrirlo (ver archivos.js)
      if (f.type === 'file' && hay(f.name)) crear(def.name, `ix_${def.name}_${f.name}`, `"${f.name}"`);
    }

    const fecha = def.dateField && hay(def.dateField) ? def.dateField : null;
    if (fecha) crear(def.name, `ix_${def.name}_${fecha}`, `"${fecha}"`);
    if (fecha && hay('iglesia_id')) crear(def.name, `ix_${def.name}_iglesia_${fecha}`, `"iglesia_id", "${fecha}"`);

    const orden = def.defaultSort && def.defaultSort.field;
    if (orden && orden !== 'id' && orden !== fecha && hay(orden)) crear(def.name, `ix_${def.name}_${orden}`, `"${orden}"`);
  }

  if (creados) {
    console.log(`⚡ ${creados} índice(s) nuevos: los listados y las búsquedas van directo a lo que buscan.`);
    try {
      db.exec('ANALYZE'); // para que la base sepa cuál índice le conviene
    } catch (e) {
      /* si no se puede, funciona igual, solo elige peor */
    }
  }
}

// Crear y actualizar las tablas no puede tumbar el arranque: si el volumen
// está lleno o de solo lectura, se anota el problema y el sistema levanta
// igual, aunque sea para poder entrar a ver qué pasa.
try {
  migrate();
  indexar();
} catch (e) {
  console.error(
    `⚠️  No se pudieron crear o actualizar las tablas: ${e.message}\n` +
      '   Suele ser falta de espacio en el volumen. El sistema arranca igual, pero no podrá guardar\n' +
      '   hasta que se libere sitio. Revise /health para verlo.'
  );
}

// Cada seis horas la base repasa sus propias estadísticas y se queda con el
// mejor camino para cada consulta, según cómo hayan crecido los datos. Es
// barato y no molesta a nadie: si el sistema se apaga antes, tampoco importa.
try {
  setInterval(() => {
    try {
      db.pragma('optimize');
    } catch (e) {
      /* no es indispensable */
    }
  }, 6 * 60 * 60 * 1000).unref();
} catch (e) {
  /* en un script suelto puede no haber temporizadores; da igual */
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, DB_PATH: path.join(DATA_DIR, 'iglesias.db') };
