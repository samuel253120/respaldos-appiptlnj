/**
 * Las asambleas en la ficha de su iglesia, y el acta que cambia de congregación.
 *
 * Dos cosas del libro de asambleas que tienen el mismo dueño: la IGLESIA es lo
 * único que un acta de asamblea tiene por encima. De ahí sale dónde se busca y
 * quién la ve.
 *
 * AS-07 · DÓNDE SE BUSCA. La ficha de una iglesia tiene pestaña para sus
 * miembros, sus cuerpos, sus pastores, su tesorería, su inventario, sus
 * documentos y su historial — y ninguna para sus asambleas, que es lo único que
 * solo la congregación entera tiene. Para verlas había que salir al listado
 * general y filtrar. La ficha de un CUERPO, más chica, sí tiene la suya desde
 * que se armó.
 *
 * AS-09 · QUIÉN LA VE. Medido en la v1.281.0: el acta de una asamblea de la
 * Iglesia Central se pasó a la Iglesia Norte con una sola petición, contestó 200
 * y no dijo nada. Se pregunta y no se impide, porque corregir la iglesia de un
 * acta mal anotada es exactamente para lo que ese campo tiene que poder
 * cambiarse; lo que no puede pasar es que se cambie sin ver lo que arrastra.
 *
 * EL ALCANCE NO ES LO QUE FALTABA, y se comprueba abajo: quien está acotado a
 * una iglesia no puede mover un acta hacia otra ni crear una allá. El aviso es
 * para quien alcanza las dos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Dos congregaciones, cada una con su gente. */
function dosIglesias() {
  const m = marca();
  const hace = (cual, cuantos) => {
    const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
      .run(`Iglesia ${cual} ${m}`, `${cual}${m}`.slice(0, 12)).lastInsertRowid;
    const mete = db.prepare(
      "INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')");
    for (let i = 0; i < cuantos; i += 1) mete.run(`Persona${i}`, `${cual} ${m}`, id);
    return id;
  };
  return { m, A: hace('A', 40), B: hace('B', 40) };
}

