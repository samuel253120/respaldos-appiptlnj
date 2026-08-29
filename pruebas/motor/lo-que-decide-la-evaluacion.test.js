/**
 * LA EVALUACIÓN DEL PERÍODO DE PRUEBA NO QUEDABA EN NINGUNA PARTE.
 *
 * Medido contra el servidor, sobre una miembro que entra a un cuerpo en período
 * de prueba y a la que después se le aprueba la evaluación:
 *
 *   la ficha del integrante quedó ....  estado=Activo · fecha_oficial=2026-07-10
 *   su bitácora, antes ...............  2 anotaciones
 *   su bitácora, después .............  2 anotaciones
 *
 * La decisión más importante que se toma sobre alguien en un cuerpo —si pasa a
 * integrante oficial, si se le extiende la prueba o si no continúa— era la única
 * que no quedaba escrita en su historial. Y no por olvido: la evaluación mueve
 * la ficha con un UPDATE directo, y tiene que ser directo, porque escribe
 * campos de solo lectura que el motor no dejaría pasar. Por ese camino el motor
 * no se entera, así que hay que anotarlo desde ahí.
 *
 * Lo que cuida este archivo:
 *   · que los tres resultados queden anotados, cada uno con su texto
 *   · que se anoten en la FECHA DE LA EVALUACIÓN, que es cuando se decidió
 *   · que corregirle el informe a una evaluación no lo vuelva a anotar, y que
 *     cambiarle el resultado sí
 *   · que a quien no está en la membresía no se le anote nada, y que su ficha
 *     se mueva igual
 *   · y que los dos caminos que llevan al mismo hecho —el cambio de estado a
 *     mano y la evaluación— digan lo mismo, porque el texto se arma una vez
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const registry = require('../../server/registry');

const USUARIO = { id: 1, nombre: 'Quien Evalúa' };
const EVALUACIONES = registry.getModule('evaluaciones_integrantes');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la evaluación', 'IG-LDE', 'Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de la Prueba', 'Dorcas', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

const unMiembro = (nombres) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, 'De la Prueba', ?, 'Activo')")
  .run(nombres, iglesia).lastInsertRowid;

/** Una ficha de integrante en período de prueba, con o sin miembro detrás. */
function enPrueba(miembroId) {
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso, persona, persona_tipo)
     VALUES (?, ?, ?, 'En prueba', '2026-01-15', 'Quien Sea', ?)`
  ).run(cuerpo, miembroId, iglesia, miembroId ? 'Miembro' : 'No miembro').lastInsertRowid;
}

/** Guardar una evaluación como lo hace el motor, y devolver lo que quedó anotado. */
function alEvaluar(fila, contexto = {}) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  EVALUACIONES.hooks.afterSave(fila, { db, user: USUARIO, isNew: true, existing: null, ...contexto });
  return db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde);
}

/* ------------------------------- los tres resultados */

test('aprobar la evaluación queda escrito en el historial de la persona', () => {
  const ana = unMiembro('Ana');
  const ficha = enPrueba(ana);
  const [fila] = alEvaluar({ id: 1, integrante_id: ficha, fecha: '2026-07-10', resultado: 'Aprobado' });
  assert.ok(fila, 'antes no quedaba nada anotado: la bitácora seguía igual');
  assert.equal(fila.miembro_id, ana);
  assert.equal(fila.descripcion, 'Queda como integrante oficial de "Damas de la Prueba".');
  assert.equal(fila.iglesia_id, iglesia);
});

test('y en la fecha de la evaluación, que es cuando se decidió', () => {
  const rosa = unMiembro('Rosa');
  const ficha = enPrueba(rosa);
  const [fila] = alEvaluar({ id: 2, integrante_id: ficha, fecha: '2026-07-10', resultado: 'Aprobado' });
  assert.equal(fila.fecha, '2026-07-10',
    'así queda entre su ingreso al cuerpo y lo que vino después, y no arriba del todo');
  // Y es la misma que la evaluación le escribió a la ficha
  const quedo = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(ficha);
  assert.equal(quedo.fecha_oficial, '2026-07-10');
  assert.equal(quedo.estado, 'Activo');
});

test('no continuar en el cuerpo se anota como una salida, con su motivo', () => {
  const elba = unMiembro('Elba');
  const ficha = enPrueba(elba);
  const [fila] = alEvaluar({ id: 3, integrante_id: ficha, fecha: '2026-07-11', resultado: 'Retirado del cuerpo' });
  assert.equal(fila.tipo, 'Salida de cuerpo');
  assert.equal(fila.descripcion, 'Sale de "Damas de la Prueba" (No aprobó su período de prueba).');
  assert.equal(fila.fecha, '2026-07-11');
});

test('el motivo que se anota es el que quedó en la ficha, no el que traía antes', () => {
  // La evaluación lo escribe con COALESCE: si la ficha ya traía uno, ese manda.
  const nora = unMiembro('Nora');
  const ficha = enPrueba(nora);
  db.prepare("UPDATE integrantes_cuerpo SET motivo_retiro = 'Se cambió de ciudad' WHERE id = ?").run(ficha);
  const [fila] = alEvaluar({ id: 4, integrante_id: ficha, fecha: '2026-07-11', resultado: 'Retirado del cuerpo' });
  assert.match(fila.descripcion, /\(Se cambió de ciudad\)/,
    'se lee la ficha después del UPDATE, para que diga lo que de verdad quedó');
});

test('extender la prueba se anota, y dice hasta cuándo', () => {
  const delia = unMiembro('Delia');
  const ficha = enPrueba(delia);
  const [fila] = alEvaluar({
    id: 5, integrante_id: ficha, fecha: '2026-07-12',
    resultado: 'No aprobado (se extiende la prueba)', meses_extension: 6,
  });
  assert.equal(fila.descripcion,
    'Se le extiende el período de prueba en "Damas de la Prueba" hasta el 12-01-2027.');
  assert.equal(fila.fecha, '2026-07-12');
  const quedo = db.prepare('SELECT fecha_fin_prueba FROM integrantes_cuerpo WHERE id = ?').get(ficha);
  assert.equal(quedo.fecha_fin_prueba, '2027-01-12', 'y es el plazo que de verdad quedó en la ficha');
});

/* ------------------------------- corregir no es volver a decidir */

test('corregirle el informe a una evaluación no lo vuelve a anotar', () => {
  const berta = unMiembro('Berta');
  const ficha = enPrueba(berta);
  const evaluacion = { id: 6, integrante_id: ficha, fecha: '2026-07-13', resultado: 'Aprobado' };
  alEvaluar(evaluacion);
  const otra = alEvaluar(
    { ...evaluacion, observaciones: 'Se corrige una falta de ortografía.' },
    { isNew: false, existing: evaluacion }
  );
  assert.equal(otra.length, 0, 'no pasó nada nuevo: no hay nada que anotar');
});

test('cambiarle el resultado sí, porque pasó otra cosa', () => {
  const sofia = unMiembro('Sofía');
  const ficha = enPrueba(sofia);
  const evaluacion = { id: 7, integrante_id: ficha, fecha: '2026-07-13', resultado: 'Aprobado' };
  alEvaluar(evaluacion);
  const [fila] = alEvaluar(
    { ...evaluacion, resultado: 'Retirado del cuerpo' },
    { isNew: false, existing: evaluacion }
  );
  assert.ok(fila, 'la ficha se movió y el historial tiene que decirlo');
  assert.equal(fila.tipo, 'Salida de cuerpo');
  const suyas = db.prepare('SELECT * FROM bitacora WHERE miembro_id = ? ORDER BY id').all(sofia);
  assert.equal(suyas.length, 2, 'quedan las dos, en orden: lo que se decidió y lo que se corrigió');
});

/* ------------------------------- quien no está en la membresía */

test('a quien no está inscrito no se le anota nada, y su ficha se mueve igual', () => {
  const suelta = enPrueba(null);
  const antes = db.prepare('SELECT COUNT(*) c FROM bitacora').get().c;
  alEvaluar({ id: 8, integrante_id: suelta, fecha: '2026-07-14', resultado: 'Aprobado' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bitacora').get().c, antes,
    'en los grupos sirve gente de fuera del registro, y esa gente no tiene bitácora');
  const quedo = db.prepare('SELECT estado FROM integrantes_cuerpo WHERE id = ?').get(suelta);
  assert.equal(quedo.estado, 'Activo', 'lo que no se anota es la línea, no el hecho');
});

test('y una evaluación de una ficha que ya no existe no revienta', () => {
  assert.doesNotThrow(() => bitacora.anotarPasoDeIntegrante(999999, {
    estado: 'Activo', fecha: '2026-07-14', usuario: USUARIO,
  }));
  assert.doesNotThrow(() => bitacora.anotarPasoDeIntegrante(null, {
    estado: 'Activo', fecha: '2026-07-14', usuario: USUARIO,
  }));
});

/* ------------------------------- los dos caminos dicen lo mismo */

test('el cambio de estado a mano y la evaluación escriben el mismo texto', () => {
  /*
   * Son dos caminos al mismo hecho. Si cada uno armara su frase, el día en que
   * alguien cambie una, el historial de una misma persona diría dos cosas
   * distintas para lo mismo según por dónde se hubiera hecho.
   */
  const carmen = unMiembro('Carmen');
  const suFicha = enPrueba(carmen);
  const [porLaEvaluacion] = alEvaluar({ id: 9, integrante_id: suFicha, fecha: '2026-07-15', resultado: 'Aprobado' });

  const luisa = unMiembro('Luisa');
  const otraFicha = enPrueba(luisa);
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(registry.getModule('integrantes_cuerpo'), {
    isNew: false, antes: { estado: 'En prueba' },
    despues: { id: otraFicha, miembro_id: luisa, cuerpo_id: cuerpo, iglesia_id: iglesia, estado: 'Activo' },
    datos: { estado: 'Activo' }, user: USUARIO,
  });
  const [aMano] = db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde);
  assert.equal(aMano.descripcion, porLaEvaluacion.descripcion);
  assert.equal(aMano.tipo, porLaEvaluacion.tipo);

  const src = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  assert.equal((src.match(/Queda como integrante oficial de/g) || []).length, 1,
    'el texto se arma en un solo sitio, para que no puedan separarse');
  assert.equal((src.match(/Sale de "\$\{nombreCuerpo\}"/g) || []).length, 1);
});

test('lo que cambia entre los dos caminos es la fecha, y por una razón', () => {
  // La evaluación sabe qué día se decidió; el cambio a mano no tiene esa fecha
  // en ninguna parte —«Pasó a integrante oficial el» es de solo lectura y lo
  // escribe la evaluación—, así que lo que pasa es que alguien la marcó hoy.
  const hoy = require('../../server/fechas').hoy();
  const irma = unMiembro('Irma');
  const suFicha = enPrueba(irma);
  const [porLaEvaluacion] = alEvaluar({ id: 10, integrante_id: suFicha, fecha: '2026-07-15', resultado: 'Aprobado' });
  assert.equal(porLaEvaluacion.fecha, '2026-07-15');

  const eva = unMiembro('Eva');
  const otraFicha = enPrueba(eva);
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(registry.getModule('integrantes_cuerpo'), {
    isNew: false, antes: { estado: 'En prueba' },
    despues: { id: otraFicha, miembro_id: eva, cuerpo_id: cuerpo, iglesia_id: iglesia, estado: 'Activo' },
    datos: { estado: 'Activo' }, user: USUARIO,
  });
  const [aMano] = db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde);
  assert.equal(aMano.fecha, hoy);
});

test('el ingreso al cuerpo y el retiro a mano siguen anotándose como antes', () => {
  const paula = unMiembro('Paula');
  const def = registry.getModule('integrantes_cuerpo');
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(def, {
    isNew: true, antes: {},
    despues: { id: 991, miembro_id: paula, cuerpo_id: cuerpo, iglesia_id: iglesia,
      estado: 'En prueba', fecha_ingreso: '2026-01-15' },
    datos: {}, user: USUARIO,
  });
  bitacora.registrarGuardado(def, {
    isNew: false, antes: { estado: 'Activo' },
    despues: { id: 991, miembro_id: paula, cuerpo_id: cuerpo, iglesia_id: iglesia,
      estado: 'Retirado', fecha_retiro: '2026-06-30', motivo_retiro: 'Traslado de ciudad' },
    datos: { estado: 'Retirado' }, user: USUARIO,
  });
  const filas = db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde);
  assert.equal(filas[0].tipo, 'Ingreso a cuerpo');
  assert.equal(filas[0].fecha, '2026-01-15');
  assert.equal(filas[0].descripcion, 'Ingresa a "Damas de la Prueba" en período de prueba.');
  assert.equal(filas[1].tipo, 'Salida de cuerpo');
  assert.equal(filas[1].fecha, '2026-06-30');
  assert.equal(filas[1].descripcion, 'Sale de "Damas de la Prueba" (Traslado de ciudad).');
});
