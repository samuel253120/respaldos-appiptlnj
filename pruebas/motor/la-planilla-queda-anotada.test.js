/**
 * EL REGISTRO DE CAMBIOS TIENE QUE PODER DECIR QUE HUBO UNA IMPORTACIÓN.
 *
 * Cada fila importada dejaba su línea —eso costó ponerlo y está bien— pero
 * dejaba EXACTAMENTE la misma línea que dejaría alguien escribiendo esa ficha a
 * mano. Medido en la v1.386.0 con 40 movimientos de tesorería importados de una
 * vez: 40 líneas «Creación / Tesorería», y ninguna que dijera de dónde salieron.
 *
 * El Registro de Cambios existe para responder quién tocó el dinero. Ante
 * cuarenta ingresos idénticos de un mismo día contestaba cuarenta veces «los
 * creó la tesorera» y no podía contestar lo que de verdad se pregunta en una
 * revisión de cuentas: ¿esto se anotó uno por uno, o entró un archivo? Un
 * archivo se puede haber subido dos veces, o ser el equivocado.
 *
 * Son dos cosas y las dos hacen falta: la línea de la importación —cuántas
 * filas traía y cuántas entraron— y la marca en la línea de cada ficha, que
 * contesta lo mismo mirando una sola.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central PA ${marca}`, `PA-${marca}`).lastInsertRowid;
const cuenta = db.prepare(
  `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
   VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, 'Activa', 9000000, '2020-01-01')`)
  .run(`Caja PA ${marca}`, iglesia).lastInsertRowid;
const categoria = db.prepare("SELECT nombre FROM categorias_tesoreria WHERE tipo = 'Ingreso' LIMIT 1").get().nombre;

const desdeAqui = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
const loAnotado = (desde) => db
  .prepare('SELECT * FROM registro_cambios WHERE id > ? AND modulo = ? ORDER BY id')
  .all(desde, getModule('tesoreria').label)
  .filter((l) => (l.detalle || '').includes(`PA ${marca}`) || l.accion === 'Importación');

const movimiento = (i) => ({
  fecha: '12/03/2026', tipo: 'Ingreso', categoria,
  concepto: `Diezmo PA ${marca}-${i}`, monto: String(5000 + i), cuenta_id: String(cuenta),
});

test('una importación deja su propia línea, además de la de cada ficha', async () => {
  const api = await elSistemaAndando();
  const desde = desdeAqui();
  const r = await api('POST', '/importar/tesoreria', {
    prueba: false, filas: [movimiento(1), movimiento(2), movimiento(3)],
  });
  assert.equal(r.json.correctas, 3, JSON.stringify(r.json).slice(0, 300));

  const lineas = loAnotado(desde);
  const laDeLaPlanilla = lineas.filter((l) => l.accion === 'Importación');
  assert.equal(laDeLaPlanilla.length, 1, `una sola línea de importación: ${JSON.stringify(lineas.map((l) => l.accion))}`);
  assert.match(laDeLaPlanilla[0].detalle, /3 fila\(s\)/, 'tiene que decir cuántas traía');
  assert.match(laDeLaPlanilla[0].registro, /3 de 3/);
  assert.ok(laDeLaPlanilla[0].usuario, 'y quién la subió');
});

test('y cada ficha que entró lo dice en su propia línea', async () => {
  const api = await elSistemaAndando();
  const desde = desdeAqui();
  await api('POST', '/importar/tesoreria', { prueba: false, filas: [movimiento(11), movimiento(12)] });

  const creaciones = loAnotado(desde).filter((l) => l.accion === 'Creación');
  assert.equal(creaciones.length, 2);
  for (const l of creaciones) {
    assert.match(l.detalle, /^Por planilla · /,
      'sin esto la línea es idéntica a la de alguien que la escribió a mano');
    assert.match(l.detalle, /Monto/, 'y sigue diciendo lo que decía la ficha');
  }
});

test('lo escrito a mano no dice «Por planilla»', async () => {
  const api = await elSistemaAndando();
  const desde = desdeAqui();
  const r = await api('POST', '/tesoreria', {
    fecha: '2026-03-12', tipo: 'Ingreso', categoria,
    concepto: `A mano PA ${marca}`, monto: 7000, cuenta_id: cuenta,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  const creaciones = loAnotado(desde).filter((l) => l.accion === 'Creación');
  assert.equal(creaciones.length, 1);
  assert.doesNotMatch(creaciones[0].detalle, /Por planilla/);
});

test('un archivo cuyas filas se rechazaron todas no anota ninguna importación', async () => {
  const api = await elSistemaAndando();
  const desde = desdeAqui();
  const r = await api('POST', '/importar/tesoreria', {
    prueba: false,
    filas: [{ ...movimiento(31), monto: 'no es un número' }, { ...movimiento(32), monto: 'tampoco' }],
  });
  assert.equal(r.json.correctas, 0, JSON.stringify(r.json).slice(0, 200));
  assert.deepEqual(loAnotado(desde), [], 'no entró nada: no hay importación que anotar');
});

test('una revisión previa no anota ninguna importación: no la hubo', async () => {
  const api = await elSistemaAndando();
  const desde = desdeAqui();
  const r = await api('POST', '/importar/tesoreria', { prueba: true, filas: [movimiento(21)] });
  assert.equal(r.json.correctas, 1);
  assert.deepEqual(loAnotado(desde), [], 'la revisión se deshace entera, y la línea con ella');
});

// ------------------------------- lo que se puede filtrar es lo que se escribe

test('toda acción que el sistema escribe se puede filtrar en el Registro de Cambios', () => {
  const fs = require('fs');
  const path = require('path');
  const dentro = (carpeta) => fs.readdirSync(carpeta, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? dentro(path.join(carpeta, e.name))
      : e.name.endsWith('.js') ? [path.join(carpeta, e.name)] : []));

  const escritas = new Set();
  for (const archivo of dentro(path.join(__dirname, '../../server'))) {
    const fuente = fs.readFileSync(archivo, 'utf8');
    for (const m of fuente.matchAll(/accion:\s*'([^']+)'/g)) escritas.add(m[1]);
    for (const m of fuente.matchAll(/,\s*'(Importación)',\s*\?/g)) escritas.add(m[1]);
  }
  assert.ok(escritas.size >= 10, `algo cambió en cómo se escriben: ${[...escritas]}`);

  const ofrecidas = getModule('registro_cambios').fields.find((f) => f.name === 'accion').options;
  const faltan = [...escritas].filter((a) => !ofrecidas.includes(a));
  assert.deepEqual(faltan, [],
    'lo que no está en la lista no se puede buscar, aunque se vea en la tabla');
});
