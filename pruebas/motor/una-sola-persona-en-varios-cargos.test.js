/**
 * Una directiva de una sola persona con cuatro sombreros.
 *
 * Medido antes de esto: los cuatro cargos puestos a la misma persona contestaban
 * 200, y la hoja impresa salía así bajo el membrete y el RUT de la institución:
 *
 *   Primer jefe / Primera jefa ..... Pedro Díaz Díaz
 *   Segundo jefe / Segunda jefa .... Pedro Díaz Díaz
 *   Secretario(a) .................. Pedro Díaz Díaz
 *   Tesorero(a) .................... Pedro Díaz Díaz
 *
 * En el listado se veía igual, con el mismo nombre en la columna del primer jefe
 * y en la del secretario, una al lado de la otra.
 *
 * NO ES UN DESCUIDO DE ESCRITURA: una directiva es de varias personas justamente
 * para que nadie se controle a sí mismo —el tesorero rinde ante el jefe, y el
 * secretario da fe de lo que los dos acuerdan—. Pero tampoco es imposible que
 * pase de verdad, así que se pregunta y no se prohíbe, y lo permanente lo dice
 * el cumplimiento del cuerpo, donde se ve sin abrir nada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const cargos = require('../../server/cargos-de-la-directiva');
const oficiales = require('../../server/oficiales');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 29100000 + (process.pid % 120000) * 2;
const otroRut = () => { const c = String(++rut); return `${c}-${digitoVerificador(c)}`; };

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

function unCuerpoConGente(cuantos = 5) {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia dobles ${m}`, `DOBL${m}`).lastInsertRowid;
  const id = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo dobles ${m}`, iglesia).lastInsertRowid;
  const gente = [];
  for (let i = 0; i < cuantos; i++) {
    const miembro = db
      .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
      .run(`Persona${i}`, `Dedobles ${m}`, otroRut(), iglesia).lastInsertRowid;
    db.prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado, iglesia_id)
                VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?)`).run(id, miembro, iglesia);
    gente.push(miembro);
  }
  return { id, iglesia, m, gente };
}

const requisito = async (api, cuerpoId) =>
  (await api('GET', `/cuerpos/${cuerpoId}/cumplimiento`)).json.items
    .find((i) => i.texto === 'Directiva con sus cargos');

const laDirectiva = (c, extra = {}) => ({
  cuerpo_id: c.id, periodo: `p ${c.m}`, fecha_inicio: anios(-1), fecha_termino: anios(1),
  estado: 'Vigente', primer_jefe_id: c.gente[0], ...extra,
});

// ------------------------------------------------------ se pregunta ----

test('los cuatro cargos en la misma persona se preguntan', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', laDirectiva(c, {
    segundo_jefe_id: c.gente[0], secretario_id: c.gente[0], tesorero_id: c.gente[0],
  }));
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'cargos_en_la_misma_persona');
  assert.match(r.json.error, /primer jefe, segundo jefe, secretario y tesorero/,
    'el aviso tiene que decir QUÉ cargos se están juntando');
  assert.match(r.json.error, /Persona0/, 'y en quién');
  assert.match(r.json.error, /nadie se controle a s[íi] mismo/, 'y por qué importa');
});

test('dos cargos también, no hacen falta cuatro', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', laDirectiva(c, { tesorero_id: c.gente[0] }));
  assert.equal(r.json.confirmar, 'cargos_en_la_misma_persona');
  assert.match(r.json.error, /primer jefe y tesorero/);
});

/**
 * Hace de esa persona un oficial de verdad, si en esta base hay cuerpo de
 * oficiales.
 *
 * Sin esto, ponerla de supervisor dispara ANTES la pregunta de la 1.259.0 —«no
 * figura entre los integrantes de Oficiales»— y esta comprobación mediría otra
 * cosa. Pasó de verdad: sola pasaba, porque corriendo sola no había cuerpo de
 * oficiales y esa pregunta estaba apagada; en la batería completa, con otro
 * archivo que sí lo crea, se cayó.
 */
