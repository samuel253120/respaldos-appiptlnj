/**
 * El porcentaje del aporte a la corporación vive CON su servicio.
 *
 * Antes no: el aporte se recalculaba en cada guardado con el porcentaje que
 * rigiera ese día. Medido en la revisión del módulo, y es lo que se vigila acá:
 * un servicio de marzo de $200.000 con el 10% tenía $20.000 de aporte; se cambió
 * el ajuste al 20% y bastó con corregirle LA HORA DE INICIO para que el aporte
 * pasara a $40.000 y los tres movimientos de tesorería de un mes cerrado se
 * reescribieran solos, sin que nadie lo decidiera ni quedara dicho.
 *
 * Lo que se aportó entonces es un hecho. Se anota con el servicio, se ve en la
 * ficha y en la hoja impresa, y se cambia a mano cuando de verdad hay que
 * cambiarlo.
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
const { movimientosDeLaOfrenda } = require('../../server/ofrenda-tesoreria');

/*
 * Los movimientos se buscan POR SU COLUMNA y no por su lugar en la lista: desde
 * la 1.159.0 la ofrenda deja un ingreso más —lo que llegó por transferencia— y
 * el que estaba en el lugar 1 pasó a ser otro. Buscado por su nombre, esto no
 * se vuelve a caer la próxima vez que la lista crezca.
 */
const elDelAporte = (fila) =>
  movimientosDeLaOfrenda(fila, db).find((m) => m.columna === 'movimiento_aporte_id');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Aporte ZZ','SRV-APO','Activa')")
  .run().lastInsertRowid;

/** El porcentaje que rige en toda la organización, como lo pone Configuración. */
const ponerElAjuste = (valor) =>
  db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('ofrenda_porcentaje_fondo', ?)")
    .run(String(valor));

/**
 * Guardar un servicio como lo guarda el motor: primero los campos que se
 * calculan solos, después el gancho del módulo.
 *
 * Se hace así y no llamando al hook a secas porque lo que se está probando es
 * justamente el orden entre las dos cosas: el cálculo mira el porcentaje que ya
 * tiene la ficha, y el gancho se lo pone a la que no tiene ninguno.
 */
const { aplicarCalculos } = require('../../server/crud');
function comoLoGuardaElMotor(data, existing = null) {
  aplicarCalculos(servicios, data, existing);
  const problema = servicios.hooks.beforeSave(data, { existing, db });
  assert.equal(problema, null, String(problema));
  // El gancho puede poner el porcentaje: entonces el cálculo se rehace, igual
  // que lo rehace el motor al guardar de nuevo
  aplicarCalculos(servicios, data, existing);
  return data;
}

test('un servicio nuevo se queda con el porcentaje que rige hoy', () => {
  ponerElAjuste(10);
  const marzo = comoLoGuardaElMotor({
    fecha: '2026-03-08', tipo: 'Servicio General', iglesia_id: iglesia, ofrenda_total: 200000, hora_inicio: '10:00',
  });
  assert.equal(marzo.ofrenda_porcentaje, 10);
  assert.equal(marzo.ofrenda_fondo, 20000);
  assert.equal(marzo.ofrenda_iglesia, 180000);
});

test('cambiar el ajuste no le toca lo que ya aportó, ni corrigiéndole la hora', () => {
  ponerElAjuste(10);
  const guardado = comoLoGuardaElMotor({
    fecha: '2026-03-08', tipo: 'Servicio General', iglesia_id: iglesia, ofrenda_total: 200000, hora_inicio: '10:00',
  });

  ponerElAjuste(20); // la organización cambia el porcentaje

  const corregido = comoLoGuardaElMotor({ hora_inicio: '11:00' }, guardado);
  assert.equal(corregido.ofrenda_fondo, 20000,
    'corregir una hora no puede cambiar cuánto aportó un mes que ya está cerrado');
  assert.equal(corregido.ofrenda_iglesia, 180000);
  ponerElAjuste(10);
});

test('y su movimiento de tesorería sigue diciendo el porcentaje con que se calculó', () => {
  ponerElAjuste(20);
  const viejo = { fecha: '2026-03-08', tipo: 'Servicio General', iglesia_id: iglesia,
    ofrenda_total: 200000, ofrenda_fondo: 20000, ofrenda_porcentaje: 10 };
  const aporte = elDelAporte(viejo);
  assert.match(aporte.concepto, /\(10%\)/,
    'un movimiento que dice «(20%)» sobre un monto calculado al 10% no lo puede cuadrar nadie');
  assert.equal(aporte.monto, 20000);
  ponerElAjuste(10);
});

