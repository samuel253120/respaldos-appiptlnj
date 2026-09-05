/**
 * «cuerpo_id: 23» EN EL LIBRO DONDE SE LEE QUIÉN TOCÓ EL DINERO.
 *
 * El Registro de Cambios arma el detalle de cada línea con los campos que el
 * módulo muestra en su listado. En las cuotas de cuerpo estaba `cuerpo_id`, que
 * era una columna suelta y no un enlace: sin etiqueta —así que salía el nombre
 * de la columna— y sin nombre —así que salía el número—.
 *
 * MEDIDO en la v1.412.0, una línea entera tal cual:
 *
 *   Fecha del pago: 05-07-2026 · cuerpo_id: 1 · Quién pagó: C884812 Cuota
 *   · Año: 2.026 · Mes: 03 · Monto pagado: $ 5.000
 *
 * El módulo gemelo lo hace bien y por eso se notaba: la línea de una cuota de
 * deuda dice «Deuda: Sillas del templo», porque ahí el campo sí es un enlace.
 * Quien leyera el registro para rastrear un movimiento tenía que irse a otra
 * pantalla a averiguar qué cuerpo era el número 1.
 *
 * Y de paso el año salía «2.026», con separador de miles, que es lo que le toca
 * a una cantidad y no a un año. Sale en tres sitios —el listado, el formulario
 * y esta línea— así que el campo lo dice una vez, con `sinMiles`, y los tres lo
 * respetan.
 *
 * El cuerpo va como ENLACE aunque no se elija: quien registra la cuota elige a
 * la persona y de su ficha sale el cuerpo. Que el módulo lo escriba en su
 * gancho no lo hace menos enlace, y es lo que hace que el libro diga un nombre.
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
  .run(`Central RC ${marca}`, `RC-${marca}`).lastInsertRowid;

function unCuerpo() {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, 5000)`
  ).run(`Sillas del Templo ${++n} RC ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} RC ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga RC ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga RC ${marca}`, iglesia).lastInsertRowid;
}

const suLinea = (cuotaId) => db.prepare(
  "SELECT * FROM registro_cambios WHERE modulo = 'Cuotas de Cuerpos' AND registro_id = ? ORDER BY id DESC LIMIT 1"
).get(cuotaId);

test('la línea nombra al cuerpo, no a su número', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const comoSeLlama = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpo).nombre;

  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '03', monto: 5000, fecha_pago: '2026-03-05' });
  assert.equal(r.estado, 201, r.texto);

  const linea = suLinea(r.json.id);
  assert.ok(linea, 'la cuota deja su línea');
  assert.ok(linea.detalle.includes(comoSeLlama),
    `el nombre del cuerpo, que es lo que se busca al rastrear: ${linea.detalle}`);
  assert.ok(!/cuerpo_id/.test(linea.detalle),
    `ni el nombre de la columna ni el número: ${linea.detalle}`);
  assert.match(linea.detalle, /Cuerpo \/ Grupo:/, 'con la etiqueta del campo, como su módulo gemelo');
});

test('y el año se lee como un año, no como una cantidad', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(unCuerpo()), anio: 2026, mes: '03', monto: 5000, fecha_pago: '2026-03-05' });
  assert.equal(r.estado, 201, r.texto);
  const linea = suLinea(r.json.id);
  assert.match(linea.detalle, /Año: 2026/, `antes decía «Año: 2.026»: ${linea.detalle}`);
  assert.ok(!/2\.026/.test(linea.detalle), linea.detalle);
});

test('lo que sí es una cantidad sigue llevando sus miles', async () => {
  /*
   * Dos veces, porque son dos caminos distintos dentro de `legible`: la plata,
   * en la misma cuota; y un número pelado, en un acta de asamblea —cuyo total
   * de asistentes es `type: number` sin `sinMiles` y está en su listado—. Sin
   * el segundo, aflojar la regla y quitarle los miles a TODO número quedaría
   * sin quien lo note.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(unCuerpo()), anio: 2026, mes: '03', monto: 125000, fecha_pago: '2026-03-05',
      igual_asi: true });
  assert.equal(r.estado, 201, r.texto);
  assert.match(suLinea(r.json.id).detalle, /125\.000/,
    'el arreglo del año no puede llevarse por delante la plata');

  const acta = await api('POST', '/actas_asambleas', {
    numero_acta: `RC-${marca}-1`, fecha: '2026-03-08', tipo: 'Ordinaria',
    iglesia_id: iglesia, total_asistentes: 2500, estado: 'Borrador',
    // El propio módulo pregunta si caben tantos, y acá la pregunta no es esa
    igual_asi: true,
  });
  assert.equal(acta.estado, 201, acta.texto);
  const suya = db.prepare(
    "SELECT * FROM registro_cambios WHERE modulo LIKE 'Actas%' AND registro_id = ? ORDER BY id DESC LIMIT 1"
  ).get(acta.json.id);
  assert.ok(suya, 'las actas de asamblea están vigiladas');
  assert.match(suya.detalle, /2\.500/, 'ni por delante de lo que de verdad se cuenta');
});

test('el listado trae el nombre del cuerpo, no solo su número', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const comoSeLlama = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpo).nombre;
  const puesta = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(cuerpo), anio: 2026, mes: '03', monto: 5000, fecha_pago: '2026-03-05' });
  assert.equal(puesta.estado, 201, puesta.texto);

  const lista = await api('GET', `/cuotas_cuerpo?f_cuerpo_id=${cuerpo}&limit=5`);
  assert.equal(lista.estado, 200, lista.texto);
  const fila = lista.json.rows.find((f) => f.id === puesta.json.id);
  assert.equal(fila.cuerpo_id, cuerpo, 'el número sigue estando, que es con lo que se filtra');
  assert.equal(fila.cuerpo_id_label, comoSeLlama, 'y ahora también el nombre');
});

test('el cuerpo se sigue tomando de la ficha, no de lo que manden', async () => {
  /*
   * Declararlo enlace no lo vuelve elegible: el módulo lo escribe en su gancho
   * a partir del integrante. Si se pudiera mandar, se cobraría en el libro de
   * un cuerpo la cuota de otro.
   *
   * Lo guardan DOS cosas, y por eso quitar una sola no rompe esta prueba: el
   * campo es `readonly` —el motor no deja entrar lo que venga— y además el
   * gancho lo pisa con el de la ficha. Se comprobó quitando las dos a la vez,
   * que es cuando la cuota se fue al cuerpo ajeno.
   */
  const api = await elSistemaAndando();
  const suyo = unCuerpo();
  const ajeno = unCuerpo();
  const r = await api('POST', '/cuotas_cuerpo',
    { integrante_id: unaFicha(suyo), cuerpo_id: ajeno, anio: 2026, mes: '03', monto: 5000, fecha_pago: '2026-03-05' });
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.cuerpo_id, suyo, 'el de la ficha de quien paga, siempre');
});

