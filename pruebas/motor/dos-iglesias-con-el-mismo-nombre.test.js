/**
 * Dos congregaciones que se llaman igual.
 *
 * El código no se puede repetir y el sistema lo hace cumplir bien. El NOMBRE
 * sí se repetía:
 *
 *   crear una segunda «Iglesia Central» ......... 201, sin decir nada
 *   y una tercera, «  iglesia   CENTRAL  » ...... 201, sin decir nada
 *   repetir el código ........................... 400, «ya existe otra»
 *
 * Y el nombre es lo ÚNICO que muestran los desplegables: el código, que es lo
 * que las distingue, no aparece en ninguna de las listas donde se elige a cuál
 * va un miembro, un movimiento o un certificado. Medido, el desplegable de un
 * miembro ofrecía tres opciones indistinguibles entre sí.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const migraciones = require('../../server/migraciones');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const IGLESIAS = getModule('iglesias');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const sembrar = (nombre, ciudad = null) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, ciudad, estado) VALUES (?, ?, ?, 'Activa')")
  .run(nombre, `REP${marca()}`, ciudad).lastInsertRowid;

/** El aviso al guardar una iglesia, o null. */
const alGuardar = (id, data, { existing = null, confirmado = false } = {}) =>
  IGLESIAS.hooks.beforeSave(data, { id, existing, db, confirmado });

// -------------------------------------------------------- la pregunta ----

test('crear una segunda iglesia con el mismo nombre pregunta', () => {
  const nombre = `Iglesia Repetida ${marca()}`;
  sembrar(nombre, 'Concepción');
  const pregunta = alGuardar(undefined, { nombre, codigo: `NUE${marca()}` });
  assert.equal(pregunta.confirmar, 'iglesia_con_el_mismo_nombre');
  assert.match(pregunta.error, /Concepción/, 'el aviso tiene que traer las señas de la que ya está');
  assert.match(pregunta.error, /código REP/, 'y su código, que es lo que las distingue');
  assert.match(pregunta.error, /desplegables/, 'y por qué importa');
});

test('y confirmada, deja pasar: el mismo nombre en dos ciudades es un caso real', () => {
  const nombre = `Iglesia Repetida ${marca()}`;
  sembrar(nombre, 'Concepción');
  assert.equal(alGuardar(undefined, { nombre, codigo: `NUE${marca()}` }, { confirmado: true }), null);
});

test('el nombre se compara sin tildes, sin mayúsculas y sin espacios de más', () => {
  const id = sembrar(`Iglesia Ñuñoa ${marca()}`, 'Santiago');
  const suyo = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id).nombre;
  for (const escrito of [suyo.toUpperCase(), `  ${suyo}  `, suyo.replace(/ /g, '   '),
                         suyo.normalize('NFD').replace(/[̀-ͯ]/g, '')]) {
    const pregunta = alGuardar(undefined, { nombre: escrito, codigo: `OTR${marca()}` });
    assert.ok(pregunta && pregunta.confirmar === 'iglesia_con_el_mismo_nombre',
      `«${escrito}» tendría que reconocerse como el mismo nombre`);
  }
});

test('un nombre distinto no pregunta nada', () => {
  sembrar(`Iglesia Una ${marca()}`);
  assert.equal(alGuardar(undefined, { nombre: `Iglesia Otra ${marca()}`, codigo: `DIS${marca()}` }), null);
});

test('y guardar la MISMA iglesia sin cambiarle el nombre tampoco', () => {
  /*
   * Si no, corregirle el teléfono a una de dos congregaciones que ya se llaman
   * igual —y que alguien ya aceptó— volvería a preguntarlo cada vez.
   */
  const nombre = `Iglesia Doble ${marca()}`;
  sembrar(nombre, 'Concepción');
  const id = sembrar(nombre, 'Temuco');
  const existing = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);

  assert.equal(alGuardar(id, { telefono: '+56 41 111 2222' }, { existing }), null,
    'este guardado no toca el nombre');
  assert.equal(alGuardar(id, { nombre }, { existing }), null,
    'y volver a mandar el mismo nombre no es cambiárselo');
  assert.equal(alGuardar(id, { nombre: `  ${nombre.toUpperCase()} ` }, { existing }), null,
    'ni mandarlo escrito distinto: es el mismo nombre');
});

