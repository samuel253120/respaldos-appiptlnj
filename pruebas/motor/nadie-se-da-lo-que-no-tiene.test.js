/**
 * Nadie se da a sí mismo lo que no tiene.
 *
 * El sistema reparte el trabajo a propósito: el campo «Excepciones para esta
 * persona» y el módulo de Perfiles de Permisos existen para que a una
 * secretaria se le pueda dejar mantener las cuentas sin hacerla administradora
 * de todo. Es lo normal en una iglesia, y el módulo lo recomienda.
 *
 * LO QUE FALTABA ERA QUE ESE PERMISO NO SE PUDIERA USAR SOBRE LA PROPIA FICHA.
 * Medido en la v1.316.0 contra el sistema andando, con una cuenta a la que se
 * le dio exactamente «usuarios: ver, crear, editar». Antes de empezar, la
 * Configuración le contestaba 403, que está bien. Después, tres peticiones
 * seguidas, las tres HTTP 200 y sin un mensaje:
 *
 *   PUT /usuarios/<ella> rol: 'admin'                → quedó de administradora
 *   PUT /usuarios/<ella> permisos: {configuración}   → la Configuración pasó a 200
 *   PUT /usuarios/<el administrador> activo: 0       → le cerró la cuenta a su jefe
 *
 * El sistema comprobaba con cuidado A QUÉ CUENTAS alcanza cada persona —eso se
 * arregló en la v1.98.0— pero no QUÉ PUEDE ESCRIBIR dentro de una cuenta que sí
 * alcanza, y la suya siempre la alcanza.
 *
 * Son dos reglas y hacen falta las dos: sin la segunda, la primera se rodea con
 * dos cuentas que se suben la una a la otra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { loQueConcede, loQueSeGana, nombreDelPermiso, can } = require('../../server/permissions');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let siguiente = 0;
/** Un RUT propio de este proceso, para que dos pruebas en paralelo no se pisen. */
function unRut() {
  const n = 21100000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/** Una cuenta con los permisos que se le quieran dar. */
function unaCuenta({ rol = 'secretario', permisos = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, permisos) VALUES (?, ?, ?, 1, ?)'
  ).run(rut, nombre || `Cuenta ${rut}`, rol, permisos ? JSON.stringify(permisos) : null).lastInsertRowid);
  return { id, rut, fila: db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) };
}

/** Quien administra cuentas sin ser administrador, que es el caso de esta prueba. */
const QUIEN_ADMINISTRA = { usuarios: ['view', 'create', 'edit'] };

/* --------------------------------------------------------------------- */
/* 1 · sobre la propia ficha                                              */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: no se puede subir uno mismo de rol', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const suya = comoOtroUsuario(ella.id);

  const antes = await suya('GET', `/usuarios/${ella.id}`);
  assert.equal(antes.estado, 200, 'su propia ficha sí la alcanza, y eso no cambia');

  const r = await suya('PUT', `/usuarios/${ella.id}`, { ...antes.json, rol: 'admin' });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}`);
  assert.match(r.json.error, /su propio rol/);

  const quedo = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(ella.id);
  assert.equal(quedo.rol, 'secretario', 'no puede haber quedado de administradora');
});

test('ni concederse a sí misma un permiso que no tiene', async () => {
  const api = await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const suya = comoOtroUsuario(ella.id);

  /*
   * La llave se mira con `can`, que es lo que mira la ruta de Configuración.
   * Pedirle la pantalla al arnés no serviría: monta el router de los módulos y
   * la configuración vive fuera de él, así que contestaría 404 por otra razón.
   */
  const alcanza = () => can(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ella.id),
    'sistema_configuracion', 'edit');
  assert.equal(alcanza(), false, 'la configuración tiene que estarle cerrada antes de empezar');

  const antes = await suya('GET', `/usuarios/${ella.id}`);
  const r = await suya('PUT', `/usuarios/${ella.id}`, {
    ...antes.json,
    permisos: { ...QUIEN_ADMINISTRA, sistema_configuracion: ['view', 'edit'] },
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}`);
  assert.match(r.json.error, /sus excepciones|su perfil|su propio rol/);

  assert.equal(alcanza(), false, 'la configuración tiene que seguirle cerrada');
  assert.ok(api, 'el sistema quedó andando');
});

test('ni ponerse un perfil de permisos', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const perfil = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(`Perfil ${unRut()}`, JSON.stringify({ sistema_configuracion: ['view', 'edit'] })).lastInsertRowid);

  const suya = comoOtroUsuario(ella.id);
  const antes = await suya('GET', `/usuarios/${ella.id}`);
  const r = await suya('PUT', `/usuarios/${ella.id}`, { ...antes.json, perfil_id: perfil });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /su perfil de permisos/);
});

