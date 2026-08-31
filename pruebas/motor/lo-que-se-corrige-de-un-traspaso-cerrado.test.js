/**
 * Una cuenta cerrada congela la plata del traspaso, no su redacción.
 *
 * «Cerrada» frenaba el traspaso ENTERO. Medido sobre uno anotado con «Diezmo de
 * mazo» cuya cuenta de origen se cerró después:
 *
 *   corregir «mazo» → «marzo» .................. 400
 *   anotar el n.º de la transferencia .......... 400
 *   dejar una nota ............................. 400
 *   pero ELIMINARLO entero ..................... 200
 *
 * O sea: se impedía corregir una falta de ortografía y se permitía borrar el
 * registro completo, que es lo único de los cuatro que mueve plata. Y no había
 * salida: para corregir el concepto habría que borrarlo y volver a anotarlo,
 * pero volver a anotarlo también está bloqueado por la cuenta cerrada. El dato
 * se perdía o se quedaba mal escrito para siempre.
 *
 * Es la misma distinción que la 1.216.0 hizo en la ficha de una cuenta cerrada:
 * se congela lo que mueve plata —ahí el saldo inicial, acá la fecha, el monto y
 * las dos cuentas— y lo demás se sigue corrigiendo, porque es historia y la
 * historia se escribe bien.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const traspasosMod = require('../../server/modules/traspasos');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Redacción','IG-RED','Activa')").run().lastInsertRowid;

let n = 0;
const cuenta = (estado = 'Activa') => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, ?, 900000, '2020-01-01')`)
  .run(`Caja ${++n} de la Redacción`, iglesia, estado).lastInsertRowid;

const traspaso = (origen, destino) => {
  const id = db
    .prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, referencia, notas, iglesia_id)
              VALUES ('2026-05-05', ?, ?, 200000, 'Transferencia', 'Diezmo de mazo', '', '', ?)`)
    .run(origen, destino, iglesia).lastInsertRowid;
  return db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id);
};
const cerrar = (id) => db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(id);

/** Corre el gancho como lo corre el motor, sobre un traspaso que ya existe. */
const editar = (fila, cambio) => traspasosMod.hooks.beforeSave({ ...cambio },
  { user: { id: 1, rol: 'admin', iglesias: [], cuerpos: [] }, existing: fila, db, confirmado: true });
const crear = (data) => traspasosMod.hooks.beforeSave(data,
  { user: { id: 1, rol: 'admin', iglesias: [], cuerpos: [] }, existing: null, db, confirmado: true });

// ------------------------------------------ lo que es cómo quedó escrito ----

test('con la cuenta cerrada se sigue corrigiendo la redacción del traspaso', () => {
  const origen = cuenta();
  const tr = traspaso(origen, cuenta());
  cerrar(origen);

  assert.equal(editar(tr, { concepto: 'Diezmo de marzo' }), null, 'la falta de ortografía');
  assert.equal(editar(tr, { referencia: 'TR-99881' }), null, 'el n.º de la transferencia que faltaba');
  assert.equal(editar(tr, { notas: 'lo revisó la tesorera' }), null, 'una nota');
  assert.equal(editar(tr, { forma: 'Cheque' }), null,
    'la forma corrige cómo se pagó, no cuánto ni cuándo');
  assert.equal(editar(tr, { comprobante: 'boleta.pdf' }), null, 'y el comprobante que faltaba');
});

test('y un guardado que no toca nada de eso tampoco se frena', () => {
  const destino = cuenta();
  const tr = traspaso(cuenta(), destino);
  cerrar(destino);
  assert.equal(editar(tr, {}), null);
});

// --------------------------------------------------- lo que es la plata ----

test('pero la plata no se mueve: ni el monto, ni la fecha, ni las cuentas', () => {
  const origen = cuenta();
  const tr = traspaso(origen, cuenta());
  cerrar(origen);

  for (const [rot, cambio] of [
    ['el monto', { monto: 500000 }],
    ['la fecha', { fecha: '2026-05-06' }],
    ['la cuenta de origen', { cuenta_origen_id: cuenta() }],
    ['la de destino', { cuenta_destino_id: cuenta() }],
  ]) {
    const r = editar(tr, cambio);
    assert.equal(typeof r, 'string', `${rot} tendría que frenarse; devolvió ${JSON.stringify(r)}`);
    assert.match(r, /está cerrada/);
  }
});

