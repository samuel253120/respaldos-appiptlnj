/**
 * Cómo se llama un registro cuando hay que nombrarlo en alguna parte.
 *
 * El sistema tiene UNA plantilla por módulo para eso —`display`— y de ella
 * salen el título de la ficha, la etiqueta de las referencias, la línea del
 * Registro de Cambios y, desde la 1.266.0, el encabezado de la hoja impresa.
 *
 * Medido antes de esto, en las diecinueve hojas genéricas del sistema: todas se
 * encabezaban «<Tipo>» y debajo «Registro N.º <id>» —el número que ese registro
 * tiene en la base de datos— y el nombre aparecía más abajo, dentro de la tabla
 * de datos. En un papel que se firma y se archiva, dos hojas se distinguían
 * entre sí por un número que no significa nada fuera del sistema.
 *
 * Y para una directiva pesaba el doble, porque su plantilla era «{periodo}»:
 * dos directivas de dos cuerpos distintos elegidas el mismo año eran EL MISMO
 * TEXTO en todas partes, no solo en el papel. Por eso la plantilla ahora puede
 * nombrar aquello de lo que el registro cuelga —«{cuerpo_id_label} —
 * {periodo}»— y eso se arregla donde se arma el nombre, una sola vez, y no en
 * cada pantalla que lo muestra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule, displayOf } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia con un cuerpo y una directiva escrita a mano. */
function unaDirectiva(periodo = '2026 – 2027', nombreCuerpo = 'Damas') {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia nombres ${m}`, `NOMB${m}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`${nombreCuerpo} ${m}`, iglesia).lastInsertRowid;
  const id = db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, ?, '2026-01-01', '2027-12-31', 'Vigente')`)
    .run(cuerpo, iglesia, periodo).lastInsertRowid;
  return { m, iglesia, cuerpo, id, fila: db.prepare('SELECT * FROM directivas WHERE id = ?').get(id) };
}

const dirs = () => getModule('directivas');

// ------------------------------------- nombrar por aquello de lo que cuelga ----

test('una directiva se llama por su cuerpo y su período, no solo por el período', () => {
  const d = unaDirectiva('2026 – 2027', 'Damas');
  const nombre = displayOf(dirs(), d.fila);

  assert.match(nombre, /2026 – 2027/, 'el período sigue estando');
  assert.ok(nombre.includes(`Damas ${d.m}`),
    'y el cuerpo también: sin él, dos directivas de dos cuerpos son el mismo texto');
});

test('dos directivas del mismo período y distinto cuerpo no se llaman igual', () => {
  const a = unaDirectiva('2026 – 2027', 'Damas');
  const b = unaDirectiva('2026 – 2027', 'Caballeros');

  assert.notEqual(displayOf(dirs(), a.fila), displayOf(dirs(), b.fila),
    'es exactamente el caso que hacía indistinguibles dos hojas impresas');
});

test('si la fila ya trae la etiqueta puesta, se usa ésa y no se busca nada', () => {
  const d = unaDirectiva();
  /*
   * Las filas de un listado vienen con sus etiquetas resueltas de una vez, y
   * volver a buscarlas sería una consulta por fila. Se comprueba dándole una
   * etiqueta que NO está en la base: si saliera de la base, no aparecería.
   */
  const nombre = displayOf(dirs(), { ...d.fila, cuerpo_id_label: 'Lo que venga escrito' });
  assert.ok(nombre.includes('Lo que venga escrito'));
  assert.ok(!nombre.includes('Damas'), 'no volvió a preguntarle a la base');
});

// --------------------------------------------- cuando no se puede resolver ----

test('sin cuerpo, el nombre no queda con el guión colgando', () => {
  const d = unaDirectiva();
  const nombre = displayOf(dirs(), { ...d.fila, cuerpo_id: null });

  assert.equal(nombre, '2026 – 2027',
    'un separador suelto —«— 2026 – 2027»— parece un dato perdido, y es peor que no ponerlo');
});

test('y con un cuerpo que ya no existe, tampoco', () => {
  const d = unaDirectiva();
  const nombre = displayOf(dirs(), { ...d.fila, cuerpo_id: 99999999 });

  assert.equal(nombre, '2026 – 2027');
});

test('un registro sin nada escrito se sigue llamando por su número', () => {
  const d = unaDirectiva();
  const nombre = displayOf(dirs(), { ...d.fila, cuerpo_id: null, periodo: '' });

  assert.equal(nombre, `#${d.fila.id}`,
    'la hoja nunca puede quedar sin encabezado, aunque el registro esté en blanco');
});

