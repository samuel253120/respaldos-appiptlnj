/**
 * SACAR DEL CUERPO A QUIEN LO DIRIGE SE PREGUNTA ANTES.
 *
 * El sistema tiene la regla escrita y la aplica por un lado: nombrar líder a
 * quien no es integrante se pregunta con todas sus letras —«no figura entre los
 * integrantes de este cuerpo… De los integrantes de un cuerpo sale su
 * directiva»—. Retirar del cuerpo al que ya lo dirige, en cambio, pasaba sin una
 * palabra, y dejaba exactamente el estado que la otra puerta se niega a crear.
 *
 * Medido en la v1.393.0, sobre el mismo cuerpo:
 *
 *   nombrar líder a quien NO es integrante .... 400, con su explicación
 *   retirar del cuerpo al que SÍ lo dirige .... 200, sin preguntar nada
 *
 * y después el cuerpo seguía diciendo que lo dirige esa persona, con su ficha
 * marcada «Retirado» y la marca «Lidera» al lado, las dos cosas a la vez.
 *
 * Cerrar una de las dos puertas es lo mismo que no cerrar ninguna, que es la
 * lección que dejó la planilla de cuotas en la 1.249.0.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');

const integrantes = getModule('integrantes_cuerpo');
const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central QD ${marca}`, `QD-${marca}`).lastInsertRowid;

function unCuerpoConSuGente() {
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas ${++n} QD ${marca}`, iglesia).lastInsertRowid;
  const gente = [0, 1].map((i) => {
    const quien = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
      .run(`Quien${++n}`, `Sirve QD ${marca}`, iglesia).lastInsertRowid;
    const ficha = db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
       VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-05', ?)`
    ).run(cuerpo, quien, `Quien${n} Sirve QD ${marca}`, iglesia).lastInsertRowid;
    return { quien, ficha };
  });
  return { cuerpo, lider: gente[0], otra: gente[1] };
}

const alRetirar = (e, confirmado = false) => {
  const existing = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(e.ficha);
  return integrantes.hooks.beforeSave(
    { estado: 'Retirado', fecha_retiro: '2026-06-30', motivo_retiro: 'Cambio de ciudad' },
    { existing, id: e.ficha, db, confirmado }
  );
};

test('retirar del cuerpo a quien lo dirige pregunta antes de guardar', () => {
  const c = unCuerpoConSuGente();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(c.lider.quien, c.cuerpo);

  const aviso = alRetirar(c.lider);
  assert.ok(aviso && aviso.confirmar, `tenía que preguntar: ${JSON.stringify(aviso)}`);
  assert.equal(aviso.confirmar, 'deja_al_cuerpo_sin_quien_lo_dirija');
  assert.match(aviso.error, /es quien dirige/);
  assert.match(aviso.error, /Damas/, 'y nombra el cuerpo');
  assert.match(aviso.error, /nombrar líder a quien no es integrante/,
    'y explica que es lo que el sistema no deja hacer al revés');
});

test('y quien no lo dirige sale sin que se le pregunte nada', () => {
  const c = unCuerpoConSuGente();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(c.lider.quien, c.cuerpo);
  assert.equal(alRetirar(c.otra), null, 'un integrante cualquiera se retira sin preguntas');
});

test('contestando que sí, se guarda', () => {
  const c = unCuerpoConSuGente();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(c.lider.quien, c.cuerpo);
  assert.equal(alRetirar(c.lider, true), null, 'la persona se va, y eso el sistema no lo discute');
});

test('borrar la ficha, que es la otra puerta, pregunta lo mismo', () => {
  const c = unCuerpoConSuGente();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(c.lider.quien, c.cuerpo);
  const fila = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(c.lider.ficha);
  const aviso = integrantes.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.ok(aviso && aviso.confirmar === 'deja_al_cuerpo_sin_quien_lo_dirija',
    `la otra puerta tiene que preguntar igual: ${JSON.stringify(aviso)}`);
  assert.equal(integrantes.hooks.beforeDelete(fila, { db, confirmado: true }), null);
});

test('un grupo dirigido por alguien no inscrito se comprueba igual', () => {
  const grupo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Grupo',?,'Activo')")
    .run(`Aseo ${++n} QD ${marca}`, iglesia).lastInsertRowid;
  const quien = db.prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)')
    .run('Quien', `Ayuda QD ${marca}`, iglesia).lastInsertRowid;
  const ficha = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, no_miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'No miembro', ?, 'Activo', '2026-01-05', ?)`
  ).run(grupo, quien, `Quien Ayuda QD ${marca}`, iglesia).lastInsertRowid;
  db.prepare("UPDATE cuerpos SET lider_tipo = 'No miembro', lider_no_miembro_id = ? WHERE id = ?").run(quien, grupo);

  const aviso = alRetirar({ ficha });
  assert.ok(aviso && aviso.confirmar === 'deja_al_cuerpo_sin_quien_lo_dirija',
    `también en un grupo: ${JSON.stringify(aviso)}`);
  assert.match(aviso.error, /Quien Ayuda/);
});

test('la pantalla sabe explicar esta pregunta', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /deja_al_cuerpo_sin_quien_lo_dirija: \{/,
    'sin su entrada, la pregunta sale con el título genérico');
  assert.match(app, /Volver y designar a otra persona/);
});
