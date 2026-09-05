/**
 * UNA EVALUACIÓN SIN INFORME NO ES UNA EVALUACIÓN.
 *
 * La cabecera de este módulo dice qué queda anotado en cada una: «su fecha,
 * quién decidió y el informe —adjunto como documento o escrito acá mismo—».
 * Las tres cosas. Medido en la v1.399.0, una con la fecha y el resultado y
 * nada más:
 *
 *   evaluado_por = (vacío)
 *   informe      = (vacío)
 *   documento    = (vacío)
 *   resultado    = Aprobado   → 201, y la ficha pasó a integrante oficial
 *
 * El acta de la decisión más importante que se toma sobre una persona en un
 * cuerpo podía quedar sin decir quién la tomó ni por qué, y mover su estado
 * igual. No es un dato que se pierda —nunca se escribió— pero el módulo
 * prometía una cosa y admitía otra.
 *
 * El informe puede venir de las dos maneras y basta con UNA: hay directivas
 * que lo escriben en el sistema y hay directivas que suben el papel firmado.
 * Por eso no se exige el campo —eso obligaría a las dos— sino que haya alguna.
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
  .run(`Central IN ${marca}`, `IN-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas IN ${marca}`, iglesia).lastInsertRowid;

function enPrueba() {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve IN ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', '2026-01-10', '2026-04-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve IN ${marca}`, iglesia).lastInsertRowid;
}

const alGuardar = (extra) => evaluaciones.hooks.beforeSave(
  { integrante_id: enPrueba(), fecha: '2026-05-20', resultado: 'Aprobado', ...extra },
  { existing: null, db },
);

test('con el informe escrito acá mismo, entra', () => {
  assert.equal(alGuardar({ evaluado_por: 'La directiva', informe: '<p>Cumplió</p>' }), null);
});

test('con el documento firmado adjunto y sin escribir nada, también', () => {
  // Son dos maneras legítimas de lo mismo, y el módulo promete las dos.
  assert.equal(alGuardar({ evaluado_por: 'La directiva', documento: 'informe.pdf' }), null);
});

test('sin ninguna de las dos, no', () => {
  const aviso = alGuardar({ evaluado_por: 'La directiva' });
  assert.match(String(aviso), /en qué se basa/);
  assert.match(String(aviso), /escriba el informe acá mismo o adjunte el documento/,
    'el aviso dice las dos salidas, porque cualquiera sirve');
});

test('un informe de puras etiquetas vacías es no traer informe', () => {
  // El editor de texto con formato deja «<p></p>» cuando se entra y se sale sin
  // escribir: eso no es un informe, es una caja vacía con etiquetas.
  assert.ok(alGuardar({ evaluado_por: 'La directiva', informe: '<p></p><br>' }));
  assert.ok(alGuardar({ evaluado_por: 'La directiva', informe: '<p>   </p>' }));
});

test('quién evaluó es obligatorio, y el campo lo declara', () => {
  const campo = evaluaciones.fields.find((f) => f.name === 'evaluado_por');
  assert.equal(campo.required, true,
    'el acta de una decisión sin quién la tomó no sirve para preguntarle a nadie');
  assert.ok((campo.sugerencias || []).length >= 3,
    'y se ofrecen las instancias de siempre, para que no se escriba cada vez distinto');
});

test('por la puerta: lo vacío se rechaza y lo completo entra', async () => {
  const api = await elSistemaAndando();

  const vacia = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: enPrueba(), fecha: '2026-05-20', resultado: 'Aprobado' });
  assert.equal(vacia.estado, 400, vacia.texto);
  assert.match(vacia.json.error, /Evaluado por/, 'lo primero que falta es quién decidió');

  const sinInforme = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: enPrueba(), fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'La directiva' });
  assert.equal(sinInforme.estado, 400, sinInforme.texto);
  assert.match(sinInforme.json.error, /en qué se basa/);

  const ficha = enPrueba();
  const completa = await api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', resultado: 'Aprobado',
    evaluado_por: 'La directiva del cuerpo', informe: '<p>Cumplió con lo pedido.</p>',
  });
  assert.equal(completa.estado, 201, completa.texto);
  assert.equal(db.prepare('SELECT estado FROM integrantes_cuerpo WHERE id = ?').get(ficha).estado, 'Activo');
});

test('lo de quién se puede evaluar se dice antes que lo del informe', async () => {
  /*
   * El orden importa para quien lo lee: primero se dice que esa persona no
   * corresponde y recién después se le pide el informe, que es el orden en que
   * uno lo arreglaría. Al revés, alguien escribiría un informe entero para una
   * evaluación que de todos modos no se puede hacer.
   */
  const api = await elSistemaAndando();
  const oficial = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_oficial, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2019-04-20', '2020-01-15', ?)`
  ).run(cuerpo,
    db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
      .run(`Quien${++n}`, `Sirve IN ${marca}`, iglesia).lastInsertRowid,
    `Quien${n} Sirve IN ${marca}`, iglesia).lastInsertRowid;

  const r = await api('POST', '/evaluaciones_integrantes',
    { integrante_id: oficial, fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'La directiva' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /ya es integrante oficial/, 'y no lo del informe');
});
