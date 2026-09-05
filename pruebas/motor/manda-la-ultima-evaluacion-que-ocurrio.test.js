/**
 * LA QUE MANDA ES LA ÚLTIMA QUE OCURRIÓ, NO LA ÚLTIMA QUE SE ESCRIBIÓ.
 *
 * La evaluación mueve la ficha del integrante, y lo hacía con LO QUE SE ACABA
 * DE GUARDAR, sin mirar si había otra posterior. Medido en la v1.399.0, sobre
 * alguien aprobado el 20-05-2026, anotando después una del 01-04-2026 que lo
 * retira: 201, y la ficha quedaba
 *
 *   estado  = Retirado
 *   retiro  = 01-04-2026
 *   oficial = 20-05-2026   ← de la aprobación que quedó deshecha
 *
 * O sea, contradiciéndose sola. Lo mismo al corregirle el resultado a una
 * evaluación ya guardada que no era la última.
 *
 * Un integrante tiene varias evaluaciones cuando su prueba se extiende, que es
 * el caso corriente: «No aprobado» lo deja en prueba, así que se le vuelve a
 * evaluar. Ahí es donde importa cuál manda.
 *
 * Ahora la ficha se rehace con la última por fecha, y a igual fecha con la que
 * se anotó después —el id—, porque dos del mismo día solo se pueden ordenar
 * por cuándo se escribieron.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central UL ${marca}`, `UL-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas UL ${marca}`, iglesia).lastInsertRowid;

function enPrueba() {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve UL ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', '2026-01-10', '2026-04-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve UL ${marca}`, iglesia).lastInsertRowid;
}

const laFicha = (id) => db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(id);

const NO_APROBADO = 'No aprobado (se extiende la prueba)';

test('corregir una evaluación vieja no deshace la decisión posterior', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const evaluar = (datos) => api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, evaluado_por: 'La directiva', ...datos });

  const vieja = await evaluar({ fecha: '2026-04-01', resultado: NO_APROBADO, meses_extension: 2 });
  assert.equal(vieja.estado, 201, vieja.texto);
  const ultima = await evaluar({ fecha: '2026-07-10', resultado: NO_APROBADO, meses_extension: 3 });
  assert.equal(ultima.estado, 201, ultima.texto);
  assert.equal(laFicha(ficha).fecha_fin_prueba, '2026-10-10', 'manda la última: 10-07 más tres meses');

  // Se corrige la VIEJA a «Aprobado». Antes, eso pasaba la ficha a Activo con
  // fecha 01-04, deshaciendo la extensión posterior.
  const corregida = await api('PUT', `/evaluaciones_integrantes/${vieja.json.id}`,
    { integrante_id: ficha, fecha: '2026-04-01', resultado: 'Aprobado', evaluado_por: 'La directiva' });
  assert.equal(corregida.estado, 200, corregida.texto);

  const quedo = laFicha(ficha);
  assert.equal(quedo.estado, 'En prueba', 'sigue mandando la del 10-07');
  assert.equal(quedo.fecha_fin_prueba, '2026-10-10');
  assert.equal(quedo.fecha_oficial, null, 'y no le queda una fecha de oficial de una decisión deshecha');
});

test('pero corregir la ÚLTIMA sí mueve la ficha, que es para lo que se corrige', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const evaluar = (datos) => api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, evaluado_por: 'La directiva', ...datos });

  await evaluar({ fecha: '2026-04-01', resultado: NO_APROBADO, meses_extension: 2 });
  const ultima = await evaluar({ fecha: '2026-07-10', resultado: NO_APROBADO, meses_extension: 3 });

  const corregida = await api('PUT', `/evaluaciones_integrantes/${ultima.json.id}`,
    { integrante_id: ficha, fecha: '2026-07-10', resultado: 'Aprobado', evaluado_por: 'La directiva' });
  assert.equal(corregida.estado, 200, corregida.texto);

  const quedo = laFicha(ficha);
  assert.equal(quedo.estado, 'Activo');
  assert.equal(quedo.fecha_oficial, '2026-07-10');
  assert.equal(quedo.fecha_fin_prueba, null);
});

test('anotar tarde una evaluación vieja tampoco deshace la posterior', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const evaluar = (datos) => api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, evaluado_por: 'La directiva', ...datos });

  await evaluar({ fecha: '2026-07-10', resultado: NO_APROBADO, meses_extension: 3 });
  assert.equal(laFicha(ficha).fecha_fin_prueba, '2026-10-10');

  // Se anota ahora una del 01-04 que lo aprueba: es un hecho anterior.
  const tarde = await evaluar({ fecha: '2026-04-01', resultado: 'Aprobado' });
  assert.equal(tarde.estado, 201, tarde.texto);

  const quedo = laFicha(ficha);
  assert.equal(quedo.estado, 'En prueba', 'sigue mandando la del 10-07');
  assert.equal(quedo.fecha_fin_prueba, '2026-10-10');
  assert.equal(quedo.fecha_oficial, null);
});

test('dos del mismo día: manda la que se anotó después', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const evaluar = (datos) => api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, evaluado_por: 'La directiva', ...datos });

  await evaluar({ fecha: '2026-06-01', resultado: NO_APROBADO, meses_extension: 2 });
  const segunda = await evaluar({ fecha: '2026-06-01', resultado: 'Aprobado' });
  assert.equal(segunda.estado, 201, segunda.texto);

  const quedo = laFicha(ficha);
  assert.equal(quedo.estado, 'Activo', 'la fecha no las distingue: las distingue el orden en que se escribieron');
  assert.equal(quedo.fecha_oficial, '2026-06-01');
});

test('la bitácora anota EL HECHO, no el estado que quedó', async () => {
  // Que a alguien se le anotara tarde una evaluación vieja es algo que pasó, y
  // su libro tiene que decirlo aunque la ficha no se mueva por eso.
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  const miembro = laFicha(ficha).miembro_id;
  const evaluar = (datos) => api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, evaluado_por: 'La directiva', ...datos });

  await evaluar({ fecha: '2026-07-10', resultado: NO_APROBADO, meses_extension: 3 });
  await evaluar({ fecha: '2026-04-01', resultado: 'Aprobado' });

  const lineas = db.prepare(
    "SELECT * FROM bitacora WHERE miembro_id = ? ORDER BY id"
  ).all(miembro);
  const texto = lineas.map((l) => `${l.fecha} ${l.descripcion}`).join(' | ');
  assert.match(texto, /2026-04-01/, 'la evaluación anotada tarde dejó su línea');
  assert.match(texto, /2026-07-10/, 'y la anterior también');
});
