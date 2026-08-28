/**
 * La plata que solo cambió de bolsillo.
 *
 * El resumen de Tesorería sumaba como ingreso el aporte que una ofrenda pasa al
 * «Fondo para la corporación» de su misma iglesia, y otra vez cuando ese fondo
 * se traspasa a la corporación. Medido en un día sin nada anotado: una ofrenda
 * de $100.000 hacía decir «entraron $110.000», y con el traspaso, «$120.000».
 * Entraron cien mil.
 *
 * Lo que se vigila acá es la regla que lo arregla, que no es «descontar los
 * traslados» a secas: un traslado se descuenta solo cuando SUS DOS LADOS están
 * dentro de lo que se está mirando. Mirando una sola iglesia, el aporte que le
 * traspasa a la corporación tiene un lado adentro y el otro afuera: de esa
 * iglesia esa plata sí salió, y tiene que contarse como egreso.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { sincronizarOfrenda } = require('../../server/ofrenda-tesoreria');
const traspasos = require('../../server/modules/traspasos');
const entreCuentas = require('../../server/entre-cuentas');
const migraciones = require('../../server/migraciones');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Bolsillo ZZ','TES-BOL','Activa')")
  .run().lastInsertRowid;
const cuenta = (nombre, tipo, iglesiaId) => db
  .prepare("INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial) VALUES (?,?,?,?,'Activa',0)")
  .run(nombre, iglesiaId ? 'Iglesia local' : 'Corporación', tipo, iglesiaId || null).lastInsertRowid;

const general = cuenta(`General del Bolsillo ZZ`, 'General', iglesia);
const fondo = cuenta(`Fondo del Bolsillo ZZ`, 'Fondo para la corporación', iglesia);
const corporacion = cuenta(`Corporación del Bolsillo ZZ`, 'General', null);

/** Un servicio con su ofrenda, ya anotado en Tesorería como lo anota el módulo. */
function ofrendaDe(fecha, total, aporte) {
  const id = db
    .prepare(
      `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_fondo, ofrenda_iglesia)
       VALUES (?, 'Servicio General', ?, ?, ?, ?)`
    )
    .run(fecha, iglesia, total, aporte, total - aporte).lastInsertRowid;
  sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id), db);
  return id;
}

/** Un traspaso con sus dos movimientos, como los deja el módulo. */
function traspasoDe(fecha, monto, origen, destino) {
  const id = db
    .prepare(
      `INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
       VALUES (?, ?, ?, ?, 'Transferencia', 'Aporte ZZ', ?)`
    )
    .run(fecha, origen, destino, monto, iglesia).lastInsertRowid;
  traspasos.hooks.afterSave(db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id), { db });
  return id;
}

const DIA = '2035-04-07';
ofrendaDe(DIA, 100000, 10000);
traspasoDe(DIA, 10000, fondo, corporacion);

/** Lo que ve quien mira TODO lo de ese día (las tres cuentas). */
const TODO = { where: 'WHERE fecha = ? AND cuenta_id IN (?, ?, ?)', params: [DIA, general, fondo, corporacion] };
/** Lo que ve quien mira solo esa iglesia: sus dos cuentas, no la de la corporación. */
const LA_IGLESIA = { where: 'WHERE fecha = ? AND cuenta_id IN (?, ?)', params: [DIA, general, fondo] };

const totales = (q) => entreCuentas.totalesDe(db, q.where, q.params);

/* ------------------------------------------------------- lo que queda marcado */

test('el aporte de una ofrenda queda marcado como traslado, y la ofrenda no', () => {
  const filas = db
    .prepare('SELECT categoria, tipo, monto, entre_cuentas FROM tesoreria WHERE fecha = ? AND servicio_id IS NOT NULL')
    .all(DIA);
  const ofrenda = filas.filter((f) => f.categoria === 'Ofrendas');
  const aporte = filas.filter((f) => f.categoria === 'Aportes');
  assert.equal(ofrenda.length, 1);
  assert.equal(ofrenda[0].entre_cuentas, 0, 'la ofrenda SÍ entró: no es un traslado');
  assert.equal(aporte.length, 2);
  assert.deepEqual([...new Set(aporte.map((f) => f.entre_cuentas))], [1]);
});

