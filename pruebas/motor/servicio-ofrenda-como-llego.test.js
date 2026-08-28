/**
 * La ofrenda entra a Tesorería como llegó.
 *
 * Los tres movimientos que un servicio dejaba se anotaban con método
 * «Efectivo», escrito fijo. Medido en la revisión del módulo: los tres, el
 * ingreso de la ofrenda y los dos del aporte. Con parte de la ofrenda llegando
 * por transferencia —cada vez más— el libro de la iglesia decía que había
 * entrado en efectivo, y cuadrarlo con la cartola del banco no salía.
 *
 * Se pregunta solo lo que hace falta: cuánto llegó al banco. El efectivo es el
 * resto y se calcula solo, así que el reparto cuadra por construcción.
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
const { aplicarCalculos } = require('../../server/crud');
const { movimientosDeLaOfrenda, sincronizarOfrenda } = require('../../server/ofrenda-tesoreria');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Banco ZZ','SRV-BCO','Activa')")
  .run().lastInsertRowid;
db.prepare(
  "INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial) VALUES (?,?,?,?,?,0)"
).run(`General ${iglesia} ZZ`, 'Iglesia', 'General', iglesia, 'Activa');
db.prepare(
  "INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial) VALUES (?,?,?,?,?,0)"
).run(`Fondo ${iglesia} ZZ`, 'Iglesia', 'Fondo para la corporación', iglesia, 'Activa');

const base = { fecha: '2033-06-05', tipo: 'Servicio General', iglesia_id: iglesia };
const cual = (fila, columna) => movimientosDeLaOfrenda(fila, db).find((m) => m.columna === columna);

/** Un servicio como lo deja el motor: primero los cálculos, después el gancho. */
function comoLoGuardaElMotor(data) {
  const fila = { ...base, ...data };
  aplicarCalculos(servicios, fila, null);
  const problema = servicios.hooks.beforeSave(fila, { existing: null, db });
  aplicarCalculos(servicios, fila, null);
  return { fila, problema };
}

/* -------------------------------------------------------------- el reparto */

test('lo que llegó al banco se anota, y el efectivo es el resto', () => {
  const { fila } = comoLoGuardaElMotor({ ofrenda_total: 200000, ofrenda_transferencia: 30000 });
  assert.equal(fila.ofrenda_efectivo, 170000);
});

test('sin nada por transferencia, todo es efectivo', () => {
  const { fila } = comoLoGuardaElMotor({ ofrenda_total: 100000 });
  assert.equal(fila.ofrenda_efectivo, 100000);
});

test('no puede llegar al banco más que la ofrenda entera', () => {
  const { problema } = comoLoGuardaElMotor({ ofrenda_total: 200000, ofrenda_transferencia: 250000 });
  // Esto se corrige, no se pregunta: no es un dato raro sino una resta que no da
  assert.equal(typeof problema, 'string');
  assert.match(problema, /Por transferencia llegaron \$250\.000 y la ofrenda total dice \$200\.000/);
});

/* ------------------------------------------------ cómo queda en Tesorería */

test('la ofrenda deja dos ingresos, cada uno con su método', () => {
  const fila = { ...base, ofrenda_total: 200000, ofrenda_transferencia: 30000, ofrenda_fondo: 20000 };
  const efectivo = cual(fila, 'movimiento_iglesia_id');
  const banco = cual(fila, 'movimiento_transferencia_id');
  assert.equal(efectivo.metodo, 'Efectivo');
  assert.equal(efectivo.monto, 170000);
  assert.equal(banco.metodo, 'Transferencia');
  assert.equal(banco.monto, 30000);
});

test('y el de la transferencia se distingue en el concepto', () => {
  const fila = { ...base, ofrenda_total: 200000, ofrenda_transferencia: 30000 };
  assert.match(cual(fila, 'movimiento_transferencia_id').concepto, /\(por transferencia\)$/);
  assert.ok(!/por transferencia/.test(cual(fila, 'movimiento_iglesia_id').concepto));
});

test('el par del aporte va como «Otro»: no entra ni sale de la iglesia', () => {
  const fila = { ...base, ofrenda_total: 200000, ofrenda_fondo: 20000 };
  assert.equal(cual(fila, 'movimiento_aporte_id').metodo, 'Otro');
  assert.equal(cual(fila, 'movimiento_fondo_id').metodo, 'Otro');
});

test('un servicio de antes del reparto deja su ingreso completo en efectivo', () => {
  // La columna en blanco es lo que tienen todos los servicios ya registrados
  const viejo = { ...base, ofrenda_total: 150000, ofrenda_transferencia: null };
  assert.equal(cual(viejo, 'movimiento_iglesia_id').monto, 150000);
  assert.equal(cual(viejo, 'movimiento_transferencia_id').monto, 0);
});

/* ------------------------------------------------- lo que queda en la base */

