/**
 * Compactar la base: que recupere espacio de verdad, y que no se pierda nada.
 *
 * LO PRIMERO ES LO SEGUNDO. Compactar reescribe el archivo entero de la base
 * de una iglesia: los miembros, la plata, las actas, las credenciales. Si
 * saliera una fila distinta de las que entraron, sería el peor error posible
 * del sistema —silencioso, en todo— y encima corriendo de madrugada sin que
 * nadie mire. Por eso la mitad de estas pruebas no miran el tamaño sino el
 * contenido.
 *
 * Lo otro que se cuida son las dos guardas. Compactar bloquea la base mientras
 * dura y necesita en disco tanto como pesa: hacerlo cuando no hay nada que
 * recuperar es puro gasto, y empezarlo sin espacio deja el volumen lleno y la
 * faena a medias.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { compactar, espacioDesperdiciado, tamanoDeLaBase } = require('../../server/compactar');

/** Una base con datos de verdad y con huecos, como la de una iglesia con años. */
function unaBaseConHuecos({ filas = 20000, borrarUnaDeCada = 10 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactar-'));
  const db = new Database(path.join(dir, 'iglesias.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE miembros (id INTEGER PRIMARY KEY, rut TEXT, nombres TEXT, notas TEXT)');
  const ins = db.prepare('INSERT INTO miembros (id, rut, nombres, notas) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (let i = 1; i <= filas; i++) ins.run(i, `${10000000 + i}-0`, `Hermano ${i}`, 'x'.repeat(300));
  })();
  // Se borran casi todas, como pasa con los avisos leídos y los respaldos viejos
  db.exec(`DELETE FROM miembros WHERE id % ${borrarUnaDeCada} != 0`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  return { db, dir };
}

const cerrar = ({ db, dir }) => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); };

// ------------------------------------------------- que no se pierda nada

test('salen exactamente las mismas filas que entraron', () => {
  const b = unaBaseConHuecos();
  const antes = b.db.prepare('SELECT id, rut, nombres, notas FROM miembros ORDER BY id').all();
  assert.ok(antes.length > 100, 'la prueba necesita datos para probar algo');

  const r = compactar(b.db, { desdeMB: 0 });
  assert.equal(r.hecho, true);

  const despues = b.db.prepare('SELECT id, rut, nombres, notas FROM miembros ORDER BY id').all();
  assert.deepEqual(despues, antes, 'compactar cambió los datos: es el peor error posible');
  cerrar(b);
});

test('la base queda sana después de compactar', () => {
  const b = unaBaseConHuecos();
  compactar(b.db, { desdeMB: 0 });
  assert.equal(b.db.pragma('integrity_check', { simple: true }), 'ok');
  cerrar(b);
});

test('se puede seguir escribiendo y leyendo como si nada', () => {
  const b = unaBaseConHuecos();
  compactar(b.db, { desdeMB: 0 });
  b.db.prepare('INSERT INTO miembros (rut, nombres, notas) VALUES (?, ?, ?)').run('9999999-9', 'Nueva', 'x');
  const n = b.db.prepare("SELECT nombres FROM miembros WHERE rut = '9999999-9'").get();
  assert.equal(n.nombres, 'Nueva');
  cerrar(b);
});

// ------------------------------------------------------ que sirva de algo

test('el archivo pesa bastante menos', () => {
  const b = unaBaseConHuecos();
  const antes = tamanoDeLaBase(b.db);
  const r = compactar(b.db, { desdeMB: 0 });
  assert.ok(r.despues < antes * 0.5,
    `esperaba menos de la mitad: pasó de ${(antes / 1048576).toFixed(1)} a ${(r.despues / 1048576).toFixed(1)} MB`);
  assert.ok(r.recuperado > 0);
  cerrar(b);
});

test('y el espacio desperdiciado queda en cero', () => {
  const b = unaBaseConHuecos();
  assert.ok(espacioDesperdiciado(b.db) > 0, 'antes tenía huecos');
  compactar(b.db, { desdeMB: 0 });
  assert.equal(espacioDesperdiciado(b.db), 0, 'después no debería quedar ninguno');
  cerrar(b);
});

// ------------------------------------------------------------- las guardas

test('no se molesta cuando no hay bastante que recuperar', () => {
  // Compactar bloquea la base: hacerlo cada noche por unos kilobytes es gasto
  // sin ganancia.
  const b = unaBaseConHuecos({ filas: 200, borrarUnaDeCada: 2 });
  const sobraMB = espacioDesperdiciado(b.db) / 1048576;
  assert.ok(sobraMB < 5, `una base chica no debería tener ${sobraMB.toFixed(1)} MB de huecos`);
  const r = compactar(b.db); // con el umbral de siempre, 5 MB
  assert.equal(r.hecho, false);
  assert.match(r.porque, /no hay bastante/i);
  cerrar(b);
});

test('una base recién hecha tampoco se toca', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactar-'));
  const db = new Database(path.join(dir, 'iglesias.db'));
  db.exec('CREATE TABLE cosas (id INTEGER PRIMARY KEY)');
  const r = compactar(db);
  assert.equal(r.hecho, false);
  assert.equal(espacioDesperdiciado(db), 0);
  cerrar({ db, dir });
});

test('el umbral se respeta: justo por debajo no, justo por encima sí', () => {
  const b = unaBaseConHuecos();
  const sobraMB = espacioDesperdiciado(b.db) / 1048576;
  assert.ok(sobraMB > 1, `la prueba necesita al menos 1 MB de huecos, hay ${sobraMB.toFixed(1)}`);

  assert.equal(compactar(b.db, { desdeMB: sobraMB + 10 }).hecho, false, 'por debajo del umbral no debería');
  assert.equal(compactar(b.db, { desdeMB: sobraMB / 2 }).hecho, true, 'por encima sí');
  cerrar(b);
});

test('siempre dice qué pasó, se haya hecho o no', () => {
  // El resultado se anota en el registro del servidor: si a veces viniera
  // vacío, no habría manera de saber si corrió.
  const b = unaBaseConHuecos();
  // Un umbral imposible, para forzar el caso «no se hizo» sin depender de
  // cuántos huecos le tocaron a la base de ejemplo.
  const noSeHizo = compactar(b.db, { desdeMB: 10000 });
  assert.equal(noSeHizo.hecho, false);
  assert.ok(noSeHizo.porque, 'cuando no se hace, tiene que decir por qué');
  assert.ok(Number.isFinite(noSeHizo.antes));

  const seHizo = compactar(b.db, { desdeMB: 0 });
  assert.equal(seHizo.hecho, true);
  assert.ok(Number.isFinite(seHizo.despues) && Number.isFinite(seHizo.recuperado));
  cerrar(b);
});

test('el tamaño que informa incluye el diario, no solo el archivo', () => {
  // Lo que ocupa en el volumen son los tres archivos. Mirar solo el principal
  // diría que hay menos usado del que hay.
  const b = unaBaseConHuecos({ filas: 3000, borrarUnaDeCada: 2 });
  b.db.prepare('INSERT INTO miembros (rut, nombres, notas) VALUES (?, ?, ?)').run('1-9', 'Con diario', 'y'.repeat(5000));
  const conDiario = tamanoDeLaBase(b.db);
  const soloElArchivo = fs.statSync(b.db.name).size;
  assert.ok(conDiario >= soloElArchivo, 'el total no puede ser menor que el archivo principal');
  cerrar(b);
});
