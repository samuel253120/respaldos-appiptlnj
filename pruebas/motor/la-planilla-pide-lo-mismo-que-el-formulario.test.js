/**
 * Un campo que la pantalla no muestra, la planilla no lo puede exigir.
 *
 * Un campo puede declarar `showIf` para existir solo en algunos casos, y
 * entonces no se exige aunque sea obligatorio: pedirlo sería pedir algo que el
 * formulario ni siquiera dibuja. La ruta que guarda lo hacía bien desde
 * siempre. La importación de planillas no: exigía todos los obligatorios a
 * secas.
 *
 * MEDIDO en la v1.283.0, importando una ayuda social a nombre de un NO
 * MIEMBRO, en modo prueba:
 *
 *   errores de la fila ........ «Falta Miembro» Y «Falta No Miembro»
 *
 * Son un PAR EXCLUYENTE —o una cosa o la otra, nunca las dos—, así que ninguna
 * planilla de Ayudas Sociales podía entrar, fuera cual fuera el beneficiario.
 * Lo mismo en Integrantes de Cuerpo, en Personas de una Solicitud y en
 * Solicitudes: catorce campos así en siete módulos.
 *
 * Se descubrió al hacer obligatorio el número de la oficina de partes, que es
 * el decimocuarto de esos campos: la planilla habría empezado a pedir un
 * correlativo para lo que se archiva y no se numera. El archivo del módulo lo
 * cuenta entero; acá se fija que la regla sea UNA SOLA para los dos caminos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { seAplica } = require('../../server/crud');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

// ------------------------------------------------------- la regla, suelta ----

test('un campo sin condición se aplica siempre', () => {
  assert.equal(seAplica({ name: 'titulo' }, {}, null), true);
});

test('con condición «equals», se aplica solo cuando el otro campo vale eso', () => {
  const campo = { name: 'miembro_id', showIf: { field: 'tipo', equals: 'Miembro' } };
  assert.equal(seAplica(campo, { tipo: 'Miembro' }, null), true);
  assert.equal(seAplica(campo, { tipo: 'No miembro' }, null), false);
  assert.equal(seAplica(campo, {}, null), false, 'sin el otro campo, no aplica');
});

test('con condición «in», se aplica en cualquiera de los valores de la lista', () => {
  const campo = { name: 'numero', showIf: { field: 'flujo', in: ['Recibido', 'Emitido'] } };
  assert.equal(seAplica(campo, { flujo: 'Recibido' }, null), true);
  assert.equal(seAplica(campo, { flujo: 'Emitido' }, null), true);
  assert.equal(seAplica(campo, { flujo: 'Interno o de archivo' }, null), false);
});

test('al editar, lo que no viene se lee de lo que ya estaba guardado', () => {
  /*
   * Es lo que hace que un PUT que solo cambia el estado siga sabiendo de qué
   * flujo es el documento. Sin esto, cualquier guardado parcial decidiría la
   * condición sobre un campo vacío.
   */
  const campo = { name: 'numero', showIf: { field: 'flujo', in: ['Recibido', 'Emitido'] } };
  assert.equal(seAplica(campo, { estado: 'En trámite' }, { flujo: 'Recibido' }), true);
  assert.equal(seAplica(campo, { estado: 'En trámite' }, { flujo: 'Interno o de archivo' }), false);
  assert.equal(seAplica(campo, { flujo: 'Interno o de archivo' }, { flujo: 'Recibido' }),
    false, 'y lo que viene le gana a lo guardado');
});

// --------------------------------------- que la use el formulario Y la planilla ----

