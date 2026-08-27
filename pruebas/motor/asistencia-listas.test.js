/**
 * Las listas de la pantalla de Asistencia salen de donde las mantiene la
 * iglesia, no de dentro del programa.
 *
 * Los tipos de actividad y los motivos de ausencia dejaron de estar escritos
 * en el código: cada iglesia los mantiene en su propia pantalla. Pero la de
 * Asistencia seguía pidiéndolos como si vinieran dentro del programa, y
 * recibía una lista VACÍA sin decirlo. Lo que eso costaba, medido:
 *
 *   · el filtro por tipo del calendario no ofrecía ninguno de los doce
 *   · una actividad nueva quedaba siempre con el tipo de fábrica
 *   · EDITAR una actividad era imposible: el diálogo mandaba el tipo en blanco
 *     y el servidor —con razón— contestaba «El campo "Actividad" es obligatorio»
 *   · y al justificar se ofrecían los motivos escritos en el código, no los de
 *     la iglesia
 *
 * Una lista vacía no se queja: por eso hay que vigilarla desde acá.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const detalle = require('../../server/modules/asistencia_detalle');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

// ------------------------- de dónde saca la pantalla cada lista ------------

test('la pantalla NO lee las opciones del campo cuando vienen de una ruta', () => {
  /*
   * Este es el error exacto que se arregló, escrito para que no vuelva: leer
   * `.options` de un campo que declara `optionsRoute` devuelve una lista vacía
   * y nada avisa.
   */
  const enElCodigo = app.match(/fields\.find\(\([^)]*\) => \w+\.name === '(tipo_reunion|motivo)'\)[^;]*\}\)\.options/g);
  assert.equal(enElCodigo, null,
    `quedó ${(enElCodigo || []).length} lugar(es) leyendo «.options» de un campo que la trae de una ruta`);
});

test('y existe un solo camino para pedirlas', () => {
  assert.match(app, /async function opcionesDelCampo\(modulo, campo\)/,
    'las pantallas hechas a mano necesitan una manera de resolver las dos formas');
  assert.match(app, /if \(!f\.optionsRoute\) return f\.options \|\| \[\];/,
    'con lista escrita en el módulo, esa; con ruta, la ruta');
});

test('los tres lugares de la pantalla de Asistencia usan ese camino', () => {
  const laPantalla = app.slice(app.indexOf('const ASIS = {'));
  for (const [donde, marca] of [
    ['el filtro del calendario', 'const tipos = ASIS.tipos || [];'],
    ['el diálogo de la actividad', 'const tipos = ASIS.tipos || [];'],
    ['los motivos al justificar', 'ASIS.motivos'],
  ]) {
    assert.ok(laPantalla.includes(marca), `${donde} no está tomando la lista de donde corresponde`);
  }
  assert.match(laPantalla, /opcionesDelCampo\('asistencias', 'tipo_reunion'\)/);
  assert.match(laPantalla, /opcionesDelCampo\('asistencia_detalle', 'motivo'\)/);
});

test('el diálogo marca el tipo que corresponde: el suyo al editar, el de Configuración al crear', () => {
  const trozo = app.slice(app.indexOf('function abrirActividad('), app.indexOf('function abrirActividad(') + 2500);
  assert.match(trozo, /const tipoPuesto = editando\s*\?\s*actividad\.tipo_reunion/);
  assert.match(trozo, /campoTipo\.default/, 'al crear, el que la iglesia fijó en Configuración');
});

test('sin ningún tipo en uso se dice, en vez de mostrar un desplegable vacío', () => {
  const trozo = app.slice(app.indexOf('function abrirActividad('), app.indexOf('function abrirActividad(') + 3500);
  assert.match(trozo, /No hay tipos de actividad en uso/,
    'un desplegable vacío parece que anda y no anda: es justo lo que se acaba de arreglar');
});

// ------------------- los motivos que exigen explicación, del lado del servidor --

test('la toma de lista exige explicación en los motivos que marcó la iglesia', () => {
  db.prepare('DELETE FROM motivos_ausencia').run();
  const meter = db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, 1)');
  meter.run('Enfermedad', 0);
  meter.run('Viaje', 1);
  // El módulo lo lee en el momento, no al arrancar: un cambio vale en cuanto
  // se guarda
  assert.deepEqual(detalle.motivosQuePidenDetalle(), ['Viaje']);
});

test('y no una lista escrita dentro del programa', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/modules/asistencias.js'), 'utf8');
  assert.ok(!/MOTIVOS_CON_DETALLE\s*=\s*\[/.test(fuente),
    'estaba fija, y hacía que el módulo se contradijera consigo mismo: la ficha de una marca '
    + 'suelta respetaba lo configurado y la toma de lista, que es por donde entran todas, no');
  assert.match(fuente, /motivosConDetalle\(\)/, 'se pregunta cada vez');
});

// ------------------------------ que se pueda EDITAR una actividad ----------

test('una actividad se guarda con el tipo que se le indique', () => {
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las listas','LISTAS','Activa')")
    .run().lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro','Cuerpo',?,'Activo')")
    .run(iglesia).lastInsertRowid;

  const guardar = (datos, existing) => asistencias.hooks.beforeSave(datos, { existing, db });
  const nueva = { fecha: '2026-08-20', cuerpos: JSON.stringify([cuerpo]), tipo_reunion: 'Retiro espiritual' };
  assert.equal(guardar(nueva, null), null);
  assert.equal(nueva.iglesia_id, iglesia, 'la iglesia se toma del cuerpo');

  // Y editarla sin volver a mandar los cuerpos tampoco se cae
  const soloElLugar = { lugar: 'Casa de retiro' };
  assert.equal(guardar(soloElLugar, { ...nueva, id: 1 }), null);
});

test('sin ningún cuerpo convocado no se guarda', () => {
  assert.match(
    String(asistencias.hooks.beforeSave({ fecha: '2026-08-20', cuerpos: '[]' }, { existing: null, db })),
    /al menos un cuerpo/i
  );
});
