/**
 * El respaldo de un movimiento: la boleta o el comprobante de la transferencia.
 *
 * El campo estaba, funcionaba y guardaba el archivo. Pero nada lo pedía, no se
 * veía en el listado, y no había manera de preguntar «¿qué egresos de este mes
 * están sin respaldo?». Medido sobre la primera página del libro: CERO de
 * doscientos egresos lo tenían. Cuando llega una revisión, el respaldo hay que
 * buscarlo en una carpeta física, movimiento por movimiento.
 *
 * El sistema ya tenía dónde guardarlo; lo que no tenía es el hábito, y el hábito
 * lo hace la pantalla. Lo que se vigila acá son las tres cosas que lo forman: la
 * columna que se ve de un vistazo, el filtro para encontrar lo que falta, y la
 * pregunta al guardar un egreso grande sin adjunto —desde el monto que la
 * iglesia decida, y sin bloquear nunca—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const tesoreria = require('../../server/modules/tesoreria');
const ajustes = require('../../server/ajustes');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Clip TT','TES-CLI','Activa')")
  .run().lastInsertRowid;
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES ('General del Clip TT','Iglesia local','General',?,'Activa',99000000)`)
  .run(iglesia).lastInsertRowid;

// El rol como lo guarda la base ('admin'), no su etiqueta (ver ROLES en
// server/permissions.js): un rol que no existe no alcanza ninguna llave.
const usuario = { id: 1, rol: 'admin' };
const guardar = (datos, { existing = null, confirmado = false } = {}) =>
  tesoreria.hooks.beforeSave({ ...datos }, { user: usuario, db, existing, confirmado, isNew: !existing });

const egreso = (extra = {}) => ({
  fecha: '2026-05-10', tipo: 'Egreso', categoria: 'Compras',
  concepto: 'Algo TT ' + Math.random().toString(36).slice(2, 8),
  monto: 900000, cuenta_id: cuenta, metodo: 'Transferencia', ...extra,
});

/* ------------------------------------------------------------- la pregunta */

test('un egreso grande sin comprobante se pregunta antes de guardar', () => {
  const r = guardar(egreso());
  assert.equal(typeof r, 'object', 'se pregunta, no se rechaza a secas');
  assert.equal(r.confirmar, 'egreso_sin_respaldo');
  assert.match(r.error, /900\.000/);
  assert.match(r.error, /Se puede adjuntar después/, 'y se dice cómo arreglarlo');
});

test('quien confirma manda: se guarda sin respaldo', () => {
  assert.equal(guardar(egreso(), { confirmado: true }), null);
});

test('con el comprobante adjunto no se pregunta nada', () => {
  assert.equal(guardar(egreso({ comprobante: 'boleta-123.pdf' })), null);
});

test('un comprobante en blanco no cuenta como comprobante', () => {
  const r = guardar(egreso({ comprobante: '   ' }));
  assert.ok(r && r.confirmar === 'egreso_sin_respaldo', 'un espacio no es una boleta');
});

test('un egreso chico no se pregunta', () => {
  assert.equal(guardar(egreso({ monto: 5000 })), null);
});

test('un ingreso no lleva boleta', () => {
  assert.equal(guardar(egreso({ tipo: 'Ingreso', categoria: 'Ofrendas' })), null);
});

test('el monto desde el que se pregunta lo decide la iglesia', () => {
  const antes = ajustes.obtener('egreso_pide_comprobante_desde');
  try {
    ajustes.guardar('egreso_pide_comprobante_desde', '2000000', usuario.id);
    assert.equal(guardar(egreso()), null, 'con el listón en 2.000.000, uno de 900.000 no se pregunta');

    ajustes.guardar('egreso_pide_comprobante_desde', '0', usuario.id);
    assert.equal(guardar(egreso({ monto: 50000000 })), null, 'en cero, no pregunta nunca');
  } finally {
    ajustes.guardar('egreso_pide_comprobante_desde', antes, usuario.id);
  }
});

