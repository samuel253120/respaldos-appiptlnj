/**
 * UN DESPLEGABLE QUE ADMITÍA CUALQUIER COSA.
 *
 * Ochenta y un campos del sistema son un desplegable y setenta y siete traen
 * escrita su lista. Ninguno la comprobaba al guardar: la pantalla ofrecía las
 * opciones de siempre y por la API entraba lo que fuera. Medido contra el
 * sistema andando, antes de esto:
 *
 *   tipo de ayuda «Vestuario» ..........  201, guardado así
 *   tipo de ayuda «Lo que sea» .........  201, guardado así
 *   estado de una ayuda «Regalada» .....  201, guardado así
 *   ¿a quién se le ayuda? «Vecino» .....  201, y la ayuda quedó SIN
 *                                         beneficiario, porque la regla que
 *                                         copia el nombre solo conoce dos
 *   estado de un miembro «Cualquier cosa» 200
 *   estado de una cuenta «Congelada» ...  200
 *
 * Se encontró revisando Ayudas Sociales y no es de ese módulo: es del motor, y
 * arreglarlo una vez los arregla en los treinta y nueve.
 *
 * Lo que cuida este archivo:
 *   · que un valor que la lista no ofrece se rechace, y el reparo diga cuáles
 *     son las opciones
 *   · que vacío no cuente como valor inventado
 *   · que las listas que vienen de una ruta no se comprueben contra una copia
 *   · y —lo que hace que esto se pueda publicar— que una ficha que YA trae un
 *     valor fuera de su lista se siga pudiendo guardar
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const opciones = require('../../server/opciones');
const { allModules, getModule } = require('../../server/registry');

/** El `cambia` de crud.js, que es con lo que se llama de verdad. */
const comoEnCrud = (data, existing) => (nombre) => {
  const val = data[nombre];
  if (val === undefined) return false;
  if (!existing) return true;
  const antes = existing[nombre];
  return String(antes == null ? '' : antes) !== String(val == null ? '' : val);
};

const revisar = (def, data, existing) =>
  opciones.loQueNoEstaEnLaLista(def, data, comoEnCrud(data, existing));

const AYUDAS = getModule('ayudas_sociales');
const MIEMBROS = getModule('miembros');
const PASTORES = getModule('pastores');

/* ------------------------------- lo que se rechaza */

test('un valor que la lista no ofrece no se guarda', () => {
  const r = revisar(AYUDAS, { tipo_ayuda: 'Lo que sea' });
  assert.match(r, /"Tipo de ayuda" no admite "Lo que sea"/);
});

test('y el reparo dice cuáles son las opciones, para poder contestarlo', () => {
  const r = revisar(AYUDAS, { tipo_ayuda: 'Vestuario' });
  assert.match(r, /Las opciones son: Alimentos, Económica/);
  assert.match(r, /Otro\.$/, 'la lista entera, no las tres primeras');
});

test('vale para cualquier módulo, no solo para las ayudas', () => {
  assert.match(revisar(MIEMBROS, { estado: 'Cualquier cosa' }), /"Estado" no admite/);
  assert.match(revisar(AYUDAS, { beneficiario_tipo: 'Vecino' }), /no admite "Vecino"/);
});

test('lo que la lista sí ofrece pasa', () => {
  assert.equal(revisar(AYUDAS, { tipo_ayuda: 'Ropa', estado: 'Aprobada' }), null);
});

test('una lista escrita como objeto se compara por su valor, no por su etiqueta', () => {
  /*
   * Dos campos del sistema declaran sus opciones como {valor, etiqueta}: el mes
   * de una cuota y el rol de un usuario. Lo que se guarda es el valor —«01»,
   * «admin»—, así que es lo que hay que comparar; comparando la etiqueta,
   * «Enero» pasaría y «01» no, que es exactamente al revés.
   */
  const USUARIOS = getModule('usuarios');
  assert.equal(revisar(USUARIOS, { rol: 'admin' }), null);
  assert.match(revisar(USUARIOS, { rol: 'Administrador' }), /no admite "Administrador"/);
  assert.match(revisar(USUARIOS, { rol: 'jefe' }), /no admite "jefe"/);
});

/* ------------------------------- lo que no se toca */

test('vacío no es un valor inventado: es no haber contestado', () => {
  for (const v of [null, '', '   ', undefined]) {
    assert.equal(revisar(AYUDAS, { tipo_ayuda: v }), null, JSON.stringify(v));
  }
});

