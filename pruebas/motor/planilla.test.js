/**
 * La planilla que se baja de cualquier listado.
 *
 * Dos cosas que parecen menores y no lo son: que Excel la abra bien en un
 * computador de acá, y que un dato que alguien escribió no se ejecute como
 * fórmula al abrirla en otra parte.
 *
 * Lo delicado es lo segundo, porque la protección tiene que ser precisa: si
 * se marca de más, los teléfonos con «+» y los montos negativos bajan con un
 * apóstrofo adelante que se ve en la celda; si se marca de menos, queda la
 * puerta abierta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const planilla = require('../../server/planilla');

const sinComillas = (v) => planilla.celda(v).slice(1, -1);

test('una celda normal solo va entre comillas', () => {
  assert.equal(planilla.celda('Pérez Ñuñoa'), '"Pérez Ñuñoa"');
  assert.equal(planilla.celda(''), '""');
  assert.equal(planilla.celda(null), '""');
  assert.equal(planilla.celda(undefined), '""');
});

test('las comillas de adentro se duplican, como manda el formato', () => {
  assert.equal(planilla.celda('El "Coro"'), '"El ""Coro"""');
});

test('una fórmula se marca como texto', () => {
  for (const veneno of ['=1+1', '=HYPERLINK("http://x")', '@SUM(A1)', '\tmalo']) {
    assert.ok(sinComillas(veneno).startsWith("'"), `«${veneno}» debería quedar marcado`);
  }
});

test('un teléfono y un monto negativo NO se marcan', () => {
  // Si se marcaran, el apóstrofo se vería en la celda
  for (const bueno of ['+56959013724', '+56 9 5901 3724', '-25000', '-25.000', '-1,5', '(-5)', '-']) {
    assert.ok(!sinComillas(bueno).startsWith("'"), `«${bueno}» no debería marcarse`);
    assert.equal(sinComillas(bueno), bueno);
  }
});

test('pero un signo seguido de algo que no es número sí se marca', () => {
  for (const veneno of ['+HYPERLINK("http://x","clic")', '-2+3+cmd|"/c calc"', '+A1']) {
    assert.ok(sinComillas(veneno).startsWith("'"), `«${veneno}» debería quedar marcado`);
  }
});

test('los números llevan la coma decimal que se usa acá, y van SIN comillas', () => {
  /*
   * Las comillas son para el texto. Un número entre comillas la planilla puede
   * tomarlo por texto, y ahí no se suma, no se promedia y no se grafica, que es
   * lo primero que alguien hace con una columna de montos. Como el separador de
   * columnas es «;», la coma decimal no confunde a nadie.
   */
  assert.equal(planilla.numero(1250000.5), '1250000,5');
  assert.equal(planilla.numero(0), '0');
  assert.equal(planilla.numero(-25000), '-25000');
  assert.equal(planilla.numero(null), '', 'una casilla vacía se deja vacía, no con dos comillas');
  assert.equal(planilla.numero(''), '');
});

test('un número de verdad nunca queda entre comillas', () => {
  // La regla en una línea, por si alguien vuelve a envolverlos «para que se
  // vean prolijos»: se ven igual, y dejan de poder calcularse.
  for (const n of [0, 1, -1, 0.5, 1250000.5, -25000]) {
    assert.ok(!planilla.numero(n).includes('"'), `${n} salió entre comillas`);
  }
});

test('lo que no es un número se escribe tal cual', () => {
  assert.equal(planilla.numero('no es número'), '"no es número"');
});

test('las columnas salen de la ficha, sin archivos ni contraseñas', () => {
  const def = {
    name: 'prueba',
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text' },
      { name: 'clave', label: 'Contraseña', type: 'password' },
      { name: 'foto', label: 'Foto', type: 'file' },
      { name: 'permisos', label: 'Permisos', type: 'permisos' },
      { name: 'interno', label: 'Interno', type: 'text', oculto: true },
      { name: 'monto', label: 'Monto', type: 'money' },
    ],
  };
  const nombres = planilla.columnasDe(def).map((c) => c.name);
  assert.deepEqual(nombres, ['nombre', 'monto']);
});

test('el archivo se llama por su módulo y por el día', () => {
  const nombre = planilla.nombreDelArchivo({ name: 'miembros' });
  assert.match(nombre, /^miembros-\d{4}-\d{2}-\d{2}\.csv$/);
});

// ───────────────────────────── el teléfono en la planilla (1.97.4) ───
/*
 * En la ficha y en lo que se imprime el teléfono va como se escribió,
 * «+56 9 8765 4321», que es la forma internacional. En la planilla estorba:
 * Excel ve un «+» al principio de la celda y lo toma por el comienzo de una
 * cuenta, así que según la versión y el idioma puede comérselo, dejar el
 * número corrido o mostrar un error donde iba un teléfono.
 *
 * Se saca SOLO en la planilla. El «+» no lleva información que no esté en el
 * resto —el código de país sigue en el 56— y lo guardado no se toca.
 */

test('el teléfono baja a la planilla sin el «+»', () => {
  const campo = { name: 'telefono', label: 'Teléfono', type: 'tel' };
  assert.equal(planilla.valorDe(campo, { telefono: '+56 9 8765 4321' }), '"56 9 8765 4321"');
  assert.equal(planilla.valorDe(campo, { telefono: '+56969089784' }), '"56969089784"');
  assert.equal(planilla.valorDe(campo, { telefono: '(+56) 2 2345 6789' }), '"(56) 2 2345 6789"');
});

test('y sin el «+» ya no hace falta marcarlo como texto', () => {
  // Antes empezaba con «+», y por eso el marcador de fórmulas lo miraba. Ahora
  // empieza con un número y no hay nada que marcar: la celda queda limpia.
  const campo = { name: 'telefono', label: 'Teléfono', type: 'tel' };
  assert.doesNotMatch(planilla.valorDe(campo, { telefono: '+56 9 8765 4321' }), /'/);
});

test('un teléfono que ya venía sin «+» no cambia', () => {
  const campo = { name: 'telefono', label: 'Teléfono', type: 'tel' };
  assert.equal(planilla.valorDe(campo, { telefono: '9 8765 4321' }), '"9 8765 4321"');
  assert.equal(planilla.valorDe(campo, { telefono: '41 222 3344' }), '"41 222 3344"');
});

test('lo vacío sigue vacío', () => {
  const campo = { name: 'telefono', label: 'Teléfono', type: 'tel' };
  assert.equal(planilla.valorDe(campo, { telefono: '' }), '""');
  assert.equal(planilla.valorDe(campo, { telefono: null }), '""');
  assert.equal(planilla.valorDe(campo, {}), '""');
});

test('el «+» solo se saca de los teléfonos, no de cualquier campo', () => {
  // Un «+» en una nota o en un nombre es texto de la persona y se respeta.
  // Y si ese texto empieza con «+», el marcador de fórmulas sigue haciendo lo
  // suyo, que es lo que impide que Excel lo ejecute.
  const nota = { name: 'notas', label: 'Notas', type: 'text' };
  assert.equal(planilla.valorDe(nota, { notas: 'Vino con +2 personas' }), '"Vino con +2 personas"');
  assert.equal(planilla.valorDe(nota, { notas: '+HYPERLINK("x")' }), `"'+HYPERLINK(""x"")"`);
});
