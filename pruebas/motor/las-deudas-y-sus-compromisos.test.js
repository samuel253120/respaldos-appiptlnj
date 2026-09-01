/**
 * Lo que la organización debe, que hasta la 1.247.0 no vivía en ninguna parte.
 *
 * Tesorería lleva el MOVIMIENTO de la plata y lo lleva bien; lo que faltaba era
 * el otro lugar, el de lo que está comprometido. Medido antes de esto, sobre el
 * sistema andando y siguiendo dos casos reales de la corporación:
 *
 *   un préstamo de $ 400.000 que entra y se devuelve
 *     → el balance de la reunión decía «entraron $ 1.400.000, salieron
 *       $ 1.400.000» donde la iglesia reunió y gastó un millón;
 *     → la caja de un cuerpo con $ 150.000 prestados decía tenerlos propios.
 *
 *   sillas por $ 500.000 en seis cuotas
 *     → anotar la compra entera dejaba la caja en $ -366.666;
 *     → anotar solo las cuotas dejaba el compromiso invisible: pagadas dos de
 *       seis, el sistema no sabía cuánto se debía ni con quién.
 *
 * Esta prueba cubre la ficha de la deuda y sus reglas. El plan de cuotas, que
 * los informes la cuenten aparte, el aviso del panel y la hoja impresa vienen
 * en las versiones siguientes.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { can, LLAVES, MATRIX } = require('../../server/permissions');
const tesorerias = require('../../server/tesorerias');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const DEUDAS = getModule('deudas');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una caja de la iglesia, o de un cuerpo si se le pasa uno. */
const caja = (nombre, { cuerpoId = null, iglesiaId = 1, estado = 'Activa' } = {}) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial)
            VALUES (?, ?, ?, ?, 'Proyecto / Trabajo', ?, 0)`)
  .run(`${nombre} Deuda ${marca()}`, cuerpoId ? 'Cuerpo / Grupo' : 'Iglesia local', iglesiaId, cuerpoId, estado)
  .lastInsertRowid;

const ADMIN = { id: 1, rol: 'admin' };
const SIN_LLAVE = { id: 2, rol: 'tesorero', permisos: JSON.stringify({ deudas_cerrar: [] }) };

const laDeuda = (extra = {}) => ({
  direccion: 'Por pagar', clase: 'Préstamo en dinero', concepto: `Deuda ${marca()}`,
  monto: 100000, fecha: '2026-08-01', contraparte_tipo: 'Una persona', contraparte: 'Juan Pérez',
  estado: 'Vigente', ...extra,
});

const alGuardar = (data, { existing = null, user = ADMIN } = {}) =>
  DEUDAS.hooks.beforeSave(data, { user, existing, db, isNew: !existing, id: existing ? existing.id : null });

// ------------------------------------------------------------ la ficha ----

test('el módulo existe, en Finanzas y con su propio nombre', () => {
  assert.equal(DEUDAS.label, 'Deudas y Compromisos');
  assert.equal(DEUDAS.group, 'Finanzas');
  assert.equal(DEUDAS.printable, true);
});

test('lleva las dos direcciones: lo que se debe y lo que se prestó', () => {
  const campo = DEUDAS.fields.find((f) => f.name === 'direccion');
  assert.deepEqual(campo.options, ['Por pagar', 'Por cobrar']);
  assert.equal(campo.required, true);
});

test('y las tres clases, con la compra a crédito entre ellas', () => {
  assert.deepEqual(DEUDAS.CLASES_POR_PAGAR,
    ['Préstamo en dinero', 'Compra a crédito', 'Crédito de una institución']);
});

test('la clase saca su lista de la ruta y no de una copia escrita al lado', () => {
  /*
   * Declarar las dos cosas —una lista y una ruta— deja escrita una lista que no
   * manda: la ruta gana. Lo pilló la prueba que existe para eso, sobre este
   * mismo campo, y queda fijado acá.
   */
  const campo = DEUDAS.fields.find((f) => f.name === 'clase');
  assert.ok(campo.optionsRoute, 'la clase saca su lista de una ruta');
  assert.ok(!campo.options, 'y no lleva además una lista escrita');
});

test('el monto es una cifra reservada, como las de Tesorería', () => {
  assert.equal(DEUDAS.fields.find((f) => f.name === 'monto').reservado, 'tesoreria_montos');
});

// --------------------------------------------------- de quién es la deuda ----

test('la iglesia y el cuerpo salen de la caja, no de quien escribe', () => {
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, iglesia_id) VALUES (?, 1)").run(`Deuda ${marca()}`).lastInsertRowid;
  const suya = caja('Del cuerpo', { cuerpoId: cuerpo });
  // Se mandan mentiras a propósito en los dos campos
  const data = laDeuda({ cuenta_id: suya, iglesia_id: 999, cuerpo_id: 888 });
  assert.equal(alGuardar(data), null);
  assert.equal(data.iglesia_id, 1);
  assert.equal(data.cuerpo_id, cuerpo);
});

test('una deuda de la corporación no queda colgando de ninguna iglesia', () => {
  const suya = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, estado, saldo_inicial)
                           VALUES (?, 'Corporación', 'General', 'Activa', 0)`)
    .run(`Corp Deuda ${marca()}`).lastInsertRowid;
  const data = laDeuda({ cuenta_id: suya });
  assert.equal(alGuardar(data), null);
  assert.equal(data.iglesia_id, null);
  assert.equal(data.cuerpo_id, null);
});

