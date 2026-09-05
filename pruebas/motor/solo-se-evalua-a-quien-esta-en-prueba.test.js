/**
 * ESTO EVALÚA UN PERÍODO DE PRUEBA, ASÍ QUE HACE FALTA QUE HAYA UNO.
 *
 * La pantalla ya lo sabía: el botón «📋 Evaluar» de la lista del cuerpo
 * aparece SOLO cuando el estado del integrante es «En prueba». El servidor no
 * comprobaba nada, y lo que la pantalla no ofrece el servidor lo tiene que
 * rechazar de todas maneras —está escrito así, con esas palabras, en el gancho
 * de server/modules/integrantes_cuerpo.js para la regla de al lado—.
 *
 * Medido en la v1.399.0, aprobando por la API a quien no está en prueba:
 *
 *   a quien ya es integrante oficial ..  201 · y le reescribe la fecha de
 *                                        oficial: de 15-01-2020 pasó a
 *                                        25-05-2026
 *   a quien ya se retiró .............   201 · y vuelve a «Activo»
 *                                        conservando su retiro del 30-06-2025
 *   de un cuerpo disuelto ............   201 · al mismo cuerpo no se le puede
 *                                        meter un integrante nuevo
 *
 * Las dos primeras dejan la ficha diciendo dos cosas a la vez, y la primera
 * borra el historial de alguien sin avisar: basta evaluar a la persona
 * equivocada de una lista de 630.
 *
 * La regla vale para las DOS puertas —el formulario y la planilla— porque
 * vive en el gancho, que es por donde pasan las dos. Y no alcanza a la
 * corrección de lo ya anotado: para entonces la ficha ya se movió, y exigirle
 * «En prueba» dejaría sin arreglar justamente lo que se anotó mal.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const evaluaciones = require('../../server/modules/evaluaciones_integrantes');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central EP ${marca}`, `EP-${marca}`).lastInsertRowid;

function unCuerpo(estado = 'Activo', tipo = 'Cuerpo') {
  return db.prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,?,?,?)')
    .run(`Damas ${++n} EP ${marca}`, tipo, iglesia, estado).lastInsertRowid;
}

function unaFicha(cuerpo, estado, campos = {}) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve EP ${marca}`, iglesia).lastInsertRowid;
  const id = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_oficial, fecha_retiro, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, ?, ?, ?, ?, ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve EP ${marca}`, estado,
    campos.fecha_ingreso || '2026-03-01', campos.fecha_oficial || null,
    campos.fecha_retiro || null, iglesia).lastInsertRowid;
  return id;
}

/** Lo que contesta el gancho al anotar una evaluación NUEVA. */
const alEvaluar = (integranteId, extra = {}) => evaluaciones.hooks.beforeSave(
  { integrante_id: integranteId, fecha: '2026-05-20', resultado: 'Aprobado', informe: '<p>Cumplió con lo pedido.</p>', evaluado_por: 'X', ...extra },
  { existing: null, db },
);

test('a quien está en prueba se le evalúa, que es para lo que existe', () => {
  const ficha = unaFicha(unCuerpo(), 'En prueba');
  assert.equal(alEvaluar(ficha), null);
});

test('a quien ya es integrante oficial no, y el aviso dice desde cuándo lo es', () => {
  const ficha = unaFicha(unCuerpo(), 'Activo', { fecha_ingreso: '2019-04-20', fecha_oficial: '2020-01-15' });
  const aviso = alEvaluar(ficha);
  assert.match(String(aviso), /ya es integrante oficial/);
  assert.match(String(aviso), /15-01-2020/, 'la fecha se lee como en Chile');
  assert.match(String(aviso), /cámbiele el estado en su ficha de integrante/,
    'el aviso dice por dónde se hace lo que se quería hacer');
});

