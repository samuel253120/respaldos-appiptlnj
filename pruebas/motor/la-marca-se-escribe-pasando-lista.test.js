/**
 * La marca de asistencia se escribe pasando lista, no una por una.
 *
 * La primera línea del módulo lo dice desde siempre —«no se llena aquí una por
 * una, sino marcando la lista en la pantalla de Asistencia»—, pero eso no
 * estaba dicho en ninguna parte que el programa mirara: el módulo no tiene
 * entrada en el menú y aun así viajaba entero en la descripción del sistema, de
 * modo que la pantalla genérica lo atendía como a los otros cuarenta y la
 * importación por planilla también.
 *
 * Y esa segunda puerta no hacía ninguna de las cinco cosas que hace la toma de
 * lista. Medido en la v1.380.0: corregirle el estado a una marca la mudaba de
 * iglesia —deshaciendo la v1.375.0—, toda marca creada por la ficha nacía sin
 * cuerpo, no se comprobaba que la persona estuviera convocada, y no quedaba
 * constancia de nada.
 *
 * Se cierra la puerta en vez de repetir en ella las cinco comprobaciones: dos
 * maneras de comprobar habrían sido dos verdades. LEER no se toca.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const marcas = require('../../server/modules/asistencia_detalle');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const nuevaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`${nombre} PL ${marca}`, `${codigo}-${marca}`).lastInsertRowid;
const iglesia = nuevaIglesia('Central', 'PLA');
const otraIglesia = nuevaIglesia('Del Sur', 'PLB');

const nuevoCuerpo = (nombre, deQueIglesia) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`${nombre} PL ${marca}`, deQueIglesia).lastInsertRowid;
const cuerpo = nuevoCuerpo('Damas', iglesia);
const cuerpoDelSur = nuevoCuerpo('Damas del Sur', otraIglesia);

/** Alguien inscrito en una iglesia y puesto en un cuerpo. */
let cuantos = 0;
function integrante(deQueIglesia, deQueCuerpo) {
  const numero = `${29000000 + (marca * 31 + cuantos++) % 900000}`;
  const id = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(`Persona${cuantos}`, `PL ${marca}`, `${numero}-${digitoVerificador(numero)}`, deQueIglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(deQueCuerpo, id, deQueIglesia);
  return id;
}
const deLaCentral = integrante(iglesia, cuerpo);
const delSur = integrante(otraIglesia, cuerpoDelSur);
const ajena = integrante(iglesia, nuevoCuerpo('Coro', iglesia));

const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;
// Una actividad que convoca a las dos congregaciones: es donde el defecto se veía
const actividad = db.prepare(
  `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos) VALUES (?,?,?,?,?)`
).run('2026-04-12', TIPO, `Jornada PL ${marca}`, iglesia, JSON.stringify([cuerpo, cuerpoDelSur])).lastInsertRowid;

/*
 * Un motivo de ausencia PROPIO de esta corrida.
 *
 * Se usaba «Trabajo», que viene de fábrica, y eso ataba esta prueba a lo que
 * hicieran las demás: los archivos del motor corren en paralelo sobre una sola
 * base, y a un motivo de fábrica cualquiera lo puede apagar o borrar otra
 * prueba mientras ésta corre. Cuando eso pasaba, la segunda pasada de lista se
 * rechazaba con un 400 —«ya no está en Motivos de Ausencia»—, el estado quedaba
 * como el de la primera, y lo que se veía era un fallo acá, donde no estaba el
 * problema. Con uno propio, nadie más lo toca.
 */
const MOTIVO = `Trabajo PL ${marca}`;
db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, 0, 1)').run(MOTIVO);

/** Pasa la lista de verdad, que es la única puerta que queda. */
const pasarLista = (api, cuales) => api('POST', `/asistencias/${actividad}/lista`, { marcas: cuales });

const laMarcaDe = (miembro) => db
  .prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ?')
  .get(actividad, miembro);

// ------------------------------------------------ la puerta que se cierra ---

test('crear una marca a mano se rechaza, y dice por dónde se hace', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: deLaCentral, estado: 'Presente',
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /pasando lista en la pantalla de Asistencia/);
  assert.match(r.json.error, /se comprueba que la persona esté convocada/, 'y dice qué se pierde por acá');
  assert.equal(laMarcaDe(deLaCentral), undefined, 'y no entró nada');
});

