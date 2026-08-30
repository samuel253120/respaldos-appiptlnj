/**
 * DESHACER UNA ENTREGA NO ES CORREGIR UN TIPEO.
 *
 * Cambiar «Entregada» por «Solicitada» pasaba con un 200 y sin una palabra.
 * Medido antes de esto:
 *
 *   cambiar «Entregada» por «Solicitada» ....  200, sin preguntar
 *   en el Registro de Cambios ...............  «Estado: Entregada → Solicitada»
 *
 * Que quede anotado está bien y es más de lo que hacen otros módulos. Lo que
 * faltaba es la pregunta: una entrega que se deshace es decir que la mercadería
 * no salió después de haber dicho que sí.
 *
 * Y desde la 1.204.0 arrastra algo más: si la ayuda había salido de una cuenta
 * de tesorería, deshacerla RETIRA ese egreso del libro. Eso es lo correcto —no
 * se gastó lo que no se entregó— y es justamente lo que hay que decir antes,
 * con el monto, porque quien deshace la entrega por un descuido está moviendo
 * el saldo de una cuenta sin saberlo.
 *
 * Lo que cuida este archivo:
 *   · que deshacer una entrega pregunte, y diga a qué estado pasaría
 *   · que diga cuánto se retira del libro, cuando había salido de una cuenta
 *   · que no pregunte por lo que no es deshacer una entrega
 *   · que confirmando se pueda, porque marcarla por error existe
 *   · y que esta pregunta vaya antes que las otras dos
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

require('../../server/ajustes');
const { db } = require('../../server/db');
const AYUDAS = require('../../server/modules/ayudas_sociales');
const puente = require('../../server/ayuda-tesoreria');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del deshacer','IG-DES1','Activa')")
  .run().lastInsertRowid;
const CAJA = db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado)
     VALUES ('Caja del deshacer', 'Iglesia local', ?, 'Proyecto / Trabajo', 'Activa')`
  )
  .run(IGLESIA).lastInsertRowid;
const ELENA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Elena','Que Devuelve')")
  .run().lastInsertRowid;

const ADMIN = { id: 9401, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

const guardar = (datos, existing, confirmado) =>
  AYUDAS.hooks.beforeSave({ ...datos }, { user: ADMIN, isNew: !existing, existing, db, confirmado });

/** Una ayuda entregada de verdad, con su egreso en el libro si corresponde. */
function entregada(mas = {}) {
  const data = {
    fecha: '2026-05-10', iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro', no_miembro_id: ELENA,
    tipo_ayuda: 'Alimentos', valor_estimado: 52000, estado: 'Entregada',
    aprobada_por: 'Pastora Ruiz', soporte: 'boleta.pdf',
    salida: puente.DE_UNA_CUENTA, cuenta_id: CAJA, metodo: 'Efectivo', ...mas,
  };
  const error = guardar(data, null, true);
  assert.equal(error, null, `no se pudo anotar: ${error && (error.error || error)}`);
  const campos = Object.keys(data).filter((c) => data[c] !== undefined);
  const id = db
    .prepare(
      `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id);
  AYUDAS.hooks.afterSave(fila, { db });
  return db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id);
}

/* ------------------------------- la pregunta */

test('deshacer una entrega pregunta, y dice a qué estado pasaría', () => {
  const suya = entregada({ fecha: '2026-05-10' });
  const r = guardar({ estado: 'Solicitada' }, suya);
  assert.equal(r.confirmar, 'entrega_que_se_deshace');
  assert.match(r.error, /pasaría a «Solicitada»/);
  assert.match(r.error, /no es corregir un tipeo/);
  assert.match(r.error, /confirme/, 'se pregunta, no se bloquea');
});

test('y dice cuánto se retira del libro, con su monto', () => {
  const suya = entregada({ fecha: '2026-05-11' });
  assert.ok(db.prepare('SELECT id FROM tesoreria WHERE ayuda_id = ?').get(suya.id), 'dejó su egreso');
  const r = guardar({ estado: 'Aprobada' }, suya);
  assert.match(r.error, /se retira de Tesorería el egreso de \$ 52\.000/);
  assert.match(r.error, /el saldo de esa cuenta cambia/);
});

test('la que fue en especie no habla de ningún egreso, porque no dejó ninguno', () => {
  const suya = entregada({
    fecha: '2026-05-12', salida: puente.EN_ESPECIE, cuenta_id: null, metodo: null,
  });
  const r = guardar({ estado: 'Solicitada' }, suya);
  assert.equal(r.confirmar, 'entrega_que_se_deshace');
  assert.doesNotMatch(r.error, /Tesorería/, 'no se inventa un egreso que no existió');
});

test('confirmando se puede: marcarla por error existe', () => {
  const suya = entregada({ fecha: '2026-05-13' });
  assert.equal(guardar({ estado: 'Solicitada' }, suya, true), null);
});

/* ------------------------------- lo que no es deshacer una entrega */

test('no pregunta al corregirle cualquier otra cosa a una entregada', () => {
  const suya = entregada({ fecha: '2026-05-14' });
  assert.equal(guardar({ descripcion: 'se le arregla una coma' }, suya), null);
  assert.equal(guardar({ estado: 'Entregada' }, suya), null, 'ni al reenviar el mismo estado');
});

test('ni al entregar, que es el camino de ida', () => {
  const enTramite = {
    id: 9001, estado: 'Aprobada', salida: puente.EN_ESPECIE,
    valor_estimado: 1000, soporte: 'b.pdf', aprobada_por: 'Pastora Ruiz',
  };
  assert.equal(guardar({ estado: 'Entregada' }, enTramite), null);
});

test('ni a una que nunca estuvo entregada', () => {
  const pedida = { id: 9002, estado: 'Solicitada', salida: null };
  assert.equal(guardar({ estado: 'Rechazada' }, pedida), null);
});

test('ni al crear una ayuda nueva, que no deshace nada', () => {
  const nueva = {
    fecha: '2026-05-15', iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro', no_miembro_id: ELENA,
    tipo_ayuda: 'Ropa', estado: 'Solicitada',
  };
  assert.equal(guardar(nueva), null);
});

/* ------------------------------- el orden de las preguntas */

test('deshacer una entrega se pregunta antes que lo demás', () => {
  /*
   * La confirmación es una sola para todo el guardado. Borrar un hecho que ya
   * se dio por cierto —y moverle el saldo a una cuenta— pesa más que una ficha
   * a la que le falta un dato o que se parece a otra.
   */
  const suya = entregada({ fecha: '2026-05-16' });
  const otraIgual = entregada({ fecha: '2026-05-17' });

  // Se le cambia el estado Y la fecha a la de la otra: las dos preguntas caben
  const r = guardar({ estado: 'Solicitada', fecha: otraIgual.fecha }, suya);
  assert.equal(r.confirmar, 'entrega_que_se_deshace', 'gana la de deshacer');

  // Y sin deshacer nada, la del repetido sale como siempre
  const soloLaFecha = guardar({ fecha: otraIgual.fecha }, suya);
  assert.equal(soloLaFecha.confirmar, 'ayuda_ya_registrada');
});

/* ------------------------------- y lo que pasa al confirmar */

test('confirmada, el egreso se retira de verdad y el saldo vuelve', () => {
  const suya = entregada({ fecha: '2026-05-18' });
  const antes = db.prepare('SELECT monto FROM tesoreria WHERE ayuda_id = ?').get(suya.id);
  assert.equal(antes.monto, 52000);

  assert.equal(guardar({ estado: 'Solicitada' }, suya, true), null);
  db.prepare("UPDATE ayudas_sociales SET estado = 'Solicitada' WHERE id = ?").run(suya.id);
  AYUDAS.hooks.afterSave(db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(suya.id), { db });

  assert.equal(db.prepare('SELECT id FROM tesoreria WHERE ayuda_id = ?').get(suya.id), undefined,
    'no se gastó lo que no se entregó');
});
