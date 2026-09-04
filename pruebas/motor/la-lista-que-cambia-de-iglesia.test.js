/**
 * La asistencia de un cuerpo, anotada en la iglesia de otro.
 *
 * Una actividad puede convocar a varios cuerpos —lo dice su propio campo: «A
 * una actividad puede asistir más de un cuerpo»— y su columna `iglesia_id` se
 * toma del PRIMERO. Esa iglesia se le estampaba a todas sus marcas, así que
 * una jornada de dos congregaciones dejaba la asistencia de una contada en la
 * otra. Medido en la v1.374.0, con la misma persona en dos actividades
 * seguidas:
 *
 *                                     su cuerpo solo   junto a uno de al lado
 *   la iglesia de su marca .........       2 (la suya)        1 (la de al lado)
 *   su encargada abre la lista .....       1 persona          403
 *   su informe de ese día ..........       1 presente         0 presentes
 *
 * Lo que se vigila acá:
 *
 *   · que la marca se anote en la iglesia de SU CUERPO;
 *   · que la actividad se alcance desde las dos congregaciones;
 *   · que cada una vea y pueda marcar SOLO lo suyo —que es lo que hay que
 *     cuidar al abrir la puerta: antes la actividad entera quedaba fuera de
 *     alcance, y eso tapaba el problema y de paso lo hacía inofensivo—;
 *   · y que lo ya anotado quede enderezado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const alcance = require('../../server/alcance');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const asistencias = getModule('asistencias');
const marca = process.pid % 100000;

/* ── dos congregaciones, un cuerpo en cada una, una persona en cada cuerpo ── */
const iglesiaA = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central LI ${marca}`, `LI-A-${marca}`).lastInsertRowid;
const iglesiaB = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Norte LI ${marca}`, `LI-B-${marca}`).lastInsertRowid;
const cuerpoA = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas LI ${marca}`, iglesiaA).lastInsertRowid;
const cuerpoB = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Jóvenes LI ${marca}`, iglesiaB).lastInsertRowid;

const unMiembro = (nombre, iglesia, cuerpo) => {
  const numero = `${17000000 + (marca * 7 + cuerpo) % 900000}`;
  const id = db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(nombre, `LI ${marca}`, `${numero}${cuerpo}-${digitoVerificador(numero + cuerpo)}`, iglesia)
    .lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(cuerpo, id, iglesia);
  return id;
};
const deA = unMiembro('Rosa', iglesiaA, cuerpoA);
const deB = unMiembro('Elena', iglesiaB, cuerpoB);

