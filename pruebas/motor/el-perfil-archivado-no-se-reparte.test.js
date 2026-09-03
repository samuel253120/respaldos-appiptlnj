/**
 * Un perfil archivado no se le pone a nadie nuevo.
 *
 * La ayuda del campo «Estado» de un perfil lo promete con todas sus letras:
 *
 *     «Un perfil archivado ya no se ofrece al asignar, pero sigue funcionando
 *      para quienes ya lo tienen.»
 *
 * Archivar es lo que la iglesia hace con un perfil que decidió no volver a usar
 * y que no puede borrar porque alguien todavía lo lleva puesto.
 *
 * MEDIDO EN LA v1.327.0. La primera mitad era cierta: el desplegable de la
 * ficha de usuario deja de ofrecerlo, y ese filtro funciona. La segunda no:
 *
 *   ¿aparece en el desplegable? ........................... no
 *   PUT /usuarios/21 {perfil_id: archivado} .............. 200
 *   POST /perfiles_permisos/archivado/usuarios ........... 200 {"puestos":1}
 *
 * O sea que «ya no se ofrece» era exacto y «ya no se asigna» no era cierto: lo
 * único que hacía el archivado era esconderlo de una lista. Cualquier petición
 * que trajera ese número se lo ponía igual —y un formulario abierto antes de
 * archivarlo todavía trae ese número—.
 *
 * Estas pruebas cierran las dos puertas y cuidan la otra mitad de la promesa,
 * que es la que hace que archivar sirva para algo: quien ya lo tiene, lo
 * conserva y le sigue funcionando.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { can } = require('../../server/permissions');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `archivado-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 22500000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

function unPerfil(estado, permisos = { miembros: ['view'] }) {
  const nombre = `Perfil ${estado.toLowerCase()} ${unRut()} ${M}`;
  const id = Number(db.prepare(
    'INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, ?, ?)'
  ).run(nombre, estado, JSON.stringify(permisos)).lastInsertRowid);
  return { id, nombre };
}

function unaCuenta({ perfil = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo, perfil_id) VALUES (?, ?, 'consulta', 1, ?)"
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, perfil).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

const comoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

/* --------------------------------------------------------------------- */
/* Las dos puertas                                                        */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: por la ficha del usuario no se le pone un perfil archivado', async () => {
  const api = await elSistemaAndando();
  const archivado = unPerfil('Archivado');
  const cuenta = unaCuenta();

  const r = await api('PUT', `/usuarios/${cuenta.id}`,
    { ...(await api('GET', `/usuarios/${cuenta.id}`)).json, perfil_id: archivado.id });

  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /está archivado/);
  assert.match(r.json.error, new RegExp(archivado.nombre.slice(0, 20)), 'y dice cuál es');
  assert.match(r.json.error, /Quien ya lo tiene lo conserva/, 'y que a nadie se le quita');
  assert.equal(comoQuedo(cuenta.id).perfil_id, null);
});

test('ni por la ficha del perfil, que es la otra puerta al mismo cambio', async () => {
  const api = await elSistemaAndando();
  const archivado = unPerfil('Archivado');
  const cuenta = unaCuenta();

  const r = await api('POST', `/perfiles_permisos/${archivado.id}/usuarios`, { usuarios: [cuenta.id] });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /está archivado/);
  assert.equal(comoQuedo(cuenta.id).perfil_id, null);
});

