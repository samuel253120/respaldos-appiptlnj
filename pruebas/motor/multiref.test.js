/**
 * Los campos de varios: qué se acepta y qué se rechaza al guardar.
 *
 * POR QUÉ EXISTE ESTA SUITE. Un campo de varios —«Iglesias que administra»,
 * «Cuerpos convocados»— guarda una lista de ids. Hasta la 1.96.1 el código
 * decía, en una línea:
 *
 *     const arr = Array.isArray(value) ? value : [];
 *
 * o sea: cualquier cosa que no fuera una lista se guardaba como lista VACÍA,
 * respondiendo 200 y sin decir nada. Y en «Iglesias que administra», vacío no
 * significa «ninguna»: significa TODAS, como dice la ayuda del propio campo.
 *
 * Así que una restricción mal escrita no fallaba: ABRÍA. Y en silencio. Se
 * comprobó contra el sistema andando: mandando `{"iglesias": "[1]"}` —el texto
 * en vez de la lista— la secretaria pasó de ver los 8 miembros de su iglesia a
 * ver los 12 de las dos, y el sistema respondió 200 OK.
 *
 * Un permiso que se equivoca tiene que equivocarse hacia el lado que cierra, y
 * sobre todo tiene que decirlo. Estas pruebas fijan las dos mitades: que lo
 * legítimo siga entrando —incluida la lista vacía a propósito, que es un valor
 * de verdad— y que lo que no se entiende se rechace en vez de adivinarse.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { coerce } = require('../../server/crud');

/** Un campo de varios cualquiera, como lo declara un módulo. */
const CAMPO = {
  name: 'iglesias',
  label: 'Iglesias que administra',
  type: 'multiref',
  ref: 'iglesias',
};

/** Lo que quedaría guardado, ya leído como lista. */
const guardado = (valor) => JSON.parse(coerce(CAMPO, valor));

/** Se negó a guardar, y dijo por qué. */
function seNiega(valor, queDiga) {
  assert.throws(
    () => coerce(CAMPO, valor),
    (e) => {
      assert.match(e.message, /Iglesias que administra/, 'el aviso tiene que nombrar el campo');
      if (queDiga) assert.match(e.message, queDiga);
      return true;
    },
    `${JSON.stringify(valor)} tendría que rechazarse`
  );
}

// ─────────────────────────────────────────────── lo que sí se acepta ───

test('una lista de ids se guarda tal cual', () => {
  assert.deepEqual(guardado([1, 2, 7]), [1, 2, 7]);
});

test('los números escritos como texto también, que es lo que manda un formulario', () => {
  assert.deepEqual(guardado(['1', '2']), [1, 2]);
});

test('y un texto que sea una lista bien escrita, que es como el sistema la guarda', () => {
  // Es la forma en que el propio sistema la devuelve al leerla, así que un
  // programa que lea y vuelva a guardar no tiene por qué quedar afuera.
  assert.deepEqual(guardado('[1,2]'), [1, 2]);
  assert.deepEqual(guardado('[]'), []);
});

test('la lista vacía a propósito es un valor de verdad y se respeta', () => {
  // Vaciar la asignación es una decisión legítima —«que vea todas»— y tiene
  // que seguir siendo posible. Lo que no puede es pasar sin querer.
  assert.deepEqual(guardado([]), []);
});

test('vaciar el campo desde la pantalla guarda nulo, sin pasar por acá', () => {
  // coerce atiende el vacío y el nulo ANTES del tipo de campo: son la forma de
  // decir «acá no va nada», y no llegan a la conversión de la lista.
  assert.equal(coerce(CAMPO, ''), null);
  assert.equal(coerce(CAMPO, null), null);
});

test('un campo que no viene en la petición no se toca', () => {
  assert.equal(coerce(CAMPO, undefined), undefined);
});

// ──────────────────────────────────────────── lo que ya no se adivina ───

test('lo que no es una lista se rechaza en vez de guardarse vacío', () => {
  // Cada uno de estos daba antes una lista vacía, con 200 y sin aviso.
  for (const valor of ['1]', '1', 'cualquier cosa', 1, 0, true, false, { a: 1 }]) {
    seNiega(valor, /espera una lista/);
  }
});

test('EL CASO QUE SE COMPROBÓ EN VIVO: el texto en vez de la lista', () => {
  // «{"iglesias": "[1]"}» es la equivocación natural de cualquier programa que
  // no sea esta pantalla, y era la que abría el acceso a todas las iglesias.
  // Ahora «"[1]"» se entiende bien —es una lista escrita como texto— y lo que
  // se rechaza es lo que de verdad no se puede interpretar.
  assert.deepEqual(guardado('[1]'), [1]);
  seNiega('1,2', /espera una lista/);
  seNiega('iglesia 1', /espera una lista/);
});

test('una lista con elementos que no son ids también se rechaza', () => {
  // Este era el mismo agujero por otra puerta: ["x","y"] daba lista vacía.
  seNiega(['x', 'y'], /no son un registro/);
  seNiega([1, 'x', null], /no son un registro/);
});

test('ni ceros, ni negativos, ni decimales: un id es un entero positivo', () => {
  seNiega([0], /no son un registro/);
  seNiega([-3], /no son un registro/);
  seNiega([1.5], /no son un registro/);
});

test('el aviso dice cuántos valores están mal y cuáles son', () => {
  assert.throws(
    () => coerce(CAMPO, ['x', 'y', 'z']),
    (e) => {
      assert.match(e.message, /3 valor\(es\)/, 'tiene que decir cuántos');
      assert.match(e.message, /x, y, z/, 'y tiene que decir cuáles');
      return true;
    }
  );
});

test('un rechazo se le muestra a la persona, no se convierte en avería del sistema', () => {
  // El guardado distingue entre «los datos vienen mal» —que se responde con un
  // 400 y su explicación— y «se rompió algo» —que se responde con un número de
  // referencia—. Esto tiene que ser lo primero.
  const { ErrorDeDatos } = require('../../server/crud');
  assert.throws(() => coerce(CAMPO, 'no es una lista'), ErrorDeDatos);
});
