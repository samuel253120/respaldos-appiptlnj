/**
 * Un administrador no lleva perfil de permisos, y las dos puertas dicen lo
 * mismo.
 *
 * El módulo de Perfiles lo tenía decidido desde siempre: su ruta para repartir
 * un perfil termina en «AND rol != 'admin'», y la lista de cuentas a las que
 * ofrecérselo tampoco los trae. Tiene sentido: el rol de administrador ya le da
 * todo lo que el sistema puede dar, así que un perfil solo podría QUITARLE
 * cosas, y para eso están las excepciones de su ficha, que son de esa persona y
 * no de un grupo.
 *
 * Lo que faltaba era decirlo en la otra puerta. MEDIDO EN LA v1.327.0, sobre la
 * misma cuenta de administrador y con el mismo perfil:
 *
 *   por la ruta del perfil → 200 {"puestos":0,"ajenas":0} · quedó en null
 *   por su ficha ......... → 200 · quedó en 5
 *
 * Las dos son la misma decisión y contestaban distinto. Y lo de la ruta era
 * peor que la contradicción: «200» es «salió bien», con un cero adentro. Quien
 * lo pedía desde la pantalla no veía ningún aviso: veía que no pasó nada, y no
 * sabía por qué.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `admin-perfil-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 22700000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

function unPerfil(permisos = { miembros: ['view'] }) {
  const nombre = `Perfil ${unRut()} ${M}`;
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(nombre, JSON.stringify(permisos)).lastInsertRowid);
  return { id, nombre };
}

function unaCuenta({ rol = 'consulta', perfil = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, perfil_id) VALUES (?, ?, ?, 1, ?)'
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, rol, perfil).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

const comoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

/* --------------------------------------------------------------------- */
/* Las dos puertas, diciendo lo mismo                                     */
/* --------------------------------------------------------------------- */

test('LA QUE FALTABA: por su ficha tampoco se le pone un perfil a un administrador', async () => {
  const api = await elSistemaAndando();
  const jefe = unaCuenta({ rol: 'admin', nombre: `Jefe ${M}` });
  const perfil = unPerfil();

  const r = await api('PUT', `/usuarios/${jefe.id}`,
    { ...(await api('GET', `/usuarios/${jefe.id}`)).json, perfil_id: perfil.id });

  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /Un administrador no lleva perfil/);
  assert.match(r.json.error, /Excepciones para esta persona/, 'y dice qué usar en su lugar');
  assert.equal(comoQuedo(jefe.id).perfil_id, null);
});

test('y la ruta del perfil dice POR QUÉ, en vez de contestar un cero', async () => {
  /**
   * Lo de antes no era solo la contradicción: contestaba 200, que es «salió
   * bien», con «puestos: 0» adentro. Quien lo pedía desde la pantalla veía que
   * no pasó nada y no tenía cómo saber por qué.
   */
  const api = await elSistemaAndando();
  const jefe = unaCuenta({ rol: 'admin', nombre: `Jefa ${M}` });
  const perfil = unPerfil();

  const r = await api('POST', `/perfiles_permisos/${perfil.id}/usuarios`, { usuarios: [jefe.id] });
  assert.equal(r.estado, 403, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /es administrador/);
  assert.match(r.json.error, new RegExp(`Jefa ${M}`), 'y dice de quién habla');
  assert.equal(comoQuedo(jefe.id).perfil_id, null);
});

