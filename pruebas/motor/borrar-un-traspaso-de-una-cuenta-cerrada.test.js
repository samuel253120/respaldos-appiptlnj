/**
 * La sexta puerta de una cuenta cerrada: el botón de eliminar.
 *
 * La versión 1.214.0 juntó en un solo archivo la regla de que una cuenta
 * cerrada no recibe plata nueva, y cerró las cinco puertas que ESCRIBEN en
 * Tesorería. Quedó una sexta, que no escribe sino que BORRA, y por eso no se
 * había mirado: al eliminar un traspaso se van sus dos movimientos, y si una de
 * las cuentas está cerrada eso le cambia el saldo.
 *
 * Medido: una cuenta recibió $ 400.000 por un traspaso, se cerró, y al eliminar
 * ese traspaso el saldo pasó de $ 400.000 a $ 0 con un 200 y sin una palabra.
 * Sobre esa misma cuenta y el mismo día, las otras tres puertas contestaban lo
 * que corresponde:
 *
 *   un egreso a mano ........ «no admite nuevos movimientos»
 *   un traspaso de salida ... «no puede salir dinero de ella»
 *   eliminar la cuenta ...... «tiene 1 movimiento(s) registrado(s)»
 *
 * El sistema sabía que de esa cuenta no podía salir dinero, lo decía dos veces
 * con dos frases distintas, y por el botón de eliminar salía igual, callado.
 *
 * SE PREGUNTA Y NO SE BLOQUEA, como al cerrar una cuenta con plata dentro: un
 * traspaso mal anotado hay que poder borrarlo, y prohibirlo dejaría el error
 * escrito para siempre. Lo que no puede es que la decisión se tome a ciegas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const traspasosMod = require('../../server/modules/traspasos');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Borrado','IG-BORR','Activa')").run().lastInsertRowid;

let n = 0;
const cuenta = (estado = 'Activa') => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, 'Iglesia local', 'Proyecto / Trabajo', ?, ?, 900000, '2020-01-01')`)
  .run(`Caja ${++n} del Borrado`, iglesia, estado).lastInsertRowid;

/** Un traspaso ya guardado, con sus dos movimientos, como lo deja el motor. */
function traspaso(origen, destino, monto = 400000) {
  const id = db
    .prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
              VALUES ('2026-05-05', ?, ?, ?, 'Transferencia', ?, ?)`)
    .run(origen, destino, monto, `Lo del borrado ${++n}`, iglesia).lastInsertRowid;
  traspasosMod.hooks.afterSave(db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id), { db });
  return db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id);
}
const cerrar = (id) => db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(id);
const movimientosDe = (tr) => db.prepare('SELECT COUNT(*) c FROM tesoreria WHERE traspaso_id = ?').get(tr.id).c;
const borrar = (tr, confirmado = false) => traspasosMod.hooks.beforeDelete(tr, { db, confirmado });

// --------------------------------------------------------- se pregunta ----

test('borrar un traspaso cuya cuenta de DESTINO se cerró pregunta antes', () => {
  const origen = cuenta();
  const destino = cuenta();
  const tr = traspaso(origen, destino);
  cerrar(destino);

  const r = borrar(tr);
  assert.ok(r, 'antes esto contestaba 200 y le sacaba la plata sin decir nada');
  assert.equal(r.confirmar, 'borrar_toca_cuenta_cerrada');
  assert.match(r.error, /le salen \$ 400\.000/, 'dice cuánta plata y para qué lado');
  assert.equal(movimientosDe(tr), 2, 'y no borró nada mientras preguntaba');
});

test('y si la cerrada es la de ORIGEN, dice que la plata VUELVE', () => {
  const origen = cuenta();
  const tr = traspaso(origen, cuenta());
  cerrar(origen);

  const r = borrar(tr);
  assert.equal(r.confirmar, 'borrar_toca_cuenta_cerrada');
  assert.match(r.error, /le vuelven \$ 400\.000/,
    'no es lo mismo devolverle plata a una caja cerrada que quitársela');
});

test('con las dos cerradas lo dice de las dos, cada una por su lado', () => {
  const origen = cuenta();
  const destino = cuenta();
  const tr = traspaso(origen, destino);
  cerrar(origen);
  cerrar(destino);

  const r = borrar(tr);
  assert.match(r.error, /Las dos cuentas de este traspaso están cerradas/);
  assert.match(r.error, /le vuelven \$ 400\.000 y .* le salen \$ 400\.000/);
});

test('el aviso dice por qué importa y cuál es la salida', () => {
  const destino = cuenta();
  const tr = traspaso(cuenta(), destino);
  cerrar(destino);
  const r = borrar(tr);
  assert.match(r.error, /cartola del banco/,
    'sin decir por qué importa, el aviso es un trámite que se aprieta sin leer');
  assert.match(r.error, /confirme/);
});

// --------------------------------------------------- y no se bloquea ----

test('confirmando se borra, y se lleva sus dos movimientos', () => {
  const destino = cuenta();
  const tr = traspaso(cuenta(), destino);
  cerrar(destino);

  assert.equal(borrar(tr, true), null);
  assert.equal(movimientosDe(tr), 0, 'los dos lados se van juntos, como siempre');
});

test('sin ninguna cerrada no pregunta nada: se borra como toda la vida', () => {
  const tr = traspaso(cuenta(), cuenta());
  assert.equal(borrar(tr), null);
  assert.equal(movimientosDe(tr), 0);
});

test('y una cuenta que ya no existe no inventa un aviso', () => {
  const tr = traspaso(cuenta(), cuenta());
  db.prepare('UPDATE traspasos SET cuenta_destino_id = 99999999 WHERE id = ?').run(tr.id);
  const suelto = db.prepare('SELECT * FROM traspasos WHERE id = ?').get(tr.id);
  assert.equal(borrar(suelto), null, 'una cuenta que falta es otro problema, y lo dice quien la busca');
});

// ------------------------------------------------ el motor lo transporta ----

test('el motor sabe que un gancho de borrado puede preguntar, no solo negarse', () => {
  /*
   * Antes solo podía devolver un texto, y eso obligaba a elegir entre dejar
   * pasar algo que merecía una advertencia o prohibir algo legítimo.
   */
  const motor = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  const trozo = motor.slice(motor.indexOf('def.hooks.beforeDelete'));
  assert.match(trozo.slice(0, 2200), /req\.query\.igual_asi === 'true' \|\| req\.query\.igual_asi === '1'/,
    'la respuesta de la persona llega por la dirección: un DELETE no lleva cuerpo');
  assert.match(trozo.slice(0, 2200), /beforeDelete\(row, \{ user: req\.user, db, confirmado \}\)/);
  assert.match(trozo.slice(0, 2200), /if \(err && err\.confirmar\) problema\.confirmar = err\.confirmar;/);
  assert.match(motor, /error: e\.message, \.\.\.\(e\.confirmar \? \{ confirmar: e\.confirmar \} : \{\}\)/,
    'y la pregunta tiene que llegar hasta la pantalla, no quedarse en el camino');
});

test('y la pantalla la convierte en una segunda pregunta antes de insistir', () => {
  const pantalla = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(pantalla, /async function borrarPreguntando\(ruta\)/);
  assert.match(pantalla, /igual_asi=1/, 'y al insistir manda la respuesta');
  assert.match(pantalla, /borrarPreguntando\(`\/\$\{name\}\/\$\{b\.dataset\.id\}`\)/,
    'el borrado del listado tiene que pasar por ahí, o la pregunta no se ve nunca');
});

test('la regla de la cuenta cerrada sigue viviendo en un solo archivo', () => {
  /*
   * Era el punto de la 1.214.0: una regla copiada en cinco archivos es una
   * regla que va a faltar en el sexto. Esta puerta la pregunta, no la repite.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/traspasos.js'), 'utf8');
  assert.match(modulo, /cerrada\.admitePlataNueva\(l\.cuenta\)/);
  assert.doesNotMatch(modulo, /estado === 'Cerrada'/,
    'el módulo no vuelve a escribir la regla: se la pregunta a server/cuenta-cerrada.js');
});
