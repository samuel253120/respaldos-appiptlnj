/**
 * La columna «Usuarios» de un perfil cuenta lo que quien mira puede ver.
 *
 * Desde la v1.98.0 las tres rutas de este módulo están acotadas: quien
 * administra una iglesia ve, en la ficha de un perfil, solo las cuentas de sus
 * iglesias. La columna del listado quedó fuera de aquel arreglo —es un cálculo
 * aparte— y contaba la tabla entera.
 *
 * MEDIDO EN LA v1.327.0, con un administrador de una sola iglesia, en la misma
 * pantalla y sobre el mismo perfil:
 *
 *   en el listado ............. «2 usuarios»
 *   en la ficha de ese perfil . 0 cuentas
 *
 * No se filtraban nombres —la ficha sí estaba bien acotada— pero sí un número:
 * cuánta gente de otras iglesias lleva ese perfil. Y dejaba la pantalla
 * contradiciéndose sola, que es lo que en la práctica hace que nadie confíe en
 * la cifra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `cuenta-perfil-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 22900000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

function unaIglesia(comoSeLlama) {
  return Number(db.prepare(
    "INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')"
  ).run(`Iglesia ${comoSeLlama} ${M}`, `${comoSeLlama.slice(0, 3).toUpperCase()}${process.pid}${siguiente++}`).lastInsertRowid);
}

function unPerfil() {
  const nombre = `Perfil contado ${unRut()} ${M}`;
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(nombre, JSON.stringify({ miembros: ['view'] })).lastInsertRowid);
  return { id, nombre };
}

function unaCuenta({ rol = 'consulta', iglesia = null, perfil = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, perfil_id, iglesias, iglesia_id) VALUES (?, ?, ?, 1, ?, ?, ?)'
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, rol, perfil,
    iglesia ? JSON.stringify([iglesia]) : '[]', iglesia).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

/** Lo que dice la columna «Usuarios» de ese perfil, para quien lo mire. */
async function loQueDiceElListado(api, perfil) {
  const r = await api('GET', `/perfiles_permisos?q=${encodeURIComponent(perfil.nombre)}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const fila = (r.json.rows || []).find((p) => p.id === perfil.id);
  assert.ok(fila, 'guardia: el perfil tiene que salir en el listado');
  return fila.cuantos_usuarios;
}

/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: el listado y la ficha del perfil dicen lo mismo', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia('Propia');
  const ajena = unaIglesia('Ajena');
  const perfil = unPerfil();

  unaCuenta({ iglesia: ajena, perfil: perfil.id, nombre: `De la otra iglesia A ${M}` });
  unaCuenta({ iglesia: ajena, perfil: perfil.id, nombre: `De la otra iglesia B ${M}` });

  const jefeDeUna = unaCuenta({ rol: 'admin', iglesia: suya, nombre: `Jefe de una iglesia ${M}` });
  const suyo = comoOtroUsuario(jefeDeUna.id);

  const enElListado = await loQueDiceElListado(suyo, perfil);
  const enLaFicha = (await suyo('GET', `/perfiles_permisos/${perfil.id}/usuarios`)).json.usuarios;

  assert.equal(enLaFicha.length, 0, 'guardia: en la ficha no ve ninguna, que ya estaba bien');
  assert.equal(enElListado, 'Nadie de los suyos',
    `el listado decía «2 usuarios» y la ficha mostraba cero; ahora dice «${enElListado}»`);
});

test('y cuenta las suyas cuando las hay, diciendo que son las suyas', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia('Contada');
  const ajena = unaIglesia('NoContada');
  const perfil = unPerfil();

  unaCuenta({ iglesia: suya, perfil: perfil.id, nombre: `De la suya ${M}` });
  unaCuenta({ iglesia: ajena, perfil: perfil.id, nombre: `De la otra ${M}` });
  unaCuenta({ iglesia: ajena, perfil: perfil.id, nombre: `De la otra dos ${M}` });

  const jefeDeUna = unaCuenta({ rol: 'admin', iglesia: suya, nombre: `Jefe que cuenta ${M}` });
  const suyo = comoOtroUsuario(jefeDeUna.id);

  assert.equal(await loQueDiceElListado(suyo, perfil), '1 de los suyos');
  assert.equal((await suyo('GET', `/perfiles_permisos/${perfil.id}/usuarios`)).json.usuarios.length, 1,
    'y la ficha muestra esa misma');
  assert.ok(api, 'el sistema quedó andando');
});

test('LA CONTRACARA: quien ve todas las iglesias sigue viendo el total', async () => {
  /**
   * Sin esta, el arreglo sería «contar menos siempre». Quien no tiene iglesias
   * asignadas ve todo el sistema, y para esa persona el número de verdad es el
   * de todos: es la cifra con la que decide si un perfil se puede archivar.
   */
  const api = await elSistemaAndando();
  const una = unaIglesia('Total1');
  const otra = unaIglesia('Total2');
  const perfil = unPerfil();
  unaCuenta({ iglesia: una, perfil: perfil.id });
  unaCuenta({ iglesia: otra, perfil: perfil.id });

  assert.equal(await loQueDiceElListado(api, perfil), '2 usuarios');
});

test('y un perfil que no usa nadie lo dice, sin adornos', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  assert.equal(await loQueDiceElListado(api, perfil), 'Nadie todavía');
});

test('la cuenta de uno solo se dice en singular, en los dos casos', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia('Singular');
  const perfil = unPerfil();
  unaCuenta({ iglesia: suya, perfil: perfil.id });

  assert.equal(await loQueDiceElListado(api, perfil), '1 usuario');

  const jefeDeUna = unaCuenta({ rol: 'admin', iglesia: suya, nombre: `Jefe singular ${M}` });
  assert.equal(await loQueDiceElListado(comoOtroUsuario(jefeDeUna.id), perfil), '1 de los suyos');
});

test('y el aviso de no poder borrarlo sigue contando a TODOS', async () => {
  /**
   * Esa cuenta es de otra clase: no es lo que alguien ve, es la razón por la
   * que el sistema se niega. Si contara solo las suyas, un administrador de
   * una iglesia borraría un perfil que otras tres personas están usando.
   */
  const api = await elSistemaAndando();
  const ajena = unaIglesia('DelBorrado');
  const perfil = unPerfil();
  unaCuenta({ iglesia: ajena, perfil: perfil.id });
  unaCuenta({ iglesia: ajena, perfil: perfil.id });

  const r = await api('DELETE', `/perfiles_permisos/${perfil.id}`);
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /2 usuario\(s\) tienen este perfil/);
});
