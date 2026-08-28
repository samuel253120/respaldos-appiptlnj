/**
 * Por lo que la gente se acuerda de un culto.
 *
 * El buscador de servicios miraba el coordinador, el salmista, el predicador y
 * las observaciones. No el tipo ni el libro predicado, que son las dos maneras
 * en que se nombra un culto: «el de la vigilia» y «el que predicaron de Éxodo».
 * Medido en la revisión del módulo, con doce servicios cargados: «Coordinadora»
 * daba 4 y «Vigilia», «Éxodo», «Especial» y «Juan 3:16» daban CERO, que no se
 * lee como «busque de otra forma» sino como «no está».
 *
 * La cita es el caso aparte: «Juan 3:16» no está en ninguna columna —son tres, y
 * los dos puntos los pone la pantalla al leer—, así que se arma en la propia
 * consulta. Lo que se vigila acá es que se encuentre como se dice, y que el
 * mecanismo que lo permite no abra un dato reservado por la puerta de atrás.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const registry = require('../../server/registry');
const servicios = require('../../server/modules/servicios');
const busqueda = require('../../server/busqueda');
const fs = require('fs');
const path = require('path');

const buscador = fs.readFileSync(path.join(__dirname, '../../server/buscador.js'), 'utf8');
const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Buscador ZZ','SRV-BUS','Activa')")
  .run().lastInsertRowid;

/** Un servicio ya registrado, con los números como los guarda el motor: REAL. */
function servicio(campos) {
  const fila = { tipo: 'Servicio General', iglesia_id: iglesia, ...campos };
  const claves = Object.keys(fila);
  db.prepare(`INSERT INTO servicios (${claves.join(',')}) VALUES (${claves.map(() => '?').join(',')})`)
    .run(...claves.map((k) => fila[k]));
}

servicio({
  fecha: '2029-02-04', predicador: 'Carlos Rojas Vera',
  mensaje_libro: 'Juan', mensaje_capitulo: 3, mensaje_versiculo_inicial: 16, mensaje_versiculo_final: 18,
});
servicio({
  fecha: '2029-02-11', tipo: 'Servicio Vigilia', predicador: 'Ana Silva Vera',
  mensaje_libro: 'Éxodo', mensaje_capitulo: 20, mensaje_versiculo_inicial: 1,
  salmo_libro: 'Salmos', salmo_capitulo: 23, salmo_versiculo_inicial: 1,
});
servicio({ fecha: '2029-02-18', tipo: 'Clase de Dorcas', observaciones: 'Sin novedad' });

/** Cuántos servicios de ESTA iglesia encuentra lo que se teclee. */
function encuentra(texto) {
  /*
   * Los trozos van como SQL a secas: desde la 1.167.0 el módulo los declara como
   * { sql, reservado } —para que uno que toca un dato reservado se le dé solo a
   * quien tiene su llave— y quien los usa los pide ya recortados. Acá ninguno lo
   * es, así que basta con sacarles el sql.
   */
  const trozos = servicios.buscaTambien.map((t) => (typeof t === 'string' ? t : t.sql));
  const c = busqueda.condicion(texto, servicios.searchFields, trozos);
  if (!c) return 0;
  return db
    .prepare(`SELECT COUNT(*) AS n FROM servicios WHERE iglesia_id = ? AND (${c.sql})`)
    .get(iglesia, ...c.params).n;
}

/* ------------------------------------------------- por lo que uno se acuerda */

test('«Vigilia» encuentra la vigilia', () => {
  assert.equal(encuentra('Vigilia'), 1);
});

test('«Dorcas» encuentra la clase de Dorcas', () => {
  assert.equal(encuentra('Dorcas'), 1);
});

test('«Éxodo» encuentra el que se predicó de Éxodo, con tilde y sin ella', () => {
  assert.equal(encuentra('Éxodo'), 1);
  assert.equal(encuentra('Exodo'), 1);
});

test('y las personas se siguen encontrando como siempre', () => {
  assert.equal(encuentra('Carlos'), 1);
  assert.equal(encuentra('Silva Vera'), 1);
  assert.equal(encuentra('Sin novedad'), 1);
});