test('las listas que vienen de una ruta no se comprueban contra una copia', () => {
  /*
   * Diecinueve campos sacan sus opciones de una tabla que la iglesia mantiene
   * —las categorías de tesorería, los tipos de actividad— y esa lista cambia
   * sola. Comprobarla acá contra una copia sería inventar una segunda verdad.
   */
  const TESORERIA = getModule('tesoreria');
  const categoria = TESORERIA.fields.find((f) => f.name === 'categoria');
  assert.ok(categoria.optionsRoute, 'la categoría saca su lista de una ruta');
  assert.equal(opciones.tieneListaPropia(categoria), false);
  assert.equal(revisar(TESORERIA, { categoria: 'Una categoría que la iglesia acaba de crear' }), null);

  /*
   * Y el caso que hoy no existe pero que la regla promete: un campo que declare
   * las dos cosas, una lista escrita Y una ruta. Manda la ruta.
   *
   * Se prueba con un módulo inventado y no buscándolo entre los de verdad,
   * porque hoy no hay ninguno así —los diecinueve con ruta no traen lista— y
   * una prueba que lo buscara pasaría sin comprobar nada. Se vio al romper a
   * propósito esa condición y ver que no se caía nada.
   */
  const inventado = {
    name: 'de_mentira',
    fields: [{
      name: 'categoria', label: 'Categoría', type: 'select',
      options: ['Una', 'Otra'], optionsRoute: '/lo_que_sea/opciones',
    }],
  };
  assert.equal(opciones.tieneListaPropia(inventado.fields[0]), false, 'manda la ruta, no la lista');
  assert.equal(revisar(inventado, { categoria: 'La que la iglesia acaba de crear' }), null);
});

test('y hoy ningún campo de verdad declara las dos cosas', () => {
  /*
   * Para que la nota de arriba siga siendo cierta: el día que alguien le ponga
   * una lista a un campo que ya saca sus opciones de una ruta, esta prueba lo
   * dice y quien la lea encuentra escrito cuál de las dos manda.
   */
  const dobles = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (f.optionsRoute && Array.isArray(f.options) && f.options.length) dobles.push(`${m.name}.${f.name}`);
    }
  }
  assert.deepEqual(dobles, []);
});

/* ------------------------------- lo que ya estaba */

test('una ficha que ya trae un valor fuera de su lista se sigue pudiendo guardar', () => {
  /*
   * Esto es lo que hace que la comprobación se pueda publicar. Medido sobre los
   * datos de prueba ANTES de escribirla, cuatro campos traían valores fuera de
   * su lista sin que nadie los hubiera inventado: dos pastores con cargo
   * «Pastor» —que la lista no ofrece, porque distingue «Pastora» de «Pastor
   * Presbítero»—, cuentas con el ámbito abreviado, y once anotaciones del
   * Registro de Cambios con acciones que ese módulo escribe por su cuenta.
   *
   * Si se mirara la ficha entera, entrar a corregirle el teléfono a ese pastor
   * daría un reparo por un cargo que él no eligió, y la ficha quedaría
   * imposible de guardar. Se frena el guardado que EMPEORA las cosas, no el que
   * simplemente no arregla algo que ya estaba: la misma regla de las fechas.
   */
  const deAntes = { id: 1, cargo: 'Pastor' };
  assert.equal(revisar(PASTORES, { telefono: '+56 9 1111 2222' }, deAntes), null);

  // Y reenviar el mismo valor tampoco lo frena: es lo que hace la pantalla, que
  // agrega el valor guardado al desplegable marcado «(valor anterior)»
  assert.equal(revisar(PASTORES, { cargo: 'Pastor' }, deAntes), null);

  // Pero corregirlo a otro inventado, sí
  assert.match(revisar(PASTORES, { cargo: 'Obispo' }, deAntes), /no admite "Obispo"/);

  // Y una vez corregido al de la lista, ya no se puede volver atrás
  const corregido = { id: 1, cargo: 'Pastor Presbítero' };
  assert.equal(revisar(PASTORES, { cargo: 'Pastor Presbítero' }, corregido), null);
  assert.match(revisar(PASTORES, { cargo: 'Pastor' }, corregido), /no admite "Pastor"/);
});

/* ------------------------------- que el motor la use, y que las listas se sostengan */

test('el guardado del motor la llama, con el mismo `cambia` de las fechas', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(src, /opciones\.loQueNoEstaEnLaLista\(def, data, cambia\)/);
  assert.match(src, /if \(fueraDeLista\) return res\.status\(400\)/);
});

test('el valor por omisión de cada desplegable está en su propia lista', () => {
  /*
   * Si no lo estuviera, crear una ficha sin tocar ese campo se frenaría sola:
   * el motor pone el valor por omisión y esta misma comprobación lo rechazaría.
   * Se revisa acá para que nadie lo descubra al publicar.
   */
  const malos = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (!opciones.tieneListaPropia(f)) continue;
      if (f.default === undefined || f.default === null || f.default === '') continue;
      if (!opciones.loQueOfrece(f).includes(String(f.default))) malos.push(`${m.name}.${f.name} → ${f.default}`);
    }
  }
  assert.deepEqual(malos, []);
});

test('ningún desplegable declara una lista vacía o con huecos', () => {
  const malos = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (f.type !== 'select' || f.optionsRoute) continue;
      const lista = opciones.loQueOfrece(f);
      if (!lista.length) malos.push(`${m.name}.${f.name} sin opciones`);
      if (lista.some((v) => !v.trim())) malos.push(`${m.name}.${f.name} con una opción vacía`);
    }
  }
  assert.deepEqual(malos, []);
});
