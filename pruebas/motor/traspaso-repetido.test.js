/**
 * El mismo traspaso anotado dos veces.
 *
 * Es el agujero que quedaba después de cerrar el del libro en la 1.163.0: un
 * módulo más allá, la misma plata. Medido antes de esto: un traspaso de $400.000
 * anotado tres veces guardó los tres y dejó seis movimientos en el libro —movió
 * $1.200.000 entre dos cuentas que nunca los movieron—.
 *
 * Se pregunta, no se bloquea, con la misma regla que Tesorería: dos traspasos
 * iguales el mismo día existen —una cuota que se paga en dos partes—. Lo que
 * comparten las dos preguntas vive en server/repetido.js, para que no puedan
 * discrepar; lo que hace que dos registros sean «el mismo» lo decide cada
 * módulo, porque no es lo mismo en una tabla que en otra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const traspasos = require('../../server/modules/traspasos');
const tesoreria = require('../../server/modules/tesoreria');
const repetido = require('../../server/repetido');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Traspaso PP','TES-TRA','Activa')")
  .run().lastInsertRowid;
const cuenta = (nombre, tipo, iglesiaId) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES (?,?,?,?,'Activa',9000000)`)
  .run(nombre, iglesiaId ? 'Iglesia local' : 'Corporación', tipo, iglesiaId || null).lastInsertRowid;

const fondo = cuenta('Fondo del Traspaso PP', 'Fondo para la corporación', iglesia);
const corp = cuenta('Corporación del Traspaso PP', 'General', null);
const otra = cuenta('General del Traspaso PP', 'General', iglesia);

const DIA = '2026-04-12';
const CONCEPTO = 'Aporte del mes';

const yaAnotado = db
  .prepare(
    `INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
     VALUES (?, ?, ?, 400000, 'Transferencia', ?, ?)`
  ).run(DIA, fondo, corp, CONCEPTO, iglesia).lastInsertRowid;

const usuario = { id: 1, rol: 'admin' };
const guardar = (datos, { existing = null, confirmado = false } = {}) =>
  traspasos.hooks.beforeSave({ ...datos }, { user: usuario, db, existing, confirmado, isNew: !existing });

const nuevo = (extra = {}) => ({
  fecha: DIA, cuenta_origen_id: fondo, cuenta_destino_id: corp,
  monto: 400000, forma: 'Transferencia', concepto: CONCEPTO, ...extra,
});

/* ------------------------------------------------------ lo que sí es el mismo */

test('el mismo traspaso, otra vez, se pregunta antes de guardarse', () => {
  const r = guardar(nuevo());
  assert.equal(typeof r, 'object', 'se pregunta, no se rechaza a secas');
  assert.equal(r.confirmar, 'traspaso_ya_anotado');
  assert.match(r.error, /400\.000/);
  assert.match(r.error, /las dos cuentas quedan descuadradas/);
  assert.match(r.error, /Fondo del Traspaso PP.*Corporación del Traspaso PP/,
    'y dice de qué cuenta a qué cuenta, que es lo que distingue un traspaso de otro');
});

test('escrito de otra manera es el mismo traspaso igual', () => {
  const r = guardar(nuevo({ concepto: '  APORTE  del MES  ' }));
  assert.ok(r && r.confirmar === 'traspaso_ya_anotado');
});

test('quien confirma manda: se guarda igual', () => {
  assert.equal(guardar(nuevo(), { confirmado: true }), null);
});

/* -------------------------------------------------- lo que NO es el mismo */

test('otro monto es otro traspaso', () => {
  assert.equal(guardar(nuevo({ monto: 400001 })), null);
});

test('otro día es otro traspaso', () => {
  assert.equal(guardar(nuevo({ fecha: '2026-04-13' })), null);
});

test('al revés —de destino a origen— es otro traspaso, y de los importantes', () => {
  assert.equal(guardar(nuevo({ cuenta_origen_id: corp, cuenta_destino_id: fondo })), null,
    'devolver lo que se traspasó no es repetir el traspaso');
});

test('a otra cuenta es otro traspaso', () => {
  assert.equal(guardar(nuevo({ cuenta_destino_id: otra })), null);
});

