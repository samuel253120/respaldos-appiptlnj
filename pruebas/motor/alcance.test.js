/**
 * Hasta dónde llega cada usuario.
 *
 * Sin iglesias asignadas se ve todo; con algunas, solo esas; y si además se
 * le asignaron cuerpos, dentro de sus iglesias solo lo de esos cuerpos.
 *
 * En este archivo ya aparecieron cuatro agujeros reales, todos de la misma
 * forma: una consulta que no pasaba por acá y entregaba de más. Así que las
 * pruebas insisten en dos cosas que son las que fallan: que **vacío
 * significa todas** (y no «ninguna», que cerraría el sistema) y que la
 * elección de con qué iglesia trabajar **nunca amplía** lo asignado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const alcance = require('../../server/alcance');

/** Un módulo de mentira, con los campos que la lógica mira. */
const modulo = (name, campos = []) => ({ name, fields: campos.map((n) => ({ name: n })) });
const MIEMBROS = modulo('miembros', ['iglesia_id', 'nombres']);
const IGLESIAS = modulo('iglesias', ['nombre']);
const TESORERIA = modulo('tesoreria', ['iglesia_id', 'monto']);
const CUERPOS = modulo('cuerpos', ['iglesia_id', 'nombre']);
const ACTAS = modulo('actas_reuniones', ['iglesia_id', 'cuerpo_id']);

test('leer una lista de ids aguanta cualquier forma', () => {
  assert.deepEqual(alcance.lista('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(alcance.lista([1, 2]), [1, 2]);
  assert.deepEqual(alcance.lista('[]'), []);
  // y lo escrito mal no revienta ni inventa
  for (const roto of [null, undefined, '', 'no es json', '{}', '[null,0,"x"]']) {
    assert.deepEqual(alcance.lista(roto), [], `«${roto}» debería dar lista vacía`);
  }
});

test('sin iglesias asignadas, alcanza todas', () => {
  // Vacío es «todas», no «ninguna». Si se invirtiera, el administrador
  // general se quedaría sin ver nada.
  assert.deepEqual(alcance.iglesiasAsignadas({ iglesias: '[]' }), []);
  assert.equal(alcance.alcanzaIglesia({ iglesias: '[]' }, 7), true);
  assert.equal(alcance.alcanza(MIEMBROS, { id: 1, iglesia_id: 9 }, { iglesias: '[]' }), true);
});

test('la iglesia principal por sí sola NO acota', () => {
  // Fue un error real: tener puesta la iglesia principal contaba como
  // asignación, y el botón para elegir iglesia desaparecía sin motivo.
  const soloPrincipal = { iglesias: '[]', iglesia_id: 3 };
  assert.deepEqual(alcance.iglesiasAsignadas(soloPrincipal), []);
  assert.equal(alcance.alcanzaIglesia(soloPrincipal, 8), true, 'con solo la principal puesta, alcanza a todas');
});

test('la iglesia principal sí cuenta cuando ya está entre las asignadas', () => {
  const u = { iglesias: '[2,5]', iglesia_id: 2 };
  assert.deepEqual(alcance.iglesiasAsignadas(u).sort(), [2, 5]);
});

test('con iglesias asignadas, lo de otra queda afuera', () => {
  const u = { iglesias: '[2,5]' };
  assert.equal(alcance.alcanzaIglesia(u, 2), true);
  assert.equal(alcance.alcanzaIglesia(u, 5), true);
  assert.equal(alcance.alcanzaIglesia(u, 9), false);
  assert.equal(alcance.alcanzaIglesia(u, null), false);
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: 9 }, u), false);
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: 2 }, u), true);
});

test('un registro sin iglesia no es de nadie acotado', () => {
  const u = { iglesias: '[2]' };
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: null }, u), false);
});

