/**
 * Cuántos registros hay en cada tabla, ahora mismo.
 *
 * Sirve para lo que pide el punto 15.19 de la especificación de credenciales:
 * dejar constancia de que ningún dato se perdió al migrar. Se corre ANTES de
 * publicar una versión y otra vez DESPUÉS, y se comparan las dos salidas.
 *
 *   node pruebas/conteos.js                    → la lista, para leerla
 *   node pruebas/conteos.js > antes.txt        → para guardarla y comparar
 *   diff antes.txt despues.txt                 → qué cambió, si cambió algo
 */
const { db } = require('../server/db');

const tablas = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((t) => t.name);

let total = 0;
const filas = [];
for (const t of tablas) {
  let n = 0;
  try {
    n = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  } catch (e) {
    n = -1; // no se pudo contar: se anota igual, para que se note
  }
  if (n > 0) total += n;
  filas.push([t, n]);
}

const ancho = Math.max(...filas.map(([t]) => t.length));
for (const [t, n] of filas) {
  console.log(`${t.padEnd(ancho)}  ${n < 0 ? '(no se pudo contar)' : String(n).padStart(7)}`);
}
console.log(`${''.padEnd(ancho, '-')}  ${''.padStart(7, '-')}`);
console.log(`${'TOTAL'.padEnd(ancho)}  ${String(total).padStart(7)}`);
