/**
 * LO QUE LA FILA NOMBRA TIENE QUE EXISTIR, TAMBIÉN CUANDO SON VARIOS.
 *
 * El motor comprueba desde la 1.97.2 que una referencia apunte a algo que
 * existe —«se podía guardar un documento del cuerpo 88.888 y quedaba anotado
 * tal cual»— y lo hace para las dos clases de campo: el que apunta a UN
 * registro y el que apunta a VARIOS. La importación por planilla no llamaba a
 * esa comprobación: tenía la suya, escrita a mano, y solo para la primera.
 *
 * Medido en la v1.384.0, una actividad que convoca al cuerpo n.º 999999:
 *
 *   formulario ............ 400 «no existe cuerpo / grupo n.º 999999»
 *   planilla, por nombre .. rechazada
 *   planilla, por número .. ENTRÓ
 *
 * y quedó guardada diciendo que convocaba a un cuerpo, con cero personas en su
 * lista: imposible de pasar, y contando igual en la agenda.
 *
 * De paso se comprueba lo otro que arrastraba: un nombre que no se encuentra
 * dejaba el campo vacío y el obligatorio se quejaba además de que faltaba, así
 * que la fila salía con dos errores y el segundo mandaba a buscar una casilla
 * vacía que sí venía escrita.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central RR ${marca}`, `RR-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas RR ${marca}`, iglesia).lastInsertRowid;

const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run('Quien', `Entra RR ${marca}`, iglesia).lastInsertRowid;

const NO_EXISTE = 999999;
const asistencias = getModule('asistencias');
const admin = { id: 1, rol: 'admin' };

// ------------------------------------------------ el que apunta a VARIOS

test('un cuerpo que no existe, escrito con número, ya no entra por planilla', () => {
  const { errores } = prepararFila(asistencias, {
    fecha: '02/03/2026', tipo_reunion: 'Culto', cuerpos: String(NO_EXISTE),
  }, admin);
  assert.ok(errores.some((e) => e.includes(String(NO_EXISTE))),
    `tiene que decir que el n.º ${NO_EXISTE} no existe, y dijo: ${JSON.stringify(errores)}`);
});

test('y lo dice con las mismas palabras que el formulario', async () => {
  const api = await elSistemaAndando();
  const porFormulario = await api('POST', '/asistencias', {
    fecha: '2026-03-02', tipo_reunion: 'Culto', cuerpos: [NO_EXISTE],
  });
  assert.equal(porFormulario.estado, 400);

  const porPlanilla = await api('POST', '/importar/asistencias', {
    prueba: true,
    filas: [{ fecha: '02/03/2026', tipo_reunion: 'Culto', cuerpos: String(NO_EXISTE) }],
  });
  assert.equal(porPlanilla.json.correctas, 0, JSON.stringify(porPlanilla.json).slice(0, 300));
  assert.ok(porPlanilla.json.errores[0].errores.includes(porFormulario.json.error),
    `la planilla tiene que contestar lo mismo que el formulario.\n`
    + `  formulario: ${porFormulario.json.error}\n`
    + `  planilla:   ${JSON.stringify(porPlanilla.json.errores[0].errores)}`);
});

test('el que sí existe sigue entrando', () => {
  const { datos, errores } = prepararFila(asistencias, {
    fecha: '02/03/2026', tipo_reunion: 'Culto', cuerpos: String(cuerpo),
  }, admin);
  assert.deepEqual(errores, []);
  assert.equal(datos.cuerpos, JSON.stringify([cuerpo]));
});

// ------------------------------------------------- el que apunta a UNO

test('un registro que no existe, en un campo de una sola referencia, tampoco', () => {
  /*
   * Acá la comprobación ya estaba —escrita a mano, con un aviso propio— y lo
   * que cambia es quién la hace: ahora la misma del formulario. Se mira en un
   * campo que la planilla sí escribe: la iglesia de una actividad es de solo
   * lectura y la calcula el módulo, así que no serviría.
   */
  const { errores } = prepararFila(getModule('integrantes_cuerpo'), {
    cuerpo_id: String(NO_EXISTE), persona_tipo: 'Miembro', miembro_id: String(miembro),
    fecha_ingreso: '01/03/2026', estado: 'Activo',
  }, admin);
  assert.ok(errores.some((e) => e.includes(String(NO_EXISTE))),
    `también acá: ${JSON.stringify(errores)}`);
});

// --------------------------- un nombre que no se encuentra no es una casilla vacía

test('un nombre que no se encuentra no se cuenta además como una casilla vacía', () => {
  const { errores } = prepararFila(getModule('integrantes_cuerpo'), {
    cuerpo_id: String(cuerpo), persona_tipo: 'Miembro',
    miembro_id: `Nadie Se Llama Asi RR ${marca}`,
    fecha_ingreso: '01/03/2026', estado: 'Activo',
  }, admin);
  assert.equal(errores.length, 1,
    `tiene que salir un solo error y salieron ${errores.length}: ${JSON.stringify(errores)}`);
  assert.match(errores[0], /no se encontró/);
  assert.ok(!errores.some((e) => /^Falta /.test(e)),
    'la columna venía escrita: decir que falta manda a buscar una celda vacía que no existe');
});

test('pero una columna obligatoria que de verdad viene vacía sigue avisando', () => {
  const { errores } = prepararFila(getModule('integrantes_cuerpo'), {
    cuerpo_id: String(cuerpo), persona_tipo: 'Miembro',
    fecha_ingreso: '01/03/2026', estado: 'Activo',
  }, admin);
  assert.ok(errores.some((e) => /^Falta /.test(e)),
    `sin miembro tiene que faltar: ${JSON.stringify(errores)}`);
});
