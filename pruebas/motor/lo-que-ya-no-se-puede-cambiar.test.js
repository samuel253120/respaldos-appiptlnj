/**
 * Los campos que se escriben hasta que algo se consuma, y después ya no.
 *
 * Hay datos que una persona sí elige mientras algo se está preparando, y que
 * dejan de poder escribirse en cuanto ese algo sale al mundo. La fecha de
 * entrega de una credencial es el caso claro: se elige mientras es un
 * borrador, y una vez emitida queda impresa en una tarjeta que anda en el
 * bolsillo de alguien, así que la fila y el papel tienen que seguir diciendo
 * lo mismo.
 *
 * Eso NO es lo mismo que `readonly`, que es para lo que no lo escribe nadie
 * nunca —el número de serie, lo que se calcula solo— y que el motor descarta
 * en silencio porque el formulario ni siquiera lo ofrece.
 *
 * ESTO ESTABA MAL, Y DE UNA MANERA QUE NO SE VEÍA. Se resolvía dentro del
 * gancho del módulo de Credenciales, borrando el campo del guardado y
 * siguiendo adelante. Medido sobre una credencial emitida: cambiarle la fecha
 * de vencimiento a 2031 respondía HTTP 200, sin ningún mensaje, el dato seguía
 * en 2028 y la versión subía igual —así que a otra persona con esa ficha
 * abierta le saltaba el aviso de «alguien la modificó» por un cambio que no
 * ocurrió—. Y la pantalla los ofrecía como editables, con el titular en un
 * desplegable con todos los pastores del sistema. Quien corregía una fecha mal
 * escrita se iba convencido de haberla corregido.
 *
 * Ahora son dos cosas: el campo declara `bloqueadoSi`, la pantalla lo dibuja
 * trabado y el motor contesta explicando si igual llega.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { estaBloqueado } = require('../../server/crud');
const credenciales = require('../../server/modules/credenciales');

const campoDe = (nombre) => credenciales.fields.find((f) => f.name === nombre);

/* --------------------------------------------------------------------- */
/* La regla, en el motor                                                  */
/* --------------------------------------------------------------------- */

test('un campo sin condición nunca se traba', () => {
  assert.equal(estaBloqueado({ name: 'notas' }, { estado: 'Vigente' }), false);
});

test('en una ficha nueva no hay nada que trabar todavía', () => {
  // Sin `existing` no hay estado del que depender: se está creando
  const campo = { bloqueadoSi: { field: 'estado', salvo: 'Borrador' } };
  assert.equal(estaBloqueado(campo, null), false);
  assert.equal(estaBloqueado(campo, undefined), false);
});

test('«salvo» traba en todos los estados menos en ese', () => {
  const campo = { bloqueadoSi: { field: 'estado', salvo: 'Borrador' } };
  assert.equal(estaBloqueado(campo, { estado: 'Borrador' }), false);
  for (const estado of ['Vigente', 'Revocada', 'Reemplazada']) {
    assert.equal(estaBloqueado(campo, { estado }), true, `tendría que trabarse en ${estado}`);
  }
});

test('«equals» traba justamente en ese', () => {
  const campo = { bloqueadoSi: { field: 'estado', equals: 'Cerrado' } };
  assert.equal(estaBloqueado(campo, { estado: 'Cerrado' }), true);
  assert.equal(estaBloqueado(campo, { estado: 'Abierto' }), false);
});

test('«salvoEn» admite más de un estado', () => {
  const campo = { bloqueadoSi: { field: 'estado', salvoEn: ['Borrador', 'En revisión'] } };
  assert.equal(estaBloqueado(campo, { estado: 'Borrador' }), false);
  assert.equal(estaBloqueado(campo, { estado: 'En revisión' }), false);
  assert.equal(estaBloqueado(campo, { estado: 'Vigente' }), true);
});

test('un estado vacío o ausente cuenta como distinto', () => {
  const campo = { bloqueadoSi: { field: 'estado', salvo: 'Borrador' } };
  assert.equal(estaBloqueado(campo, {}), true);
  assert.equal(estaBloqueado(campo, { estado: null }), true);
  assert.equal(estaBloqueado(campo, { estado: '' }), true);
});

/* --------------------------------------------------------------------- */
/* Cómo la usa la credencial                                              */
/* --------------------------------------------------------------------- */

test('la credencial traba su titular y sus dos fechas al emitirse', () => {
  for (const nombre of ['pastor_id', 'fecha_emision', 'fecha_vencimiento']) {
    const campo = campoDe(nombre);
    assert.ok(campo, `falta el campo ${nombre}`);
    assert.deepEqual(campo.bloqueadoSi, { field: 'estado', salvo: 'Borrador' },
      `${nombre} tiene que trabarse al emitir`);
    assert.ok(!campo.readonly,
      `${nombre} NO es readonly: se escribe a mano mientras es borrador, y de eso se trata`);
  }
});

test('mientras es borrador se pueden escribir, y emitida no', () => {
  const borrador = { estado: 'Borrador' };
  const emitida = { estado: 'Vigente' };
  for (const nombre of ['pastor_id', 'fecha_emision', 'fecha_vencimiento']) {
    assert.equal(estaBloqueado(campoDe(nombre), borrador), false, `${nombre} en un borrador`);
    assert.equal(estaBloqueado(campoDe(nombre), emitida), true, `${nombre} en una emitida`);
  }
});

test('las notas y el motivo se siguen pudiendo escribir siempre', () => {
  /**
   * Es la otra mitad, y la que hace que el arreglo no estorbe: una credencial
   * emitida se anota, y una revocada lleva su motivo. Trabar la ficha entera
   * habría sido cambiar un problema por otro.
   */
  const emitida = { estado: 'Vigente' };
  for (const nombre of ['notas', 'motivo_revocacion']) {
    assert.equal(estaBloqueado(campoDe(nombre), emitida), false, `${nombre} tiene que seguir escribiéndose`);
  }
});

test('el módulo explica POR QUÉ ya no se puede, con el número a la vista', () => {
  /**
   * El motor sabe QUE está trabado; solo el módulo sabe por qué. Sin esto el
   * aviso sería un «no se puede» a secas, que no le dice a nadie qué hacer en
   * su lugar.
   */
  const razon = credenciales.razonDelBloqueo({ serie: '0122026', serie_dv: '3', estado: 'Vigente' });
  assert.match(razon, /0122026-3/, 'nombra la credencial por su número');
  assert.match(razon, /emitida/i);
  assert.match(razon, /se emite una credencial nueva/i, 'dice qué hacer en su lugar');
});

test('y sabe explicarse aunque la credencial no tenga número', () => {
  // No debería pasar —lo trabado empieza al emitir, y emitir da el número—,
  // pero un mensaje de error no puede romperse por un dato en blanco
  const razon = credenciales.razonDelBloqueo({ serie: null, serie_dv: null, estado: 'Revocada' });
  assert.ok(razon && razon.length > 20);
  assert.ok(!razon.includes('N.º null'));
});
