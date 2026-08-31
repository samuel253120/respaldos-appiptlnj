/**
 * Lo que significa que un pastor ya no ejerza.
 *
 * Hasta la 1.240.0, nada. Medido sobre el sistema andando, con un pastor
 * creado directamente como fallecido:
 *
 *   designarlo pastor principal de una iglesia ..... 200
 *   marcar fallecido al que YA está a cargo ........ 200, sin decir nada
 *   ¿la iglesia lo sigue nombrando después? ........ sí
 *   ¿lo ofrece el desplegable de pastores? ......... sí, 9 de 9
 *   ¿y al jubilado? ................................ también
 *
 * De ese campo sale «A cargo de la iglesia», que nombra al pastor Y A SU
 * CÓNYUGE y es lo que la organización lee para saber quién responde por una
 * congregación.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const ejercen = require('../../server/pastor-que-ejerce');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const IGLESIAS = getModule('iglesias');
const PASTORES = getModule('pastores');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = (nombre, pastorId = null) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado, pastor_id) VALUES (?, ?, 'Activa', ?)")
  .run(`${nombre} ${marca()}`, `EJE${marca()}`, pastorId).lastInsertRowid;

const pastor = (estado, iglesiaId = null) => db
  .prepare('INSERT INTO pastores (nombres, apellidos, cargo, estado, iglesia_id) VALUES (?, ?, ?, ?, ?)')
  .run('Elias', `Ejerce ${marca()}`, 'Pastor Presbítero', estado, iglesiaId).lastInsertRowid;

/** El aviso del motor al guardar una ficha de `modulo` que nombra a `pastorId`. */
const alNombrar = (modulo, campo, pastorId, { existing = null, isNew = true } = {}) =>
  ejercen.avisoSiElPastorYaNoEjerce(db, getModule(modulo), {
    data: { [campo]: pastorId }, existing, isNew,
  });

// ------------------------------------------------- designarlo de nuevo ----

test('a un pastor que ejerce se le puede designar', () => {
  assert.equal(alNombrar('iglesias', 'pastor_id', pastor('Activo')), null);
});

test('y con el estado en blanco también: se ejerce mientras nadie diga lo contrario', () => {
  assert.equal(alNombrar('iglesias', 'pastor_id', pastor(null)), null);
});

test('a uno que ya no ejerce, no, en ninguno de los cuatro estados', () => {
  for (const estado of ['Inactivo', 'Jubilado', 'Trasladado', 'Fallecido']) {
    const aviso = alNombrar('iglesias', 'pastor_id', pastor(estado));
    assert.equal(typeof aviso, 'string', `«${estado}» tendría que frenar`);
    assert.match(aviso, new RegExp(estado), 'y el aviso tiene que decir cuál es su estado');
  }
});

test('el aviso nombra el campo, para saber dónde se lo está poniendo', () => {
  const aviso = alNombrar('iglesias', 'pastor_id', pastor('Fallecido'));
  assert.match(aviso, /Pastor principal/);
});

test('y dice cómo salir: cambiarle el estado', () => {
  assert.match(alNombrar('iglesias', 'pastor_id', pastor('Jubilado')), /cámbiele el estado/i);
});

test('vale para el titular de una credencial, no solo para la iglesia', () => {
  /*
   * La regla vive en el motor y mira TODOS los campos que apuntan a Pastores /
   * Guías. Escrita módulo por módulo, se habría olvidado en éste.
   */
  const aviso = alNombrar('credenciales', 'pastor_id', pastor('Fallecido'));
  assert.equal(typeof aviso, 'string');
});

test('corregir otra cosa sin tocar el campo no frena nada', () => {
  const muerto = pastor('Fallecido');
  const aviso = ejercen.avisoSiElPastorYaNoEjerce(db, IGLESIAS, {
    data: { telefono: '+56 2 2222 3333' }, existing: { pastor_id: muerto }, isNew: false,
  });
  assert.equal(aviso, null, 'una iglesia cuyo pastor falleció se sigue corrigiendo');
});

test('ni volver a mandar el mismo pastor que ya tenía', () => {
  const muerto = pastor('Fallecido');
  const aviso = ejercen.avisoSiElPastorYaNoEjerce(db, IGLESIAS, {
    data: { pastor_id: muerto }, existing: { pastor_id: muerto }, isNew: false,
  });
  assert.equal(aviso, null, 'no se lo está designando: ya estaba');
});

