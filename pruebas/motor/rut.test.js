/**
 * El RUT es el usuario de acceso y el que impide registrar dos veces a la
 * misma persona. Un error acá no se ve: alguien que existe queda afuera, o
 * dos fichas de la misma persona conviven sin que nadie se dé cuenta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rut = require('../../server/rut');

test('acepta un RUT bien escrito, con puntos o sin ellos', () => {
  for (const escrito of ['11.111.111-1', '11111111-1', '111111111']) {
    assert.equal(rut.validar(escrito), true, `debería aceptar «${escrito}»`);
  }
});

test('acepta el dígito K, en mayúscula o minúscula', () => {
  assert.equal(rut.validar('8888888-K'), true);
  assert.equal(rut.validar('8888888-k'), true);
});

test('rechaza un dígito verificador que no corresponde', () => {
  // Es el caso que importa: un número que parece un RUT pero no lo es
  assert.equal(rut.validar('11111111-2'), false);
  assert.equal(rut.validar('12345678-9'), false);
});

test('rechaza lo que no es un RUT', () => {
  for (const basura of ['', null, undefined, 'hola', '123', '1234567890123', 'AB123456-7']) {
    assert.equal(rut.validar(basura), false, `no debería aceptar ${JSON.stringify(basura)}`);
  }
});

test('el dígito verificador se calcula como manda la regla', () => {
  // Casos conocidos, calculados aparte: si el algoritmo se toca, esto avisa
  assert.equal(rut.digitoVerificador('11111111'), '1');
  assert.equal(rut.digitoVerificador('8888888'), 'K');
  assert.equal(rut.digitoVerificador('3231140'), '7');
  assert.equal(rut.digitoVerificador('15555555'), '6');
});

test('la forma canónica es siempre la misma, se escriba como se escriba', () => {
  const mismo = ['11.111.111-1', '11111111-1', '111111111', ' 11.111.111-1 '];
  const canonicos = new Set(mismo.map((e) => rut.canonico(e)));
  assert.equal(canonicos.size, 1, `salieron formas distintas: ${[...canonicos].join(', ')}`);
  assert.equal([...canonicos][0], '11111111-1');
});

test('la K queda siempre en mayúscula al guardarse', () => {
  assert.equal(rut.canonico('8888888-k'), '8888888-K');
});

test('al mostrarlo se le ponen los puntos y el guion', () => {
  assert.equal(rut.formatear('11111111-1'), '11.111.111-1');
  assert.equal(rut.formatear('3231140-7'), '3.231.140-7');
});

test('formatear y canonizar son ida y vuelta', () => {
  for (const uno of ['11111111-1', '3231140-7', '8888888-K']) {
    assert.equal(rut.canonico(rut.formatear(uno)), uno);
  }
});