test('los dos lados de un traspaso quedan marcados', () => {
  const lados = db
    .prepare('SELECT tipo, entre_cuentas FROM tesoreria WHERE fecha = ? AND traspaso_id IS NOT NULL')
    .all(DIA);
  assert.equal(lados.length, 2);
  assert.deepEqual([...new Set(lados.map((f) => f.entre_cuentas))], [1]);
});

test('editar un traspaso viejo le pone la marca que le faltaba', () => {
  /*
   * El traspaso de arriba ya está anotado. Le sacamos la marca a sus dos
   * movimientos, que es como los dejó la versión anterior, y lo volvemos a
   * guardar: el módulo entra por la rama que ACTUALIZA lo que ya existe, no por
   * la que inserta. Si esa rama no pone la marca, un traspaso viejo que alguien
   * corrige se queda contando como plata que entró, aunque la migración ya haya
   * pasado (una copia de seguridad restaurada, una migración que falló).
   */
  const elTraspaso = db.prepare('SELECT * FROM traspasos WHERE fecha = ?').get(DIA);
  db.prepare('UPDATE tesoreria SET entre_cuentas = 0 WHERE traspaso_id = ?').run(elTraspaso.id);

  traspasos.hooks.afterSave(elTraspaso, { db });

  const lados = db
    .prepare('SELECT id, entre_cuentas FROM tesoreria WHERE traspaso_id = ?')
    .all(elTraspaso.id);
  assert.equal(lados.length, 2, 'volver a guardar no puede duplicar los movimientos');
  assert.deepEqual([...new Set(lados.map((f) => f.entre_cuentas))], [1]);
});

