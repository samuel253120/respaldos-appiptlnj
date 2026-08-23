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

test('los números llevan la coma decimal que se usa acá', () => {
  assert.equal(planilla.numero(1250000.5), '"1250000,5"');
  assert.equal(planilla.numero(0), '"0"');
  assert.equal(planilla.numero(-25000), '"-25000"');
  assert.equal(planilla.numero(null), '""');
  assert.equal(planilla.numero(''), '""');
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
