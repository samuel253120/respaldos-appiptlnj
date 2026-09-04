/**
 * LA CLASE DE UNA DEUDA SE COMPRUEBA CONTRA LA LISTA QUE OFRECE.
 *
 * El campo trae su lista de una ruta —`/deudas/clases`, que la acota según la
 * dirección— y eso está bien pensado. El motor comprueba las listas ESCRITAS en
 * el módulo, no las que vienen de una ruta, y también con razón: una lista
 * escrita al lado de la ruta sería una segunda verdad, y hay una prueba que lo
 * impide. Entre las dos cosas quedaba un hueco: por la API entraba cualquier
 * texto.
 *
 * MEDIDO en la v1.355.0: clase «Lo Que Sea» contestó 201, se guardó tal cual, y
 * dejó su movimiento de $ 300.000 en la caja. No es cosmético: «Compra a
 * crédito» es la ÚNICA clase que no desembolsa, así que cualquier texto
 * inventado se comporta como un préstamo y mueve la caja.
 *
 * Se comprueba en el módulo, contra las mismas constantes que sirve la ruta: no
 * es una copia, es la misma lista.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const DEUDAS = require('../../server/modules/deudas');

after(cerrarElSistema);

const MARCA = `l${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia de la clase ${MARCA}`, `IG-DL${process.pid}`.slice(0, 12)).lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia', ?, 'Activa', 9000000)`
  ).run(`Caja de la clase ${MARCA}`, iglesia).lastInsertRowid;

const conClase = (api, clase, extra) => api('POST', '/deudas', Object.assign({
  direccion: 'Por pagar', clase, concepto: `Deuda ${clase} ${MARCA}`,
  monto: 300000, fecha: '2026-03-02', cuotas: 1, primera_cuota: '2026-10-05',
  cuenta_id: CAJA, contraparte_tipo: 'Una institución', institucion: 'Banco del Sur',
  estado: 'Vigente',
}, extra));

/* ─────────────────────────── lo que no entra ──────────────────────────── */

test('una clase que no existe no se guarda', async () => {
  const api = await elSistemaAndando();
  const r = await conClase(api, 'Lo Que Sea');

  assert.equal(r.estado, 400, `medido en la v1.355.0: contestaba 201 y guardaba el texto tal cual (${r.texto.slice(0, 160)})`);
  assert.match(r.json.error, /no es una clase de deuda/);
  assert.match(r.json.error, /Préstamo en dinero/, 'y dice cuáles hay, para poder contestarlo');
});

test('y no deja ningún movimiento en la caja', async () => {
  const api = await elSistemaAndando();
  const antes = db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE cuenta_id = ?').get(CAJA).c;
  await conClase(api, 'Préstamo con interés variable');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE cuenta_id = ?').get(CAJA).c, antes,
    'cualquier texto inventado se comportaba como un préstamo y movía la caja'
  );
});

test('la regla de la dirección sigue en pie', async () => {
  const api = await elSistemaAndando();
  const r = await conClase(api, 'Compra a crédito', { direccion: 'Por cobrar' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no vende a plazo/,
    'ésa es una clase que existe, pero no hacia ese lado');
});

/* ──────────────────────────── lo que sí entra ─────────────────────────── */

test('las tres clases de la lista se guardan', async () => {
  const api = await elSistemaAndando();
  for (const clase of DEUDAS.CLASES_POR_PAGAR) {
    const r = await conClase(api, clase);
    assert.equal(r.estado, 201, `«${clase}»: ${r.texto.slice(0, 160)}`);
  }
});

test('lo que se comprueba es lo mismo que ofrece la ruta', async () => {
  /*
   * No son dos listas: es una. Si algún día se separan, la ruta ofrecería algo
   * que el guardado rechaza, y quien lo eligiera del desplegable no entendería
   * nada.
   */
  const api = await elSistemaAndando();
  for (const [direccion, cuales] of [
    ['Por pagar', DEUDAS.CLASES_POR_PAGAR],
    ['Por cobrar', DEUDAS.CLASES_POR_COBRAR],
  ]) {
    const r = await api('GET', `/deudas/clases?direccion=${encodeURIComponent(direccion)}`);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.map((o) => o.id), cuales, `la ruta de «${direccion}»`);
  }
});

/* ───────────── y una ficha vieja no queda imposible de corregir ───────── */

test('una deuda que ya traía una clase rara se sigue pudiendo corregir', async () => {
  /*
   * Es el mismo criterio del motor con los desplegables: se mira lo que ESTE
   * guardado está cambiando. Una ficha que entró por el hueco no puede quedar
   * imposible de guardar por algo que quien le arregla una coma no eligió.
   */
  const api = await elSistemaAndando();
  const creada = await conClase(api, 'Préstamo en dinero', { concepto: `La vieja ${MARCA}` });
  assert.equal(creada.estado, 201, creada.texto.slice(0, 200));
  db.prepare('UPDATE deudas SET clase = ? WHERE id = ?').run('Lo Que Sea', creada.json.id);

  const vieja = (await api('GET', `/deudas/${creada.json.id}`)).json;
  const r = await api('PUT', `/deudas/${creada.json.id}`, { ...vieja, notas: 'una coma' });
  assert.equal(r.estado, 200, `se puede seguir corrigiendo (${r.texto.slice(0, 200)})`);
});

test('pero cambiándosela a otra que tampoco existe, no', async () => {
  const api = await elSistemaAndando();
  const creada = await conClase(api, 'Préstamo en dinero', { concepto: `La que empeora ${MARCA}` });
  const r = await api('PUT', `/deudas/${creada.json.id}`, { ...creada.json, clase: 'Otra Inventada' });
  assert.equal(r.estado, 400, 'la comprobación frena el guardado que empeora las cosas');
});
