/**
 * QUIEN YA NO ESTÁ EN LA IGLESIA SALE DE SUS CUERPOS.
 *
 * Marcar una ficha como Fallecido o Trasladado ya le cerraba el acceso al
 * sistema, la sacaba de los cumpleaños y la retiraba de la directiva. Pero no
 * la sacaba de sus cuerpos, y de la lista de integrantes cuelga casi todo lo
 * demás: la pantalla donde se pasa lista la seguía ofreciendo para marcarla, la
 * planilla mensual le seguía abriendo su columna, el porcentaje del cuerpo la
 * contaba entre los convocados —así que bajaba para siempre por gente que no
 * puede asistir— y el aviso de faltas seguidas la iba a nombrar en el panel.
 *
 * Medido antes del arreglo, sobre el sistema andando: se marcó a una integrante
 * como fallecida y seguía en el listado de integrantes de su cuerpo y en la
 * lista para pasar asistencia, como si nada.
 *
 * La regla está en server/ya-no-esta.js y corre al guardar la ficha. Se
 * deshace sola si el estado se vuelve atrás, porque marcar a alguien por error
 * también pasa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const regla = require('../../server/ya-no-esta');
const miembros = require('../../server/modules/miembros');
const integrantesMod = require('../../server/modules/integrantes_cuerpo');
const { personasDelCuerpo } = require('../../server/integrantes');
const faltas = require('../../server/faltas-seguidas');
const { hoy } = require('../../server/fechas');

// --------------------------------- el escenario ---------------------------

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los que se van', 'IG-YNE', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La que recibe', 'IG-YNE2', 'Activa')")
  .run().lastInsertRowid;

const coro = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro de los que se van', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const damas = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de los que se van', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const taller = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Taller de los que se van', 'Grupo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const alla = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro de la que recibe', 'Cuerpo', ?, 'Activo')")
  .run(otraIglesia).lastInsertRowid;

let n = 0;
/** Una miembro de la iglesia, con su ficha en los cuerpos que se indiquen. */
function alguien(nombre, cuerpos = [coro], extra = {}) {
  n++;
  const id = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(nombre, `Yanoesta${n}`, extra.iglesia || iglesia).lastInsertRowid;
  for (const c of cuerpos) {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso,
                                       fecha_fin_prueba, automatico, persona_tipo)
       VALUES (?, ?, (SELECT iglesia_id FROM cuerpos WHERE id = ?), ?, '2024-01-01', ?, ?, 'Miembro')`
    ).run(c, id, c, extra.estado || 'Activo', extra.finPrueba || null, extra.automatico ? 1 : 0);
  }
  return id;
}

/** La ficha de integrante de una persona en un cuerpo. */
const fichaEn = (miembroId, cuerpoId) => db
  .prepare('SELECT * FROM integrantes_cuerpo WHERE miembro_id = ? AND cuerpo_id = ?')
  .get(miembroId, cuerpoId);

/** Guarda el nuevo estado como lo haría la pantalla, y corre la regla. */
function ponerEstado(miembroId, estado) {
  db.prepare('UPDATE miembros SET estado = ? WHERE id = ?').run(estado, miembroId);
  const fila = db.prepare('SELECT * FROM miembros WHERE id = ?').get(miembroId);
  return regla.alGuardarUnMiembro(db, fila, null);
}

// ---------------------------- se va, y sale de todo ------------------------

test('a quien fallece se le retira de su cuerpo, con la fecha y el motivo', () => {
  const ludovina = alguien('Ludovina');
  assert.equal(fichaEn(ludovina, coro).estado, 'Activo');

  const { salio } = ponerEstado(ludovina, 'Fallecido');

  const ficha = fichaEn(ludovina, coro);
  assert.equal(ficha.estado, 'Retirado');
  assert.equal(ficha.motivo_retiro, 'Fallecimiento');
  assert.equal(ficha.fecha_retiro, hoy());
  assert.deepEqual(salio, ['Coro de los que se van']);
});

test('y a quien se traslada, con su propio motivo', () => {
  const zoraida = alguien('Zoraida');
  ponerEstado(zoraida, 'Trasladado');
  assert.equal(fichaEn(zoraida, coro).motivo_retiro, 'Traslado a otra iglesia');
});

test('sale de TODOS sus cuerpos y grupos, no solo de uno', () => {
  const bernarda = alguien('Bernarda', [coro, damas, taller]);
  const { salio } = ponerEstado(bernarda, 'Fallecido');

  assert.equal(salio.length, 3, 'los tres, incluido el grupo');
  for (const c of [coro, damas, taller]) {
    assert.equal(fichaEn(bernarda, c).estado, 'Retirado', 'quedó en uno');
  }
});

test('también de los que puso una persona a mano', () => {
  /*
   * La regla de la directiva no toca lo que puso una persona, y hace bien: ahí
   * se discute qué manda sobre qué. Acá no hay nada que discutir —la persona no
   * está— así que la ficha se retira igual.
   */
  const fresia = alguien('Fresia', [coro], { automatico: 0 });
  assert.equal(fichaEn(fresia, coro).automatico, 0);
  ponerEstado(fresia, 'Fallecido');
  assert.equal(fichaEn(fresia, coro).estado, 'Retirado');
});

test('y también los que estaban en período de prueba', () => {
  const cesarea = alguien('Cesarea', [coro], { estado: 'En prueba', finPrueba: '2030-01-01' });
  ponerEstado(cesarea, 'Trasladado');
  assert.equal(fichaEn(cesarea, coro).estado, 'Retirado');
});

test('a quien sigue en la iglesia no se le toca la ficha', () => {
  for (const estado of ['Activo', 'Inactivo', 'En disciplina']) {
    const quien = alguien(`Sigue${estado.replace(/\s/g, '')}Yne`);
    ponerEstado(quien, estado);
    assert.equal(fichaEn(quien, coro).estado, 'Activo', `«${estado}» no saca a nadie de su cuerpo`);
  }
});

// ------------------- y por lo tanto deja de aparecer donde no debe ---------

test('la lista del cuerpo deja de convocarla, que era el problema entero', () => {
  const petronila = alguien('Petronila', [damas]);
  const estaEn = () => personasDelCuerpo(db, damas).some((p) => Number(p.miembro_id) === petronila);

  assert.equal(estaEn(), true, 'antes de irse, pertenece');
  ponerEstado(petronila, 'Fallecido');
  assert.equal(estaEn(), false, 'la pantalla de asistencia la seguía ofreciendo para marcarla');
});

test('y el aviso de faltas seguidas deja de nombrarla', () => {
  const eufrasia = alguien('Eufrasia', [taller]);
  const actividad = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-01-04', 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([taller])).lastInsertRowid;
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, estado, cuerpo_id, fecha, iglesia_id, visita)
     VALUES (?, 'Miembro', ?, 'Ausente', ?, '2026-01-04', ?, 0)`
  ).run(actividad, eufrasia, taller, iglesia);

  const nombrada = () => faltas.delCuerpo(taller, 1).some((p) => Number(p.miembro_id) === eufrasia);
  assert.equal(nombrada(), true, 'con una falta y el tope en 1, la nombra');
  ponerEstado(eufrasia, 'Fallecido');
  assert.equal(nombrada(), false, 'iba a decir «conviene visitarla» de alguien que falleció');
});

