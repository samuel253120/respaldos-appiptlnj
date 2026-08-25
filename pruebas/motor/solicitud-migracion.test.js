/**
 * La migración que pone al día las solicitudes que ya estaban ingresadas.
 *
 * Corre UNA vez sobre datos reales de una iglesia y no se puede repetir para
 * arreglarla: si numera mal, dos solicitudes quedan con el mismo número; si
 * junta a dos personas distintas en una ficha, se mezclan trámites de gente
 * que no tiene nada que ver. Por eso se prueba pieza por pieza.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { solicitudesConSeguimiento } = require('../../server/migraciones');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central','IG-M','Activa')").run().lastInsertRowid;
const otra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Norte','IG-M2','Activa')").run().lastInsertRowid;
// El RUT es propio de este archivo: todas las pruebas del motor comparten UNA
// base, y dos archivos que usen el mismo RUT chocan contra su índice único.
const miembro = db.prepare(
  `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
   VALUES (?, '18450913-1', 'Pedro Antonio', 'Ramirez Soto', 'Activo')`
).run(iglesia).lastInsertRowid;

// En una base nueva estas dos columnas ya no existen —el módulo dejó de
// declararlas—, pero en una iglesia que ya venía usando el sistema sí están, y
// esta migración corre justamente sobre esas. Se recrean para probarla como se
// va a encontrar en la realidad.
db.exec('ALTER TABLE solicitudes ADD COLUMN adjunto TEXT');
db.exec('ALTER TABLE solicitudes ADD COLUMN atendida_por TEXT');

/** Una solicitud al estilo viejo: nombre a mano, sin número ni tipo. */
const alEstiloViejo = db.prepare(
  `INSERT INTO solicitudes (fecha, iglesia_id, solicitante, miembro_id, tipo, asunto, estado, adjunto, atendida_por)
   VALUES (?, ?, ?, ?, 'Otro', ?, 'Pendiente', ?, ?)`
);
const ids = {
  rosa1: alEstiloViejo.run('2025-03-04', iglesia, 'Rosa Elena Muñoz', null, 'Mercadería', 'carta.pdf', 'Hna. Secretaria').lastInsertRowid,
  rosa2: alEstiloViejo.run('2025-07-19', iglesia, '  rosa elena muñoz ', null, 'Certificado', null, null).lastInsertRowid,
  rosa3: alEstiloViejo.run('2025-09-01', iglesia, 'Rosa  Elena   Muñoz', null, 'Otra cosa', null, null).lastInsertRowid,
  juanAca: alEstiloViejo.run('2026-01-08', iglesia, 'Juan Carlos Pérez', null, 'El salón', null, null).lastInsertRowid,
  juanAlla: alEstiloViejo.run('2026-02-11', otra, 'Juan Carlos Pérez', null, 'Otra iglesia', null, null).lastInsertRowid,
  delMiembro: alEstiloViejo.run('2026-03-02', iglesia, 'Pedro Antonio Ramirez Soto', miembro, 'Credencial', null, 'El pastor').lastInsertRowid,
  sinNombre: alEstiloViejo.run('2026-03-05', iglesia, '', null, 'Sin nombre', null, null).lastInsertRowid,
};

solicitudesConSeguimiento();

const laDe = (id) => db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id);
const contador = (anio) => (db.prepare('SELECT ultimo FROM solicitud_contador WHERE anio = ?').get(anio) || { ultimo: 0 }).ultimo;

// ------------------------------------------------------------- el número ---

test('a todas se les pone número', () => {
  for (const id of Object.values(ids)) assert.ok(laDe(id).numero, `la ${id} quedó sin número`);
});

test('se numeran por orden de fecha, y el correlativo se reinicia cada año', () => {
  assert.equal(laDe(ids.rosa1).numero, '0001-2025');
  assert.equal(laDe(ids.rosa2).numero, '0002-2025');
  assert.equal(laDe(ids.rosa3).numero, '0003-2025');
  assert.equal(laDe(ids.juanAca).numero, '0001-2026', 'el año nuevo parte de cero');
  assert.equal(laDe(ids.juanAlla).numero, '0002-2026');
  assert.equal(laDe(ids.delMiembro).numero, '0003-2026');
  assert.equal(laDe(ids.sinNombre).numero, '0004-2026');
});

test('no hay dos con el mismo número', () => {
  const todos = db.prepare('SELECT numero FROM solicitudes').all().map((s) => s.numero);
  assert.equal(new Set(todos).size, todos.length);
});

test('el contador de cada año queda donde llegó la numeración', () => {
  assert.equal(contador(2025), 3);
  assert.equal(contador(2026), 4);
});

test('y la siguiente solicitud no repite ninguno', () => {
  const numero = require('../../server/solicitudes/numero');
  assert.equal(numero.siguiente(2026), '0005-2026');
  assert.equal(numero.siguiente(2025), '0004-2025');
});

// -------------------------------------------------------- quién la presentó --

test('la que apuntaba a un miembro queda marcada como Miembro', () => {
  const s = laDe(ids.delMiembro);
  assert.equal(s.solicitante_tipo, 'Miembro');
  assert.equal(s.miembro_id, miembro);
  assert.equal(s.no_miembro_id, null);
});

