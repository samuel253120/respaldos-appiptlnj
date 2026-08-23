/**
 * Quién puede hacer qué.
 *
 * Los permisos se resuelven en tres escalones, de lo más particular a lo más
 * general: las excepciones de la persona, el perfil que tenga asignado y su
 * rol. Cada escalón manda solo en los módulos donde diga algo.
 *
 * Es la clase de lógica en la que un error no se ve: todo sigue funcionando
 * y alguien queda pudiendo lo que no debía. Por eso se prueba escalón por
 * escalón, y sobre todo el caso que importa —una excepción que QUITA algo—,
 * porque un orden mal puesto lo devolvería sin que nadie lo notara.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./aislada').exigirBaseDescartable(); // esta prueba escribe: nunca sobre la base de verdad
const permisos = require('../../server/permissions');
const { db } = require('../../server/db');

test('el administrador puede todo, incluidos los usuarios', () => {
  for (const accion of ['view', 'create', 'edit', 'delete']) {
    assert.equal(permisos.can({ rol: 'admin' }, 'usuarios', accion), true);
    assert.equal(permisos.can({ rol: 'admin' }, 'tesoreria', accion), true);
  }
});

test('el pastor puede todo menos administrar usuarios', () => {
  assert.equal(permisos.can({ rol: 'pastor' }, 'miembros', 'edit'), true);
  assert.equal(permisos.can({ rol: 'pastor' }, 'tesoreria', 'edit'), true);
  assert.equal(permisos.can({ rol: 'pastor' }, 'usuarios', 'edit'), false);
});

test('el secretario no entra a la tesorería', () => {
  assert.equal(permisos.can({ rol: 'secretario' }, 'miembros', 'create'), true);
  assert.equal(permisos.can({ rol: 'secretario' }, 'tesoreria', 'view'), false);
  assert.equal(permisos.can({ rol: 'secretario' }, 'tesoreria', 'create'), false);
});

test('quien solo consulta, no escribe en ninguna parte', () => {
  assert.equal(permisos.can({ rol: 'consulta' }, 'miembros', 'view'), true);
  for (const accion of ['create', 'edit', 'delete']) {
    assert.equal(permisos.can({ rol: 'consulta' }, 'miembros', accion), false, `no debería poder ${accion}`);
  }
});

test('un rol que no existe no puede nada', () => {
  // Importa: si un día llega un rol escrito mal, tiene que cerrar, no abrir
  for (const rol of ['inventado', '', null, undefined]) {
    assert.equal(permisos.can({ rol }, 'miembros', 'view'), false, `«${rol}» no debería alcanzar nada`);
  }
});

test('acepta que le pasen solo el nombre del rol', () => {
  assert.equal(permisos.can('admin', 'usuarios', 'edit'), true);
  assert.equal(permisos.can('consulta', 'miembros', 'edit'), false);
});

test('una excepción de la persona le da lo que el rol le niega', () => {
  const secretarioConTesoreria = { rol: 'secretario', permisos: JSON.stringify({ tesoreria: ['view'] }) };
  assert.equal(permisos.can(secretarioConTesoreria, 'tesoreria', 'view'), true);
  // y solo eso: lo que la excepción no nombra, sigue negado
  assert.equal(permisos.can(secretarioConTesoreria, 'tesoreria', 'edit'), false);
});

test('una excepción también QUITA lo que el rol le daba', () => {
  // El caso delicado: si el orden estuviera mal, el rol se lo devolvería
  const pastorSinBorrar = { rol: 'pastor', permisos: JSON.stringify({ miembros: ['view'] }) };
  assert.equal(permisos.can(pastorSinBorrar, 'miembros', 'view'), true);
  assert.equal(permisos.can(pastorSinBorrar, 'miembros', 'delete'), false, 'la excepción tiene que ganarle al rol');
  // y en los módulos que la excepción no nombra, el rol sigue mandando
  assert.equal(permisos.can(pastorSinBorrar, 'tesoreria', 'edit'), true);
});

test('una excepción vacía cierra ese módulo del todo', () => {
  const sinTesoreria = { rol: 'admin', permisos: JSON.stringify({ tesoreria: [] }) };
  assert.equal(permisos.can(sinTesoreria, 'tesoreria', 'view'), false);
  assert.equal(permisos.can(sinTesoreria, 'miembros', 'view'), true);
});

test('unas excepciones escritas mal no abren nada: manda el rol', () => {
  for (const roto of ['{esto no es json', '[]', 'null', '', '{"miembros": "todo"}']) {
    const u = { rol: 'consulta', permisos: roto };
    assert.equal(permisos.can(u, 'miembros', 'edit'), false, `con «${roto}» no debería poder editar`);
    assert.equal(permisos.can(u, 'miembros', 'view'), true, `con «${roto}» debería seguir viendo`);
  }
});

test('el perfil manda sobre el rol, y la excepción sobre el perfil', () => {
  db.prepare('DELETE FROM perfiles_permisos').run();
  const perfil = db
    .prepare('INSERT INTO perfiles_permisos (nombre, permisos) VALUES (?, ?)')
    .run('Solo mirar miembros', JSON.stringify({ miembros: ['view'], tesoreria: ['view', 'create'] }));
  const id = perfil.lastInsertRowid;

  // 1) el perfil le quita a un pastor lo que su rol le daba
  const conPerfil = { rol: 'pastor', perfil_id: id };
  assert.equal(permisos.can(conPerfil, 'miembros', 'delete'), false, 'el perfil tiene que ganarle al rol');
  assert.equal(permisos.can(conPerfil, 'tesoreria', 'create'), true);
  // en lo que el perfil no nombra, sigue mandando el rol
  assert.equal(permisos.can(conPerfil, 'actas_reuniones', 'edit'), true);

  // 2) y su excepción le gana al perfil
  const conLasDos = { rol: 'pastor', perfil_id: id, permisos: JSON.stringify({ miembros: ['view', 'delete'] }) };
  assert.equal(permisos.can(conLasDos, 'miembros', 'delete'), true, 'la excepción tiene que ganarle al perfil');
  // y en lo que la excepción no nombra, sigue mandando el perfil
  assert.equal(permisos.can(conLasDos, 'tesoreria', 'edit'), false);

  db.prepare('DELETE FROM perfiles_permisos WHERE id = ?').run(id);
});

test('un perfil que ya no existe no deja a nadie sin nada: vuelve el rol', () => {
  const fantasma = { rol: 'secretario', perfil_id: 999999 };
  assert.equal(permisos.can(fantasma, 'miembros', 'edit'), true);
  assert.equal(permisos.can(fantasma, 'tesoreria', 'view'), false);
});

test('permisosEfectivos dice de dónde sale cada uno', () => {
  const u = { rol: 'secretario', permisos: JSON.stringify({ tesoreria: ['view'] }) };
  const efectivos = permisos.permisosEfectivos(u, ['tesoreria', 'miembros']);
  assert.equal(efectivos.tesoreria.origen, 'excepcion');
  assert.deepEqual(efectivos.tesoreria.acciones, ['view']);
  assert.equal(efectivos.miembros.origen, 'rol');
});
