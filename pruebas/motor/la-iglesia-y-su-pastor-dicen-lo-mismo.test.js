/**
 * Que la iglesia y su pastor no se contradigan.
 *
 * La relación está escrita DOS VECES Y EN DOS DIRECCIONES: la ficha de la
 * iglesia tiene «Pastor principal» y la del pastor tiene «Iglesia». Nadie
 * comprobaba que las dos dijeran lo mismo. Medido:
 *
 *   se le pone a «Iglesia A» el pastor de «Iglesia B»
 *     guardar ...................... 200, aceptado sin decir nada
 *     la ficha de A dice ........... su pastor es Pedro
 *     la ficha de Pedro dice ....... soy de «Iglesia B»
 *
 *   y por el otro lado, que es peor porque nadie iría a mirarlo
 *     a Pedro se lo traslada a A ... 200, sin decir nada
 *     «Iglesia B» sigue diciendo ... mi pastor es Pedro
 *     «Iglesia A» dice ............. no tengo pastor
 *
 * De «Pastor principal» sale «A cargo de la iglesia», que nombra al pastor y a
 * su cónyuge, y es lo que la organización lee para saber quién responde por esa
 * congregación.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const suPastor = require('../../server/pastor-de-la-iglesia');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const IGLESIAS = getModule('iglesias');
const PASTORES = getModule('pastores');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const unaIglesia = (nombre) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(nombre, `PAS${marca()}`).lastInsertRowid;

let rut = 27000000 + (process.pid % 400000);
const unPastor = (iglesiaId, apellidos = 'Del Aotra') => {
  const r = String(++rut);
  return db.prepare(
    `INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, cargo, estado)
     VALUES ('Pedro', ?, ?, ?, 'Pastor Presbítero', 'Activo')`
  ).run(`${apellidos} ${marca()}`, `${r}-${digitoVerificador(r)}`, iglesiaId).lastInsertRowid;
};

/** La pregunta al guardar una iglesia, o null. */
const alGuardarLaIglesia = (id, data, { existing = null, confirmado = false } = {}) =>
  IGLESIAS.hooks.beforeSave(data, { id, existing, db, confirmado });

/** La pregunta al guardar un pastor, o null. */
const alGuardarElPastor = (id, data, { existing = null, confirmado = false } = {}) =>
  PASTORES.hooks.beforeSave(data, { id, existing, db, confirmado });

const filaDe = (tabla, id) => db.prepare(`SELECT * FROM "${tabla}" WHERE id = ?`).get(id);

// ------------------------------------------- desde la ficha de la iglesia ----

test('poner el pastor de otra iglesia pregunta, y dice de cuál es', () => {
  const a = unaIglesia(`Iglesia A ${marca()}`);
  const b = unaIglesia(`Iglesia B ${marca()}`);
  const pastor = unPastor(b);

  const pregunta = alGuardarLaIglesia(a, { pastor_id: pastor }, { existing: filaDe('iglesias', a) });
  assert.equal(pregunta.confirmar, 'pastor_de_otra_iglesia');
  assert.match(pregunta.error, new RegExp(filaDe('iglesias', b).nombre),
    'el aviso tiene que decir de qué iglesia es HOY ese pastor: es el dato con que se decide');
  assert.match(pregunta.error, new RegExp(filaDe('iglesias', a).nombre), 'y en cuál lo están poniendo');
  assert.match(pregunta.error, /A cargo de la iglesia/, 'y por qué importa este campo en particular');
});

test('y contestada, deja pasar: hay casos legítimos', () => {
  /*
   * Un pastor que atiende dos congregaciones, un interinato mientras se designa
   * a alguien. Se pregunta, no se prohíbe, como al nombrar responsable de una
   * cuenta a alguien de otra iglesia (1.221.0).
   */
  const a = unaIglesia(`Iglesia C ${marca()}`);
  const pastor = unPastor(unaIglesia(`Iglesia D ${marca()}`));
  assert.equal(
    alGuardarLaIglesia(a, { pastor_id: pastor }, { existing: filaDe('iglesias', a), confirmado: true }),
    null
  );
});

