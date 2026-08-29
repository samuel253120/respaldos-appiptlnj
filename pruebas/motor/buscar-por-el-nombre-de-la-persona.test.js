/**
 * BUSCAR LA BITÁCORA POR EL NOMBRE DE LA PERSONA.
 *
 * El listado del módulo muestra «Rosa Cárcamo Vidal» en su columna «Miembro»
 * —resuelta de la otra tabla al leer—, así que ninguna fila contiene ese texto.
 * Medido: «Rosa Elena» → 0, «Cárcamo» → 0, mientras que «Mercadería», que sí
 * está en la descripción, daba 3.
 *
 * Cero resultados no se lee como «busque de otra forma». Se lee como «no hay
 * nada anotado de esa persona», que es exactamente lo contrario de lo que pasa
 * —y la pantalla acababa de mostrar ese nombre—.
 *
 * Lo que cuida este archivo:
 *   · que se la encuentre por el nombre que la pantalla muestra, por el
 *     completo, por el apellido solo y sin tildes
 *   · que lo que ya se encontraba siga encontrándose
 *   · que no traiga de más a quien no es
 *   · que el RUT NO entre por esta puerta: es un dato reservado de la ficha de
 *     miembro y quien no lo alcanza tampoco puede dar con alguien buscándolo
 *   · y que buscar por nombre no salte el alcance por iglesia
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const busqueda = require('../../server/busqueda');
const alcance = require('../../server/alcance');
const registry = require('../../server/registry');

const BITACORA = registry.getModule('bitacora');
const EXTRAS = BITACORA.buscaTambien.map((t) => t.sql);

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;
const CENTRAL = unaIglesia('Central del nombre', 'IG-BPN1');
const NORTE = unaIglesia('Norte del nombre', 'IG-BPN2');

const unMiembro = (nombres, apellidos, iglesia, rut) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run(nombres, apellidos, rut || null, iglesia).lastInsertRowid;
const anotar = (miembro, iglesia, tipo, texto) => db
  .prepare(
    `INSERT INTO bitacora (miembro_id, iglesia_id, fecha, tipo, descripcion, origen, registrado_por)
     VALUES (?,?, '2026-04-02', ?, ?, 'Manual', 'Quien Escribe')`
  ).run(miembro, iglesia, tipo, texto).lastInsertRowid;

const rosa = unMiembro('Rosa Elena', 'Cárcamo Vidal', CENTRAL, '21000000-3');
const suyas = [
  anotar(rosa, CENTRAL, 'Visita', 'Se le llevó mercadería y quedó de venir el domingo.'),
  anotar(rosa, CENTRAL, 'Anotación', 'Alta del miembro en el sistema.'),
];
const otra = unMiembro('Rosa', 'Muñoz Pérez', CENTRAL);
const deLaOtra = anotar(otra, CENTRAL, 'Visita', 'Otra persona distinta.');
const norteña = unMiembro('Rosa Elena', 'Cárcamo Soto', NORTE);
const deLaNorteña = anotar(norteña, NORTE, 'Visita', 'De la iglesia del norte.');

/** Buscar como busca el listado del módulo, con el alcance del usuario. */
function buscar(q, usuario) {
  const c = busqueda.condicion(q, BITACORA.searchFields, EXTRAS);
  if (!c) return [];
  const params = [];
  const suAlcance = usuario ? alcance.condiciones(BITACORA, usuario, params) : null;
  return db
    .prepare(`SELECT id FROM bitacora WHERE (${c.sql})${suAlcance ? ` AND (${suAlcance})` : ''}`)
    .all(...c.params, ...params)
    .map((r) => r.id);
}

const soloSuyas = (q, usuario) => buscar(q, usuario).filter((id) => suyas.includes(id)).length;

/* ------------------------------- se la encuentra por su nombre */

test('por el nombre que la pantalla muestra', () => {
  // La etiqueta del listado es «{primer nombre} {apellidos}»
  assert.equal(soloSuyas('Rosa Cárcamo Vidal'), 2, 'antes daba CERO');
});

test('por el nombre completo, con sus dos nombres', () => {
  assert.equal(soloSuyas('Rosa Elena Cárcamo Vidal'), 2,
    'por eso lo buscable lleva el nombre completo y no el recortado de la etiqueta');
});

test('por el apellido solo, y sin tildes', () => {
  assert.equal(soloSuyas('Cárcamo'), 2);
  assert.equal(soloSuyas('carcamo'), 2, 'en el teléfono casi nadie escribe las tildes');
  assert.equal(soloSuyas('CÁRCAMO VIDAL'), 2);
});