test('sacarle el traspaso a la cerrada cambiándole el origen es sacarle la plata', () => {
  /*
   * Se miran las cuentas de ANTES y las de DESPUÉS. Mirando solo las nuevas,
   * mover el origen de la cerrada a una abierta pasaría: y eso le quita a la
   * cuenta cerrada su egreso, que es exactamente lo mismo que borrarlo.
   */
  const cerradaId = cuenta();
  const tr = traspaso(cerradaId, cuenta());
  cerrar(cerradaId);
  const abierta = cuenta();
  assert.match(String(editar(tr, { cuenta_origen_id: abierta })), /está cerrada/);
});

test('y METERLE un traspaso a una cuenta cerrada cambiándole el destino, tampoco', () => {
  /*
   * El otro lado del mismo par, y el que se me había escapado: las dos cuentas
   * de este traspaso están abiertas, y el guardado apunta a una CERRADA. Si
   * solo se miraran las cuentas de antes, esto pasaría y le metería plata a una
   * cuenta cerrada por la puerta de la edición —justo lo que el traspaso nuevo
   * tiene prohibido—.
   */
  const tr = traspaso(cuenta(), cuenta());
  const cerradaId = cuenta();
  cerrar(cerradaId);
  assert.match(String(editar(tr, { cuenta_destino_id: cerradaId })), /está cerrada/);
  assert.match(String(editar(tr, { cuenta_origen_id: cerradaId })), /está cerrada/);
});

test('con las dos cerradas las nombra a las dos', () => {
  const origen = cuenta();
  const destino = cuenta();
  const tr = traspaso(origen, destino);
  cerrar(origen);
  cerrar(destino);
  const r = editar(tr, { monto: 1 });
  assert.match(r, /Las cuentas .* y .* están cerradas/);
});

test('el aviso dice qué SÍ se puede corregir y cuál es la salida', () => {
  const origen = cuenta();
  const tr = traspaso(origen, cuenta());
  cerrar(origen);
  const r = editar(tr, { monto: 1 });
  assert.match(r, /el concepto, el número de operación, la forma, el comprobante y las notas/,
    'un aviso que solo dice «no» deja a la persona sin saber qué hacer');
  assert.match(r, /vuelva a abrir la cuenta, corríjalo y ciérrela de nuevo/,
    'la salida escrita, igual que en la ficha de la cuenta cerrada');
});

// -------------------------------------------- lo que no cambió de antes ----

test('un traspaso NUEVO con una cuenta cerrada sigue rechazándose, por los dos lados', () => {
  const cerradaId = cuenta();
  cerrar(cerradaId);
  const abierta = cuenta();
  const base = { fecha: '2026-05-05', monto: 1000, forma: 'Efectivo', concepto: 'nuevo' };
  assert.match(String(crear({ ...base, cuenta_origen_id: cerradaId, cuenta_destino_id: abierta })),
    /no puede salir dinero de ella/);
  assert.match(String(crear({ ...base, cuenta_origen_id: abierta, cuenta_destino_id: cerradaId })),
    /no puede entrar dinero en ella/);
});

test('y entre dos cuentas abiertas se sigue editando todo', () => {
  const tr = traspaso(cuenta(), cuenta());
  assert.equal(editar(tr, { monto: 7000, fecha: '2026-05-09' }), null);
});

// -------------------------------------------------------- dónde está ----

test('lo que es la plata está nombrado en un solo lugar', () => {
  const fs = require('fs');
  const path = require('path');
  const texto = fs.readFileSync(path.join(__dirname, '../../server/modules/traspasos.js'), 'utf8');
  const lista = texto.match(/const LO_QUE_ES_LA_PLATA = \[([^\]]+)\]/);
  assert.ok(lista, 'la lista tiene que ser una sola y tener nombre');
  const campos = lista[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  assert.deepEqual(campos, ['cuenta_destino_id', 'cuenta_origen_id', 'fecha', 'monto'],
    'cuándo, cuánto y entre qué cuentas: eso es la plata, y nada más');
});
