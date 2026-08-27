/**
 * El libro de la oficina de partes: lo que entra y lo que sale.
 *
 * POR QUÉ IMPORTA. Un libro de partes sirve para contestar tres cosas que
 * después nadie recuerda: si un documento llegó, cuándo, y qué se hizo con él.
 * Todo eso descansa en el correlativo, y un correlativo mal llevado no se nota
 * hasta que hay que probar algo —un plazo, una respuesta enviada— y el libro
 * no lo respalda.
 *
 * Lo que se cuida:
 *
 *   · Que sean DOS libros y no uno. Mezclar entrada y salida haría imposible
 *     decir «el oficio 45 que enviamos».
 *   · Que cada iglesia lleve el suyo, y que se reinicie con el año.
 *   · Que lo que no pasó por la oficina —una escritura, un contrato— NO lleve
 *     número: ponerle uno diría que un día llegó, y no llegó.
 *   · Que los documentos que ya estaban en el módulo, cuando era un archivo
 *     suelto, no se pierdan ni se clasifiquen a la fuerza.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/documentos');
const numeracion = require('../../server/numeracion');
const ajustes = require('../../server/ajustes');
const { documentosALaOficinaDePartes } = require('../../server/migraciones');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Partes', 'IG-OP', 'Activa')")
  .run().lastInsertRowid;
const otra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Partes2', 'IG-OP2', 'Activa')")
  .run().lastInsertRowid;

const registrar = (flujo, numero, fecha, ig = iglesia) => db.prepare(
  `INSERT INTO documentos (titulo, flujo, numero, fecha, fecha_registro, iglesia_id, tipo)
   VALUES ('Un documento', ?, ?, ?, ?, ?, 'Carta')`
).run(flujo, numero, fecha, fecha, ig).lastInsertRowid;

/* ── Dos libros, no uno ────────────────────────────────────────────── */

test('lo que entra y lo que sale se numeran por separado', () => {
  assert.equal(numeracion.proximoNumero('documentos_recibidos', iglesia, '2026-05-05'), 'REC-001-2026');
  assert.equal(numeracion.proximoNumero('documentos_emitidos', iglesia, '2026-05-05'), 'EMI-001-2026');
});

test('registrar una entrada no consume el número de la salida', () => {
  // Es la razón de que sean dos libros: si el correlativo fuera uno solo, «el
  // oficio 45 que enviamos» no se podría decir.
  registrar('Recibido', 'REC-001-2026', '2026-05-05');
  assert.equal(numeracion.proximoNumero('documentos_recibidos', iglesia, '2026-05-05'), 'REC-002-2026');
  assert.equal(numeracion.proximoNumero('documentos_emitidos', iglesia, '2026-05-05'), 'EMI-001-2026');
});

test('EL CASO QUE LO DISTINGUE: con el mismo prefijo, cada libro sigue contando lo suyo', () => {
  /*
   * Con prefijos distintos —«REC-» y «EMI-»— los dos libros se separan solos:
   * un número del otro libro no calza con el patrón y no se cuenta. Eso hace
   * que un error acá no se note.
   *
   * Una iglesia puede perfectamente usar el mismo prefijo en los dos, o
   * ninguno, y distinguirlos por el libro. Ahí lo único que separa las series
   * es el flujo, y si dejara de separarlas, el primer documento emitido se
   * llevaría el número que le tocaba al recibido.
   */
  const nueva = (codigo) => db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run('Partes ' + codigo, 'IG-' + codigo).lastInsertRowid;

  /*
   * Se prueban las DOS direcciones, en dos iglesias. Con una sola no alcanza:
   * si el libro que va adelante es justo el que se está mirando, mezclar los
   * dos da el mismo resultado y el error pasa inadvertido.
   */
  const conMuchosRecibidos = nueva('OP3');   // acá va adelante lo que entra
  const conMuchosEmitidos = nueva('OP4');    // acá va adelante lo que sale
  try {
    ajustes.guardar('documento_recibido_prefijo', '');
    ajustes.guardar('documento_emitido_prefijo', '');

    registrar('Recibido', '009-2026', '2026-05-05', conMuchosRecibidos);
    registrar('Emitido', '002-2026', '2026-05-05', conMuchosRecibidos);
    // Lo que sale sigue su propia cuenta: 003, no 010
    assert.equal(numeracion.proximoNumero('documentos_emitidos', conMuchosRecibidos, '2026-05-05'), '003-2026');
    assert.equal(numeracion.proximoNumero('documentos_recibidos', conMuchosRecibidos, '2026-05-05'), '010-2026');

    registrar('Emitido', '009-2026', '2026-05-05', conMuchosEmitidos);
    registrar('Recibido', '002-2026', '2026-05-05', conMuchosEmitidos);
    // Y lo que entra también: 003, no 010
    assert.equal(numeracion.proximoNumero('documentos_recibidos', conMuchosEmitidos, '2026-05-05'), '003-2026');
    assert.equal(numeracion.proximoNumero('documentos_emitidos', conMuchosEmitidos, '2026-05-05'), '010-2026');
  } finally {
    ajustes.guardar('documento_recibido_prefijo', 'REC-');
    ajustes.guardar('documento_emitido_prefijo', 'EMI-');
  }
});

