/**
 * Un traspaso fechado antes de que la cuenta existiera.
 *
 * Hacia adelante el sistema pone tope y lo dice bien —«dice 15-01-2030, que
 * todavía no llega»—. Hacia atrás no había ninguno. Medido: un traspaso
 * fechado el 03-03-1998 entre dos cuentas abiertas el 01-01-2020 entró con un
 * 201, el saldo lo contó, y la cartola de la cuenta lo dejó ANTES de la línea
 * de apertura de la propia cuenta.
 *
 * Cada cuenta tiene su fecha de apertura y nadie la miraba al anotar. Un dígito
 * de más en el año manda el movimiento a un período ya cerrado y cuadrado,
 * donde nadie lo va a volver a buscar: es de los errores que no se descubren
 * porque no se ven.
 *
 * Se pregunta y no se bloquea —cargar historia vieja al empezar es legítimo, y
 * la fecha de apertura puede estar puesta a ojo—, y se pregunta una sola vez:
 * cuando la fecha se escribe o se cambia, no cada vez que se corrige el
 * concepto de un traspaso viejo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const traspasosMod = require('../../server/modules/traspasos');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Apertura','IG-APE','Activa')")
  .run().lastInsertRowid;

let n = 0;
/** Una cuenta de la iglesia, abierta el día que se le diga (o sin fecha). */
const cuenta = (apertura = '2020-01-01', saldo = 5000000) => {
  const nombre = `Caja ${++n} de la Apertura`;
  const id = db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
              VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', ?, ?)`)
    .run(nombre, iglesia, saldo, apertura).lastInsertRowid;
  return { id, nombre };
};

const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };
/** Corre el gancho como lo corre el motor. */
const guardar = (data, { existing = null, confirmado = false } = {}) =>
  traspasosMod.hooks.beforeSave({ ...data }, { user: admin, existing, db, confirmado });

/** Lo que se anota siempre igual, salvo lo que la prueba cambie. */
const traspaso = (origen, destino, cambios = {}) => ({
  fecha: '2026-05-05', cuenta_origen_id: origen.id, cuenta_destino_id: destino.id,
  monto: 100000, forma: 'Transferencia', concepto: `Aporte ${++n}`, ...cambios,
});

// ----------------------------------------------------- cuándo sí pregunta ----

test('un traspaso fechado antes de que se abriera la cuenta de origen pregunta', () => {
  const origen = cuenta('2020-01-01');
  const r = guardar(traspaso(origen, cuenta('2019-01-01'), { fecha: '1998-03-03' }));

  assert.equal(r && r.confirmar, 'traspaso_antes_de_la_apertura');
  assert.match(r.error, /03-03-1998/, 'dice la fecha del traspaso como se lee acá');
  assert.match(r.error, new RegExp(origen.nombre), 'y nombra la cuenta que no existía');
  assert.match(r.error, /01-01-2020/, 'con el día en que se abrió');
});

test('también si la que todavía no existía es la de destino', () => {
  const destino = cuenta('2024-06-30');
  const r = guardar(traspaso(cuenta('2019-01-01'), destino, { fecha: '2024-06-29' }));

  assert.equal(r && r.confirmar, 'traspaso_antes_de_la_apertura');
  assert.match(r.error, new RegExp(destino.nombre));
  assert.match(r.error, /30-06-2024/);
});

test('y si ninguna de las dos existía, las nombra a las dos', () => {
  const origen = cuenta('2021-02-02');
  const destino = cuenta('2022-03-03');
  const r = guardar(traspaso(origen, destino, { fecha: '2015-01-01' }));

  assert.equal(r && r.confirmar, 'traspaso_antes_de_la_apertura');
  assert.match(r.error, new RegExp(origen.nombre));
  assert.match(r.error, new RegExp(destino.nombre));
  assert.match(r.error, /02-02-2021/);
  assert.match(r.error, /03-03-2022/);
});

// ---------------------------------------------------- cuándo no pregunta ----

test('el mismo día en que se abrió la cuenta es un día bueno', () => {
  /*
   * Es el caso corriente de la puesta en marcha: se crea la cuenta con la
   * fecha de hoy y se anota de inmediato el primer traspaso. Preguntar ahí
   * sería preguntar por todo.
   */
  const origen = cuenta('2026-04-10');
  assert.equal(guardar(traspaso(origen, cuenta('2020-01-01'), { fecha: '2026-04-10' })), null);
});

