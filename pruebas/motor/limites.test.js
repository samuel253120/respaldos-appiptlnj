/**
 * Los límites de los números y del dinero.
 *
 * Se comprobó, atacando el sistema andando, que se podía guardar un ingreso
 * de −50.000 y otro de 1e308, y que después de eso el balance de la iglesia
 * respondía «1e+308»: no es que quedara grande, es que dejaba de ser un
 * número con el que se pueda trabajar. Un tesorero que teclee un signo menos
 * o un dígito de más descuadraba los libros sin que nada avisara.
 *
 * Estas pruebas fijan el criterio, que no es el mismo para todos los campos:
 * un movimiento de dinero tiene que ser mayor que cero, pero el saldo inicial
 * de una cuenta sí puede ser negativo —hay cuentas que parten en rojo— y una
 * cuota puede ser cero si se le condona a alguien.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { revisarLimites, TECHO } = require('../../server/crud');

const dinero = (extra = {}) => ({ label: 'Monto', type: 'money', ...extra });
const numero = (extra = {}) => ({ label: 'Cantidad', type: 'number', ...extra });

test('un movimiento de dinero tiene que ser mayor que cero', () => {
  const campo = dinero({ min: 1 });
  assert.match(revisarLimites(campo, -50000), /mayor que cero/);
  assert.match(revisarLimites(campo, 0), /mayor que cero/);
  assert.equal(revisarLimites(campo, 1), null);
  assert.equal(revisarLimites(campo, 1250000), null);
});

test('y a quien escribe un negativo se le dice qué hacer en su lugar', () => {
  // El consejo va donde sirve: casi siempre lo que quería era un egreso
  assert.match(revisarLimites(dinero({ min: 1 }), -50000), /anótelo como egreso/);
  // Pero no donde no viene al caso: el valor de un bien no es un egreso
  assert.doesNotMatch(revisarLimites(dinero({ min: 0 }), -1000), /egreso/);
});

test('lo que puede ser cero pero no negativo', () => {
  const campo = dinero({ min: 0 });
  assert.match(revisarLimites(campo, -1), /no puede ser negativo/);
  assert.equal(revisarLimites(campo, 0), null, 'cero es válido: una cuota condonada, un cuerpo que no cobra');
  assert.equal(revisarLimites(campo, 5000), null);
});

test('un campo sin mínimo declarado admite negativos', () => {
  // Es el caso del saldo inicial: hay cuentas que parten en rojo
  assert.equal(revisarLimites(dinero(), -100000), null);
});

test('ningún número pasa del techo, lo declare o no el campo', () => {
  for (const valor of [1e308, 999999999999999, TECHO + 1]) {
    assert.match(revisarLimites(dinero(), valor), /imposible/, `${valor} debería rechazarse`);
    assert.match(revisarLimites(numero(), valor), /imposible/);
  }
  assert.equal(revisarLimites(dinero(), TECHO), null, 'el techo mismo se acepta');
});

test('un número enorme no se escribe entero en el aviso', () => {
  // 1e308 son 309 dígitos: escribirlos llenaría la pantalla y no diría nada
  const aviso = revisarLimites(dinero(), 1e308);
  assert.ok(aviso.length < 120, `el aviso mide ${aviso.length} caracteres`);
  assert.match(aviso, /un número enorme/);
});

test('lo que no es un número se rechaza como tal', () => {
  for (const basura of [NaN, Infinity, -Infinity, 'mil pesos']) {
    assert.match(revisarLimites(dinero(), basura), /tiene que ser un número/, `${basura} debería rechazarse`);
  }
});

test('un máximo declarado se respeta y se dice cuál es', () => {
  const campo = numero({ min: 0, max: 60 });
  assert.equal(revisarLimites(campo, 60), null);
  assert.match(revisarLimites(campo, 61), /no puede pasar de 60/);
  assert.match(revisarLimites(campo, -1), /no puede ser negativo/);
});

test('el aviso dice el límite, no solo que está mal', () => {
  // Quien está anotando una ofrenda necesita saber qué se espera de él
  assert.match(revisarLimites(numero({ min: 10 }), 5), /no puede ser menor que 10/);
  assert.match(revisarLimites(numero({ max: 1000 }), 5000), /no puede pasar de 1\.000/);
});

test('los campos de dinero del sistema tienen el límite que les corresponde', () => {
  const { allModules } = require('../../server/registry');
  const campoDe = (modulo, nombre) => {
    const m = allModules().find((x) => x.name === modulo);
    return m && m.fields.find((f) => f.name === nombre);
  };
  // Los que mueven plata: mayores que cero
  for (const [modulo, nombre] of [['tesoreria', 'monto'], ['traspasos', 'monto']]) {
    assert.equal(campoDe(modulo, nombre).min, 1, `${modulo}.${nombre} debería exigir mayor que cero`);
  }
  // Los que pueden ser cero pero no negativos
  for (const [modulo, nombre] of [
    ['cuotas_cuerpo', 'monto'], ['cuerpos', 'cuota_mensual'],
    ['ayudas_sociales', 'valor_estimado'], ['inventarios', 'valor_estimado'], ['servicios', 'ofrenda_total'],
    // La asistencia de un servicio: se guardaba «menos treinta adultos» y el
    // total general, que se suma solo, quedaba en menos treinta
    ['servicios', 'asistencia_adultos'], ['servicios', 'asistencia_ninos'],
  ]) {
    assert.equal(campoDe(modulo, nombre).min, 0, `${modulo}.${nombre} no debería admitir negativos`);
  }
  // Y el que sí puede ser negativo, a propósito
  assert.equal(campoDe('cuentas_tesoreria', 'saldo_inicial').min, undefined,
    'el saldo inicial puede ser negativo: hay cuentas que parten en rojo');
});