test('desde otra cuenta también, aunque calce todo lo demás', () => {
  /*
   * No es rebuscado: dos iglesias que le aportan a la corporación el mismo
   * domingo, por el mismo monto y con el mismo concepto —«Aporte del mes»— son
   * dos aportes distintos. Confundirlos haría que la segunda tesorera tuviera
   * que confirmar una pregunta que no le corresponde, y confirmar sin leer es
   * lo que esta pregunta viene a evitar.
   */
  assert.equal(guardar(nuevo({ cuenta_origen_id: otra })), null);
});

test('otro concepto, aunque calce todo lo demás', () => {
  assert.equal(guardar(nuevo({ concepto: 'Devolución de saldo' })), null);
});

test('la forma no hace a dos traspasos distintos', () => {
  const r = guardar(nuevo({ forma: 'Cheque' }));
  assert.ok(r && r.confirmar === 'traspaso_ya_anotado',
    'el mismo aporte anotado como cheque en vez de transferencia sigue siendo uno solo');
});

/* ------------------------------------------------ corregir lo que ya está */

test('corregirlo sin cambiarle nada no se pregunta a sí mismo', () => {
  const suyo = db.prepare('SELECT * FROM traspasos WHERE id = ?').get(yaAnotado);
  assert.equal(guardar(nuevo(), { existing: suyo }), null);
});

test('cambiarle solo la forma tampoco vuelve a preguntar', () => {
  const suyo = db.prepare('SELECT * FROM traspasos WHERE id = ?').get(yaAnotado);
  assert.equal(guardar(nuevo({ forma: 'Efectivo' }), { existing: suyo }), null,
    'la forma no es de los cinco datos que lo hacen «el mismo»');
});

/* ------------------------------------------- la regla, en un solo lugar */

test('las dos preguntas comparan el texto de la misma manera', () => {
  assert.equal(repetido.comoSeCompara('  Sillas PARA el SALÓN '), 'sillas para el salon');
  const tes = fs.readFileSync(path.join(__dirname, '../../server/modules/tesoreria.js'), 'utf8');
  const tra = fs.readFileSync(path.join(__dirname, '../../server/modules/traspasos.js'), 'utf8');
  for (const [cual, texto] of [['tesoreria', tes], ['traspasos', tra]]) {
    assert.match(texto, /require\('\.\.\/repetido'\)/, `${cual} tiene que usar la regla compartida`);
    assert.doesNotMatch(texto, /normalize\('NFD'\)/,
      `${cual} no puede llevar su propia copia: escritas dos veces, un día dicen dos cosas`);
  }
});

test('«seguiIgual» mira cada dato como corresponde', () => {
  const campos = [['fecha', 'fecha'], ['monto', 'numero'], ['concepto', 'texto'], ['forma', 'igual']];
  const guardado = { fecha: '2026-04-12', monto: 400000, concepto: 'Aporte del mes', forma: 'Cheque' };

  assert.equal(repetido.seguiIgual(guardado, { ...guardado }, campos), true);
  assert.equal(repetido.seguiIgual(guardado, { ...guardado, monto: '400000' }, campos), true,
    'el formulario manda texto: «400000» y 400000 son el mismo monto');
  assert.equal(repetido.seguiIgual(guardado, { ...guardado, fecha: '2026-04-12T00:00:00' }, campos), true,
    'una fecha con hora es el mismo día');
  assert.equal(repetido.seguiIgual(guardado, { ...guardado, concepto: 'APORTE DEL MES' }, campos), true);
  assert.equal(repetido.seguiIgual(guardado, { ...guardado, monto: 1 }, campos), false);
  assert.equal(repetido.seguiIgual(null, guardado, campos), false, 'lo que todavía no existe nunca «siguió igual»');
});

/* ------------------------------------------------------------- la pantalla */

test('la pantalla sabe cómo preguntarlo', () => {
  assert.match(app, /traspaso_ya_anotado:\s*\{/);
  assert.match(app, /Puede que este traspaso ya esté anotado/);
});

test('y la de Tesorería sigue estando, que son dos preguntas distintas', () => {
  assert.match(app, /movimiento_ya_anotado:\s*\{/);
  assert.equal(tesoreria.name, 'tesoreria');
});