/** Una cuenta acotada a una iglesia y sin cuerpos: el caso de una secretaria. */
const encargadaDe = (iglesia, cual) => {
  const numero = `${18000000 + (marca * 3 + cual) % 900000}`;
  return db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, debe_cambiar_password, iglesia_id, iglesias)
     VALUES (?,?,'secretario',1,0,?,?)`
  ).run(`${numero}-${digitoVerificador(numero)}`, `Encargada LI ${marca}-${cual}`, iglesia, JSON.stringify([iglesia]))
    .lastInsertRowid;
};
const laDeA = encargadaDe(iglesiaA, 1);
const laDeB = encargadaDe(iglesiaB, 2);

const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;

test('la marca se anota en la iglesia de su cuerpo, no en la de la actividad', async () => {
  const api = await elSistemaAndando();
  const act = (await api('POST', '/asistencias', {
    fecha: '2026-06-14', cuerpos: [cuerpoA, cuerpoB], tipo_reunion: TIPO, nombre: `Jornada LI ${marca}`,
  })).json;
  assert.ok(act && act.id, 'no se pudo crear la actividad de dos congregaciones');
  assert.equal(Number(act.iglesia_id), iglesiaA, 'la actividad se queda con la del primer cuerpo, como siempre');

  const lista = (await api('GET', `/asistencias/${act.id}/lista`)).json;
  const marcas = (lista.personas || []).map((p) => ({
    clave: p.clave, miembro_id: p.miembro_id, no_miembro_id: p.no_miembro_id, cuerpo_id: p.cuerpo_id, estado: 'Presente',
  }));
  assert.equal(marcas.length, 2, 'el administrador ve a los dos');
  const puesta = await api('POST', `/asistencias/${act.id}/lista`, { marcas });
  assert.equal(puesta.estado, 200, puesta.texto.slice(0, 160));

  const suya = (quien) => db
    .prepare('SELECT iglesia_id FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ?')
    .get(act.id, quien).iglesia_id;
  assert.equal(Number(suya(deA)), iglesiaA);
  assert.equal(Number(suya(deB)), iglesiaB, 'la de la otra congregación, en la suya y no en la de la actividad');
});

test('la actividad se alcanza desde las dos congregaciones', () => {
  const act = db.prepare('SELECT * FROM asistencias WHERE nombre = ?').get(`Jornada LI ${marca}`);
  const usuarioA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laDeA);
  const usuarioB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laDeB);
  assert.equal(alcance.alcanza(asistencias, act, usuarioA), true);
  assert.equal(alcance.alcanza(asistencias, act, usuarioB), true,
    'la de la otra congregación tiene ahí a su propio cuerpo');

  // Y lo mismo en el listado, que es la otra mitad: si dijeran distinto, se
  // vería en la lista algo que después no se deja abrir, o al revés.
  const paraB = [];
  const donde = alcance.condiciones(asistencias, usuarioB, paraB);
  const cuantas = db
    .prepare(`SELECT COUNT(*) c FROM asistencias WHERE id = ? AND (${donde})`)
    .get(act.id, ...paraB).c;
  assert.equal(cuantas, 1, 'y le aparece en su listado');
});

test('pero cada una ve y marca SOLO lo suyo', async () => {
  await elSistemaAndando();
  const act = db.prepare('SELECT * FROM asistencias WHERE nombre = ?').get(`Jornada LI ${marca}`);
  const comoB = comoOtroUsuario(laDeB);

  const lista = (await comoB('GET', `/asistencias/${act.id}/lista`)).json;
  assert.equal((lista.personas || []).length, 1, 've a la suya y a nadie más');
  assert.equal(Number(lista.personas[0].miembro_id), deB);

  const ajena = await comoB('POST', `/asistencias/${act.id}/lista`, {
    marcas: [{ miembro_id: deA, cuerpo_id: cuerpoA, estado: 'Ausente' }],
  });
  assert.equal(ajena.estado, 403, `contestó ${ajena.estado}: ${ajena.texto.slice(0, 140)}`);
  assert.match(ajena.json.error, /no es de los cuerpos que a usted le toca pasar/);
  assert.equal(
    db.prepare('SELECT estado FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ?').get(act.id, deA).estado,
    'Presente', 'la marca de la otra congregación quedó como estaba'
  );

  const suya = await comoB('POST', `/asistencias/${act.id}/lista`, {
    marcas: [{ miembro_id: deB, cuerpo_id: cuerpoB, estado: 'Ausente' }],
  });
  assert.equal(suya.estado, 200, suya.texto.slice(0, 140));
  assert.equal(suya.json.guardadas, 1, 'la suya sí la corrige');
});

test('y el informe de cada congregación cuenta lo suyo', async () => {
  await elSistemaAndando();
  const conteo = async (quien) => {
    const r = await comoOtroUsuario(quien)('GET', '/asistencias/informe?desde=2026-06-14&hasta=2026-06-14');
    return r.json.general;
  };
  const a = await conteo(laDeA);
  const b = await conteo(laDeB);
  assert.equal(a.presentes, 1, 'la de la Central ve a la suya presente');
  assert.equal(b.presentes + b.ausentes, 1, 'y la del Norte, a la suya');
  assert.equal(b.ausentes, 1, 'que quedó ausente al corregirla');
});

test('«alcanzar un cuerpo» son las dos preguntas: sus cuerpos y sus iglesias', () => {
  const usuarioB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laDeB);
  assert.equal(alcance.alcanzaCuerpo(usuarioB, cuerpoB), true);
  assert.equal(alcance.alcanzaCuerpo(usuarioB, cuerpoA), false,
    'sin cuerpos asignados, «todos» quería decir todos los del sistema');
  assert.equal(alcance.alcanzaCuerpo({ id: 1, rol: 'admin' }, cuerpoA), true, 'a quien no se le acota nada, todo');
});

test('lo ya anotado en la iglesia equivocada se endereza', () => {
  /*
   * Las marcas escritas antes de esto se quedan mal para siempre si nadie las
   * toca: son el pasado que los informes leen. La migración las endereza con
   * la iglesia de su cuerpo, y no toca las que no tienen cuerpo —de ésas no se
   * sabe— porque dejarlas en blanco las sacaría de todos los informes.
   */
  const act = db.prepare('SELECT * FROM asistencias WHERE nombre = ?').get(`Jornada LI ${marca}`);
  db.prepare('UPDATE asistencia_detalle SET iglesia_id = ? WHERE asistencia_id = ?').run(iglesiaA, act.id);
  const sinCuerpo = db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, estado, fecha, iglesia_id)
     VALUES (?, 'Miembro', ?, 'Presente', '2026-06-14', ?)`
  ).run(act.id, deB, iglesiaA).lastInsertRowid;

  db.prepare("DELETE FROM migraciones WHERE nombre = 'la iglesia de cada marca sale de su cuerpo'").run();
  require('../../server/migraciones').laIglesiaDeCadaMarca(db);

  const suya = db
    .prepare('SELECT iglesia_id FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ? AND cuerpo_id = ?')
    .get(act.id, deB, cuerpoB);
  assert.equal(Number(suya.iglesia_id), iglesiaB, 'la marca vieja quedó en la iglesia de su cuerpo');
  assert.equal(
    Number(db.prepare('SELECT iglesia_id FROM asistencia_detalle WHERE id = ?').get(sinCuerpo).iglesia_id),
    iglesiaA, 'la que no tiene cuerpo se deja como estaba'
  );
});
