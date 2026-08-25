/**
 * Que la base pueda buscar por fecha sin recorrerlo todo.
 *
 * POR QUÉ EXISTE ESTA SUITE. El informe de asistencia hace siete preguntas
 * sobre la tabla de marcas —la que más crece del sistema, una fila por persona
 * y por actividad—. Si esas preguntas no pueden apoyarse en un índice por
 * fecha, acotar el informe no sirve de nada: la base recorre todo igual.
 *
 * Se midió con diez años de datos (124.812 marcas): pedir SOLO el año en curso
 * costaba 59 ms, casi lo mismo que pedirlo todo, porque no había índice por
 * fecha. Con el índice puesto, el mismo informe baja a menos de un
 * milisegundo. O sea que el índice no es una mejora: es lo que hace que acotar
 * signifique algo.
 *
 * El índice lo crea sola la máquina de índices de server/db.js a partir del
 * `dateField` que declara cada módulo. Por eso lo que se vigila acá es que ese
 * `dateField` esté declarado donde importa: es un dato fácil de olvidar al
 * agregar un módulo, y olvidarlo no rompe nada —solo lo pone lento con los
 * años, que es la clase de problema que nadie relaciona con su causa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { allModules, getModule } = require('../../server/registry');

/** ¿Existe un índice sobre esta columna de esta tabla? */
function hayIndicePor(tabla, columna) {
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(tabla);
  for (const { name } of indices) {
    const cols = db.prepare(`PRAGMA index_info("${name}")`).all().map((c) => c.name);
    // Vale como primera columna: un índice (iglesia_id, fecha) no sirve para
    // buscar solo por fecha, pero uno (fecha, …) sí.
    if (cols[0] === columna) return true;
  }
  return false;
}

test('la tabla de marcas de asistencia declara su fecha', () => {
  // Es la que más crece y sobre la que se arma el informe. Sin esto no hay
  // índice por fecha, y acotar el informe deja de servir de nada.
  const def = getModule('asistencia_detalle');
  assert.equal(def.dateField, 'fecha');
});

test('y por lo tanto la base tiene su índice por fecha', () => {
  assert.ok(hayIndicePor('asistencia_detalle', 'fecha'),
    'sin este índice, el informe de asistencia recorre la tabla entera aunque se le pida un solo mes');
});

test('todo módulo que declara una fecha termina con su índice', () => {
  const sinIndice = [];
  for (const def of allModules()) {
    if (!def.dateField) continue;
    let columnas;
    try {
      columnas = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    } catch (e) {
      continue; // la tabla todavía no existe
    }
    if (!columnas.has(def.dateField)) continue;
    if (!hayIndicePor(def.name, def.dateField)) sinIndice.push(`${def.name}.${def.dateField}`);
  }
  assert.deepEqual(sinIndice, [], `quedaron sin índice: ${sinIndice.join(', ')}`);
});

test('la base elige el índice cuando se le pide un rango de fechas', () => {
  // Que el índice exista no basta: hay que ver que la base decida usarlo. Se
  // le pregunta a ella misma por el camino que tomaría.
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM asistencia_detalle WHERE fecha >= '2026-01-01'")
    .all()
    .map((p) => p.detail)
    .join(' · ');
  assert.match(plan, /USING (COVERING )?INDEX/i,
    `la base dijo que haría: ${plan}`);
});

test('las tablas que más crecen tienen índice por fecha, no solo por referencia', () => {
  // La máquina de índices cubre bien las referencias —iglesia, cuerpo,
  // miembro—, y por eso el hueco de la fecha pasó tanto tiempo sin verse: la
  // tabla tenía cuatro índices y ninguno servía para un rango de fechas.
  for (const tabla of ['asistencia_detalle', 'tesoreria', 'asistencias', 'bitacora']) {
    let columnas;
    try {
      columnas = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
    } catch (e) {
      continue;
    }
    if (!columnas.has('fecha')) continue;
    assert.ok(hayIndicePor(tabla, 'fecha'), `${tabla} no puede buscar por fecha sin recorrerlo todo`);
  }
});