test('quitarle el pastor a una iglesia tampoco se frena', () => {
  assert.equal(ejercen.avisoSiElPastorYaNoEjerce(db, IGLESIAS, {
    data: { pastor_id: null }, existing: { pastor_id: pastor('Fallecido') }, isNew: false,
  }), null);
});

// --------------------------------- lo que SÍ puede seguir nombrándolo ----

test('su historial y su carpeta lo siguen nombrando: para eso existen', () => {
  const muerto = pastor('Fallecido');
  assert.equal(alNombrar('historial_pastores', 'pastor_id', muerto), null,
    'anotar que falleció es justamente lo que hay que poder hacer');
  assert.equal(alNombrar('documentos_pastores', 'pastor_id', muerto), null);
});

test('y un certificado también: registra un hecho con SU fecha', () => {
  /*
   * El matrimonio de 1998 lo ofició quien lo ofició, aunque hoy ya no esté.
   */
  assert.equal(alNombrar('certificados', 'oficiante_id', pastor('Fallecido')), null);
});

// ------------------------------------- dejar de ejercer estando a cargo ----

const alDejarDeEjercer = (pastorId, data, existing, confirmado = false) =>
  ejercen.avisoSiDejaDeEjercer(db, pastorId, { data, existing, confirmado });

test('marcarlo fallecido cuando una iglesia lo nombra, pregunta', () => {
  const p = pastor('Activo');
  const i = iglesia('Iglesia Que Lo Nombra', p);
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  const pregunta = alDejarDeEjercer(p, { estado: 'Fallecido' }, existing);
  assert.equal(pregunta.confirmar, 'deja_de_ejercer_y_esta_a_cargo');
  assert.match(pregunta.error, /Fallecido/, 'el aviso dice a qué estado pasa');
  assert.match(pregunta.error, new RegExp(db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(i).nombre),
    'y nombra la iglesia que queda sin pastor');
});

test('y lo mismo al jubilarlo o trasladarlo', () => {
  for (const estado of ['Jubilado', 'Trasladado', 'Inactivo']) {
    const p = pastor('Activo');
    iglesia('Iglesia Suya', p);
    const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
    assert.ok(alDejarDeEjercer(p, { estado }, existing), `«${estado}» tendría que preguntar`);
  }
});

test('si ninguna iglesia lo nombra, no hay nada que preguntar', () => {
  const p = pastor('Activo');
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  assert.equal(alDejarDeEjercer(p, { estado: 'Fallecido' }, existing), null);
});

test('volver a ponerlo Activo no pregunta', () => {
  const p = pastor('Jubilado');
  iglesia('Iglesia Suya', p);
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  assert.equal(alDejarDeEjercer(p, { estado: 'Activo' }, existing), null);
});

test('ni volver a mandar el estado que ya tenía', () => {
  const p = pastor('Fallecido');
  iglesia('Iglesia Suya', p);
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  assert.equal(alDejarDeEjercer(p, { estado: 'Fallecido' }, existing), null,
    'no se está muriendo de nuevo: ya estaba así');
});

test('ni un guardado que no toca el estado', () => {
  const p = pastor('Activo');
  iglesia('Iglesia Suya', p);
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  assert.equal(alDejarDeEjercer(p, { telefono: '+56 9 1111 2222' }, existing), null);
});

test('una ficha nueva no deja ninguna iglesia atrás', () => {
  assert.equal(alDejarDeEjercer(undefined, { estado: 'Fallecido' }, null), null);
});

test('y confirmado, deja pasar', () => {
  const p = pastor('Activo');
  iglesia('Iglesia Suya', p);
  const existing = db.prepare('SELECT * FROM pastores WHERE id = ?').get(p);
  assert.equal(alDejarDeEjercer(p, { estado: 'Fallecido' }, existing, true), null);
});

// -------------------------------------------------- la condición SQL ----

test('la condición de los que ejercen deja pasar el estado en blanco', () => {
  const sql = ejercen.condicionDeQuienesEjercen();
  const activo = pastor('Activo'), blanco = pastor(null), muerto = pastor('Fallecido');
  const ids = db.prepare(`SELECT id FROM pastores WHERE ${sql} AND id IN (?, ?, ?)`)
    .all(activo, blanco, muerto).map((r) => r.id);
  assert.ok(ids.includes(activo) && ids.includes(blanco), 'el activo y el del estado en blanco');
  assert.ok(!ids.includes(muerto), 'y el fallecido no');
});