test('lo que generó otro módulo no se pregunta: nadie le adjunta una boleta a mano', () => {
  const deUnTraspaso = { id: -1, tipo: 'Egreso', monto: 900000, traspaso_id: 7, comprobante: null,
    fecha: '2026-05-10', cuenta_id: cuenta, categoria: 'Traspaso', concepto: 'x' };
  // Un movimiento de traspaso ni siquiera se puede editar, pero si llegara acá
  // la pregunta no tendría a quién dirigirse
  assert.equal(require('../../server/modules/tesoreria')
    .hooks.beforeSave({ monto: 900000 }, { user: usuario, db, existing: deUnTraspaso, confirmado: false }),
    'Este movimiento lo generó un traspaso entre cuentas: modifíquelo en «Traspasos entre Cuentas»',
    'se rechaza antes, por otro motivo');
});

/* --------------------------------------------------------------- la columna */

const columna = tesoreria.computed.find((c) => c.name === 'respaldo');

test('la columna dice de un vistazo si lo tiene', () => {
  assert.deepEqual(columna.calc({ tipo: 'Egreso', comprobante: 'b.pdf' }), { texto: '📎 Sí', nivel: 'ok' });
});

test('y dice que falta solo cuando falta de verdad', () => {
  assert.equal(columna.calc({ tipo: 'Egreso', comprobante: null }).texto, 'Falta');
  assert.equal(columna.calc({ tipo: 'Ingreso', comprobante: null }).texto, '—', 'un ingreso no necesita boleta');
  assert.equal(columna.calc({ tipo: 'Egreso', comprobante: null, traspaso_id: 4 }).texto, '—');
  assert.equal(columna.calc({ tipo: 'Egreso', comprobante: null, servicio_id: 9 }).texto, '—');
});

test('la columna está en el listado', () => {
  assert.ok(tesoreria.listFields.includes('respaldo'));
});

/* ---------------------------------------------------------------- el filtro */

const filtro = tesoreria.filtrosPropios.find((f) => f.nombre === 'respaldo');

test('«Egresos sin respaldo» busca los egresos a mano que no lo tienen', () => {
  const { sql } = filtro.donde('Egresos sin respaldo');
  const cuantos = db.prepare(`SELECT COUNT(*) c FROM tesoreria WHERE ${sql}`).get().c;

  const conBoleta = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, comprobante)
     VALUES ('2026-05-11','Egreso','Compras','Con boleta TT',1000,?,?,'b.pdf')`
  ).run(cuenta, iglesia).lastInsertRowid;
  const sinBoleta = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES ('2026-05-11','Egreso','Compras','Sin boleta TT',1000,?,?)`
  ).run(cuenta, iglesia).lastInsertRowid;
  const deTraspaso = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, traspaso_id)
     VALUES ('2026-05-11','Egreso','Traspaso','De traspaso TT',1000,?,?,77)`
  ).run(cuenta, iglesia).lastInsertRowid;

  const ahora = db.prepare(`SELECT COUNT(*) c FROM tesoreria WHERE ${sql}`).get().c;
  assert.equal(ahora - cuantos, 1, 'solo el que de verdad no tiene y lo escribió una persona');

  const { sql: conSql } = filtro.donde('Con respaldo');
  const conRespaldo = db.prepare(`SELECT id FROM tesoreria WHERE ${conSql} AND id IN (?,?,?)`)
    .all(conBoleta, sinBoleta, deTraspaso);
  assert.deepEqual(conRespaldo.map((r) => r.id), [conBoleta]);

  [conBoleta, sinBoleta, deTraspaso].forEach((id) => db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id));
});

/* ------------------------------------------------------------- la pantalla */

test('un filtro de lista fija llega hasta la pantalla y se puede pintar', () => {
  assert.deepEqual(filtro.opciones, ['Egresos sin respaldo', 'Con respaldo']);
  assert.match(index, /opciones: opciones \|\| null/, 'el servidor las manda');
  assert.match(app, /f\.opciones && f\.opciones\.length/, 'y la pantalla las pinta');
});

test('la pantalla sabe cómo preguntar por el respaldo', () => {
  assert.match(app, /egreso_sin_respaldo:\s*\{/);
  assert.match(app, /Este egreso va sin su comprobante/);
});

test('el monto se administra en Configuración, no está fijo en el código', () => {
  assert.ok(ajustes.POR_CLAVE['egreso_pide_comprobante_desde'], 'tiene que ser un ajuste');
  assert.equal(ajustes.POR_CLAVE['egreso_pide_comprobante_desde'].tipo, 'number');
});