/* ------------------------------------------------------- la cita, como se dice */

test('«Juan 3:16» encuentra el servicio donde se predicó', () => {
  assert.equal(encuentra('Juan 3:16'), 1);
});

test('y «3:16» solo también', () => {
  assert.equal(encuentra('3:16'), 1);
});

test('el salmo leído se busca igual que el mensaje', () => {
  assert.equal(encuentra('Salmos 23:1'), 1);
});

test('el capítulo guardado como número no rompe la cita', () => {
  /*
   * El motor guarda los números como REAL, así que el capítulo 3 está en la
   * base como 3.0: pegado sin más, lo buscable decía «juan 3.0:16.0» y «Juan
   * 3:16» no encontraba nada. En pantalla nunca se notó, porque un 3.0 llega a
   * la pantalla como 3.
   */
  const crudo = db.prepare('SELECT mensaje_capitulo AS c FROM servicios WHERE mensaje_libro = ? AND iglesia_id = ?')
    .get('Juan', iglesia).c;
  assert.equal(crudo, 3);
  const armada = db
    .prepare(`SELECT ${servicios.buscaTambien[0].sql} AS cita FROM servicios WHERE mensaje_libro = ? AND iglesia_id = ?`)
    .get('Juan', iglesia).cita;
  assert.equal(armada, 'Juan 3:16');
});

test('un servicio sin libro no deja un « :» suelto en lo buscable', () => {
  const armada = db
    .prepare(`SELECT ${servicios.buscaTambien[1].sql} AS cita FROM servicios WHERE tipo = ? AND iglesia_id = ?`)
    .get('Clase de Dorcas', iglesia).cita;
  assert.equal(armada, '');
});

/* ------------------------------------------------------------- el mecanismo */

test('el módulo declara lo que se busca y lo que se arma', () => {
  for (const campo of ['tipo', 'salmo_libro', 'mensaje_libro', 'predicador', 'observaciones']) {
    assert.ok(servicios.searchFields.includes(campo), `falta ${campo} en lo buscable`);
  }
  assert.equal(servicios.buscaTambien.length, 2);
});

test('lo que se arma entra en el texto buscable, junto a las columnas', () => {
  const texto = busqueda.textoBuscable(['tipo'], ['1 + 1']);
  assert.match(texto, /coalesce\("tipo",''\)/);
  assert.match(texto, /coalesce\(1 \+ 1,''\)/);
});

test('solo con lo armado, sin ninguna columna, la búsqueda igual se hace', () => {
  assert.ok(busqueda.condicion('juan', [], servicios.buscaTambien));
  assert.equal(busqueda.condicion('juan', [], []), null);
  assert.equal(busqueda.condicion('', ['tipo'], servicios.buscaTambien), null);
});

test('un módulo que no declara nada se queda sin nada que armar', () => {
  // `normalize` deja el módulo listo en el mismo objeto, no devuelve otro
  const def = { name: 'zz_sin_nada', label: 'ZZ', fields: [{ name: 'nombre', type: 'text' }] };
  registry.normalizarParaPruebas(def);
  assert.deepEqual(def.buscaTambien, []);
});

test('y uno que quisiera buscar por un dato reservado no carga', () => {
  /*
   * El motor le quita los campos reservados a la lista de buscables, pero no
   * puede leer adentro de una expresión: sin esta revisión, un trozo de SQL
   * dejaría encontrar a alguien por su enfermedad a quien no puede ni verla.
   */
  assert.throws(
    () => registry.normalizarParaPruebas({
      name: 'zz_indiscreto', label: 'ZZ',
      fields: [{ name: 'nombre', type: 'text' }, { name: 'enfermedades', type: 'text', sensible: true }],
      buscaTambien: ["coalesce(enfermedades,'')"],
    }),
    /reservado/
  );
});

test('el buscador de arriba busca lo mismo que el listado', () => {
  // Los dos piden los trozos ya recortados para quien busca (ver la 1.167.0 y
  // `buscaTambienPara` en server/sensibles.js)
  assert.match(crud, /sensibles\.buscaTambienPara\(def, req\.user\)/);
  assert.match(buscador, /buscaTambienPara\(def, usuario\)/);
});
