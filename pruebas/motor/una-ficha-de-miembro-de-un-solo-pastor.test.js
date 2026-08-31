/**
 * Dos fichas de pastor apuntando al mismo miembro.
 *
 * El pastor y la pastora son TAMBIÉN miembros de su iglesia, y el módulo
 * enlaza las dos fichas —el sistema reconoce sola la que lleva su mismo RUT— y
 * muestra en el listado si están enlazadas. Pero el enlace no era único.
 * Medido antes de la 1.243.0:
 *
 *   crearle su ficha de miembro al pastor A .... 200, miembro 626
 *   enlazar al pastor C al MISMO miembro 626 ... 200, aceptado
 *   lo que dicen las dos fichas después ........ «Registrado», las dos
 *
 * Y se ve: la lista «A cargo de la iglesia» arma el nombre de cada pastor a
 * partir de SU ficha de miembro, para darle su trato. Con dos apuntando a la
 * misma, la fila del segundo pasa a mostrar el nombre del primero —medido, la
 * de «Tomás Tres» se leía «Pastor Marcos Uno»— y el nombre de Tomás no
 * aparecía por ninguna parte.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const suFicha = require('../../server/su-ficha-de-miembro');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const PASTORES = getModule('pastores');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const miembro = (nombres, rut = null) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, estado) VALUES (?, ?, ?, 'Activo')")
  .run(nombres, `Enlace ${marca()}`, rut).lastInsertRowid;

const pastor = (nombres, { miembroId = null, rut = null } = {}) => db
  .prepare("INSERT INTO pastores (nombres, apellidos, cargo, estado, miembro_id, rut) VALUES (?, ?, 'Pastor Presbítero', 'Activo', ?, ?)")
  .run(nombres, `Enlace ${marca()}`, miembroId, rut).lastInsertRowid;

// Por su nombre y no por su posición: el módulo puede estrenar otro calculado
// —lo hizo en la 1.246.0— y esto no tiene por qué enterarse.
const FICHA_MIEMBRO = PASTORES.computed.find((c) => c.name === 'ficha_miembro');
const comoEstaLaFicha = (id) =>
  FICHA_MIEMBRO.calc(db.prepare('SELECT * FROM pastores WHERE id = ?').get(id), { db });

const alGuardar = (id, data, existing = null) =>
  PASTORES.hooks.beforeSave(data, { id, existing, db, confirmado: false });

// ------------------------------------------------- quiénes más la tienen ----

test('quiénes más tienen esa ficha de miembro', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  assert.deepEqual(suFicha.quienesMasLaTienen(db, m).map((o) => o.id), [uno]);
});

test('sin contar al que se está preguntando por él mismo', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  assert.deepEqual(suFicha.quienesMasLaTienen(db, m, uno), []);
});

test('y una ficha libre no la tiene nadie', () => {
  assert.deepEqual(suFicha.quienesMasLaTienen(db, miembro('Marcos')), []);
});

// ------------------------------------------------------ se frena, no se pregunta ----

test('enlazar a un segundo pastor a la misma ficha se frena', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  const dos = pastor('Tomás');
  const aviso = alGuardar(dos, { miembro_id: m }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(dos));
  assert.equal(typeof aviso, 'string', 'es un rechazo, no una pregunta: una persona no es dos pastores');
});

test('y el aviso dice de quién es la que está ocupada', () => {
  const m = miembro('Marcos');
  const uno = pastor('MarcosOcupa', { miembroId: m });
  const dos = pastor('Tomás');
  const aviso = alGuardar(dos, { miembro_id: m }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(dos));
  assert.match(aviso, /MarcosOcupa/);
  assert.match(aviso, /quítele el enlace a la que no/i, 'y qué hacer');
});

test('no se puede pasar contestando que sí', () => {
  /*
   * Las otras tres cosas que el módulo avisa se pueden confirmar, porque
   * detrás hay un caso legítimo. Ésta no tiene ninguno.
   */
  const m = miembro('Marcos');
  pastor('Marcos', { miembroId: m });
  const dos = pastor('Tomás');
  const aviso = PASTORES.hooks.beforeSave({ miembro_id: m }, {
    id: dos, existing: db.prepare('SELECT * FROM pastores WHERE id = ?').get(dos), db, confirmado: true,
  });
  assert.equal(typeof aviso, 'string', 'el «igual_asi» no la abre');
});

test('el que ya la tenía la sigue teniendo', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  assert.equal(alGuardar(uno, { telefono: '+56 9 1111 2222' }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(uno)), null);
  assert.equal(alGuardar(uno, { miembro_id: m }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(uno)), null);
});

test('y enlazarlo a una libre no se frena', () => {
  const dos = pastor('Tomás');
  assert.equal(alGuardar(dos, { miembro_id: miembro('Tomás') }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(dos)), null);
});

