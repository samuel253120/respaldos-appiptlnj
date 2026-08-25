/**
 * Lo que viene después del «?» en una dirección.
 *
 * POR QUÉ EXISTE ESTA SUITE. Una dirección puede traer la misma clave dos
 * veces —`?q=a&q=b`— y hasta la 1.96.3 eso entregaba una lista donde el resto
 * del sistema esperaba un texto. Resultado: error 500 en TODOS los listados,
 * porque a una lista no se le puede pedir `.trim()` ni pasársela a la base
 * donde va un valor. Cualquiera con sesión dejaba a los demás sin listados
 * escribiendo una dirección a mano.
 *
 * Estas pruebas fijan la forma de la respuesta —un texto por clave, siempre—
 * porque de eso dependen los treinta y dos sitios del servidor que leen algo
 * de la dirección sin volver a comprobarlo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { leerLaConsulta } = require('../../server/consulta');

test('lo normal se lee como siempre', () => {
  assert.equal(leerLaConsulta('q=rosa').q, 'rosa');
  assert.equal(leerLaConsulta('page=2&limit=50').page, '2');
  assert.equal(leerLaConsulta('page=2&limit=50').limit, '50');
});

test('la clave repetida vale la primera, no una lista', () => {
  const r = leerLaConsulta('q=a&q=b&q=c');
  assert.equal(r.q, 'a');
  assert.ok(!Array.isArray(r.q), 'nunca puede llegar una lista');
});

test('NINGÚN valor es una lista, pase lo que pase', () => {
  // Es la propiedad de la que dependen los treinta y dos sitios que leen algo
  // de la dirección. Se comprueba como propiedad y no caso por caso.
  const direcciones = [
    'q=a&q=b', 'f_estado=A&f_estado=B&f_estado=C', 'desde=1&hasta=2&desde=3',
    'sort=a&sort=b&dir=asc&dir=desc', 'sin=email&sin=telefono',
    'a=1&a=2&a=3&a=4&a=5', 'x=&x=', 'q', 'q=&q=b',
  ];
  for (const cadena of direcciones) {
    const r = leerLaConsulta(cadena);
    for (const clave of Object.keys(r)) {
      assert.equal(typeof r[clave], 'string', `«${cadena}» dejó ${clave} sin ser un texto`);
    }
  }
});

test('los corchetes quedan dentro del nombre de la clave, no arman un objeto', () => {
  // Con el analizador que trae Express por omisión, esto llegaba como un
  // objeto anidado y el sistema terminaba pasándoselo a la base.
  const r = leerLaConsulta('f_estado[x]=1');
  assert.equal(r['f_estado[x]'], '1');
  assert.equal(r.f_estado, undefined, 'no puede aparecer un campo que nadie pidió');
  assert.equal(typeof r['f_estado[x]'], 'string');
});

test('una clave llamada «__proto__» es solo una clave', () => {
  const r = leerLaConsulta('__proto__=roto&q=hola');
  assert.equal(r.q, 'hola');
  assert.equal(({}).roto, undefined, 'no puede haber tocado nada de lo que hay detrás');
  assert.equal(Object.getPrototypeOf(r), null, 'los datos vienen sin prototipo, a propósito');
});

test('lo vacío y lo que falta no rompen nada', () => {
  assert.deepEqual(Object.keys(leerLaConsulta('')), []);
  assert.deepEqual(Object.keys(leerLaConsulta(null)), []);
  assert.deepEqual(Object.keys(leerLaConsulta(undefined)), []);
  assert.equal(leerLaConsulta('q=').q, '');
  assert.equal(leerLaConsulta('q').q, '');
});

test('los acentos y los signos llegan enteros', () => {
  assert.equal(leerLaConsulta('q=Mu%C3%B1oz').q, 'Muñoz');
  assert.equal(leerLaConsulta('q=a%26b').q, 'a&b');
  assert.equal(leerLaConsulta('q=%20hola%20').q, ' hola ');
});
