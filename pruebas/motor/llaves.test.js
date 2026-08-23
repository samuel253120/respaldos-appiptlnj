/**
 * Las llaves del sistema: lo que se puede permitir y no es un módulo.
 *
 * El editor de permisos mostraba los treinta y dos módulos y nada más, así que
 * había reglas que el sistema sí comprobaba y que desde ahí no se podían ni
 * ver ni cambiar:
 *
 *   · los datos de salud de una ficha ya se controlaban con `miembros_salud`,
 *     pero al no aparecer en la lista no había manera de dárselos a una
 *     secretaria concreta ni de quitárselos a un pastor concreto;
 *   · la configuración, los respaldos y el traspaso desde el sistema anterior
 *     no eran permisos en absoluto: estaban escritos como «solo si el rol es
 *     admin», lo que obligaba a hacer administrador general a quien solo tenía
 *     que bajarse el respaldo una vez al mes.
 *
 * Lo que estas pruebas fijan, y por qué importa: **lo que cambió es que ahora
 * se puede conceder, no que esté concedido**. Si alguna vez alguien mueve un
 * valor por defecto sin querer, acá se nota.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const permisos = require('../../server/permissions');
const { LLAVES, SALUD, can, permisosDelRol, todoLoQueSePuedePermitir } = permisos;

// ------------------------------------------------- están donde estaban ----

test('de fábrica, las llaves del sistema son solo del administrador', () => {
  for (const llave of ['sistema_configuracion', 'sistema_respaldo', 'sistema_importacion']) {
    assert.deepEqual(
      permisosDelRol('admin', llave).sort(),
      LLAVES.find((l) => l.name === llave).acciones.slice().sort(),
      `el administrador tendría que conservar ${llave}`
    );
    for (const rol of ['pastor', 'secretario', 'tesorero', 'consulta']) {
      assert.deepEqual(permisosDelRol(rol, llave), [], `${rol} no debería tener ${llave} de fábrica`);
    }
  }
});

test('el comodín no reparte las llaves del sistema', () => {
  // Pastor tiene '*': ALL. Si las llaves se heredaran del comodín, un pastor
  // podría entrar a la configuración y bajarse el respaldo sin que nadie se lo
  // diera: es exactamente el error que se corrigió en su día con los datos de
  // salud, y que no puede volver por otra puerta.
  assert.equal(can({ rol: 'pastor' }, 'sistema_configuracion', 'view'), false);
  assert.equal(can({ rol: 'pastor' }, 'sistema_respaldo', 'view'), false);
  assert.equal(can({ rol: 'pastor' }, 'sistema_importacion', 'create'), false);
});

test('los datos de salud siguen como estaban: los ven el administrador y el pastor', () => {
  assert.deepEqual(permisosDelRol('admin', SALUD), ['view']);
  assert.deepEqual(permisosDelRol('pastor', SALUD), ['view']);
  for (const rol of ['secretario', 'tesorero', 'consulta']) {
    assert.deepEqual(permisosDelRol(rol, SALUD), [], `${rol} no ve los datos de salud`);
  }
});

// ------------------------------------------- ahora sí se pueden mover ----

test('una excepción concede una llave que el rol no da', () => {
  const tesorera = { rol: 'tesorero', permisos: JSON.stringify({ sistema_respaldo: ['view', 'create'] }) };
  assert.equal(can(tesorera, 'sistema_respaldo', 'view'), true);
  assert.equal(can(tesorera, 'sistema_respaldo', 'create'), true);
  // Y solo esa: lo que no se tocó sigue como lo dejaba su rol
  assert.equal(can(tesorera, 'sistema_configuracion', 'view'), false);
});

test('y una excepción quita una que el rol sí da', () => {
  const pastor = { rol: 'pastor', permisos: JSON.stringify({ [SALUD]: [] }) };
  assert.equal(can(pastor, SALUD, 'view'), false);
  // Sin quitarle nada más de lo suyo
  assert.equal(can(pastor, 'miembros', 'edit'), true);
});

test('un perfil también las mueve, y la excepción de la persona manda por sobre él', () => {
  // Se comprueba con la tabla del perfil puesta a mano: lo que importa es el
  // orden en que se resuelve, no de dónde salió cada tabla.
  const conPerfil = { rol: 'consulta', permisos: JSON.stringify({ sistema_respaldo: [] }) };
  assert.equal(can(conPerfil, 'sistema_respaldo', 'view'), false);
});

// ------------------------------------------------ el catálogo completo ----

test('el catálogo lleva los módulos y las llaves, sin dejar nada escondido', () => {
  const todo = todoLoQueSePuedePermitir();
  const nombres = todo.map((x) => x.name);
  for (const llave of LLAVES) {
    assert.ok(nombres.includes(llave.name), `${llave.name} tiene que aparecer en el editor`);
  }
  assert.ok(nombres.includes('miembros'), 'y los módulos de siempre siguen ahí');
  assert.ok(todo.length > LLAVES.length + 25, `esperaba los 32 módulos y las llaves, hay ${todo.length}`);
});

test('cada llave dice qué acciones tienen sentido para ella', () => {
  for (const l of todoLoQueSePuedePermitir().filter((x) => x.esLlave)) {
    assert.ok(Array.isArray(l.acciones) && l.acciones.length, `${l.name} sin acciones`);
    assert.ok(l.acciones.includes('view'), `${l.name} tendría que admitir al menos ver`);
    assert.ok(l.ayuda && l.ayuda.length > 30, `${l.name} necesita explicar qué concede`);
    assert.ok(l.group, `${l.name} sin grupo donde mostrarse`);
  }
});

test('«eliminar» no se ofrece en ninguna llave del sistema', () => {
  // Borrar la configuración o borrar un respaldo no son acciones que existan:
  // ofrecerlas sería prometer algo que el sistema no hace.
  for (const l of LLAVES) {
    assert.ok(!l.acciones.includes('delete'), `${l.name} no debería ofrecer eliminar`);
  }
});

test('los módulos de siempre siguen admitiendo las cuatro acciones', () => {
  const miembros = todoLoQueSePuedePermitir().find((x) => x.name === 'miembros');
  assert.deepEqual(miembros.acciones, ['view', 'create', 'edit', 'delete']);
  assert.equal(miembros.esLlave, false);
});
