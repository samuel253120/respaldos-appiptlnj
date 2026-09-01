/**
 * Lo que pasa cuando algo se va: la directiva entera, o solo un nombre de ella.
 *
 * Medido antes de esto, sobre un cuerpo con su directiva EN EJERCICIO completa:
 *
 *   DELETE de la directiva, sin confirmar ...... 200, borrada
 *   se le cambia el tesorero ................... 200
 *   al que DEJÓ el cargo ....................... 3 líneas antes, 3 después
 *   al que ASUME ............................... su «Asume como Tesorero(a)»
 *   se borra a la persona que era consejera .... 200
 *   la directiva quedó con consejero ........... vacío, sin decirlo
 *
 * Tres huecos distintos, del mismo tamaño: algo desapareció y el sistema no lo
 * dijo ni preguntó. Guardar una directiva pregunta TRES cosas —el traslape, la
 * que queda sin jefe, la persona en dos cargos— y borrarla entera, que es lo
 * único que no se deshace, no preguntaba nada.
 *
 * Y la bitácora contaba media historia: el alta de un cargo dejaba línea y la
 * baja ninguna, así que el historial de una persona seguía diciendo que era
 * tesorera de un cuerpo donde hoy lo es otra. Es el mismo defecto que tenían
 * las cuatro carpetas de documentos hasta la 1.209.0.
 *
 * De la tercera, lo que se arregla es la mitad que se puede arreglar sin
 * contradecir una decisión ya tomada: soltar el enlace es lo correcto —una
 * directiva no se borra porque se borre uno de sus nombres, y así está escrito
 * en server/dependencias.js— pero hacerlo EN SILENCIO no lo es. Ahora el
 * borrado deja anotado qué enlace dejó vacío y de qué cargo se trataba.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const enEjercicio = require('../../server/directiva-en-ejercicio');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 31700000 + (process.pid % 100000) * 2;
const otroRut = () => { const c = String(++rut); return `${c}-${digitoVerificador(c)}`; };

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

/**
 * Un cuerpo con seis integrantes y su directiva en ejercicio, con cuatro cargos
 * puestos. Las fichas de integrante llevan su `fecha_ingreso`, que es
 * obligatoria: sin ella cualquier guardado posterior se rechaza por eso y no
 * por lo que se está probando.
 */
function unCuerpoConSuDirectiva(extra = {}) {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia borrado ${m}`, `BORR${m}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo borrado ${m}`, iglesia).lastInsertRowid;

  const gente = [];
  const fichas = {};
  for (let i = 0; i < 6; i++) {
    const quien = db
      .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
      .run(`Borra${i}`, `Deborrado ${m}`, otroRut(), iglesia).lastInsertRowid;
    fichas[quien] = db
      .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado,
                                                fecha_ingreso, iglesia_id)
                VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?, ?)`)
      .run(cuerpo, quien, anios(-3), iglesia).lastInsertRowid;
    gente.push(quien);
  }

  const directiva = db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado,
                                      primer_jefe_id, segundo_jefe_id, secretario_id, tesorero_id, acta_eleccion)
              VALUES (?, ?, ?, ?, ?, 'Vigente', ?, ?, ?, ?, ?)`)
    .run(cuerpo, iglesia, `Período ${m}`, anios(-1), anios(1),
      gente[0], gente[1], gente[2], gente[3], extra.acta || null)
    .lastInsertRowid;

  return { m, iglesia, cuerpo, gente, fichas, directiva };
}

/** Una del histórico del mismo cuerpo: terminada hace años y sin nadie adentro. */
function unaVieja(c) {
  return db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, ?, ?, ?, 'Finalizada')`)
    .run(c.cuerpo, c.iglesia, `Vieja ${c.m}`, anios(-9), anios(-8)).lastInsertRowid;
}

const suHistorial = (quien) => db
  .prepare('SELECT tipo, descripcion, fecha FROM bitacora WHERE miembro_id = ? ORDER BY id')
  .all(quien);

const lineasQueDicen = (quien, texto) =>
  suHistorial(quien).filter((e) => String(e.descripcion || '').includes(texto));