test('un movimiento escrito a mano no es un traslado', () => {
  const id = db
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
       VALUES (?, 'Egreso', 'Compras', 'A mano ZZ', 5000, ?, ?)`
    )
    .run(DIA, general, iglesia).lastInsertRowid;
  const suyo = db.prepare('SELECT entre_cuentas FROM tesoreria WHERE id = ?').get(id);
  assert.ok(!suyo.entre_cuentas, 'un movimiento a mano no puede nacer marcado');
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id);
});

/* ------------------------------------------------------------- las cuentas */

test('lo que entró es lo que entró, no la plata dando vueltas', () => {
  const r = totales(TODO);
  assert.equal(r.ingresos, 100000, 'antes decía 120.000');
  assert.equal(r.egresos, 0);
});

test('y lo que se movió se dice aparte, una sola vez', () => {
  const r = totales(TODO);
  // Dos traslados de $10.000 cada uno: el aporte al fondo y el traspaso a la
  // corporación. Son cuatro movimientos, pero veinte mil pesos movidos, no cuarenta
  assert.equal(r.movido, 20000);
  assert.equal(r.movimientos_entre_cuentas, 4);
  assert.equal(r.movimientos, 5, 'el libro sigue teniendo los cinco movimientos');
});

test('el balance no cambia: lo que se descuenta estaba en los dos lados', () => {
  const r = totales(TODO);
  assert.equal(r.balance, 100000);
  assert.equal(r.balance, r.ingresos - r.egresos);
});

test('mirando UNA iglesia, lo que le traspasó a la corporación sí salió de ella', () => {
  const r = totales(LA_IGLESIA);
  assert.equal(r.ingresos, 100000);
  assert.equal(r.egresos, 10000, 'el traspaso a la corporación tiene un solo lado dentro: salió');
  assert.equal(r.movido, 10000, 'y el aporte al fondo, que tiene los dos lados dentro, no');
  assert.equal(r.balance, 90000, 'a la iglesia le quedaron noventa mil');
});

test('sin ningún traslado, las cifras son las de siempre', () => {
  const soloLaOfrenda = { where: 'WHERE fecha = ? AND cuenta_id = ?', params: [DIA, general] };
  const r = totales(soloLaOfrenda);
  assert.equal(r.ingresos, 100000);
  assert.equal(r.egresos, 10000, 'de la cuenta general salió el aporte');
  assert.equal(r.movido, 0, 'ningún par quedó completo dentro de una sola cuenta');
});

/* --------------------------------------------------------- por categoría */

test('el desglose por categoría dice en qué se gastó, no de dónde a dónde se movió', () => {
  const filas = entreCuentas.porCategoriaDe(db, TODO.where, TODO.params);
  assert.deepEqual(filas.map((f) => `${f.tipo}/${f.categoria}`), ['Ingreso/Ofrendas']);
  assert.equal(filas[0].total, 100000);
});

test('pero el traslado a medias sí sale, que es un egreso de verdad', () => {
  const filas = entreCuentas.porCategoriaDe(db, LA_IGLESIA.where, LA_IGLESIA.params);
  assert.ok(filas.some((f) => f.tipo === 'Egreso' && f.categoria === 'Traspaso'),
    'de la iglesia salieron diez mil y su categoría tiene que decirlo');
});

/* ----------------------------------------------- la marca que viene en blanco */

/*
 * La columna existe desde esta versión. Todo lo anotado antes la tiene nula, y
 * también lo que se escriba sin pasar por el formulario. Nulo tiene que
 * significar exactamente lo mismo que cero: «esto no es un traslado».
 */
function conLaMarcaEnBlanco(concepto, tipo, categoria, monto) {
  const id = db
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, entre_cuentas)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(DIA, tipo, categoria, concepto, monto, general, iglesia).lastInsertRowid;
  return id;
}

test('un movimiento con la marca en blanco sigue apareciendo en el desglose', () => {
  const id = conLaMarcaEnBlanco('Luz y agua ZZ', 'Egreso', 'Servicios básicos', 33000);
  const filas = entreCuentas.porCategoriaDe(db, TODO.where, TODO.params);
  const suya = filas.find((f) => f.categoria === 'Servicios básicos');
  assert.ok(suya, 'sin marca no es lo mismo que ser un traslado: tiene que salir en el desglose');
  assert.equal(suya.total, 33000);
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id);
});

test('y se cuenta como plata que salió, no como plata dando vueltas', () => {
  const id = conLaMarcaEnBlanco('Arriendo ZZ', 'Egreso', 'Arriendos', 50000);
  const r = totales(TODO);
  assert.equal(r.egresos, 50000, 'un egreso sin marca es un egreso');
  assert.equal(r.movido, 20000, 'y no engorda lo movido');
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id);
});

/* ------------------------------------------------------------ lo que ya estaba */

test('lo escrito por la versión anterior queda marcado al migrar', () => {
  db.prepare('UPDATE tesoreria SET entre_cuentas = NULL WHERE fecha = ?').run(DIA);
  db.prepare("DELETE FROM migraciones WHERE nombre = 'los traslados entre cuentas quedan marcados'").run();
  migraciones.losTrasladosQuedanMarcados();

  const r = totales(TODO);
  assert.equal(r.ingresos, 100000, 'sin la marca, el resumen de los meses pasados seguiría inflado');
  assert.equal(r.movido, 20000);
  const laOfrenda = db
    .prepare("SELECT entre_cuentas FROM tesoreria WHERE fecha = ? AND categoria = 'Ofrendas'")
    .get(DIA);
  assert.equal(laOfrenda.entre_cuentas, 0, 'la migración no puede marcar lo que sí entró');
});

/* ------------------------------------------------------------- la pantalla */

test('la pantalla muestra lo movido, y solo cuando hubo algo', () => {
  assert.match(app, /Number\(r\.movido\) > 0 \?/);
  assert.match(app, /Movido entre cuentas/);
});
