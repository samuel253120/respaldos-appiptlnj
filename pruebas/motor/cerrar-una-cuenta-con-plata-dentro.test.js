/**
 * Cerrar una cuenta no es un rótulo: decide si esa plata se vuelve a mover.
 *
 * Medido sobre una cuenta de proyecto con $ 250.000 anotados: se cerraba con un
 * 200 y sin preguntar nada, y la fecha de cierre quedaba VACÍA. De ahí en
 * adelante la plata no salía por ninguna de las tres puertas que existen:
 *
 *   traspasarla ....... «está cerrada: no puede salir dinero de ella»
 *   un egreso a mano .. «no admite nuevos movimientos»
 *   borrar la cuenta .. «tiene 1 movimiento(s) registrado(s)»
 *
 * Las tres negativas son correctas cada una por su lado; juntas dejan la plata
 * sin salida, y el saldo sigue sumando en todos los totales de una cuenta que la
 * organización dio por terminada. La salida existe —reabrirla, traspasar el
 * saldo y volver a cerrarla— y no estaba escrita en ninguna parte, así que quien
 * se topara con esto iba a pensar que el sistema le perdió la plata.
 *
 * Se pregunta y no se bloquea, como con el saldo inicial: hay cierres que se
 * hacen así a propósito. Lo que no puede es que la decisión se tome sin saber
 * lo que cuesta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Cierre','IG-CIER','Activa')").run().lastInsertRowid;

const abrir = (nombre, saldoInicial = 0) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', ?, '2020-01-01')`)
  .run(nombre, iglesia, saldoInicial).lastInsertRowid;
const anotar = (cuentaId, tipo, monto) => db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
            VALUES ('2026-02-10', ?, 'Otros', 'Lo del cierre', ?, ?, ?)`)
  .run(tipo, monto, cuentaId, iglesia);

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);
/** Corre el hook como lo corre el motor. */
const guardar = (id, data, confirmado = false) =>
  cuentasMod.hooks.beforeSave(data, { isNew: false, existing: fila(id), id, db, confirmado });

const HOY = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------- la plata que queda ----

const conPlata = abrir('Proyecto con plata del Cierre');
anotar(conPlata, 'Ingreso', 250000);

test('cerrar una cuenta con plata adentro pregunta antes, y dice cuánta', () => {
  const r = guardar(conPlata, { estado: 'Cerrada' });
  assert.equal(r && r.confirmar, 'cuenta_cerrada_con_saldo');
  // El espacio va como \s: el módulo escribe uno normal y en otras partes del
  // sistema la plata lleva uno duro; la prueba no tiene por qué elegir
  assert.match(r.error, /\$\s?250\.000/, 'la cifra, en pesos y a la vista');
});

test('y dice las tres puertas que se cierran, y cuál es la salida', () => {
  const { error } = guardar(conPlata, { estado: 'Cerrada' });
  assert.match(error, /no admite movimientos nuevos/);
  assert.match(error, /no puede ser el origen de un traspaso/);
  assert.match(error, /tampoco se elimina/);
  assert.match(error, /traspasar el saldo a otra cuenta y después cerrarla/,
    'la salida tiene que estar escrita en el único momento en que sirve leerla');
  assert.match(error, /volver a abrirla para poder sacarlo/);
});

test('confirmando, se cierra: se pregunta, no se bloquea', () => {
  const data = { estado: 'Cerrada' };
  assert.equal(guardar(conPlata, data, true), null);
});

test('una cuenta en cero no pregunta nada', () => {
  const vacia = abrir('Proyecto vacío del Cierre');
  assert.equal(guardar(vacia, { estado: 'Cerrada' }), null);
});

test('un saldo en contra también se pregunta: cero es cero, no «poca plata»', () => {
  const enRojo = abrir('Proyecto en rojo del Cierre');
  anotar(enRojo, 'Egreso', 40000);
  const r = guardar(enRojo, { estado: 'Cerrada' });
  assert.equal(r && r.confirmar, 'cuenta_cerrada_con_saldo');
  assert.match(r.error, /-40\.000/);
});

