/**
 * Migraciones de datos (se ejecutan al iniciar y son idempotentes).
 *
 * A diferencia de db.js —que crea tablas y columnas—, aquí se transforma
 * información ya guardada cuando cambia la forma de registrarla.
 */
const { db } = require('./db');
const rut = require('./rut');

/**
 * Pasa los valores del antiguo campo "documento_identidad" al nuevo campo
 * "rut" cuando corresponden a un RUT válido. Los que no lo son (pasaporte,
 * documento extranjero) se dejan intactos en su campo, sin perder el dato.
 */
function documentoIdentidadARut(tabla) {
  const columnas = db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name);
  if (!columnas.includes('documento_identidad') || !columnas.includes('rut')) return;

  const pendientes = db
    .prepare(
      `SELECT id, documento_identidad FROM "${tabla}"
       WHERE (rut IS NULL OR rut = '')
         AND documento_identidad IS NOT NULL AND documento_identidad != ''`
    )
    .all();
  if (!pendientes.length) return;

  let migrados = 0;
  const conservados = [];
  for (const fila of pendientes) {
    const valor = fila.documento_identidad;
    if (!rut.validar(valor)) {
      conservados.push(`#${fila.id} (${valor})`);
      continue;
    }
    const canonico = rut.canonico(valor);
    const duplicado = db.prepare(`SELECT id FROM "${tabla}" WHERE rut = ?`).get(canonico);
    if (duplicado) {
      conservados.push(`#${fila.id} (${valor}: ya usado por #${duplicado.id})`);
      continue;
    }
    db.prepare(`UPDATE "${tabla}" SET rut = ?, documento_identidad = NULL WHERE id = ?`).run(canonico, fila.id);
    migrados++;
  }

  if (migrados) console.log(`🔁 ${tabla}: ${migrados} documento(s) convertido(s) a RUT`);
  if (conservados.length) {
    console.log(
      `ℹ️  ${tabla}: ${conservados.length} documento(s) no son RUT válidos y se conservan ` +
        `en "Otro documento": ${conservados.join(', ')}`
    );
  }
}

function ejecutarMigraciones() {
  documentoIdentidadARut('miembros');
  documentoIdentidadARut('pastores');
}

module.exports = { ejecutarMigraciones };