test('corregir la ofrenda recalcula con el porcentaje del servicio, no con el de hoy', () => {
  ponerElAjuste(10);
  const guardado = comoLoGuardaElMotor({
    fecha: '2026-04-05', tipo: 'Servicio General', iglesia_id: iglesia, ofrenda_total: 200000,
  });
  ponerElAjuste(20);

  const conOtraOfrenda = comoLoGuardaElMotor({ ofrenda_total: 300000 }, guardado);
  assert.equal(conOtraOfrenda.ofrenda_fondo, 30000, 'el 10% de 300.000, que es la regla de ese servicio');
  ponerElAjuste(10);
});

test('cambiarlo a mano en el servicio sí recalcula: es el camino para hacerlo a propósito', () => {
  ponerElAjuste(10);
  const guardado = comoLoGuardaElMotor({
    fecha: '2026-05-03', tipo: 'Servicio General', iglesia_id: iglesia, ofrenda_total: 200000,
  });
  const cambiado = comoLoGuardaElMotor({ ofrenda_porcentaje: 20 }, guardado);
  assert.equal(cambiado.ofrenda_porcentaje, 20);
  assert.equal(cambiado.ofrenda_fondo, 40000);
  assert.match(elDelAporte({ ...guardado, ...cambiado }).concepto, /\(20%\)/);
});

test('el cero es un porcentaje, no un «no tiene»', () => {
  /*
   * Un servicio que no aportó nada aportó cero. Si el cero se tomara por «sin
   * anotar», ese servicio volvería a calcularse con el ajuste de hoy en el
   * próximo guardado: justo lo que se vino a arreglar.
   */
  ponerElAjuste(10);
  const guardado = comoLoGuardaElMotor({
    fecha: '2026-06-07', tipo: 'Servicio Especial', iglesia_id: iglesia,
    ofrenda_total: 200000, ofrenda_porcentaje: 0,
  });
  assert.equal(guardado.ofrenda_fondo, 0);

  ponerElAjuste(30);
  const otraVez = comoLoGuardaElMotor({ hora_inicio: '09:00' }, guardado);
  assert.equal(otraVez.ofrenda_fondo, 0, 'con el 30% de hoy habría quedado en 60.000');
  assert.equal(otraVez.ofrenda_porcentaje, undefined,
    'y no se le pisa el suyo: lo que no se toca es lo que sigue valiendo');
  ponerElAjuste(10);
});

test('la migración le rescata el porcentaje a los servicios que ya estaban', () => {
  /*
   * De los que ya estaban se puede recuperar de los números mismos: el aporte
   * dividido por la ofrenda ES el porcentaje que se usó. Donde no hay ofrenda no
   * hay de dónde sacarlo y se pone el que rige hoy.
   */
  const { elPorcentajeDelAporteQuedaConSuServicio } = require('../../server/migraciones');
  ponerElAjuste(10);
  const meter = db.prepare(
    `INSERT INTO servicios (fecha, tipo, iglesia_id, ofrenda_total, ofrenda_fondo, ofrenda_porcentaje)
     VALUES (?, 'Servicio General', ?, ?, ?, NULL)`
  );
  const alDiez = meter.run('2026-01-04', iglesia, 200000, 20000).lastInsertRowid;
  const alQuince = meter.run('2026-01-11', iglesia, 300000, 45000).lastInsertRowid;
  const sinOfrenda = meter.run('2026-01-18', iglesia, 0, 0).lastInsertRowid;
  db.prepare('DELETE FROM migraciones WHERE nombre = ?').run('el porcentaje del aporte queda con su servicio');

  elPorcentajeDelAporteQuedaConSuServicio();
  const suPorcentaje = (id) => db.prepare('SELECT ofrenda_porcentaje p FROM servicios WHERE id = ?').get(id).p;
  assert.equal(suPorcentaje(alDiez), 10);
  assert.equal(suPorcentaje(alQuince), 15, 'se recupera de la división, no se inventa');
  assert.equal(suPorcentaje(sinOfrenda), 10, 'sin ofrenda no hay de dónde sacarlo: el que rige hoy');
});

test('la hoja impresa dice con qué porcentaje se calculó', () => {
  const hoja = app.slice(app.indexOf('function printServicio('), app.indexOf('function printServicio(') + 2200);
  assert.match(hoja, /Aporte a la corporación\$\{row\.ofrenda_porcentaje/,
    'quien mira la hoja de un servicio viejo tiene que poder ver la regla con que se calculó');
});

test('el porcentaje es un campo que se ve y se puede corregir', () => {
  const campo = servicios.fields.find((f) => f.name === 'ofrenda_porcentaje');
  assert.ok(campo, 'guardarlo escondido no le sirve a nadie: se mira cuando se cuadra el mes');
  assert.ok(!campo.oculto && !campo.readonly, 'y es el camino para recalcular a propósito');
  assert.equal(campo.min, 0);
  assert.equal(campo.max, 100);
});