test('el pastor de la misma iglesia no pregunta nada', () => {
  const a = unaIglesia(`Iglesia E ${marca()}`);
  const pastor = unPastor(a);
  assert.equal(alGuardarLaIglesia(a, { pastor_id: pastor }, { existing: filaDe('iglesias', a) }), null);
});

test('ni un pastor sin iglesia escrita en su ficha', () => {
  /*
   * No contradice nada: es la misma excepción que hace el aviso del responsable
   * de una cuenta con el miembro sin iglesia.
   */
  const a = unaIglesia(`Iglesia F ${marca()}`);
  const pastor = unPastor(null);
  assert.equal(alGuardarLaIglesia(a, { pastor_id: pastor }, { existing: filaDe('iglesias', a) }), null);
});

test('ni quitarle el pastor a una iglesia', () => {
  const a = unaIglesia(`Iglesia G ${marca()}`);
  const pastor = unPastor(unaIglesia(`Iglesia H ${marca()}`));
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, a);
  assert.equal(alGuardarLaIglesia(a, { pastor_id: null }, { existing: filaDe('iglesias', a) }), null);
});

test('y no se vuelve a preguntar por uno que ya se aceptó', () => {
  /*
   * Volver a preguntarlo cada vez que alguien le corrige el teléfono a la
   * iglesia no es cuidar el dato: es enseñar a apretar «Está bien» sin leer.
   */
  const a = unaIglesia(`Iglesia I ${marca()}`);
  const pastor = unPastor(unaIglesia(`Iglesia J ${marca()}`));
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, a);
  const existing = filaDe('iglesias', a);

  assert.equal(alGuardarLaIglesia(a, { telefono: '+56 2 2222 3333' }, { existing }), null,
    'este guardado no toca el pastor');
  assert.equal(alGuardarLaIglesia(a, { pastor_id: pastor }, { existing }), null,
    'y volver a mandar el mismo tampoco es cambiarlo');
});

test('al CREAR una iglesia con el pastor de otra, también pregunta', () => {
  const pastor = unPastor(unaIglesia(`Iglesia K ${marca()}`));
  const pregunta = alGuardarLaIglesia(undefined,
    { nombre: `Iglesia L ${marca()}`, codigo: `NUE${marca()}`, pastor_id: pastor }, { existing: null });
  assert.equal(pregunta.confirmar, 'pastor_de_otra_iglesia');
  assert.match(pregunta.error, /la que está creando/, 'todavía no tiene nombre guardado que nombrar');
});

test('la pregunta va DESPUÉS de lo que se rechaza', () => {
  /*
   * El motor deja pasar UNA pregunta por guardado, así que el orden decide cuál
   * se ve. Una pregunta contestada «está bien» sobre una ficha que igual va a
   * ser rechazada es una pregunta perdida.
   */
  const pastor = unPastor(unaIglesia(`Iglesia M ${marca()}`));
  const rechazo = alGuardarLaIglesia(undefined,
    { nombre: 'Sin código', codigo: '   ', pastor_id: pastor }, { existing: null });
  assert.equal(typeof rechazo, 'string', 'el código vacío se rechaza, no se pregunta');
  assert.match(rechazo, /Escriba el código/);
});

// -------------------------------------------- desde la ficha del pastor ----

test('trasladar a un pastor que su iglesia nombra pregunta, y dice qué va a pasar', () => {
  const b = unaIglesia(`Iglesia N ${marca()}`);
  const a = unaIglesia(`Iglesia O ${marca()}`);
  const pastor = unPastor(b);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);

  const pregunta = alGuardarElPastor(pastor, { iglesia_id: a }, { existing: filaDe('pastores', pastor) });
  assert.equal(pregunta.confirmar, 'deja_su_iglesia_sin_pastor');
  assert.match(pregunta.error, new RegExp(filaDe('iglesias', b).nombre), 'la que queda sin pastor');
  assert.match(pregunta.error, new RegExp(filaDe('iglesias', a).nombre), 'y a cuál se va');
  assert.match(pregunta.error, /queda\s*\n?\s*sin pastor principal anotado|queda sin pastor principal anotado/,
    'la pregunta tiene que decir lo que va a pasar, porque va a pasar');
});

