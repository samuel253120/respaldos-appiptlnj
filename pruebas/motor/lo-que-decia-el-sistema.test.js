/**
 * CORREGIR A MANO LO QUE ANOTÓ EL SISTEMA DEJA CONSTANCIA DE LO QUE DECÍA.
 *
 * Medido sobre una anotación automática, con el lápiz que ofrece la propia
 * pantalla:
 *
 *   cambiarle el texto ..................  200, aceptado
 *   antes decía .........................  «Sale de "Damas de la Bitácora" (Traslado de ciudad).»
 *   quedó diciendo ......................  «Aquí no pasó nada.»
 *   y su origen seguía siendo ...........  Automático
 *   el texto original quedaba guardado en   ninguna parte
 *
 * Quedaba una anotación que dice «esto lo registró el sistema cuando ocurrió»,
 * con un texto escrito por una persona y sin rastro de lo que decía.
 *
 * Que las automáticas SE PUEDAN corregir es a propósito y está decidido —en el
 * seguimiento de una solicitud no se dejan tocar, y acá sí, porque una
 * redacción se corrige—. Lo que faltaba era que corregirlas no borrara nada.
 *
 * Lo que cuida este archivo:
 *   · que se guarde lo que decía, y quién la corrigió
 *   · que si se corrige dos veces siga guardado el PRIMER texto, que es el del
 *     sistema y no el de una corrección intermedia
 *   · que a una nota escrita a mano no se le haga esto: son las palabras de su
 *     autor y siguen siendo suyas después de que él las corrija
 *   · que guardar sin tocar el texto no marque nada
 *   · que nadie pueda escribir esos dos campos desde el formulario
 *   · y que la regla sea la misma en los tres historiales
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const registry = require('../../server/registry');
const laRegla = require('../../server/lo-que-decia-el-sistema');

const QUIEN = { id: 7, nombre: 'Quien Corrige' };
const DEL_SISTEMA = 'Sale de "Damas de la Bitácora" (Traslado de ciudad).';

/** Guardar como lo guarda el motor: el hook del módulo, sobre lo que ya estaba. */
function alCorregir(modulo, existing, data, user = QUIEN) {
  const copia = { ...data };
  registry.getModule(modulo).hooks.beforeSave(copia, {
    user, isNew: false, id: existing.id, existing, db: require('../../server/db').db,
  });
  return copia;
}

const automatica = (extra) => ({
  id: 1, origen: 'Automático', descripcion: DEL_SISTEMA, tipo: 'Salida de cuerpo',
  miembro_id: 1, iglesia_id: 1, ...extra,
});
const aMano = (extra) => ({
  id: 2, origen: 'Manual', registrado_por: 'Su Autora', descripcion: 'Se le visitó en su casa.',
  tipo: 'Visita', miembro_id: 1, iglesia_id: 1, ...extra,
});

/* ------------------------------- lo que anotó el sistema queda */

test('corregir una automática guarda lo que decía y quién la corrigió', () => {
  const data = alCorregir('bitacora', automatica(), { descripcion: 'Aquí no pasó nada.' });
  assert.equal(data.texto_original, DEL_SISTEMA, 'antes no quedaba en ninguna parte');
  assert.equal(data.corregido_por, 'Quien Corrige');
  assert.equal(data.descripcion, 'Aquí no pasó nada.', 'y la corrección se guarda igual: se puede corregir');
});

test('corregida dos veces, lo guardado sigue siendo el PRIMER texto', () => {
  // Lo que hay que poder leer después es lo que anotó el sistema, no por
  // cuántas manos pasó.
  const yaCorregida = automatica({
    descripcion: 'Aquí no pasó nada.', texto_original: DEL_SISTEMA, corregido_por: 'Quien Corrige',
  });
  const data = alCorregir('bitacora', yaCorregida, { descripcion: 'Ni esto tampoco.' }, { id: 8, nombre: 'Otra Persona' });
  assert.equal(data.texto_original, undefined,
    'no se vuelve a escribir: el original ya está guardado y no se pisa');
  assert.equal(data.corregido_por, 'Otra Persona', 'pero sí se dice quién la tocó esta vez');
});

/* ------------------------------- a lo escrito a mano no se le hace esto */

test('una nota a mano corregida por su autor no deja «texto original»', () => {
  const data = alCorregir('bitacora', aMano(), { descripcion: 'Se le visitó en su casa el jueves.' });
  assert.equal(data.texto_original, undefined,
    'en una nota a mano, «Origen» y «Registrado por» siguen siendo ciertos después de corregirla');
  assert.equal(data.corregido_por, undefined);
});

/* ------------------------------- guardar sin tocar el texto */

test('cambiarle el tipo, o la fecha, no la marca como corregida', () => {
  const soloTipo = alCorregir('bitacora', automatica(), { tipo: 'Anotación' });
  assert.equal(soloTipo.texto_original, undefined);
  assert.equal(soloTipo.corregido_por, undefined);

  const soloFecha = alCorregir('bitacora', automatica(), { fecha: '2025-11-30' });
  assert.equal(soloFecha.texto_original, undefined);
});

