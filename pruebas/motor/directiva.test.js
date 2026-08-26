/**
 * Los miembros líderes componen la directiva de su iglesia.
 *
 * POR QUÉ IMPORTA. Es una regla de la organización, y hasta ahora se llevaba a
 * mano: había que acordarse dos veces por cada cambio —una en la ficha de la
 * persona y otra en la del cuerpo—. Basta olvidar una para que la lista de la
 * directiva deje de decir la verdad, y eso no se nota: la lista sigue ahí,
 * completa a la vista, solo que le falta alguien o le sobra.
 *
 * Lo que se cuida acá son las cuatro cosas que pueden salir mal en silencio:
 * que entre quien corresponde, que SALGA quien dejó de corresponder, que no se
 * dupliquen fichas de la misma persona en el mismo cuerpo, y que las dos cosas
 * queden anotadas en su bitácora. Y una quinta que solo aparece con el tiempo:
 * que a quien se cambia de iglesia lo saque de la directiva que dejó y lo meta
 * en la de la que llegó.
 *
 * Y una sexta, que es la que ya falló una vez y costó caro: que la regla NO
 * toque a quien no metió ella. La primera versión trataba la directiva como
 * exactamente el conjunto de los líderes, así que retiraba en silencio a todo
 * integrante puesto a mano —de a uno, a medida que se guardaban fichas por
 * otros motivos— y un cuerpo de veintisiete quedó en tres sin que nada lo
 * dijera. De ahí las pruebas de «a mano» y las de la reparación.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const directiva = require('../../server/directiva');

/** Una iglesia con su cuerpo de directiva y otro cuerpo cualquiera. */
let siguiente = 0;
function unaIglesia({ conDirectiva = true } = {}) {
  siguiente++;
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia dir ${siguiente}`, `IG-DIR-${siguiente}`).lastInsertRowid;
  const dir = conDirectiva
    ? db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Directiva', 'Cuerpo', ?, 'Activo', 1)")
        .run(iglesia).lastInsertRowid
    : null;
  const coro = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Coro', 'Cuerpo', ?, 'Activo', 0)")
    .run(iglesia).lastInsertRowid;
  return { iglesia, dir, coro };
}

function unMiembro(iglesiaId, tipo, estado = 'Activo') {
  siguiente++;
  return db
    .prepare('INSERT INTO miembros (nombres, apellidos, iglesia_id, tipo_miembro, estado) VALUES (?, ?, ?, ?, ?)')
    .run(`Nombre${siguiente}`, `Apellido${siguiente}`, iglesiaId, tipo, estado).lastInsertRowid;
}

/** Una ficha puesta a mano, como la que crea una persona desde el sistema. */
function aMano(cuerpoId, miembroId, iglesiaId, estado = 'Activo') {
  return db
    .prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado, fecha_ingreso, iglesia_id)
       VALUES (?, ?, ?, '2020-01-01', ?)`
    )
    .run(cuerpoId, miembroId, estado, iglesiaId).lastInsertRowid;
}

const ficha = (cuerpoId, miembroId) =>
  db.prepare('SELECT * FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?').get(cuerpoId, miembroId);

const cuantasFichas = (cuerpoId, miembroId) =>
  db.prepare('SELECT COUNT(*) c FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?')
    .get(cuerpoId, miembroId).c;

const anotaciones = (miembroId) =>
  db.prepare('SELECT tipo, descripcion FROM bitacora WHERE miembro_id = ? ORDER BY id').all(miembroId);

const correr = (miembroId) =>
  directiva.alGuardarUnMiembro(db, db.prepare('SELECT * FROM miembros WHERE id = ?').get(miembroId), null);

/* ── Entrar ────────────────────────────────────────────────────────── */

test('un miembro líder entra solo a la directiva de su iglesia', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  const f = ficha(dir, quien);
  assert.ok(f, 'no entró a la directiva');
  assert.equal(f.estado, 'Activo');
  assert.ok(f.fecha_ingreso, 'entró sin fecha de ingreso');
});

test('y no entra a los demás cuerpos de la iglesia', () => {
  const { iglesia, coro } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  assert.equal(ficha(coro, quien), undefined);
});

