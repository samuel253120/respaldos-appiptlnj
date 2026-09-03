/**
 * Las reglas propias del módulo de Perfiles de Permisos.
 *
 * El módulo es corto —171 renglones— porque casi todo lo suyo lo resuelve el
 * motor. Lo propio que tiene son un gancho, un cálculo y tres rutas, y en la
 * revisión de la v1.327.0 se rompieron a propósito las catorce reglas que ese
 * código dice hacer cumplir: ocho pusieron algo rojo y seis no.
 *
 * De esas seis, dos se cerraron con su propia corrección —el perfil archivado
 * (v1.330.0) y el administrador (v1.331.0)—. Las otras cuatro no estaban rotas:
 * se comprobaron a mano una por una y las cuatro hacían lo suyo. Lo que no
 * había era quien se enterara el día que dejaran de hacerlo.
 *
 * Acá quedan atadas, contra el sistema andando y cada una con su contracara.
 *
 * UNA DE ELLAS RESULTÓ SER UNA GUARDIA DUPLICADA, y conviene que quede dicho:
 * borrar un perfil que alguien usa lo frenan DOS cosas —el gancho de este
 * módulo y la tabla de dependencias del motor— y la que contesta primero es la
 * segunda. Por eso quitar el gancho no rompía nada. Las dos se prueban acá,
 * porque las dos tienen que seguir estando: la tabla es la que manda y el
 * gancho es el que explica.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/perfiles_permisos');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `reglas-perfil-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 23100000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

function unaIglesia(comoSeLlama) {
  return Number(db.prepare(
    "INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')"
  ).run(`Iglesia ${comoSeLlama} ${M}`, `${comoSeLlama.slice(0, 3).toUpperCase()}${process.pid}${siguiente++}`).lastInsertRowid);
}

function unaCuenta({ rol = 'consulta', iglesia = null, perfil = null, nombre = null, activo = 1 } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, perfil_id, iglesias, iglesia_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, rol, activo, perfil,
    iglesia ? JSON.stringify([iglesia]) : '[]', iglesia).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

/* --------------------------------------------------------------------- */
/* 1 · el nombre y el estado                                              */
/* --------------------------------------------------------------------- */

test('un perfil sin nombre no entra', async () => {
  /**
   * El nombre es lo único que se ve de un perfil en el desplegable donde se
   * elige. Sin él, quien reparte permisos elige a ciegas.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', { estado: 'Activo', permisos: { miembros: ['view'] } });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /Nombre del perfil.*obligatorio/);
});

test('ni dos perfiles con el mismo nombre', async () => {
  /**
   * Dos «Tesorero de cuerpo» con permisos distintos, y quien reparte no tiene
   * cómo saber cuál está eligiendo.
   */
  const api = await elSistemaAndando();
  const nombre = `Tesorero de cuerpo ${unRut()} ${M}`;
  assert.equal((await api('POST', '/perfiles_permisos', { nombre, estado: 'Activo' })).estado, 201);

  const r = await api('POST', '/perfiles_permisos', { nombre, estado: 'Activo' });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /Ya existe otro perfil de permisos con ese Nombre/);
});

test('y el que no dice su estado nace Activo, no en blanco', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', { nombre: `Sin estado ${unRut()} ${M}` });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.equal(r.json.estado, 'Activo');
});

/* --------------------------------------------------------------------- */
/* 2 · un perfil que alguien usa no se borra                              */
/* --------------------------------------------------------------------- */

test('LA GUARDIA DUPLICADA: un perfil que alguien lleva puesto no se borra', async () => {
  const api = await elSistemaAndando();
  const perfil = (await api('POST', '/perfiles_permisos',
    { nombre: `Perfil en uso ${unRut()} ${M}`, estado: 'Activo' })).json;
  const suya = unaCuenta({ perfil: perfil.id, nombre: `Lo lleva puesto ${M}` });

  const r = await api('DELETE', `/perfiles_permisos/${perfil.id}`);
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /usuario\(s\) con este perfil|usuario\(s\) tienen este perfil/);

  const igual = await api('DELETE', `/perfiles_permisos/${perfil.id}?igual_asi=1`);
  assert.equal(igual.estado, 400, 'ni pidiéndolo con «igual así»: esto no es una pregunta');
  assert.ok(db.prepare('SELECT id FROM perfiles_permisos WHERE id = ?').get(perfil.id), 'el perfil sigue ahí');
  assert.equal(Number(db.prepare('SELECT perfil_id FROM usuarios WHERE id = ?').get(suya.id).perfil_id), perfil.id,
    'y quien lo llevaba no se quedó sin permisos de golpe');
});

test('y el gancho del módulo lo dice con su nombre, aunque la tabla conteste primero', () => {
  /**
   * El gancho es el que explica: dice cuántos son y ofrece archivarlo. Se le
   * pregunta directo porque en el sistema andando contesta antes la tabla de
   * dependencias del motor, y así el gancho podría vaciarse sin que se note
   * —que es justo lo que pasaba—.
   */
  const perfil = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado) VALUES (?, 'Activo')"
  ).run(`Perfil del gancho ${unRut()} ${M}`).lastInsertRowid);
  unaCuenta({ perfil, nombre: `Del gancho ${M}` });

  const aviso = def.hooks.beforeDelete({ id: perfil }, { db });
  assert.ok(typeof aviso === 'string', `se esperaba un aviso y llegó ${JSON.stringify(aviso)}`);
  assert.match(aviso, /1 usuario\(s\) tienen este perfil/);
  assert.match(aviso, /archívelo en vez de eliminarlo/, 'y ofrece la salida');
});

