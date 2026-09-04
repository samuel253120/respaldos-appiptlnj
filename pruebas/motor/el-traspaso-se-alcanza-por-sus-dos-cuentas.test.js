/**
 * Un traspaso toca dos cuentas, y se alcanza por cualquiera de las dos.
 *
 * Su columna `iglesia_id` se toma de la cuenta de ORIGEN —de ahí sale la plata
 * y de ahí es el traspaso—, y esa columna decide quién lo ve. Con eso, la
 * iglesia que RECIBE veía el ingreso en su cuenta, sabía por el concepto de qué
 * cuenta venía, y al abrir el traspaso que lo explica recibía un 403: se
 * quedaba con un ingreso de $ 300.000 y sin el comprobante, el número de
 * operación ni quién lo anotó, que es justo lo que necesita para cuadrar contra
 * la cartola de su banco.
 *
 * El sistema ya sabía hacerlo bien en la mitad del problema: para el NIVEL de
 * tesorería un traspaso «puede tocar los dos niveles a la vez». Para la iglesia
 * se olvidaba de la segunda cuenta.
 *
 * «ALCANZAR LA OTRA PUNTA» ES ALCANZAR ESA CUENTA, con las reglas de siempre
 * —su iglesia, su cuerpo y su nivel—. No se abre nada nuevo: se admite lo que
 * ya se podía ver. Comprobado, después del arreglo, que la tesorera que recibe
 * abre el traspaso que llega a su cuenta y NO el de la misma iglesia vecina que
 * no la toca, y que no gana acceso a ninguna cuenta, movimiento ni ficha de la
 * otra congregación.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const alcance = require('../../server/alcance');

const TRASPASOS = getModule('traspasos');
const CUENTAS = getModule('cuentas_tesoreria');

const central = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de las Dos Puntas','IG-2P-C','Activa')").run().lastInsertRowid;
const norte = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de las Dos Puntas','IG-2P-N','Activa')").run().lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de las Dos Puntas','Cuerpo',?,'Activo')").run(central).lastInsertRowid;

let n = 0;
const cuenta = (iglesiaId, cuerpoId) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, ?, 'Proyecto / Trabajo', ?, ?, 'Activa', 900000, '2020-01-01')`)
  .run(`Caja ${++n} de las Dos Puntas`, cuerpoId ? 'Cuerpo / Grupo' : 'Iglesia local',
       iglesiaId, cuerpoId || null).lastInsertRowid;

const deLaCentral = cuenta(central, null);
const otraDeLaCentral = cuenta(central, null);
const deLaNorte = cuenta(norte, null);
const delCuerpo = cuenta(central, cuerpo);

const traspaso = (origen, destino) => {
  const laDelOrigen = db.prepare('SELECT iglesia_id FROM cuentas_tesoreria WHERE id = ?').get(origen);
  const id = db
    .prepare(`INSERT INTO traspasos (fecha, cuenta_origen_id, cuenta_destino_id, monto, forma, concepto, iglesia_id)
              VALUES ('2026-07-07', ?, ?, 300000, 'Transferencia', ?, ?)`)
    .run(origen, destino, `Lo de las dos puntas ${++n}`, laDelOrigen.iglesia_id).lastInsertRowid;
  return db.prepare('SELECT * FROM traspasos WHERE id = ?').get(id);
};

const deLaNorteTesorera = { id: 71, rol: 'tesorero', iglesias: [norte], cuerpos: [] };
const deLaCentralTesorera = { id: 72, rol: 'tesorero', iglesias: [central], cuerpos: [] };
const sinNivelGeneral = { id: 73, rol: 'tesorero', iglesias: [central], cuerpos: [cuerpo],
  permisos: JSON.stringify({ tesoreria_general: [] }) };

/** Los traspasos que esta persona ve en su listado, como los arma el motor. */
function suListado(usuario) {
  const params = [];
  const donde = alcance.condiciones(TRASPASOS, usuario, params);
  return db.prepare(`SELECT * FROM traspasos${donde ? ` WHERE ${donde}` : ''}`).all(...params);
}

// ------------------------------------------------- la que recibe lo ve ----

test('la iglesia que RECIBE abre el traspaso que llega a su cuenta', () => {
  const tr = traspaso(deLaCentral, deLaNorte);
  assert.equal(alcance.alcanza(TRASPASOS, tr, deLaNorteTesorera), true,
    'antes: 403, con el ingreso a la vista y sin el comprobante que lo respalda');
  assert.ok(suListado(deLaNorteTesorera).some((x) => x.id === tr.id), 'y le aparece en su listado');
});

