/**
 * Los próximos cumpleaños del panel.
 *
 * Este cálculo se reescribió para que no cueste caro: antes traía TODAS las
 * fichas de la iglesia y las ordenaba en JavaScript para mostrar cinco, y con
 * seis mil miembros eso frenaba al servidor entero 32 ms cada vez que alguien
 * abría el panel. Ahora la base acota primero y el cálculo fino se hace acá
 * abajo, sobre unas pocas fichas.
 *
 * Esa reescritura es justamente la que hay que vigilar, porque el cálculo
 * tiene tres filos donde es fácil equivocarse sin que se note:
 *
 *   · dar vuelta el año: en diciembre, el que cumple en enero es el próximo
 *   · el 29 de febrero: en un año común se celebra el 28
 *   · el desempate: si seis cumplen el mismo día y hay cinco lugares, cuáles
 *
 * Las pruebas se paran en un día fijo —no en «hoy»— para que digan lo mismo
 * el 3 de marzo que el 31 de diciembre.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { proximosCumpleanos } = require('../../server/cumpleanos');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los cumpleaños', 'IG-CUM', 'Activa')")
  .run().lastInsertRowid;

let cuantosRut = 40000000;
/** Deja a alguien en la iglesia de prueba con la fecha de nacimiento que se pida. */
function nace(nombres, apellidos, cuando, estado = 'Activo') {
  return db
    .prepare(
      `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, fecha_nacimiento, estado)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(iglesia, `${cuantosRut++}-0`, nombres, apellidos, cuando, estado).lastInsertRowid;
}

/** Los nombres que salen, en el orden en que salen. */
const quienes = (cuantos, dia) =>
  proximosCumpleanos([iglesia], [], cuantos, dia).map((c) => c.nombre);

// ------------------------------------------------------- lo de todos los días

nace('Ana', 'Del Diez De Marzo', '1980-03-10');
nace('Beto', 'Del Quince De Marzo', '1975-03-15');
nace('Carla', 'Del Uno De Abril', '1990-04-01');
nace('Dario', 'Del Nueve De Marzo', '1985-03-09');

test('salen ordenados por lo que falta, no por la fecha de nacimiento', () => {
  assert.deepEqual(quienes(4, new Date(2027, 2, 10)), [
    'Ana Del Diez De Marzo',      // hoy
    'Beto Del Quince De Marzo',   // en 5 días
    'Carla Del Uno De Abril',     // en 22
    'Dario Del Nueve De Marzo',   // el año que viene
  ]);
});

test('quien cumple hoy encabeza y le quedan cero días', () => {
  const lista = proximosCumpleanos([iglesia], [], 4, new Date(2027, 2, 10));
  assert.equal(lista[0].nombre, 'Ana Del Diez De Marzo');
  assert.equal(lista[0].dias, 0);
  assert.equal(lista[0].fecha, '2027-03-10');
  assert.equal(lista[0].cumple, 47, 'los años que cumple, no los que tiene');
});

test('quien cumplió ayer es el último de todos, no el primero', () => {
  const lista = proximosCumpleanos([iglesia], [], 4, new Date(2027, 2, 10));
  const dario = lista.find((c) => c.nombre.startsWith('Dario'));
  assert.equal(lista[lista.length - 1].nombre, dario.nombre, 'tiene que ir al final');
  assert.equal(dario.fecha, '2028-03-09', 'el año que viene, no este');
  // 2028 es bisiesto, así que del 10 de marzo de 2027 al 9 de marzo de 2028
  // hay 365 días y no 364: la cuenta la hace el calendario, no una resta de
  // trescientos sesenta y cinco.
  assert.equal(dario.dias, 365, `esperaba casi un año, dijo ${dario.dias}`);
});

// --------------------------------------------------- el año que da la vuelta

test('en diciembre, el que cumple en enero es el próximo', () => {
  nace('Elsa', 'Del Dos De Enero', '1970-01-02');
  assert.deepEqual(quienes(1, new Date(2027, 11, 31)), ['Elsa Del Dos De Enero']);
  const [elsa] = proximosCumpleanos([iglesia], [], 1, new Date(2027, 11, 31));
  assert.equal(elsa.fecha, '2028-01-02');
  assert.equal(elsa.dias, 2);
});

test('el 31 de diciembre, quien cumple ese mismo día va primero', () => {
  nace('Fito', 'Del Ultimo Dia', '1970-12-31');
  assert.deepEqual(quienes(2, new Date(2027, 11, 31)), [
    'Fito Del Ultimo Dia',
    'Elsa Del Dos De Enero',
  ]);
});

// ------------------------------------------------------- el 29 de febrero ---

test('quien nació un 29 de febrero lo celebra el 28 en un año común', () => {
  nace('Gaby', 'Del Veintinueve', '2000-02-29');
  const [gaby] = proximosCumpleanos([iglesia], [], 1, new Date(2027, 1, 20));
  assert.equal(gaby.nombre, 'Gaby Del Veintinueve');
  assert.equal(gaby.fecha, '2027-02-28', '2027 no es bisiesto: se corre al 28');
  assert.equal(gaby.dias, 8);
});

test('y el 29 cuando el año sí es bisiesto', () => {
  const [gaby] = proximosCumpleanos([iglesia], [], 1, new Date(2028, 1, 20));
  assert.equal(gaby.fecha, '2028-02-29', '2028 sí es bisiesto: cumple el día que le toca');
  assert.equal(gaby.dias, 9);
});

test('en un año común queda a la par de quien nació el 28, no después', () => {
  nace('Aaa', 'Del Veintiocho', '1990-02-28');
  const dos = quienes(2, new Date(2027, 1, 20));
  assert.deepEqual(dos, ['Aaa Del Veintiocho', 'Gaby Del Veintinueve'],
    'los dos cumplen el 28 y desempata el nombre');
  const lista = proximosCumpleanos([iglesia], [], 2, new Date(2027, 1, 20));
  assert.equal(lista[0].dias, lista[1].dias, 'les tiene que faltar lo mismo');
});

// ------------------------------------------------------------ el desempate ---

test('cuando varios cumplen el mismo día, desempata el nombre', () => {
  for (const n of ['Zulema', 'Marcos', 'Bruno', 'Ariel', 'Nadia'])
    nace(n, 'Todos El Mismo Dia', '1991-06-15');
  assert.deepEqual(quienes(3, new Date(2027, 5, 15)), [
    'Ariel Todos El Mismo Dia',
    'Bruno Todos El Mismo Dia',
    'Marcos Todos El Mismo Dia',
  ]);
});

test('el desempate no se lo puede saltar la base trayendo cinco cualquiera', () => {
  // Con seis del mismo día y tres lugares, si la base cortara en tres «los que
  // encontró primero» saldrían los del id más bajo: Zulema, Marcos y Bruno.
  const salen = quienes(3, new Date(2027, 5, 15));
  assert.ok(!salen.includes('Zulema Todos El Mismo Dia'),
    'Zulema es la primera que insertó la prueba y la última por nombre: no debería salir');
});

// ------------------------------------------------- a quién no hay que saludar

test('a los fallecidos y a los trasladados no se les cuenta el cumpleaños', () => {
  nace('Difunto', 'No Sale', '1960-07-01', 'Fallecido');
  nace('Trasladado', 'Tampoco Sale', '1960-07-02', 'Trasladado');
  const salen = quienes(20, new Date(2027, 5, 30));
  assert.ok(!salen.includes('Difunto No Sale'));
  assert.ok(!salen.includes('Trasladado Tampoco Sale'));
});

test('quien no tiene fecha de nacimiento no aparece', () => {
  nace('Sin', 'Fecha Ninguna', null);
  nace('Vacia', 'Fecha En Blanco', '');
  const salen = quienes(20, new Date(2027, 5, 30));
  assert.ok(!salen.includes('Sin Fecha Ninguna'));
  assert.ok(!salen.includes('Vacia Fecha En Blanco'));
});

test('de otra iglesia no se saluda a nadie', () => {
  const otra = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La otra', 'IG-CUM2', 'Activa')")
    .run().lastInsertRowid;
  db.prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, fecha_nacimiento, estado)
     VALUES (?, ?, 'Ajena', 'De La Otra Iglesia', '1980-03-10', 'Activo')`
  ).run(otra, `${cuantosRut++}-0`);
  assert.ok(!quienes(20, new Date(2027, 2, 10)).includes('Ajena De La Otra Iglesia'));
  assert.ok(proximosCumpleanos([otra], [], 20, new Date(2027, 2, 10))
    .some((c) => c.nombre === 'Ajena De La Otra Iglesia'), 'en la suya sí');
});

