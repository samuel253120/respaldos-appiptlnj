/**
 * El número que el sistema propone para la próxima acta.
 *
 * POR QUÉ IMPORTA. En un libro de actas la numeración es lo que ordena el
 * archivo: si se repite un número o se salta uno, después nadie sabe si falta
 * un acta o si ese número simplemente no se usó. Escribiéndolo a mano cada vez
 * eso pasa, y no se nota hasta meses después.
 *
 * Lo que se cuida acá son las tres reglas del libro —una serie por cuerpo, una
 * numeración por año, y el siguiente es el mayor más uno— y, sobre todo, que
 * la propuesta NO SE META donde no la llaman: lo que ya está escrito a mano no
 * se cuenta ni estorba, porque el número se puede cambiar siempre.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { proximoNumero, anioDe } = require('../../server/numeracion');

/** Un cuerpo nuevo para cada prueba, para que no se pisen entre ellas. */
let siguiente = 0;
function unCuerpo() {
  siguiente++;
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia num ${siguiente}`, `IG-NUM-${siguiente}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Coro', ?, 'Activo')")
    .run(`Coro ${siguiente}`, iglesia).lastInsertRowid;
  return { iglesia, cuerpo };
}

const anotarActa = (cuerpo, iglesia, numero, fecha) =>
  db.prepare(
    `INSERT INTO actas_reuniones (numero_acta, fecha, iglesia_id, cuerpo_id, estado)
     VALUES (?, ?, ?, ?, 'Borrador')`
  ).run(numero, fecha, iglesia, cuerpo);

// ────────────────────────────────────────────── el libro vacío y el que sigue ───

test('un libro sin actas empieza en el uno', () => {
  const { cuerpo } = unCuerpo();
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-08-25'), '001-2026');
});

test('el siguiente es el mayor más uno, no la cantidad que hay', () => {
  // Si se contaran las actas en vez de mirar el número mayor, borrar una haría
  // que el sistema propusiera un número ya usado.
  const { cuerpo, iglesia } = unCuerpo();
  anotarActa(cuerpo, iglesia, '001-2026', '2026-01-10');
  anotarActa(cuerpo, iglesia, '002-2026', '2026-02-10');
  anotarActa(cuerpo, iglesia, '003-2026', '2026-03-10');
  db.prepare('DELETE FROM actas_reuniones WHERE numero_acta = ? AND cuerpo_id = ?').run('002-2026', cuerpo);
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-08-25'), '004-2026');
});

test('el número lleva tres cifras, y crece cuando hace falta', () => {
  const { cuerpo, iglesia } = unCuerpo();
  anotarActa(cuerpo, iglesia, '009-2026', '2026-01-10');
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-08-25'), '010-2026');
  anotarActa(cuerpo, iglesia, '999-2026', '2026-02-10');
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-08-25'), '1000-2026');
});

// ─────────────────────────────────────────── cada libro es de quien es ───

test('cada cuerpo lleva su propio libro', () => {
  // El 001 del coro y el 001 de las dorcas son dos actas distintas, y las dos
  // válidas: numerar por iglesia mezclaría los libros de todos sus cuerpos.
  const a = unCuerpo();
  const b = unCuerpo();
  anotarActa(a.cuerpo, a.iglesia, '001-2026', '2026-01-10');
  anotarActa(a.cuerpo, a.iglesia, '002-2026', '2026-02-10');
  assert.equal(proximoNumero('actas_reuniones', a.cuerpo, '2026-08-25'), '003-2026');
  assert.equal(proximoNumero('actas_reuniones', b.cuerpo, '2026-08-25'), '001-2026');
});

test('el año reinicia la cuenta, como en cualquier libro de actas', () => {
  const { cuerpo, iglesia } = unCuerpo();
  anotarActa(cuerpo, iglesia, '001-2026', '2026-01-10');
  anotarActa(cuerpo, iglesia, '002-2026', '2026-02-10');
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2027-01-05'), '001-2027');
  // y el año viejo sigue contando desde donde iba
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-12-30'), '003-2026');
});

