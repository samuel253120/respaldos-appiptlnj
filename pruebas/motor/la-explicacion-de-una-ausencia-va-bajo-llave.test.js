/**
 * La explicación de una justificación va bajo llave.
 *
 * Cuando alguien justifica una ausencia por «Emergencia» o por «Otro motivo»,
 * el sistema EXIGE escribir por qué. Es texto libre, lo llena quien pasa la
 * lista, y es el sitio natural donde queda escrito que alguien no fue por una
 * enfermedad. La ficha de un miembro tiene sus campos médicos detrás de la
 * llave de salud; este campo no tenía ninguna.
 *
 * MEDIDO en la v1.382.0, con una secretaria sin ninguna llave de datos:
 *
 *   los campos médicos de la ficha de esa persona ...  no le llegan
 *   la explicación, en el listado de marcas .........  entera
 *   ?q=aborto .......................................  su fila
 *   ?f_detalle=«el texto exacto» ....................  su fila
 *   la planilla que se baja .........................  con su columna
 *
 * La llave es PROPIA y no la de salud: lo que se escribe ahí a veces es una
 * enfermedad y a veces un viaje, y quien responde por la asistencia no es
 * necesariamente quien responde por la ficha médica.
 *
 * Y no tapa la pantalla de pasar lista, a propósito: ahí la explicación se
 * escribe y se corrige, y quien pasa la lista de su cuerpo tiene delante a esas
 * personas igual. Lo que se cierra es recorrer, buscar y bajar en planilla las
 * treinta mil del sistema, que es otra cosa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const { can } = require('../../server/permissions');
const sensibles = require('../../server/sensibles');
const { getModule } = require('../../server/registry');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central EX ${marca}`, `EX-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas EX ${marca}`, iglesia).lastInsertRowid;
const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run('Quien', `Falta EX ${marca}`, iglesia).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
   VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
).run(cuerpo, miembro, iglesia);

const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;
const actividad = db.prepare(
  'INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?,?,?,?)'
).run('2026-05-10', TIPO, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

// Un motivo propio que pide explicación, y la explicación que se midió
const MOTIVO = `Emergencia EX ${marca}`;
db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, 1, 1)').run(MOTIVO);
const LO_ESCRITO = `Hospitalizada por un aborto espontáneo EX ${marca}`;

/** Una secretaria de esta iglesia, sin ninguna llave de datos reservados. */
const numero = `${31000000 + (marca * 37) % 900000}`;
const secretaria = db.prepare(
  `INSERT INTO usuarios (nombre, rut, email, password, rol, activo, iglesias)
   VALUES (?,?,?,'x','secretario',1,?)`
).run(`Secretaria EX ${marca}`, `${numero}-${digitoVerificador(numero)}`,
  `ex${marca}@prueba.cl`, JSON.stringify([iglesia])).lastInsertRowid;

// ---------------------------------------------- la llave existe y es propia --

test('la llave es propia, y no la de salud', () => {
  const campo = getModule('asistencia_detalle').fields.find((f) => f.name === 'detalle');
  assert.equal(campo.reservado, 'asistencia_explicacion');
  assert.equal(sensibles.grupoDe(campo), 'asistencia_explicacion');
  assert.notEqual(sensibles.grupoDe(campo), 'miembros_salud',
    'lo que se escribe ahí a veces es una enfermedad y a veces un viaje');
});

test('se puede ver y ajustar en el editor de permisos, como todas', () => {
  const { todoLoQueSePuedePermitir } = require('../../server/permissions');
  const suya = todoLoQueSePuedePermitir().find((x) => x.name === 'asistencia_explicacion');
  assert.ok(suya, 'una regla que nadie puede leer ni cambiar no sirve');
  assert.equal(suya.group, 'Datos reservados');
  assert.deepEqual(suya.acciones, ['view']);
  assert.match(suya.ayuda, /motivo de salud/, 'y dice para qué es');
});

test('de fábrica la tienen quienes responden por la gente', () => {
  const quien = (rol) => can({ id: 0, rol, permisos: null }, 'asistencia_explicacion', 'view');
  assert.equal(quien('admin'), true);
  assert.equal(quien('pastor'), true);
  assert.equal(quien('secretario'), false, 'al resto se le concede a mano si hace falta');
  assert.equal(quien('tesorero'), false);
  assert.equal(quien('consulta'), false);
});