test('quien no es líder no entra', () => {
  const { iglesia, dir } = unaIglesia();
  for (const tipo of ['Miembro Activo', 'Miembro Nuevo', 'Miembro Oyente', null]) {
    const quien = unMiembro(iglesia, tipo);
    correr(quien);
    assert.equal(ficha(dir, quien), undefined, `entró siendo ${tipo}`);
  }
});

test('un líder fallecido o trasladado no compone la directiva', () => {
  // La directiva es de quienes la componen hoy. Es la misma regla con que el
  // panel decide a quién saludar por su cumpleaños.
  const { iglesia, dir } = unaIglesia();
  for (const estado of ['Fallecido', 'Trasladado']) {
    const quien = unMiembro(iglesia, 'Miembro Líder', estado);
    correr(quien);
    assert.equal(ficha(dir, quien), undefined, `entró estando ${estado}`);
  }
});

test('si la iglesia no tiene directiva marcada, no pasa nada', () => {
  const { iglesia } = unaIglesia({ conDirectiva: false });
  const quien = unMiembro(iglesia, 'Miembro Líder');
  assert.doesNotThrow(() => correr(quien));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM integrantes_cuerpo WHERE miembro_id = ?').get(quien).c, 0);
});

/* ── Salir ─────────────────────────────────────────────────────────── */

test('al dejar de ser líder, sale de la directiva', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);
  const f = ficha(dir, quien);
  assert.equal(f.estado, 'Retirado');
  assert.equal(f.motivo_retiro, directiva.MOTIVO_SALIDA);
  assert.ok(f.fecha_retiro, 'salió sin fecha de retiro');
});

test('sale, pero su ficha NO se borra: el recorrido se conserva', () => {
  // Es la regla del sistema entero: lo que dejó de estar se marca, no se borra.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  const antes = ficha(dir, quien).fecha_ingreso;
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(cuantasFichas(dir, quien), 1);
  assert.equal(ficha(dir, quien).fecha_ingreso, antes, 'le cambió la fecha de ingreso original');
});

test('un líder que fallece también sale', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  db.prepare("UPDATE miembros SET estado = 'Fallecido' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(ficha(dir, quien).estado, 'Retirado');
});

test('y si vuelve a ser líder, se reusa su ficha en vez de crear otra', () => {
  // Dos fichas de la misma persona en el mismo cuerpo el módulo no las admite,
  // y además partirían su historial en dos.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Líder' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(cuantasFichas(dir, quien), 1);
  const f = ficha(dir, quien);
  assert.equal(f.estado, 'Activo');
  assert.equal(f.fecha_retiro, null, 'quedó con la fecha de retiro de la vez anterior');
  assert.equal(f.motivo_retiro, null, 'quedó con el motivo de retiro de la vez anterior');
});

/* ── A quien pusieron a mano no se le toca ─────────────────────────── */

test('a un integrante puesto a mano la regla NO lo saca', () => {
  // Este es el defecto que hubo que reparar. El cuerpo de la directiva tiene
  // también gente puesta a mano —la tesorera, el secretario, alguien que la
  // iglesia decidió que estuviera— y no está ahí por su categoría.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Activo');
  aMano(dir, quien, iglesia);
  correr(quien);
  assert.equal(ficha(dir, quien).estado, 'Activo', 'la regla lo retiró');
});

test('tampoco al que figura fallecido o trasladado, si lo pusieron a mano', () => {
  const { iglesia, dir } = unaIglesia();
  for (const estado of ['Fallecido', 'Trasladado']) {
    const quien = unMiembro(iglesia, 'Miembro Líder', estado);
    aMano(dir, quien, iglesia);
    correr(quien);
    assert.equal(ficha(dir, quien).estado, 'Activo', `lo retiró estando ${estado}`);
  }
});

test('ni al que se cambió de iglesia, si lo pusieron a mano', () => {
  const a = unaIglesia();
  const b = unaIglesia();
  const quien = unMiembro(a.iglesia, 'Miembro Activo');
  aMano(a.dir, quien, a.iglesia);
  db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(b.iglesia, quien);
  correr(quien);
  assert.equal(ficha(a.dir, quien).estado, 'Activo', 'lo sacó de un cuerpo que no manejaba');
});