test('el saldo inicial cuenta igual que un movimiento: es plata que está ahí', () => {
  const soloInicial = abrir('Proyecto de partida del Cierre', 90000);
  const r = guardar(soloInicial, { estado: 'Cerrada' });
  assert.equal(r && r.confirmar, 'cuenta_cerrada_con_saldo');
  assert.match(r.error, /90\.000/);
});

test('editar una cuenta que YA estaba cerrada no vuelve a preguntar', () => {
  const yaCerrada = abrir('Proyecto ya cerrado del Cierre');
  anotar(yaCerrada, 'Ingreso', 10000);
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(yaCerrada);
  assert.equal(guardar(yaCerrada, { estado: 'Cerrada', descripcion: 'otra cosa' }), null,
    'la pregunta es sobre el acto de cerrar, no sobre el estado');
});

test('y una que se está abriendo, tampoco', () => {
  const reabriendo = abrir('Proyecto que vuelve del Cierre');
  anotar(reabriendo, 'Ingreso', 10000);
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(reabriendo);
  assert.equal(guardar(reabriendo, { estado: 'Activa' }), null);
});

// ---------------------------------------------------------- la fecha de cierre ----

test('la cuenta que se cierra dice cuándo: se pone sola con el día de hoy', () => {
  const cual = abrir('Proyecto sin fecha del Cierre');
  const data = { estado: 'Cerrada' };
  assert.equal(guardar(cual, data), null);
  assert.equal(data.fecha_cierre, HOY,
    'una fecha de cierre vacía no se distingue de una cuenta que nadie ha cerrado');
});

test('pero si el guardado trae una fecha, esa manda', () => {
  const cual = abrir('Proyecto con fecha del Cierre');
  const data = { estado: 'Cerrada', fecha_cierre: '2026-06-15' };
  assert.equal(guardar(cual, data), null);
  assert.equal(data.fecha_cierre, '2026-06-15');
});

test('no se le pone fecha a lo que no se está cerrando', () => {
  const cual = abrir('Proyecto que sigue del Cierre');
  const data = { descripcion: 'sigue andando' };
  guardar(cual, data);
  assert.equal(data.fecha_cierre, undefined);
});

test('ni se le vuelve a poner a la que ya estaba cerrada', () => {
  const cual = abrir('Proyecto cerrado hace tiempo del Cierre');
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada', fecha_cierre = '2024-03-08' WHERE id = ?").run(cual);
  const data = { estado: 'Cerrada', descripcion: 'una corrección cualquiera' };
  guardar(cual, data);
  assert.equal(data.fecha_cierre, undefined, 'lo que se corrige hoy no cambia el día en que se cerró');
  assert.equal(fila(cual).fecha_cierre, '2024-03-08');
});

// --------------------------------------------------- una sola pregunta por vez ----

test('si se cierra Y se mueve el punto de partida, manda la del cierre', () => {
  /*
   * El mecanismo de confirmación muestra UNA pregunta por guardado, así que el
   * orden en que se hacen es una decisión. Cerrar con plata adentro es lo que
   * deja la plata sin salida; mover el saldo inicial se puede deshacer volviendo
   * a moverlo.
   */
  const cual = abrir('Proyecto de las dos preguntas del Cierre');
  anotar(cual, 'Ingreso', 70000);
  const r = guardar(cual, { estado: 'Cerrada', saldo_inicial: 5000000 });
  assert.equal(r && r.confirmar, 'cuenta_cerrada_con_saldo');
});

test('y si solo se mueve el punto de partida, la de siempre', () => {
  const cual = abrir('Proyecto del punto de partida del Cierre');
  anotar(cual, 'Ingreso', 70000);
  const r = guardar(cual, { saldo_inicial: 5000000 });
  assert.equal(r && r.confirmar, 'saldo_inicial_cambiado');
});
