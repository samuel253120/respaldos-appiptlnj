/**
 * «Cerrada» congela también el punto de partida, que es el único número que no
 * es un movimiento.
 *
 * El estado congelaba los movimientos y dejaba suelto el saldo inicial. Medido:
 * una cuenta cerrada con $ 100.000 rechazaba un ingreso de $ 1 —«está cerrada:
 * no admite nuevos movimientos»— y aceptaba subirle el saldo inicial a
 * $ 9.000.000, dejándola en $ 9.100.000. La pregunta de siempre salía y hacía
 * bien su trabajo —«su saldo pasaría de $ 100.000 a $ 9.100.000»—, pero no
 * decía la única palabra que cambiaba la respuesta: que la cuenta está cerrada.
 * Un estado que rechaza un peso y acepta nueve millones no está rechazando
 * nada.
 *
 * Acá se frena y no se pregunta, a propósito: es la misma regla que rechaza el
 * movimiento de $ 1, dicha del mismo modo. Y la salida está escrita —volver a
 * abrirla, corregirlo y cerrarla de nuevo—, que es justo lo que faltaba en el
 * otro lado de este mismo estado (ver CT-04, v1.215.0).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Congelado','IG-CONG','Activa')").run().lastInsertRowid;
const abrir = (nombre, saldoInicial = 0, estado = 'Activa') => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, ?, ?, '2020-01-01')`)
  .run(nombre, iglesia, estado, saldoInicial).lastInsertRowid;
const anotar = (cuentaId, monto) => db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
            VALUES ('2026-02-10', 'Ingreso', 'Otros', 'Lo del congelado', ?, ?, ?)`)
  .run(monto, cuentaId, iglesia);

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);
const guardar = (id, data, confirmado = true) =>
  cuentasMod.hooks.beforeSave(data, { isNew: false, existing: fila(id), id, db, confirmado });

// ---------------------------------------------------------------- congelado ----

test('el saldo inicial de una cuenta cerrada no se mueve, ni confirmando', () => {
  const cual = abrir('Proyecto cerrado del Congelado', 0, 'Cerrada');
  anotar(cual, 100000);
  const r = guardar(cual, { estado: 'Cerrada', saldo_inicial: 9000000 });
  assert.equal(typeof r, 'string', 'esto se frena, no se pregunta: es la regla del movimiento de $ 1');
  assert.match(r, /está cerrada: su saldo inicial no se puede mover/);
});

test('y el aviso dice por qué y cuál es la salida', () => {
  const cual = abrir('Proyecto con salida del Congelado', 0, 'Cerrada');
  const r = guardar(cual, { estado: 'Cerrada', saldo_inicial: 5000 });
  assert.match(r, /tampoco admite movimientos nuevos/, 'la razón: el saldo inicial es plata igual que ellos');
  assert.match(r, /Vuelva a abrirla, corrija el punto de partida y ciérrela de nuevo/);
});

test('vale aunque la cuenta esté vacía: no es por cuánto, es por el estado', () => {
  const vacia = abrir('Proyecto vacío del Congelado', 0, 'Cerrada');
  assert.match(String(guardar(vacia, { estado: 'Cerrada', saldo_inicial: 300 })), /no se puede mover/);
});

// ------------------------------------------------- lo que sí se sigue tocando ----

test('los demás datos de una cuenta cerrada se siguen corrigiendo', () => {
  const cual = abrir('Proyecto corregible del Congelado', 40000, 'Cerrada');
  anotar(cual, 10000);
  assert.equal(
    guardar(cual, { estado: 'Cerrada', descripcion: 'Terminado en agosto', fecha_cierre: '2026-08-15' }),
    null,
    'ninguno de esos mueve plata'
  );
});

test('mandar el mismo saldo inicial no es moverlo', () => {
  const cual = abrir('Proyecto que no cambia del Congelado', 40000, 'Cerrada');
  assert.equal(guardar(cual, { estado: 'Cerrada', saldo_inicial: 40000, descripcion: 'otra cosa' }), null,
    'la ficha manda el formulario entero: repetir el valor de siempre no es una corrección');
});

test('un guardado que ni menciona el saldo inicial tampoco', () => {
  const cual = abrir('Proyecto sin mencionarlo del Congelado', 40000, 'Cerrada');
  assert.equal(guardar(cual, { estado: 'Cerrada', responsable: null }), null);
});

// -------------------------------------------------------------- la salida ----

test('reabrirla y corregir el punto de partida en el mismo guardado sí se puede', () => {
  const cual = abrir('Proyecto que vuelve del Congelado', 0, 'Cerrada');
  anotar(cual, 100000);
  assert.equal(guardar(cual, { estado: 'Activa', saldo_inicial: 50000 }), null,
    'al terminar ese guardado la cuenta está activa, que es el estado donde el saldo inicial se mueve');
});

test('y cerrarla mientras se le corrige el punto de partida, también', () => {
  const cual = abrir('Proyecto que se cierra del Congelado', 0, 'Activa');
  assert.equal(guardar(cual, { estado: 'Cerrada', saldo_inicial: 7000 }), null,
    'estaba abierta cuando se guardó: el freno es sobre las que YA estaban cerradas');
});

// ----------------------------------------------- y en una activa, todo igual ----

test('en una cuenta activa sigue preguntando, como siempre', () => {
  const cual = abrir('Proyecto activo del Congelado', 0, 'Activa');
  anotar(cual, 100000);
  const r = cuentasMod.hooks.beforeSave(
    { saldo_inicial: 9000000 },
    { isNew: false, existing: fila(cual), id: cual, db, confirmado: false }
  );
  assert.equal(r && r.confirmar, 'saldo_inicial_cambiado');
  assert.match(r.error, /su saldo pasaría de/);
});

test('el freno va antes que la pregunta: no se pregunta por lo que se va a negar', () => {
  const cual = abrir('Proyecto de las dos reglas del Congelado', 0, 'Cerrada');
  anotar(cual, 100000);
  const r = cuentasMod.hooks.beforeSave(
    { estado: 'Cerrada', saldo_inicial: 9000000 },
    { isNew: false, existing: fila(cual), id: cual, db, confirmado: false }
  );
  assert.equal(typeof r, 'string', 'no una pregunta que después no se va a poder cumplir');
  assert.match(r, /no se puede mover/);
});
