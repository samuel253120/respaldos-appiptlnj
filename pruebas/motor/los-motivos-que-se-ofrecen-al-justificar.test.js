/**
 * LA ÚNICA REGLA DEL MÓDULO Y SU ÚNICA RUTA NO LAS PROBABA NADIE.
 *
 * El módulo aparecía en cuatro archivos de prueba y ninguno lo probaba a él:
 *
 *   · `llaves-1102` comprueba que su `beforeDelete` EXISTA, en un bucle junto a
 *     Tipos de Actividad. La prueba que ejercita el rechazo de verdad —usado,
 *     se niega; sin usar, se borra— existe solo para tipos de actividad.
 *   · `asistencia-listas` y `un-campo-escondido` escriben en su tabla para
 *     llegar a otra cosa: lo que prueban es la regla de la explicación, que
 *     vive en `asistencia_detalle`.
 *   · `seguridad` creaba un motivo SIN marcas y lo borraba —el camino feliz, no
 *     el rechazo—, y lo hacía para probar la bitácora, no el módulo.
 *   · La ruta `/motivos_ausencia/opciones` no la pedía ninguna prueba: ni el
 *     filtro por «En uso», ni el `pide_detalle` que manda con cada opción, ni
 *     la llave que exige.
 *
 * Es el mismo cuadro que tenía Categorías de Tesorería antes de la v1.348.0, y
 * el mismo tamaño de módulo: sesenta y ocho renglones que alguien «simplifica»
 * en una tarde sin que nada se ponga rojo.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const motivos = require('../../server/modules/motivos_ausencia');

after(cerrarElSistema);

const MARCA = `j${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia de la ruta ${MARCA}`, `IG-MR${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Damas de la ruta ${MARCA}`, iglesia).lastInsertRowid;
const miembro = db
  .prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
     VALUES (?, ?, 'Rosa Elena', 'Muñoz Díaz', 'Activo')`
  ).run(iglesia, `${process.pid}33-0`).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, estado, fecha_ingreso)
   VALUES (?, 'Miembro', ?, 'Activo', '2026-01-01')`
).run(cuerpo, miembro);
const actividad = db
  .prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
     VALUES ('2026-08-02', 'Servicio General', ?, ?)`
  ).run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

const unMotivo = (nombre, { activo = 1, pideDetalle = 0 } = {}) => {
  const id = db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, ?)')
    .run(`${nombre} ${MARCA}`, pideDetalle, activo).lastInsertRowid;
  return db.prepare('SELECT * FROM motivos_ausencia WHERE id = ?').get(id);
};

/** Lo que la ruta ofrece, en nombres. */
async function loQueSeOfrece(api) {
  const r = await api('GET', '/motivos_ausencia/opciones');
  assert.equal(r.estado, 200, `la ruta tiene que contestar: ${r.texto.slice(0, 120)}`);
  return r.json;
}

/* ────────────────────────── la única regla del módulo ─────────────────── */

test('un motivo que ya se usó no se borra: se desactiva', async () => {
  const api = await elSistemaAndando();
  const suyo = unMotivo('Enfermedad larga');

  // Sin usarlo se puede borrar
  const otro = unMotivo('El que nadie usó');
  assert.equal(motivos.hooks.beforeDelete(otro, { db }), null);

  const marcada = await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro, iglesia_id: iglesia,
    cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo: suyo.nombre,
  });
  assert.equal(marcada.estado, 201, marcada.texto.slice(0, 200));

  const aviso = motivos.hooks.beforeDelete(suyo, { db });
  assert.equal(typeof aviso, 'string', 'usado, tiene que negarse');
  assert.match(aviso, /1 marca\(s\) de asistencia/, 'y decir en cuántas está');
  assert.match(aviso, /Desmárquelo en «En uso»/, 'y qué hacer en cambio');
});

test('y el rechazo llega hasta quien lo pide, no solo hasta el gancho', async () => {
  const api = await elSistemaAndando();
  const suyo = unMotivo('Emergencia del hogar');
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividad);
  await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro, iglesia_id: iglesia,
    cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo: suyo.nombre,
  });

  const r = await api('DELETE', `/motivos_ausencia/${suyo.id}`);
  assert.equal(r.estado, 400, `medido: la regla no se ejecutaba en ninguna prueba (${r.texto.slice(0, 140)})`);
  assert.match(r.json.error, /no se puede borrar sin dejarlas sin motivo/);
  assert.ok(db.prepare('SELECT id FROM motivos_ausencia WHERE id = ?').get(suyo.id), 'y sigue ahí');
});