test('tampoco se sube a administrador a quien lleva un perfil puesto', async () => {
  /**
   * La misma pareja por el otro lado: si el rol es lo que cambia, el resultado
   * sería igual —un administrador con perfil— y el aviso tiene que ser el
   * mismo, no un silencio.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const cuenta = unaCuenta({ rol: 'secretario', perfil: perfil.id, nombre: `Sube de rol ${M}` });

  const r = await api('PUT', `/usuarios/${cuenta.id}`,
    { ...(await api('GET', `/usuarios/${cuenta.id}`)).json, rol: 'admin' });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /Un administrador no lleva perfil/);
  assert.equal(comoQuedo(cuenta.id).rol, 'secretario', 'y el rol no cambió');
});

test('ni se crea uno nuevo con perfil de entrada', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Nace administrador ${M}`, rol: 'admin', perfil_id: perfil.id,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /Un administrador no lleva perfil/);
});

/* --------------------------------------------------------------------- */
/* Las contracaras                                                        */
/* --------------------------------------------------------------------- */

test('LA CONTRACARA: al que no es administrador se le sigue poniendo, por las dos', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const porLaFicha = unaCuenta({ rol: 'secretario' });
  const porLaRuta = unaCuenta({ rol: 'tesorero' });

  const uno = await api('PUT', `/usuarios/${porLaFicha.id}`,
    { ...(await api('GET', `/usuarios/${porLaFicha.id}`)).json, perfil_id: perfil.id });
  assert.equal(uno.estado, 200, uno.texto.slice(0, 200));
  assert.equal(Number(comoQuedo(porLaFicha.id).perfil_id), perfil.id);

  const dos = await api('POST', `/perfiles_permisos/${perfil.id}/usuarios`, { usuarios: [porLaRuta.id] });
  assert.equal(dos.estado, 200, dos.texto.slice(0, 200));
  assert.equal(dos.json.puestos, 1);
});

test('y a un administrador que ya lo tenía se le puede quitar, que es como se limpia', async () => {
  /**
   * Es la salida. Si la regla frenara también el quitarlo, una cuenta que
   * quedó así de antes no habría forma de arreglarla desde el sistema.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const jefe = unaCuenta({ rol: 'admin', perfil: perfil.id, nombre: `Jefe con herencia ${M}` });

  const porLaRuta = await api('DELETE', `/perfiles_permisos/${perfil.id}/usuarios/${jefe.id}`);
  assert.equal(porLaRuta.estado, 200, `sacárselo tiene que poder: ${porLaRuta.texto.slice(0, 200)}`);
  assert.equal(comoQuedo(jefe.id).perfil_id, null);

  db.prepare('UPDATE usuarios SET perfil_id = ? WHERE id = ?').run(perfil.id, jefe.id);
  const porLaFicha = await api('PUT', `/usuarios/${jefe.id}`,
    { ...(await api('GET', `/usuarios/${jefe.id}`)).json, perfil_id: null });
  assert.equal(porLaFicha.estado, 200, `y por su ficha también: ${porLaFicha.texto.slice(0, 200)}`);
  assert.equal(comoQuedo(jefe.id).perfil_id, null);
});

test('y su ficha se sigue guardando aunque arrastre un perfil de antes', async () => {
  /**
   * La regla mira lo que CAMBIA. Una cuenta que quedó así antes de que esto
   * existiera tiene que poder seguir corrigiéndose el teléfono sin tropezar
   * con un aviso sobre algo que nadie está tocando.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const jefe = unaCuenta({ rol: 'admin', perfil: perfil.id, nombre: `Jefe de antes ${M}` });

  const r = await api('PUT', `/usuarios/${jefe.id}`,
    { ...(await api('GET', `/usuarios/${jefe.id}`)).json, telefono: '+56955667788' });
  assert.equal(r.estado, 200, `tenía que poder guardarse: ${r.texto.slice(0, 200)}`);
  assert.equal(Number(comoQuedo(jefe.id).perfil_id), perfil.id, 'y el perfil sigue donde estaba');
});

test('bajar de administrador a alguien que arrastra un perfil sí se puede', async () => {
  /**
   * El caso que arregla la situación: si el rol deja de ser administrador, la
   * pareja deja de ser un problema y no hay nada que avisar.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const jefe = unaCuenta({ rol: 'admin', perfil: perfil.id, nombre: `Deja de ser jefe ${M}` });

  const r = await api('PUT', `/usuarios/${jefe.id}`,
    { ...(await api('GET', `/usuarios/${jefe.id}`)).json, rol: 'secretario' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(comoQuedo(jefe.id).rol, 'secretario');
  assert.equal(Number(comoQuedo(jefe.id).perfil_id), perfil.id);
});

test('y la lista de a quiénes ofrecérselo sigue sin traer administradores', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const jefe = unaCuenta({ rol: 'admin', nombre: `Jefe que no sale ${M}` });
  const otra = unaCuenta({ rol: 'consulta', nombre: `Sí sale ${M}` });

  const { disponibles } = (await api('GET', `/perfiles_permisos/${perfil.id}/usuarios`)).json;
  assert.ok(!disponibles.some((u) => u.id === jefe.id), 'el administrador no se ofrece');
  assert.ok(disponibles.some((u) => u.id === otra.id), 'y la que sí puede llevarlo, sí');
});