function hacerloOficial(quien, iglesiaId) {
  const suyo = oficiales.cuerpoDeOficiales(db);
  if (!suyo) return;                      // sin cuerpo de oficiales, esa pregunta no corre
  db.prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado, iglesia_id)
              VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?)`).run(suyo.id, quien, iglesiaId);
}

test('el supervisor que además es tesorero del cuerpo que supervisa cuenta igual', async () => {
  /*
   * Es la versión más clara del problema —supervisa lo que él mismo administra—
   * así que se miran los SEIS cargos y no los cuatro del cuerpo.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  hacerloOficial(c.gente[0], c.iglesia);
  const r = await api('POST', '/directivas', laDirectiva(c, { oficial_supervisor_id: c.gente[0] }));
  assert.equal(r.json.confirmar, 'cargos_en_la_misma_persona');
  assert.match(r.json.error, /oficial supervisor/);
});

test('contestada la pregunta entra, porque un cuerpo chico puede no tener a quién más', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', laDirectiva(c, { tesorero_id: c.gente[0], igual_asi: true }));
  assert.equal(r.estado, 201);
});

test('cuatro personas distintas no preguntan nada', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', laDirectiva(c, {
    segundo_jefe_id: c.gente[1], secretario_id: c.gente[2], tesorero_id: c.gente[3],
  }));
  assert.equal(r.estado, 201);
});

test('corregirle una nota a una que ya venía doblada no vuelve a preguntar', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const doblada = await api('POST', '/directivas',
    laDirectiva(c, { tesorero_id: c.gente[0], igual_asi: true }));

  const r = await api('PUT', `/directivas/${doblada.json.id}`, { notas: 'una corrección cualquiera' });
  assert.equal(r.estado, 200, 'sigue doblada, pero este guardado no es el que la dobló');
});

test('pero DOBLAR A OTRO en esa misma directiva sí se pregunta', async () => {
  /*
   * Que ya venga con una persona doblada no compra permiso para doblar a la
   * siguiente: se compara quién estaba repetido antes con quién lo está ahora.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const doblada = await api('POST', '/directivas', laDirectiva(c, {
    tesorero_id: c.gente[0], segundo_jefe_id: c.gente[1], secretario_id: c.gente[2], igual_asi: true,
  }));

  const r = await api('PUT', `/directivas/${doblada.json.id}`, { secretario_id: c.gente[1] });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'cargos_en_la_misma_persona');
  assert.match(r.json.error, /Persona1/, 'el que se acaba de doblar es el otro');
  assert.doesNotMatch(r.json.error, /Persona0/, 'y del que ya venía doblado no se vuelve a hablar');
});

test('la pregunta de los cargos repetidos va la ÚLTIMA de las tres', async () => {
  /*
   * El «igual así» es uno solo para todo el guardado, así que se contesta la
   * primera que salga. Que la directiva no exista o no tenga cabeza cuesta más
   * de deshacer que tenerla mal repartida, que se arregla moviendo un cargo.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: `las dos ${c.m}`, fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', secretario_id: c.gente[0], tesorero_id: c.gente[0],   // doblado y sin jefe
  });
  assert.equal(r.json.confirmar, 'directiva_sin_jefe');
});

// ------------------------------- y el cumplimiento lo dice sin preguntar ----

test('cuatro casilleros llenos con una sola persona no es «con sus cargos»', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  await api('POST', '/directivas', laDirectiva(c, {
    segundo_jefe_id: c.gente[0], secretario_id: c.gente[0], tesorero_id: c.gente[0], igual_asi: true,
  }));

  const r = await requisito(api, c.id);
  assert.equal(r.ok, false, 'tiene una persona, no cuatro');
  assert.match(r.detalle, /ocupa 4 cargos/);
  assert.match(r.detalle, /Persona0/, 'y se dice quién, para saber a quién relevar');
});

test('repartidos, el requisito se cumple y lo dice contando personas', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  await api('POST', '/directivas', laDirectiva(c, {
    segundo_jefe_id: c.gente[1], secretario_id: c.gente[2], tesorero_id: c.gente[3],
  }));
  const r = await requisito(api, c.id);
  assert.equal(r.ok, true);
  assert.match(r.detalle, /y en cuatro personas/);
});

test('el requisito mira los cuatro del cuerpo, no el supervisor', async () => {
  /*
   * El supervisor no cuenta para este requisito —lo nombra el cuerpo de
   * oficiales desde fuera— así que que sea además consejero no se lo reprocha al
   * cuerpo por esta vía. La pregunta al guardar sí lo mira, que es donde
   * corresponde: ahí se está tomando la decisión.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  hacerloOficial(c.gente[1], c.iglesia);
  await api('POST', '/directivas', laDirectiva(c, {
    segundo_jefe_id: c.gente[1], secretario_id: c.gente[2], tesorero_id: c.gente[3],
    oficial_supervisor_id: c.gente[1], igual_asi: true,
  }));
  assert.equal((await requisito(api, c.id)).ok, true);
  assert.equal(cargos.quienesSeRepiten({
    primer_jefe_id: 1, segundo_jefe_id: 2, secretario_id: 3, tesorero_id: 4, oficial_supervisor_id: 2,
  }).length, 1, 'pero mirando los seis sí se repite, que es lo que la pregunta usa');
});

test('faltar un cargo pesa más que repetirlo, y se dice eso primero', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  await api('POST', '/directivas', laDirectiva(c, { tesorero_id: c.gente[0], igual_asi: true }));
  const r = await requisito(api, c.id);
  assert.match(r.detalle, /Faltan: segundo jefe y secretario/,
    'con cargos vacíos se nombran ésos: rellenarlos es lo primero que hay que hacer');
});

// --------------------------------------------------- la cuenta en sí ----

test('quiénes se repiten: nadie, uno con dos, uno con cuatro, dos con dos', () => {
  const solos = { primer_jefe_id: 1, segundo_jefe_id: 2, secretario_id: 3, tesorero_id: 4 };
  assert.deepEqual(cargos.quienesSeRepiten(solos), []);

  const unaVez = cargos.quienesSeRepiten({ primer_jefe_id: 1, tesorero_id: 1 });
  assert.equal(unaVez.length, 1);
  assert.deepEqual(unaVez[0].cargos.map((c) => c.corto), ['primer jefe', 'tesorero']);

  const dosPersonas = cargos.quienesSeRepiten({
    primer_jefe_id: 1, segundo_jefe_id: 1, secretario_id: 2, tesorero_id: 2,
  });
  assert.equal(dosPersonas.length, 2, 'dos personas con dos cargos cada una son dos avisos');
});

test('un cargo vacío no se repite con otro cargo vacío', () => {
  /*
   * Sin esto, una directiva con el secretario y el tesorero en blanco saldría
   * como «la misma persona en dos cargos», que es la nada repetida.
   */
  for (const nada of [null, undefined, '', 0]) {
    assert.deepEqual(cargos.quienesSeRepiten({ secretario_id: nada, tesorero_id: nada }), [],
      `${nada} en dos cargos no es nadie en dos cargos`);
  }
});
