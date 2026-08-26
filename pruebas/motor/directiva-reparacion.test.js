/**
 * La reparación de lo que la primera versión de la regla de la directiva echó.
 *
 * POR QUÉ EXISTE. La regla salió con un defecto: trataba la directiva como
 * exactamente el conjunto de los miembros líderes, así que al guardar la ficha
 * de cualquier integrante que no lo fuera lo retiraba del cuerpo. Lo hacía en
 * silencio y de a uno, a medida que se guardaban fichas por otros motivos, y
 * el resultado se vio recién al pasar lista: un cuerpo de veintisiete
 * integrantes ofrecía tres. Los datos no se perdieron —las fichas siguen ahí,
 * marcadas «Retirado»— pero nadie va a devolver veinticuatro personas a mano,
 * ni en una iglesia ni en las que tengan el mismo problema sin haberlo notado.
 *
 * QUÉ SE CUIDA ACÁ. Que devuelva a los que echó, y —lo que importa más— que NO
 * devuelva a los que se retiraron de verdad. Un integrante que dejó de ser
 * líder y salió como correspondía, o alguien a quien una persona retiró a
 * mano, tiene que quedarse afuera: devolverlo sería inventar un dato. Se corre
 * una sola vez sobre datos reales y no se puede repetir para arreglarla, así
 * que se prueba pieza por pieza.
 *
 * LA PRIMERA REPARACIÓN NO DEVOLVIÓ A NADIE, y estas pruebas no lo vieron: le
 * armaban a cada ficha una fecha de ingreso, porque el módulo la pide. Las
 * fichas de verdad no la tenían —las creó la migración «integrantes con su
 * ficha», que no se la puso— y la reparación las exigía. Corrió, no encontró a
 * nadie, se dio por aplicada, y el cuerpo siguió mostrando tres integrantes.
 * De ahí que ahora el caso principal se arme SIN fecha de ingreso, como son
 * las de verdad, y que haya una prueba dedicada a eso.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { MOTIVO_SALIDA } = require('../../server/directiva');
const { devolverLosQueLaDirectivaSaco } = require('../../server/migraciones');

// La reparación solo mira lo retirado desde que la regla existe en el
// servidor, y esa fecha la deja anotada la migración que marcó los cuerpos
db.prepare("INSERT OR IGNORE INTO migraciones (nombre) VALUES ('directiva de cada iglesia')").run();

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Reparada', 'IG-REP', 'Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Directiva', 'Cuerpo', ?, 'Activo', 1)")
  .run(iglesia).lastInsertRowid;
// Un cuerpo que NO es la directiva: la regla nunca metió mano ahí
const otroCuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Coro', 'Cuerpo', ?, 'Activo', 0)")
  .run(iglesia).lastInsertRowid;

let n = 0;
function unMiembro() {
  n++;
  return db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, tipo_miembro, estado) VALUES (?, ?, ?, 'Miembro Activo', 'Activo')")
    .run(`Rep${n}`, `Arada${n}`, iglesia).lastInsertRowid;
}

/**
 * Una ficha retirada. `automatico` distingue las dos historias posibles: la
 * que puso la regla (y que entonces retiró con razón) de la que puso una
 * persona (y que la regla no debió tocar).
 */
function retirada({
  automatico = 0, motivo = MOTIVO_SALIDA, ingreso = null, retiro = HOY,
  finPrueba = null, donde = null,
} = {}) {
  const miembro = unMiembro();
  const id = db
    .prepare(
      `INSERT INTO integrantes_cuerpo
         (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso, fecha_retiro, motivo_retiro, fecha_fin_prueba, automatico)
       VALUES (?, ?, ?, 'Retirado', ?, ?, ?, ?, ?)`
    )
    .run(donde || cuerpo, miembro, iglesia, ingreso, retiro, motivo, finPrueba, automatico).lastInsertRowid;
  return { id, miembro };
}

const HOY = new Date().toISOString().slice(0, 10);
const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ayer = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

/* Los casos, todos armados antes de correr la reparación una sola vez. */
const casos = {
  // EL CASO PRINCIPAL: sin fecha de ingreso, como las fichas que venían de la
  // lista vieja del cuerpo. Es el que la primera reparación dejó afuera.
  echado: retirada({ automatico: 0 }),
  conFechaDeIngreso: retirada({ automatico: 0, ingreso: '2024-01-10' }),
  echadoSinMarca: retirada({ automatico: null }),
  enPrueba: retirada({ automatico: 0, finPrueba: manana() }),
  pruebaVencida: retirada({ automatico: 0, finPrueba: ayer() }),
  salioComoCorresponde: retirada({ automatico: 1 }),
  otroMotivo: retirada({ automatico: 0, motivo: 'Se fue del cuerpo' }),
  sinMotivo: retirada({ automatico: 0, motivo: null }),
  sinFechaDeRetiro: retirada({ automatico: 0, retiro: null }),
  deAntesDeLaRegla: retirada({ automatico: 0, retiro: '2020-05-05' }),
  enOtroCuerpo: retirada({ automatico: 0, donde: otroCuerpo }),
};