test('quitarle el enlace tampoco', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  assert.equal(alGuardar(uno, { miembro_id: null }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(uno)), null);
});

// ------------------------------------------ también por la puerta del RUT ----

test('el RUT que enlaza solo tampoco puede llevar a una ficha ajena', () => {
  /*
   * Si no se indica la ficha de miembro, el sistema la busca por el RUT y la
   * enlaza. Sin esta comprobación, esa puerta creaba el duplicado sin que
   * nadie eligiera nada.
   */
  const rut = `2${String(1000000 + n).slice(-7)}-0`;
  const m = miembro('Marcos', rut);
  pastor('Marcos', { miembroId: m });
  const dos = pastor('Tomás');
  const aviso = alGuardar(dos, { rut }, db.prepare('SELECT * FROM pastores WHERE id = ?').get(dos));
  assert.equal(typeof aviso, 'string');
  assert.match(aviso, /El RUT de esta ficha/, 'y el aviso dice que llegó por ahí, porque nadie eligió nada');
});

// -------------------------------------------------- lo que quedó de antes ----

test('la columna deja de decir «Registrado» en las dos', () => {
  const m = miembro('Marcos');
  const uno = pastor('Marcos', { miembroId: m });
  const dos = pastor('Tomás', { miembroId: m });
  const como = comoEstaLaFicha;
  assert.equal(como(uno).texto, 'La comparte con otro');
  assert.equal(como(dos).texto, 'La comparte con otro');
  assert.equal(como(uno).nivel, 'bajo', 'y se pinta como algo que hay que arreglar');
});

test('y el que la tiene para él sigue diciendo «Registrado»', () => {
  const uno = pastor('Marcos', { miembroId: miembro('Marcos') });
  const como = comoEstaLaFicha(uno);
  assert.equal(como.texto, 'Registrado');
});

test('lo ya guardado no se corrige al arrancar, y es a propósito', () => {
  /*
   * No hay manera de saber cuál de los dos enlaces es el bueno. Se pone a la
   * vista y lo arregla quien sepa de quién es esa persona.
   */
  const migraciones = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');
  assert.doesNotMatch(migraciones, /quienesMasLaTienen|UPDATE pastores SET miembro_id = NULL/);
});

// ------------------------------------------------ guardando de verdad ----

test('guardando de verdad: las dos puertas cerradas, y la etiqueta deja de mentir', async () => {
  const api = await elSistemaAndando();
  const m = `enlace-${process.pid}`;
  const igl = (await api('POST', '/iglesias', { nombre: `Iglesia Enlace ${m}`, codigo: `EN${process.pid}`, estado: 'Activa' })).json;

  const uno = (await api('POST', '/pastores', { nombres: 'Marcos', apellidos: `Uno ${m}`, cargo: 'Pastor Presbítero', iglesia_id: igl.id })).json;
  const suya = (await api('POST', `/pastores/${uno.id}/ficha-miembro`, {})).json;
  assert.ok(suya.miembro_id, JSON.stringify(suya));

  const dos = (await api('POST', '/pastores', { nombres: 'Tomás', apellidos: `Dos ${m}`, cargo: 'Pastor Presbítero', iglesia_id: igl.id })).json;

  const aMano = await api('PUT', `/pastores/${dos.id}`, { miembro_id: suya.miembro_id, igual_asi: true });
  assert.equal(aMano.estado, 400, 'elegirla a mano tiene que frenarse');

  // Y por el botón, con el RUT ya puesto como estaría en una base de antes
  const rut = `2${String(2000000 + process.pid % 900000).slice(-7)}-0`;
  db.prepare('UPDATE miembros SET rut = ? WHERE id = ?').run(rut, suya.miembro_id);
  db.prepare('UPDATE pastores SET rut = ? WHERE id = ?').run(rut, dos.id);
  const porElBoton = await api('POST', `/pastores/${dos.id}/ficha-miembro`, {});
  assert.equal(porElBoton.estado, 400,
    'el botón escribe el enlace derecho: sin la regla acá sería la manera de saltarse el formulario');
  assert.match(porElBoton.json.error, /un solo pastor/);

  assert.equal(db.prepare('SELECT miembro_id FROM pastores WHERE id = ?').get(dos.id).miembro_id, null,
    'y no se le enlazó nada');
});

test('las dos puertas piden la MISMA regla', () => {
  /*
   * Una escrita y la otra no era exactamente el defecto: el botón sería la
   * manera de saltarse lo que el formulario frena.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/pastores.js'), 'utf8');
  const cuantas = (modulo.match(/avisoSiEsaFichaYaEsDeOtro\(/g) || []).length;
  assert.equal(cuantas, 2, `se pide ${cuantas} vez(ces), y tienen que ser dos: el guardado y el botón`);
});