test('en el módulo de iglesias, lo que se mira es su propio id', () => {
  const u = { iglesias: '[2,5]' };
  assert.equal(alcance.alcanza(IGLESIAS, { id: 2 }, u), true);
  assert.equal(alcance.alcanza(IGLESIAS, { id: 9 }, u), false);
});

test('elegir con qué iglesia trabajar acota, pero nunca amplía', () => {
  const asignadas = { iglesias: '[2,5]' };
  assert.deepEqual(alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[5]' }), [5], 'acota a la elegida');
  // La parte que importa: elegir una que no le tocó no le sirve de nada
  assert.deepEqual(
    alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[9]' }).sort(),
    [2, 5],
    'elegir una ajena tiene que volver a las suyas, no darle la ajena'
  );
  assert.deepEqual(
    alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[5,9]' }),
    [5],
    'de una elección mixta solo vale la parte que le corresponde'
  );
  assert.deepEqual(alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[]' }).sort(), [2, 5], 'en blanco: todas las suyas');
});

test('quien no tiene ninguna asignada sí puede elegir con cuál trabajar', () => {
  const general = { iglesias: '[]', iglesias_trabajando: '[4]' };
  assert.deepEqual(alcance.iglesiasDe(general), [4]);
});

test('sin cuerpos asignados, alcanza todos', () => {
  const u = { iglesias: '[2]', cuerpos: '[]' };
  assert.deepEqual(alcance.cuerposDe(u), []);
  assert.equal(alcance.alcanzaCuerpo(u, 7), true);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 7 }, u), true);
});

test('con cuerpos asignados, lo de otro cuerpo queda afuera', () => {
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanzaCuerpo(u, 3), true);
  assert.equal(alcance.alcanzaCuerpo(u, 4), false);
  assert.equal(alcance.alcanzaCuerpo(u, null), false);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 3 }, u), true);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 4 }, u), false);
  assert.equal(alcance.alcanza(CUERPOS, { id: 3, iglesia_id: 2 }, u), true);
  assert.equal(alcance.alcanza(CUERPOS, { id: 4, iglesia_id: 2 }, u), false);
});

test('la iglesia manda antes que el cuerpo', () => {
  // Aunque el cuerpo sea de los suyos, si la iglesia no lo es, no alcanza
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 9, cuerpo_id: 3 }, u), false);
});

test('una asistencia se alcanza si convoca a alguno de sus cuerpos', () => {
  const ASISTENCIAS = modulo('asistencias', ['iglesia_id', 'cuerpos']);
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[3,4]' }, u), true);
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[4,5]' }, u), false);
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[]' }, u), false);
});

test('una fila que no existe nunca se alcanza', () => {
  assert.equal(alcance.alcanza(MIEMBROS, null, { iglesias: '[]' }), false);
  assert.equal(alcance.alcanza(MIEMBROS, undefined, { iglesias: '[]' }), false);
});

test('la iglesia por omisión es la principal, o la única que tenga', () => {
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[2,5]', iglesia_id: 5 }), 5);
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[7]' }), 7, 'con una sola, es esa');
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[2,5]' }), null, 'con varias y sin principal, ninguna');
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[]' }), null);
});

test('las condiciones SQL llevan sus parámetros en orden', () => {
  const params = [];
  const sql = alcance.condiciones(TESORERIA, { iglesias: '[2,5]' }, params);
  assert.match(sql, /iglesia_id IN \(\?,\?\)/);
  assert.deepEqual(params, [2, 5]);
});

test('sin nada asignado no se agrega ninguna condición', () => {
  const params = [];
  assert.equal(alcance.condiciones(TESORERIA, { iglesias: '[]', cuerpos: '[]' }, params), null);
  assert.deepEqual(params, []);
});

test('un usuario que no existe no alcanza nada', () => {
  assert.deepEqual(alcance.iglesiasAsignadas(null), []);
  assert.deepEqual(alcance.cuerposDe(null), []);
  assert.deepEqual(alcance.iglesiasDe(null), []);
});
