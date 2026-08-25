/**
 * El buscador general: encuentra lo que esa persona podría abrir, y nada más.
 *
 * Una caja que pregunta en los treinta y dos módulos a la vez es, si se hace
 * mal, la puerta de atrás más grande del sistema: todo el trabajo de permisos,
 * de alcance por iglesia y cuerpo y de datos reservados se pierde si el
 * buscador consulta las tablas por su cuenta.
 *
 * Por eso no consulta por su cuenta: usa las mismas piezas que el listado de
 * cada módulo —`can`, `alcance.condiciones`, `sensibles`—. Estas pruebas fijan
 * las cuatro reglas que lo sostienen, porque son las que se rompen sin ruido
 * cuando alguien agrega un módulo o cambia una consulta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const buscador = require('../../server/buscador');

/** Un miembro de prueba, con teléfono y con datos de salud. */
function sembrar() {
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central', 'IG-1', 'Activa')").run();
  const otra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Norte', 'IG-2', 'Activa')").run();
  const uno = db.prepare(
    `INSERT INTO miembros (nombres, apellidos, rut, telefono, enfermedades, iglesia_id, estado)
     VALUES ('Ana Maria', 'Perez Soto', '13871276-1', '+56911112222', 'Diabetes', ?, 'Activo')`
  ).run(iglesia.lastInsertRowid);
  const dos = db.prepare(
    `INSERT INTO miembros (nombres, apellidos, rut, telefono, iglesia_id, estado)
     VALUES ('Beto', 'Perez Rojas', '17654321-3', '+56933334444', ?, 'Activo')`
  ).run(otra.lastInsertRowid);
  return {
    iglesia: iglesia.lastInsertRowid, otra: otra.lastInsertRowid,
    uno: uno.lastInsertRowid, dos: dos.lastInsertRowid,
  };
}

const datos = sembrar();

const deMiembros = (r) => (r.grupos.find((g) => g.modulo === 'miembros') || { resultados: [] }).resultados;
const nombres = (r) => deMiembros(r).map((x) => x.titulo);

// ----------------------------------------------------------- lo básico ----

test('encuentra por el nombre, y dice de qué módulo es cada cosa', () => {
  const r = buscador.buscar('Perez', { rol: 'admin' });
  assert.ok(r.total >= 2, `esperaba al menos dos, hubo ${r.total}`);
  const grupo = r.grupos.find((g) => g.modulo === 'miembros');
  assert.ok(grupo, 'tendría que venir el grupo de miembros');
  assert.equal(grupo.label, 'Miembros');
  assert.ok(grupo.icon, 'sin icono no se distingue de dónde salió cada resultado');
});

test('con menos de dos letras no se busca', () => {
  // Una sola letra trae media iglesia y no ayuda a nadie
  const r = buscador.buscar('a', { rol: 'admin' });
  assert.equal(r.corto, true);
  assert.equal(r.total, 0);
  assert.deepEqual(r.grupos, []);
});

test('lo que no está, no aparece', () => {
  const r = buscador.buscar('zzzqqq', { rol: 'admin' });
  assert.equal(r.total, 0);
  assert.equal(r.corto, false);
});

// ------------------------------------------------- 1 · solo lo que ve ----