test('el ingreso por transferencia se escribe en Tesorería con su método', () => {
  const id = db
    .prepare(
      `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_transferencia,
                              ofrenda_fondo, ofrenda_iglesia)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run('2033-06-12', 'Servicio General', iglesia, 200000, 30000, 20000, 180000).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
  sincronizarOfrenda(fila, db);

  const puestos = db
    .prepare('SELECT tipo, monto, metodo, concepto FROM tesoreria WHERE servicio_id = ? ORDER BY monto DESC')
    .all(id);
  assert.equal(puestos.length, 4, 'tienen que ser cuatro: dos ingresos de ofrenda y el par del aporte');
  const porBanco = puestos.find((m) => m.metodo === 'Transferencia');
  assert.equal(porBanco.monto, 30000);
  assert.equal(puestos.filter((m) => m.metodo === 'Efectivo').length, 1);
  assert.equal(puestos.filter((m) => m.metodo === 'Otro').length, 2);
});

test('corregir cómo llegó corrige el método del movimiento, no solo el monto', () => {
  /*
   * El método iba solo en el INSERT y no en el UPDATE: corregirle a un servicio
   * lo que llegó por transferencia le arreglaba el monto al movimiento y le
   * dejaba el método viejo, que es justo lo que se vino a arreglar.
   */
  const id = db
    .prepare(
      `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_fondo, ofrenda_iglesia)
       VALUES (?,?,?,?,?,?)`
    )
    .run('2033-06-19', 'Servicio General', iglesia, 100000, 10000, 90000).lastInsertRowid;
  sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id), db);
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM tesoreria WHERE servicio_id = ? AND metodo = 'Efectivo'").get(id).c, 1
  );

  // Ahora resulta que esos cien mil habían llegado al banco
  db.prepare('UPDATE servicios SET ofrenda_transferencia = 100000 WHERE id = ?').run(id);
  sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id), db);

  const quedaron = db.prepare('SELECT monto, metodo FROM tesoreria WHERE servicio_id = ? AND categoria = ?')
    .all(id, 'Ofrendas');
  assert.equal(quedaron.length, 1, 'el ingreso en efectivo tenía que retirarse');
  assert.equal(quedaron[0].metodo, 'Transferencia');
  assert.equal(quedaron[0].monto, 100000);
});

test('un movimiento escrito por la versión anterior se corrige al volver a guardar', () => {
  /*
   * El método iba solo en el INSERT y no en el UPDATE, y con eso no se caía
   * ninguna prueba: el método de cada movimiento no cambia nunca —el de la
   * columna del efectivo es siempre «Efectivo»— así que el camino del UPDATE
   * parecía no servir para nada. Sí sirve, y para lo único que importa: los
   * movimientos que YA ESTÁN escritos, que llevan el «Efectivo» fijo de antes.
   * Al volver a guardar su servicio se ponen al día, como ya pasaba con el
   * monto y el concepto. Lo que no se toca es lo que nadie vuelve a guardar.
   */
  const id = db
    .prepare(
      `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_fondo, ofrenda_iglesia)
       VALUES (?,?,?,?,?,?)`
    )
    .run('2033-06-26', 'Servicio General', iglesia, 100000, 10000, 90000).lastInsertRowid;
  sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id), db);

  // Como los dejaba la versión anterior: los tres con «Efectivo»
  db.prepare("UPDATE tesoreria SET metodo = 'Efectivo' WHERE servicio_id = ?").run(id);
  sincronizarOfrenda(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id), db);

  const delAporte = db
    .prepare("SELECT metodo FROM tesoreria WHERE servicio_id = ? AND categoria = 'Aportes'")
    .all(id);
  assert.equal(delAporte.length, 2);
  assert.deepEqual([...new Set(delAporte.map((m) => m.metodo))], ['Otro'],
    'el par del aporte tenía que quedar al día, y quedó con el método viejo');
});

/* ------------------------------------------------------------- la pantalla */

test('la hoja impresa muestra el reparto solo cuando lo hay', () => {
  const trozo = app.slice(app.indexOf('function printServicio'));
  assert.match(trozo.slice(0, 3000), /Number\(row\.ofrenda_transferencia\) > 0 \?/);
  assert.match(trozo.slice(0, 3000), /fila\('Por transferencia', fmtMoney\(row\.ofrenda_transferencia\)\)/);
});

test('el campo dice para qué sirve: cuadrar con la cartola', () => {
  const campo = servicios.fields.find((f) => f.name === 'ofrenda_transferencia');
  assert.equal(campo.min, 0);
  assert.match(campo.help, /cartola/);
  const efectivo = servicios.fields.find((f) => f.name === 'ofrenda_efectivo');
  assert.equal(efectivo.readonly, true);
  assert.deepEqual(efectivo.calcula, { tipo: 'resta', campos: ['ofrenda_total', 'ofrenda_transferencia'] });
});
