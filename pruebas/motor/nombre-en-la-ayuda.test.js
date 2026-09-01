/**
 * EL NOMBRE DE QUIEN RECIBIÓ LA AYUDA, CUANDO LA FICHA LO CORRIGE.
 *
 * Medido: a «Carmen Soto» se le entregaron tres ayudas, se le corrigió el
 * apellido en su ficha a «Sotto» y las tres siguieron diciendo «Soto». El
 * apellido no se corrigió por capricho —estaba mal escrito—, y el listado de
 * ayudas seguía mostrando el error en tres lugares, sin manera de arreglarlo
 * desde ahí: el campo es de solo lectura, a propósito.
 *
 * Lo que cuida este archivo:
 *   · que corregir la ficha corrija sus ayudas, en los dos registros
 *   · que NO toque las de antes del registro, que llevan un nombre escrito a
 *     mano y no apuntan a ninguna ficha: ahí ese texto es la constancia
 *   · que no toque las de nadie más
 *   · que no escriba cuando no hay nada que cambiar, para que corregir un
 *     teléfono no mueva una sola fila
 *   · y que el hook que copia y el refresco armen el nombre igual
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const nombre = require('../../server/el-nombre-copiado');
const noMiembros = require('../../server/modules/no_miembros');
const miembros = require('../../server/modules/miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Nombre en la ayuda', 'IG-NEA', 'Activa')")
  .run().lastInsertRowid;

const unaFicha = (nombres, apellidos) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)')
  .run(nombres, apellidos, iglesia).lastInsertRowid;
const unMiembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

const entregar = (quien, texto) => db
  .prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, miembro_id, no_miembro_id,
                                  beneficiario, tipo_ayuda, valor_estimado, estado)
     VALUES ('2026-03-01', ?, ?, ?, ?, ?, 'Mercadería', 1000, 'Entregada')`
  )
  .run(iglesia,
    quien.miembro_id ? 'Miembro' : quien.no_miembro_id ? 'No miembro' : null,
    quien.miembro_id || null, quien.no_miembro_id || null, texto).lastInsertRowid;

const comoDice = (id) => db.prepare('SELECT beneficiario FROM ayudas_sociales WHERE id = ?').get(id).beneficiario;

/* ------------------------------------------------- corregir la ficha */

const carmen = unaFicha('Carmen', 'Soto');
const susTres = ['a', 'b', 'c'].map(() => entregar({ no_miembro_id: carmen }, 'Carmen Soto'));
const otraSenora = unaFicha('Rosa', 'Díaz');
const laDeRosa = entregar({ no_miembro_id: otraSenora }, 'Rosa Díaz');
const deAntes = entregar({}, 'Juan Pérez');

test('corregirle el apellido a la ficha se lo corrige a sus tres ayudas', () => {
  assert.deepEqual(susTres.map(comoDice), ['Carmen Soto', 'Carmen Soto', 'Carmen Soto']);
  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run('Sotto', carmen);
  const cambiadas = nombre.ponerAlDiaElNombre(db, 'no_miembros', carmen);
  assert.equal(cambiadas, 3);
  assert.deepEqual(susTres.map(comoDice), ['Carmen Sotto', 'Carmen Sotto', 'Carmen Sotto']);
});

test('las de otra persona no se tocan', () => {
  assert.equal(comoDice(laDeRosa), 'Rosa Díaz');
});

test('las de antes del registro NO se tocan nunca', () => {
  // Llevan un nombre escrito a mano y no apuntan a ninguna ficha: ahí ese
  // texto es la única constancia que hay de a quién se le entregó.
  assert.equal(comoDice(deAntes), 'Juan Pérez');
});

test('sin nada que cambiar no se escribe una sola fila', () => {
  assert.equal(nombre.ponerAlDiaElNombre(db, 'no_miembros', carmen), 0,
    'corregirle el teléfono a alguien no puede reescribirle todas sus ayudas');
});

test('agregarle el apellido que faltaba también cuenta', () => {
  const sola = unaFicha('Elena', null);
  const suya = entregar({ no_miembro_id: sola }, 'Elena');
  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run('Vidal', sola);
  assert.equal(nombre.ponerAlDiaElNombre(db, 'no_miembros', sola), 1);
  assert.equal(comoDice(suya), 'Elena Vidal');
});

test('sirve igual en el registro de miembros', () => {
  const hilda = unMiembro('Hilda', 'Navaro');
  const suya = entregar({ miembro_id: hilda }, 'Hilda Navaro');
  db.prepare('UPDATE miembros SET apellidos = ? WHERE id = ?').run('Navarro', hilda);
  assert.equal(nombre.ponerAlDiaElNombre(db, 'miembros', hilda), 1);
  assert.equal(comoDice(suya), 'Hilda Navarro');
});

