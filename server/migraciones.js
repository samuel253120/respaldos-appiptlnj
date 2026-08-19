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


/**
 * El campo "tipo" de cuerpos/grupos pasó a tener solo dos valores: Cuerpo y
 * Grupo (antes se usaba para el nombre: Damas, Caballeros, Jóvenes…). Los
 * registros anteriores se dejan como "Cuerpo" y se informa cuáles fueron,
 * para que se revisen y ajusten a "Grupo" los que corresponda.
 */
function normalizarTipoCuerpos() {
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  if (!columnas.includes('tipo')) return;

  const antiguos = db
    .prepare(`SELECT id, nombre, tipo FROM cuerpos WHERE tipo IS NOT NULL AND tipo NOT IN ('Cuerpo', 'Grupo')`)
    .all();
  if (!antiguos.length) return;

  const actualizar = db.prepare(`UPDATE cuerpos SET tipo = 'Cuerpo' WHERE id = ?`);
  for (const fila of antiguos) actualizar.run(fila.id);
  console.log(
    `🔁 cuerpos: ${antiguos.length} registro(s) quedaron como "Cuerpo" (antes el tipo guardaba el nombre): ` +
      antiguos.map((f) => `${f.nombre} [era "${f.tipo}"]`).join(', ') +
      '\n   Revise cuáles corresponden a "Grupo" y ajústelos en el módulo Cuerpos / Grupos.'
  );
}

function ejecutarMigraciones() {
  documentoIdentidadARut('miembros');
  documentoIdentidadARut('pastores');
  normalizarTipoCuerpos();
}

module.exports = { ejecutarMigraciones };