// ------------------------------ y si fue un error --------------------------

test('volver el estado atrás la devuelve a sus cuerpos', () => {
  const rosalba = alguien('Gumersinda', [coro, damas]);
  ponerEstado(rosalba, 'Fallecido');
  assert.equal(fichaEn(rosalba, coro).estado, 'Retirado');

  const { volvio } = ponerEstado(rosalba, 'Activo');
  assert.equal(volvio.length, 2);
  assert.equal(fichaEn(rosalba, coro).estado, 'Activo');
  assert.equal(fichaEn(rosalba, coro).motivo_retiro, null, 'y sin el motivo colgando');
  assert.equal(fichaEn(rosalba, coro).fecha_retiro, null);
});

test('pero NO devuelve la que el cuerpo retiró por su cuenta', () => {
  const genoveva = alguien('Genoveva', [coro]);
  db.prepare(
    "UPDATE integrantes_cuerpo SET estado = 'Retirado', motivo_retiro = 'Dejó de asistir', fecha_retiro = '2025-03-01' WHERE miembro_id = ?"
  ).run(genoveva);

  ponerEstado(genoveva, 'Fallecido');
  const { volvio } = ponerEstado(genoveva, 'Activo');

  assert.deepEqual(volvio, [], 'esa salida no la escribió esta regla');
  assert.equal(fichaEn(genoveva, coro).estado, 'Retirado');
  assert.equal(fichaEn(genoveva, coro).motivo_retiro, 'Dejó de asistir');
});