const la = (caso) => db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(casos[caso].id);
const antes = Object.fromEntries(Object.keys(casos).map((k) => [k, la(k)]));

devolverLosQueLaDirectivaSaco();

/* ── A los que echó, se los devuelve ───────────────────────────────── */

test('EL CASO QUE SE ESCAPÓ: vuelve aunque su ficha no tenga fecha de ingreso', () => {
  // Las fichas de los integrantes que venían de antes las creó la migración
  // «integrantes con su ficha», que no les puso fecha de ingreso: quedó en
  // nulo. La primera reparación la exigía, así que no devolvió a nadie —corrió
  // sobre un sistema de verdad, no encontró a ninguno, y se dio por aplicada—.
  assert.equal(antes.echado.fecha_ingreso, null, 'la prueba no está probando lo que dice');
  assert.equal(la('echado').estado, 'Activo');
});

test('y el que sí la tiene vuelve igual', () => {
  assert.equal(la('conFechaDeIngreso').estado, 'Activo');
});

test('el integrante que la regla echó vuelve a estar', () => {
  const f = la('echado');
  assert.equal(f.estado, 'Activo');
  assert.equal(f.fecha_retiro, null, 'volvió arrastrando la fecha de retiro');
  assert.equal(f.motivo_retiro, null, 'volvió arrastrando el motivo');
});

test('también el de las bases viejas, donde la marca ni existía', () => {
  // La columna se agregó junto con el arreglo: las fichas anteriores la tienen
  // en nulo, y nulo significa «no la puso la regla».
  assert.equal(la('echadoSinMarca').estado, 'Activo');
});

test('el que estaba en período de prueba vuelve a prueba, no a activo', () => {
  // Devolverlo como activo le regalaría una evaluación que nadie hizo.
  assert.equal(la('enPrueba').estado, 'En prueba');
});

test('y el que ya había terminado su prueba vuelve como activo', () => {
  assert.equal(la('pruebaVencida').estado, 'Activo');
});

test('conserva su fecha de ingreso original', () => {
  // Es su antigüedad en el cuerpo: la regla nunca debió interrumpirla.
  assert.equal(la('echado').fecha_ingreso, antes.echado.fecha_ingreso);
});

test('a cada uno le queda dicho en su bitácora por qué volvió', () => {
  const notas = db
    .prepare("SELECT descripcion FROM bitacora WHERE miembro_id = ? AND tipo = 'Ingreso a cuerpo'")
    .all(casos.echado.miembro);
  assert.equal(notas.length, 1);
  assert.match(notas[0].descripcion, /por error/);
});

/* ── A los que salieron de verdad, no ──────────────────────────────── */

test('el que dejó de ser líder y salió como correspondía sigue afuera', () => {
  // Este es el que no se puede equivocar: devolverlo sería inventar que
  // pertenece a un cuerpo del que salió con razón.
  const f = la('salioComoCorresponde');
  assert.equal(f.estado, 'Retirado');
  assert.equal(f.fecha_retiro, antes.salioComoCorresponde.fecha_retiro);
});

test('al que retiraron por otro motivo no se lo toca', () => {
  assert.equal(la('otroMotivo').estado, 'Retirado');
  assert.equal(la('sinMotivo').estado, 'Retirado');
});

test('ni a las fichas a las que les falta la fecha de retiro', () => {
  // Sin las dos fechas no hay forma de saber qué pasó, y ante la duda no se
  // toca: quien lo necesite lo devuelve a mano viendo el caso.
  assert.equal(la('sinFechaDeRetiro').estado, 'Retirado');
});

test('ni a una salida anterior al día en que la regla empezó a existir', () => {
  // «Dejó de ser Miembro Líder» es una frase que una persona bien pudo haber
  // escrito a mano antes de que nada de esto existiera. Lo que salió de antes
  // no lo escribió la regla, así que no se toca.
  assert.equal(la('deAntesDeLaRegla').estado, 'Retirado');
});

test('ni a nadie fuera de un cuerpo de directiva', () => {
  // La regla solo llegó a meter mano en los cuerpos marcados. En el coro, un
  // retiro con ese motivo lo escribió una persona.
  assert.equal(la('enOtroCuerpo').estado, 'Retirado');
});

/* ── Corre una sola vez ────────────────────────────────────────────── */

test('correrla de nuevo no vuelve a mover ni a anotar nada', () => {
  // Queda marcada como aplicada; si se repitiera, cada arranque del sistema
  // devolvería gente que después se retiró con razón.
  db.prepare("UPDATE integrantes_cuerpo SET estado = 'Retirado', fecha_retiro = ?, motivo_retiro = ? WHERE id = ?")
    .run('2026-08-25', MOTIVO_SALIDA, casos.echado.id);
  const cuantas = db
    .prepare('SELECT COUNT(*) c FROM bitacora WHERE miembro_id = ?')
    .get(casos.echado.miembro).c;

  devolverLosQueLaDirectivaSaco();

  assert.equal(la('echado').estado, 'Retirado', 'volvió a devolver a alguien');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bitacora WHERE miembro_id = ?').get(casos.echado.miembro).c, cuantas);
});
