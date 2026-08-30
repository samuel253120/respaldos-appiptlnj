/**
 * La cuenta que se vuelve a abrir deja de tener fecha de cierre.
 *
 * Medido: se cerraba con fecha 30-08-2026, se reabría, y quedaba «Activa /
 * 2026-08-30». Y como el campo solo aparece en la ficha cuando el estado es
 * «Cerrada» —que es lo correcto para escribirlo—, desde la pantalla NO HABÍA
 * FORMA DE BORRARLO: para verlo había que volver a cerrar la cuenta. El dato
 * seguía ahí, salía en la planilla que se baja y contradecía al estado que
 * tiene al lado.
 *
 * Peor: al cerrarla de nuevo se quedaba con la fecha vieja, así que la cuenta
 * que se cerró en marzo, se reabrió en junio y se volvió a cerrar en agosto
 * decía marzo. Un dato que se puede escribir y no se puede corregir es peor que
 * no tenerlo.
 *
 * Es lo mismo que hace una solicitud al salir de un estado cerrado con su fecha
 * de respuesta (ver server/modules/solicitudes.js). Y como las cuentas que ya
 * quedaron así no se arreglan solas —nadie puede llegar a ellas—, va también
 * una migración para lo que ya estaba escrito.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');
const { cuentasAbiertasSinFechaDeCierre } = require('../../server/migraciones');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Vuelta','IG-VUEL','Activa')").run().lastInsertRowid;
const abrir = (nombre, estado = 'Activa', fechaCierre = null) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura, fecha_cierre)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, ?, 0, '2020-01-01', ?)`)
  .run(nombre, iglesia, estado, fechaCierre).lastInsertRowid;

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);
const guardar = (id, data) =>
  cuentasMod.hooks.beforeSave(data, { isNew: false, existing: fila(id), id, db, confirmado: true });

const HOY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------- al volver a abrir ----

test('reabrir una cuenta le quita la fecha de cierre', () => {
  const cual = abrir('Proyecto que vuelve de la Vuelta', 'Cerrada', '2026-03-14');
  const data = { estado: 'Activa' };
  assert.equal(guardar(cual, data), null);
  assert.equal(data.fecha_cierre, null,
    'desde la pantalla no había forma de borrarla: el campo solo se ve con la cuenta cerrada');
});

test('y cerrarla de nuevo estampa el día de hoy, no el del cierre anterior', () => {
  const cual = abrir('Proyecto de marzo de la Vuelta', 'Cerrada', '2026-03-14');
  const reabrir = { estado: 'Activa' };
  guardar(cual, reabrir);
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Activa', fecha_cierre = NULL WHERE id = ?").run(cual);

  const cerrar = { estado: 'Cerrada' };
  guardar(cual, cerrar);
  assert.equal(cerrar.fecha_cierre, HOY,
    'la cuenta que se cerró en marzo, se reabrió en junio y se volvió a cerrar en agosto decía marzo');
});

test('a una que sigue cerrada no se le toca la fecha', () => {
  const cual = abrir('Proyecto que sigue cerrado de la Vuelta', 'Cerrada', '2026-03-14');
  const data = { estado: 'Cerrada', descripcion: 'una corrección cualquiera' };
  guardar(cual, data);
  assert.equal(data.fecha_cierre, undefined);
  assert.equal(fila(cual).fecha_cierre, '2026-03-14');
});

test('ni a una que ya estaba abierta: no hay nada que limpiar', () => {
  const cual = abrir('Proyecto siempre abierto de la Vuelta');
  const data = { descripcion: 'sigue andando' };
  guardar(cual, data);
  assert.equal(data.fecha_cierre, undefined, 'un guardado cualquiera no le escribe columnas de más');
});

test('la reapertura queda anotada como cualquier otra corrección', () => {
  /*
   * No es un detalle: limpiar la fecha es BORRAR un dato, y borrar un dato del
   * dinero sin dejar rastro es justo lo que el Registro de Cambios existe para
   * evitar. Se hace escribiendo `data.fecha_cierre = null` y no con un UPDATE
   * aparte, que es lo que hace que el motor lo vea y lo anote: «Fecha de cierre:
   * 14-03-2026 → (vacío)».
   */
  const modulo = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');
  assert.match(modulo, /if \(!quedaCerrada && estabaCerrada\) data\.fecha_cierre = null;/);
  // Y este módulo está entre los vigilados: si no lo estuviera, escribirlo en
  // `data` no serviría de nada porque nadie miraría el antes y el después
  const vigilados = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/bitacora.js'), 'utf8')
    .match(/const MODULOS_VIGILADOS = \[([\s\S]*?)\];/)[1];
  assert.match(vigilados, /'cuentas_tesoreria'/);
});

// ------------------------------------------------- lo que ya estaba escrito ----

test('la migración le quita la fecha a las cuentas abiertas que la arrastran', () => {
  const sueltas = [
    abrir('Vieja abierta 1 de la Vuelta', 'Activa', '2025-04-11'),
    abrir('Vieja abierta 2 de la Vuelta', 'Activa', '2024-11-02'),
  ];
  const cerrada = abrir('Vieja cerrada de la Vuelta', 'Cerrada', '2025-04-11');

  db.prepare("DELETE FROM migraciones WHERE nombre = 'las cuentas abiertas no llevan fecha de cierre'").run();
  cuentasAbiertasSinFechaDeCierre();

  for (const id of sueltas) assert.equal(fila(id).fecha_cierre, null);
  assert.equal(fila(cerrada).fecha_cierre, '2025-04-11', 'la que sí está cerrada conserva la suya');
});

test('y correrla dos veces no cambia nada más', () => {
  const cerrada = abrir('Vieja cerrada otra vez de la Vuelta', 'Cerrada', '2025-04-11');
  db.prepare("DELETE FROM migraciones WHERE nombre = 'las cuentas abiertas no llevan fecha de cierre'").run();
  cuentasAbiertasSinFechaDeCierre();
  cuentasAbiertasSinFechaDeCierre();
  assert.equal(fila(cerrada).fecha_cierre, '2025-04-11');
  assert.ok(
    db.prepare("SELECT nombre FROM migraciones WHERE nombre = 'las cuentas abiertas no llevan fecha de cierre'").get(),
    'y queda marcada como aplicada'
  );
});

test('la migración está en la lista que se corre al arrancar', () => {
  const texto = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/migraciones.js'), 'utf8');
  const lista = texto.match(/function ejecutarMigraciones\(\)[\s\S]*?\n  \];/)[0];
  assert.match(lista, /cuentasAbiertasSinFechaDeCierre/,
    'una migración escrita y no enchufada no arregla nada');
});