test('ni la devuelve a los cuerpos de la iglesia que dejó', () => {
  /*
   * Se trasladó de verdad: su ficha quedó en la congregación que la recibió.
   * Devolverla al coro de la que dejó sería meterla donde ya no pertenece.
   */
  const anacleta = alguien('Anacleta', [coro]);
  ponerEstado(anacleta, 'Trasladado');
  db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(otraIglesia, anacleta);

  const { volvio } = ponerEstado(anacleta, 'Activo');
  assert.deepEqual(volvio, []);
  assert.equal(fichaEn(anacleta, coro).estado, 'Retirado');
});

test('y vuelve «En prueba» si su período de prueba todavía no termina', () => {
  const filomena = alguien('Filomena YaNoEsta', [coro], { estado: 'En prueba', finPrueba: '2099-01-01' });
  ponerEstado(filomena, 'Fallecido');
  ponerEstado(filomena, 'Activo');
  assert.equal(fichaEn(filomena, coro).estado, 'En prueba', 'volver siempre como activa le regalaría la prueba');
});

test('y «Activo» si ya la había terminado', () => {
  const olegaria = alguien('Olegaria', [coro], { estado: 'Activo', finPrueba: '2020-01-01' });
  ponerEstado(olegaria, 'Fallecido');
  ponerEstado(olegaria, 'Activo');
  assert.equal(fichaEn(olegaria, coro).estado, 'Activo');
});

// --------------------- no se le vuelve a inscribir sin querer --------------

test('la ficha de integrante no deja volver a inscribir a quien ya no está', () => {
  const teodora = alguien('Teodora', []);
  db.prepare("UPDATE miembros SET estado = 'Fallecido' WHERE id = ?").run(teodora);

  const problema = integrantesMod.hooks.beforeSave(
    { cuerpo_id: coro, miembro_id: teodora, persona_tipo: 'Miembro', estado: 'Activo', fecha_ingreso: '2026-01-01' },
    { existing: null, id: null, db }
  );
  assert.match(String(problema), /fallecid/i);
  assert.match(String(problema), /corrija primero su estado/i, 'dice qué hacer, no solo que no');
});

test('pero sí deja dejarla retirada, que es lo que hay que poder corregir', () => {
  const ercilia = alguien('Ercilia', [coro]);
  ponerEstado(ercilia, 'Trasladado');
  const ficha = fichaEn(ercilia, coro);

  const problema = integrantesMod.hooks.beforeSave(
    { estado: 'Retirado', fecha_retiro: '2026-02-02' },
    { existing: ficha, id: ficha.id, db }
  );
  assert.equal(problema, null, 'corregir la fecha de una salida no puede quedar trancado');
});

// ------------------------------- queda anotado -----------------------------

test('la salida queda escrita en la bitácora de la persona', () => {
  const nicomedes = alguien('Nicomedes', [damas]);
  ponerEstado(nicomedes, 'Fallecido');

  const lineas = db
    .prepare("SELECT * FROM bitacora WHERE miembro_id = ? AND tipo = 'Salida de cuerpo'")
    .all(nicomedes);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0].descripcion, /Damas de los que se van/);
  assert.match(lineas[0].descripcion, /Fallecimiento/);
});

