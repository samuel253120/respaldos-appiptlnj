/**
 * El pasaje, contra el libro que dice ser.
 *
 * El libro se elige de una lista —eso estaba bien— pero el capítulo y el
 * versículo eran números libres. Medido en la revisión del módulo: «Judas
 * 40:900-999» se guardaba, y después se leía así en el listado y salía impreso
 * en la hoja del servicio. Judas tiene un capítulo.
 *
 * Se pregunta y no se bloquea, como con todo lo demás de este módulo: se ataja
 * el dedo que resbaló sin discutirle a quien sabe lo que escribió.
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
const biblia = require('../../server/biblia');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Pasaje ZZ','SRV-PAS','Activa')")
  .run().lastInsertRowid;

/** Lo que contesta el módulo al guardar un servicio con este pasaje. */
const alGuardar = (data, opciones = {}) =>
  servicios.hooks.beforeSave(
    { fecha: '2031-07-06', tipo: 'Servicio Especial', iglesia_id: iglesia, ...data },
    { existing: null, db, ...opciones }
  );

/* ---------------------------------------------------------------- la tabla */

test('los sesenta y seis libros tienen su número de capítulos', () => {
  assert.equal(biblia.LIBROS.length, 66);
  const sinNumero = biblia.LIBROS.filter((l) => !biblia.CAPITULOS[l]);
  assert.deepEqual(sinNumero, [], 'hay libros sin número de capítulos');
});

test('y no hay números de libros que no existen', () => {
  const deMas = Object.keys(biblia.CAPITULOS).filter((l) => !biblia.LIBROS.includes(l));
  assert.deepEqual(deMas, []);
});

test('los números son los de la Reina-Valera 1960', () => {
  // Unos cuantos que se saben de memoria, incluidos los dos que esta versión
  // divide distinto del texto hebreo
  assert.equal(biblia.CAPITULOS['Salmos'], 150);
  assert.equal(biblia.CAPITULOS['Génesis'], 50);
  assert.equal(biblia.CAPITULOS['Juan'], 21);
  assert.equal(biblia.CAPITULOS['Apocalipsis'], 22);
  assert.equal(biblia.CAPITULOS['Judas'], 1);
  assert.equal(biblia.CAPITULOS['Abdías'], 1);
  assert.equal(biblia.CAPITULOS['Joel'], 3);
  assert.equal(biblia.CAPITULOS['Malaquías'], 4);
});

/* ------------------------------------------------------------ qué se ataja */

test('el capítulo que el libro no tiene se pregunta', () => {
  const r = alGuardar({ mensaje_libro: 'Judas', mensaje_capitulo: 40, mensaje_versiculo_inicial: 900 });
  assert.equal(r.confirmar, 'el_pasaje_no_calza_con_el_libro');
  assert.match(r.error, /Judas tiene un solo capítulo, y acá dice el 40/);
});

test('y se dice en cuál de los dos pasajes está', () => {
  assert.match(alGuardar({ salmo_libro: 'Salmos', salmo_capitulo: 151 }).error, /^En el salmo:/);
  assert.match(alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 22 }).error, /^En el mensaje:/);
});

test('un versículo que no existe en ningún capítulo se pregunta', () => {
  const r = alGuardar({ mensaje_libro: 'Judas', mensaje_capitulo: 1, mensaje_versiculo_inicial: 900 });
  assert.match(r.error, /el más largo es el Salmo 119, con 176/);
});

test('el versículo final también se mira', () => {
  const r = alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 16, mensaje_versiculo_final: 900 });
  assert.equal(r.confirmar, 'el_pasaje_no_calza_con_el_libro');
});

test('el capítulo cero y el versículo cero se preguntan', () => {
  assert.match(alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 0 }).error, /los capítulos empiezan en el 1/);
  assert.match(
    alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 0 }).error,
    /los versículos empiezan en el 1/
  );
});

/* --------------------------------------------------------- qué NO se ataja */

test('un pasaje que existe pasa sin decir nada', () => {
  assert.equal(alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 16, mensaje_versiculo_final: 18 }), null);
  assert.equal(alGuardar({ salmo_libro: 'Salmos', salmo_capitulo: 150, salmo_versiculo_inicial: 6 }), null);
});

test('el capítulo más largo de la Biblia entero pasa', () => {
  // Salmo 119:1-176: si el tope estuviera un número más abajo, este pasaje de
  // verdad se preguntaría
  assert.equal(alGuardar({ salmo_libro: 'Salmos', salmo_capitulo: 119, salmo_versiculo_inicial: 1, salmo_versiculo_final: 176 }), null);
});

test('el último capítulo de cada libro pasa, libro por libro', () => {
  for (const libro of biblia.LIBROS) {
    const r = alGuardar({ mensaje_libro: libro, mensaje_capitulo: biblia.CAPITULOS[libro], mensaje_versiculo_inicial: 1 });
    assert.equal(r, null, `${libro} ${biblia.CAPITULOS[libro]} no debería preguntarse`);
  }
});

test('un libro sin capítulo anotado no se pregunta: falta el dato, no está mal', () => {
  assert.equal(alGuardar({ mensaje_libro: 'Judas' }), null);
  assert.equal(alGuardar({ mensaje_libro: 'Judas', mensaje_capitulo: '' }), null);
});

test('sin libro no hay nada contra qué comparar', () => {
  assert.equal(alGuardar({ mensaje_capitulo: 900, mensaje_versiculo_inicial: 900 }), null);
});

test('quien dice que está bien escrito, guarda', () => {
  assert.equal(
    alGuardar({ mensaje_libro: 'Judas', mensaje_capitulo: 40, mensaje_versiculo_inicial: 900 }, { confirmado: true }),
    null
  );
});

/* ------------------------------------------------- lo que ya se atajaba sigue */

test('el versículo final anterior al inicial se sigue rechazando, no preguntando', () => {
  const r = alGuardar({ mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 18, mensaje_versiculo_final: 16 });
  assert.equal(typeof r, 'string');
  assert.match(r, /el versículo final no puede ser anterior al inicial/);
});

/* ------------------------------------------------------------- la pantalla */

test('la pantalla sabe explicar la pregunta del pasaje', () => {
  assert.match(app, /el_pasaje_no_calza_con_el_libro: \{/);
});

test('lo del pasaje se pregunta después de lo que cuesta plata', () => {
  /*
   * Se miran las dos LLAMADAS dentro del gancho, no los nombres de las
   * preguntas: «servicio_ya_registrado_ese_dia» también está escrito arriba, en
   * la función que arma ese aviso, y esa línea va antes pase lo que pase. Con
   * ella, la comprobación pasaba aunque las preguntas se dieran vuelta; se vio
   * rompiéndola a propósito.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/servicios.js'), 'utf8');
  const gancho = modulo.slice(modulo.indexOf('beforeSave(data,'), modulo.indexOf('afterSave(fila,'));
  assert.ok(
    gancho.indexOf('avisoDeServicioRepetido(') < gancho.indexOf('loQueNoCalza('),
    'el pasaje se pregunta antes que el servicio repetido'
  );
});
