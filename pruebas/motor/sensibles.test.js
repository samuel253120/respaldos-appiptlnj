/**
 * Los datos de salud: quién los ve y quién no.
 *
 * En la ficha de un miembro hay campos marcados como `sensible` —las
 * enfermedades, las alergias, las indicaciones médicas, la nota importante—.
 * Están ahí porque en una actividad hay que saber si alguien es alérgico a la
 * penicilina, no para que circulen.
 *
 * Durante un tiempo esa marca servía solo para que el historial no copiara su
 * contenido: quién los leía no lo decidía nadie, los veía cualquiera que
 * pudiera abrir la ficha. Se comprobó atacando el sistema: un secretario leía
 * «Diabetes tipo 2» y «Penicilina» completas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sensibles = require('../../server/sensibles');
const permisos = require('../../server/permissions');

const MIEMBROS = {
  name: 'miembros',
  fields: [
    { name: 'nombres' }, { name: 'apellidos' }, { name: 'telefono' },
    { name: 'enfermedades', sensible: true },
    { name: 'alergias', sensible: true },
    { name: 'nota_importante', sensible: true },
  ],
};
const ficha = () => ({
  id: 42, nombres: 'Ana', apellidos: 'Díaz', telefono: '+56911112222',
  enfermedades: 'Diabetes tipo 2', alergias: 'Penicilina', nota_importante: 'Reservado',
});

test('el administrador y el pastor los ven', () => {
  for (const rol of ['admin', 'pastor']) {
    assert.equal(sensibles.alcanza({ rol }), true, `${rol} debería verlos`);
  }
});

test('el secretario, el tesorero y quien solo consulta, no', () => {
  for (const rol of ['secretario', 'tesorero', 'consulta']) {
    assert.equal(sensibles.alcanza({ rol }), false, `${rol} no debería verlos`);
  }
});

test('el comodín de la matriz no se los regala a nadie', () => {
  // Fue el primer intento y estaba mal: como el secretario tiene '*': ['view'],
  // heredaba el permiso y seguía viéndolo todo. Tiene que estar escrito rol
  // por rol.
  assert.equal(permisos.can({ rol: 'secretario' }, permisos.SALUD, 'view'), false);
  assert.equal(permisos.can({ rol: 'consulta' }, permisos.SALUD, 'view'), false);
  assert.equal(permisos.can({ rol: 'admin' }, permisos.SALUD, 'view'), true);
});

test('la propia persona ve los suyos, sea cual sea su rol', () => {
  const ella = { rol: 'consulta', miembro_id: 42 };
  assert.equal(sensibles.alcanza(ella, ficha()), true, 'son suyos antes que de la iglesia');
  // Pero solo los suyos: los de otro, no
  assert.equal(sensibles.alcanza(ella, { ...ficha(), id: 99 }), false);
});

test('se le pueden dar a alguien más sin cambiarle el rol', () => {
  const conPermiso = { rol: 'secretario', permisos: JSON.stringify({ [permisos.SALUD]: ['view'] }) };
  assert.equal(sensibles.alcanza(conPermiso), true);
});

test('y también se le pueden quitar a quien los tendría por su rol', () => {
  const sinPermiso = { rol: 'pastor', permisos: JSON.stringify({ [permisos.SALUD]: [] }) };
  assert.equal(sensibles.alcanza(sinPermiso), false, 'la excepción manda sobre el rol');
});

test('a quien no los alcanza se le quitan de la ficha', () => {
  const limpia = sensibles.limpiar(MIEMBROS, ficha(), { rol: 'secretario' });
  assert.equal(limpia.enfermedades, undefined);
  assert.equal(limpia.alergias, undefined);
  assert.equal(limpia.nota_importante, undefined);
  assert.equal(limpia.nombres, 'Ana', 'lo demás de la ficha se ve igual');
  assert.equal(limpia.telefono, '+56911112222');
});

test('se quitan del todo, no se mandan en blanco', () => {
  // Un campo vacío se lee como «no tiene ninguna alergia», y eso es peor que
  // no decir nada. Por eso la ficha avisa que hay algo que no se muestra.
  const limpia = sensibles.limpiar(MIEMBROS, ficha(), { rol: 'secretario' });
  assert.equal('alergias' in limpia, false, 'el campo no tiene que venir siquiera');
  assert.equal(limpia.salud_oculta, true, 'y la pantalla tiene con qué avisarlo');
});

test('a quien sí los alcanza no se le toca nada', () => {
  const igual = sensibles.limpiar(MIEMBROS, ficha(), { rol: 'admin' });
  assert.equal(igual.alergias, 'Penicilina');
  assert.equal(igual.salud_oculta, undefined, 'no hay nada que avisar');
});

test('quien no los ve tampoco los escribe', () => {
  // Si no, le bastaría con abrir la ficha y guardar para dejar en blanco un
  // dato que ni siquiera vio.
  const loQueMando = { telefono: '+56999998888', alergias: '', enfermedades: null };
  sensibles.protegerAlGuardar(MIEMBROS, loQueMando, { rol: 'secretario' }, ficha());
  assert.equal('alergias' in loQueMando, false, 'no puede borrarlas');
  assert.equal('enfermedades' in loQueMando, false);
  assert.equal(loQueMando.telefono, '+56999998888', 'pero su cambio legítimo sigue');
});

test('quien sí los ve, sí los escribe', () => {
  const loQueMando = { alergias: 'Ninguna conocida' };
  sensibles.protegerAlGuardar(MIEMBROS, loQueMando, { rol: 'pastor' }, ficha());
  assert.equal(loQueMando.alergias, 'Ninguna conocida');
});

test('un módulo sin campos sensibles no se ve afectado', () => {
  const TESORERIA = { name: 'tesoreria', fields: [{ name: 'monto' }, { name: 'concepto' }] };
  const fila = { id: 1, monto: 5000, concepto: 'Diezmo' };
  const limpia = sensibles.limpiar(TESORERIA, fila, { rol: 'consulta' });
  assert.deepEqual(limpia, fila);
  assert.equal(limpia.salud_oculta, undefined);
});

test('sin usuario no se alcanza nada', () => {
  assert.equal(sensibles.alcanza(null), false);
  assert.equal(sensibles.alcanza(undefined, ficha()), false);
});
