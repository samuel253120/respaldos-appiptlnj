/**
 * El saldo de una cuenta es una cifra del dinero, y se reserva como tal.
 *
 * La llave «Montos del dinero» dice por escrito qué esconde: «los montos de
 * cada movimiento, LOS SALDOS DE LAS CUENTAS y los totales de los informes.
 * Quien no la tenga ve QUÉ se movió y CUÁNDO —la fecha, el concepto, la
 * categoría— pero no cuánto».
 *
 * Cumplía la primera parte y ninguna de las otras dos. Medido sobre la base de
 * trabajo, con un usuario al que se le quitó la llave: el listado de Tesorería
 * le tapaba el monto de cada movimiento, y la pantalla de Cuentas le mostraba
 * $ 58.420.654 de la tesorería general de la corporación; su ficha, lo mismo;
 * su cartola le devolvía las ciento cincuenta filas del mes con su monto y con
 * el saldo corriendo fila a fila —justo las cifras que el listado le acababa de
 * ocultar—; y el balance del período, $ 66.325.975. La llave no quedaba a
 * medias: quedaba anulada, porque la misma plata salía por la puerta de al
 * lado.
 *
 * Eran dos agujeros distintos y acá se vigilan los dos:
 *
 *   1. El SALDO no es una columna —se suma al leer—, y el recorte del motor
 *      solo miraba los campos guardados. Ahora `reservado` vale también para
 *      un campo calculado, en cualquier módulo.
 *   2. Las rutas que arman su propia respuesta —el estado de una cuenta, su
 *      cartola, el resumen y el balance de Tesorería— no pasan por ese
 *      recorte: la cifra la escriben ellas. Para esas está `sinLasCifras`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const sensibles = require('../../server/sensibles');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');
const tesoreriaMod = require('../../server/modules/tesoreria');

const LLAVE = 'tesoreria_montos';

/** El rol como lo guarda la base ('admin'), no su etiqueta. */
const conLlave = { id: 1, rol: 'admin' };
/** El mismo tesorero de siempre, con esa llave quitada y nada más. */
const sinLlave = { id: 2, rol: 'tesorero', permisos: JSON.stringify({ [LLAVE]: [] }) };

// ---------------------------------------------------------------- el motor ----

test('un campo calculado también pertenece a un grupo reservado', () => {
  const def = {
    name: 'inventado', label: 'Inventado',
    fields: [{ name: 'nombre', label: 'Nombre', type: 'text' }],
    computed: [{ name: 'saldo', label: 'Saldo', type: 'money', reservado: LLAVE, calc: () => 1 }],
  };
  const grupos = sensibles.gruposDe(def);
  assert.deepEqual(grupos.get(LLAVE), ['saldo'],
    'sin esto, el saldo se calculaba y se mandaba sin que nadie lo mirara');
});

test('el saldo y el saldo inicial de una cuenta están declarados reservados', () => {
  const grupos = sensibles.gruposDe(cuentasMod);
  assert.deepEqual([...(grupos.get(LLAVE) || [])].sort(), ['saldo', 'saldo_inicial']);
});

test('a quien no alcanza la llave se le quitan las dos, y a quien sí, ninguna', () => {
  const fila = { id: 7, nombre: 'Proyecto templo', ambito: 'Iglesia local', tipo: 'Proyecto / Trabajo',
    estado: 'Activa', saldo_inicial: 400000, saldo: 58420654 };

  const recortada = sensibles.limpiar(cuentasMod, fila, sinLlave);
  assert.equal(recortada.saldo, undefined);
  assert.equal(recortada.saldo_inicial, undefined);
  assert.deepEqual(recortada.reservado_oculto, [LLAVE], 'y la pantalla se entera de que falta algo');
  // Lo que la llave promete dejar a la vista se queda entero
  assert.equal(recortada.nombre, 'Proyecto templo');
  assert.equal(recortada.tipo, 'Proyecto / Trabajo');
  assert.equal(recortada.estado, 'Activa');

  const entera = sensibles.limpiar(cuentasMod, fila, conLlave);
  assert.equal(entera.saldo, 58420654);
  assert.equal(entera.saldo_inicial, 400000);
  assert.equal(entera.reservado_oculto, undefined);
});

test('tampoco lo puede escribir: un saldo inicial que no se ve, no se guarda', () => {
  const datos = { nombre: 'Otra cosa', saldo_inicial: 9000000 };
  sensibles.protegerAlGuardar(cuentasMod, datos, sinLlave, { id: 7 });
  assert.equal(datos.saldo_inicial, undefined,
    'si pudiera, bastaría con abrir la ficha y guardar para correrle el saldo a una cuenta');
  assert.equal(datos.nombre, 'Otra cosa');
});

