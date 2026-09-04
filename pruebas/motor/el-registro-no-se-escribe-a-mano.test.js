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

test('la planilla tampoco entra por el otro camino', async () => {
  /*
   * La importación es la otra puerta por la que entran datos al sistema, y en
   * su momento se saltó reglas que el formulario sí aplicaba. Se rechaza ANTES
   * de mirar las filas: contestar quinientas veces lo mismo no dice más que
   * decirlo una, y lo que hay que decir es que por acá no se entra.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/importar/registro_cambios', {
    prueba: true,
    filas: [{ fecha: '2026-08-04', modulo: 'Tesorería', accion: 'Cambio', registro: 'De planilla NM' }],
  });
  assert.equal(r.estado, 400, `contestó ${r.estado}: ${r.texto.slice(0, 160)}`);
  assert.match(r.json.error, /lo escribe el sistema solo/);
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE registro = 'De planilla NM'").get().c, 0
  );
});

test('y su propio borrado no se anota, porque no puede ocurrir', () => {
  // La línea está escrita a propósito en BORRADOS_QUE_NO_SE_ANOTAN: sobra
  // mientras la regla exista, y se deja para que nadie la agregue por descuido.
  const bitacora = require('fs').readFileSync(require.resolve('../../server/bitacora'), 'utf8');
  assert.match(bitacora, /BORRADOS_QUE_NO_SE_ANOTAN = \[[^\]]*'registro_cambios'/);
});

test('la regla está declarada, y con las palabras del módulo', () => {
  // Por si alguien la borra creyendo que sobra: las cuatro pruebas de arriba se
  // ponen rojas, y esta dice cuál es la pieza que falta.
  assert.match(registro.soloLectura.alGuardar, /no se agrega ni se corrige a mano/);
  assert.match(registro.soloLectura.alBorrar, /para eso está/);
});

test('y el motor no deja declararla a medias', () => {
  /*
   * Sin los dos mensajes, el motor no tendría qué contestar y la puerta
   * quedaría abierta. Se revienta al arrancar, que es donde se nota.
   */
  const { revisarLoQueSeEscribeSoloParaPruebas } = require('../../server/registry');
  assert.throws(
    () => revisarLoQueSeEscribeSoloParaPruebas({ name: 'inventado', soloLectura: { alGuardar: 'no' } }),
    /no dice qué contestar en «alBorrar»/
  );
  assert.throws(
    () => revisarLoQueSeEscribeSoloParaPruebas({ name: 'inventado', soloLectura: true }),
    /no dice qué contestar en «alGuardar»/
  );
});

test('y la pantalla no ofrece los botones que el módulo se niega a atender', () => {
  /*
   * Antes de esto, el listado le ofrecía al ADMINISTRADOR «Nuevo cambio
   * registrado», «Importar» y el lápiz y el tarro de basura de cada fila, y
   * los cuatro contestaban 400. La descripción del sistema miraba solo sus
   * permisos, que los tiene todos.
   */
  const { loQuePuedeHacerEn } = require('../../server/permissions');
  const admin = { id: 1, rol: 'admin' };
  assert.deepEqual(loQuePuedeHacerEn(registro, admin),
    { view: true, create: false, edit: false, delete: false });
  assert.deepEqual(loQuePuedeHacerEn(getModule('tesoreria'), admin),
    { view: true, create: true, edit: true, delete: true },
    'y donde sí se escribe, no cambia nada');
});
