/**
 * El registro de un servicio ya no pide el tema del mensaje.
 *
 * Era un texto libre que la iglesia no usaba: el registro dice quién predicó y
 * sobre qué pasaje, y el tema no se anotaba nunca. Se sacó del formulario y de
 * la hoja impresa.
 *
 * Lo que se vigila acá son las dos maneras de que sacarlo saliera mal:
 *
 *   · que se lleve por delante el encabezado de su sección. El campo que se fue
 *     era el que abría «Mensaje bíblico»; si nadie toma su lugar, el libro y los
 *     versículos quedan colgando de la sección anterior, que es la del
 *     predicador.
 *
 *   · que se borre lo que alguien hubiera escrito. La columna sigue en la base:
 *     el motor agrega columnas y no las quita, y acá no se borra nada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const servicios = require('../../server/modules/servicios');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

test('el formulario ya no pide el tema del mensaje', () => {
  assert.ok(!servicios.fields.some((f) => f.name === 'mensaje_titulo'));
});

test('y la hoja impresa tampoco lo muestra', () => {
  const hoja = app.slice(app.indexOf('Registro de Servicio'), app.indexOf('Registro de Servicio') + 1800);
  assert.ok(!/mensaje_titulo/.test(hoja));
  assert.match(hoja, /fila\('Predicador\(a\)', row\.predicador\)/, 'lo demás del mensaje sigue');
  assert.match(hoja, /fila\('Pasaje', row\.cita_mensaje\)/);
});

test('lo que quedó del mensaje no anda suelto', () => {
  /*
   * Cuando se sacó «Tema del mensaje» —que era el campo que abría la sección—
   * esta prueba exigía que el libro la abriera en su lugar, para que él y los
   * versículos no quedaran colgando de la sección del predicador. Desde la
   * 1.160.0 cuelgan de ella A PROPÓSITO: quién predicó y sobre qué pasaje son
   * una sola cosa y van en una sola sección, que es lo que bajó el formulario
   * de nueve secciones a seis (ver servicio-formulario-corto.test.js).
   *
   * Lo que esta prueba sigue vigilando es lo de siempre: que ningún campo del
   * mensaje quede fuera de una sección, y que dos campos no abran la misma.
   */
  const suya = servicios.fields.find((f) => f.name === 'predicador').seccion;
  assert.ok(suya, 'el predicador tiene que abrir su sección');
  for (const campo of ['mensaje_libro', 'mensaje_capitulo', 'mensaje_versiculo_final']) {
    assert.ok(!servicios.fields.find((f) => f.name === campo).seccion,
      `«${campo}» abre una sección propia: el mensaje se parte en dos`);
  }

  const secciones = servicios.fields.filter((f) => f.seccion).map((f) => f.seccion);
  assert.equal(new Set(secciones).size, secciones.length, 'dos campos no pueden abrir la misma sección');
  for (const cual of [suya, 'Asistencia', 'Ofrenda']) {
    assert.ok(secciones.includes(cual), `nadie abre «${cual}»`);
  }
});

test('nada borra la columna ni lo que tuviera escrito', () => {
  /*
   * En una base nueva la columna ya no se crea, y está bien: el campo no existe.
   * Lo que hay que asegurar es la base que viene de ANTES, donde la columna está
   * con lo que alguien escribió. Acá se arma esa situación a mano y se comprueba
   * que sacar el campo del formulario no se lleva el dato.
   */
  const columnas = () => db.prepare('PRAGMA table_info(servicios)').all().map((c) => c.name);
  if (!columnas().includes('mensaje_titulo')) {
    db.exec('ALTER TABLE servicios ADD COLUMN mensaje_titulo TEXT');
  }
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Tema','SRV-TEMA','Activa')")
    .run().lastInsertRowid;
  const id = db.prepare("INSERT INTO servicios (fecha, tipo, iglesia_id, mensaje_titulo) VALUES ('2026-01-04','Servicio General',?,'La fe que obra')")
    .run(iglesia).lastInsertRowid;

  // Editar el servicio por los campos que SÍ existen no toca el que se fue
  db.prepare("UPDATE servicios SET tipo = 'Servicio Especial' WHERE id = ?").run(id);
  const despues = db.prepare('SELECT tipo, mensaje_titulo FROM servicios WHERE id = ?').get(id);
  assert.equal(despues.tipo, 'Servicio Especial');
  assert.equal(despues.mensaje_titulo, 'La fe que obra');
  assert.ok(columnas().includes('mensaje_titulo'));
});

test('y no hay nada en el sistema que quite columnas', () => {
  const motor = fs.readFileSync(path.join(__dirname, '../../server/db.js'), 'utf8');
  assert.ok(!/DROP COLUMN/i.test(motor),
    'el motor agrega columnas y no las quita: es lo que hace que sacar un campo no borre nada');
  const migraciones = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');
  assert.ok(!/mensaje_titulo/.test(migraciones), 'y ninguna migración va a buscarla');
});