// --------------------------------------------- las respuestas armadas a mano ----

test('sinLasCifras quita las claves que se le nombran y deja el resto', () => {
  const d = { nombre: 'General', estado: 'Activa', movimientos: 3000, saldo: 58420654, ingresos: 10 };
  const r = sensibles.sinLasCifras(sinLlave, LLAVE, d, ['saldo', 'ingresos']);
  assert.equal(r.saldo, undefined);
  assert.equal(r.ingresos, undefined);
  assert.equal(r.nombre, 'General');
  assert.equal(r.movimientos, 3000, 'cuántos hay se puede decir; cuánta plata, no');
  assert.equal(r.cifras_ocultas, true);
});

test('en una lista de filas les quita la cifra a todas y deja fecha y concepto', () => {
  const d = {
    saldo_final: 100,
    movimientos: [
      { fecha: '2026-08-01', concepto: 'Ofrenda', categoria: 'Ofrendas', monto: 57730, saldo: 1000 },
      { fecha: '2026-08-02', concepto: 'Arriendo', categoria: 'Gastos', monto: 200000, saldo: 800 },
    ],
  };
  const r = sensibles.sinLasCifras(sinLlave, LLAVE, d, ['saldo_final', 'monto', 'saldo', 'movimientos']);
  assert.equal(r.saldo_final, undefined);
  assert.equal(r.movimientos.length, 2, 'la lista no se borra entera: se le quitan las cifras');
  for (const m of r.movimientos) {
    assert.equal(m.monto, undefined);
    assert.equal(m.saldo, undefined);
    assert.ok(m.fecha && m.concepto && m.categoria, 'la fecha, el concepto y la categoría se quedan');
    assert.equal(m.cifras_ocultas, undefined, 'el aviso va una vez, arriba, no fila por fila');
  }
  assert.equal(r.cifras_ocultas, true);
});

test('a quien tiene la llave no se le toca nada', () => {
  const d = { saldo: 58420654, movimientos: [{ fecha: '2026-08-01', monto: 57730 }] };
  const r = sensibles.sinLasCifras(conLlave, LLAVE, d, ['saldo', 'monto', 'movimientos']);
  assert.equal(r, d, 'ni siquiera se copia: se devuelve tal cual');
  assert.equal(r.cifras_ocultas, undefined);
});

// --------------------------------------------------- las rutas de la cuenta ----

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Cifras','IG-CIFRA','Activa')")
  .run().lastInsertRowid;
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES ('General de las Cifras','Iglesia local','General',?,'Activa',50000)`)
  .run(iglesia).lastInsertRowid;
const anotar = (fecha, tipo, monto, concepto) => db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
            VALUES (?,?,'Ofrendas',?,?,?,?)`)
  .run(fecha, tipo, concepto, monto, cuenta, iglesia).lastInsertRowid;
anotar('2026-03-01', 'Ingreso', 300000, 'Ofrenda de marzo');
anotar('2026-03-15', 'Egreso', 100000, 'Cuenta de la luz');

/** Corre una ruta de un módulo sin levantar el servidor. */
function ruta(modulo, cual) {
  let handler = null;
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; } };
  modulo.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next(), scopeClause: () => null });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (req) => {
    let cuerpo = null; let codigo = 200;
    handler(req, { json: (d) => { cuerpo = d; }, status: (c) => { codigo = c; return { json: (d) => { cuerpo = d; } }; } });
    return { codigo, d: cuerpo };
  };
}

const estado = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/estado');
const cartola = ruta(cuentasMod, '/cuentas_tesoreria/:id(\\d+)/cartola');
const resumen = ruta(tesoreriaMod, '/tesoreria/resumen');
const informe = ruta(tesoreriaMod, '/tesoreria/informe');

test('el estado de la cuenta: sin cifras, pero con sus movimientos y su fecha', () => {
  const pedir = (user) => estado({ user, params: { id: String(cuenta) }, query: {} }).d;

  const entero = pedir(conLlave);
  assert.equal(entero.saldo, 250000, '50.000 de partida + 300.000 − 100.000');
  assert.equal(entero.ultimos[0].monto, 100000);

  const recortado = pedir(sinLlave);
  assert.equal(recortado.saldo, undefined);
  assert.equal(recortado.saldo_inicial, undefined);
  assert.equal(recortado.ingresos, undefined);
  assert.equal(recortado.egresos, undefined);
  assert.equal(recortado.cifras_ocultas, true);
  // Lo que la llave deja a la vista
  assert.equal(recortado.nombre, 'General de las Cifras');
  assert.equal(recortado.estado, 'Activa');
  assert.equal(recortado.movimientos, 2, 'cuántos son sí se puede decir');
  assert.equal(recortado.ultimos.length, 2);
  assert.equal(recortado.ultimos[0].fecha, '2026-03-15');
  assert.equal(recortado.ultimos[0].concepto, 'Cuenta de la luz');
  assert.equal(recortado.ultimos[0].monto, undefined, 'ESTA era la puerta: los montos, uno por uno');
});

