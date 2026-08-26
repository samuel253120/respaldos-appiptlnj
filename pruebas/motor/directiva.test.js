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
