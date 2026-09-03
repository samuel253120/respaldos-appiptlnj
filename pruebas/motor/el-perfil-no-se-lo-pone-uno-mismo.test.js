/**
 * Ponerle o sacarle un perfil a alguien es cambiarle los permisos.
 *
 * El sistema tiene dos puertas para hacer ese mismo cambio: la ficha del
 * usuario, donde se elige su perfil, y la ficha del perfil, donde se marcan de
 * una vez las personas que lo llevan. La primera pasa por el gancho de guardado
 * de Usuarios, y desde la v1.317.0 ese gancho comprueba dos cosas: que nadie se
 * toque a sí mismo el rol, el perfil ni las excepciones, y que nadie le conceda
 * a otro lo que él mismo no tiene.
 *
 * LA SEGUNDA NO PASABA POR AHÍ. Escribe `UPDATE usuarios SET perfil_id` directo
 * contra la base, así que no tocaba ni el gancho ni la bitácora.
 *
 * MEDIDO EN LA v1.327.0, con una cuenta de secretaria a la que se le dio
 * exactamente «usuarios: ver, crear, editar» y ningún permiso sobre Perfiles
 * —el listado del módulo le contestaba 403—:
 *
 *   antes ..... GET /configuracion .................. 403
 *               POST /perfiles_permisos/6/usuarios    200 {"puestos":1}
 *   después ... GET /configuracion .................. 200
 *               Registro de Cambios ... 95 antes, 95 después
 *
 * Tres líneas, y la cuenta pasó de no poder abrir la Configuración a poder
 * cambiarla, sin que quedara anotado en ninguna parte. Con la misma ruta le
 * puso ese perfil a una compañera de su iglesia, concediéndole un permiso que
 * ella no tenía.
 *
 * Estas pruebas cierran las dos puertas con la misma llave, y en los DOS
 * sentidos: un perfil también puede QUITAR lo que el rol daba, así que
 * sacárselo a alguien devuelve esos permisos, y eso también es ganar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { can } = require('../../server/permissions');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `perfil-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 22300000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/** Una cuenta con los permisos que se le quieran dar. */
function unaCuenta({ rol = 'secretario', permisos = null, perfil = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, permisos, perfil_id) VALUES (?, ?, ?, 1, ?, ?)'
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, rol, permisos ? JSON.stringify(permisos) : null, perfil).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

/** Un perfil con los permisos que se le quieran dar. */
function unPerfil(permisos, comoSeLlama = 'Perfil') {
  const nombre = `${comoSeLlama} ${unRut()} ${M}`;
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(nombre, JSON.stringify(permisos)).lastInsertRowid);
  return { id, nombre };
}

const comoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
const alcanzaLaConfiguracion = (id) => can(comoQuedo(id), 'sistema_configuracion', 'edit');

/** Lo que el Registro de Cambios anotó sobre esta cuenta. */
const loAnotado = (usuarioId) => db
  .prepare("SELECT * FROM registro_cambios WHERE registro_id = ? AND modulo = 'Usuarios' ORDER BY id")
  .all(usuarioId);

/** Quien administra cuentas sin ser administrador, que es el caso de esta prueba. */
const QUIEN_ADMINISTRA = { usuarios: ['view', 'create', 'edit'] };
const LA_LLAVE_DE_LA_CASA = { sistema_configuracion: ['view', 'edit'] };

/* --------------------------------------------------------------------- */
/* 1 · sobre la propia cuenta                                             */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: no se pone a sí misma un perfil que lo puede todo', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const poderoso = unPerfil(LA_LLAVE_DE_LA_CASA, 'Perfil poderoso');
  const suya = comoOtroUsuario(ella.id);

  assert.equal(alcanzaLaConfiguracion(ella.id), false, 'guardia: la Configuración tiene que estarle cerrada');

  const r = await suya('POST', `/perfiles_permisos/${poderoso.id}/usuarios`, { usuarios: [ella.id] });
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /a sí mismo/);

  assert.equal(comoQuedo(ella.id).perfil_id, null, 'no puede haber quedado con el perfil puesto');
  assert.equal(alcanzaLaConfiguracion(ella.id), false, 'y la Configuración tiene que seguirle cerrada');
});

