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


/**
 * La directiva de un cuerpo dejó de guardarse en el propio cuerpo para pasar
 * al módulo "directivas", que guarda el histórico por períodos. Los datos ya
 * cargados se convierten en la primera directiva vigente de cada cuerpo.
 */
function directivaCuerpoAHistorico() {
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  const cargos = ['presidente_id', 'secretario_id', 'tesorero_id'];
  if (!cargos.some((c) => columnas.includes(c))) return;

  const seleccion = ['id', 'nombre', 'iglesia_id', 'fecha_constitucion']
    .concat(cargos.filter((c) => columnas.includes(c)))
    .concat(columnas.includes('periodo_directiva') ? ['periodo_directiva'] : [])
    .join(', ');

  const filas = db.prepare(`SELECT ${seleccion} FROM cuerpos`).all().filter(
    (f) => f.presidente_id || f.secretario_id || f.tesorero_id || f.periodo_directiva
  );
  if (!filas.length) return;

  let migradas = 0;
  for (const fila of filas) {
    const yaTiene = db.prepare('SELECT id FROM directivas WHERE cuerpo_id = ?').get(fila.id);
    if (yaTiene) continue;
    db.prepare(
      `INSERT INTO directivas (cuerpo_id, periodo, fecha_inicio, primer_jefe_id, secretario_id,
                               tesorero_id, iglesia_id, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Vigente', ?)`
    ).run(
      fila.id,
      fila.periodo_directiva || 'Período inicial',
      fila.fecha_constitucion || new Date().toISOString().slice(0, 10),
      fila.presidente_id || null,
      fila.secretario_id || null,
      fila.tesorero_id || null,
      fila.iglesia_id || null,
      'Directiva registrada antes de llevar el histórico por períodos.'
    );
    // Se limpian los campos antiguos del cuerpo para no duplicar el dato
    for (const c of cargos.filter((c) => columnas.includes(c))) {
      db.prepare(`UPDATE cuerpos SET "${c}" = NULL WHERE id = ?`).run(fila.id);
    }
    migradas++;
  }
  if (migradas) {
    console.log(`🔁 directivas: ${migradas} directiva(s) pasaron al histórico como vigentes.`);
  }
}


/**
 * Los cargos de la directiva pasaron a los que usa la organización:
 * presidente → primer jefe / primera jefa, y vicepresidente → segundo jefe /
 * segunda jefa. Se traspasan los valores ya registrados.
 */
function renombrarCargosDirectiva() {
  const columnas = db.prepare('PRAGMA table_info("directivas")').all().map((c) => c.name);
  const pares = [
    ['presidente_id', 'primer_jefe_id'],
    ['vicepresidente_id', 'segundo_jefe_id'],
  ].filter(([viejo, nuevo]) => columnas.includes(viejo) && columnas.includes(nuevo));
  if (!pares.length) return;

  let movidos = 0;
  for (const [viejo, nuevo] of pares) {
    const info = db
      .prepare(`UPDATE directivas SET "${nuevo}" = "${viejo}", "${viejo}" = NULL
                WHERE "${viejo}" IS NOT NULL AND ("${nuevo}" IS NULL)`)
      .run();
    movidos += info.changes;
  }
  if (movidos) console.log(`🔁 directivas: ${movidos} cargo(s) traspasados a primer/segundo jefe.`);
}

function ejecutarMigraciones() {
  documentoIdentidadARut('miembros');
  documentoIdentidadARut('pastores');
  normalizarTipoCuerpos();
  directivaCuerpoAHistorico();
  renombrarCargosDirectiva();
}

module.exports = { ejecutarMigraciones };