test('la ruta que guarda y la importación llaman a la MISMA función', () => {
  /*
   * El corazón de este arreglo. Estaban escritas dos veces —una dentro de la
   * ruta, la otra no estaba— y por eso podían decir cosas distintas. Si alguien
   * vuelve a escribir la condición adentro de cualquiera de las dos, esta
   * prueba se pone roja.
   */
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '../..');
  const crud = fs.readFileSync(path.join(raiz, 'server/crud.js'), 'utf8');
  const importar = fs.readFileSync(path.join(raiz, 'server/importar.js'), 'utf8');

  assert.equal((crud.match(/function seAplica\(/g) || []).length, 1, 'se define una sola vez');
  // Se mira que la LLAMEN, sin fijar la lista de argumentos: esa lista creció
  // una vez —para pasarle los campos del módulo— y no tiene por qué quedar
  // congelada por una prueba que en realidad cuida otra cosa.
  assert.match(crud, /const aplica = \(f\) => seAplica\(/, 'la ruta que guarda la usa');
  assert.match(importar, /seAplica\(f, datos, null/, 'y la importación también');
  assert.ok(!/showIf\.equals/.test(importar), 'la importación no vuelve a escribir la condición');
  assert.ok(!/showIf\.in/.test(importar), 'ni la otra forma de la condición');
});

// ------------------------------------------- los pares que se estorbaban ----

test('los pares excluyentes del sistema no se piden los dos a la vez', () => {
  /*
   * Recorre los módulos de verdad y comprueba que, para cada campo obligatorio
   * con condición, exista un caso en que NO se exige. Un par excluyente en que
   * los dos se exigieran siempre es una planilla que no puede entrar nunca.
   */
  const pares = [
    ['ayudas_sociales', 'beneficiario_tipo', 'miembro_id', 'no_miembro_id'],
    ['integrantes_cuerpo', 'persona_tipo', 'miembro_id', 'no_miembro_id'],
    ['personas_solicitud', 'persona_tipo', 'miembro_id', 'no_miembro_id'],
    ['solicitudes', 'solicitante_tipo', 'miembro_id', 'no_miembro_id'],
  ];
  for (const [modulo, decide, unoLado, otroLado] of pares) {
    const def = getModule(modulo);
    const uno = def.fields.find((f) => f.name === unoLado);
    const otro = def.fields.find((f) => f.name === otroLado);
    assert.ok(uno && otro, `${modulo}: están los dos campos`);
    assert.ok(uno.required && otro.required, `${modulo}: los dos son obligatorios`);

    const comoMiembro = { [decide]: 'Miembro' };
    const comoNo = { [decide]: 'No miembro' };
    assert.equal(seAplica(uno, comoMiembro, null), true, `${modulo}: se pide ${unoLado} cuando toca`);
    assert.equal(seAplica(otro, comoMiembro, null), false, `${modulo}: y NO se pide ${otroLado}`);
    assert.equal(seAplica(otro, comoNo, null), true);
    assert.equal(seAplica(uno, comoNo, null), false);
  }
});

test('ningún campo obligatorio con condición usa la forma «menorDe»', () => {
  /*
   * La única forma de `showIf` que esta función NO entiende es la que mira la
   * edad que da una fecha, y que solo se usa en la pantalla. Mientras ninguno
   * la combine con «obligatorio» no hay nada que decidir mal. Si mañana
   * aparece uno, esta prueba se pone roja antes de que decida que sí se exige
   * un campo que la pantalla escondió.
   */
  const { modules } = require('../../server/registry');
  const todos = Array.isArray(modules) ? modules : Object.values(modules || {});
  const culpables = [];
  for (const def of todos) {
    for (const f of (def.fields || [])) {
      if (f.required && f.showIf && f.showIf.menorDe !== undefined) {
        culpables.push(`${def.name}.${f.name}`);
      }
    }
  }
  assert.deepEqual(culpables, []);
});


// ------------------------------------------- y la planilla, de verdad ----

test('una planilla de ayudas a nombre de un NO MIEMBRO entra', async () => {
  /*
   * La prueba del hallazgo tal como se midió, por la ruta de verdad y no
   * llamando a la función suelta. Antes contestaba «Falta Miembro» Y «Falta No
   * Miembro» en la misma fila: los dos campos de un par excluyente, así que la
   * planilla no podía entrar de ninguna manera.
   *
   * Va en modo PRUEBA —que es como la usa la pantalla para mostrar el
   * resultado antes de confirmar— para que el resultado sea el informe de
   * errores y no un registro guardado.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `PL${m}`.slice(0, 18)).lastInsertRowid;
  const persona = db.prepare(
    'INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?, ?, ?)'
  ).run('Visita', m, iglesia).lastInsertRowid;

  const r = await api('POST', '/importar/ayudas_sociales', {
    prueba: true,
    filas: [{
      beneficiario_tipo: 'No miembro', no_miembro_id: persona, iglesia_id: iglesia,
      // «Solicitada» y no «Entregada»: una ayuda ya entregada tiene que decir
      // además de dónde salió la plata, y acá lo que se mira es otra cosa
      fecha: '2026-05-10', tipo_ayuda: 'Mercadería', estado: 'Solicitada',
    }],
  });
  assert.equal(r.estado, 200);
  const fallo = (r.json.errores || [])[0];
  const dice = fallo ? fallo.errores.join(' · ') : '';
  assert.ok(!/Falta Miembro/.test(dice), `no puede pedir el campo del otro lado: «${dice}»`);
  assert.equal(r.json.correctas, 1, `la fila entra; dijo: «${dice}»`);
});

test('y sigue pidiendo el que SÍ corresponde', async () => {
  /*
   * La otra mitad, que es lo que hace que el arreglo no sea «dejar de exigir».
   * Una fila que dice «No miembro» y no trae a nadie tiene que fallar.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `PM${m}`.slice(0, 18)).lastInsertRowid;

  const r = await api('POST', '/importar/ayudas_sociales', {
    prueba: true,
    filas: [{
      beneficiario_tipo: 'No miembro', iglesia_id: iglesia,
      fecha: '2026-05-10', tipo_ayuda: 'Mercadería', estado: 'Solicitada',
    }],
  });
  assert.equal(r.estado, 200);
  const dice = ((r.json.errores || [])[0] || { errores: [] }).errores.join(' · ');
  assert.match(dice, /Falta No Miembro/i, `debe pedir el de su lado: «${dice}»`);
  assert.ok(!/Falta Miembro\b/.test(dice), 'y solo el de su lado');
});

test('una planilla de documentos de archivo no pide correlativo', async () => {
  /*
   * El caso que este arreglo tuvo que resolver para poder existir: al hacer
   * obligatorio el número de la oficina de partes, la planilla habría empezado
   * a pedirlo también para lo que se archiva y no se numera.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `PN${m}`.slice(0, 18)).lastInsertRowid;

  const r = await api('POST', '/importar/documentos', {
    prueba: true,
    filas: [{
      flujo: 'Interno o de archivo', iglesia_id: iglesia,
      titulo: `Escritura del templo ${m}`, tipo: 'Escritura / Propiedad',
    }],
  });
  assert.equal(r.estado, 200);
  const dice = ((r.json.errores || [])[0] || { errores: [] }).errores.join(' · ');
  assert.ok(!/Falta N\.º de la oficina de partes/.test(dice), `no lo puede pedir: «${dice}»`);
  assert.equal(r.json.correctas, 1, `la fila entra; dijo: «${dice}»`);
});

test('pero una de documentos recibidos sí lo pide', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `PO${m}`.slice(0, 18)).lastInsertRowid;

  const r = await api('POST', '/importar/documentos', {
    prueba: true,
    filas: [{ flujo: 'Recibido', iglesia_id: iglesia, titulo: `Oficio ${m}` }],
  });
  assert.equal(r.estado, 200);
  const dice = ((r.json.errores || [])[0] || { errores: [] }).errores.join(' · ');
  assert.match(dice, /Falta N\.º de la oficina de partes/);
});