test('tampoco al crear una cuenta nueva', async () => {
  /**
   * El caso que se cuela por el lado: una cuenta que nace con el perfil
   * puesto no tiene «perfil anterior» con el que comparar.
   */
  const api = await elSistemaAndando();
  const archivado = unPerfil('Archivado');

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Recién creada ${M}`, rol: 'consulta', perfil_id: archivado.id,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /está archivado/);
});

/* --------------------------------------------------------------------- */
/* La otra mitad de la promesa                                            */
/* --------------------------------------------------------------------- */

test('LA CONTRACARA: quien ya lo tiene lo conserva, y le sigue funcionando', async () => {
  /**
   * Es la mitad que hace que archivar sirva para algo. Si al archivar un perfil
   * dejara de funcionar, archivar sería borrar, y entonces no haría falta.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil('Activo', { miembros: ['view', 'edit'] });
  const cuenta = unaCuenta({ perfil: perfil.id, nombre: `Ya lo tenía ${M}` });
  assert.equal(can(comoQuedo(cuenta.id), 'miembros', 'edit'), true, 'guardia: el perfil le funciona');

  db.prepare("UPDATE perfiles_permisos SET estado = 'Archivado' WHERE id = ?").run(perfil.id);

  assert.equal(can(comoQuedo(cuenta.id), 'miembros', 'edit'), true,
    'archivado el perfil, a quien ya lo tiene le tiene que seguir funcionando');

  const guardar = await api('PUT', `/usuarios/${cuenta.id}`,
    { ...(await api('GET', `/usuarios/${cuenta.id}`)).json, telefono: '+56911223344' });
  assert.equal(guardar.estado, 200, `y su ficha se tiene que poder seguir guardando: ${guardar.texto.slice(0, 200)}`);
  assert.equal(Number(comoQuedo(cuenta.id).perfil_id), perfil.id, 'sin que se le caiga el perfil');
});

test('y archivar un perfil que mucha gente tiene puesto se sigue pudiendo', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil('Activo');
  unaCuenta({ perfil: perfil.id });
  unaCuenta({ perfil: perfil.id });

  const r = await api('PUT', `/perfiles_permisos/${perfil.id}`,
    { ...(await api('GET', `/perfiles_permisos/${perfil.id}`)).json, estado: 'Archivado' });
  assert.equal(r.estado, 200, `archivarlo es justamente lo que hay que poder hacer: ${r.texto.slice(0, 200)}`);
  assert.equal((await api('GET', `/perfiles_permisos/${perfil.id}`)).json.estado, 'Archivado');
});

test('y sacárselo a quien lo tiene también, que es como se termina de limpiar', async () => {
  const api = await elSistemaAndando();
  const archivado = unPerfil('Archivado');
  const cuenta = unaCuenta({ perfil: archivado.id });

  const r = await api('DELETE', `/perfiles_permisos/${archivado.id}/usuarios/${cuenta.id}`);
  assert.equal(r.estado, 200, `sacarlo tiene que poder: ${r.texto.slice(0, 200)}`);
  assert.equal(comoQuedo(cuenta.id).perfil_id, null);
});

test('el perfil activo se sigue repartiendo por las dos puertas', async () => {
  const api = await elSistemaAndando();
  const activo = unPerfil('Activo');
  const porLaFicha = unaCuenta();
  const porLaRuta = unaCuenta();

  const uno = await api('PUT', `/usuarios/${porLaFicha.id}`,
    { ...(await api('GET', `/usuarios/${porLaFicha.id}`)).json, perfil_id: activo.id });
  assert.equal(uno.estado, 200, uno.texto.slice(0, 200));
  assert.equal(Number(comoQuedo(porLaFicha.id).perfil_id), activo.id);

  const dos = await api('POST', `/perfiles_permisos/${activo.id}/usuarios`, { usuarios: [porLaRuta.id] });
  assert.equal(dos.estado, 200, dos.texto.slice(0, 200));
  assert.equal(Number(comoQuedo(porLaRuta.id).perfil_id), activo.id);
});

/* --------------------------------------------------------------------- */
/* Y el desplegable, que ya estaba bien                                   */
/* --------------------------------------------------------------------- */

test('el desplegable de la ficha sigue ofreciendo solo los activos', async () => {
  const api = await elSistemaAndando();
  const activo = unPerfil('Activo');
  const archivado = unPerfil('Archivado');

  const ofrecidos = (await api('GET', '/perfiles_permisos/activos')).json;
  assert.ok(ofrecidos.some((p) => p.id === activo.id), 'el activo se ofrece');
  assert.ok(!ofrecidos.some((p) => p.id === archivado.id), 'el archivado no');
});