test('corregirla a mano, tampoco', async () => {
  const api = await elSistemaAndando();
  await pasarLista(api, [{ miembro_id: deLaCentral, no_miembro_id: null, cuerpo_id: cuerpo, estado: 'Presente' }]);
  const suya = laMarcaDe(deLaCentral);
  assert.ok(suya, 'la lista sí la escribió');

  const r = await api('PUT', `/asistencia_detalle/${suya.id}`, { estado: 'Ausente' });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /pasando lista/);
  assert.equal(laMarcaDe(deLaCentral).estado, 'Presente', 'y quedó como estaba');
});

test('ni borrarla suelta', async () => {
  const api = await elSistemaAndando();
  const suya = laMarcaDe(deLaCentral);
  const r = await api('DELETE', `/asistencia_detalle/${suya.id}`);
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /corrija la lista de esa actividad/, 'y dice cómo se hace de verdad');
  assert.ok(laMarcaDe(deLaCentral), 'la marca sigue ahí');
});

test('ni meterla por planilla, que se rechaza antes de mirar las filas', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/importar/asistencia_detalle', {
    filas: [{ asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: ajena, estado: 'Presente' }],
    prueba: false,
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /pasando lista/);
  assert.equal(r.json.errores, undefined, 'ni siquiera llega a revisar fila por fila');
  assert.equal(laMarcaDe(ajena), undefined);
});

// ------------------------------------------- y lo que NO se puede provocar --

test('la marca ya no se puede mudar de congregación', async () => {
  const api = await elSistemaAndando();
  await pasarLista(api, [{ miembro_id: delSur, no_miembro_id: null, cuerpo_id: cuerpoDelSur, estado: 'Presente' }]);
  const suya = laMarcaDe(delSur);
  assert.equal(suya.cuerpo_id, cuerpoDelSur);
  assert.equal(suya.iglesia_id, otraIglesia, 'la marca se anota en la iglesia de SU cuerpo (v1.375.0)');

  const r = await api('PUT', `/asistencia_detalle/${suya.id}`, { estado: 'Ausente' });
  assert.equal(r.estado, 400);
  assert.equal(
    laMarcaDe(delSur).iglesia_id, otraIglesia,
    'y la corrección que la mudaba a la iglesia de la actividad ya no tiene por dónde entrar'
  );
});

test('y no se puede marcar a quien no fue convocado', async () => {
  const api = await elSistemaAndando();
  // Por la puerta que se cerró entraba con un 201; por la que queda, 403
  const porLaFicha = await api('POST', '/asistencia_detalle', {
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: ajena, cuerpo_id: cuerpo, estado: 'Presente',
  });
  assert.equal(porLaFicha.estado, 400);
  const porLaLista = await pasarLista(api, [{ miembro_id: ajena, no_miembro_id: null, cuerpo_id: cuerpo, estado: 'Presente' }]);
  assert.equal(porLaLista.estado, 403, porLaLista.texto.slice(0, 200));
  assert.equal(laMarcaDe(ajena), undefined);
});

// -------------------------------------------- lo que tiene que seguir igual -

test('leer no se toca: listado, ficha y planilla siguen abiertos', async () => {
  const api = await elSistemaAndando();
  const suya = laMarcaDe(deLaCentral);
  assert.equal((await api('GET', `/asistencia_detalle?f_asistencia_id=${actividad}`)).estado, 200);
  assert.equal((await api('GET', `/asistencia_detalle/${suya.id}`)).estado, 200);
  assert.equal((await api('GET', `/asistencia_detalle/planilla?f_asistencia_id=${actividad}`)).estado, 200);
});

test('pasar lista sigue siendo lo que escribe, y corregirla también', async () => {
  const api = await elSistemaAndando();
  const r = await pasarLista(api, [{ miembro_id: deLaCentral, no_miembro_id: null, cuerpo_id: cuerpo, estado: 'Ausente' }]);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(laMarcaDe(deLaCentral).estado, 'Ausente');
});