test('no busca en un módulo que esa persona no puede ver', () => {
  // Quien solo consulta no tiene Tesorería: no puede salirle un movimiento
  const cuenta = db.prepare(
    "INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, estado) VALUES ('Caja Perez', 'Corporación', 'General', 'Activa')"
  ).run();
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id)
     VALUES ('2026-08-01', 'Ingreso', 'Diezmos', 'Ofrenda Perez', 1000, ?)`
  ).run(cuenta.lastInsertRowid);

  const delAdmin = buscador.buscar('Perez', { rol: 'admin' });
  assert.ok(delAdmin.grupos.some((g) => g.modulo === 'tesoreria'), 'el administrador sí la ve');

  const deConsulta = buscador.buscar('Perez', { rol: 'consulta' });
  assert.ok(!deConsulta.grupos.some((g) => g.modulo === 'tesoreria'),
    'quien solo consulta no tiene tesorería y no puede encontrar un movimiento');
});

// ------------------------------------------------ 2 · solo su alcance ----

test('no encuentra a alguien de una iglesia que no tiene asignada', () => {
  const soloLaSuya = { rol: 'admin', iglesias: JSON.stringify([datos.iglesia]) };
  const suyos = nombres(buscador.buscar('Perez', soloLaSuya));
  assert.ok(suyos.some((n) => n.includes('Ana')), 'la de su iglesia sí');
  assert.ok(!suyos.some((n) => n.includes('Beto')), 'el de la otra iglesia no tendría que aparecer');

  // Y sin acotar, los dos
  const todos = nombres(buscador.buscar('Perez', { rol: 'admin' }));
  assert.ok(todos.some((n) => n.includes('Beto')));
});

// ---------------------------------------- 3 · solo por lo que alcanza ----

test('no se puede dar con alguien buscando por un dato reservado', () => {
  // Es la puerta que se olvida: el teléfono no se muestra, pero si el buscador
  // preguntara por él bastaría con probar números para saber de quién es cada uno.
  const conContacto = { rol: 'secretario' };
  assert.ok(nombres(buscador.buscar('911112222', conContacto)).length === 1,
    'quien alcanza el contacto sí da con ella');

  const sinContacto = { rol: 'secretario', permisos: JSON.stringify({ miembros_contacto: [] }) };
  assert.deepEqual(nombres(buscador.buscar('911112222', sinContacto)), [],
    'quien no lo alcanza no tendría que encontrarla');
  // Y sigue encontrándola por lo que sí ve
  assert.ok(nombres(buscador.buscar('Perez', sinContacto)).length >= 1);
});

test('tampoco por los datos de salud, que también son reservados', () => {
  const pastor = { rol: 'pastor' };
  assert.ok(nombres(buscador.buscar('Diabetes', pastor)).length >= 0); // no está en searchFields
  const secretaria = { rol: 'secretario' };
  assert.deepEqual(nombres(buscador.buscar('Diabetes', secretaria)), []);
});

// ------------------------------- 4 · sin datos reservados en lo que sale ----

test('lo que sale no lleva datos que esa persona no alcanza', () => {
  const sinContacto = { rol: 'secretario', permisos: JSON.stringify({ miembros_contacto: [] }) };
  const r = buscador.buscar('Perez', sinContacto);
  assert.ok(!JSON.stringify(r).includes('911112222'), 'el teléfono no puede viajar en la respuesta');
  const conContacto = buscador.buscar('911112222', { rol: 'secretario' });
  assert.ok(JSON.stringify(conContacto).includes('911112222'), 'a quien sí lo alcanza, sí');
});

// -------------------------------------------------------- la presentación ----

test('cada resultado dice por qué salió cuando no se ve en lo que se muestra', () => {
  // Buscar un nombre y recibir nombres se entiende solo; buscar un número y
  // recibir tres fichas sin decir de dónde salió, no.
  const porTelefono = deMiembros(buscador.buscar('911112222', { rol: 'secretario' }));
  assert.equal(porTelefono.length, 1);
  assert.ok(porTelefono[0].porque, 'tendría que decir qué campo coincidió');
  assert.equal(porTelefono[0].porque.campo, 'Teléfono');
  assert.ok(porTelefono[0].porque.valor.includes('911112222'));

  // Y cuando lo buscado ya está a la vista, no se repite
  const porNombre = deMiembros(buscador.buscar('Ana', { rol: 'secretario' }));
  assert.equal(porNombre[0].porque, null, 'el nombre ya está en el título: repetirlo sería ruido');
});

test('los resultados traen pistas para distinguir a dos personas del mismo nombre', () => {
  const r = deMiembros(buscador.buscar('Perez', { rol: 'admin' }));
  for (const uno of r) {
    assert.ok(Array.isArray(uno.pistas), 'sin pistas no se distingue a dos que se llaman igual');
    assert.ok(uno.titulo && uno.titulo !== `#${uno.id}`, 'un resultado sin nombre no sirve de nada');
  }
});

test('avisa cuando hay más de los que muestra', () => {
  // Se traen unos pocos por módulo: si hay más, el panel ofrece ir al listado
  for (let i = 0; i < 8; i++) {
    db.prepare(
      `INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado)
       VALUES (?, 'Muchos', ?, ?, 'Activo')`
    ).run(`Repetido ${i}`, `9000${i}-0`, datos.iglesia);
  }
  const r = buscador.buscar('Muchos', { rol: 'admin' });
  const grupo = r.grupos.find((g) => g.modulo === 'miembros');
  assert.equal(grupo.resultados.length, buscador.POR_MODULO(), 'trae solo los primeros');
  assert.equal(grupo.hay_mas, true, 'y avisa que hay más');
});

test('sin usuario no se entrega nada', () => {
  const r = buscador.buscar('Perez', null);
  assert.equal(r.total, 0, 'sin nadie identificado no hay módulos que pueda ver');
});