test('a quien puso ella sí lo saca, aunque en el mismo cuerpo haya gente a mano', () => {
  // Las dos cosas conviven en un cuerpo: la regla distingue una por una.
  const { iglesia, dir } = unaIglesia();
  const aPulso = unMiembro(iglesia, 'Miembro Activo');
  aMano(dir, aPulso, iglesia);
  const lider = unMiembro(iglesia, 'Miembro Líder');
  correr(lider);
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(lider);
  correr(lider);
  assert.equal(ficha(dir, lider).estado, 'Retirado', 'no sacó al que había metido ella');
  assert.equal(ficha(dir, aPulso).estado, 'Activo', 'se llevó por delante al de a mano');
});

test('la ficha que pone la regla queda marcada, y la de a mano no', () => {
  // La marca es lo único que las distingue después, y no se ve en pantalla.
  const { iglesia, dir } = unaIglesia();
  const lider = unMiembro(iglesia, 'Miembro Líder');
  correr(lider);
  const aPulso = unMiembro(iglesia, 'Miembro Activo');
  aMano(dir, aPulso, iglesia);
  assert.equal(ficha(dir, lider).automatico, 1);
  assert.ok(!ficha(dir, aPulso).automatico);
});

test('si al de a mano lo retiraron y después pasa a líder, vuelve como automático', () => {
  // Entró por la regla esta vez, así que la regla puede volver a sacarlo.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Activo');
  aMano(dir, quien, iglesia, 'Retirado');
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Líder' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(ficha(dir, quien).estado, 'Activo');
  assert.equal(ficha(dir, quien).automatico, 1);

  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(ficha(dir, quien).estado, 'Retirado');
});

test('marcar el cuerpo no altera las fichas de a mano que ya estaban', () => {
  const { iglesia } = unaIglesia({ conDirectiva: false });
  const nueva = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Directiva', 'Cuerpo', ?, 'Activo', 1)")
    .run(iglesia).lastInsertRowid;
  const aPulso = unMiembro(iglesia, 'Miembro Activo');
  aMano(nueva, aPulso, iglesia);
  const lider = unMiembro(iglesia, 'Miembro Líder');

  directiva.alMarcarUnCuerpo(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(nueva), null);

  const f = ficha(nueva, aPulso);
  assert.equal(f.estado, 'Activo');
  assert.ok(!f.automatico, 'le puso la marca de automática a una ficha de a mano');
  assert.equal(ficha(nueva, lider).estado, 'Activo');
});

test('al líder que ya estaba anotado a mano, la regla le adopta la ficha', () => {
  // Si no, en las iglesias que ya tenían su directiva armada la regla quedaría
  // a medias: a quien dejara de ser líder no lo sacaría nadie.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  aMano(dir, quien, iglesia);
  const ingreso = ficha(dir, quien).fecha_ingreso;

  correr(quien);
  const f = ficha(dir, quien);
  assert.equal(f.estado, 'Activo', 'lo movió, y no había nada que mover');
  assert.equal(f.fecha_ingreso, ingreso, 'le cambió su antigüedad en el cuerpo');
  assert.equal(f.automatico, 1, 'no la adoptó');

  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);
  assert.equal(ficha(dir, quien).estado, 'Retirado', 'al dejar de ser líder no salió');
});

test('adoptar no es entrar: no se anota una entrada que no pasó', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  aMano(dir, quien, iglesia);
  const r = correr(quien);
  assert.deepEqual(r, { entro: [], salio: [] });
  assert.equal(anotaciones(quien).filter((n) => n.tipo === 'Ingreso a cuerpo').length, 0);
});

test('pero al que NO es líder no se le adopta nada, por más veces que se corra', () => {
  // Es la línea que separa este arreglo del defecto que lo motivó.
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Activo');
  aMano(dir, quien, iglesia);
  for (let i = 0; i < 3; i++) correr(quien);
  const f = ficha(dir, quien);
  assert.ok(!f.automatico, 'le adoptó la ficha a alguien que no es líder');
  assert.equal(f.estado, 'Activo');
});

/* ── El cuerpo entero, que es como se notó ─────────────────────────── */