test('una sola marca por par persona-cuerpo, que es donde vive ahora esa regla', async () => {
  /*
   * Se le preguntaba al gancho del módulo (pruebas/motor/asistencia-cuerpos).
   * Con la puerta cerrada la regla la garantiza el borrar-e-insertar por par
   * persona-cuerpo de la ruta que pasa lista, así que se le pregunta a ella.
   */
  const api = await elSistemaAndando();
  const cuantas = (miembro, deQueCuerpo) => db
    .prepare('SELECT COUNT(*) c FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ? AND cuerpo_id = ?')
    .get(actividad, miembro, deQueCuerpo).c;

  const primera = await pasarLista(api, [{ miembro_id: deLaCentral, no_miembro_id: null, cuerpo_id: cuerpo, estado: 'Presente' }]);
  assert.equal(primera.estado, 200, primera.texto.slice(0, 200));
  // Se mira que las DOS hayan entrado: si la segunda se rechaza, lo que queda
  // escrito es la primera, y sin este assert eso se leía como «no pisó»
  const segunda = await pasarLista(api, [{ miembro_id: deLaCentral, no_miembro_id: null, cuerpo_id: cuerpo, estado: 'Justificado', motivo: MOTIVO }]);
  assert.equal(segunda.estado, 200, segunda.texto.slice(0, 200));
  assert.equal(cuantas(deLaCentral, cuerpo), 1, 'la segunda pisa a la primera, no se suma');
  assert.equal(laMarcaDe(deLaCentral).estado, 'Justificado', 'y queda la última');

  // Y la de la otra congregación, en su propio cuerpo, no se toca
  assert.equal(cuantas(delSur, cuerpoDelSur), 1);
  assert.equal(laMarcaDe(delSur).cuerpo_id, cuerpoDelSur);
});

test('el permiso de tomar asistencia no se tocó: la pantalla sigue dejando marcar', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', `/asistencias/${actividad}/lista`);
  assert.equal(r.estado, 200);
  assert.equal(r.json.puede_marcar, true, 'ese permiso vive en este módulo y se pregunta con can()');
});

test('y la corrección por la lista sigue dejando su línea en el Registro de Cambios', () => {
  const linea = db
    .prepare(
      `SELECT detalle FROM registro_cambios
        WHERE modulo = 'Asistencias' AND accion = 'Corrección de lista' AND detalle LIKE ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(`%Damas PL ${marca}%`);
  assert.ok(linea, 'la única puerta que queda es también la que deja constancia');
  // Se pide la FORMA de la línea y no una transición concreta: cuál fue la
  // última corrección depende del orden en que corran las pruebas de este
  // archivo, y lo que se comprueba es que quede escrito de qué a qué.
  assert.match(linea.detalle, /Corrigió \d+ marca\(s\) de la lista de Damas PL/);
  assert.match(linea.detalle, /: (Presente|Ausente|Justificado) → (Presente|Ausente|Justificado)/);
});

// ------------------------------------------------- lo que dice la pantalla --

test('la pantalla no dibuja los botones de escribir', () => {
  /*
   * Se le pregunta a la misma función que arma la descripción del sistema
   * (`/api/meta` la llama por cada módulo), que para eso vive fuera de la ruta.
   * Un botón que promete algo que el sistema se niega a hacer por diseño no
   * enseña nada: contesta con un error después de apretarlo.
   */
  const { loQuePuedeHacerEn } = require('../../server/permissions');
  const puedeTodo = { id: 1, rol: 'admin' };
  const suyo = loQuePuedeHacerEn(marcas, puedeTodo);
  assert.equal(suyo.view, true, 'leer sí: el listado y la ficha siguen abiertos');
  assert.deepEqual(
    { create: suyo.create, edit: suyo.edit, delete: suyo.delete },
    { create: false, edit: false, delete: false },
    'ni Nuevo, ni Importar, ni Editar, ni Eliminar — ni siendo administrador'
  );
  const asistencias = require('../../server/modules/asistencias');
  assert.equal(
    loQuePuedeHacerEn(asistencias, puedeTodo).create, true,
    'y el módulo de al lado, que sí se escribe a mano, no se tocó'
  );
});

test('el módulo lo declara con sus palabras, y las dos', () => {
  assert.ok(marcas.soloLectura, 'la declaración es lo que miran el motor, la pantalla y la planilla');
  assert.match(marcas.soloLectura.alGuardar, /pasando lista/);
  assert.match(marcas.soloLectura.alBorrar, /corrija la lista/);
});

test('y ya no le queda un gancho de guardado que nadie llame', () => {
  /*
   * Un gancho que no se alcanza es peor que ninguno: parece que protege. Las
   * cuatro reglas que hacía valer viven en la ruta que pasa lista, y lo que
   * este archivo sigue prestándole está exportado.
   */
  assert.equal(marcas.hooks, undefined);
  assert.equal(typeof marcas.pideExplicacion, 'function', 'la regla del motivo que pide explicación sigue acá');
  assert.equal(typeof marcas.motivosQuePidenDetalle, 'function');
});
