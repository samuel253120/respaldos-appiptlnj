/**
 * Borrar la ficha del pastor que una iglesia nombra.
 *
 * La 1.237.0 cerró una de las dos puertas por las que una congregación se
 * queda sin pastor principal: trasladarlo PREGUNTA, y al confirmar la iglesia
 * queda suelta y le queda la línea en su historial. La otra —borrar su ficha—
 * quedó abierta. Medido antes de la 1.245.0, con un pastor puesto a cargo:
 *
 *   borrarlo, sin confirmar ........ 200 · borrado
 *   la iglesia, después ............ pastor principal vacío
 *   su historial ................... 2 líneas antes, 2 después
 *
 * O sea que no solo no preguntaba: no dejaba rastro ninguno. Y es peor que el
 * traslado, que sí avisa: trasladado, el pastor sigue existiendo y se puede ir
 * a mirar; borrado, no queda de dónde deducir qué pasó.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const suIglesia = require('../../server/pastor-de-la-iglesia');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const PASTORES = getModule('pastores');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = (nombre, pastorId = null) => db
  .prepare('INSERT INTO iglesias (nombre, pastor_id) VALUES (?, ?)')
  .run(`${nombre} Borrado ${marca()}`, pastorId).lastInsertRowid;

const pastor = (nombres, { iglesiaId = null, rut = null } = {}) => {
  const id = db
    .prepare(`INSERT INTO pastores (nombres, apellidos, cargo, estado, iglesia_id, rut)
              VALUES (?, ?, 'Pastor Presbítero', 'Activo', ?, ?)`)
    .run(nombres, `Borrado ${marca()}`, iglesiaId, rut).lastInsertRowid;
  return db.prepare('SELECT * FROM pastores WHERE id = ?').get(id);
};

const alBorrar = (fila, confirmado = false) =>
  PASTORES.hooks.beforeDelete(fila, { db, user: { id: 1, rol: 'admin' }, confirmado });

const historialDe = (iglesiaId) => db
  .prepare('SELECT * FROM historial_iglesias WHERE iglesia_id = ? ORDER BY id')
  .all(iglesiaId);

// ------------------------------------------------------------ el aviso ----

test('a quien ninguna iglesia nombra se le borra la ficha sin preguntar nada', () => {
  const p = pastor('Onésimo');
  assert.equal(suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, {}), null);
});

test('estar EN una iglesia no es lo mismo que estar A CARGO de ella', () => {
  const casa = iglesia('Betania');
  const p = pastor('Onésimo', { iglesiaId: casa });   // pertenece, pero no la encabeza
  assert.equal(suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, {}), null);
});

test('al que una iglesia nombra se le pregunta, diciendo cuál', () => {
  // El caso de verdad: pertenece a esa iglesia Y la encabeza. Con el pastor
  // suelto de toda iglesia, esta prueba pasaba igual sin mirar nada.
  const casa = iglesia('Siloé');
  const p = pastor('Esdras', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);
  const aviso = suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, {});
  assert.ok(aviso, 'tiene que preguntar');
  assert.equal(aviso.confirmar, 'borrarlo_deja_su_iglesia_sin_pastor');
  assert.match(aviso.error, /Esdras/);
  assert.match(aviso.error, new RegExp(db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(casa).nombre));
  assert.match(aviso.error, /esa iglesia queda/);
});

test('y si son dos, las nombra a las dos y habla en plural', () => {
  const p = pastor('Nehemías');
  iglesia('Norte', p.id);
  iglesia('Sur', p.id);
  const aviso = suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, {});
  assert.match(aviso.error, /Norte/);
  assert.match(aviso.error, /Sur/);
  assert.match(aviso.error, /esas iglesias quedan/);
});

test('el aviso dice que va a quedar la constancia', () => {
  const p = pastor('Josafat');
  iglesia('Horeb', p.id);
  assert.match(suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, {}).error, /constancia en su historial/);
});

test('contestando que sí no vuelve a preguntar', () => {
  const p = pastor('Abdías');
  iglesia('Endor', p.id);
  assert.equal(suIglesia.avisoSiBorrarloDejaSuIglesiaSinPastor(db, p, { confirmado: true }), null);
});

// ------------------------------------------- el gancho del módulo lo usa ----

test('el gancho de borrado devuelve la pregunta', () => {
  const p = pastor('Amós');
  iglesia('Tecoa', p.id);
  const r = alBorrar(p);
  assert.ok(r && r.confirmar === 'borrarlo_deja_su_iglesia_sin_pastor');
});

test('y confirmado deja la línea en el historial de la iglesia', () => {
  const p = pastor('Habacuc');
  const casa = iglesia('Nínive', p.id);
  const antes = historialDe(casa).length;
  assert.equal(alBorrar(p, true), null);
  const lineas = historialDe(casa);
  assert.equal(lineas.length, antes + 1);
  assert.match(lineas[lineas.length - 1].descripcion, /Habacuc/);
  assert.match(lineas[lineas.length - 1].descripcion, /se eliminó su ficha/);
  assert.match(lineas[lineas.length - 1].descripcion, /Queda por designar/);
});

test('la línea dice que fue por el borrado y no por un traslado', () => {
  const p = pastor('Sofonías');
  const casa = iglesia('Maón', p.id);
  alBorrar(p, true);
  const ultima = historialDe(casa).pop().descripcion;
  assert.ok(!/pasó a otra iglesia/.test(ultima), 'no puede decir lo que dice la del traslado');
  assert.ok(!/pasó a «/.test(ultima), 'ni lo que dice la de dejar de ejercer');
});

test('a quien ninguna iglesia nombra no se le escribe ninguna línea', () => {
  const casa = iglesia('Silo');
  const p = pastor('Gedeón', { iglesiaId: casa });
  const antes = historialDe(casa).length;
  assert.equal(alBorrar(p, true), null);
  assert.equal(historialDe(casa).length, antes);
});

test('el gancho sigue soltando a quien lo tenía de cónyuge', () => {
  const p = pastor('Booz');
  const otra = pastor('Rut');
  db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(p.id, otra.id);
  alBorrar(p, true);
  assert.equal(db.prepare('SELECT conyuge_id FROM pastores WHERE id = ?').get(otra.id).conyuge_id, null);
});

// ------------------------------------------------- el sistema andando ----

test('el motor pregunta antes de borrarlo, y no lo borra', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Zacarías');
  iglesia('Ramá', p.id);
  const r = await api('DELETE', `/pastores/${p.id}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'borrarlo_deja_su_iglesia_sin_pastor');
  assert.ok(db.prepare('SELECT id FROM pastores WHERE id = ?').get(p.id), 'no se borró');
});

test('contestando que sí se borra, la iglesia queda suelta y con su línea', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Malaquías');
  const casa = iglesia('Betel', p.id);
  const antes = historialDe(casa).length;

  const r = await api('DELETE', `/pastores/${p.id}?igual_asi=1`);
  assert.equal(r.estado, 200, r.texto);
  assert.equal(db.prepare('SELECT id FROM pastores WHERE id = ?').get(p.id), undefined);
  assert.equal(db.prepare('SELECT pastor_id FROM iglesias WHERE id = ?').get(casa).pastor_id, null);

  const lineas = historialDe(casa);
  assert.equal(lineas.length, antes + 1);
  assert.match(lineas[lineas.length - 1].descripcion, /Malaquías.*se eliminó su ficha/);
});

test('al que ninguna iglesia nombra se lo borra a la primera', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Ageo');
  const r = await api('DELETE', `/pastores/${p.id}`);
  assert.equal(r.estado, 200, r.texto);
  assert.equal(db.prepare('SELECT id FROM pastores WHERE id = ?').get(p.id), undefined);
});

// -------------------------------------- si algo frena, no queda la línea ----

test('con una credencial emitida no se borra, y el historial queda como estaba', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Ezequiel');
  const casa = iglesia('Quebar', p.id);
  db.prepare(`INSERT INTO credenciales (pastor_id, serie, estado, snap_nombres, snap_apellidos)
              VALUES (?, ?, 'Vigente', ?, ?)`)
    .run(p.id, `9${marca().replace(/\D/g, '').slice(0, 6)}`, p.nombres, p.apellidos);
  const antes = historialDe(casa).length;

  const r = await api('DELETE', `/pastores/${p.id}?igual_asi=1`);
  assert.equal(r.estado, 400, r.texto);
  assert.match(r.json.error, /credencial/i);
  assert.ok(db.prepare('SELECT id FROM pastores WHERE id = ?').get(p.id), 'sigue ahí');
  assert.equal(db.prepare('SELECT pastor_id FROM iglesias WHERE id = ?').get(casa).pastor_id, p.id);
  assert.equal(historialDe(casa).length, antes, 'la línea se deshace con el borrado que no fue');
});