test('el mismo nombre escrito de tres formas da UNA ficha', () => {
  const a = laDe(ids.rosa1), b = laDe(ids.rosa2), c = laDe(ids.rosa3);
  assert.equal(a.solicitante_tipo, 'No miembro');
  assert.ok(a.no_miembro_id, 'quedó enlazada a una ficha');
  assert.equal(b.no_miembro_id, a.no_miembro_id, 'la misma señora, la misma ficha');
  assert.equal(c.no_miembro_id, a.no_miembro_id);
  const ficha = db.prepare('SELECT nombres FROM no_miembros WHERE id = ?').get(a.no_miembro_id);
  assert.equal(ficha.nombres, 'Rosa Elena Muñoz', 'con el nombre tal como se escribió la primera vez');
});

test('y por fin se puede ver todo lo que pidió esa persona', () => {
  const suyas = db.prepare('SELECT COUNT(*) c FROM solicitudes WHERE no_miembro_id = ?').get(laDe(ids.rosa1).no_miembro_id).c;
  assert.equal(suyas, 3);
});

test('dos personas del mismo nombre en iglesias distintas son dos fichas', () => {
  const aca = laDe(ids.juanAca), alla = laDe(ids.juanAlla);
  assert.ok(aca.no_miembro_id && alla.no_miembro_id);
  assert.notEqual(aca.no_miembro_id, alla.no_miembro_id);
});

test('la que no traía nombre se queda como estaba, sin inventarle una ficha', () => {
  const s = laDe(ids.sinNombre);
  assert.equal(s.solicitante_tipo, null);
  assert.equal(s.no_miembro_id, null);
  assert.ok(s.numero, 'pero número sí lleva');
});

// ------------------------------------------------- el adjunto y el historial --

test('el archivo que colgaba del formulario pasa a ser un documento', () => {
  const docs = db.prepare('SELECT * FROM documentos_solicitudes WHERE solicitud_id = ?').all(ids.rosa1);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].archivo, 'carta.pdf');
  assert.equal(laDe(ids.rosa1).adjunto, 'carta.pdf', 'y el campo viejo no se toca: el archivo no se pierde');
});

test('la que no traía adjunto no estrena un documento vacío', () => {
  assert.equal(db.prepare('SELECT COUNT(*) c FROM documentos_solicitudes WHERE solicitud_id = ?').get(ids.rosa2).c, 0);
});

test('a cada una se le deja su primera anotación, con la fecha en que entró', () => {
  for (const id of Object.values(ids)) {
    const h = db.prepare('SELECT * FROM historial_solicitudes WHERE solicitud_id = ?').all(id);
    assert.equal(h.length, 1, `la ${id}`);
    assert.equal(h[0].tipo, 'Ingreso');
    assert.equal(h[0].origen, 'Automático');
    assert.equal(h[0].fecha, laDe(id).fecha, 'la fecha del ingreso, no la de hoy');
  }
});

test('si figuraba atendida por alguien, eso queda dicho', () => {
  const h = db.prepare('SELECT descripcion FROM historial_solicitudes WHERE solicitud_id = ?').get(ids.rosa1);
  assert.match(h.descripcion, /Hna\. Secretaria/);
});

// -------------------------------------------------------------- repetirla ---

/**
 * Se cuenta SOLO lo de las dos iglesias de este archivo.
 *
 * Los archivos de prueba del motor corren a la vez sobre UNA misma base, así
 * que un COUNT(*) de toda la tabla mide también lo que otro archivo esté
 * escribiendo en ese instante. Contado así, este control fallaba de a ratos
 * —una vez de cada tantas y siempre por uno de más— y el número que salía no
 * tenía nada que ver con la migración. Las dos iglesias se crean acá arriba y
 * no las toca nadie más: acotando a ellas se mide lo que se quería medir.
 */
const loDeAca = (tabla) =>
  db.prepare(`SELECT COUNT(*) c FROM ${tabla} WHERE iglesia_id IN (?, ?)`).get(iglesia, otra).c;

test('correrla dos veces no duplica nada', () => {
  const numerosDeAca = () => db
    .prepare('SELECT numero FROM solicitudes WHERE iglesia_id IN (?, ?) ORDER BY id')
    .all(iglesia, otra).map((s) => s.numero).join(',');
  const antes = {
    solicitudes: loDeAca('solicitudes'),
    fichas: loDeAca('no_miembros'),
    docs: loDeAca('documentos_solicitudes'),
    hist: loDeAca('historial_solicitudes'),
    numeros: numerosDeAca(),
  };
  solicitudesConSeguimiento();
  assert.equal(loDeAca('solicitudes'), antes.solicitudes);
  assert.equal(loDeAca('no_miembros'), antes.fichas);
  assert.equal(loDeAca('documentos_solicitudes'), antes.docs);
  assert.equal(loDeAca('historial_solicitudes'), antes.hist);
  assert.equal(numerosDeAca(), antes.numeros);
});