// -------------------------------------- lo que ve quien no la tiene ---------

test('sin la llave, la explicación no llega en el listado ni en la ficha', async () => {
  const api = await elSistemaAndando();
  const guardada = await api('POST', `/asistencias/${actividad}/lista`, {
    marcas: [{ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado', motivo: MOTIVO, detalle: LO_ESCRITO }],
  });
  assert.equal(guardada.estado, 200, guardada.texto.slice(0, 200));
  const suya = db.prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ?').get(actividad);
  assert.equal(suya.detalle, LO_ESCRITO, 'guardada queda entera: lo que cambia es quién la lee');

  const sinLlave = comoOtroUsuario(secretaria);
  const listado = await sinLlave('GET', `/asistencia_detalle?f_asistencia_id=${actividad}`);
  assert.equal(listado.estado, 200, listado.texto.slice(0, 200));
  assert.equal(listado.json.rows.length, 1, 'la marca sí la ve: lo que no ve es ese campo');
  assert.equal(listado.json.rows[0].motivo, MOTIVO, 'el motivo no es reservado: dice que justificó');
  assert.equal(listado.json.rows[0].detalle, undefined, 'la explicación, no');

  const ficha = await sinLlave('GET', `/asistencia_detalle/${suya.id}`);
  assert.equal(ficha.json.detalle, undefined);
});

test('ni en la planilla que se baja', async () => {
  await elSistemaAndando();
  const sinLlave = comoOtroUsuario(secretaria);
  const planilla = await sinLlave('GET', `/asistencia_detalle/planilla?f_asistencia_id=${actividad}`);
  assert.equal(planilla.estado, 200);
  assert.ok(!planilla.texto.includes('aborto'), 'bajarla en planilla era la otra forma de llevárselo');
});

test('y no puede dar con la persona buscando por lo que dice', async () => {
  await elSistemaAndando();
  const sinLlave = comoOtroUsuario(secretaria);
  /*
   * Lo que importa no es cuántas filas devuelve: es que devuelva LO MISMO
   * acierte o no. El filtro que no le toca se ignora, así que probar palabras
   * no contesta si acertó —que es por donde se fugaba el dato aunque el campo
   * viniera recortado—.
   */
  const acertando = await sinLlave('GET', '/asistencia_detalle?q=aborto');
  const errando = await sinLlave('GET', '/asistencia_detalle?q=palabraquenoexisteenningunlado');
  assert.equal(acertando.json.total, errando.json.total,
    'si acertar y errar dieran distinto, la búsqueda contestaría lo que el campo esconde');

  const exacto = await sinLlave('GET', `/asistencia_detalle?f_detalle=${encodeURIComponent(LO_ESCRITO)}`);
  const errado = await sinLlave('GET', '/asistencia_detalle?f_detalle=texto%20que%20no%20existe');
  assert.equal(exacto.json.total, errado.json.total, 'y el filtro exacto, igual');
});

// ------------------------------------------- lo que sí ve quien la tiene ----

test('con la llave se lee, se busca y se baja como siempre', async () => {
  const api = await elSistemaAndando();
  const listado = await api('GET', `/asistencia_detalle?f_asistencia_id=${actividad}`);
  assert.equal(listado.json.rows[0].detalle, LO_ESCRITO);

  const acertando = await api('GET', '/asistencia_detalle?q=aborto');
  const errando = await api('GET', '/asistencia_detalle?q=palabraquenoexisteenningunlado');
  assert.ok(acertando.json.total > errando.json.total, 'para quien la tiene, la búsqueda busca');

  const planilla = await api('GET', `/asistencia_detalle/planilla?f_asistencia_id=${actividad}`);
  assert.ok(planilla.texto.includes('aborto'));
});

// --------------------------------- y la pantalla de pasar lista no se toca --

test('pasar lista sigue mostrando la explicación a quien la está tomando', async () => {
  await elSistemaAndando();
  const sinLlave = comoOtroUsuario(secretaria);
  const lista = await sinLlave('GET', `/asistencias/${actividad}/lista`);
  assert.equal(lista.estado, 200, lista.texto.slice(0, 200));
  const suya = (lista.json.personas || []).find((p) => p.miembro_id === miembro);
  assert.ok(suya, 'la persona está en la lista de su cuerpo');
  assert.equal(suya.detalle, LO_ESCRITO,
    'ahí se escribe y se corrige: taparlo dejaría a quien pasa lista sin ver lo que ella misma anotó');
});

test('y se puede seguir corrigiendo sin borrar lo que no se vio', async () => {
  await elSistemaAndando();
  const sinLlave = comoOtroUsuario(secretaria);
  const r = await sinLlave('POST', `/asistencias/${actividad}/lista`, {
    marcas: [{ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado', motivo: MOTIVO, detalle: LO_ESCRITO }],
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT detalle FROM asistencia_detalle WHERE asistencia_id = ?').get(actividad).detalle,
    LO_ESCRITO
  );
});

// ------------------------------------------------ y el aviso de la pantalla -

test('y reservarla no le cierra a nadie la búsqueda del Registro de Cambios', () => {
  /*
   * El detalle de una línea del Registro de Cambios copia lo que decía una
   * ficha —de cualquier módulo—, así que puede traer cualquier grupo reservado,
   * y quien no alcanza uno de los que puede traer no puede buscar por ese
   * texto. Al reservar la explicación, ese «cualquiera» pasó a incluirla y la
   * búsqueda del registro se le cerró de golpe a todo el que no tuviera la
   * llave nueva —comprobado: la prueba de ese módulo se puso roja—.
   *
   * Pero Toma de Asistencia no deja NINGUNA línea con lo suyo dentro: no está
   * vigilada y su borrado está en la lista de los que no se anotan. Un módulo
   * que nunca aparece ahí no puede aportar ni una palabra, así que no cuenta.
   */
  const grupos = sensibles.todosLosGrupos();
  assert.ok(!grupos.includes('asistencia_explicacion'),
    'nunca va a llegar al detalle de una línea: contarla cerraría la búsqueda por nada');
  assert.ok(!grupos.includes('miembros_salud'), 'y la salud tampoco viaja, desde mucho antes');
  assert.ok(grupos.includes('tesoreria_montos'), 'pero los montos sí, y por eso siguen contando');

  const registro = getModule('registro_cambios');
  const detalle = registro.fields.find((f) => f.name === 'detalle');
  const laSecretaria = { id: secretaria, rol: 'secretario', permisos: null };
  assert.equal(sensibles.alcanzaElCampo(registro, detalle, laSecretaria), true,
    'la secretaria de siempre sigue buscando en el registro, que es lo que se estuvo a punto de romper');
  const sinLosMontos = {
    id: secretaria, rol: 'secretario', permisos: { tesoreria_montos: [] },
  };
  assert.equal(sensibles.alcanzaElCampo(registro, detalle, sinLosMontos), false,
    'y a quien le falta una llave de las que SÍ pueden salir ahí se le sigue cerrando');
});

test('y quién deja línea lo contesta el que lleva las dos listas', () => {
  const { dejaLineaPropia, MODULOS_VIGILADOS } = require('../../server/bitacora');
  assert.equal(dejaLineaPropia(getModule('asistencia_detalle')), false,
    'ni se vigila ni se anota su borrado: nunca aparece en el registro');
  assert.equal(dejaLineaPropia(getModule('registro_cambios')), false, 'y él no se anota a sí mismo');
  assert.equal(dejaLineaPropia(getModule('tesoreria')), true, 'vigilado');
  assert.ok(MODULOS_VIGILADOS.includes('tesoreria'));
  assert.equal(dejaLineaPropia(getModule('miembros')), true,
    'no está vigilado, pero su borrado sí se anota, y ahí va su ficha entera');
  // Sin saber de qué módulo se habla, lo más estricto: contar sus grupos cierra
  // una búsqueda de más, y no contarlos abriría un dato reservado
  assert.equal(dejaLineaPropia(null), true);
  assert.equal(dejaLineaPropia({}), true);
});

test('el campo avisa, donde se escribe, qué pasa con lo que se escriba', () => {
  const campo = getModule('asistencia_detalle').fields.find((f) => f.name === 'detalle');
  assert.match(campo.help, /Escriba lo justo/);
  assert.match(campo.help, /Explicación de una justificación/, 'y nombra la llave que lo abre');
});