test('en cualquier orden, como busca todo el mundo', () => {
  assert.equal(soloSuyas('Vidal Rosa'), 2);
});

/* ------------------------------- y no trae de más */

test('no trae a quien se llama parecido', () => {
  assert.deepEqual(buscar('Cárcamo Vidal').sort(), [...suyas].sort(),
    'Rosa Muñoz y Rosa Cárcamo Soto no son ella');
  assert.equal(buscar('Muñoz Pérez').length, 1);
});

test('un nombre que no existe no trae nada', () => {
  assert.deepEqual(buscar('Fulano Inexistente'), []);
  assert.deepEqual(buscar('Cárcamo Muñoz'), [], 'las dos palabras tienen que estar en la MISMA ficha');
});

test('lo que ya se encontraba se sigue encontrando', () => {
  assert.equal(soloSuyas('mercadería'), 1, 'por la descripción');
  assert.equal(soloSuyas('domingo'), 1);
  assert.equal(buscar('Visita').length, 3, 'y por el tipo');
});

/* ------------------------------- el RUT no entra por acá */

test('el RUT de la ficha NO se busca desde la bitácora', () => {
  // Es un campo reservado del módulo de Miembros: quien no lo alcanza tampoco
  // puede dar con alguien buscándolo, y una expresión metida acá se saltaría
  // el recorte que el motor hace campo por campo.
  assert.equal(soloSuyas('21000000-3'), 0);
  assert.equal(soloSuyas('210000003'), 0);
  const reservados = require('../../server/sensibles').gruposDe(registry.getModule('miembros'));
  const identidad = [...reservados.values()].flat();
  assert.ok(identidad.includes('rut'), 'si el RUT dejara de ser reservado, esta decisión hay que revisarla');
  for (const campo of identidad) {
    assert.doesNotMatch(EXTRAS.join(' '), new RegExp(`\\b${campo}\\b`),
      `lo buscable de la bitácora no puede nombrar «${campo}»`);
  }
});

/* ------------------------------- ni se salta el alcance */

test('buscar por nombre no abre lo que el alcance cierra', () => {
  /*
   * Esto comprueba que el alcance SE APLICA a una búsqueda por nombre —roto a
   * propósito, quitándolo, cae—. Lo que no distingue es cuál de las dos reglas
   * se usa: acá cada anotación lleva la iglesia de su miembro, así que acotar
   * por la columna propia y acotar por la ficha dan lo mismo. Esa distinción
   * es la que cuida historial-que-sigue-a-la-persona.test.js.
   */
  const deLaCentral = { id: 81, iglesias: `[${CENTRAL}]`, iglesia_id: CENTRAL, cuerpos: '[]' };
  const deLaNorte = { id: 82, iglesias: `[${NORTE}]`, iglesia_id: NORTE, cuerpos: '[]' };

  assert.deepEqual(buscar('Cárcamo', deLaCentral).sort(), [...suyas].sort(),
    'la de la Central ve las de Rosa y no la de la norteña, que también se apellida Cárcamo');
  assert.deepEqual(buscar('Cárcamo', deLaNorte), [deLaNorteña],
    'y la de la Norte, al revés');
  assert.equal(buscar('Cárcamo').length, 3, 'el administrador las ve todas: si no, esto no probaría nada');
});

/* ------------------------------- cómo está escrito el trozo */

test('el trozo nombra su tabla, porque el listado se arma sin alias', () => {
  assert.equal(BITACORA.buscaTambien.length, 1);
  const sql = BITACORA.buscaTambien[0].sql;
  assert.match(sql, /bitacora\.miembro_id/,
    'hoy funciona igual sin el nombre; se escribe para que el día en que «miembros» tenga una '
    + 'columna llamada así, la subconsulta no empiece a mirar la suya en silencio');
  assert.match(sql, /FROM miembros m\b/, 'y la subconsulta lleva su propio alias');
  assert.equal(BITACORA.buscaTambien[0].reservado, null, 'no busca por nada reservado');
});

test('una anotación cuyo miembro ya no está no rompe la búsqueda', () => {
  const huerfana = db
    .prepare(
      `INSERT INTO bitacora (miembro_id, iglesia_id, fecha, tipo, descripcion, origen, registrado_por)
       VALUES (999999, ?, '2026-04-02', 'Visita', 'Sin ficha detrás.', 'Manual', 'Quien Escribe')`
    ).run(CENTRAL).lastInsertRowid;
  assert.deepEqual(buscar('Sin ficha detrás'), [huerfana], 'se encuentra por su texto');
  assert.equal(buscar('Cárcamo').includes(huerfana), false, 'y no aparece buscando un nombre');
});