test('y la vuelta atrás también', () => {
  const restituta = alguien('Restituta', [damas]);
  ponerEstado(restituta, 'Fallecido');
  ponerEstado(restituta, 'Activo');

  const vuelta = db
    .prepare("SELECT * FROM bitacora WHERE miembro_id = ? AND tipo = 'Ingreso a cuerpo'")
    .all(restituta);
  assert.equal(vuelta.length, 1, 'reabrir una ficha en silencio deja la bitácora mintiendo');
  assert.match(vuelta[0].descripcion, /ya no dice que se fue/);
});

// ------------------------- la regla, donde tiene que estar ------------------

test('guardar la ficha por donde se guarda de verdad la retira de sus cuerpos', () => {
  /*
   * Las pruebas de más arriba llaman a la regla derecho, que es como se mira
   * lo que hace. Esta entra por donde entra la pantalla —el `afterSave` del
   * módulo— para que sacar la regla de ahí se note acá y no solo en el orden.
   */
  const evarista = alguien('Evarista', [coro, taller]);
  db.prepare("UPDATE miembros SET estado = 'Fallecido' WHERE id = ?").run(evarista);
  const fila = db.prepare('SELECT * FROM miembros WHERE id = ?').get(evarista);

  miembros.hooks.afterSave(fila, { db, user: null });

  assert.equal(fichaEn(evarista, coro).estado, 'Retirado');
  assert.equal(fichaEn(evarista, taller).estado, 'Retirado');
});

test('la ficha del miembro corre la regla al guardar, antes que la de la directiva', () => {
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/miembros.js'), 'utf8'
  );
  const yaNoEsta = fuente.indexOf("require('../ya-no-esta')");
  const directiva = fuente.indexOf("require('../directiva')");
  assert.ok(yaNoEsta > 0, 'el módulo de Miembros no está corriendo la regla');
  assert.ok(yaNoEsta < directiva,
    'si corre después, a quien falleció siendo líder su ficha le queda diciendo «Dejó de ser Miembro Líder»');
});

test('las bases que ya venían andando se arreglan con una migración', () => {
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/migraciones.js'), 'utf8'
  );
  assert.match(fuente, /losQueYaNoEstanSalenDeSusCuerpos/,
    'sin migración, los que se dieron de baja antes siguen convocados para siempre');
  assert.match(fuente, /\['los que ya no están salen de sus cuerpos', losQueYaNoEstanSalenDeSusCuerpos\]/,
    'escrita pero no registrada en la lista es lo mismo que no escrita');
});

// ---------------------- y se ve donde la gente lo mira ---------------------

test('la ruta de los cuerpos de una persona manda por qué salió de cada uno', () => {
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/miembros.js'), 'utf8'
  );
  assert.match(fuente, /motivo: f\.motivo_retiro/,
    'sin el motivo, la pantalla puede decir que salió pero no por qué');
  assert.match(fuente, /el: f\.fecha_retiro/);
});

test('y la pantalla dice si pertenece, si está en prueba o si ya salió', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /function insigniaDePertenencia\(c\)/,
    'la lista mostraba los cuerpos retirados igual que los vigentes: la ficha de '
    + 'quien falleció se seguía leyendo como si perteneciera a todos');
  assert.match(app, /c\.en === 'Retirado'/);
  assert.match(app, /c\.en === 'En prueba'/);
  assert.match(app, /function porQueSalio\(c\)/, 'y con qué motivo, que es lo que se quiere saber');
  const trozo = app.slice(app.indexOf('async function renderCuerposDelMiembro'),
                          app.indexOf('async function renderCuerposDelMiembro') + 1400);
  assert.match(trozo, /insigniaDePertenencia\(c\)/, 'escrita pero no usada es lo mismo que no escrita');
  assert.match(trozo, /porQueSalio\(c\)/);
});

test('el estado del miembro sigue siendo uno de los cinco de siempre', () => {
  const estados = miembros.fields.find((f) => f.name === 'estado').options;
  for (const e of regla.YA_NO_ESTA) {
    assert.ok(estados.includes(e), `la regla mira «${e}», que ya no es un estado posible`);
  }
});
