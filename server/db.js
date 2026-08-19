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
  console.log(`💾 Datos en: ${DATA_DIR}`);
} catch (e) {
  console.error(
    `\n❌ No se pudo abrir la base de datos en "${DATA_DIR}".\n` +
      '   Revise que la variable DATA_DIR apunte exactamente a la ruta (Mount Path)\n' +
      '   del volumen del servicio y que esa carpeta permita escritura.\n' +
      `   Detalle técnico: ${e.message}\n`
  );
  process.exit(1);
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
      // text, textarea, date, time, select, multiref (JSON), file, email, tel, password
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

migrate();

module.exports = { db, DATA_DIR, UPLOADS_DIR };