test('la plantilla se baja un solo nivel', () => {
  /*
   * El nombre del cuerpo sale de la plantilla del cuerpo. Si ESA pidiera a su
   * vez otra etiqueta, esa segunda no se resuelve: alcanza para lo que hace
   * falta y evita que una cadena de plantillas se vuelva una cadena de
   * consultas. Se comprueba pidiéndole al cuerpo que se llame por su iglesia.
   */
  const d = unaDirectiva();
  const cuerpos = getModule('cuerpos');
  const antes = cuerpos.display;
  try {
    cuerpos.display = '{iglesia_id_label} · {nombre}';
    const nombre = displayOf(dirs(), d.fila);
    assert.ok(nombre.includes(`Damas ${d.m}`), 'el primer nivel sí se resuelve');
    assert.ok(!nombre.includes('Iglesia nombres'), 'el segundo no, y a propósito');
  } finally {
    cuerpos.display = antes;
  }
});

// ------------------------------------------- y esto se ve en todo el sistema ----

test('el Registro de Cambios la nombra por su cuerpo', async () => {
  const api = await elSistemaAndando();
  const d = unaDirectiva('2030 – 2031', 'Jóvenes');

  const r = await api('PUT', `/directivas/${d.id}`, { notas: 'una nota', igual_asi: true });
  assert.equal(r.estado, 200);

  const anotado = db
    .prepare(`SELECT registro FROM registro_cambios
               WHERE modulo = 'Directivas de Cuerpos' AND registro_id = ? ORDER BY id DESC LIMIT 1`)
    .get(d.id);
  assert.ok(anotado, 'el cambio quedó anotado');
  assert.ok(anotado.registro.includes(`Jóvenes ${d.m}`),
    'el registro se nombra igual en todas partes, y acá la fila viene suelta: hay que ir a buscarlo');
  assert.match(anotado.registro, /2030 – 2031/);
});

test('y la etiqueta de un listado también', async () => {
  const api = await elSistemaAndando();
  const d = unaDirectiva('2031 – 2032', 'Coro');

  const r = await api('GET', `/directivas/${d.id}`);
  assert.equal(r.estado, 200);
  assert.ok(String(r.json.cuerpo_id_label || '').includes(`Coro ${d.m}`),
    'de esa etiqueta sale el nombre, así que tiene que venir en la ficha');
});

// ------------------------------------------- lo que ya funcionaba sigue igual ----

test('los demás módulos se siguen llamando como se llamaban', () => {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia intacta ${m}`, `INTA${m}`).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(iglesia);

  assert.equal(displayOf(getModule('iglesias'), fila), `Iglesia intacta ${m}`,
    'una plantilla sin etiquetas de referencia no cambió en nada');
});

test('una fecha en el nombre se sigue leyendo como fecha', () => {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia fecha ${m}`, `FECH${m}`).lastInsertRowid;
  const acta = db
    .prepare(`INSERT INTO actas_asambleas (iglesia_id, numero_acta, fecha)
              VALUES (?, ?, '2026-06-10')`)
    .run(iglesia, `AS-${m}`).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM actas_asambleas WHERE id = ?').get(acta);

  assert.match(displayOf(getModule('actas_asambleas'), fila), /10-06-2026/,
    'en Chile el día va primero, y eso ya estaba resuelto: no se rompió al agregar lo nuevo');
});
