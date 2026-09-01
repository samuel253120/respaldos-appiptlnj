/**
 * La iglesia de un acta sale de su cuerpo, siempre.
 *
 * El formulario pedía la iglesia y el cuerpo por separado, como si fueran dos
 * datos independientes. No lo son: cada cuerpo pertenece a una iglesia y a una
 * sola. Nadie comprobaba que coincidieran, y había dos puertas abiertas.
 * Medido en la v1.270.0, sobre el sistema andando:
 *
 *   crear un acta del cuerpo A mandando la iglesia B ..... 201
 *   quedó guardada con ................................... iglesia B / cuerpo A
 *   pasar un acta del cuerpo A al cuerpo B (que es de B) . 200
 *   quedó con ........................................... iglesia A / cuerpo B
 *
 * Lo que se rompe con eso no es la ficha: es QUIÉN LA VE. De ese campo sale el
 * alcance (server/alcance.js), y el alcance pide las dos cosas —la iglesia Y el
 * cuerpo—, así que un acta con el cuerpo correcto y la iglesia de otra
 * congregación no pasa el filtro de nadie. Medido en la base de trabajo: de las
 * ocho actas del cuerpo n.º 14, su propio líder veía siete. La octava era la mal
 * anotada, y no avisaba nada.
 *
 * Es el mismo defecto que la 1.263.0 le corrigió a las directivas, y se arregla
 * igual: el campo pasa a ser de solo lectura y la iglesia se deduce del cuerpo
 * EN CADA GUARDADO, no solo cuando llega vacía —el formulario nunca la manda
 * vacía: manda lo que ya estaba cargado—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 33900000 + (process.pid % 100000) * 2;
const otroRut = () => { const c = String(++rut); return `${c}-${digitoVerificador(c)}`; };

/** Dos iglesias con un cuerpo cada una. Es todo lo que hace falta acá. */
function dosIglesias() {
  const m = marca();
  const iglesia = (cual) => db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${cual} ${m}`, `ACT${cual}${m}`).lastInsertRowid;
  const A = iglesia('A');
  const B = iglesia('B');
  const cuerpo = (enIglesia, cual) => db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${cual} ${m}`, enIglesia).lastInsertRowid;
  return { m, A, B, cuerpoA: cuerpo(A, 'A'), cuerpoB: cuerpo(B, 'B') };
}

