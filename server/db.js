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
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'iglesias.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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
      // text, textarea, date, time, select, multiref (JSON), file, email,
      // tel, password, rut, permisos (JSON)
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
        created_by INTEGER
      )`
    );
    // Agregar columnas nuevas declaradas después de creada la tabla.
    const existing = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    for (const f of def.fields) {
      if (!existing.has(f.name)) {
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${f.name}" ${sqlType(f)}`);
      }
    }
    for (const extra of ['created_at', 'updated_at', 'created_by']) {
      if (!existing.has(extra) && existing.size) {
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${extra}" ${extra === 'created_by' ? 'INTEGER' : 'TEXT'}`);
      }
    }
  }
}

// Crear y actualizar las tablas no puede tumbar el arranque: si el volumen
// está lleno o de solo lectura, se anota el problema y el sistema levanta
// igual, aunque sea para poder entrar a ver qué pasa.
try {
  migrate();
} catch (e) {
  console.error(
    `⚠️  No se pudieron crear o actualizar las tablas: ${e.message}\n` +
      '   Suele ser falta de espacio en el volumen. El sistema arranca igual, pero no podrá guardar\n' +
      '   hasta que se libere sitio. Revise /health para verlo.'
  );
}

module.exports = { db, DATA_DIR, UPLOADS_DIR };