test('ni se lo quita a sí misma', async () => {
  /**
   * Al revés también: un perfil puede QUITAR lo que el rol daba, así que
   * sacárselo devuelve esos permisos. Es el mismo cambio, en el otro sentido.
   */
  await elSistemaAndando();
  const recortado = unPerfil({ usuarios: ['view'] }, 'Perfil que recorta');
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA, perfil: recortado.id });
  const suya = comoOtroUsuario(ella.id);

  const r = await suya('DELETE', `/perfiles_permisos/${recortado.id}/usuarios/${ella.id}`);
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /a sí mismo/);
  assert.equal(Number(comoQuedo(ella.id).perfil_id), recortado.id, 'lo tiene que seguir teniendo');
});

/* --------------------------------------------------------------------- */
/* 2 · sobre la de otro: no se concede lo que uno no tiene                */
/* --------------------------------------------------------------------- */

test('LA OTRA MITAD: no le pone a otra persona un perfil que da más de lo que ella tiene', async () => {
  /**
   * Sin esta, la primera se rodea con dos cuentas que se suben la una a la
   * otra: yo te doy el perfil poderoso, tú me lo das a mí.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const companera = unaCuenta({ rol: 'consulta', nombre: `Compañera ${M}` });
  const poderoso = unPerfil(LA_LLAVE_DE_LA_CASA, 'Perfil poderoso');
  const suya = comoOtroUsuario(ella.id);

  const r = await suya('POST', `/perfiles_permisos/${poderoso.id}/usuarios`, { usuarios: [companera.id] });
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /permiso\(s\) que usted no tiene/);
  assert.match(r.json.error, /Configuración del sistema/, 'y nombra cuál, para que se entienda');

  assert.equal(comoQuedo(companera.id).perfil_id, null);
  assert.equal(alcanzaLaConfiguracion(companera.id), false);
});

test('ni se lo saca, cuando sacárselo le devolvería lo que ella no tiene', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const recortado = unPerfil({ sistema_configuracion: [] }, 'Perfil que le quita la llave');
  const jefe = unaCuenta({ rol: 'admin', perfil: recortado.id, nombre: `Jefe recortado ${M}` });
  const suya = comoOtroUsuario(ella.id);

  assert.equal(alcanzaLaConfiguracion(jefe.id), false, 'guardia: el perfil le tiene quitada la llave');

  const r = await suya('DELETE', `/perfiles_permisos/${recortado.id}/usuarios/${jefe.id}`);
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /permiso\(s\) que usted no tiene/);
  assert.equal(alcanzaLaConfiguracion(jefe.id), false, 'y sigue sin la llave');
});

/* --------------------------------------------------------------------- */
/* 3 · las contracaras: esto tiene que seguir funcionando                 */
/* --------------------------------------------------------------------- */

test('LA CONTRACARA: quien administra cuentas sí reparte los perfiles de su alcance', async () => {
  /**
   * Es para lo que existe la pantalla. Un perfil que no da nada que ella no
   * tenga se reparte sin preguntarle a nadie, que es el caso normal.
   */
  const api = await elSistemaAndando();
  const ella = unaCuenta({ permisos: { usuarios: ['view', 'create', 'edit'], miembros: ['view', 'edit'] } });
  const companera = unaCuenta({ rol: 'consulta', nombre: `Compañera del reparto ${M}` });
  const corriente = unPerfil({ miembros: ['view', 'edit'] }, 'Secretaria de cuerpo');
  const suya = comoOtroUsuario(ella.id);

  const r = await suya('POST', `/perfiles_permisos/${corriente.id}/usuarios`, { usuarios: [companera.id] });
  assert.equal(r.estado, 200, `tenía que poder: ${r.texto.slice(0, 200)}`);
  assert.equal(r.json.puestos, 1);
  assert.equal(Number(comoQuedo(companera.id).perfil_id), corriente.id);

  const sacar = await suya('DELETE', `/perfiles_permisos/${corriente.id}/usuarios/${companera.id}`);
  assert.equal(sacar.estado, 200, `y sacárselo también: ${sacar.texto.slice(0, 200)}`);
  assert.equal(comoQuedo(companera.id).perfil_id, null);
  assert.ok(api, 'el sistema quedó andando');
});

test('y el administrador reparte cualquiera, que para eso lo tiene todo', async () => {
  const api = await elSistemaAndando();
  const companera = unaCuenta({ rol: 'consulta', nombre: `Compañera del jefe ${M}` });
  const poderoso = unPerfil(LA_LLAVE_DE_LA_CASA, 'Perfil poderoso');

  const r = await api('POST', `/perfiles_permisos/${poderoso.id}/usuarios`, { usuarios: [companera.id] });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(r.json.puestos, 1);
  assert.equal(alcanzaLaConfiguracion(companera.id), true, 'y el perfil le llegó de verdad');
});

/* --------------------------------------------------------------------- */
/* 4 · y queda anotado                                                    */
/* --------------------------------------------------------------------- */

test('LA QUE FALTABA: repartir un perfil queda en el Registro de Cambios', async () => {
  /**
   * El Registro de Cambios vigila Usuarios y Perfiles de Permisos justamente
   * porque son las llaves del sistema. Este cambio no pasa por el motor, así
   * que la línea hay que escribirla; sin ella, el reparto de permisos era lo
   * único del módulo que no dejaba rastro.
   */
  const api = await elSistemaAndando();
  const companera = unaCuenta({ rol: 'consulta', nombre: `Compañera anotada ${M}` });
  const corriente = unPerfil({ miembros: ['view'] }, 'Perfil que se anota');
  assert.equal(loAnotado(companera.id).length, 0, 'guardia: todavía no hay nada anotado de ella');

  assert.equal((await api('POST', `/perfiles_permisos/${corriente.id}/usuarios`, { usuarios: [companera.id] })).estado, 200);
  const puesto = loAnotado(companera.id);
  assert.equal(puesto.length, 1, 'tiene que haber quedado una línea');
  assert.equal(puesto[0].accion, 'Cambio');
  assert.match(puesto[0].detalle, /Perfil de permisos: \(vacío\) → Perfil que se anota/);
  assert.ok(puesto[0].usuario, 'y con el nombre de quien lo hizo');

  assert.equal((await api('DELETE', `/perfiles_permisos/${corriente.id}/usuarios/${companera.id}`)).estado, 200);
  const sacado = loAnotado(companera.id);
  assert.equal(sacado.length, 2, 'y sacarlo deja la suya');
  assert.match(sacado[1].detalle, /Perfil de permisos: Perfil que se anota .* → \(vacío\)/,
    'y dice de cuál a cuál, con el nombre y no con el número');
});

test('y lo que no se hizo no se anota', async () => {
  /**
   * La contracara del registro: una línea por cada cambio que ocurrió, y
   * ninguna por los que se frenaron. Un registro que anota intenciones no
   * sirve para reconstruir lo que pasó.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const companera = unaCuenta({ rol: 'consulta', nombre: `Compañera sin anotar ${M}` });
  const poderoso = unPerfil(LA_LLAVE_DE_LA_CASA, 'Perfil poderoso');

  const r = await comoOtroUsuario(ella.id)('POST', `/perfiles_permisos/${poderoso.id}/usuarios`, { usuarios: [companera.id] });
  assert.equal(r.estado, 403);
  assert.equal(loAnotado(companera.id).length, 0);
});

/* --------------------------------------------------------------------- */
/* 5 · lo que ya estaba y no se toca                                      */
/* --------------------------------------------------------------------- */

test('la cuenta que uno no administra sigue fuera de su alcance', async () => {
  await elSistemaAndando();
  const iglesiaSuya = Number(db.prepare(
    "INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')"
  ).run(`Iglesia propia ${M}`, `PRP${process.pid}`).lastInsertRowid);
  const iglesiaAjena = Number(db.prepare(
    "INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')"
  ).run(`Iglesia ajena ${M}`, `AJN${process.pid}`).lastInsertRowid);

  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  db.prepare('UPDATE usuarios SET iglesias = ?, iglesia_id = ? WHERE id = ?')
    .run(JSON.stringify([iglesiaSuya]), iglesiaSuya, ella.id);
  const ajena = unaCuenta({ rol: 'consulta', nombre: `De la otra iglesia ${M}` });
  db.prepare('UPDATE usuarios SET iglesias = ?, iglesia_id = ? WHERE id = ?')
    .run(JSON.stringify([iglesiaAjena]), iglesiaAjena, ajena.id);
  const corriente = unPerfil({ miembros: ['view'] }, 'Perfil de la otra iglesia');

  const r = await comoOtroUsuario(ella.id)('POST', `/perfiles_permisos/${corriente.id}/usuarios`, { usuarios: [ajena.id] });
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /fuera de lo que tiene asignado/);
  assert.equal(comoQuedo(ajena.id).perfil_id, null);
});