// ------------------------------------------- borrar la directiva pregunta ----

test('borrar una directiva pregunta antes, y mientras tanto no borra nada', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('DELETE', `/directivas/${c.directiva}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_que_se_borra');
  assert.ok(db.prepare('SELECT id FROM directivas WHERE id = ?').get(c.directiva),
    'la directiva sigue ahí hasta que alguien conteste');
});

test('el aviso de la que ejerce dice que es la que dirige HOY, y qué hacer en cambio', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('DELETE', `/directivas/${c.directiva}`);
  assert.match(r.json.error, /dirige el cuerpo HOY/,
    'borrar la que gobierna y borrar el histórico de 2015 no son el mismo acto');
  assert.match(r.json.error, /sin directiva en ejercicio/, 'y dice en qué queda el cuerpo');
  assert.match(r.json.error, /fecha de término/,
    'y ofrece lo que casi siempre se quería hacer en realidad');
});

test('el aviso de una vieja no le atribuye un gobierno que no tiene', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const vieja = unaVieja(c);

  const r = await api('DELETE', `/directivas/${vieja}`);
  assert.equal(r.json.confirmar, 'directiva_que_se_borra');
  assert.doesNotMatch(r.json.error, /dirige el cuerpo HOY/);
  assert.match(r.json.error, /constancia de quiénes dirigieron/,
    'lo que se pierde es el registro de un período, y eso es lo que tiene que decir');
});

test('el aviso dice el período, el cuerpo y qué se lleva consigo', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva({ acta: 'acta-de-eleccion.pdf' });

  const r = await api('DELETE', `/directivas/${c.directiva}`);
  const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(c.cuerpo).nombre;
  assert.match(r.json.error, new RegExp(`Período ${c.m}`), 'el período, para no borrar el de al lado');
  assert.ok(r.json.error.includes(cuerpo), 'y de qué cuerpo es');
  assert.match(r.json.error, /4 cargos anotados/, 'cuántos nombres se van con ella');
  assert.match(r.json.error, /acta de elección adjunta/, 'y que el acta también');
});

test('una sin cargos ni acta también lo dice, en vez de callarlo', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const vieja = unaVieja(c);

  const r = await api('DELETE', `/directivas/${vieja}`);
  assert.match(r.json.error, /no tiene cargos ni acta/,
    'quien contesta necesita saber cuál de las dos está borrando');
});

test('contestada la pregunta se borra, y el cuerpo queda sin directiva en ejercicio', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('DELETE', `/directivas/${c.directiva}?igual_asi=1`);
  assert.equal(r.estado, 200);
  assert.equal(db.prepare('SELECT id FROM directivas WHERE id = ?').get(c.directiva), undefined);
  assert.equal(enEjercicio.laQueEjerce(db, c.cuerpo), null,
    'que es exactamente lo que el aviso decía que iba a pasar');
});

test('borrar la directiva no se lleva por delante al cuerpo ni a su gente', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  await api('DELETE', `/directivas/${c.directiva}?igual_asi=1`);
  assert.ok(db.prepare('SELECT id FROM cuerpos WHERE id = ?').get(c.cuerpo), 'el cuerpo se queda');
  assert.equal(db.prepare('SELECT count(*) n FROM integrantes_cuerpo WHERE cuerpo_id = ?')
    .get(c.cuerpo).n, 6, 'y sus seis integrantes también');
  assert.ok(db.prepare('SELECT id FROM miembros WHERE id = ?').get(c.gente[0]),
    'y quien era su primer jefe sigue siendo una persona de la iglesia');
});

// ------------------------------------ la bitácora del que deja el cargo ----

test('cambiarle el tesorero a una directiva le anota a los dos, no a uno', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('PUT', `/directivas/${c.directiva}`, { tesorero_id: c.gente[4], igual_asi: true });
  assert.equal(r.estado, 200);

  const deja = lineasQueDicen(c.gente[3], 'Deja el cargo de Tesorero(a)');
  assert.equal(deja.length, 1, 'al que sale le queda dicho que salió');
  assert.ok(deja[0].descripcion.includes(`Período ${c.m}`), 'y de qué período era el cargo');

  const asume = lineasQueDicen(c.gente[4], 'Asume como Tesorero(a)');
  assert.equal(asume.length, 1, 'y al que entra, lo de siempre');
});

test('vaciar un cargo también le queda anotado a quien lo tenía', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  await api('PUT', `/directivas/${c.directiva}`, { secretario_id: null, igual_asi: true });
  assert.equal(db.prepare('SELECT secretario_id FROM directivas WHERE id = ?').get(c.directiva).secretario_id, null);
  assert.equal(lineasQueDicen(c.gente[2], 'Deja el cargo de Secretario(a)').length, 1,
    'el cargo se vació y en el historial de quien lo tenía no pasaba nada');
});

test('la línea del que deja es del día en que lo dejó, no del día en que asumió', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  await api('PUT', `/directivas/${c.directiva}`, { tesorero_id: c.gente[5], igual_asi: true });
  const deja = lineasQueDicen(c.gente[3], 'Deja el cargo')[0];
  assert.equal(deja.fecha, HOY,
    'el cargo se asume cuando empieza el período, pero se deja el día en que alguien lo cambia');
  assert.notEqual(deja.fecha, anios(-1), 'que es la fecha de inicio de esta directiva');
});

test('crear una directiva no dice que nadie haya dejado nada', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.cuerpo, periodo: `Nueva ${c.m}`, fecha_inicio: anios(2), fecha_termino: anios(3),
    estado: 'Vigente', primer_jefe_id: c.gente[0], igual_asi: true,
  });
  assert.equal(r.estado, 201);
  assert.equal(lineasQueDicen(c.gente[0], 'Deja el cargo').length, 0,
    'al crear no hay nada previo que dejar');
  assert.equal(lineasQueDicen(c.gente[0], 'Asume como Primer jefe').length, 1);
});

test('guardar sin tocar los cargos no anota entradas de más', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const antes = suHistorial(c.gente[3]).length;

  const r = await api('PUT', `/directivas/${c.directiva}`, { notas: 'una nota cualquiera', igual_asi: true });
  assert.equal(r.estado, 200);
  assert.equal(suHistorial(c.gente[3]).length, antes,
    'un historial que crece en cada guardado deja de servir para leerlo');
});

// ------------------------------- el enlace que se suelta queda anotado ----

test('borrar a quien ocupaba un cargo deja dicho qué cargo quedó vacío', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  await api('PUT', `/directivas/${c.directiva}`, { consejero_id: c.gente[5], igual_asi: true });

  const r = await api('DELETE', `/miembros/${c.gente[5]}?igual_asi=1`);
  assert.equal(r.estado, 200);
  assert.equal(db.prepare('SELECT consejero_id FROM directivas WHERE id = ?').get(c.directiva).consejero_id, null,
    'la directiva se queda —es una cosa por derecho propio— y pierde ese nombre');

  const anotado = db
    .prepare(`SELECT detalle FROM registro_cambios
               WHERE accion = 'Eliminación' AND modulo = 'Miembros' ORDER BY id DESC LIMIT 1`)
    .get();
  assert.match(anotado.detalle, /Dejó vacío\(s\) 1 enlace/,
    'quien mañana mire esa directiva tiene que poder saber por qué le falta un cargo');
  assert.match(anotado.detalle, /Directivas de Cuerpos \(Consejero\(a\)\)/,
    'y de cuál de los seis cargos se trataba, sin ir a adivinarlo');
});

test('borrar a alguien que no ocupaba nada no inventa la frase', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('DELETE', `/miembros/${c.gente[4]}?igual_asi=1`);
  assert.equal(r.estado, 200);
  const anotado = db
    .prepare(`SELECT detalle FROM registro_cambios
               WHERE accion = 'Eliminación' AND modulo = 'Miembros' ORDER BY id DESC LIMIT 1`)
    .get();
  assert.doesNotMatch(anotado.detalle, /Dejó vacío/,
    'una frase que sale siempre no dice nada; la mayoría de los borrados no sueltan ningún cargo');
});
