/**
 * Cambiarle el cuerpo a una directiva.
 *
 * El campo «Cuerpo» es un desplegable que se puede cambiar como cualquier otro,
 * y es lo que se hace cuando alguien eligió mal el cuerpo al crear la directiva.
 * Medido sobre una directiva del cuerpo A (iglesia 1) pasada al cuerpo B
 * (iglesia 2), mandando la ficha entera como la manda el formulario:
 *
 *   al guardar ............................. 200
 *   su cuerpo pasó a la iglesia ............ 2
 *   la directiva quedó anotada en la ....... 1, la vieja
 *   sus cargos ............................. los mismos, y no son de ese cuerpo
 *
 * DE ESE CAMPO SALE QUIÉN LA VE (server/alcance.js), así que la directiva la
 * seguía viendo la congregación que ya no era suya, y la que ahora la tiene no
 * la veía. Es el mismo defecto que la 1.220.0 le corrigió al cuerpo que se muda
 * de iglesia, pero por el otro lado.
 *
 * Y los cargos tampoco se volvían a mirar: el guardado revisa solo lo que
 * cambia, y al mudar el cuerpo los cargos no cambian —cambia contra quién se
 * miden—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Dos iglesias, un cuerpo en cada una, y gente para ocupar los cargos. */
function dosIglesias() {
  const m = marca();
  const iglesia = (cual) => db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${cual} ${m}`, `MUD${cual}${m}`).lastInsertRowid;
  const A = iglesia('A');
  const B = iglesia('B');
  const cuerpo = (enIglesia, cual) => db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${cual} ${m}`, enIglesia).lastInsertRowid;
  const cuerpoA = cuerpo(A, 'A');
  const cuerpoB = cuerpo(B, 'B');

  const persona = (enIglesia, comoSeLlama) => db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(comoSeLlama, `Demudanza ${m}`, enIglesia).lastInsertRowid;
  const meter = (enCuerpo, quien, enIglesia) => db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado,
                                              fecha_ingreso, iglesia_id)
              VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', '2015-01-01', ?)`)
    .run(enCuerpo, quien, enIglesia);

  const deA = persona(A, 'SoloDeA');
  const enLosDos = persona(A, 'EnLosDos');
  meter(cuerpoA, deA, A);
  meter(cuerpoA, enLosDos, A);
  meter(cuerpoB, enLosDos, B);

  return { m, A, B, cuerpoA, cuerpoB, deA, enLosDos };
}

const unaDirectiva = (api, e, jefe) => api('POST', '/directivas', {
  cuerpo_id: e.cuerpoA, periodo: `p ${e.m}`, fecha_inicio: '2020-01-01', fecha_termino: '2021-12-31',
  estado: 'Finalizada', primer_jefe_id: jefe,
});

/** Como la manda el formulario: la ficha entera, con lo que ya tenía cargado. */
async function comoElFormulario(api, id, cambios) {
  const ficha = (await api('GET', `/directivas/${id}`)).json;
  const cuerpo = { ...ficha, ...cambios };
  delete cuerpo.id;
  return api('PUT', `/directivas/${id}`, cuerpo);
}

const traer = (id) => db.prepare('SELECT * FROM directivas WHERE id = ?').get(id);

// --------------------------------------------- la iglesia sale del cuerpo ----

test('mudar la directiva a un cuerpo de otra iglesia se la lleva con él', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.enLosDos);
  assert.equal(traer(d.json.id).iglesia_id, e.A, 'nace en la de su cuerpo');

  const r = await comoElFormulario(api, d.json.id, { cuerpo_id: e.cuerpoB });
  assert.equal(r.estado, 200, 'su jefe está en los dos cuerpos, así que la mudanza es legítima');
  assert.equal(traer(d.json.id).iglesia_id, e.B,
    'y de ese campo sale quién la ve: quedándose en la vieja, la ve quien ya no corresponde');
});