test('y la que lo SACÓ lo sigue viendo, como siempre', () => {
  const tr = traspaso(deLaCentral, deLaNorte);
  assert.equal(alcance.alcanza(TRASPASOS, tr, deLaCentralTesorera), true);
  assert.ok(suListado(deLaCentralTesorera).some((x) => x.id === tr.id));
});

// -------------------------------------------- y nada más se abrió ----

test('pero NO uno de esa misma iglesia que no la toca', () => {
  const ajeno = traspaso(deLaCentral, otraDeLaCentral);
  assert.equal(alcance.alcanza(TRASPASOS, ajeno, deLaNorteTesorera), false);
  assert.ok(!suListado(deLaNorteTesorera).some((x) => x.id === ajeno.id),
    'ni le aparece en el listado: si apareciera, se vería algo que después no se deja abrir');
});

test('el listado y la ficha dicen lo mismo, traspaso por traspaso', () => {
  /*
   * Si dijeran cosas distintas, se vería en la lista algo que después contesta
   * 403, o al revés. Se comprueban los dos caminos sobre las mismas filas.
   */
  const todos = db.prepare('SELECT * FROM traspasos').all();
  const enLaLista = new Set(suListado(deLaNorteTesorera).map((x) => x.id));
  for (const tr of todos) {
    assert.equal(enLaLista.has(tr.id), alcance.alcanza(TRASPASOS, tr, deLaNorteTesorera),
      `el traspaso #${tr.id} no dice lo mismo en la lista que en su ficha`);
  }
});

test('y no le abre ninguna CUENTA de la otra congregación', () => {
  /*
   * Lo que se admitió es el traspaso, no lo que hay al otro lado. Si esto se
   * cayera, la tesorera de una iglesia pasaría a ver la caja de otra por haber
   * recibido un peso suyo.
   */
  const laDeAllá = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(deLaCentral);
  assert.equal(alcance.alcanza(CUENTAS, laDeAllá, deLaNorteTesorera), false);
  const params = [];
  const donde = alcance.condiciones(CUENTAS, deLaNorteTesorera, params);
  const suyas = db.prepare(`SELECT id FROM cuentas_tesoreria${donde ? ` WHERE ${donde}` : ''}`).all(...params);
  assert.ok(!suyas.some((c) => c.id === deLaCentral), 'ni le aparece en su listado de cuentas');
});

// ------------------------------------- el nivel lo sigue diciendo el origen ----

test('el NIVEL lo sigue decidiendo el origen: la entrega del cuerpo le queda a la vista', () => {
  /*
   * Es lo que se arregló en la 1.223.0 y no se toca acá: la tesorera del cuerpo
   * anotaba una entrega a su iglesia que después no veía. Este arreglo es sobre
   * la IGLESIA, no sobre el nivel.
   */
  const suya = traspaso(delCuerpo, deLaCentral);
  assert.equal(alcance.alcanza(TRASPASOS, suya, sinNivelGeneral), true);
  const deLaIglesia = traspaso(deLaCentral, otraDeLaCentral);
  assert.equal(alcance.alcanza(TRASPASOS, deLaIglesia, sinNivelGeneral), false,
    'uno que sale de la caja de la iglesia no es suyo, aunque entre a la de al lado');
});

// ------------------------------------------------------ dónde está escrito ----

test('la regla la declara el módulo, no la inventa el alcance', () => {
  assert.deepEqual(TRASPASOS.alcance.tambienPor,
    [{ campo: 'cuenta_destino_id', modulo: 'cuentas_tesoreria' }]);
  const texto = fs.readFileSync(path.join(__dirname, '../../server/alcance.js'), 'utf8');
  assert.match(texto, /suAlcance\.tambienPor \|\| \[\]/, 'el listado la aplica');
  assert.match(texto, /suyoEs\.tambienPor \|\| \[\]/, 'y la ficha también, o dirían cosas distintas');
});

test('y son las dos del sistema: una excepción de alcance sin dueño es un agujero', () => {
  /*
   * Cada una tiene su motivo escrito en su módulo y su prueba que la mide. La
   * segunda llegó en la v1.375.0: una actividad de asistencia puede convocar
   * cuerpos de dos congregaciones y su columna `iglesia_id` se queda con la del
   * primero, así que la otra recibía un 403 al abrir la lista de su propio
   * cuerpo. Si aparece una tercera sin que nadie la haya pensado, esto lo dice.
   */
  const modulos = fs.readdirSync(path.join(__dirname, '../../server/modules'))
    .filter((f) => f.endsWith('.js'));
  const conEsto = modulos.filter((f) => {
    const def = getModule(f.replace(/\.js$/, ''));
    return def && def.alcance && def.alcance.tambienPor;
  });
  assert.deepEqual(conEsto.sort(), ['asistencias.js', 'traspasos.js']);
});