test('volver a guardar el MISMO texto no la marca', () => {
  const data = alCorregir('bitacora', automatica(), { descripcion: DEL_SISTEMA });
  assert.equal(data.texto_original, undefined,
    'abrir una anotación y guardarla sin cambiar nada no es corregirla');
});

test('un texto vacío que sigue vacío tampoco', () => {
  const data = alCorregir('bitacora', automatica({ descripcion: null }), { descripcion: '' });
  assert.equal(data.texto_original, undefined, 'null y "" son lo mismo acá');
});

test('pero vaciarle el texto a una que decía algo sí la marca', () => {
  const data = alCorregir('bitacora', automatica(), { descripcion: '' });
  assert.equal(data.texto_original, DEL_SISTEMA,
    'borrarle el texto es la manera más rápida de que la constancia deje de decir nada');
});

/* ------------------------------- nadie escribe esos dos campos */

test('los dos campos son de solo lectura en los tres historiales', () => {
  // El motor quita del formulario los campos de solo lectura ANTES del hook,
  // así que solo el sistema los puede poner. Comprobado además contra el
  // servidor: mandarlos a mano devuelve 200 y la fila no cambia.
  for (const nombre of ['bitacora', 'historial_iglesias', 'historial_pastores']) {
    const def = registry.getModule(nombre);
    for (const campo of ['texto_original', 'corregido_por']) {
      const f = def.fields.find((x) => x.name === campo);
      assert.ok(f, `${nombre} no declara ${campo}`);
      assert.equal(f.readonly, true, `${nombre}.${campo} tendría que ser de solo lectura`);
    }
  }
});

test('mandarlos en el guardado no los cambia', () => {
  const data = alCorregir('bitacora', automatica(), {
    descripcion: 'Aquí no pasó nada.', texto_original: 'Lo que yo quiera', corregido_por: 'Nadie',
  });
  assert.equal(data.texto_original, DEL_SISTEMA);
  assert.equal(data.corregido_por, 'Quien Corrige');
});

/* ------------------------------- la misma regla en los tres */

test('la regla es la misma en el historial de una iglesia y en el de un pastor', () => {
  const deIglesia = alCorregir('historial_iglesias',
    { id: 3, origen: 'Automático', descripcion: 'Se registra la iglesia en el sistema.', iglesia_id: 1 },
    { descripcion: 'Otra cosa.' });
  assert.equal(deIglesia.texto_original, 'Se registra la iglesia en el sistema.');
  assert.equal(deIglesia.corregido_por, 'Quien Corrige');

  const dePastor = alCorregir('historial_pastores',
    { id: 4, origen: 'Automático', descripcion: 'Pasa de Pastor a Pastor Titular.', pastor_id: 1, iglesia_id: 1 },
    { descripcion: 'Otra cosa.' });
  assert.equal(dePastor.texto_original, 'Pasa de Pastor a Pastor Titular.');
});

test('crear una anotación nunca deja constancia de nada, en ningún historial', () => {
  // Al crear, el motor deja `existing` en null, y esa es toda la guardia que
  // hace falta: preguntar además si es nueva no cambiaba nada, se comprobó
  // rompiéndolo, y se sacó por ser código de más.
  for (const nombre of ['bitacora', 'historial_iglesias', 'historial_pastores']) {
    const data = { descripcion: 'Recién nacida.', tipo: 'Anotación' };
    registry.getModule(nombre).hooks.beforeSave(data, {
      user: QUIEN, isNew: true, existing: null, db: require('../../server/db').db,
    });
    assert.equal(data.texto_original, undefined, nombre);
    assert.equal(data.corregido_por, undefined, nombre);
  }
});

/* ------------------------------- y la pantalla lo dice */

test('la pestaña del historial muestra que se corrigió y ofrece el original', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const bloque = app.slice(app.indexOf('async function renderHistorial'), app.indexOf('function abrirAnotacion'));
  assert.ok(bloque.length > 500, 'no se encontró el trozo que pinta el historial');
  assert.match(bloque, /const corregida = !!r\.texto_original/,
    'la fila tiene que saber si la corrigieron');
  assert.match(bloque, /corregida a mano/, 'y decirlo en la línea de abajo');
  assert.match(bloque, /details class="corregida"[\s\S]*?r\.texto_original/,
    'y ofrecer lo que había anotado el sistema, plegado');
});

test('la ventana de corrección avisa de que lo que diga ahora queda guardado', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const bloque = app.slice(app.indexOf('function abrirAnotacion'), app.indexOf('function abrirAnotacion') + 2600);
  assert.match(bloque, /lo que decía queda guardado/,
    'quien va a corregir tiene que saber que no está borrando nada');
  assert.match(bloque, /registro\.texto_original/,
    'y si ya se corrigió antes, ver ahí mismo lo que el sistema había anotado');
});
