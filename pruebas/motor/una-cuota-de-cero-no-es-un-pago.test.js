/**
 * EL ✓ VERDE DE UNA CUOTA QUE NO TIENE PLATA DETRÁS.
 *
 * El campo `monto` de una cuota declaraba `min: 0`, así que el cero pasaba. Lo
 * que quedaba era una cuota registrada, sin movimiento en la caja —el sistema
 * ya sabía que eso no es plata: `sincronizarConLaTesoreria` exige `monto > 0`
 * para anotarla— y con la MISMA marca que una pagada de verdad.
 *
 * MEDIDO en la v1.411.0, dos personas del mismo cuerpo en la planilla de julio:
 *
 *                        casilla   pagado    en la caja
 *   la que pagó ......   ✓         $ 5.000   $ 5.000
 *   la de la cuota 0 .   ✓         $ 0       nada
 *
 * Ese ✓ es lo que alguien mira para saber si una persona está al día. Ahí «pagó»
 * y «no pagó nada» se veían igual, y quien revisara la planilla del año iba a
 * dar por saldado un mes que no lo estaba.
 *
 * Van las dos mitades, como en CU-03: la puerta se cierra —una cuota de $ 0 ya
 * no se registra, y el aviso nombra las dos salidas de verdad— y la pantalla
 * deja de dar por pagadas las que ya estaban anotadas así, que en una base con
 * años de uso siguen ahí.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central CE ${marca}`, `CE-${marca}`).lastInsertRowid;

function unCuerpo() {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, 5000)`
  ).run(`Damas ${++n} CE ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} CE ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga CE ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga CE ${marca}`, iglesia).lastInsertRowid;
}

const enLaCaja = (cuerpo) => db.prepare(
  "SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE cuerpo_id = ? AND tipo = 'Ingreso'"
).get(cuerpo).t;

test('una cuota de $ 0 no se registra, y el aviso dice qué hacer en su lugar', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);

  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 0, fecha_pago: '2026-07-05' });
  assert.equal(r.estado, 400, `antes de esto contestaba 201: ${r.texto}`);
  assert.match(r.json.error, /no es un pago/);
  assert.match(r.json.error, /exenta/, 'la salida de quien no tiene que pagar');
  assert.match(r.json.error, /sin registrar/, 'y la de quien todavía no ha pagado');

  assert.equal(db.prepare('SELECT COUNT(*) c FROM cuotas_cuerpo WHERE integrante_id = ?').get(ficha).c, 0,
    'y no queda anotada a medias');
  assert.equal(enLaCaja(cuerpo), 0);
});

test('una cuota de verdad sigue entrando, y el peso más chico también', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  for (const [monto, quien] of [[5000, unaFicha(cuerpo)], [1, unaFicha(cuerpo)]]) {
    const r = await api('POST', '/cuotas_cuerpo',
      { integrante_id: quien, anio: 2026, mes: '07', monto, fecha_pago: '2026-07-05' });
    assert.equal(r.estado, 201, `$ ${monto}: ${r.texto}`);
  }
  assert.equal(enLaCaja(cuerpo), 5001, 'la regla es «mayor que cero», no «mayor que la cuota»');
});

test('un monto negativo lo sigue parando el motor, con su propio aviso', async () => {
  const api = await elSistemaAndando();
  const ficha = unaFicha(unCuerpo());
  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: ficha, anio: 2026, mes: '07', monto: -5000, fecha_pago: '2026-07-05' });
  assert.equal(r.estado, 400, r.texto);
  assert.match(r.json.error, /negativo/, 'el `min: 0` del campo sigue haciendo su parte');
});

test('corregir a cero una cuota ya anotada tampoco: es el mismo cero', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);
  const puesta = await api('POST', '/cuotas_cuerpo',
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' });
  assert.equal(puesta.estado, 201, puesta.texto);

  const aCero = await api('PUT', `/cuotas_cuerpo/${puesta.json.id}`,
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 0, fecha_pago: '2026-07-05' });
  assert.equal(aCero.estado, 400, aCero.texto);
  assert.equal(enLaCaja(cuerpo), 5000, 'la plata que ya estaba no se movió');

  // Y lo que sí se puede: corregir el monto a otro monto
  const arreglada = await api('PUT', `/cuotas_cuerpo/${puesta.json.id}`,
    { integrante_id: ficha, anio: 2026, mes: '07', monto: 6000, fecha_pago: '2026-07-05' });
  assert.equal(arreglada.estado, 200, arreglada.texto);
  assert.equal(enLaCaja(cuerpo), 6000);
});

test('una cuota vieja anotada en cero se sigue corrigiendo por partes', async () => {
  /*
   * Lo que no se está tocando no se revisa, que es la misma línea del motor.
   * Si no fuera así, una base con ceros de antes dejaría a esas cuotas
   * atascadas: no se les podría ni escribir una nota mientras alguien decide
   * qué hacer con ellas.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);
  const vieja = db.prepare(
    `INSERT INTO cuotas_cuerpo (integrante_id, cuerpo_id, miembro_id, persona, iglesia_id,
                                anio, mes, monto, fecha_pago, metodo)
     VALUES (?, ?, NULL, 'Alguien de antes', ?, 2025, '07', 0, '2025-07-05', 'Efectivo')`
  ).run(ficha, cuerpo, iglesia).lastInsertRowid;

  const conNota = await api('PUT', `/cuotas_cuerpo/${vieja}`, { notas: 'Hay que revisar esta.' });
  assert.equal(conNota.estado, 200, conNota.texto);
  assert.equal(conNota.json.monto, 0, 'sigue en cero: nadie la arregló todavía');

  const arreglada = await api('PUT', `/cuotas_cuerpo/${vieja}`, { monto: 5000 });
  assert.equal(arreglada.estado, 200, arreglada.texto);
  assert.equal(enLaCaja(cuerpo), 5000, 'y al ponerle monto, recién ahí entra a la caja');
});

test('la planilla del cuerpo dibuja distinto una cuota anotada en cero', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderCuotasCuerpo');
  assert.ok(desde > 0, 'se encontró la pantalla de la planilla');
  const pantalla = app.slice(desde, desde + 8000);
  const celda = pantalla.slice(pantalla.indexOf('const pago = f.meses[m.valor];'));
  const hastaElResto = celda.slice(0, celda.indexOf("}).join('')"));

  assert.match(hastaElResto, /!Number\(pago\.monto\)/, 'la mira por su monto, no por si existe');
  assert.match(hastaElResto, /class="mes en-cero"/);
  // La casilla pagada lleva una clase más desde la v1.416.0 —se puede corregir
  // su monto desde acá, hallazgo CU-08— así que se la busca por su comienzo
  const dondeElPagado = hastaElResto.indexOf('class="mes pagado');
  assert.ok(dondeElPagado > 0, 'se encontró la casilla pagada');
  assert.ok(hastaElResto.indexOf('en-cero') < dondeElPagado,
    'primero el cero: si el ✓ va antes, se lo lleva y la distinción no se ve nunca');
  const marcaDelCero = hastaElResto.slice(hastaElResto.indexOf('en-cero'), dondeElPagado);
  assert.ok(!marcaDelCero.includes('✓'), 'y sobre todo: sin el ✓, que es lo que se mira');
  assert.ok(!marcaDelCero.includes('se-puede'),
    'ni se ofrece marcarla desde acá: ya hay una cuota de ese mes y se arregla en su ficha');
});

test('el estilo de esa casilla existe: sin él sale igual que una vacía', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const reglas = css.match(/table\.grid\.cuotas td\.en-cero[^{]*\{/g) || [];
  assert.equal(reglas.length, 1, `reglas encontradas: ${JSON.stringify(reglas)}`);
});