test('y confirmado, la iglesia anterior queda sin pastor anotado', () => {
  const b = unaIglesia(`Iglesia P ${marca()}`);
  const a = unaIglesia(`Iglesia Q ${marca()}`);
  const pastor = unPastor(b);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);

  const antes = filaDe('pastores', pastor);
  db.prepare('UPDATE pastores SET iglesia_id = ? WHERE id = ?').run(a, pastor);
  PASTORES.hooks.afterSave(filaDe('pastores', pastor), { existing: antes, user: null, db });

  assert.equal(filaDe('iglesias', b).pastor_id, null,
    'dejarlo puesto haría que su ficha dijera que su pastor es alguien que ya es de otra');

  const anotado = db
    .prepare("SELECT COUNT(*) AS n FROM historial_iglesias WHERE iglesia_id = ? AND descripcion LIKE ?")
    .get(b, '%dejó de figurar como pastor(a) principal%').n;
  assert.ok(anotado > 0, 'una congregación que se queda sin quien responda por ella tiene que quedar anotado');
});

test('si ninguna iglesia lo nombra, no pregunta ni toca nada', () => {
  const b = unaIglesia(`Iglesia R ${marca()}`);
  const a = unaIglesia(`Iglesia S ${marca()}`);
  const pastor = unPastor(b); // nadie lo tiene como pastor principal
  assert.equal(alGuardarElPastor(pastor, { iglesia_id: a }, { existing: filaDe('pastores', pastor) }), null);
});

test('ni si lo pasan a la MISMA iglesia que ya lo nombra', () => {
  const b = unaIglesia(`Iglesia T ${marca()}`);
  const pastor = unPastor(null);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);
  assert.equal(alGuardarElPastor(pastor, { iglesia_id: b }, { existing: filaDe('pastores', pastor) }), null,
    'ahí las dos fichas pasan a decir lo mismo, que es lo que se quiere');
});

test('dejarlo sin ninguna iglesia también pregunta', () => {
  const b = unaIglesia(`Iglesia U ${marca()}`);
  const pastor = unPastor(b);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);
  const pregunta = alGuardarElPastor(pastor, { iglesia_id: null }, { existing: filaDe('pastores', pastor) });
  assert.equal(pregunta.confirmar, 'deja_su_iglesia_sin_pastor');
  assert.match(pregunta.error, /ninguna iglesia/);
});

test('y corregirle el teléfono no le saca el pastor a su iglesia', () => {
  /*
   * Si se soltara en cada guardado, corregirle un dato a un pastor dejaría a su
   * congregación sin quien responda por ella, y con una línea en su historial
   * diciendo que se fue.
   */
  const b = unaIglesia(`Iglesia V ${marca()}`);
  const pastor = unPastor(b);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);
  const fila = filaDe('pastores', pastor);

  assert.equal(alGuardarElPastor(pastor, { telefono: '+56 9 1111 2222' }, { existing: fila }), null);
  PASTORES.hooks.afterSave({ ...fila, telefono: '+56 9 1111 2222' }, { existing: fila, user: null, db });
  assert.equal(filaDe('iglesias', b).pastor_id, pastor, 'su iglesia lo sigue nombrando');
});

test('ni a un pastor SIN iglesia que alguna sigue nombrando', () => {
  /*
   * Es el caso que hace falta el guardia del gancho, y que no se ve de entrada:
   * cuando el pastor no tiene iglesia, no hay ninguna «iglesia nueva» que
   * excluir de la búsqueda, así que TODAS las que lo nombran salen. Sin
   * comprobar que la iglesia cambia en este guardado, corregirle el teléfono a
   * un pastor sin iglesia le sacaría el pastor principal a la congregación que
   * lo nombra —y le dejaría la línea en el historial diciendo que se fue—.
   */
  const b = unaIglesia(`Iglesia V2 ${marca()}`);
  const pastor = unPastor(null);
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(pastor, b);
  const fila = filaDe('pastores', pastor);

  PASTORES.hooks.afterSave({ ...fila, telefono: '+56 9 3333 4444' },
    { existing: fila, user: null, db });
  assert.equal(filaDe('iglesias', b).pastor_id, pastor,
    'este guardado no le cambió la iglesia: no hay nada que soltar');
});