test('las tres pantallas donde sale un año respetan `sinMiles`', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const bitacora = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuotas_cuerpo.js'), 'utf8');

  assert.match(modulo, /name: 'anio'[^\n]*sinMiles: true/, 'el campo lo dice una vez');
  assert.match(bitacora, /campo\.sinMiles \? String\(n\)/, 'y el Registro de Cambios lo respeta');
  const enPantalla = app.match(/f\.sinMiles/g) || [];
  assert.equal(enPantalla.length, 3,
    `el listado, la ficha y la caja del formulario: se encontraron ${enPantalla.length}`);
});

test('el módulo gemelo, que ya lo hacía bien, sigue igual', async () => {
  /*
   * La línea de una cuota de deuda dice «Deuda: Sillas del templo» desde
   * siempre, y era la que dejaba en evidencia a la otra. Se comprueba porque el
   * arreglo tocó `legible`, que las dos usan.
   */
  const api = await elSistemaAndando();
  const cuenta = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Iglesia local', 'Caja', ?, 'Activa', 500000)`
  ).run(`Caja RC ${marca}`, iglesia).lastInsertRowid;
  const deuda = await api('POST', '/deudas', {
    concepto: `Sillas del templo RC ${marca}`, iglesia_id: iglesia,
    monto: 120000, cuotas: 2, fecha: '2026-01-10', cuenta_id: cuenta,
    contraparte_tipo: 'Una institución', institucion: 'Mueblería del Sur',
  });
  assert.equal(deuda.estado, 201, deuda.texto);

  const suya = db.prepare(
    "SELECT * FROM registro_cambios WHERE modulo = 'Deudas y Compromisos' AND registro_id = ? ORDER BY id DESC LIMIT 1"
  ).get(deuda.json.id);
  assert.ok(suya, 'las deudas están vigiladas desde la v1.355.0, así que la línea tiene que estar');
  assert.match(suya.detalle, /120\.000/, 'la plata de una deuda sigue con sus miles');
  assert.match(suya.detalle, /Sillas del templo/, 'y el enlace de su caja sigue diciendo un nombre');
});