test('cada iglesia lleva su propio libro', () => {
  assert.equal(numeracion.proximoNumero('documentos_recibidos', otra, '2026-05-05'), 'REC-001-2026');
});

test('el correlativo se reinicia con el año', () => {
  assert.equal(numeracion.proximoNumero('documentos_recibidos', iglesia, '2027-01-02'), 'REC-001-2027');
});

test('el prefijo de cada libro lo pone la iglesia', () => {
  /*
   * Y cambiarlo EMPIEZA UNA SERIE NUEVA: del libro se cuentan solo los números
   * que siguen el formato de hoy, así que «REC-001-2026» deja de contar cuando
   * el prefijo pasa a «ENT/». Conviene saberlo antes de cambiarlo a mitad de
   * año: el libro queda con dos series, y el número se puede escribir a mano
   * para empalmar donde corresponda.
   */
  try {
    ajustes.guardar('documento_recibido_prefijo', 'ENT/');
    assert.equal(numeracion.proximoNumero('documentos_recibidos', iglesia, '2026-05-05'), 'ENT/001-2026');
  } finally {
    // Pase lo que pase: el prefijo es global, y dejarlo cambiado le mueve el
    // piso a todas las pruebas que vienen después
    ajustes.guardar('documento_recibido_prefijo', 'REC-');
  }
  assert.equal(numeracion.proximoNumero('documentos_recibidos', iglesia, '2026-05-05'), 'REC-002-2026');
});

/* ── Lo que no pasó por la oficina ─────────────────────────────────── */

const guardando = (datos, existing = null) => {
  const copia = { ...datos };
  const error = def.hooks.beforeSave(copia, { existing, db });
  return { error, datos: copia };
};

test('lo interno no lleva número, aunque se escriba uno', () => {
  // Un número de oficina de partes en una escritura diría que esa escritura
  // entró un día por la oficina, y no entró.
  const { datos } = guardando({
    titulo: 'Escritura', flujo: 'Interno o de archivo', numero: 'REC-999-2026', iglesia_id: iglesia,
  });
  assert.equal(datos.numero, null);
});

test('y no se le inventa una fecha de registro', () => {
  const { datos } = guardando({ titulo: 'Escritura', flujo: 'Interno o de archivo', iglesia_id: iglesia });
  assert.equal(datos.fecha_registro, undefined);
});

test('a lo que sí pasó, sin fecha de registro, se le pone la del documento', () => {
  const { datos } = guardando({
    titulo: 'Carta', flujo: 'Recibido', iglesia_id: iglesia, fecha: '2026-03-04',
  });
  assert.equal(datos.fecha_registro, '2026-03-04');
});

/* ── Lo que aplica a un flujo no se queda escrito del otro ─────────── */

test('al pasar de recibido a emitido no queda el remitente de antes', () => {
  // Un documento emitido con remitente es un dato que contradice al otro, y
  // en un libro los dos se leen como ciertos.
  const antes = { flujo: 'Recibido', remitente: 'La municipalidad', derivado_a: 'Alguien' };
  const { datos } = guardando({ ...antes, flujo: 'Emitido', destinatario: 'La corporación' }, antes);
  assert.equal(datos.remitente, null);
  assert.equal(datos.derivado_a, null);
  assert.equal(datos.destinatario, 'La corporación');
});