test('una ficha de pastor nueva no deja nada atrás', () => {
  const a = unaIglesia(`Iglesia W ${marca()}`);
  assert.equal(alGuardarElPastor(undefined, { iglesia_id: a }, { existing: null }), null);
});

// -------------------------------------------- cómo se ven en la pantalla ----

test('cada pregunta tiene su propio encabezado y sus propios botones', () => {
  /*
   * La pantalla tiene un catálogo de caras para las preguntas del servidor, y
   * existe por algo: antes estaba fijo «Revise este monto», y al aparecer la
   * segunda pregunta —una que no hablaba de ningún monto— la pantalla la
   * encabezaba igual. Una clave que no está en el catálogo cae en el texto
   * genérico, que funciona pero no dice nada de lo que se está preguntando.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const COMO_SE_PREGUNTA = {');
  assert.ok(desde > 0, 'no está el catálogo de preguntas');
  const catalogo = app.slice(desde, app.indexOf('\n  };', desde));

  for (const clave of ['pastor_de_otra_iglesia', 'deja_su_iglesia_sin_pastor']) {
    assert.match(catalogo, new RegExp(`${clave}: \\{`), `«${clave}» no tiene cara propia`);
  }
  assert.match(catalogo, /Ese pastor es de otra iglesia/);
  assert.match(catalogo, /Atiende las dos, guardar/, 'el botón dice lo que significa contestar que sí');
  assert.match(catalogo, /Su iglesia queda sin pastor principal/);
  assert.match(catalogo, /Trasladarlo igual/);
});

// ------------------------------------------ guardando de verdad, las dos ----

test('guardando de verdad: las dos fichas dejan de contradecirse', async () => {
  const api = await elSistemaAndando();
  const m = `coherente-${process.pid}`;
  const nueva = async (cual) => (await api('POST', '/iglesias', {
    nombre: `Iglesia ${cual} ${m}`, codigo: `${cual}${process.pid}`, estado: 'Activa',
  })).json;
  const a = await nueva('A');
  const b = await nueva('B');
  const r = String(28000000 + (process.pid % 400000));
  const pastor = await api('POST', '/pastores', {
    nombres: 'Pedro', apellidos: `Del Be ${m}`, rut: `${r}-${digitoVerificador(r)}`,
    iglesia_id: b.id, cargo: 'Pastor Presbítero', estado: 'Activo',
  });
  assert.equal(pastor.estado, 201, pastor.texto.slice(0, 200));
  assert.equal((await api('PUT', `/iglesias/${b.id}`, { pastor_id: pastor.json.id })).estado, 200,
    'guardia: su propia iglesia lo nombra sin preguntar nada');

  // 1 · ponérselo a la otra iglesia
  const puesto = await api('PUT', `/iglesias/${a.id}`, { pastor_id: pastor.json.id });
  assert.equal(puesto.estado, 400, 'ponerle a una iglesia el pastor de otra tiene que preguntar');
  assert.equal(puesto.json.confirmar, 'pastor_de_otra_iglesia');
  /*
   * El «está bien, guardar así» de un GUARDADO viaja en el cuerpo, no en la
   * dirección: `req.body.igual_asi`. En un borrado va al revés, en la
   * dirección, porque un DELETE no lleva cuerpo (ver server/crud.js).
   */
  assert.equal((await api('PUT', `/iglesias/${a.id}`,
    { pastor_id: pastor.json.id, igual_asi: true })).estado, 200);

  // 2 · y trasladarlo, dejando a B nombrándolo
  await api('PUT', `/iglesias/${a.id}`, { pastor_id: null, igual_asi: true });
  const traslado = await api('PUT', `/pastores/${pastor.json.id}`, { iglesia_id: a.id });
  assert.equal(traslado.estado, 400, 'trasladarlo tiene que preguntar');
  assert.equal(traslado.json.confirmar, 'deja_su_iglesia_sin_pastor');

  assert.equal((await api('PUT', `/pastores/${pastor.json.id}`,
    { iglesia_id: a.id, igual_asi: true })).estado, 200);
  assert.equal((await api('GET', `/iglesias/${b.id}`)).json.pastor_id, null,
    'B ya no puede seguir diciendo que su pastor es alguien que es de A');
  assert.equal((await api('GET', `/pastores/${pastor.json.id}`)).json.iglesia_id, a.id);
});