test('a quien ya se retiró tampoco, y el aviso dice cómo devolverlo', () => {
  const ficha = unaFicha(unCuerpo(), 'Retirado', { fecha_ingreso: '2024-01-15', fecha_retiro: '2025-06-30' });
  const aviso = alEvaluar(ficha);
  assert.match(String(aviso), /ya no pertenece/);
  assert.match(String(aviso), /30-06-2025/);
  assert.match(String(aviso), /póngala «En prueba»/,
    'y es la puerta que la 1.397.0 dejó abierta');
});

test('el aviso nombra a la persona y a su cuerpo, no un número', () => {
  const cuerpo = unCuerpo();
  const nombre = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpo).nombre;
  const ficha = unaFicha(cuerpo, 'Activo');
  const aviso = String(alEvaluar(ficha));
  assert.match(aviso, new RegExp(`Quien${n} Sirve EP ${marca}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(aviso.includes(nombre), 'y el cuerpo por su nombre');
});

test('ni de un cuerpo que dejó de funcionar', () => {
  const ficha = unaFicha(unCuerpo('Inactivo'), 'En prueba');
  const aviso = alEvaluar(ficha);
  assert.match(String(aviso), /marcado como inactivo/);
  assert.match(String(aviso), /evaluar períodos de prueba/,
    'usa el aviso que el sistema ya tiene escrito, con lo que se quiso hacer');
});

test('corregir una evaluación YA anotada se sigue pudiendo, con la ficha movida', () => {
  // Para entonces la ficha está «Activo» porque la evaluación la movió: pedirle
  // «En prueba» dejaría sin arreglar justamente lo que se anotó mal.
  const ficha = unaFicha(unCuerpo(), 'Activo', { fecha_oficial: '2026-05-20' });
  const aviso = evaluaciones.hooks.beforeSave(
    { integrante_id: ficha, fecha: '2026-05-20', resultado: 'Aprobado', informe: '<p>Cumplió con lo pedido.</p>', evaluado_por: 'La directiva' },
    { existing: { id: 1, integrante_id: ficha, resultado: 'Aprobado', fecha: '2026-05-20' }, db },
  );
  assert.equal(aviso, null);
});

test('y por la puerta, con las dos maneras de anotar una', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const enPrueba = unaFicha(cuerpo, 'En prueba');
  const oficial = unaFicha(cuerpo, 'Activo', { fecha_oficial: '2020-01-15' });

  const bien = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: enPrueba, fecha: '2026-05-20', resultado: 'Aprobado', informe: '<p>Cumplió con lo pedido.</p>', evaluado_por: 'La directiva' });
  assert.equal(bien.estado, 201, bien.texto);

  const mal = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: oficial, fecha: '2026-05-20', resultado: 'Aprobado', informe: '<p>Cumplió con lo pedido.</p>', evaluado_por: 'La directiva' });
  assert.equal(mal.estado, 400, 'por formulario');
  assert.match(mal.json.error, /ya es integrante oficial/);

  // La planilla pasa por el mismo gancho, así que pide lo mismo. Antes de esto
  // una planilla de diez filas sacaba de su cuerpo a diez personas, cinco de
  // ellas integrantes oficiales, sin una pregunta.
  const planilla = await api('POST', '/importar/evaluaciones_integrantes?prueba=0', {
    prueba: false,
    filas: [{ integrante_id: oficial, fecha: '2026-05-30', resultado: 'Retirado del cuerpo', informe: '<p>Cumplió con lo pedido.</p>', evaluado_por: 'Planilla' }],
  });
  assert.equal(planilla.estado, 200, planilla.texto);
  assert.equal(planilla.json.correctas, 0, 'por planilla tampoco');
  assert.match(JSON.stringify(planilla.json.errores), /ya es integrante oficial/);

  const quedo = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(oficial);
  assert.equal(quedo.estado, 'Activo');
  assert.equal(quedo.fecha_oficial, '2020-01-15', 'su fecha de oficial quedó intacta');
});