test('pero el resto de su ficha sí la corrige: la regla no la deja encerrada', async () => {
  /**
   * Es la otra mitad, y la que hace que el arreglo no cambie un problema por
   * otro. Quien administra cuentas tiene que poder corregirse un teléfono mal
   * escrito sin pedirle permiso a nadie.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const suya = comoOtroUsuario(ella.id);
  const antes = await suya('GET', `/usuarios/${ella.id}`);
  const r = await suya('PUT', `/usuarios/${ella.id}`, { ...antes.json, telefono: '+56911112233' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.telefono, '+56911112233');
});

test('y guardar su ficha sin tocar esos campos tampoco protesta', async () => {
  /**
   * El formulario manda la ficha ENTERA en cada guardado, así que la regla
   * tiene que mirar si el valor CAMBIA y no si viene. Sin esto, nadie podría
   * guardar nunca su propia ficha.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const suya = comoOtroUsuario(ella.id);
  const antes = await suya('GET', `/usuarios/${ella.id}`);
  const r = await suya('PUT', `/usuarios/${ella.id}`, { ...antes.json });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
});

/* --------------------------------------------------------------------- */
/* 2 · sobre la ficha de otro                                             */
/* --------------------------------------------------------------------- */

test('LA OTRA QUE IMPORTA: no se le concede a otro lo que uno no tiene', async () => {
  /**
   * Sin esta, la primera se rodea en dos pasos: dos cuentas que administran
   * usuarios se suben la una a la otra y quedan las dos de administradoras.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const laOtra = unaCuenta({ permisos: QUIEN_ADMINISTRA, nombre: 'La Otra Secretaria' });
  const suya = comoOtroUsuario(ella.id);

  const antes = await suya('GET', `/usuarios/${laOtra.id}`);
  const r = await suya('PUT', `/usuarios/${laOtra.id}`, { ...antes.json, rol: 'admin' });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}`);
  assert.match(r.json.error, /que usted no tiene/);

  const quedo = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(laOtra.id);
  assert.equal(quedo.rol, 'secretario');
});

test('el aviso dice cuántos son y nombra algunos, para saber qué se está dando', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const laOtra = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const suya = comoOtroUsuario(ella.id);
  const antes = await suya('GET', `/usuarios/${laOtra.id}`);
  const r = await suya('PUT', `/usuarios/${laOtra.id}`, {
    ...antes.json, permisos: { sistema_configuracion: ['view', 'edit'] },
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /permiso\(s\) que usted no tiene/);
  assert.match(r.json.error, /Configuración del sistema/, 'nombra lo que se estaría dando');
  assert.match(r.json.error, /Nadie puede conceder lo que no alcanza/);
});

test('pero sí le concede lo que él mismo tiene', async () => {
  /**
   * La contracara. Repartir el trabajo es de lo que se trata el módulo: quien
   * administra cuentas tiene que poder darle a otra persona lo que él alcanza.
   */
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: { usuarios: ['view', 'create', 'edit'], miembros: ['view', 'edit'] } });
  const laOtra = unaCuenta({ rol: 'consulta' });
  const suya = comoOtroUsuario(ella.id);

  const antes = await suya('GET', `/usuarios/${laOtra.id}`);
  const r = await suya('PUT', `/usuarios/${laOtra.id}`, { ...antes.json, permisos: { miembros: ['view', 'edit'] } });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.ok(can(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laOtra.id), 'miembros', 'edit'));
});

test('y quitarle permisos a otro se sigue pudiendo: quitar no es escalar', async () => {
  await elSistemaAndando();
  const ella = unaCuenta({ permisos: QUIEN_ADMINISTRA });
  const laOtra = unaCuenta({ rol: 'secretario', permisos: { miembros: ['view', 'edit'] } });
  const suya = comoOtroUsuario(ella.id);

  const antes = await suya('GET', `/usuarios/${laOtra.id}`);
  const r = await suya('PUT', `/usuarios/${laOtra.id}`, { ...antes.json, permisos: { miembros: [] } });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(can(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laOtra.id), 'miembros', 'edit'), false);
});

test('el administrador sigue pudiendo todo, que es de lo que se trata su rol', async () => {
  await elSistemaAndando();
  const jefe = unaCuenta({ rol: 'admin' });
  const otra = unaCuenta({ rol: 'consulta' });
  const suya = comoOtroUsuario(jefe.id);

  const antes = await suya('GET', `/usuarios/${otra.id}`);
  const r = await suya('PUT', `/usuarios/${otra.id}`, { ...antes.json, rol: 'admin' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(otra.id).rol, 'admin');
});

/* --------------------------------------------------------------------- */
/* La cuenta de lo que se gana, que es de donde sale la regla             */
/* --------------------------------------------------------------------- */

test('«lo que se gana» mira las tres capas, y no en cuál está escrito', async () => {
  /**
   * Lo que importa no es si el permiso viene del rol, del perfil o de la
   * excepción, sino qué puede hacer la persona al final. Si mirara solo una
   * capa, se escaparía por las otras dos.
   */
  const secre = { rol: 'secretario', permisos: JSON.stringify({ usuarios: ['view'] }) };
  const subida = { ...secre, rol: 'admin' };
  const gana = loQueSeGana(secre, subida);
  assert.ok(gana.length > 50, `subir a administrador tiene que ganar muchos permisos, y ganó ${gana.length}`);
  assert.ok(gana.includes('sistema_configuracion:edit'), 'entre ellos, la configuración');
  assert.ok(!gana.includes('usuarios:view'), 'lo que ya tenía no se cuenta como ganado');
});

test('y lo que se pierde no cuenta: quitar no es ganar', () => {
  const antes = { rol: 'admin' };
  const despues = { rol: 'consulta' };
  assert.deepEqual(loQueSeGana(antes, despues), [],
    'bajar de rol no gana nada, así que la regla no puede estorbarlo');
});

test('cada permiso se sabe nombrar, que es lo que hace útil el aviso', () => {
  assert.match(nombreDelPermiso('sistema_configuracion:edit'), /Configuración del sistema/);
  assert.match(nombreDelPermiso('usuarios:delete'), /Usuarios/);
  // Uno que no existe no revienta el aviso
  assert.ok(nombreDelPermiso('loquesea:view').length > 0);
});

test('un administrador concede todo lo que hay, así que nunca se topa con la regla', () => {
  const todo = loQueConcede({ rol: 'admin' });
  assert.ok(todo.size > 100, `el administrador tiene que alcanzarlo todo, y alcanza ${todo.size}`);
  assert.deepEqual(loQueSeGana({ rol: 'consulta' }, { rol: 'admin' }).filter((x) => !todo.has(x)), [],
    'no puede haber nada que se gane y que el administrador no tenga');
});
