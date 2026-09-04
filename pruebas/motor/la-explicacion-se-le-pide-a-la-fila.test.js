/**
 * LA REGLA QUE ESTE MÓDULO EXISTE PARA SOSTENER, ANCLADA A LA FILA DEL MOTIVO.
 *
 * Cada motivo dice en su ficha si PIDE EXPLICACIÓN, y el argumento del módulo
 * es exacto: «"Otro motivo" sin explicación no dice nada tres meses después,
 * cuando alguien revisa por qué un integrante figura ausente medio año».
 *
 * Esa regla se decidía comparando el motivo contra una LISTA DE NOMBRES
 * exactos, y la comprobación de obligatorios del motor corre ANTES de que el
 * motivo quede escrito como está en la lista. Así que bastaba con escribirlo
 * distinto para que no calzara con ninguno y el detalle dejara de exigirse.
 *
 * MEDIDO en la v1.362.0, antes de comprobar el motivo contra la tabla: con
 * «Otro motivoo» —una letra de más— la marca entró con un 200 y sin una
 * palabra de por qué. Y MEDIDO otra vez en la v1.363.0, ya con el motivo
 * comprobado y normalizado:
 *
 *   «Otro motivo» sin explicación ....... 400 · lo exige
 *   «otro motivo» sin explicación ....... 201 · GUARDADA, detalle en blanco
 *   «OTRO MOTIVO» sin explicación ....... 201 · GUARDADA, detalle en blanco
 *
 * Las tres quedaban guardadas con el mismo motivo —el de la lista— y solo la
 * primera con explicación. No hace falta mala intención: hace falta un dedo.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const detalle = require('../../server/modules/asistencia_detalle');

after(cerrarElSistema);

const MARCA = `e${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia de la explicación ${MARCA}`, `IG-EX${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Damas de la explicación ${MARCA}`, iglesia).lastInsertRowid;
const miembro = db
  .prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
     VALUES (?, ?, 'Rosa Elena', 'Muñoz Díaz', 'Activo')`
  ).run(iglesia, `${process.pid}55-0`).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, estado, fecha_ingreso)
   VALUES (?, 'Miembro', ?, 'Activo', '2026-01-01')`
).run(cuerpo, miembro);
const actividad = db
  .prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
     VALUES ('2026-08-02', 'Servicio General', ?, ?)`
  ).run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

const unMotivo = (nombre, pideDetalle) => db
  .prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, 1)')
  .run(`${nombre} ${MARCA}`, pideDetalle ? 1 : 0).lastInsertRowid;

const EXIGE = `Otro motivo ${MARCA}`;
const NO_EXIGE = `Enfermedad ${MARCA}`;
unMotivo('Otro motivo', true);
unMotivo('Enfermedad', false);

const limpiar = () =>
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividad);
const laMarca = () =>
  db.prepare('SELECT motivo, detalle FROM asistencia_detalle WHERE asistencia_id = ?').get(actividad);

const porLaFicha = (api, motivo, det) => {
  limpiar();
  return api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro, iglesia_id: iglesia,
    cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo, detalle: det,
  });
};
const porLaLista = (api, motivo, det) => {
  limpiar();
  return api('POST', `/asistencias/${actividad}/lista`, {
    marcas: [{ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado', motivo, detalle: det }],
  });
};

/* ─────────────── la caja de las letras deja de decidir nada ───────────── */

test('escrito de cualquier manera, un motivo que pide explicación la pide', async () => {
  const api = await elSistemaAndando();
  for (const comoSeEscribe of [EXIGE, EXIGE.toLowerCase(), EXIGE.toUpperCase()]) {
    for (const [rotulo, porDonde] of [['la ficha', porLaFicha], ['la toma de lista', porLaLista]]) {
      const r = await porDonde(api, comoSeEscribe, null);
      assert.equal(r.estado, 400,
        `«${comoSeEscribe}» por ${rotulo} entró sin explicación: ${r.texto.slice(0, 140)}`);
      assert.match(r.json.error, /detalle/i);
      assert.equal(laMarca(), undefined, 'y no quedó ninguna marca');
    }
  }
});

test('con la explicación escrita, entra por las dos', async () => {
  const api = await elSistemaAndando();
  for (const [rotulo, porDonde, esperado] of [
    ['la ficha', porLaFicha, 201], ['la toma de lista', porLaLista, 200],
  ]) {
    const r = await porDonde(api, EXIGE.toLowerCase(), 'Estaba de duelo');
    assert.equal(r.estado, esperado, `por ${rotulo}: ${r.texto.slice(0, 160)}`);
    assert.equal(laMarca().motivo, EXIGE, 'y el motivo queda escrito como está en la lista');
    assert.equal(laMarca().detalle, 'Estaba de duelo');
  }
});

test('y un motivo que NO pide explicación no la pide, escrito como sea', async () => {
  const api = await elSistemaAndando();
  for (const comoSeEscribe of [NO_EXIGE, NO_EXIGE.toUpperCase()]) {
    const r = await porLaFicha(api, comoSeEscribe, null);
    assert.equal(r.estado, 201, `«${comoSeEscribe}»: ${r.texto.slice(0, 160)}`);
    assert.equal(laMarca().detalle, null, 'y el detalle se suelta, no se inventa');
  }
});

/* ────────────────── la regla vive en la fila, no en un nombre ──────────── */

test('la pregunta se le hace a la fila del motivo', () => {
  assert.equal(detalle.pideExplicacion(db, EXIGE), true);
  assert.equal(detalle.pideExplicacion(db, EXIGE.toUpperCase()), true,
    'la caja de las letras no decide: decide la casilla «Pide explicación»');
  assert.equal(detalle.pideExplicacion(db, NO_EXIGE), false);
  assert.equal(detalle.pideExplicacion(db, `Uno que no existe ${MARCA}`), false);
  assert.equal(detalle.pideExplicacion(db, null), false);
});

test('cambiarle la casilla al motivo cambia la regla en el acto', async () => {
  /*
   * Lo que el módulo promete: al agregar «Viaje», la iglesia decide si hay que
   * explicarlo sin tocar el programa. Se lee en el momento, no al arrancar.
   */
  const api = await elSistemaAndando();
  const suyo = `Viaje ${MARCA}`;
  const id = unMotivo('Viaje', false);
  assert.equal((await porLaFicha(api, suyo, null)).estado, 201, 'sin la casilla, no pide nada');

  db.prepare('UPDATE motivos_ausencia SET pide_detalle = 1 WHERE id = ?').run(id);
  const r = await porLaFicha(api, suyo, null);
  assert.equal(r.estado, 400, 'con la casilla marcada, la pide desde ese mismo momento');
});

test('las dos puertas preguntan lo mismo, y a la misma pieza', () => {
  const fs = require('fs');
  const path = require('path');
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/modules/asistencias.js'), 'utf8');
  assert.match(fuente, /require\('\.\/asistencia_detalle'\)\.pideExplicacion/,
    'la toma de lista tenía su propia manera de decidirlo, y eso ya se arregló una vez');
});
