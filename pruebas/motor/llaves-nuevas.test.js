/**
 * Las cuatro llaves nuevas: qué separan y qué NO cambian.
 *
 * Todas nacen del mismo problema: había acciones que iban pegadas a otra cosa
 * —a un permiso más grande, o al rol de administrador escrito dentro del
 * código— y no se podían conceder por separado. Eso obliga a hacer
 * administrador de todo a quien solo tenía que hacer una cosa.
 *
 * LO QUE ESTAS PRUEBAS CUIDAN, sobre todo, es que **nada cambie para nadie**
 * mientras alguien no toque los permisos a propósito. Una llave nueva que
 * llegue quitando algo que la gente ya hacía se descubre el lunes por la
 * mañana, con la iglesia entera sin poder trabajar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { LLAVES, ROLES, permisosDelRol, todoLoQueSePuedePermitir } = require('../../server/permissions');

/** ROLES viene con etiqueta para la pantalla; acá solo hacen falta los nombres. */
const LOS_ROLES = ROLES.map((r) => r.value);
const miembros = require('../../server/modules/miembros');
const pastores = require('../../server/modules/pastores');
const noMiembros = require('../../server/modules/no_miembros');

const NUEVAS = ['sistema_mantenimiento', 'miembros_identidad', 'datos_impresion', 'solicitudes_tramitar'];
const laLlave = (n) => LLAVES.find((l) => l.name === n);

// ------------------------------------------------------------ que existan bien

test('las cuatro están declaradas y aparecen en el editor de permisos', () => {
  const enElEditor = todoLoQueSePuedePermitir().map((x) => x.name);
  for (const n of NUEVAS) {
    assert.ok(laLlave(n), `${n} no está declarada`);
    assert.ok(enElEditor.includes(n), `${n} no se puede conceder desde ninguna pantalla`);
  }
});

test('cada una explica qué concede, con suficiente detalle', () => {
  for (const n of NUEVAS) {
    assert.ok(laLlave(n).ayuda.length > 100, `${n} se explica en una línea: no alcanza para decidir`);
  }
});

// -------------------------------------------- que no le quiten nada a nadie

test('las que separan algo que ya se hacía vienen dadas a TODOS', () => {
  // Ver el RUT e imprimir los hacía cualquiera. Si llegaran apagadas, el lunes
  // media iglesia no puede trabajar y nadie entendería por qué.
  for (const n of ['miembros_identidad', 'datos_impresion']) {
    assert.equal(laLlave(n).defecto, 'todos', `${n} tiene que venir concedida`);
    for (const rol of LOS_ROLES) {
      assert.deepEqual(permisosDelRol(rol, n), laLlave(n).acciones, `${rol} perdería ${n}`);
    }
  }
});

test('las que restringen algo vienen solo para el administrador', () => {
  // El mantenimiento y tramitar solicitudes de otros los hacía únicamente el
  // administrador, así que de fábrica siguen siendo suyos y de nadie más.
  for (const n of ['sistema_mantenimiento', 'solicitudes_tramitar']) {
    assert.deepEqual(permisosDelRol('admin', n), laLlave(n).acciones, `el administrador perdería ${n}`);
    for (const rol of LOS_ROLES.filter((r) => r !== 'admin')) {
      assert.deepEqual(permisosDelRol(rol, n), [], `${rol} no debería traer ${n} de fábrica`);
    }
  }
});

test('el mantenimiento sale de la llave de configuración, pero el admin conserva ambas', () => {
  // Separarlas no puede significar que el administrador pierda una.
  assert.ok(permisosDelRol('admin', 'sistema_configuracion').length);
  assert.ok(permisosDelRol('admin', 'sistema_mantenimiento').length);
  for (const rol of LOS_ROLES.filter((r) => r !== 'admin')) {
    assert.deepEqual(permisosDelRol(rol, 'sistema_mantenimiento'), []);
  }
});

// ------------------------------------ el RUT y la fecha, marcados donde toca

test('el RUT y la fecha de nacimiento quedan reservados en los tres registros', () => {
  for (const [modulo, def] of [['miembros', miembros], ['pastores', pastores], ['no_miembros', noMiembros]]) {
    for (const campo of ['rut', 'fecha_nacimiento']) {
      const f = def.fields.find((x) => x.name === campo);
      assert.ok(f, `${modulo} no tiene el campo ${campo}`);
      assert.equal(f.reservado, 'miembros_identidad',
        `${modulo}.${campo} quedó sin reservar: lo vería cualquiera`);
    }
  }
});

test('y no se pisó lo que ya estaba reservado por otra llave', () => {
  // El teléfono, el correo y la dirección son de «miembros_contacto»; la salud,
  // de la suya. Marcar el RUT no puede haberles cambiado la llave.
  for (const campo of ['telefono', 'email', 'direccion']) {
    const f = miembros.fields.find((x) => x.name === campo);
    assert.equal(f.reservado, 'miembros_contacto', `${campo} cambió de llave`);
  }
});

test('los dos grupos de datos reservados son independientes', () => {
  const conIdentidad = miembros.fields.filter((f) => f.reservado === 'miembros_identidad').map((f) => f.name);
  const conContacto = miembros.fields.filter((f) => f.reservado === 'miembros_contacto').map((f) => f.name);
  assert.deepEqual(conIdentidad.sort(), ['fecha_nacimiento', 'rut']);
  assert.ok(conContacto.length >= 3);
  assert.equal(conIdentidad.filter((x) => conContacto.includes(x)).length, 0, 'ningún campo puede estar en las dos');
});

// ------------------------------------------------- que digan la verdad

test('la llave de imprimir advierte de lo que NO puede impedir', () => {
  // La hoja se arma en el navegador con datos que la persona ya ve, así que
  // quitar la llave saca el camino normal pero no la impresión del navegador.
  // Una llave que prometa más de lo que da es peor que no tenerla: alguien
  // dejaría a la vista un dato creyéndolo protegido.
  const ayuda = laLlave('datos_impresion').ayuda.toLowerCase();
  assert.ok(ayuda.includes('no puede') || ayuda.includes('no impide'),
    'tiene que decir que no es una barrera, o alguien va a confiar de más en ella');
});

test('ninguna de las nuevas ofrece eliminar', () => {
  for (const n of NUEVAS) {
    assert.ok(!laLlave(n).acciones.includes('delete'), `${n} ofrece borrar algo que no se borra`);
  }
});
