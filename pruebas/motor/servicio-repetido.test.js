/**
 * El mismo servicio registrado dos veces mete su ofrenda dos veces.
 *
 * Cada servicio deja tres movimientos en Tesorería, así que dos registros del
 * mismo culto son dos ingresos de la misma ofrenda en la cuenta de la iglesia.
 * Medido en la revisión del módulo: dos servicios idénticos —misma fecha, mismo
 * tipo, misma iglesia— se guardaban los dos sin decir nada, y el día quedaba con
 * seis movimientos y dos ingresos de $100.000.
 *
 * Lo que se vigila acá es que se pregunte antes de guardar, que la pregunta diga
 * con qué distinguir el que ya está —su hora, su ofrenda— para poder decidir, y
 * que NO pregunte donde no corresponde: otro tipo de servicio el mismo día, otra
 * iglesia, otro día, o el propio servicio que se está corrigiendo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const servicios = require('../../server/modules/servicios');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Repetido ZZ','SRV-REP','Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Repetido Sur ZZ','SRV-RE2','Activa')")
  .run().lastInsertRowid;

const DIA = '2027-03-07';

/** Un servicio ya registrado, puesto directo en la base. */
function yaRegistrado(campos = {}) {
  const fila = {
    fecha: DIA, tipo: 'Servicio General', iglesia_id: iglesia,
    hora_inicio: '10:00', ofrenda_total: 100000, ...campos,
  };
  const claves = Object.keys(fila);
  return db
    .prepare(
      `INSERT INTO servicios (${claves.join(',')}) VALUES (${claves.map(() => '?').join(',')})`
    )
    .run(...claves.map((k) => fila[k])).lastInsertRowid;
}

/** Lo que contesta el módulo al guardar. */
const alGuardar = (data, opciones = {}) =>
  servicios.hooks.beforeSave(
    { fecha: DIA, tipo: 'Servicio General', iglesia_id: iglesia, ...data },
    { existing: null, db, ...opciones }
  );

/* ----------------------------------------------------------- se pregunta */

test('cuando no hay ninguno ese día, no se pregunta nada', () => {
  assert.equal(alGuardar({ fecha: '2027-03-01' }), null);
});

test('un servicio igual el mismo día se pregunta antes de guardar', () => {
  yaRegistrado({ fecha: '2027-03-14' });
  const respuesta = alGuardar({ fecha: '2027-03-14' });
  assert.equal(typeof respuesta, 'object');
  assert.equal(respuesta.confirmar, 'servicio_ya_registrado_ese_dia');
});

test('la pregunta dice con qué distinguir el que ya está', () => {
  yaRegistrado({ fecha: '2027-03-21', hora_inicio: '19:30', ofrenda_total: 250000 });
  const { error } = alGuardar({ fecha: '2027-03-21' });
  assert.match(error, /Ya hay un Servicio General registrado el 21 de marzo de 2027/);
  assert.match(error, /Del Repetido ZZ/);
  assert.match(error, /empezó a las 19:30/);
  assert.match(error, /ofrenda \$250\.000/);
});

test('y dice por qué importa: la ofrenda entra dos veces', () => {
  yaRegistrado({ fecha: '2027-03-28' });
  const { error } = alGuardar({ fecha: '2027-03-28' });
  assert.match(error, /registrada dos veces entra dos veces/);
});

test('del que ya está sin hora ni ofrenda no se inventan señas', () => {
  yaRegistrado({ fecha: '2027-04-04', hora_inicio: null, ofrenda_total: 0 });
  const { error } = alGuardar({ fecha: '2027-04-04' });
  assert.match(error, /el 4 de abril de 2027 en Del Repetido ZZ\. /);
  assert.ok(!/\(\)/.test(error), 'quedó un paréntesis vacío');
});

test('quien dice que son dos servicios distintos, guarda', () => {
  yaRegistrado({ fecha: '2027-04-11' });
  assert.equal(alGuardar({ fecha: '2027-04-11' }, { confirmado: true }), null);
});

/* -------------------------------------------------- donde NO se pregunta */

test('otro tipo de servicio el mismo día no se pregunta', () => {
  yaRegistrado({ fecha: '2027-04-18' });
  assert.equal(alGuardar({ fecha: '2027-04-18', tipo: 'Servicio Vigilia' }), null);
});

test('el mismo servicio en otra iglesia no se pregunta', () => {
  yaRegistrado({ fecha: '2027-04-25' });
  assert.equal(alGuardar({ fecha: '2027-04-25', iglesia_id: otraIglesia }), null);
});

test('el mismo servicio otro día no se pregunta', () => {
  yaRegistrado({ fecha: '2027-05-02' });
  assert.equal(alGuardar({ fecha: '2027-05-09' }), null);
});

test('corregir un servicio no lo hace preguntar por sí mismo', () => {
  const id = yaRegistrado({ fecha: '2027-05-16' });
  const suyo = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
  assert.equal(servicios.hooks.beforeSave({ hora_inicio: '10:30' }, { existing: suyo, db, id }), null);
});

test('pero mover un servicio encima de otro sí se pregunta', () => {
  yaRegistrado({ fecha: '2027-05-23' });
  const otro = yaRegistrado({ fecha: '2027-05-30' });
  const suyo = db.prepare('SELECT * FROM servicios WHERE id = ?').get(otro);
  const respuesta = servicios.hooks.beforeSave({ fecha: '2027-05-23' }, { existing: suyo, db, id: otro });
  assert.equal(respuesta.confirmar, 'servicio_ya_registrado_ese_dia');
});

/*
 * Esto lo garantiza SQL y no un resguardo del módulo: una comparación con NULL
 * no calza con ninguna fila. Se comprobó al revés —quitando el resguardo que
 * había, y no se cayó nada—, así que el resguardo se sacó por muerto y lo que
 * queda vigilado es la conducta.
 */
test('sin fecha, sin tipo o sin iglesia no se pregunta: no hay con qué saberlo', () => {
  yaRegistrado({ fecha: '2027-06-06' });
  assert.equal(alGuardar({ fecha: '2027-06-06', tipo: null }), null);
  assert.equal(alGuardar({ fecha: null }), null);
  assert.equal(alGuardar({ fecha: '2027-06-06', iglesia_id: null }), null);
});

/* --------------------------------------------------- el orden y la pantalla */

test('lo primero que se pregunta es lo que cuesta plata', () => {
  // Un servicio repetido Y con la hora mal escrita: la pregunta que se muestra
  // es la del repetido, porque la confirmación es una sola para todo el guardado
  yaRegistrado({ fecha: '2027-06-13' });
  const respuesta = alGuardar({ fecha: '2027-06-13', hora_inicio: '10:00', hora_termino: '09:00' });
  assert.equal(respuesta.confirmar, 'servicio_ya_registrado_ese_dia');
});

test('la pantalla sabe explicar la pregunta del servicio repetido', () => {
  assert.match(app, /servicio_ya_registrado_ese_dia: \{/);
});