test('el Pastor Presidente único usa esa misma condición, y no otra escrita a mano', () => {
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/pastores.js'), 'utf8');
  assert.match(modulo, /condicionDeQuienesEjercen\(\)\}`\)/,
    'la comprobación del cargo único tiene que leer la lista de estados de un solo lugar');
});

// ------------------------------------------------ guardando de verdad ----

test('guardando de verdad: no se designa, el desplegable no lo ofrece, y al morir suelta su iglesia', async () => {
  const api = await elSistemaAndando();
  const m = `ejerce-${process.pid}`;

  const igl = (await api('POST', '/iglesias', { nombre: `Iglesia Ejerce ${m}`, codigo: `EJ${process.pid}`, estado: 'Activa' })).json;
  const vivo = (await api('POST', '/pastores', { nombres: 'Vivo', apellidos: `Ejerce ${m}`, cargo: 'Pastor Presbítero', iglesia_id: igl.id })).json;
  const muerto = (await api('POST', '/pastores', { nombres: 'Difunto', apellidos: `Ejerce ${m}`, cargo: 'Pastor Presbítero', iglesia_id: igl.id, estado: 'Fallecido' })).json;

  const negado = await api('PUT', `/iglesias/${igl.id}`, { pastor_id: muerto.id, igual_asi: true });
  assert.equal(negado.estado, 400, 'designar a un fallecido tiene que frenarse');
  assert.match(negado.json.error, /Fallecido/);

  assert.equal((await api('PUT', `/iglesias/${igl.id}`, { pastor_id: vivo.id, igual_asi: true })).estado, 200);

  const ofrece = (await api('GET', '/pastores/con-conyuge')).json.filter((o) => o.label.includes(m));
  assert.ok(ofrece.some((o) => /Vivo/.test(o.label)), 'al que ejerce sí');
  assert.ok(!ofrece.some((o) => /Difunto/.test(o.label)), 'al fallecido no');

  const conAdemas = (await api('GET', `/pastores/con-conyuge?ademas=${muerto.id}`)).json;
  assert.ok(conAdemas.some((o) => Number(o.id) === Number(muerto.id)),
    'con «además» sí, o abrir esa ficha y guardar le borraría el dato');

  const pregunta = await api('PUT', `/pastores/${vivo.id}`, { estado: 'Fallecido' });
  assert.equal(pregunta.estado, 400);
  assert.equal(pregunta.json.confirmar, 'deja_de_ejercer_y_esta_a_cargo');

  assert.equal((await api('PUT', `/pastores/${vivo.id}`, { estado: 'Fallecido', igual_asi: true })).estado, 200);
  const despues = (await api('GET', `/iglesias/${igl.id}`)).json;
  assert.equal(despues.pastor_id, null, 'la iglesia queda sin pastor principal, como dijo la pregunta');

  const linea = db
    .prepare('SELECT descripcion FROM historial_iglesias WHERE iglesia_id = ? ORDER BY id DESC LIMIT 1')
    .get(igl.id);
  assert.match(linea.descripcion, /Fallecido/,
    'y su historial dice que fue porque dejó de ejercer, no que se cambió de iglesia');
});

test('y la pregunta tiene su propia cara en la pantalla', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const COMO_SE_PREGUNTA = {');
  const catalogo = app.slice(desde, app.indexOf('\n  };', desde));
  assert.match(catalogo, /deja_de_ejercer_y_esta_a_cargo: \{/);
  assert.match(catalogo, /Ya no ejerce, guardar/);
});

test('el módulo declara su desplegable por omisión, o la regla no llega a los demás', () => {
  assert.equal(PASTORES.opcionesPorDefecto, '/pastores/con-conyuge?ademas={pastor_id}');
});

test('y el «además» no deja al desplegable esperando otro campo', () => {
  /*
   * Se vio en el navegador y no en las pruebas: con la ficha sin pastor, el
   * desplegable de «Pastor principal» decía «— elija primero el cuerpo —».
   * La pantalla toma los `{campos}` de una ruta como dependencias, y
   * `?ademas={pastor_id}` en el campo `pastor_id` es el propio campo: vacío
   * con toda razón en una ficha nueva. El propio nombre no cuenta.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function camposDeLaRuta(');
  const cuerpo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(cuerpo, /\.filter\(\(campo\) => campo !== f\.name\)/,
    'camposDeLaRuta tiene que descartar el propio nombre del campo');
});
