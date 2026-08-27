/**
 * Las dos migraciones que hacen que el número diga de qué iglesia es.
 *
 * Corren UNA vez sobre datos reales y no se pueden repetir para arreglarlas.
 * Lo que tienen que cumplir:
 *
 *   · CADA IGLESIA CON SU CÓDIGO, y sin repetirse. El código era opcional y
 *     libre; ahora va dentro de cada número y ahí tiene que estar, no
 *     repetirse y poder escribirse en un acta.
 *   · LO YA EMITIDO NO SE TOCA. Una solicitud está nombrada por su número en
 *     actas y correos: renumerarlas dejaría esas referencias apuntando a nada.
 *   · Y LA SIGUIENTE NO REPITE NINGUNO. Es lo único que de verdad importa del
 *     contador: que después de la migración nadie reciba un número que ya
 *     circula.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const migraciones = require('../../server/migraciones');
const numero = require('../../server/solicitudes/numero');

/*
 * Las dos ya quedaron marcadas al preparar esta base, sobre cero iglesias y
 * cero solicitudes. Para probarlas como se van a encontrar en la realidad hay
 * que sembrar primero y volver a correrlas, así que se les quita la marca.
 */
const olvidar = (nombre) => db.prepare('DELETE FROM migraciones WHERE nombre = ?').run(nombre);

// --- Una iglesia como venían: sin código, con uno sucio, y dos que chocan ---
const meter = db.prepare('INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, \'Activa\')');
const sinCodigo = meter.run('Iglesia Los Aromos', null).lastInsertRowid;
const sucio = meter.run('Iglesia Ñuñoa', '  ñuñoa central  ').lastInsertRowid;
const choca1 = meter.run('Primera que choca', 'MI-SEDE').lastInsertRowid;
const choca2 = meter.run('Segunda que choca', 'mi sede').lastInsertRowid;
const generica = meter.run('Iglesia', '').lastInsertRowid;

// --- Y solicitudes numeradas al estilo viejo: correlativo de TODO el sistema ---
const laVieja = db.prepare(
  `INSERT INTO solicitudes (numero, fecha, iglesia_id, solicitante, tipo, asunto, estado)
   VALUES (?, ?, ?, 'Quien pidió', 'Otro', 'De antes', 'Pendiente')`
);
laVieja.run('0001-2026', '2026-01-10', sinCodigo);
laVieja.run('0002-2026', '2026-01-20', choca1);
laVieja.run('0003-2026', '2026-02-01', sinCodigo);
laVieja.run('0004-2026', '2026-02-15', sinCodigo);
laVieja.run('0001-2025', '2025-05-05', choca1);

olvidar('cada_iglesia_con_su_codigo');
olvidar('solicitudes_numeradas_por_iglesia');
migraciones.cadaIglesiaConSuCodigo();
migraciones.solicitudesNumeradasPorIglesia();

const codigoDe = (id) => db.prepare('SELECT codigo FROM iglesias WHERE id = ?').get(id).codigo;

// ------------------------------------------- cada iglesia con su código ----

test('a la que no tenía se le pone uno sacado de su nombre', () => {
  assert.equal(codigoDe(sinCodigo), 'AROMOS', 'la palabra que de verdad la distingue');
});

test('el que tenía se conserva, limpio de tildes y espacios', () => {
  assert.equal(codigoDe(sucio), 'NUNOA-CENTRAL', 'el mismo código, como se puede escribir en cualquier parte');
});

test('si dos quedaban iguales, la segunda lleva un número', () => {
  assert.equal(codigoDe(choca1), 'MI-SEDE');
  assert.notEqual(codigoDe(choca2), 'MI-SEDE');
  assert.match(codigoDe(choca2), /^MI-SEDE\d+$/);
});

test('una cuyo nombre no distingue nada igual queda identificada', () => {
  assert.equal(codigoDe(generica), `IG${generica}`);
});

test('ninguna iglesia queda sin código, y no hay dos iguales', () => {
  const todas = db.prepare('SELECT id, codigo FROM iglesias').all();
  assert.ok(todas.every((i) => String(i.codigo || '').trim()), 'alguna quedó sin código');
  const vistos = new Set(todas.map((i) => String(i.codigo).toUpperCase()));
  assert.equal(vistos.size, todas.length, 'dos iglesias con el mismo código darían dos series idénticas');
});

test('correrla de nuevo no cambia nada', () => {
  const antes = db.prepare('SELECT id, codigo FROM iglesias ORDER BY id').all();
  olvidar('cada_iglesia_con_su_codigo');
  migraciones.cadaIglesiaConSuCodigo();
  assert.deepEqual(db.prepare('SELECT id, codigo FROM iglesias ORDER BY id').all(), antes);
});

// ------------------------------------------------ lo ya emitido no se toca --

test('las solicitudes que ya tenían número lo conservan', () => {
  const numeros = db.prepare("SELECT numero FROM solicitudes WHERE asunto = 'De antes' ORDER BY numero")
    .all().map((s) => s.numero);
  assert.deepEqual(numeros, ['0001-2025', '0001-2026', '0002-2026', '0003-2026', '0004-2026'],
    'renumerarlas dejaría sin sentido cada acta y cada correo que las nombra');
});

// ------------------------------- y la siguiente no repite ninguno ----------

test('cada iglesia sigue donde llegó SU numeración, no la del sistema', () => {
  assert.equal(numero.siguiente(sinCodigo, 2026), 'SOL-AROMOS-0005-2026',
    'esta iglesia llegó hasta la 0004: la siguiente es la 0005');
  assert.equal(numero.siguiente(choca1, 2026), 'SOL-MI-SEDE-0003-2026',
    'esta llegó hasta la 0002, aunque el sistema fuera en la 0004');
});

test('una iglesia que no tenía ninguna empieza en el 0001', () => {
  assert.equal(numero.siguiente(sucio, 2026), 'SOL-NUNOA-CENTRAL-0001-2026',
    'la primera de una iglesia es la primera, no la que siga en el sistema');
});

test('cada año sigue llevando su propia cuenta', () => {
  assert.equal(numero.siguiente(choca1, 2025), 'SOL-MI-SEDE-0002-2025');
});

test('NINGUNO DE LOS NUEVOS CHOCA CON LOS QUE YA CIRCULAN', () => {
  const todos = db.prepare('SELECT numero FROM solicitudes').all().map((s) => s.numero);
  assert.equal(new Set(todos).size, todos.length);
  for (let i = 0; i < 20; i++) {
    const suyo = numero.siguiente(sinCodigo, 2026);
    assert.ok(!todos.includes(suyo), `${suyo} ya estaba en circulación`);
  }
});

test('correr la migración del contador de nuevo no lo hace retroceder', () => {
  const antes = numero.siguiente(choca1, 2026);
  olvidar('solicitudes_numeradas_por_iglesia');
  migraciones.solicitudesNumeradasPorIglesia();
  const despues = numero.siguiente(choca1, 2026);
  assert.notEqual(despues, antes, 'volver atrás repetiría un número ya entregado');
});