test('el año lo pone la fecha del acta, no el día de hoy', () => {
  assert.equal(anioDe('2024-03-15'), 2024);
  assert.equal(anioDe(''), new Date().getFullYear());
  assert.equal(anioDe(null), new Date().getFullYear());
  assert.equal(anioDe('cualquier cosa'), new Date().getFullYear());
});

// ─────────────────────────────────── lo que se escribió a mano no estorba ───

test('un número con otro formato no se cuenta ni rompe la propuesta', () => {
  // Un libro que viene de antes puede traer «Acta de marzo» o «12/2025». No es
  // asunto del sistema corregirlo: se lo salta y propone lo suyo.
  const { cuerpo, iglesia } = unCuerpo();
  anotarActa(cuerpo, iglesia, 'Acta de marzo', '2026-03-01');
  anotarActa(cuerpo, iglesia, '12/2026', '2026-04-01');
  anotarActa(cuerpo, iglesia, '007-2026', '2026-05-01');
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-08-25'), '008-2026');
});

test('el número de OTRO año no adelanta la cuenta de este', () => {
  const { cuerpo, iglesia } = unCuerpo();
  anotarActa(cuerpo, iglesia, '050-2025', '2025-11-01');
  assert.equal(proximoNumero('actas_reuniones', cuerpo, '2026-01-05'), '001-2026');
});

// ─────────────────────────────────────────────────── sin libro, no se inventa ───

test('sin cuerpo no se propone nada: no se sabe de qué libro se habla', () => {
  for (const nada of [0, null, undefined, '', 'x']) {
    assert.equal(proximoNumero('actas_reuniones', nada, '2026-08-25'), null);
  }
});

test('una serie que no existe no revienta', () => {
  assert.equal(proximoNumero('lo_que_sea', 1, '2026-08-25'), null);
});

// ───────────────────────────────────────────────── las actas de asamblea ───

test('la asamblea se numera por iglesia y lleva su propia marca', () => {
  const { iglesia } = unCuerpo();
  assert.equal(proximoNumero('actas_asambleas', iglesia, '2026-08-25'), 'AS-001-2026');
  db.prepare(
    `INSERT INTO actas_asambleas (numero_acta, fecha, iglesia_id, estado)
     VALUES ('AS-001-2026','2026-01-10',?,'Borrador')`
  ).run(iglesia);
  assert.equal(proximoNumero('actas_asambleas', iglesia, '2026-08-25'), 'AS-002-2026');
});

test('el número de una reunión no se confunde con el de una asamblea', () => {
  // Las dos series conviven en la misma iglesia y no se cuentan entre ellas.
  const { iglesia, cuerpo } = unCuerpo();
  anotarActa(cuerpo, iglesia, '005-2026', '2026-05-01');
  assert.equal(proximoNumero('actas_asambleas', iglesia, '2026-08-25'), 'AS-001-2026');
});

// ─────────────────────────────────────────── que no se pueda repetir dentro ───

test('el módulo declara el número único DENTRO de su libro, no en todo el sistema', () => {
  const { getModule } = require('../../server/registry');
  assert.equal(getModule('actas_reuniones').fields.find((f) => f.name === 'numero_acta').unique, 'cuerpo_id');
  assert.equal(getModule('actas_asambleas').fields.find((f) => f.name === 'numero_acta').unique, 'iglesia_id');
});

test('y se sigue pudiendo escribir: la propuesta no lo deja de solo lectura', () => {
  // Hay actas que llegan con su número puesto y libros que no empiezan en 001.
  const { getModule } = require('../../server/registry');
  for (const cual of ['actas_reuniones', 'actas_asambleas']) {
    const campo = getModule(cual).fields.find((f) => f.name === 'numero_acta');
    assert.notEqual(campo.readonly, true, `${cual}: el número tiene que poder cambiarse`);
    assert.notEqual(campo.oculto, true, `${cual}: y tiene que verse`);
  }
});