test('y al revés tampoco queda el destinatario', () => {
  const antes = { flujo: 'Emitido', destinatario: 'La corporación' };
  const { datos } = guardando({ ...antes, flujo: 'Recibido', remitente: 'La municipalidad' }, antes);
  assert.equal(datos.destinatario, null);
  assert.equal(datos.firmado_por, null);
});

test('solo un documento emitido responde a otro', () => {
  const { datos } = guardando({ titulo: 'x', flujo: 'Recibido', responde_a: 7, iglesia_id: iglesia });
  assert.equal(datos.responde_a, null);
});

test('un documento no puede ser la respuesta de sí mismo', () => {
  const error = guardando({ flujo: 'Emitido', responde_a: 42 }, { id: 42, flujo: 'Emitido' }).error;
  assert.match(String(error), /respuesta de sí mismo/);
});

test('no se borra un documento al que otros responden', () => {
  const recibido = registrar('Recibido', 'REC-050-2026', '2026-06-01');
  db.prepare(
    `INSERT INTO documentos (titulo, flujo, numero, iglesia_id, responde_a)
     VALUES ('La respuesta', 'Emitido', 'EMI-050-2026', ?, ?)`
  ).run(iglesia, recibido);
  const error = def.hooks.beforeDelete({ id: recibido }, { db });
  assert.match(String(error), /sin decir a qué contestan/);
  assert.match(String(error), /Archivado/);   // dice la salida, no solo el problema
});

/* ── Los documentos que ya estaban ─────────────────────────────────── */

test('EL CASO DELICADO: lo que ya estaba se clasifica sin perder nada', () => {
  const antes = db.prepare('SELECT COUNT(*) c FROM documentos').get().c;

  const viejo = db.prepare(
    'INSERT INTO documentos (titulo, tipo, fecha, iglesia_id) VALUES (?, ?, ?, ?)'
  );
  const ids = {
    recibida: viejo.run('De la muni', 'Correspondencia recibida', '2020-03-04', otra).lastInsertRowid,
    enviada: viejo.run('A la muni', 'Correspondencia enviada', '2020-03-11', otra).lastInsertRowid,
    escritura: viejo.run('Escritura del templo', 'Escritura / Propiedad', '2019-06-30', otra).lastInsertRowid,
    contrato: viejo.run('Arriendo', 'Contrato', '2018-02-15', otra).lastInsertRowid,
  };

  documentosALaOficinaDePartes();

  const la = (id) => db.prepare('SELECT * FROM documentos WHERE id = ?').get(id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM documentos').get().c, antes + 4, 'se perdió alguno');

  assert.equal(la(ids.recibida).flujo, 'Recibido');
  assert.equal(la(ids.enviada).flujo, 'Emitido');
  // Lo que no entró ni salió NO se fuerza a un flujo que no tuvo
  assert.equal(la(ids.escritura).flujo, 'Interno o de archivo');
  assert.equal(la(ids.contrato).flujo, 'Interno o de archivo');
});

test('a los que van al libro se les da su correlativo, y a los otros no', () => {
  const porTitulo = (t) => db.prepare('SELECT * FROM documentos WHERE titulo = ?').get(t);
  assert.match(String(porTitulo('De la muni').numero), /^REC-\d{3}-2020$/);
  assert.match(String(porTitulo('A la muni').numero), /^EMI-\d{3}-2020$/);
  assert.equal(porTitulo('Escritura del templo').numero, null);
  assert.equal(porTitulo('Arriendo').numero, null);
});

test('y conservan su fecha, que es el único orden reconstruible', () => {
  const d = db.prepare("SELECT * FROM documentos WHERE titulo = 'De la muni'").get();
  assert.equal(d.fecha, '2020-03-04');
  assert.equal(d.fecha_registro, '2020-03-04');
});

test('correrla de nuevo no reclasifica ni renumera nada', () => {
  const antes = db.prepare('SELECT id, flujo, numero FROM documentos ORDER BY id').all();
  documentosALaOficinaDePartes();
  assert.deepEqual(db.prepare('SELECT id, flujo, numero FROM documentos ORDER BY id').all(), antes);
});
