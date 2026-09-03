/**
 * El RUT con el que se entra al sistema no se borra desde la otra ficha.
 *
 * Un usuario del sistema puede estar enlazado a su ficha de miembro. Enlazadas,
 * las dos son la misma persona: el RUT, el nombre, el correo, el teléfono y la
 * foto se mantienen iguales en las dos y da igual por dónde se cambien. Eso
 * funciona, y tiene sus pruebas.
 *
 * LO QUE NO ESTABA PREVISTO ES EL BORRADO. Apareció escribiendo las pruebas de
 * las reglas del módulo de Usuarios (US-04), donde hacía falta una ficha sin
 * RUT para llegar a una de ellas:
 *
 *     ficha enlazada a una cuenta
 *     se deja el RUT en blanco desde Miembros
 *     la cuenta queda {"id":2,"rut":null}
 *
 * Y el RUT es con lo que se entra al sistema. Esa persona no puede volver a
 * entrar, y nada lo dice: la pantalla de Miembros guardó sin protestar, y en
 * Usuarios la cuenta sigue ahí, activa, con su rol y sus permisos.
 *
 * Es recuperable —un administrador se lo vuelve a escribir en Usuarios, donde
 * el campo es obligatorio— pero mientras tanto esa persona está fuera y nadie
 * sabe por qué. Y el camino de ida está cuidado: por el formulario de Usuarios
 * el RUT no se puede borrar. Se cuela por el otro lado.
 *
 * Un RUT no se quita: se corrige. Así que ahora se dice que no, y se dice por
 * qué. Y debajo, un seguro para lo que no pasa por el formulario.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `rut-entra-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 22100000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

async function unaIglesia(api) {
  const r = await api('POST', '/iglesias', {
    nombre: `Iglesia del RUT ${M} ${siguiente}`, codigo: `RUT${process.pid}${siguiente++}`, estado: 'Activa',
  });
  assert.equal(r.estado, 201, `guardia: la iglesia tiene que entrar: ${r.texto.slice(0, 200)}`);
  return r.json;
}

/** Una ficha de miembro y su cuenta de acceso, enlazadas por el mismo RUT. */
async function unaPersonaConCuenta(api, nombres, apellidos) {
  const igl = await unaIglesia(api);
  const rut = unRut();
  const ficha = await api('POST', '/miembros', {
    nombres, apellidos: `${apellidos} ${M}`, iglesia_id: igl.id, estado: 'Activo', rut,
  });
  assert.equal(ficha.estado, 201, `guardia: la ficha tiene que entrar: ${ficha.texto.slice(0, 200)}`);

  const cuenta = await api('POST', '/usuarios', { rut, nombre: `${nombres} ${apellidos}`, rol: 'consulta' });
  assert.equal(cuenta.estado, 201, `guardia: la cuenta tiene que entrar: ${cuenta.texto.slice(0, 300)}`);
  assert.equal(Number(cuenta.json.miembro_id), ficha.json.id, 'guardia: quedaron enlazadas por el RUT');

  return { ficha: ficha.json, cuenta: cuenta.json, rut };
}

const cuentaComoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