test('una ficha que ya no está no borra el nombre de sus ayudas', () => {
  const suya = entregar({ no_miembro_id: 999999 }, 'Alguien Que Estuvo');
  assert.equal(nombre.ponerAlDiaElNombre(db, 'no_miembros', 999999), 0);
  assert.equal(comoDice(suya), 'Alguien Que Estuvo',
    'dejarlo en blanco sería perder lo poco que queda de esa entrega');
});

test('una ficha que existe pero se quedó sin nombre tampoco lo borra', () => {
  /*
   * Es el caso que de verdad hay que atajar. Con una ficha que NO existe, lo
   * que salva es que en SQLite comparar con NULL nunca da verdadero, así que
   * la consulta no toca nada por su cuenta; con una ficha que existe y tiene
   * el nombre vacío, la consulta SÍ correría y dejaría el beneficiario en
   * blanco. El formulario no deja crear una así, pero una planilla mal armada
   * o una migración sí.
   */
  const vacia = unaFicha('Sin', 'Nombre');
  const suya = entregar({ no_miembro_id: vacia }, 'Sin Nombre');
  db.prepare("UPDATE no_miembros SET nombres = '', apellidos = NULL WHERE id = ?").run(vacia);
  assert.equal(nombre.ponerAlDiaElNombre(db, 'no_miembros', vacia), 0);
  assert.equal(comoDice(suya), 'Sin Nombre',
    'cambiar «no sabemos si el nombre está al día» por «no sabemos a quién se le entregó» es peor');
});

/* ------------------------------------------ el nombre se arma una sola vez */

test('el hook que copia y el refresco arman el nombre igual', () => {
  assert.equal(nombre.comoSeLlama({ nombres: 'Ana', apellidos: 'Torres' }), 'Ana Torres');
  assert.equal(nombre.comoSeLlama({ nombres: 'Ana', apellidos: null }), 'Ana', 'sin espacios de sobra');
  assert.equal(nombre.comoSeLlama(null), null);
  const ayudas = fs.readFileSync(path.join(__dirname, '../../server/modules/ayudas_sociales.js'), 'utf8');
  assert.match(ayudas, /data\.beneficiario = require\('\.\.\/el-nombre-copiado'\)\.comoSeLlama\(ficha\);/,
    'escritas por separado, un día difieren por un espacio y las ayudas quedan «cambiando» solas');
});

/* --------------------------------------------- que los módulos lo llamen */

test('al guardar una ficha de No Miembro se ponen al día sus ayudas', () => {
  const f = unaFicha('Marta', 'Pino');
  const suya = entregar({ no_miembro_id: f }, 'Marta Pino');
  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run('Pinto', f);
  noMiembros.hooks.afterSave({ id: f }, { db, user: { id: 1, rol: 'admin' } });
  assert.equal(comoDice(suya), 'Marta Pinto', 'el módulo tiene que llamarlo, no solo existir la regla');
});

test('y al guardar una ficha de Miembro, también', () => {
  const m = unMiembro('Sergio', 'Lara');
  const suya = entregar({ miembro_id: m }, 'Sergio Lara');
  db.prepare('UPDATE miembros SET apellidos = ? WHERE id = ?').run('Larach', m);
  const fila = db.prepare('SELECT * FROM miembros WHERE id = ?').get(m);
  miembros.hooks.afterSave(fila, { db, user: { id: 1, rol: 'admin' } });
  assert.equal(comoDice(suya), 'Sergio Larach');
});

/* ----------------------------------- por qué se reescribe y no se calcula */

test('el nombre que se muestra sale de la columna guardada, no de un cálculo', () => {
  // Es la razón de fondo: el título de un registro lo arma el motor con las
  // columnas guardadas, porque las etiquetas de un listado entero se resuelven
  // en una sola consulta. Un nombre calculado al leer llegaría al listado y no
  // al título, y la misma ayuda diría dos nombres según dónde se la mire.
  const ayudas = require('../../server/modules/ayudas_sociales');
  assert.equal(ayudas.display, '{tipo_ayuda} — {beneficiario}');
  assert.ok(ayudas.listFields.includes('beneficiario'));
  assert.ok(ayudas.searchFields.includes('beneficiario'),
    'y por esa misma columna se busca: con la copia al día, buscar el nombre corregido la encuentra');
});

test('buscar el nombre corregido encuentra sus ayudas', () => {
  const filas = db
    .prepare("SELECT id FROM ayudas_sociales WHERE beneficiario LIKE '%Sotto%'")
    .all();
  assert.equal(filas.length, 3, 'las tres de Carmen, con el apellido bueno');
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM ayudas_sociales WHERE beneficiario LIKE '%Carmen Soto' AND iglesia_id = ?")
      .get(iglesia).c,
    0, 'y el apellido malo ya no está en ninguna'
  );
});
