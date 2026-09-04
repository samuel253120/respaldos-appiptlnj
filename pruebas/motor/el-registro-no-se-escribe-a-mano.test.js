/**
 * Las dos reglas del Registro de Cambios, que son lo único que tiene.
 *
 * El módulo se escribe solo: no se puede agregar una línea, ni corregirla, ni
 * borrarla, ni siendo administrador. Es su promesa central —«un registro que se
 * puede maquillar no sirve para lo que existe»— y son dos ganchos de una línea
 * cada uno.
 *
 * No los probaba nadie. Veintiséis archivos de prueba escriben o leen esta
 * tabla —es de las más consultadas del sistema, porque media docena de
 * correcciones terminan comprobando que algo quedó anotado— y ninguno
 * comprobaba las reglas del módulo mismo. Hay uno que cita el mensaje del
 * borrado, pero para otra cosa: que al borrar una iglesia sus líneas se suelten
 * en vez de arrastrarse. Medido en la v1.370.0: quitando los dos ganchos, la
 * batería entera seguía en verde.
 *
 * Se prueba con el sistema ANDANDO —el mismo router del servidor, con su
 * autenticación— y hasta el 400 que recibe quien lo pide, porque lo que hace
 * falta comprobar no es que la regla esté escrita sino que el motor la corra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { prepararFila } = require('../../server/importar');

test.after(cerrarElSistema);

const registro = getModule('registro_cambios');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Libro NM','NM-LIB','Activa')")
  .run().lastInsertRowid;

/* La línea que el SISTEMA escribió, que es la única manera en que se escriben. */
const suya = db.prepare(
  `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id)
   VALUES ('2026-08-04','13:00','Tesorería','Cambio','De la prueba NM',1,'Monto: $ 1 → $ 2','Sistema',?)`
).run(iglesia).lastInsertRowid;

const comoQuedo = () => db.prepare('SELECT * FROM registro_cambios WHERE id = ?').get(suya);

test('agregar una línea a mano se rechaza, y con su razón', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/registro_cambios', {
    fecha: '2026-08-04', hora: '13:30', modulo: 'Tesorería', accion: 'Cambio',
    registro: 'Inventada NM', detalle: 'Monto: $ 900.000 → $ 90', usuario: 'Nadie', iglesia_id: iglesia,
  });
  assert.equal(r.estado, 400, `contestó ${r.estado}: ${r.texto.slice(0, 160)}`);
  assert.match(r.json.error, /lo escribe el sistema solo/);
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE registro = 'Inventada NM'").get().c, 0,
    'no quedó escrita'
  );
});

test('y tampoco se puede corregir una que ya está', async () => {
  const api = await elSistemaAndando();
  const antes = comoQuedo();
  const r = await api('PUT', `/registro_cambios/${suya}`, { ...antes, detalle: 'Monto: $ 1 → $ 1' });
  assert.equal(r.estado, 400, `contestó ${r.estado}: ${r.texto.slice(0, 160)}`);
  assert.match(r.json.error, /no se agrega ni se corrige a mano/);
  assert.equal(comoQuedo().detalle, 'Monto: $ 1 → $ 2', 'la línea quedó como estaba');
});

test('ni borrar: para eso está', async () => {
  const api = await elSistemaAndando();
  const r = await api('DELETE', `/registro_cambios/${suya}?igual_asi=true`);
  assert.equal(r.estado, 400, `contestó ${r.estado}: ${r.texto.slice(0, 160)}`);
  assert.match(r.json.error, /no se borra: para eso está/);
  assert.ok(comoQuedo(), 'la línea sigue ahí');
});

test('las tres se le niegan al ADMINISTRADOR, que es de quien hay que cuidarlas', () => {
  /*
   * La sesión de estas pruebas es de administrador general, así que los tres
   * rechazos de arriba ya son con todos los permisos abiertos. Se deja dicho
   * acá para que no se lea como un caso de permisos: no es que le falte una
   * llave, es que la puerta no existe para nadie.
   */
  const { MATRIX } = require('../../server/permissions');
  assert.deepEqual(MATRIX.admin['*'], ['view', 'create', 'edit', 'delete'],
    'el administrador puede todo sobre todo, y aun así el registro se le niega');
});

test('la planilla tampoco entra por el otro camino', () => {
  /*
   * La importación es la otra puerta por la que entran datos al sistema, y en
   * su momento se saltó reglas que el formulario sí aplicaba. Acá consulta el
   * mismo gancho, así que una planilla de líneas inventadas se rechaza fila
   * por fila.
   */
  const { errores } = prepararFila(registro, {
    fecha: '2026-08-04', modulo: 'Tesorería', accion: 'Cambio', registro: 'De planilla NM',
  }, { id: 1, rol: 'admin' });
  assert.ok(errores.some((e) => /lo escribe el sistema solo/.test(e)),
    `la planilla no fue rechazada: ${JSON.stringify(errores)}`);
});

test('y su propio borrado no se anota, porque no puede ocurrir', () => {
  // La línea está escrita a propósito en BORRADOS_QUE_NO_SE_ANOTAN: sobra
  // mientras la regla exista, y se deja para que nadie la agregue por descuido.
  const bitacora = require('fs').readFileSync(require.resolve('../../server/bitacora'), 'utf8');
  assert.match(bitacora, /BORRADOS_QUE_NO_SE_ANOTAN = \[[^\]]*'registro_cambios'/);
});

test('los dos ganchos siguen declarados en el módulo', () => {
  // Por si alguien los borra creyendo que sobran: las tres pruebas de arriba
  // se ponen rojas, y esta dice cuál es la pieza que falta.
  assert.equal(typeof registro.hooks.beforeSave, 'function');
  assert.equal(typeof registro.hooks.beforeDelete, 'function');
  assert.match(registro.hooks.beforeSave(), /no se agrega ni se corrige a mano/);
  assert.match(registro.hooks.beforeDelete(), /para eso está/);
});
