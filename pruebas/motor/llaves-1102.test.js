/**
 * Las llaves de la 1.102.0: fotografías, montos y eliminar.
 *
 * Van en su propio archivo y no en «llaves-nuevas.test.js», que es el de las
 * cuatro de la 1.91.0: cada tanda de llaves cuida cosas distintas y mezclarlas
 * haría que el nombre dejara de decir de cuáles habla.
 *
 * POR QUÉ SE PRUEBAN ASÍ. Una llave nueva tiene dos maneras de salir mal, y
 * son opuestas: que no cierre nada —se concede, se ve concedida y el dato
 * igual se ve— o que cierre de más, y alguien que trabajaba normalmente
 * amanezca sin poder hacer su pega. Las dos se comprueban acá, cada una
 * contra la otra.
 *
 * Y una tercera, más callada: que la llave venga QUITADA de fábrica a quien
 * antes podía. Estas tres las tienen todos de entrada, a propósito: nada
 * cambia para nadie mientras la iglesia no se las quite a alguien.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { can, LLAVES, ROLES } = require('../../server/permissions');
const { getModule } = require('../../server/registry');

const laLlave = (nombre) => LLAVES.find((l) => l.name === nombre);
const conLlaves = (permisos) => ({ id: 1, rol: 'consulta', permisos: JSON.stringify(permisos) });

// ─────────────────────────────────────────── están, y vienen de fábrica ───

test('las tres llaves existen y se pueden conceder', () => {
  for (const nombre of ['miembros_foto', 'tesoreria_montos', 'datos_borrar']) {
    const l = laLlave(nombre);
    assert.ok(l, `falta la llave ${nombre}`);
    assert.deepEqual(l.acciones, ['view'], `${nombre}: se tiene o no se tiene`);
    assert.ok(l.ayuda && l.ayuda.length > 40, `${nombre}: tiene que explicar para qué sirve`);
  }
});

test('de fábrica las tienen TODOS los roles: nadie pierde nada al actualizar', () => {
  // Es la parte delicada de agregar una llave. Si viniera quitada, el día de
  // la actualización media iglesia se quedaría sin poder borrar ni ver fotos,
  // sin que nadie hubiera decidido eso.
  for (const nombre of ['miembros_foto', 'tesoreria_montos', 'datos_borrar']) {
    assert.equal(laLlave(nombre).defecto, 'todos', `${nombre} tendría que venir concedida`);
    for (const { value: rol } of ROLES) {
      assert.ok(can({ rol }, nombre, 'view'), `${rol} tendría que traer ${nombre}`);
    }
  }
});

test('y se le pueden quitar a una persona concreta', () => {
  const sinNada = conLlaves({ miembros_foto: [], tesoreria_montos: [], datos_borrar: [] });
  for (const nombre of ['miembros_foto', 'tesoreria_montos', 'datos_borrar']) {
    assert.equal(can(sinNada, nombre, 'view'), false, `${nombre} tendría que poder quitarse`);
  }
});

// ────────────────────────────────────── qué campo protege cada una ───

test('la foto de las personas queda bajo su llave, y solo la de las personas', () => {
  for (const cual of ['miembros', 'pastores']) {
    const foto = getModule(cual).fields.find((f) => f.name === 'foto');
    assert.equal(foto.reservado, 'miembros_foto', `${cual}: la foto tiene que estar reservada`);
  }
  // La foto de un cuerpo o de un templo no es de nadie: no se reserva.
  for (const cual of ['cuerpos', 'iglesias', 'inventarios']) {
    const foto = getModule(cual).fields.find((f) => f.name === 'foto');
    if (foto) assert.notEqual(foto.reservado, 'miembros_foto', `${cual}: no es la foto de una persona`);
  }
});

test('los montos del dinero quedan bajo su llave', () => {
  for (const [cual, campo] of [['tesoreria', 'monto'], ['traspasos', 'monto'], ['cuotas_cuerpo', 'monto']]) {
    const f = getModule(cual).fields.find((x) => x.name === campo);
    assert.equal(f.reservado, 'tesoreria_montos', `${cual}.${campo} tendría que estar reservado`);
  }
});

test('lo que NO es un monto sigue viéndose: se oculta la cifra, no el movimiento', () => {
  // De esto depende que la llave sirva de algo. Quien no ve los montos tiene
  // que seguir viendo qué se movió y cuándo, o el módulo no le sirve de nada.
  const tesoreria = getModule('tesoreria');
  for (const campo of ['fecha', 'tipo', 'concepto', 'categoria', 'cuenta_id']) {
    const f = tesoreria.fields.find((x) => x.name === campo);
    if (f) assert.notEqual(f.reservado, 'tesoreria_montos', `${campo} no puede quedar oculto`);
  }
});

test('el resto de la ficha de un miembro no se va con la foto', () => {
  const miembros = getModule('miembros');
  for (const campo of ['nombres', 'apellidos', 'estado']) {
    const f = miembros.fields.find((x) => x.name === campo);
    assert.notEqual(f.reservado, 'miembros_foto');
  }
});

// ──────────────────────────────────────────────────── las dos listas ───

test('los tipos de actividad y los motivos son datos, no una lista del programa', () => {
  for (const cual of ['tipos_actividad', 'motivos_ausencia']) {
    const def = getModule(cual);
    assert.ok(def, `falta el módulo ${cual}`);
    assert.ok(def.fields.find((f) => f.name === 'nombre').unique, 'el nombre no se puede repetir');
    assert.ok(def.fields.find((f) => f.name === 'activo'), 'se desactiva en vez de borrarse');
    assert.ok(def.hooks && def.hooks.beforeDelete, 'y no se borra lo que ya se usó');
  }
});

test('la actividad y el motivo salen de esas listas, no de una escrita a mano', () => {
  const tipo = getModule('asistencias').fields.find((f) => f.name === 'tipo_reunion');
  assert.match(tipo.optionsRoute || '', /tipos_actividad/);
  assert.equal(tipo.options, undefined, 'ya no lleva su lista adentro');

  const motivo = getModule('asistencia_detalle').fields.find((f) => f.name === 'motivo');
  assert.match(motivo.optionsRoute || '', /motivos_ausencia/);
  assert.equal(motivo.options, undefined, 'ya no lleva su lista adentro');
});

test('un tipo que ya se usó no se puede borrar: se desactiva', () => {
  const { db } = require('../../server/db');
  db.prepare("INSERT INTO tipos_actividad (nombre, activo) VALUES ('Vigilia de prueba', 1)").run();
  const fila = db.prepare("SELECT * FROM tipos_actividad WHERE nombre = 'Vigilia de prueba'").get();

  // Sin usarlo se puede borrar
  assert.equal(getModule('tipos_actividad').hooks.beforeDelete(fila, { db }), null);

  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Para tipos','IG-TIP','Activa')").run().lastInsertRowid;
  db.prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id) VALUES ('2026-05-01','Vigilia de prueba',?)").run(iglesia);
  const aviso = getModule('tipos_actividad').hooks.beforeDelete(fila, { db });
  assert.ok(aviso, 'usado, tiene que negarse');
  assert.match(aviso, /desmárquelo|desmarquelo/i, 'y decir qué hacer en su lugar');
});

test('cuáles piden explicación lo dicen los datos, no el código', () => {
  const { db } = require('../../server/db');
  const { motivosQuePidenDetalle } = require('../../server/modules/asistencia_detalle');
  db.prepare("DELETE FROM motivos_ausencia WHERE nombre IN ('Viaje de prueba','Sencillo de prueba')").run();
  db.prepare("INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES ('Viaje de prueba', 1, 1)").run();
  db.prepare("INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES ('Sencillo de prueba', 0, 1)").run();
  const piden = motivosQuePidenDetalle();
  assert.ok(piden.includes('Viaje de prueba'), 'el que se marcó tiene que pedirla');
  assert.ok(!piden.includes('Sencillo de prueba'), 'y el que no, no');
});