const unActa = (api, iglesia, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `MUD-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-06-01', tipo: 'Ordinaria', iglesia_id: iglesia, total_asistentes: 20,
  acuerdos: '<p>Se aprueba lo de siempre.</p>', ...cambios,
});

// ------------------------------------ AS-07 · en la ficha de su iglesia ----

test('la ficha de una iglesia tiene su pestaña de asambleas', () => {
  /*
   * Que la pestaña ABRA y no salga en blanco lo comprueba la prueba de humo, que
   * recorre las de todas las fichas en un navegador de verdad. Acá se comprueba
   * que esté declarada para las iglesias —y no para otra cosa— y que su
   * contenido salga del módulo que corresponde.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../..', 'public/app.js'), 'utf8');

  const desdeIglesias = app.indexOf("if (name === 'iglesias') {");
  assert.ok(desdeIglesias > 0, 'no está el bloque de pestañas de una iglesia');
  const bloque = app.slice(desdeIglesias, app.indexOf("if (name === 'miembros'", desdeIglesias));
  assert.match(bloque, /sumar\('asambleas', 'Asambleas'/, 'la iglesia no tiene su pestaña');
  assert.match(bloque, /renderAsambleasDeLaIglesia\(id, c\)/, 'la pestaña no está conectada a nada');
  assert.match(bloque, /MOD\['actas_asambleas'\]/, 'tiene que respetar si el módulo está apagado');
});

test('y esa pestaña pide las asambleas DE esa iglesia, no todas', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../..', 'public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderAsambleasDeLaIglesia');
  assert.ok(desde > 0, 'no está quien pinta la pestaña');
  const cuerpo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(cuerpo, /\/actas_asambleas\?f_iglesia_id=\$\{iglesiaId\}/, 'traería las de todas');
  assert.match(cuerpo, /sort=fecha&dir=desc/, 'la última asamblea es la que se busca primero');
  assert.match(cuerpo, /hubo_quorum \? '' :/, 'sin quórum se ve sin abrir el acta');
});

test('el listado por iglesia que esa pestaña usa trae lo suyo y nada más', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  await unActa(api, e.A, e);
  await unActa(api, e.A, e);
  await unActa(api, e.B, e);

  const suyas = await api('GET', `/actas_asambleas?f_iglesia_id=${e.A}&limit=50`);
  assert.equal(suyas.estado, 200);
  assert.equal(suyas.json.total, 2, 'la pestaña mostraría un número equivocado');
  for (const fila of suyas.json.rows) assert.equal(fila.iglesia_id, e.A);
});

// ----------------------------------- AS-09 · el acta que cambia de libro ----

test('mover un acta a otra congregación se pregunta', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { iglesia_id: e.B });
  assert.equal(g.estado, 400);
  assert.equal(g.json.confirmar, 'acta_que_cambia_de_iglesia');
});

test('y el aviso dice de qué libro sale, a cuál entra, y qué arrastra', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { iglesia_id: e.B });
  const dice = g.json.error;
  assert.match(dice, new RegExp(`está en el libro de Iglesia A ${e.m}`));
  assert.match(dice, new RegExp(`va a pasar al de Iglesia B ${e.m}`));
  assert.match(dice, /El número se va con ella/, 'el número viaja, y es único por iglesia');
  assert.match(dice, /queda el hueco/, 'y en el libro viejo se nota');
  assert.match(dice, /quién puede verla/, 'de la iglesia sale el alcance');
});

test('confirmando, se mueve', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { iglesia_id: e.B, igual_asi: true });
  assert.equal(g.estado, 200, g.texto);
  const f = await api('GET', `/actas_asambleas/${r.json.id}`);
  assert.equal(f.json.iglesia_id, e.B);
});

test('si el número ya está usado en el libro de destino, el traslado se RECHAZA', async () => {
  /*
   * El número es único DENTRO de cada iglesia, así que el mismo puede existir en
   * las dos, y el traslado no puede ocurrir.
   *
   * Esto cambió de forma en la v1.283.0 y a mejor: antes, el aviso del traslado
   * traía adentro una advertencia de que el número estaba tomado y ofrecía
   * confirmar —y al confirmar, el guardado se caía igual contra el índice de la
   * base—. Ahora el motor lo revisa ANTES de este gancho y lo rechaza con su
   * propio aviso, nombrando el libro. Un traslado que no va a poder ocurrir se
   * rechaza; no se pregunta.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const numero = `CHOQUE-${e.m}`;
  const aca = await unActa(api, e.A, e, { numero_acta: numero });
  await unActa(api, e.B, e, { numero_acta: numero });

  const g = await api('PUT', `/actas_asambleas/${aca.json.id}`, { iglesia_id: e.B });
  assert.equal(g.estado, 400);
  assert.equal(g.json.confirmar, undefined, 'no se ofrece confirmar algo que no puede pasar');
  assert.match(g.json.error, /Ya existe otra acta de asamblea con ese Número de acta/);
  assert.match(g.json.error, new RegExp(`en «Iglesia B ${e.m}»`), 'y dice en qué libro');

  // Y confirmando tampoco: el rechazo del motor no se salta con «guardar igual»
  const igual = await api('PUT', `/actas_asambleas/${aca.json.id}`,
    { iglesia_id: e.B, igual_asi: true });
  assert.equal(igual.estado, 400);
});

test('cambiarle cualquier otra cosa no pregunta nada', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { lugar: 'Templo Central' });
  assert.equal(g.estado, 200, 'preguntar por cualquier guardado enseña a confirmar sin leer');
});

test('un acta nueva no se está mudando de ninguna parte', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);
  assert.equal(r.estado, 201, r.texto);
});

test('y el alcance, que no era lo que faltaba, sigue frenando a quien no alcanza', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await unActa(api, e.A, e);

  const num = `${92000000 + (process.pid % 7000000)}`;
  const suya = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, iglesia_id, debe_cambiar_password)
     VALUES (?, ?, 'secretario', 1, ?, ?, 0)`
  ).run(`${num}-${digitoVerificador(num)}`, `Secretaria de A ${e.m}`,
    JSON.stringify([e.A]), e.A).lastInsertRowid;
  const comoElla = comoOtroUsuario(suya);

  const mueve = await comoElla('PUT', `/actas_asambleas/${r.json.id}`, { iglesia_id: e.B });
  assert.equal(mueve.estado, 403, 'mover la suya a una iglesia ajena tiene que estar cerrado');

  const crea = await comoElla('POST', '/actas_asambleas', {
    numero_acta: `AJENA-${e.m}`, fecha: '2026-06-02', tipo: 'Ordinaria', iglesia_id: e.B });
  assert.equal(crea.estado, 403, 'crear una en una iglesia ajena, tampoco');
});
