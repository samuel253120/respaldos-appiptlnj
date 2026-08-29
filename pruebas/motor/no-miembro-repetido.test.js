/**
 * LA MISMA SEÑORA, ANOTADA DOS VECES.
 *
 * Medido contra el sistema andando: se creó «Ana Torres» tres veces seguidas
 * en la misma iglesia y contestó 201, 201 y 201 sin preguntar nada. En
 * Miembros, la segunda vez pregunta —y con un texto escrito justamente para el
 * caso «sin RUT ni fecha de nacimiento»—, que acá es el caso normal y no la
 * excepción: de las 60 fichas de prueba, NINGUNA tiene RUT.
 *
 * Cada ficha repetida parte el historial en dos, y la cuenta de «a cuántas
 * personas distintas se ha ayudado» —la que se acaba de construir— empieza a
 * ser mentira sin que nadie se entere.
 *
 * Lo que cuida este archivo, además de que la pregunta salga:
 *   · que NO salga donde sería ruido, que es la mitad del problema: un aviso
 *     que aparece siempre enseña a apretar «seguir» sin leer
 *   · que diga cuántas entregas tiene la ficha que ya existe, que es el
 *     argumento de verdad para abrir esa
 *   · y que no tranque a quien viene a anotar un teléfono
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const noMiembros = require('../../server/modules/no_miembros');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Repetidas', 'IG-RPT1', 'Activa')")
  .run().lastInsertRowid;
const vecina = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Repetidas vecina', 'IG-RPT2', 'Activa')")
  .run().lastInsertRowid;

const ficha = (datos) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, rut, fecha_nacimiento, iglesia_id, miembro_id) VALUES (?,?,?,?,?,?)')
  .run(datos.nombres, datos.apellidos || null, datos.rut || null, datos.fecha_nacimiento || null,
    datos.iglesia_id || iglesia, datos.miembro_id || null).lastInsertRowid;

/** El hook de verdad, llamado como lo llama el motor. */
const alGuardar = (data, opciones = {}) =>
  noMiembros.hooks.beforeSave(data, { db, id: opciones.id || null, existing: opciones.existing || null,
    confirmado: !!opciones.confirmado });

/* ------------------------------------------------- cuándo SÍ se pregunta */

const anaTorres = ficha({ nombres: 'Ana', apellidos: 'Torres' });

test('la misma persona con apellido, otra vez, se pregunta', () => {
  const r = alGuardar({ nombres: 'Ana', apellidos: 'Torres', iglesia_id: iglesia });
  assert.ok(r, 'antes se guardaba la tercera sin decir nada');
  assert.equal(r.confirmar, 'miembro_con_el_mismo_nombre', 'la misma llave que usa Miembros');
  assert.match(r.error, /Ya hay una ficha de Ana Torres en esta iglesia/);
  assert.match(r.error, /sin RUT ni fecha de nacimiento/, 'y con qué se distinguiría, si hubiera con qué');
});

test('con tildes, mayúsculas y espacios de más, es la misma', () => {
  ficha({ nombres: 'José Luis', apellidos: 'Muñoz Rojas' });
  const r = alGuardar({ nombres: '  jose  luis ', apellidos: 'MUNOZ ROJAS', iglesia_id: iglesia });
  assert.ok(r, 'quien la anota dos veces no la escribe dos veces igual');
});

test('el segundo nombre no la hace otra persona', () => {
  const r = alGuardar({ nombres: 'Ana María', apellidos: 'Torres', iglesia_id: iglesia });
  assert.ok(r, 'Ana Torres y Ana María Torres son la misma señora que un día dio su segundo nombre');
});

test('sin apellido, se compara el nombre completo', () => {
  ficha({ nombres: 'María' });
  assert.ok(alGuardar({ nombres: 'maría', iglesia_id: iglesia }), 'dos «María» a secas, en la misma iglesia');
});

test('la que ya tiene entregas lo dice, que es el argumento de verdad', () => {
  const conHistoria = ficha({ nombres: 'Carmen', apellidos: 'Soto' });
  const meter = (estado) => db
    .prepare(
      `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id, beneficiario,
                                    tipo_ayuda, valor_estimado, estado)
       VALUES ('2026-03-01', ?, 'No miembro', ?, 'x', 'Mercadería', 1000, ?)`
    )
    .run(iglesia, conHistoria, estado);
  meter('Entregada'); meter('Entregada'); meter('Rechazada');
  const r = alGuardar({ nombres: 'Carmen', apellidos: 'Soto', iglesia_id: iglesia });
  assert.match(r.error, /2 entregas anotadas/,
    'crear otra no pierde el historial: lo parte en dos, y eso desde el formulario no se ve');
  assert.doesNotMatch(r.error, /3 entregas/, 'la rechazada no fue una entrega');
});

test('si la que ya está se inscribió, también se dice', () => {
  const suMiembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa','Vera',?,'Activo')")
    .run(iglesia).lastInsertRowid;
  ficha({ nombres: 'Rosa', apellidos: 'Vera', miembro_id: suMiembro });
  const r = alGuardar({ nombres: 'Rosa', apellidos: 'Vera', iglesia_id: iglesia });
  assert.match(r.error, /ya inscrita como miembro/);
});