const unActa = (api, e, cambios) => api('POST', '/actas_reuniones', {
  numero_acta: `${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-03-15', cuerpo_id: e.cuerpoA, ...cambios,
});

/** Como la manda la pantalla: la ficha entera, con lo que ya tenía cargado. */
async function comoElFormulario(api, id, cambios) {
  const ficha = (await api('GET', `/actas_reuniones/${id}`)).json;
  const cuerpo = { ...ficha, ...cambios };
  delete cuerpo.id;
  return api('PUT', `/actas_reuniones/${id}`, cuerpo);
}

const traer = (id) => db.prepare('SELECT * FROM actas_reuniones WHERE id = ?').get(id);

// ------------------------------------------- la iglesia sale del cuerpo ----

test('un acta nace en la iglesia de su cuerpo', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const a = await unActa(api, e);
  assert.equal(a.estado, 201);
  assert.equal(traer(a.json.id).iglesia_id, e.A);
});

test('y una iglesia puesta a mano no manda sobre la de su cuerpo', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const a = await unActa(api, e, { iglesia_id: e.B });
  assert.equal(a.estado, 201, 'no se rechaza: se corrige, que es lo que la persona quiso decir');
  assert.equal(traer(a.json.id).iglesia_id, e.A, 'se guardó la de su cuerpo, no la que se mandó');
});

test('mudar el acta a un cuerpo de otra iglesia se la lleva con él', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const a = await unActa(api, e);
  assert.equal(traer(a.json.id).iglesia_id, e.A, 'nace en la de su cuerpo');

  const r = await comoElFormulario(api, a.json.id, { cuerpo_id: e.cuerpoB });
  assert.equal(r.estado, 200);
  assert.equal(traer(a.json.id).iglesia_id, e.B,
    'de ese campo sale quién la ve: quedándose en la vieja, la ve quien ya no corresponde');
});

test('la iglesia se vuelve a deducir en CADA guardado, no solo al crear', async () => {
  /*
   * Éste es el hueco exacto que tenían las directivas: heredar la iglesia solo
   * cuando el campo viene vacío no sirve de nada, porque el formulario nunca la
   * manda vacía.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const a = await unActa(api, e);
  // se le tuerce por detrás, como si viniera de antes del arreglo
  db.prepare('UPDATE actas_reuniones SET iglesia_id = ? WHERE id = ?').run(e.B, a.json.id);
  const r = await comoElFormulario(api, a.json.id, { lugar: 'Salón de siempre' });
  assert.equal(r.estado, 200);
  assert.equal(traer(a.json.id).iglesia_id, e.A, 'el guardado siguiente la endereza sola');
});

test('el campo Iglesia es de solo lectura, y por eso ya no es obligatorio', () => {
  const campo = (getModule('actas_reuniones').fields || []).find((f) => f.name === 'iglesia_id');
  assert.equal(campo.readonly, true, 'nadie lo escribe: sale del cuerpo');
  assert.ok(!campo.required,
    'un campo de solo lectura llega vacío al guardado: exigirlo dejaría de entrar toda acta nueva');
  assert.match(campo.help || '', /su cuerpo/, 'y la ayuda dice de dónde sale');
});

test('y aunque llegara escrita, el guardado la reemplaza por la de su cuerpo', () => {
  /*
   * Las dos mitades de este arreglo se tapan una a la otra, y por eso hay que
   * probarlas por separado. Ser de SOLO LECTURA hace que el motor descarte el
   * campo antes de llegar al gancho, así que por la API la regla no se puede ver
   * fallar; DEDUCIRLA SIEMPRE es la regla en sí, y se comprueba llamando al
   * gancho derecho, que es la única manera de que el valor llegue puesto.
   */
  const e = dosIglesias();
  const data = { cuerpo_id: e.cuerpoB, iglesia_id: e.A, numero_acta: `a mano ${e.m}`, fecha: '2026-03-15' };
  getModule('actas_reuniones').hooks.beforeSave(data, { db, id: null, existing: null, isNew: true, confirmado: true });
  assert.equal(data.iglesia_id, e.B, 'la de su cuerpo, no la que traía');
});

test('sin cuerpo no hay de dónde deducirla, y el gancho no inventa ninguna', () => {
  /*
   * El cuerpo es obligatorio, así que por la API esto no llega; pero el gancho
   * tiene que aguantarlo igual, porque también lo llama la importación de
   * planillas (server/importar.js) con lo que traiga el archivo.
   */
  const data = { numero_acta: 'sin cuerpo', fecha: '2026-03-15', iglesia_id: 7 };
  getModule('actas_reuniones').hooks.beforeSave(data, { db, id: null, existing: null, isNew: true, confirmado: false });
  assert.equal(data.iglesia_id, 7, 'no toca lo que no puede deducir');
});

// ------------------------------------ lo que de verdad se estaba rompiendo ----

test('el acta ya no se le esconde a la secretaria de su propio cuerpo', async () => {
  /*
   * Ésta es la consecuencia, y es la razón por la que el hallazgo es grave. El
   * alcance pide la iglesia Y el cuerpo: un acta con el cuerpo correcto y la
   * iglesia de otra congregación se caía del listado de la única persona que
   * la habría ido a buscar, sin decir una palabra.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  await unActa(api, e);                        // bien anotada
  await unActa(api, e, { iglesia_id: e.B });   // con la iglesia torcida a mano

  // Secretaria porque es quien lleva el libro: su rol trae las actas de fábrica
  // (ver server/permissions.js). Acotada a la iglesia A y al cuerpo A.
  const suRut = otroRut();
  const quien = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, cuerpos, iglesia_id)
     VALUES (?, ?, 'secretario', 1, ?, ?, ?)`
  ).run(suRut, `Secretaria ${suRut}`, JSON.stringify([e.A]), JSON.stringify([e.cuerpoA]), e.A).lastInsertRowid;

  const suya = comoOtroUsuario(quien);
  const lista = await suya('GET', `/actas_reuniones?limit=50&f_cuerpo_id=${e.cuerpoA}`);
  assert.equal(lista.estado, 200);
  assert.equal(lista.json.total, 2, 'las dos son de su cuerpo: tiene que ver las dos');
});