test('pero cambiárselo a uno que ya existe, sí', () => {
  const nombre = `Iglesia Vieja ${marca()}`;
  sembrar(nombre, 'Concepción');
  const id = sembrar(`Iglesia Nueva ${marca()}`, 'Temuco');
  const existing = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  const pregunta = alGuardar(id, { nombre }, { existing });
  assert.equal(pregunta.confirmar, 'iglesia_con_el_mismo_nombre');
});

test('la pregunta del nombre va antes que la del pastor', () => {
  /*
   * El motor deja pasar UNA pregunta por guardado, y ésta es la más grave: una
   * congregación indistinguible en todos los desplegables del sistema.
   */
  const nombre = `Iglesia Ambas ${marca()}`;
  sembrar(nombre, 'Concepción');
  const otraIglesia = sembrar(`Iglesia Del Pastor ${marca()}`);
  const rut = `${33000000 + (process.pid % 300000) + n}`;
  const pastor = db.prepare(
    `INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, cargo, estado)
     VALUES ('Pedro', ?, ?, ?, 'Pastor Presbítero', 'Activo')`
  ).run(`Ajeno ${marca()}`, `${rut}-0`, otraIglesia).lastInsertRowid;

  const pregunta = alGuardar(undefined, { nombre, codigo: `AMB${marca()}`, pastor_id: pastor });
  assert.equal(pregunta.confirmar, 'iglesia_con_el_mismo_nombre');
});

test('y después de lo que se rechaza de plano', () => {
  const nombre = `Iglesia Sin Código ${marca()}`;
  sembrar(nombre);
  const rechazo = alGuardar(undefined, { nombre, codigo: '   ' });
  assert.equal(typeof rechazo, 'string', 'el código vacío se rechaza, no se pregunta');
});

// ------------------------------------------- el nombre, sin espacios de más ----

test('el nombre se guarda sin espacios de más', () => {
  /*
   * No es cosmética: es lo único que muestran los desplegables, y
   * «  iglesia   Central » salía tal cual, ordenándose antes que todas por el
   * espacio de adelante y pareciendo otra distinta de la que se llama igual.
   */
  const data = { nombre: '   Iglesia   De   Los   Espacios   ', codigo: `ESP${marca()}` };
  alGuardar(undefined, data, { confirmado: true });
  assert.equal(data.nombre, 'Iglesia De Los Espacios');
});

test('y la migración arregla los que ya estaban', () => {
  const feo = `   Iglesia   Vieja   ${marca()}   `;
  const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(feo, `VIE${marca()}`).lastInsertRowid;
  // La migración se marca como aplicada; para probarla se la llama derecho
  migraciones.losNombresDeIglesiaSinEspaciosDeMas(db);
  const ahora = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id).nombre;
  assert.equal(ahora, feo.replace(/\s+/g, ' ').trim());
});

// ---------------------------------------- el código en el desplegable ----

test('el desplegable muestra el código de las que se llaman igual, y solo de ésas', () => {
  const conElCodigo = IGLESIAS.comoSeOfrecen;
  const filas = [
    { id: 1, nombre: 'Iglesia Central', codigo: 'CENTRAL' },
    { id: 2, nombre: 'Iglesia Central', codigo: 'IG-002' },
    { id: 3, nombre: 'Iglesia Ñuñoa', codigo: 'NUNOA' },
  ];
  const salida = conElCodigo(filas.map((f) => ({ id: f.id, label: f.nombre })), filas);
  assert.deepEqual(salida.map((o) => o.label), [
    'Iglesia Central · CENTRAL',
    'Iglesia Central · IG-002',
    'Iglesia Ñuñoa',
  ]);
});

test('y las reconoce aunque estén escritas distinto', () => {
  const filas = [
    { id: 1, nombre: 'Iglesia Central', codigo: 'A' },
    { id: 2, nombre: '  iglesia   CENTRAL ', codigo: 'B' },
  ];
  const salida = IGLESIAS.comoSeOfrecen(filas.map((f) => ({ id: f.id, label: f.nombre })), filas);
  assert.ok(salida.every((o) => /· [AB]$/.test(o.label)), 'las dos tienen que llevar su código');
});