/* ─────────────────────────────── la ruta ──────────────────────────────── */

test('la ruta ofrece los que están en uso', async () => {
  const api = await elSistemaAndando();
  const suyo = unMotivo('Cuidando a un enfermo');
  const nombres = (await loQueSeOfrece(api)).map((o) => o.id);
  assert.ok(nombres.includes(suyo.nombre));
});

test('y deja de ofrecer uno desactivado, sin tocar lo ya anotado', async () => {
  const api = await elSistemaAndando();
  const suyo = unMotivo('Se usó y se apagó');
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividad);
  const marcada = await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro, iglesia_id: iglesia,
    cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo: suyo.nombre,
  });
  assert.equal(marcada.estado, 201, marcada.texto.slice(0, 200));

  db.prepare('UPDATE motivos_ausencia SET activo = 0 WHERE id = ?').run(suyo.id);
  assert.ok(!(await loQueSeOfrece(api)).map((o) => o.id).includes(suyo.nombre),
    'es para lo que sirve desmarcar «En uso»');
  assert.equal(
    db.prepare('SELECT motivo FROM asistencia_detalle WHERE id = ?').get(marcada.json.id).motivo,
    suyo.nombre, 'y la marca sigue diciendo lo que decía'
  );
});

test('cada opción viene con la forma que el desplegable espera', async () => {
  const api = await elSistemaAndando();
  const suyo = unMotivo('Con su forma');
  const suya = (await loQueSeOfrece(api)).find((o) => o.id === suyo.nombre);
  assert.ok(suya);
  assert.equal(suya.id, suya.label,
    'el valor es el NOMBRE, porque es el nombre lo que se guarda en la marca');
});

test('y dice cuáles piden explicación', async () => {
  /*
   * La pantalla decide si exigir el detalle con la lista que arma el campo del
   * lado del servidor, así que hoy nadie lee este dato. Va igual, y queda
   * fijado: es lo único de la ruta que dice algo más que el nombre, y salen los
   * dos de la misma tabla.
   */
  const api = await elSistemaAndando();
  const exige = unMotivo('Otro motivo cualquiera', { pideDetalle: 1 });
  const noExige = unMotivo('Enfermedad clara', { pideDetalle: 0 });

  const ofrecidos = await loQueSeOfrece(api);
  assert.equal(ofrecidos.find((o) => o.id === exige.nombre).pide_detalle, true);
  assert.equal(ofrecidos.find((o) => o.id === noExige.nombre).pide_detalle, false);
});

test('vienen ordenados por nombre', async () => {
  const api = await elSistemaAndando();
  const nombres = (await loQueSeOfrece(api)).map((o) => o.id);
  assert.deepEqual(nombres, [...nombres].sort());
});

/* ──────────────────────────── la llave que pide ───────────────────────── */

/*
 * La llave que pide la ruta es la de la TOMA DE ASISTENCIA y no la del módulo
 * de motivos, y ésa es la correcta: quien va a justificar una ausencia es quien
 * pasa lista. Pedir la del módulo dejaría fuera justamente a esa persona.
 *
 * Se comprueba con dos cuentas a las que se les cierra una llave cada una: como
 * casi todos los roles tienen las dos abiertas, comparar roles no distinguiría
 * cuál de las dos manda.
 */
const conUnaLlaveCerrada = (nombre, cual, sufijo) => db
  .prepare(
    `INSERT INTO usuarios (nombre, rut, rol, activo, password, permisos)
     VALUES (?, ?, 'secretario', 1, 'x', ?)`
  )
  .run(`${nombre} ${MARCA}`, `${process.pid}${sufijo}-0`, JSON.stringify({ [cual]: [] }))
  .lastInsertRowid;

test('sin la llave de la toma de asistencia, la ruta se cierra', async () => {
  await elSistemaAndando();
  const quien = conUnaLlaveCerrada('Sin pasar lista', 'asistencia_detalle', '22');
  const r = await comoOtroUsuario(quien)('GET', '/motivos_ausencia/opciones');
  assert.equal(r.estado, 403, 'quien no pasa lista no necesita esta lista');
});

test('y sin la llave del módulo de motivos, se sigue pudiendo justificar', async () => {
  await elSistemaAndando();
  const quien = conUnaLlaveCerrada('Sin mantener la lista', 'motivos_ausencia', '23');
  const r = await comoOtroUsuario(quien)('GET', '/motivos_ausencia/opciones');
  assert.equal(r.estado, 200,
    `mantener la lista y usarla son dos cosas distintas (${r.texto.slice(0, 140)})`);
});
