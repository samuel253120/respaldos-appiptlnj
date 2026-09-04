/**
 * Los tres estados de una marca están dichos en un solo sitio.
 *
 * «Presente, Ausente, Justificado» estaba escrito en SEIS: las opciones del
 * campo, la lista de válidos de la toma de lista, los tres botones de la
 * pantalla, el peso con que la hoja mensual resuelve un día de dos actividades,
 * la letra S/J/N de esa misma hoja, y otra vez el peso en el traspaso desde el
 * sistema anterior.
 *
 * Coincidían, que es lo que pasa hasta que alguien toca uno. El día que la
 * iglesia quiera un cuarto estado —«Atrasado» es el que siempre aparece— el
 * formulario lo aceptaría y la toma de lista lo rechazaría, que es la manera
 * más incómoda de descubrirlo.
 *
 * El dueño de lo que significa un estado es el módulo de la marca. Lo que se
 * comprueba acá es que los demás le pregunten, y que preguntarle dé lo mismo
 * que estaba escrito antes: esto no cambia ninguna conducta, y por eso hay que
 * poder verlo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const marcas = require('../../server/modules/asistencia_detalle');
const { getModule } = require('../../server/registry');

const fuente = (...donde) => fs.readFileSync(path.join(__dirname, '../../', ...donde), 'utf8');

// ------------------------------------------------- lo que declara el dueño --

test('el módulo de la marca los declara, y su campo sale de ahí', () => {
  assert.deepEqual(marcas.ESTADOS, ['Presente', 'Ausente', 'Justificado']);
  const campo = getModule('asistencia_detalle').fields.find((f) => f.name === 'estado');
  /*
   * Se pide la MISMA lista y no una igual: una copia con los mismos tres
   * nombres pasaría un `deepEqual` sin enterarse de nada, que es exactamente el
   * problema que este archivo existe para evitar. Comprobado rompiéndolo a
   * propósito: con una copia escrita a mano, ninguna prueba se ponía roja.
   */
  assert.equal(campo.options, marcas.ESTADOS, 'las opciones son la misma lista, no una copia igual');
  assert.equal(campo.default, marcas.ESTADOS[0]);
});

test('y en qué orden pesan, que es otro orden y por eso es otra lista', () => {
  assert.deepEqual(marcas.DE_MEJOR_A_PEOR, ['Presente', 'Justificado', 'Ausente']);
  assert.deepEqual(
    [...marcas.DE_MEJOR_A_PEOR].sort(), [...marcas.ESTADOS].sort(),
    'los mismos tres, en otro orden: si uno tuviera uno de más se notaría acá'
  );
});

test('y con qué letra se escribe cada uno en la planilla de siempre', () => {
  assert.deepEqual(marcas.LETRA_DE, { Presente: 'S', Justificado: 'J', Ausente: 'N' });
  assert.deepEqual(Object.keys(marcas.LETRA_DE).sort(), [...marcas.ESTADOS].sort(),
    'ninguno se queda sin letra');
});

// --------------------------------------------- que los demás le pregunten ---

test('la toma de lista pregunta, no tiene su propia lista', () => {
  const s = fuente('server', 'modules', 'asistencias.js');
  assert.match(s, /const validos = require\('\.\/asistencia_detalle'\)\.ESTADOS;/);
  assert.ok(!/\['Presente', 'Ausente', 'Justificado'\]/.test(s), 'y no le quedó ninguna copia');
});

test('la hoja mensual saca el peso y la letra del mismo sitio', () => {
  const s = fuente('server', 'planilla-asistencia.js');
  assert.match(s, /DE_MEJOR_A_PEOR, LETRA_DE: LETRA \} = require\('\.\/modules\/asistencia_detalle'\)/);
  assert.ok(!/Presente: 3/.test(s), 'el peso ya no está escrito con sus tres números');
  assert.ok(!/Presente: 'S'/.test(s), 'ni la letra');
});

test('y el traspaso desde el sistema anterior, también', () => {
  const s = fuente('server', 'importacion', 'm05-asistencia.js');
  assert.match(s, /DE_MEJOR_A_PEOR \} = require\('\.\.\/modules\/asistencia_detalle'\)/);
  assert.ok(!/Presente: 3/.test(s));
});

test('la pantalla dibuja los botones con lo que el módulo declara', () => {
  const s = fuente('public', 'app.js');
  assert.match(s, /opcionesDelCampo\('asistencia_detalle', 'estado'\)/);
  assert.ok(
    !/\['Presente', 'Ausente', 'Justificado'\]\.map/.test(s),
    'los tres botones ya no salen de una lista escrita en la pantalla'
  );
});

// ------------------------------------------------- que la cuenta dé igual ---

test('el peso que sale del orden es el mismo que estaba escrito', () => {
  /*
   * La hoja mensual lo arma con «el primero pesa más». Si eso diera otra cosa,
   * un día con dos actividades pasaría a mostrar la peor de las dos y nadie lo
   * notaría hasta imprimir la planilla del mes.
   */
  const { DE_MEJOR_A_PEOR } = marcas;
  const peso = Object.fromEntries(DE_MEJOR_A_PEOR.map((e, i) => [e, DE_MEJOR_A_PEOR.length - i]));
  assert.deepEqual(peso, { Presente: 3, Justificado: 2, Ausente: 1 });
});

test('y la hoja sigue quedándose con lo mejor de las dos', () => {
  const { db } = require('../../server/db');
  const planilla = require('../../server/planilla-asistencia');
  const marca = process.pid % 100000;
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`Central TE ${marca}`, `TE-${marca}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas TE ${marca}`, iglesia).lastInsertRowid;
  const quien = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Quien', `Fue TE ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(cuerpo, quien, iglesia);
  const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;
  // El mismo día, dos actividades: ausente en una y presente en la otra
  for (const estado of ['Ausente', 'Presente']) {
    const act = db.prepare('INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?,?,?,?)')
      .run('2026-07-05', TIPO, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
    db.prepare(
      `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
       VALUES (?,?,?,?,'2026-07-05',?)`
    ).run(act, quien, estado, cuerpo, iglesia);
  }
  const hoja = planilla.armar(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpo), '2026-07');
  assert.deepEqual(hoja.diasConReunion, [5], 'un día, una columna');
  assert.equal(hoja.integrantes[0].marcas[5], 'S', 'estuvo en una de las dos: estuvo');
});

// ----------------------------------------------- y lo que viene de afuera ---

test('lo que traduce el sistema anterior cae en uno de los tres', () => {
  /*
   * Ese mapa no se puede derivar —traduce las palabras del sistema viejo a las
   * nuestras— pero sí se puede comprobar: si alguien le agrega un destino que
   * no es un estado, la marca entraría con un estado que el sistema no admite
   * por ninguna de sus puertas.
   */
  const { ESTADO_ASISTENCIA } = require('../../server/importacion/traducciones');
  for (const [suyo, nuestro] of Object.entries(ESTADO_ASISTENCIA)) {
    assert.ok(marcas.ESTADOS.includes(nuestro), `«${suyo}» traduce a «${nuestro}», que no es un estado`);
  }
});
