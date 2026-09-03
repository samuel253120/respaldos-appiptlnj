/**
 * QUIÉN HIZO EL CAMBIO: EL SISTEMA LO SABÍA, LO GUARDABA, Y NO LO DECÍA.
 *
 * Medido sobre una anotación automática cualquiera:
 *
 *   lo que la fila trae en `registrado_por` ....  «Administrador»
 *   y en `created_by` ..........................  1
 *   lo que la pantalla mostraba en esa línea ...  «⚙️ automático»
 *   lo que muestra en una escrita a mano .......  «✍️ Administrador»
 *
 * «Automático» dice CÓMO se escribió la línea, no quién la provocó. Detrás de
 * cada anotación automática hay una persona que guardó una ficha: quien cambió
 * el estado a Inactivo, quien la sacó del cuerpo, quien aprobó la solicitud. El
 * sistema anota su nombre en la misma fila y la pantalla lo tapaba con un
 * engranaje —mientras que en una nota escrita a mano sí lo mostraba—, así que
 * se veía quién escribió una nota y no quién movió una ficha.
 *
 * Lo que cuida este archivo:
 *   · que el nombre se guarde siempre, venga la anotación de donde venga
 *   · que sea el de quien de verdad guardó, y no el del dueño de la ficha
 *   · que la pantalla lo diga, en la pestaña y en el listado del módulo
 *   · y que «Sistema» —el nombre de cuando no hubo nadie— no se repita al
 *     lado del engranaje, que sería decir dos veces lo mismo
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const registry = require('../../server/registry');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Quién lo hizo', 'IG-QLH', 'Activa')")
  .run().lastInsertRowid;
const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run('Julia', 'Movida', iglesia).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES ('Damas de Quién', 'Dorcas', ?)")
  .run(iglesia).lastInsertRowid;

const ROSA = { id: 21, nombre: 'Rosa la Secretaria' };
const ADMIN = { id: 1, nombre: 'Administrador' };

/** Guardar algo como lo guarda el motor, y devolver lo que quedó anotado. */
function alGuardar(modulo, fila, user, { isNew = true, antes = {} } = {}) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(registry.getModule(modulo), {
    isNew, antes, despues: fila, datos: fila, user,
  });
  // Acotado a la iglesia de este archivo: los del motor corren en paralelo
  // sobre una sola base, y «lo que se anotó después del id tal» también trae
  // lo que anotó otra prueba en el mismo instante. Nadie más puede escribir
  // una anotación de ESTA iglesia, que es de este archivo.
  return db.prepare('SELECT * FROM bitacora WHERE id > ? AND iglesia_id = ? ORDER BY id').all(desde, iglesia);
}

/* ------------------------------- el nombre se guarda, y es el correcto */

test('la anotación guarda el nombre de quien guardó la ficha', () => {
  const [alta] = alGuardar('miembros', { id: miembro, iglesia_id: iglesia, nombres: 'Julia', apellidos: 'Movida' }, ADMIN);
  assert.equal(alta.registrado_por, 'Administrador');
  assert.equal(alta.created_by, 1, 'y también su número de usuario');
  assert.equal(alta.origen, 'Automático');
});

test('si la mueve otra persona, la anotación lleva SU nombre', () => {
  const [cambio] = alGuardar('miembros',
    { id: miembro, iglesia_id: iglesia, estado: 'Inactivo' }, ROSA,
    { isNew: false, antes: { estado: 'Activo' } });
  assert.equal(cambio.registrado_por, 'Rosa la Secretaria',
    'es quien guardó, no el dueño de la ficha ni el que la creó');
  assert.equal(cambio.created_by, 21);
});

test('vale para las anotaciones que vienen de otros módulos', () => {
  const [ingreso] = alGuardar('integrantes_cuerpo', {
    id: 501, miembro_id: miembro, cuerpo_id: cuerpo, iglesia_id: iglesia,
    estado: 'Activo', fecha_ingreso: '2026-01-15',
  }, ROSA);
  assert.equal(ingreso.registrado_por, 'Rosa la Secretaria');

  const [ayuda] = alGuardar('ayudas_sociales', {
    id: 502, miembro_id: miembro, iglesia_id: iglesia, fecha: '2026-03-10',
    tipo_ayuda: 'Mercadería', estado: 'Entregada',
  }, ADMIN);
  assert.equal(ayuda.registrado_por, 'Administrador');
});

test('cuando no hay nadie detrás, queda «Sistema»', () => {
  const [sola] = alGuardar('miembros',
    { id: miembro, iglesia_id: iglesia, telefono: '+56 9 1111 2222' }, null,
    { isNew: false, antes: { telefono: null } });
  assert.equal(sola.registrado_por, 'Sistema');
  assert.equal(sola.created_by, null);
});

test('el módulo lo guarda en un campo de solo lectura, y no se puede escribir', () => {
  const campo = registry.getModule('bitacora').fields.find((f) => f.name === 'registrado_por');
  assert.equal(campo.readonly, true,
    'si se pudiera escribir, el nombre dejaría de ser constancia de nada');
});

/* ------------------------------- y la pantalla lo dice */

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const elHistorial = app.slice(app.indexOf('async function renderHistorial'), app.indexOf('function abrirAnotacion'));

test('la pestaña dice quién provocó una anotación automática', () => {
  assert.ok(elHistorial.length > 500, 'no se encontró el trozo que pinta el historial');
  assert.match(elHistorial, /automático\$\{loHizo \? ' · por ' \+ loHizo : ''\}/,
    'antes decía solo «⚙️ automático» y ahí terminaba');
});

test('y no repite «Sistema» al lado del engranaje', () => {
  assert.match(elHistorial, /r\.registrado_por !== 'Sistema'/,
    'decir «automático · por Sistema» es decir dos veces lo mismo');
});

test('las escritas a mano siguen mostrando a su autor, como siempre', () => {
  assert.match(elHistorial, /'✍️ ' \+ esc\(r\.registrado_por \|\| ''\)/);
});

test('el listado del módulo trae la columna, junto a «Origen»', () => {
  const def = registry.getModule('bitacora');
  assert.ok(def.listFields.includes('registrado_por'),
    'el listado contestaba «Automático» y ahí terminaba, teniendo el nombre en la misma fila');
  assert.ok(def.listFields.includes('origen'),
    'las dos hacen falta: una dice cómo se escribió la línea y la otra quién');
  assert.equal(def.listFields.indexOf('registrado_por'), def.listFields.indexOf('origen') + 1,
    'y van juntas, que es donde se leen de a pares');
});

test('esa columna no agrega huecos al listado', () => {
  // Es la lección de NM-07 en el otro módulo: una columna que casi siempre está
  // en blanco deja el listado MÁS vacío, no más completo. Esta no: el módulo la
  // escribe en cada anotación, sea del equipo o del sistema.
  const filas = db.prepare('SELECT registrado_por FROM bitacora').all();
  assert.ok(filas.length >= 5, 'hacen falta filas para que esto pruebe algo');
  const vacias = filas.filter((r) => !r.registrado_por || !String(r.registrado_por).trim()).length;
  assert.equal(vacias, 0, `${vacias} de ${filas.length} anotaciones quedaron sin nombre`);
});