test('y la tabla de dependencias lo frena por su cuenta, que es la que manda', () => {
  /**
   * La otra mitad de la guardia duplicada. La tabla del motor es la que
   * contesta primero, así que si se le quitara la línea el gancho seguiría
   * frenando y no se notaría nada... hasta el día que también se toque el
   * gancho. Se le pregunta directo al plan de borrado.
   */
  const dependencias = require('../../server/dependencias');
  const perfil = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado) VALUES (?, 'Activo')"
  ).run(`Perfil de la tabla ${unRut()} ${M}`).lastInsertRowid);
  unaCuenta({ perfil, nombre: `De la tabla ${M}` });

  const plan = dependencias.planDe(db, def, { id: perfil });
  assert.ok(plan.freno,
    `la tabla tenía que frenar el borrado y devolvió ${JSON.stringify(plan).slice(0, 200)}`);
  assert.match(plan.freno, /1 usuario\(s\) con este perfil/);
  assert.match(plan.freno, /archívelo en vez de eliminarlo/, 'y con la salida escrita');
});

test('LA CONTRACARA: el perfil que no usa nadie sí se borra', async () => {
  const api = await elSistemaAndando();
  const perfil = (await api('POST', '/perfiles_permisos',
    { nombre: `Perfil sin nadie ${unRut()} ${M}`, estado: 'Activo' })).json;

  const r = await api('DELETE', `/perfiles_permisos/${perfil.id}`);
  assert.equal(r.estado, 200, `tenía que poder borrarse: ${r.texto.slice(0, 200)}`);
  assert.ok(!db.prepare('SELECT id FROM perfiles_permisos WHERE id = ?').get(perfil.id));
  assert.equal(def.hooks.beforeDelete({ id: perfil.id }, { db }), null, 'y el gancho tampoco protesta');
});

/* --------------------------------------------------------------------- */
/* 3 · las dos listas de la ficha del perfil, acotadas                     */
/* --------------------------------------------------------------------- */

test('LA QUE NO SE VEÍA: la lista de quienes llevan el perfil trae las suyas y no las ajenas', async () => {
  /**
   * Las dos mitades juntas, a propósito. Comprobar solo que la cuenta ajena no
   * aparece lo cumple hasta una avería: medido en la v1.327.0, rota la línea
   * que acota esta consulta, la ruta contesta 500 y una comprobación escrita
   * como negación sigue en verde.
   */
  const api = await elSistemaAndando();
  const suya = unaIglesia('Suya');
  const ajena = unaIglesia('Ajena');
  const perfil = (await api('POST', '/perfiles_permisos',
    { nombre: `Perfil de dos iglesias ${unRut()} ${M}`, estado: 'Activo' })).json;

  const deLaSuya = unaCuenta({ iglesia: suya, perfil: perfil.id, nombre: `Lleva el perfil, de la suya ${M}` });
  const deLaAjena = unaCuenta({ iglesia: ajena, perfil: perfil.id, nombre: `Lleva el perfil, de la otra ${M}` });
  const jefeDeUna = unaCuenta({ rol: 'admin', iglesia: suya, nombre: `Jefe de una ${M}` });

  const r = await comoOtroUsuario(jefeDeUna.id)('GET', `/perfiles_permisos/${perfil.id}/usuarios`);
  assert.equal(r.estado, 200, `la ruta tiene que FUNCIONAR: ${r.texto.slice(0, 200)}`);
  const quienes = r.json.usuarios.map((u) => u.id);
  assert.ok(quienes.includes(deLaSuya.id), 'la de su iglesia sale');
  assert.ok(!quienes.includes(deLaAjena.id), 'y la de la otra no');
});

test('y la lista de a quiénes ponérselo, igual', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia('Disp');
  const ajena = unaIglesia('DispAjena');
  const perfil = (await api('POST', '/perfiles_permisos',
    { nombre: `Perfil de disponibles ${unRut()} ${M}`, estado: 'Activo' })).json;

  const deLaSuya = unaCuenta({ iglesia: suya, nombre: `Sin perfil, de la suya ${M}` });
  const deLaAjena = unaCuenta({ iglesia: ajena, nombre: `Sin perfil, de la otra ${M}` });
  const jefeDeUna = unaCuenta({ rol: 'admin', iglesia: suya, nombre: `Jefe de disponibles ${M}` });

  const r = await comoOtroUsuario(jefeDeUna.id)('GET', `/perfiles_permisos/${perfil.id}/usuarios`);
  assert.equal(r.estado, 200, `la ruta tiene que FUNCIONAR: ${r.texto.slice(0, 200)}`);
  const libres = r.json.disponibles.map((u) => u.id);
  assert.ok(libres.includes(deLaSuya.id), 'la de su iglesia se le ofrece');
  assert.ok(!libres.includes(deLaAjena.id), 'y la de la otra no');
});

test('LA CONTRACARA: quien administra todas las iglesias las ve todas', async () => {
  /**
   * Sin esta, «acotar» se cumpliría devolviendo siempre una lista vacía.
   */
  const api = await elSistemaAndando();
  const una = unaIglesia('TodasA');
  const otra = unaIglesia('TodasB');
  const perfil = (await api('POST', '/perfiles_permisos',
    { nombre: `Perfil de todas ${unRut()} ${M}`, estado: 'Activo' })).json;
  const aqui = unaCuenta({ iglesia: una, perfil: perfil.id, nombre: `De acá ${M}` });
  const alla = unaCuenta({ iglesia: otra, perfil: perfil.id, nombre: `De allá ${M}` });

  const r = await api('GET', `/perfiles_permisos/${perfil.id}/usuarios`);
  assert.equal(r.estado, 200);
  const quienes = r.json.usuarios.map((u) => u.id);
  assert.ok(quienes.includes(aqui.id) && quienes.includes(alla.id), 'el administrador general ve las dos');
});