test('la cartola: las filas se quedan, los pesos se van', () => {
  const pedir = (user) => cartola({ user, params: { id: String(cuenta) }, query: { desde: '2026-01-01', hasta: '2026-12-31' } }).d;

  const entera = pedir(conLlave);
  assert.equal(entera.saldo_final, 250000);
  assert.equal(entera.movimientos.length, 2);
  assert.equal(entera.movimientos[0].saldo, 350000, 'el saldo corriendo fila a fila');

  const recortada = pedir(sinLlave);
  assert.equal(recortada.saldo_anterior, undefined);
  assert.equal(recortada.saldo_final, undefined);
  assert.equal(recortada.ingresos, undefined);
  assert.equal(recortada.egresos, undefined);
  assert.equal(recortada.saldo_inicial, undefined);
  assert.equal(recortada.cifras_ocultas, true);
  assert.equal(recortada.movimientos.length, 2, 'la hoja sigue diciendo QUÉ se movió y CUÁNDO');
  assert.equal(recortada.movimientos[0].concepto, 'Ofrenda de marzo');
  assert.equal(recortada.movimientos[0].categoria, 'Ofrendas');
  assert.equal(recortada.movimientos[0].monto, undefined);
  assert.equal(recortada.movimientos[0].saldo, undefined);
  assert.equal(recortada.cuenta.nombre, 'General de las Cifras');
});

test('el resumen y el balance de Tesorería: los conteos quedan, los totales no', () => {
  const entero = resumen({ user: conLlave, query: {} }).d;
  assert.ok(Number(entero.ingresos) > 0);

  const recortado = resumen({ user: sinLlave, query: {} }).d;
  assert.equal(recortado.ingresos, undefined);
  assert.equal(recortado.egresos, undefined);
  assert.equal(recortado.balance, undefined);
  assert.ok(Number(recortado.movimientos) > 0, 'cuántos movimientos hay no es una cifra del dinero');
  assert.equal(recortado.cifras_ocultas, true);
  for (const c of recortado.porCuenta) {
    assert.ok(c.nombre, 'la cuenta se nombra…');
    assert.equal(c.saldo, undefined, '…pero sin su saldo');
  }

  const balance = informe({ user: sinLlave, query: { desde: '2026-01-01', hasta: '2026-12-31' } }).d;
  assert.equal(balance.resumen, undefined, 'el papel del balance es, entero, un total');
  assert.equal(balance.cifras_ocultas, true);
  for (const m of balance.porMes || []) assert.equal(m.ingresos, undefined);
});

// ------------------------------------------------ las otras dos ventanas ----

const servidor = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

test('el panel pide las dos llaves: ver Tesorería y ver sus montos', () => {
  assert.match(
    servidor,
    /if \(can\(req\.user, 'tesoreria', 'view'\) && can\(req\.user, 'tesoreria_montos', 'view'\)\)/,
    'el panel abría con los ingresos del mes, los egresos y el balance histórico'
  );
});

test('/api/meta le cuenta al navegador que un calculado es reservado', () => {
  assert.match(servidor, /\(m\.computed \|\| \[\]\)\.map\(\(\{[^}]*reservado[^}]*\}\)/,
    'la lista de propiedades de /api/meta es cerrada: lo que no se nombra ahí, no llega');
  assert.match(servidor, /reservado: reservado \|\| null,[\s\S]{0,400}ordenable: !!ordenarPor/);
});

test('la pantalla lo dice en vez de dibujar el rótulo con el número en blanco', () => {
  assert.match(app, /const sinCifras = \(d\) => !!\(d && d\.cifras_ocultas\)/);
  assert.match(app, /AVISO_SIN_CIFRAS/);
  // Las cuatro pantallas de plata que arman su propia respuesta
  const veces = (app.match(/sinCifras\(/g) || []).length;
  assert.ok(veces >= 8, `sinCifras se usa ${veces} veces: el estado, la cartola, la tira y el balance`);
  // Y una celda reservada del listado se dice, no se deja vacía
  assert.match(app, /if \(estaReservado\(f, row\)\) return '<span class="mut" title="Reservado/);
});
