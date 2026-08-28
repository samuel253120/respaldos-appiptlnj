/**
 * La asistencia admitía números que no existen.
 *
 * La ofrenda tenía tope inferior y rechazaba los montos negativos; la asistencia
 * no. Medido en la revisión del módulo: un servicio con MENOS treinta adultos se
 * guardaba, y el total general —que se suma solo— quedaba en menos treinta. Y
 * 999.999 adultos también se guardaban, sin que el sistema dijera una palabra.
 *
 * El tope inferior lo pone el motor con el `min` del campo, que es la misma
 * línea que la ofrenda ya tenía. El otro lado no se puede topar —cinco mil
 * personas en un servicio son posibles— así que se pregunta.
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
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Gente ZZ','SRV-GEN','Activa')")
  .run().lastInsertRowid;

const campo = (nombre) => servicios.fields.find((f) => f.name === nombre);

const alGuardar = (data, opciones = {}) =>
  servicios.hooks.beforeSave(
    { fecha: '2032-08-08', tipo: 'Servicio Especial', iglesia_id: iglesia, ...data },
    { existing: null, db, ...opciones }
  );

/* --------------------------------------------------------- el tope de abajo */

test('los dos campos de asistencia no admiten números negativos', () => {
  assert.equal(campo('asistencia_adultos').min, 0);
  assert.equal(campo('asistencia_ninos').min, 0);
});

test('y es el mismo tope que la ofrenda ya tenía', () => {
  assert.equal(campo('ofrenda_total').min, 0);
});

test('y el motor lo rechaza diciendo qué campo es', () => {
  // Quién escribe el aviso es el motor, no el módulo: se le pide directamente,
  // que es como lo comprueba pruebas/motor/limites.test.js —donde estos dos
  // campos quedaron anotados en la lista de los que no admiten negativos—
  const { revisarLimites } = require('../../server/crud');
  assert.match(revisarLimites(campo('asistencia_adultos'), -30), /"Asistencia de adultos" no puede ser negativo/);
  assert.match(revisarLimites(campo('asistencia_ninos'), -1), /"Asistencia de niños" no puede ser negativo/);
  assert.equal(revisarLimites(campo('asistencia_adultos'), 0), null);
});

/* ------------------------------------------------------- el tope de arriba */

test('demasiada gente se pregunta antes de guardar', () => {
  const r = alGuardar({ asistencia_adultos: 999999 });
  assert.equal(r.confirmar, 'fue_mucha_gente_al_servicio');
  assert.match(r.error, /999\.999 asistentes/);
});

test('y se cuenta el total, no cada campo por su lado', () => {
  // Cuatro mil adultos y mil quinientos niños son cinco mil quinientas personas:
  // por separado ninguno de los dos llega al número, juntos sí
  const r = alGuardar({ asistencia_adultos: 4000, asistencia_ninos: 1500 });
  assert.equal(r.confirmar, 'fue_mucha_gente_al_servicio');
  assert.match(r.error, /5\.500 asistentes/);
  assert.match(r.error, /4\.000 adultos y 1\.500 niños/);
});

test('una asistencia de las de todos los domingos no se pregunta', () => {
  assert.equal(alGuardar({ asistencia_adultos: 120, asistencia_ninos: 20 }), null);
  assert.equal(alGuardar({ asistencia_adultos: 5000 }), null, 'el número justo todavía pasa');
});

test('quien dice que fue esa gente, guarda', () => {
  assert.equal(alGuardar({ asistencia_adultos: 999999 }, { confirmado: true }), null);
});

test('un servicio sin asistencia anotada no se pregunta', () => {
  assert.equal(alGuardar({}), null);
});

test('el aviso habla en singular cuando corresponde', () => {
  const r = alGuardar({ asistencia_adultos: 5000, asistencia_ninos: 1 });
  assert.match(r.error, /1 niño\)/);
});

/* ---------------------------------------------------------------- el orden */

test('lo de la gente se pregunta después de las horas y antes del pasaje', () => {
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/servicios.js'), 'utf8');
  const gancho = modulo.slice(modulo.indexOf('beforeSave(data,'), modulo.indexOf('afterSave(fila,'));
  assert.ok(gancho.indexOf('cuantoDuro(') < gancho.indexOf('GENTE_QUE_YA_ES_MUCHA'));
  assert.ok(gancho.indexOf('GENTE_QUE_YA_ES_MUCHA') < gancho.indexOf('loQueNoCalza('));
});

test('la pantalla sabe explicar la pregunta de la asistencia', () => {
  assert.match(app, /fue_mucha_gente_al_servicio: \{/);
});