test('un cuerpo de veintisiete sigue teniendo veintisiete', () => {
  // La reproducción exacta de lo que se vio: los integrantes iban
  // desapareciendo de la lista de asistencia de a uno, al guardar cualquier
  // ficha por cualquier motivo.
  const { iglesia, dir } = unaIglesia();
  const gente = [];
  for (let i = 0; i < 27; i++) {
    const quien = unMiembro(iglesia, i < 3 ? 'Miembro Líder' : 'Miembro Activo');
    if (i < 3) correr(quien);
    else aMano(dir, quien, iglesia);
    gente.push(quien);
  }
  for (const quien of gente) correr(quien); // se guardan sus fichas, una por una

  const vigentes = db
    .prepare("SELECT COUNT(*) c FROM integrantes_cuerpo WHERE cuerpo_id = ? AND estado <> 'Retirado'")
    .get(dir).c;
  assert.equal(vigentes, 27, 'la regla vació el cuerpo');

  // Y de los 27, solo los 3 líderes quedan bajo su mando
  const suyos = db
    .prepare('SELECT COUNT(*) c FROM integrantes_cuerpo WHERE cuerpo_id = ? AND automatico = 1')
    .get(dir).c;
  assert.equal(suyos, 3);
});

/* ── Cambiar de iglesia ────────────────────────────────────────────── */

test('quien se cambia de iglesia sale de una directiva y entra a la otra', () => {
  const a = unaIglesia();
  const b = unaIglesia();
  const quien = unMiembro(a.iglesia, 'Miembro Líder');
  correr(quien);
  assert.equal(ficha(a.dir, quien).estado, 'Activo');

  db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(b.iglesia, quien);
  correr(quien);
  assert.equal(ficha(a.dir, quien).estado, 'Retirado');
  assert.equal(ficha(a.dir, quien).motivo_retiro, 'Cambió de iglesia');
  assert.equal(ficha(b.dir, quien).estado, 'Activo');
});

/* ── Que quede escrito ─────────────────────────────────────────────── */

test('la entrada y la salida quedan anotadas en su bitácora', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  db.prepare("UPDATE miembros SET tipo_miembro = 'Miembro Activo' WHERE id = ?").run(quien);
  correr(quien);

  const notas = anotaciones(quien);
  const entrada = notas.find((n) => n.tipo === 'Ingreso a cuerpo');
  const salida = notas.find((n) => n.tipo === 'Salida de cuerpo');
  assert.ok(entrada, 'no quedó anotada la entrada');
  assert.ok(salida, 'no quedó anotada la salida');
  // La anotación dice POR QUÉ, que es lo que no se puede deducir después
  assert.match(entrada.descripcion, /Directiva/);
  assert.match(entrada.descripcion, /Miembro Líder/);
  assert.match(salida.descripcion, /Directiva/);
  assert.match(salida.descripcion, new RegExp(directiva.MOTIVO_SALIDA));
});

test('correrla dos veces no anota dos veces ni cambia nada', () => {
  const { iglesia, dir } = unaIglesia();
  const quien = unMiembro(iglesia, 'Miembro Líder');
  correr(quien);
  const cuantas = anotaciones(quien).length;
  const r = correr(quien);
  assert.deepEqual(r, { entro: [], salio: [] }, 'la segunda vez volvió a mover algo');
  assert.equal(anotaciones(quien).length, cuantas);
  assert.equal(cuantasFichas(dir, quien), 1);
});

/* ── Marcar un cuerpo con líderes ya registrados ───────────────────── */

test('al marcar un cuerpo como directiva, entran los líderes que ya lo eran', () => {
  // Si no, la directiva arrancaría vacía teniendo la iglesia sus líderes
  // registrados desde antes.
  const { iglesia } = unaIglesia({ conDirectiva: false });
  const lider1 = unMiembro(iglesia, 'Miembro Líder');
  const lider2 = unMiembro(iglesia, 'Miembro Líder');
  const otro = unMiembro(iglesia, 'Miembro Activo');
  const muerto = unMiembro(iglesia, 'Miembro Líder', 'Fallecido');

  const nueva = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Directiva', 'Cuerpo', ?, 'Activo', 1)")
    .run(iglesia).lastInsertRowid;
  const cuantos = directiva.alMarcarUnCuerpo(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(nueva), null);

  assert.equal(cuantos, 2);
  assert.equal(ficha(nueva, lider1).estado, 'Activo');
  assert.equal(ficha(nueva, lider2).estado, 'Activo');
  assert.equal(ficha(nueva, otro), undefined);
  assert.equal(ficha(nueva, muerto), undefined, 'entró alguien que figura fallecido');
});