test('sin caja no se guarda', () => {
  assert.match(String(alGuardar(laDeuda({ cuenta_id: null }))), /Indique la caja/);
});

test('una caja que no existe tampoco', () => {
  assert.match(String(alGuardar(laDeuda({ cuenta_id: 999999 }))), /no existe/);
});

test('una caja cerrada no recibe deudas nuevas', () => {
  const cerrada = caja('Cerrada', { estado: 'Cerrada' });
  assert.match(String(alGuardar(laDeuda({ cuenta_id: cerrada }))), /cerrada/i);
});

test('pero las suyas se siguen corrigiendo', () => {
  const cerrada = caja('Cerrada', { estado: 'Cerrada' });
  const antes = { id: 1, cuenta_id: cerrada, ...laDeuda() };
  assert.equal(alGuardar({ concepto: 'Le corrijo una coma' }, { existing: antes }), null);
});

// ------------------------------------------------------- con quién es ----

test('una persona sin nombre no vale', () => {
  assert.match(String(alGuardar(laDeuda({ cuenta_id: caja('A'), contraparte: '' }))), /con qué persona/);
});

test('una institución sin nombre tampoco', () => {
  const data = laDeuda({ cuenta_id: caja('A'), contraparte_tipo: 'Una institución', contraparte: null });
  assert.match(String(alGuardar(data)), /con qué institución/);
});

test('y sin decir de qué tipo es, menos', () => {
  const data = laDeuda({ cuenta_id: caja('A'), contraparte_tipo: null });
  assert.match(String(alGuardar(data)), /una persona o una institución/);
});

test('al pasar de persona a institución se suelta el nombre viejo', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A') }), contraparte_id: 7 };
  const data = { cuenta_id: antes.cuenta_id, contraparte_tipo: 'Una institución', institucion: 'Muebles del Sur' };
  assert.equal(alGuardar(data, { existing: antes }), null);
  assert.equal(data.contraparte, null, 'el nombre de la persona se suelta');
  assert.equal(data.contraparte_id, null, 'y su enlace también');
});

test('y al revés, se suelta la institución', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A'), contraparte_tipo: 'Una institución', institucion: 'Banco' }) };
  const data = { cuenta_id: antes.cuenta_id, contraparte_tipo: 'Una persona', contraparte: 'Juan Pérez' };
  assert.equal(alGuardar(data, { existing: antes }), null);
  assert.equal(data.institucion, null);
});