/* --------------------------------------------------------------------- */
/* La regla, donde se le puede explicar a quien lo intenta                */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: no se le borra el RUT a la ficha de quien entra al sistema', async () => {
  const api = await elSistemaAndando();
  const { ficha, cuenta, rut } = await unaPersonaConCuenta(api, 'Fernanda', 'Riquelme');

  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  const r = await api('PUT', `/miembros/${ficha.id}`, { ...abierta, rut: '', igual_asi: true });

  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 250)}`);
  assert.match(r.json.error, /enlazada a la cuenta de acceso/);
  assert.match(r.json.error, /no podría volver a entrar/);
  assert.match(r.json.error, /Fernanda Riquelme/, 'y dice de quién es la cuenta');

  assert.equal(cuentaComoQuedo(cuenta.id).rut, rut, 'la cuenta conserva su RUT');
  assert.equal(db.prepare('SELECT rut FROM miembros WHERE id = ?').get(ficha.id).rut, rut,
    'y la ficha también: el guardado entero no ocurrió');
});

test('LA CONTRACARA: corregirlo por otro sí se puede, y le llega a la cuenta', async () => {
  /**
   * Es lo que hace que la regla no estorbe. Lo normal no es borrar un RUT sino
   * arreglar uno mal escrito, y eso tiene que seguir siendo un solo guardado.
   */
  const api = await elSistemaAndando();
  const { ficha, cuenta } = await unaPersonaConCuenta(api, 'Camilo', 'Bravo');

  const corregido = unRut();
  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  const r = await api('PUT', `/miembros/${ficha.id}`, { ...abierta, rut: corregido, igual_asi: true });

  assert.equal(r.estado, 200, `corregirlo tiene que poder: ${r.texto.slice(0, 250)}`);
  assert.equal(db.prepare('SELECT rut FROM miembros WHERE id = ?').get(ficha.id).rut, corregido);
  assert.equal(cuentaComoQuedo(cuenta.id).rut, corregido, 'y la cuenta queda con el corregido');
});

test('y una ficha SIN cuenta enlazada sí puede quedar sin RUT', async () => {
  /**
   * La otra contracara, y es la que decide el alcance de la regla: en Miembros
   * el RUT es opcional a propósito —hay fichas antiguas que no lo tienen— y
   * eso no cambia. Lo que se cuida es la cuenta de acceso, no el campo.
   */
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api);
  const ficha = (await api('POST', '/miembros', {
    nombres: 'Sin', apellidos: `Cuenta ${M}`, iglesia_id: igl.id, estado: 'Activo', rut: unRut(),
  })).json;
  assert.ok(!db.prepare('SELECT id FROM usuarios WHERE miembro_id = ?').get(ficha.id),
    'guardia: esta ficha no tiene cuenta');

  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  const r = await api('PUT', `/miembros/${ficha.id}`, { ...abierta, rut: '', igual_asi: true });
  assert.equal(r.estado, 200, `sin cuenta enlazada tiene que dejarlo: ${r.texto.slice(0, 250)}`);
  assert.equal(db.prepare('SELECT rut FROM miembros WHERE id = ?').get(ficha.id).rut, null);
});

/* --------------------------------------------------------------------- */
/* El seguro de abajo, para lo que no pasa por el formulario              */
/* --------------------------------------------------------------------- */

test('LA QUE SE ESCAPABA POR EL OTRO LADO: una ficha que ya está sin RUT no se lo borra a la cuenta', async () => {
  /**
   * La regla de arriba atiende a quien lo intenta desde la pantalla. Esto es
   * para lo que no pasa por ahí: una importación, una ficha que quedó sin RUT
   * antes de que la regla existiera, un arreglo hecho a mano en la base.
   * Ninguno de esos tiene por qué dejar a nadie fuera del sistema.
   *
   * Se arma exactamente ese caso: se le quita el RUT a la ficha por debajo, y
   * después se guarda la ficha por cualquier otra cosa —un teléfono— para que
   * corra la copia hacia la cuenta.
   */
  const api = await elSistemaAndando();
  const { ficha, cuenta, rut } = await unaPersonaConCuenta(api, 'Elena', 'Muñoz');
  db.prepare('UPDATE miembros SET rut = NULL WHERE id = ?').run(ficha.id);

  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  const r = await api('PUT', `/miembros/${ficha.id}`, { ...abierta, telefono: '+56955556666', igual_asi: true });
  assert.equal(r.estado, 200, `guardar la ficha tiene que seguir pudiéndose: ${r.texto.slice(0, 250)}`);

  const quedo = cuentaComoQuedo(cuenta.id);
  assert.equal(quedo.rut, rut, 'la cuenta conserva el RUT con el que se entra');
  assert.equal(quedo.telefono, '+56955556666', 'y lo que sí cambió, se copió');
});

test('el nombre tampoco se le vacía, que es con lo que se la reconoce', async () => {
  /**
   * Por el formulario no se puede llegar —nombres y apellidos son
   * obligatorios— pero es la misma clase de dato: obligatorio en Usuarios, así
   * que un vacío no es un valor que esa cuenta pueda tener.
   */
  const api = await elSistemaAndando();
  const { ficha, cuenta } = await unaPersonaConCuenta(api, 'Rodrigo', 'Peña');
  const comoSeLlama = cuentaComoQuedo(cuenta.id).nombre;
  assert.ok(comoSeLlama, 'guardia: la cuenta tiene nombre');

  db.prepare("UPDATE miembros SET nombres = '', apellidos = '' WHERE id = ?").run(ficha.id);
  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  await api('PUT', `/miembros/${ficha.id}`, { ...abierta, telefono: '+56977778888', igual_asi: true });

  assert.equal(cuentaComoQuedo(cuenta.id).nombre, comoSeLlama);
});

test('LA CONTRACARA DEL SEGURO: el correo sí se vacía en los dos lados', async () => {
  /**
   * Sin esto, el seguro sería «no borrar nunca nada», y entonces un correo
   * viejo se quedaría para siempre en la cuenta después de borrarlo en la
   * ficha. El correo, el teléfono y la foto son datos de contacto: borrarlos
   * en un lado tiene que borrarlos en el otro.
   */
  const api = await elSistemaAndando();
  const { ficha, cuenta } = await unaPersonaConCuenta(api, 'Sofía', 'Alarcón');

  const conCorreo = (await api('GET', `/miembros/${ficha.id}`)).json;
  await api('PUT', `/miembros/${ficha.id}`,
    { ...conCorreo, email: `sofia.${process.pid}@ipt.cl`, telefono: '+56911112222', igual_asi: true });
  assert.equal(cuentaComoQuedo(cuenta.id).email, `sofia.${process.pid}@ipt.cl`, 'guardia: se copió');

  const abierta = (await api('GET', `/miembros/${ficha.id}`)).json;
  const r = await api('PUT', `/miembros/${ficha.id}`, { ...abierta, email: '', telefono: '', igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 250));

  const quedo = cuentaComoQuedo(cuenta.id);
  assert.equal(quedo.email, null, 'borrado en la ficha, borrado en la cuenta');
  assert.equal(quedo.telefono, null);
});