test('y una iglesia puesta a mano no manda sobre la de su cuerpo', async () => {
  /*
   * La iglesia de una directiva no es un dato propio: es la de su cuerpo. Un
   * dato que se deduce no se pregunta, y por eso además el campo es de solo
   * lectura.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const r = await api('POST', '/directivas', {
    cuerpo_id: e.cuerpoA, periodo: `torcida ${e.m}`, fecha_inicio: '2016-01-01', fecha_termino: '2016-12-31',
    estado: 'Finalizada', primer_jefe_id: e.deA, iglesia_id: e.B,
  });
  assert.equal(r.estado, 201);
  assert.equal(traer(r.json.id).iglesia_id, e.A, 'se guardó la de su cuerpo, no la que se mandó');
});

test('el campo Iglesia es de solo lectura', () => {
  const campo = (getModule('directivas').fields || []).find((f) => f.name === 'iglesia_id');
  assert.equal(campo.readonly, true, 'nadie lo escribe: sale del cuerpo');
  assert.match(campo.help || '', /su cuerpo/, 'y la ayuda dice de dónde sale');
});

test('y aunque llegara escrita, el guardado la reemplaza por la de su cuerpo', () => {
  /*
   * Las dos mitades de este arreglo se tapan una a la otra, y por eso hay que
   * probarlas por separado. Ser de SOLO LECTURA hace que el motor descarte el
   * campo antes de llegar acá, así que por la API la regla no se puede ver
   * fallar; DEDUCIRLA SIEMPRE es la regla en sí —la iglesia de una directiva es
   * la de su cuerpo, y punto—, y se comprueba llamando al gancho derecho, que es
   * la única manera de que el valor llegue puesto.
   *
   * Sin esta comprobación, volver a la versión vieja del gancho —«hereda solo si
   * viene vacía»— no hacía fallar nada, y quedaba una regla sostenida por una
   * marca de la pantalla.
   */
  const e = dosIglesias();
  const data = { cuerpo_id: e.cuerpoB, iglesia_id: e.A, periodo: 'a mano', fecha_inicio: '2019-01-01' };
  getModule('directivas').hooks.beforeSave(data, { db, id: null, existing: null, isNew: true, confirmado: true });
  assert.equal(data.iglesia_id, e.B, 'la de su cuerpo, no la que traía');
});

test('la iglesia se vuelve a deducir en CADA guardado, no solo al crear', async () => {
  /*
   * Éste es el hueco exacto: antes se heredaba solo si el campo venía vacío, y
   * el formulario nunca lo manda vacío —manda lo que ya estaba cargado—.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.enLosDos);
  // se le tuerce la iglesia por detrás, como si viniera de antes del arreglo
  db.prepare('UPDATE directivas SET iglesia_id = ? WHERE id = ?').run(e.B, d.json.id);

  const r = await api('PUT', `/directivas/${d.json.id}`, { notas: 'una corrección cualquiera' });
  assert.equal(r.estado, 200);
  assert.equal(traer(d.json.id).iglesia_id, e.A,
    'cualquier guardado la devuelve a la de su cuerpo');
});

// ------------------------------- y los cargos se vuelven a mirar ----

test('mudarla con cargos que no son del cuerpo nuevo se frena', async () => {
  /*
   * Es el caso corriente: alguien eligió mal el cuerpo al crearla, así que los
   * cargos se eligieron de la lista equivocada y están todos mal. El aviso es el
   * mismo de siempre, con las mismas palabras, porque es la misma regla.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.deA);

  const r = await comoElFormulario(api, d.json.id, { cuerpo_id: e.cuerpoB });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no es integrante de/);
  assert.match(r.json.error, /Primer jefe/);
  assert.equal(traer(d.json.id).cuerpo_id, e.cuerpoA, 'y no se mudó nada');
  assert.equal(traer(d.json.id).iglesia_id, e.A);
});

test('también por la API, mandando solo el cuerpo', async () => {
  /*
   * Por acá el guardado no trae los cargos, así que la comprobación tiene que
   * mirarlos en la ficha anterior: si mirara solo lo que llega, esta puerta
   * quedaría abierta.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.deA);

  const r = await api('PUT', `/directivas/${d.json.id}`, { cuerpo_id: e.cuerpoB });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no es integrante de/);
});

test('pero corregirle una nota sin mudarla no revisa nada', async () => {
  /*
   * La regla de siempre: se revisa lo que cambia. Si alguien salió del cuerpo
   * después de haber sido electo, su directiva se puede seguir corrigiendo —de
   * eso avisa el cumplimiento, y no un rechazo al guardar—.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.deA);
  db.prepare("UPDATE integrantes_cuerpo SET estado = 'Retirado' WHERE cuerpo_id = ? AND miembro_id = ?")
    .run(e.cuerpoA, e.deA);

  const r = await api('PUT', `/directivas/${d.json.id}`, { notas: 'una corrección cualquiera' });
  assert.equal(r.estado, 200);
});

test('y mudarla a un cuerpo de la MISMA iglesia se revisa igual', async () => {
  /*
   * Lo que hace falta revisar no es que cambie de iglesia: es que cambie la
   * gente contra la que se miden los cargos, y eso pasa con cualquier cuerpo.
   */
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const otroEnA = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Otro en A ${e.m}`, e.A).lastInsertRowid;
  const d = await unaDirectiva(api, e, e.deA);

  const r = await comoElFormulario(api, d.json.id, { cuerpo_id: otroEnA });
  assert.equal(r.estado, 400, 'el cuerpo nuevo no tiene a esa persona, aunque sea de la misma iglesia');
});

test('mudarla a un cuerpo cuya gente sí la incluye entra sin quejas', async () => {
  const api = await elSistemaAndando();
  const e = dosIglesias();
  const d = await unaDirectiva(api, e, e.enLosDos);
  const r = await comoElFormulario(api, d.json.id, { cuerpo_id: e.cuerpoB });
  assert.equal(r.estado, 200);
  assert.equal(traer(d.json.id).cuerpo_id, e.cuerpoB);
});