test('«con quién» se lee de una sola columna en el listado', () => {
  const quien = DEUDAS.computed.find((c) => c.name === 'quien');
  assert.equal(quien.calc({ contraparte_tipo: 'Una persona', contraparte: 'Juan Pérez' }), 'Juan Pérez');
  assert.equal(quien.calc({ contraparte_tipo: 'Una institución', institucion: 'Banco X' }), 'Banco X');
});

// ------------------------------------------------ la clase y la dirección ----

test('la organización no vende a plazo: por cobrar solo hay préstamos', () => {
  const data = laDeuda({ cuenta_id: caja('A'), direccion: 'Por cobrar', clase: 'Compra a crédito' });
  assert.match(String(alGuardar(data)), /no vende a plazo/);
});

test('pero sí puede prestar dinero', () => {
  const data = laDeuda({ cuenta_id: caja('A'), direccion: 'Por cobrar', clase: 'Préstamo en dinero' });
  assert.equal(alGuardar(data), null);
});

test('las clases que se ofrecen dependen de la dirección', async () => {
  const api = await elSistemaAndando();
  const pagar = await api('GET', '/deudas/clases?direccion=Por%20pagar');
  const cobrar = await api('GET', '/deudas/clases?direccion=Por%20cobrar');
  assert.equal(pagar.estado, 200);
  assert.equal(pagar.json.length, 3);
  assert.deepEqual(cobrar.json.map((o) => o.id), ['Préstamo en dinero']);
});

// ------------------------------------------------------------ cerrarla ----

test('la llave de cerrar deudas existe, y es de Finanzas', () => {
  const llave = LLAVES.find((l) => l.name === 'deudas_cerrar');
  assert.ok(llave, 'tiene que existir deudas_cerrar');
  assert.equal(llave.group, 'Finanzas');
});

test('sin la llave no se puede dar por pagada', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A') }) };
  const problema = alGuardar({ cuenta_id: antes.cuenta_id, estado: 'Pagada' }, { existing: antes, user: SIN_LLAVE });
  assert.match(String(problema), /No tiene la llave/);
});

test('ni por condonada', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A') }) };
  const problema = alGuardar({ cuenta_id: antes.cuenta_id, estado: 'Condonada' }, { existing: antes, user: SIN_LLAVE });
  assert.match(String(problema), /No tiene la llave/);
});

test('pero sí corregirle lo demás a una que ya estaba cerrada', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A'), estado: 'Pagada' }), fecha_cierre: '2026-08-10' };
  assert.equal(alGuardar({ cuenta_id: antes.cuenta_id, notas: 'una coma' }, { existing: antes, user: SIN_LLAVE }), null);
});

test('y con la llave se cierra, con la fecha del día', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A') }) };
  const data = { cuenta_id: antes.cuenta_id, estado: 'Pagada' };
  assert.equal(alGuardar(data, { existing: antes }), null);
  assert.equal(data.fecha_cierre, require('../../server/fechas').hoy());
});

test('la fecha que alguien escribió no se pisa', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A') }) };
  const data = { cuenta_id: antes.cuenta_id, estado: 'Pagada', fecha_cierre: '2026-08-15' };
  alGuardar(data, { existing: antes });
  assert.equal(data.fecha_cierre, '2026-08-15');
});

test('al reabrirla se suelta la fecha de cierre', () => {
  const antes = { id: 1, ...laDeuda({ cuenta_id: caja('A'), estado: 'Pagada' }), fecha_cierre: '2026-08-10' };
  const data = { cuenta_id: antes.cuenta_id, estado: 'Vigente' };
  assert.equal(alGuardar(data, { existing: antes }), null);
  assert.equal(data.fecha_cierre, null, 'no puede quedar diciendo que se cerró un día en que sigue viva');
});

// --------------------------------------------- de qué nivel es la deuda ----

test('una deuda es del nivel de su caja', () => {
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, iglesia_id) VALUES (?, 1)").run(`Deuda ${marca()}`).lastInsertRowid;
  assert.equal(tesorerias.nivelDe(DEUDAS, { cuerpo_id: cuerpo }, db), 'tesoreria_cuerpo');
  assert.equal(tesorerias.nivelDe(DEUDAS, { cuerpo_id: null }, db), 'tesoreria_general');
});