test('una sin código se queda con su nombre a secas', () => {
  const filas = [
    { id: 1, nombre: 'Iglesia Central', codigo: 'CENTRAL' },
    { id: 2, nombre: 'Iglesia Central', codigo: null },
  ];
  const salida = IGLESIAS.comoSeOfrecen(filas.map((f) => ({ id: f.id, label: f.nombre })), filas);
  assert.deepEqual(salida.map((o) => o.label), ['Iglesia Central · CENTRAL', 'Iglesia Central']);
});

test('el separador no es de los que la pantalla usa para acortar', () => {
  /*
   * La pantalla acorta el nombre de una iglesia partiéndolo por «/», «—» o «–»
   * —ver iglesiaDeTrabajo en public/app.js—, así que con cualquiera de esos el
   * código se perdería por el camino en la mitad de las listas.
   */
  const filas = [
    { id: 1, nombre: 'Iglesia Central', codigo: 'CENTRAL' },
    { id: 2, nombre: 'Iglesia Central', codigo: 'IG-002' },
  ];
  const salida = IGLESIAS.comoSeOfrecen(filas.map((f) => ({ id: f.id, label: f.nombre })), filas);
  for (const o of salida) assert.doesNotMatch(o.label, /[/—–|]/);
});

test('los dos caminos que ofrecen iglesias usan la MISMA función', () => {
  /*
   * La ruta propia del módulo —la que piden los formularios— y la genérica del
   * motor —la que piden los filtros—. Escrito dos veces, un día una mostraría
   * el código y la otra no, y el filtro volvería a tener dos opciones iguales.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/iglesias.js'), 'utf8');
  assert.match(modulo, /res\.json\(conElCodigoSiSeRepite\(/, 'la ruta propia');
  assert.match(modulo, /comoSeOfrecen: conElCodigoSiSeRepite,/, 'y la genérica, por el gancho');

  const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(crud, /def\.comoSeOfrecen \? def\.comoSeOfrecen\(opciones, rows\) : opciones/,
    'el motor tiene que llamarlo, o el gancho no sirve de nada');
});

// ------------------------------------------------ guardando de verdad ----

test('guardando de verdad: la segunda pregunta, y el desplegable las distingue', async () => {
  const api = await elSistemaAndando();
  const m = `mismonombre-${process.pid}`;
  const nombre = `Iglesia Gemela ${m}`;

  const una = await api('POST', '/iglesias', { nombre, codigo: `G1${process.pid}`, ciudad: 'Concepción', estado: 'Activa' });
  assert.equal(una.estado, 201, una.texto.slice(0, 200));

  const otra = await api('POST', '/iglesias', { nombre, codigo: `G2${process.pid}`, ciudad: 'Temuco', estado: 'Activa' });
  assert.equal(otra.estado, 400, 'la segunda con el mismo nombre tiene que preguntar');
  assert.equal(otra.json.confirmar, 'iglesia_con_el_mismo_nombre');
  assert.match(otra.json.error, /Concepción/, 'y decir dónde está la que ya existe');

  const confirmada = await api('POST', '/iglesias', {
    nombre, codigo: `G2${process.pid}`, ciudad: 'Temuco', estado: 'Activa', igual_asi: true,
  });
  assert.equal(confirmada.estado, 201);

  // Y en las DOS listas de iglesias sale el código al lado
  for (const ruta of ['/iglesias/activas', '/iglesias/options']) {
    const suyas = (await api('GET', ruta)).json.filter((o) => String(o.label).startsWith(nombre));
    assert.equal(suyas.length, 2, `${ruta} tendría que ofrecer las dos`);
    assert.ok(suyas.every((o) => /· G\d/.test(o.label)),
      `en ${ruta} salen indistinguibles: ${suyas.map((o) => o.label).join(' | ')}`);
  }
});

test('y la pregunta tiene su propia cara en la pantalla', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const COMO_SE_PREGUNTA = {');
  const catalogo = app.slice(desde, app.indexOf('\n  };', desde));
  assert.match(catalogo, /iglesia_con_el_mismo_nombre: \{/);
  assert.match(catalogo, /Son dos congregaciones, guardar/,
    'el botón dice lo que significa contestar que sí');
});