test('y un día después, tampoco pregunta', () => {
  const origen = cuenta('2026-04-10');
  assert.equal(guardar(traspaso(origen, cuenta('2020-01-01'), { fecha: '2026-04-11' })), null);
});

test('una cuenta sin fecha de apertura no tiene nada que decir', () => {
  const origen = cuenta(null);
  assert.equal(guardar(traspaso(origen, cuenta(null), { fecha: '1998-03-03' })), null);
});

test('y una fecha que no es una fecha se la deja al motor, que ya la revisa', () => {
  const origen = cuenta('2020-01-01');
  assert.equal(guardar(traspaso(origen, cuenta('2020-01-01'), { fecha: '' })), null);
  assert.equal(guardar(traspaso(origen, cuenta('2020-01-01'), { fecha: 'ayer' })), null);
});

// ----------------------------------------------------- se pregunta una vez ----

test('contestada la pregunta, el traspaso se guarda', () => {
  const origen = cuenta('2020-01-01');
  const data = traspaso(origen, cuenta('2020-01-01'), { fecha: '1998-03-03' });
  assert.equal(guardar(data, { confirmado: true }), null);
});

test('corregirle el concepto a un traspaso viejo NO vuelve a preguntar por su fecha', () => {
  /*
   * La fecha ya se contestó el día que se cargó la historia. Volver a
   * preguntarla cada vez que se le adjunta un comprobante o se le arregla una
   * falta de ortografía enseña a apretar «Está bien» sin leer.
   */
  const origen = cuenta('2020-01-01');
  const destino = cuenta('2020-01-01');
  const id = db
    .prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
              VALUES ('1998-03-03', ?, ?, 100000, 'Transferencia', 'Aporte viejo', ?)`)
    .run(origen.id, destino.id, iglesia).lastInsertRowid;
  const existing = db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id);

  assert.equal(guardar({ concepto: 'Aporte antiguo' }, { existing }), null);
});

test('pero cambiarle la fecha a otra igual de imposible sí pregunta de nuevo', () => {
  const origen = cuenta('2020-01-01');
  const destino = cuenta('2020-01-01');
  const id = db
    .prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
              VALUES ('1998-03-03', ?, ?, 100000, 'Transferencia', 'Aporte viejo 2', ?)`)
    .run(origen.id, destino.id, iglesia).lastInsertRowid;
  const existing = db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id);

  const r = guardar({ fecha: '1997-01-01' }, { existing });
  assert.equal(r && r.confirmar, 'traspaso_antes_de_la_apertura');
});

// --------------------------------------- de qué se pregunta primero ----

test('entre la fecha imposible y el saldo en rojo, se pregunta por la fecha', () => {
  /*
   * Un año mal tecleado dispara las dos: en 1998 la cuenta no tenía nada, así
   * que el traspaso la deja en rojo. Se hace UNA pregunta por guardado, y de
   * las dos, ésta es la que nombra el problema —«la cuenta se abrió el
   * 01-01-2020»— mientras que la otra describe el síntoma.
   */
  const origen = cuenta('2020-01-01', 0);
  const r = guardar(traspaso(origen, cuenta('2020-01-01'), { fecha: '1998-03-03', monto: 900000 }));

  assert.equal(r && r.confirmar, 'traspaso_antes_de_la_apertura',
    'y no la del saldo en rojo, que acá es la consecuencia y no la causa');
});

test('y el traspaso repetido se pregunta antes que la fecha, porque cuesta plata', () => {
  /*
   * El orden entero: repetido → fecha imposible → saldo en rojo. Anotar dos
   * veces el mismo traspaso mueve dos veces la plata; una fecha rara la deja
   * donde no corresponde pero no la duplica.
   */
  const origen = cuenta('2020-01-01');
  const destino = cuenta('2020-01-01');
  db.prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
              VALUES ('1998-03-03', ?, ?, 100000, 'Transferencia', 'El mismo de siempre', ?)`)
    .run(origen.id, destino.id, iglesia);

  const r = guardar(traspaso(origen, destino, { fecha: '1998-03-03', concepto: 'El mismo de siempre' }));
  assert.equal(r && r.confirmar, 'traspaso_ya_anotado');
});