test('quien no alcanza la tesorería de los cuerpos no ve las deudas de un cuerpo', () => {
  const sinCuerpos = { id: 3, rol: 'tesorero', permisos: JSON.stringify({ tesoreria_cuerpo: [] }) };
  assert.equal(tesorerias.alcanza(DEUDAS, { cuerpo_id: 5, cuenta_id: null }, sinCuerpos, db), false);
  assert.equal(tesorerias.alcanza(DEUDAS, { cuerpo_id: null, cuenta_id: null }, sinCuerpos, db), true);
});

test('y el listado se le recorta con la misma condición', () => {
  const sinCuerpos = { id: 3, rol: 'tesorero', permisos: JSON.stringify({ tesoreria_cuerpo: [] }) };
  const donde = tesorerias.condicion(DEUDAS, sinCuerpos);
  assert.ok(donde && /cuerpo_id/.test(donde), `tiene que recortar por el cuerpo: ${donde}`);
});

// ------------------------------------------ una deuda no se borra sola ----

test('borrar la caja de una deuda se frena, no se la lleva por delante', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Con deuda');
  /*
   * Una COMPRA A CRÉDITO, a propósito: desde la 1.248.0 un préstamo deja su
   * desembolso en la caja, y entonces lo que frena el borrado es el movimiento
   * y no la deuda. Con una compra a crédito no hay movimiento ninguno, así que
   * lo único que puede frenarlo es la regla que se está probando.
   */
  const r = await api('POST', '/deudas', laDeuda({
    cuenta_id: suya, clase: 'Compra a crédito',
    contraparte_tipo: 'Una institución', contraparte: null, institucion: 'Muebles del Sur',
  }));
  assert.equal(r.estado, 201, r.texto);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE cuenta_id = ?').get(suya).c, 0,
    'la caja no puede tener movimientos, o el frenado sería el de ellos');

  const b = await api('DELETE', `/cuentas_tesoreria/${suya}?igual_asi=1`);
  assert.equal(b.estado, 400, b.texto);
  assert.match(b.json.error, /deuda\(s\) o compromiso\(s\)/);
  assert.ok(db.prepare('SELECT id FROM deudas WHERE id = ?').get(r.json.id), 'la deuda sigue ahí');
});

// ------------------------------------------------- quién entra al módulo ----

test('el tesorero lo maneja entero; el secretario y quien solo consulta no entran', () => {
  assert.deepEqual(MATRIX.tesorero.deudas, ['view', 'create', 'edit', 'delete']);
  assert.deepEqual(MATRIX.secretario.deudas, []);
  assert.deepEqual(MATRIX.consulta.deudas, []);
  assert.ok(can({ rol: 'admin' }, 'deudas', 'create'));
  assert.ok(!can({ rol: 'secretario' }, 'deudas', 'view'));
});

// --------------------------------------------------- el sistema andando ----

test('se anota el préstamo del hermano, y queda de su iglesia', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Techo');
  const r = await api('POST', '/deudas', laDeuda({
    cuenta_id: suya, concepto: 'Préstamo para el techo', monto: 400000, contraparte: 'Juan Pérez',
  }));
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.iglesia_id, 1);
  assert.equal(r.json.quien, 'Juan Pérez');
});

test('y las sillas a crédito, que no entran plata a ninguna caja', async () => {
  const api = await elSistemaAndando();
  const suya = caja('Sillas');
  const r = await api('POST', '/deudas', laDeuda({
    cuenta_id: suya, clase: 'Compra a crédito', concepto: 'Sillas para el templo', monto: 500000,
    contraparte_tipo: 'Una institución', contraparte: null, institucion: 'Muebles del Sur Ltda.',
  }));
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.quien, 'Muebles del Sur Ltda.');
  assert.equal(r.json.clase, 'Compra a crédito');
});
