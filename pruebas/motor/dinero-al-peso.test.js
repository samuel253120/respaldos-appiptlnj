/**
 * El dinero, al peso y entero en su tarjeta.
 *
 * Dos cosas que se notaban todos los días. Arriba del libro van las tarjetas de
 * ingresos, egresos y balance, que llevan la primera cifra que se mira al
 * entrar: con las de una organización de verdad se cortaban a media cifra
 * —medido en un computador de 1.280 px, a «Ingresos» y a «Egresos» les faltaban
 * 11 px cada una y se leía «$ 182.552.72…»—. Y los montos se guardaban con
 * decimales, que en pesos no existen: un movimiento de $1.000,55 entraba tal
 * cual, y los centavos ensucian todas las sumas hasta que el balance no cuadra
 * nunca con la caja al peso.
 *
 * El redondeo va al GUARDAR, no al mostrar: un dato guardado mal no se arregla
 * con maquillaje. Lo que sí se arregla al mostrar es lo que ya estaba anotado
 * antes de esta versión.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { coerce } = require('../../server/crud');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

/* --------------------------------------------------- el dinero se guarda al peso */

const dinero = { name: 'monto', label: 'Monto', type: 'money' };

test('un monto con centavos se guarda al peso', () => {
  assert.equal(coerce(dinero, 1000.55), 1001);
  assert.equal(coerce(dinero, 1000.4), 1000);
  assert.equal(coerce(dinero, 999.5), 1000);
});

test('uno redondo no se toca', () => {
  assert.equal(coerce(dinero, 2500), 2500);
  assert.equal(coerce(dinero, 0), 0);
});

test('los negativos redondean para el mismo lado que los positivos', () => {
  assert.equal(coerce(dinero, -1000.4), -1000);
  assert.equal(coerce(dinero, -1000.6), -1001);
});

test('lo vacío sigue siendo vacío, no cero', () => {
  assert.equal(coerce(dinero, ''), null);
  assert.equal(coerce(dinero, null), null);
  assert.equal(coerce(dinero, undefined), undefined);
  assert.equal(coerce(dinero, 'hola'), null);
});

test('un campo que sí necesita decimales puede pedirlos', () => {
  const tasa = { name: 'tasa', label: 'Tasa', type: 'money', decimales: true };
  assert.equal(coerce(tasa, 1000.55), 1000.55, 'es una opción, no un descuido');
});

test('un número que no es plata conserva sus decimales', () => {
  const numero = { name: 'promedio', label: 'Promedio', type: 'number' };
  assert.equal(coerce(numero, 3.75), 3.75, 'un promedio con decimales es un promedio');
});

test('y el movimiento guardado de verdad queda entero', () => {
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Peso RR','TES-PES','Activa')")
    .run().lastInsertRowid;
  const cuenta = db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
              VALUES ('General del Peso RR','Iglesia local','General',?,'Activa',0)`)
    .run(iglesia).lastInsertRowid;
  const tesoreria = require('../../server/modules/tesoreria');
  const campo = tesoreria.fields.find((f) => f.name === 'monto');
  const id = db
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
       VALUES ('2026-06-06','Ingreso','Ofrendas','Con centavos RR',?,?,?)`
    ).run(coerce(campo, 1000.55), cuenta, iglesia).lastInsertRowid;
  assert.equal(db.prepare('SELECT monto FROM tesoreria WHERE id = ?').get(id).monto, 1001);
});

/* ------------------------------------------------ la cifra cabe en su tarjeta */

/*
 * Lo que sigue son vistazos al código, no pruebas de que la cifra quepa: acá no
 * hay navegador que mida un ancho. Que de verdad entre se comprobó midiéndolo
 * —a 1.280 px «Ingresos» y «Egresos» pasaron de faltarles 11 px a caber, y una
 * cifra de doce dígitos bajó sola de 21 a 19 px— y el barrido móvil lo vuelve a
 * comprobar a 390 px en cada versión. Esto solo ataja que alguien borre una de
 * las tres piezas sin darse cuenta.
 */

test('la plata se muestra sin centavos, incluso la que ya estaba anotada', () => {
  // Lo que se guardó antes de esta versión los sigue teniendo, y «$ 765.432,1»
  // en un libro de caja se lee como un error de otra cosa
  assert.match(app, /return '\$ ' \+ \(Number\.isFinite\(x\) \? fmtNumero\(Math\.round\(x\)\) : fmtNumero\(n\)\);/);
});

test('pero un número que no es plata mantiene sus decimales', () => {
  assert.match(app, /maximumFractionDigits: 2/, 'el promedio de asistencia, un porcentaje');
});

test('la columna de las tarjetas mide lo que mide una cifra de nueve dígitos', () => {
  assert.match(css, /\.treasury-summary, \.resumen-cifras \{[^}]*minmax\(200px/,
    'con 180 px se cortaban: medido, les faltaban 11 px');
});

test('la cifra no se parte en dos líneas', () => {
  assert.match(css, /\.fin \.num \{[^}]*white-space: nowrap/);
});

test('y si aun así no cabe, se le baja el cuerpo a la letra en vez de cortarla', () => {
  assert.match(app, /function ajustarCifras\(/);
  assert.match(app, /num\.scrollWidth > num\.clientWidth/, 'se mide después de pintar');
  assert.match(app, /px -= 2/, 'de dos en dos');
  assert.match(app, /px >= 13/, 'y con un piso: más chico ya no es una cifra destacada');
});

test('nadie tiene que acordarse de llamarla: se mira lo que se pinta', () => {
  assert.match(app, /function vigilarLasCifras\(/);
  assert.match(app, /new MutationObserver\(pedir\)\.observe\(caja/);
  assert.match(app, /window\.addEventListener\('resize', pedir\)/);
  assert.match(app, /vigilarLasCifras\(\);/, 'y se engancha al arrancar');
});