// --------------------------------------------------------- cuántos se piden

test('se entregan tantos como se pidan, y nunca más de veinte', () => {
  // Hacen falta más de veinte para que el tope se note: si en la iglesia hay
  // trece, pedir mil devuelve trece y la prueba no probaría nada.
  for (let i = 0; i < 30; i++) nace(`Relleno${i}`, 'Para Llenar La Lista', `1980-05-${String((i % 28) + 1).padStart(2, '0')}`);
  const cuantos = db.prepare('SELECT COUNT(*) c FROM miembros WHERE iglesia_id = ?').get(iglesia).c;
  assert.ok(cuantos > 20, `hacen falta más de veinte para probar el tope, hay ${cuantos}`);
  assert.equal(proximosCumpleanos([iglesia], [], 1, new Date(2027, 2, 10)).length, 1);
  assert.equal(proximosCumpleanos([iglesia], [], 5, new Date(2027, 2, 10)).length, 5);
  assert.equal(proximosCumpleanos([iglesia], [], 999, new Date(2027, 2, 10)).length, 20);
});

test('sin decir cuántos, salen cuatro', () => {
  assert.equal(proximosCumpleanos([iglesia], [], null, new Date(2027, 2, 10)).length, 4);
});

// ------------------------- el resultado tiene que traer lo que el panel pinta

test('cada uno viene con lo que la pantalla necesita mostrar', () => {
  const [uno] = proximosCumpleanos([iglesia], [], 1, new Date(2027, 2, 10));
  for (const campo of ['id', 'nombre', 'foto', 'telefono', 'fecha', 'dia', 'mes', 'dias', 'cumple'])
    assert.ok(campo in uno, `falta «${campo}»`);
  assert.equal(uno.dia, 10);
  assert.equal(uno.mes, 3);
});