test('con varias iguales se listan, no se dice «una»', () => {
  ficha({ nombres: 'Juana', apellidos: 'Pinto' });
  ficha({ nombres: 'Juana', apellidos: 'Pinto' });
  const r = alGuardar({ nombres: 'Juana', apellidos: 'Pinto', iglesia_id: iglesia });
  assert.match(r.error, /Ya hay 2 fichas con ese mismo nombre/);
});

/* ------------------------------------------------- cuándo NO se pregunta */

test('en otra iglesia no es la misma persona', () => {
  assert.equal(alGuardar({ nombres: 'Ana', apellidos: 'Torres', iglesia_id: vecina }), null,
    'cada iglesia lleva su registro: dos Ana Torres en dos barrios no tienen nada que ver');
});

test('con dos RUT distintos no hay nada que preguntar', () => {
  ficha({ nombres: 'Pedro', apellidos: 'Lara', rut: '15286234-2' });
  assert.equal(alGuardar({ nombres: 'Pedro', apellidos: 'Lara', rut: '11111111-1', iglesia_id: iglesia }), null,
    'dos RUT distintos son dos personas distintas');
});

test('«María» a secas y «María González» NO se preguntan', () => {
  // La decisión que más cuesta: podrían ser la misma que la segunda vez dio su
  // apellido, pero en un registro del barrio los nombres de pila se repiten, y
  // un aviso que sale en casi cada ficha nueva enseña a apretar «seguir» sin
  // leer. Está escrito en el encabezado del módulo para que se sepa que es una
  // decisión y no un olvido.
  assert.equal(alGuardar({ nombres: 'María', apellidos: 'González', iglesia_id: iglesia }), null);
  assert.equal(alGuardar({ nombres: 'María', iglesia_id: iglesia }) === null, false,
    'pero dos «María» a secas sí, que es el caso que sí se puede reconocer');
});

test('«María Elena» no es «María»', () => {
  assert.equal(alGuardar({ nombres: 'María Elena', iglesia_id: iglesia }), null,
    'sin apellido se compara el nombre entero: si no, media iglesia sería la misma señora');
});

test('quien confirma manda', () => {
  assert.equal(alGuardar({ nombres: 'Ana', apellidos: 'Torres', iglesia_id: iglesia }, { confirmado: true }), null,
    'dos vecinas que se llaman igual existen: pregunta, no bloquea');
});

/* ------------------------------------- que no tranque a quien viene a otra cosa */

test('anotarle el teléfono a una ficha repetida que ya estaba no pregunta nada', () => {
  // Tiene que HABER una repetida de verdad, si no la prueba pasa sola: sin
  // otra «Ana Torres» en la iglesia no hay nada que preguntar aunque se
  // revisara en cada guardado, y el guardián quedaría sin vigilar.
  ficha({ nombres: 'Ana', apellidos: 'Torres' });
  const existente = { id: anaTorres, nombres: 'Ana', apellidos: 'Torres', iglesia_id: iglesia };
  assert.ok(alGuardar({ nombres: 'Ana', apellidos: 'Torres', iglesia_id: iglesia }),
    'la repetida existe: crear una tercera sí preguntaría');
  assert.equal(alGuardar({ telefono: '+56 9 1111 2222' }, { id: anaTorres, existing: existente }), null,
    'pero anotarle el teléfono, no: la repetida ya estaba y quien la corrige a lo mejor ni la conoce');
});

test('pero cambiarle el nombre a uno que ya existe sí pregunta', () => {
  const otra = ficha({ nombres: 'Sonia', apellidos: 'Aguilar' });
  const existente = { id: otra, nombres: 'Sonia', apellidos: 'Aguilar', iglesia_id: iglesia };
  const r = alGuardar({ nombres: 'Ana', apellidos: 'Torres' }, { id: otra, existing: existente });
  assert.ok(r, 'renombrarla para que quede igual que otra es crear el repetido por otro camino');
});

test('una ficha no se pregunta a sí misma', () => {
  // El caso que de verdad lo prueba: se le agrega el segundo nombre y el
  // apellido NO cambia. La ficha guardada sigue siendo «Ana Torres» y la que
  // se está guardando es «Ana María Torres», que por la regla del primer
  // nombre son la misma. Sin excluirla, la ficha se avisaría de sí misma.
  const sola = ficha({ nombres: 'Elvira', apellidos: 'Quiroz' });
  const existente = { id: sola, nombres: 'Elvira', apellidos: 'Quiroz', iglesia_id: iglesia };
  assert.equal(alGuardar({ nombres: 'Elvira Rosa' }, { id: sola, existing: existente }), null,
    'agregarle el segundo nombre a la propia ficha no puede chocar con ella misma');
});

/* ------------------------------------------------------------ la pantalla */

test('la pantalla ya sabe cómo preguntarlo', () => {
  assert.match(app, /miembro_con_el_mismo_nombre: \{\s*\n\s*titulo: '🧍 Puede que esta persona ya esté registrada'/,
    'se reusa la llave de Miembros: es la misma pregunta y tiene que verse igual');
});

test('la regla de comparar textos es la del sistema, no una copia', () => {
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/no_miembros.js'), 'utf8');
  assert.match(modulo, /const \{ comoSeCompara \} = require\('\.\.\/repetido'\);/,
    'una regla de comparación escrita dos veces un día dice dos cosas distintas');
});
