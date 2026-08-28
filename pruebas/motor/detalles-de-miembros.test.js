/**
 * TRES DETALLES QUE HACÍAN PERDER UN RATO TODOS LOS DÍAS.
 *
 * Ninguno rompía nada. Cada uno costaba poco de arreglar y molestaba seguido:
 *
 *   · el RUT escrito de corrido no encontraba a nadie. Medido: «21.000.000-3»
 *     encontraba a su dueña, «21000000» también, y «210000003» —como viene
 *     copiado de una planilla— daba CERO.
 *
 *   · el formulario pedía el trato fijado a mano ANTES que el nombre. Era el
 *     cuarto campo de la pantalla: lo primero que se decidía al registrar a
 *     alguien era una excepción que casi nadie debe tocar.
 *
 *   · la dirección se buscaba en No miembros y no en Miembros. Los dos
 *     registros guardan la misma clase de persona y contestaban distinto:
 *     «Los Aromos» encontraba a los visitantes de esa calle y no a los
 *     miembros.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');
const noMiembros = require('../../server/modules/no_miembros');
const busqueda = require('../../server/busqueda');

const CAMPOS = miembros.searchFields;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los detalles', 'IG-DET', 'Activa')")
  .run().lastInsertRowid;

let n = 0;
function alguien(extra = {}) {
  n++;
  return db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, rut, direccion) VALUES (?, ?, ?, 'Activo', ?, ?)")
    .run(extra.nombres || `Detalle${n}`, extra.apellidos || `Delmodulo${n}`, iglesia,
      extra.rut || null, extra.direccion || null)
    .lastInsertRowid;
}

/** A quién encuentra lo tecleado, dentro de esta iglesia. */
function encuentra(texto) {
  const c = busqueda.condicion(texto, CAMPOS);
  if (!c) return [];
  return db.prepare(`SELECT id FROM miembros WHERE iglesia_id = ${iglesia} AND (${c.sql})`)
    .all(...c.params).map((r) => r.id);
}

// ------------------------ M-08 · el RUT, escrito como sea ------------------

test('el RUT de corrido encuentra a su dueño, esté guardado como esté', () => {
  /*
   * Está guardado como venga —con puntos en unas fichas y sin ellos en otras,
   * según por dónde entró— y se teclea también como sea. En vez de adivinar el
   * formato, se comparan los dos sin puntos ni guiones.
   */
  const conPuntos = alguien({ rut: '22.333.444-5', nombres: 'Punteado' });
  const sinPuntos = alguien({ rut: '19555666-0', nombres: 'Corrido' });

  for (const t of ['22.333.444-5', '22333444-5', '223334445', '22333444', '22.333.444']) {
    assert.deepEqual(encuentra(t), [conPuntos], `se le escapó «${t}» a la que está guardada con puntos`);
  }
  for (const t of ['19555666-0', '195556660', '19.555.666-0', '19555666']) {
    assert.deepEqual(encuentra(t), [sinPuntos], `se le escapó «${t}» a la que está guardada de corrido`);
  }
});

test('el dígito verificador K también', () => {
  const conK = alguien({ rut: '21000100-K', nombres: 'Conka' });
  for (const t of ['21000100-K', '21000100k', '21000100', '21.000.100-K']) {
    assert.deepEqual(encuentra(t), [conK], `se le escapó «${t}»`);
  }
});

test('lo que no parece un RUT se compara tal cual', () => {
  /*
   * Nada de esto puede ponerse a comparar «de corrido»: un apellido con guion
   * es un apellido, y un teléfono con espacios es un teléfono.
   */
  for (const t of ['González', 'Los Aromos', '+56 9 1111 2222', 'a-b']) {
    const c = busqueda.condicion(t, CAMPOS);
    assert.ok(!/replace\(replace\(/.test(c.sql.split(' AND ')[0]) || !busqueda.PARECE_RUT.test(t.split(/\s+/)[0]),
      `«${t}» se está tratando como un RUT`);
  }
  assert.ok(busqueda.PARECE_RUT.test('210000003'));
  assert.ok(busqueda.PARECE_RUT.test('21.000.000-3'));
  assert.ok(!busqueda.PARECE_RUT.test('González'));
  assert.ok(!busqueda.PARECE_RUT.test('123'), 'tres cifras no son un RUT: sería medio registro');
});

test('un RUT dentro de una búsqueda de varias palabras sigue funcionando', () => {
  const quien = alguien({ nombres: 'Melitona', apellidos: 'Del Rut Largo', rut: '18222333-1' });
  assert.deepEqual(encuentra('Melitona 182223331'), [quien]);
  assert.deepEqual(encuentra('182223331 Melitona'), [quien], 'el orden da lo mismo');
});

// ------------------------ M-09 · el orden del formulario -------------------

test('el trato fijado a mano ya no se pide antes que el nombre', () => {
  const orden = miembros.fields.map((f) => f.name);
  const trato = orden.indexOf('tratamiento_personalizado');
  assert.ok(trato > orden.indexOf('nombres'), 'era el cuarto campo, antes de escribir el nombre');
  assert.ok(trato > orden.indexOf('apellidos'));
  assert.ok(trato > orden.indexOf('genero'), 'va al final de la identificación');
});

test('y sigue estando: se movió, no se sacó', () => {
  const campo = miembros.fields.find((f) => f.name === 'tratamiento_personalizado');
  assert.ok(campo, 'quien lo necesita tiene que poder encontrarlo');
  assert.ok(!campo.seccion, 'no abre una sección nueva: sigue dentro de Identificación');
});

test('lo primero que pide el formulario son los datos de la persona', () => {
  const primeros = miembros.fields.slice(0, 5).map((f) => f.name);
  assert.deepEqual(primeros, ['foto', 'iglesia_id', 'rut', 'nombres', 'apellidos']);
});

// -------------------------- M-10 · la dirección ----------------------------

test('la dirección encuentra a quien vive ahí', () => {
  const vecina = alguien({ nombres: 'Vecina', direccion: 'Los Aromos 1420, Villa El Sol' });
  for (const t of ['Los Aromos', 'aromos', 'Villa El Sol', 'los aromos 1420']) {
    assert.deepEqual(encuentra(t), [vecina], `se le escapó «${t}»`);
  }
});

test('los dos registros de gente se buscan igual', () => {
  /*
   * Guardan la misma clase de persona: que uno encuentre por dirección y el
   * otro no es una diferencia que nadie puede explicar mirando la pantalla.
   */
  assert.deepEqual([...miembros.searchFields].sort(), [...noMiembros.searchFields].sort());
});

test('la dirección sigue siendo un dato reservado', () => {
  /*
   * Se puede quitar el permiso a quien tenga que consultar el registro sin
   * llevarse los contactos de la congregación. Poder buscar por un dato que no
   * se puede ver sería una manera de averiguarlo probando.
   */
  const campo = miembros.fields.find((f) => f.name === 'direccion');
  assert.equal(campo.reservado, 'miembros_contacto');

  const sensibles = require('../../server/sensibles');
  assert.ok(sensibles.buscablesPara(miembros, { rol: 'admin' }).includes('direccion'),
    'quien sí la ve tiene que poder buscar por ella');
  assert.ok(!sensibles.buscablesPara(miembros, null).includes('direccion'),
    'quien no la alcanza tampoco puede usarla para buscar: si no, bastaría con probar calles');
  assert.ok(sensibles.buscablesPara(miembros, null).includes('nombres'),
    'y lo que no es reservado se sigue pudiendo buscar');
});
