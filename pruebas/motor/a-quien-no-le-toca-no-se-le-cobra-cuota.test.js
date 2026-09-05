/**
 * A QUIEN NO LE TOCA PAGAR NO SE LE COBRA, POR NINGUNA DE LAS DOS PUERTAS.
 *
 * El módulo de cuotas anuncia en su primera línea las maneras de no deber
 * cuota: «el cuerpo entero no cobra» y «un integrante está exento, con su
 * motivo», y dice que «las dos se respetan solas». La tercera es que quien se
 * fue del cuerpo ya no debe nada.
 *
 * Una cuota entra por DOS puertas —la planilla del cuerpo y la ficha suelta— y
 * hasta la v1.409.0 solo la planilla las aplicaba. Medido en la v1.408.0, la
 * misma cuota de julio por las dos:
 *
 *                                  por su ficha    por la planilla
 *   alguien retirado del cuerpo ..  201            400 «ya no pertenece»
 *   alguien exento de la cuota ...  201            400 «está exenta de pagar»
 *   un cuerpo que no cobra .......  201            400 «no cobra cuota mensual»
 *
 * Y no se quedaba en la tabla de cuotas: sobre un cuerpo con su caja en cero,
 * cobrar por la ficha la cuota de una retirada y la de una exenta la dejó en
 * $ 12.000.
 *
 * Ahora la regla vive en server/cuotas.js escrita UNA sola vez y las dos
 * puertas la piden, que es la única forma de que no vuelva a pasar que una
 * sepa lo que la otra no.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const cuotas = require('../../server/cuotas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central CU ${marca}`, `CU-${marca}`).lastInsertRowid;

function unCuerpo({ cobra = 1, cuota = 5000 } = {}) {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', ?, ?)`
  ).run(`Damas ${++n} CU ${marca}`, iglesia, cobra, cuota).lastInsertRowid;
  // Su caja de cuotas, que es donde entra la plata
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} CU ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo, campos = {}) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga CU ${marca}`, iglesia).lastInsertRowid;
  const id = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_retiro, exento_cuota, exento_motivo, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, ?, '2026-01-10', ?, ?, ?, ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga CU ${marca}`, campos.estado || 'Activo',
    campos.fecha_retiro || null, campos.exento_cuota || 0, campos.exento_motivo || null, iglesia).lastInsertRowid;
  return db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(id);
}

const enLaCaja = (cuerpo) => db.prepare(
  "SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE cuerpo_id = ? AND tipo = 'Ingreso'"
).get(cuerpo).t;

// ------------------------------------------------- la regla, sola ----

test('a quien está vigente y no está exento, le toca', () => {
  const ficha = unaFicha(unCuerpo());
  assert.equal(cuotas.aQuienNoSeLeCobra(db, ficha), null);
});

test('a quien se retiró no, y el aviso dice cuándo se fue y cómo devolverlo', () => {
  const ficha = unaFicha(unCuerpo(), { estado: 'Retirado', fecha_retiro: '2026-05-01' });
  const aviso = cuotas.aQuienNoSeLeCobra(db, ficha);
  assert.match(String(aviso), /ya no pertenece/);
  assert.match(String(aviso), /01-05-2026/, 'la fecha se lee como en Chile');
  assert.match(String(aviso), /ficha de integrante/, 'y dice por dónde se arregla');
});

test('a quien está exento no, y el aviso dice su motivo', () => {
  const ficha = unaFicha(unCuerpo(), { exento_cuota: 1, exento_motivo: 'Situación económica' });
  const aviso = cuotas.aQuienNoSeLeCobra(db, ficha);
  assert.match(String(aviso), /exento\(a\)/);
  assert.match(String(aviso), /Situación económica/,
    'el motivo es lo que hace entender por qué, y ya está escrito en su ficha');
});

test('y en un cuerpo que no cobra cuota, a nadie: el aviso lo nombra', () => {
  const cuerpo = unCuerpo({ cobra: 0, cuota: 0 });
  const nombre = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpo).nombre;
  const aviso = cuotas.aQuienNoSeLeCobra(db, unaFicha(cuerpo));
  assert.match(String(aviso), /no cobra cuota mensual/);
  assert.ok(String(aviso).includes(nombre), 'por su nombre, no por su número');
});

test('el aviso nombra a la persona en los dos casos que son suyos', () => {
  const retirada = unaFicha(unCuerpo(), { estado: 'Retirado', fecha_retiro: '2026-05-01' });
  assert.ok(String(cuotas.aQuienNoSeLeCobra(db, retirada)).includes(retirada.persona));
  const exenta = unaFicha(unCuerpo(), { exento_cuota: 1 });
  assert.ok(String(cuotas.aQuienNoSeLeCobra(db, exenta)).includes(exenta.persona));
});

// ------------------------------------------------- las dos puertas ----

test('las dos puertas rechazan lo mismo, con el mismo texto', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const casos = [
    ['retirada', { estado: 'Retirado', fecha_retiro: '2026-05-01' }],
    ['exenta', { exento_cuota: 1, exento_motivo: 'Salud' }],
  ];
  for (const [que, como] of casos) {
    const porFicha = unaFicha(cuerpo, como);
    const porPlanilla = unaFicha(cuerpo, como);

    const f = await api('POST', '/cuotas_cuerpo',
      { integrante_id: porFicha.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' });
    assert.equal(f.estado, 400, `${que} por la ficha: ${f.texto}`);

    const p = await api('POST', `/cuerpos/${cuerpo}/cuotas`,
      { integrante_id: porPlanilla.id, anio: 2026, mes: '07' });
    assert.equal(p.estado, 400, `${que} por la planilla: ${p.texto}`);

    // El mismo texto, porque es la misma regla escrita una sola vez
    const soloElNombre = (t) => String(t).replace(/Quien\d+ Paga CU \d+/, 'ALGUIEN');
    assert.equal(soloElNombre(f.json.error), soloElNombre(p.json.error),
      'dos avisos distintos para la misma regla es la señal de que está escrita dos veces');
  }
});

test('y en un cuerpo que no cobra, tampoco por ninguna', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo({ cobra: 0, cuota: 0 });
  const a = unaFicha(cuerpo);
  const b = unaFicha(cuerpo);
  const f = await api('POST', '/cuotas_cuerpo',
    { integrante_id: a.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' });
  assert.equal(f.estado, 400, f.texto);
  assert.match(f.json.error, /no cobra cuota mensual/);
  const p = await api('POST', `/cuerpos/${cuerpo}/cuotas`, { integrante_id: b.id, anio: 2026, mes: '07' });
  assert.equal(p.estado, 400, p.texto);
});

test('esa plata ya no entra a la caja del cuerpo', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  assert.equal(enLaCaja(cuerpo), 0, 'la caja empieza en cero');
  const retirada = unaFicha(cuerpo, { estado: 'Retirado', fecha_retiro: '2026-05-01' });
  const exenta = unaFicha(cuerpo, { exento_cuota: 1 });
  for (const f of [retirada, exenta]) {
    await api('POST', '/cuotas_cuerpo',
      { integrante_id: f.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' });
  }
  assert.equal(enLaCaja(cuerpo), 0, 'antes de esto quedaba en $ 12.000');
});

test('corregir una cuota ya cobrada sigue siendo posible, aunque la persona ya no esté', async () => {
  /*
   * Cuando se cobró correspondía, y lo que hay que poder arreglar es el monto o
   * la fecha, no la situación de la persona hoy. Es la misma línea que separa
   * el alta de la corrección en todo el sistema.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);

  const cobrada = await api('POST', '/cuotas_cuerpo',
    { integrante_id: ficha.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' });
  assert.equal(cobrada.estado, 201, cobrada.texto);

  db.prepare("UPDATE integrantes_cuerpo SET estado = 'Retirado', fecha_retiro = '2026-08-01' WHERE id = ?")
    .run(ficha.id);

  const corregida = await api('PUT', `/cuotas_cuerpo/${cobrada.json.id}`,
    { integrante_id: ficha.id, anio: 2026, mes: '07', monto: 6000, fecha_pago: '2026-07-05' });
  assert.equal(corregida.estado, 200, corregida.texto);
  assert.equal(corregida.json.monto, 6000);

  const otra = await api('POST', '/cuotas_cuerpo',
    { integrante_id: ficha.id, anio: 2026, mes: '09', monto: 5000, fecha_pago: '2026-09-05' });
  assert.equal(otra.estado, 400, 'pero una nueva no');
});

test('y la importación por planilla, que es la tercera puerta, la pide también', async () => {
  /*
   * No hizo falta escribirla ahí: la importación pasa por el mismo gancho que
   * el formulario, así que la regla le llegó sola. Se comprueba igual, porque
   * es la puerta por la que entran muchas filas de una vez y porque una prueba
   * ajena lo destapó: la que revisa el alcance de la planilla armaba un cuerpo
   * SIN cuota y le metía una, y desde esta versión eso se rechaza.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const retirada = unaFicha(cuerpo, { estado: 'Retirado', fecha_retiro: '2026-05-01' });
  const vigente = unaFicha(cuerpo);

  const r = await api('POST', '/importar/cuotas_cuerpo?prueba=0', {
    prueba: false,
    filas: [
      { integrante_id: vigente.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' },
      { integrante_id: retirada.id, anio: 2026, mes: '07', monto: 5000, fecha_pago: '2026-07-05' },
    ],
  });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.correctas, 1, 'entra la de quien sigue en el cuerpo');
  assert.equal(r.json.conError, 1, 'y no la de quien se fue');
  assert.match(JSON.stringify(r.json.errores), /ya no pertenece/);
});

test('la regla está escrita una sola vez, y las dos puertas la piden', () => {
  const fs = require('fs');
  const path = require('path');
  const compartido = fs.readFileSync(path.join(__dirname, '../../server/cuotas.js'), 'utf8');
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuotas_cuerpo.js'), 'utf8');
  assert.match(compartido, /function aQuienNoSeLeCobra/, 'la regla vive en el sitio compartido');
  assert.match(compartido, /aQuienNoSeLeCobra\(conexion, ficha\)/, 'y la planilla la llama');
  assert.match(modulo, /aQuienNoSeLeCobra\(db, ficha\)/, 'y la ficha suelta también');
  for (const donde of [compartido, modulo]) {
    assert.ok(!/exento_cuota\)\s*return \{ error/.test(donde),
      'ninguna de las dos vuelve a tener su propia copia');
  }
});
