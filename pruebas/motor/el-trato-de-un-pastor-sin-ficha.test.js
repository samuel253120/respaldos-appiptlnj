/**
 * El trato de quien está en Pastores / Guías pero no tiene ficha de miembro.
 *
 * «A quien tiene cargo pastoral se le dice Pastor o Pastora en todo el
 * sistema». Eso funcionaba solo si el pastor tenía ficha de miembro, porque el
 * sexo —lo que decide entre Pastor y Pastora— vivía nada más que allá y la
 * ficha de pastor no tenía ese campo. Medido antes de la 1.244.0, sembrando un
 * pastor de cada cargo con y sin ficha de miembro:
 *
 *   Guía de Obra, sin ficha ............... Gaspar          (pelado)
 *   Guía de Obra, con ficha Masculino ..... Guía de Obra Gedeón
 *   Pastora, sin ficha .................... Rut             (pelado)
 *   Pastora, con ficha Femenino ........... Pastora Ester
 *   Pastor Presbítero, sin ficha .......... Simón           (pelado)
 *   Pastor Presbítero, ficha Masculino .... Pastor Pablo
 *   Pastor Presbítero, ficha Femenino ..... Pastora Débora
 *
 * Tres de siete salían con el nombre pelado, y dos de esos tres no necesitaban
 * el sexo para nada: su cargo ya dice el trato en su propio nombre.
 *
 * Y no es un caso raro: el módulo trae una columna que marca a quién le FALTA
 * registrar su ficha de miembro, porque cuenta con que muchos no la tengan.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const trato = require('../../server/tratamiento');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const miembro = (nombres, genero) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, genero, estado) VALUES (?, ?, ?, 'Activo')")
  .run(nombres, `Trato ${marca()}`, genero).lastInsertRowid;

const pastor = (nombres, cargo, { miembroId = null, genero = null, rut = null } = {}) => {
  const id = db
    .prepare(`INSERT INTO pastores (nombres, apellidos, cargo, estado, miembro_id, genero, rut)
              VALUES (?, ?, ?, 'Activo', ?, ?, ?)`)
    .run(nombres, `Trato ${marca()}`, cargo, miembroId, genero, rut).lastInsertRowid;
  return db.prepare('SELECT * FROM pastores WHERE id = ?').get(id);
};

const comoSeLeDice = (p) => trato.conTratamientoDePastor(p, db).split(' Trato ')[0];

// --------------------------------------------- el trato que dice el cargo ----

test('al guía de obra se le dice guía de obra, sin mirar el sexo', () => {
  assert.equal(trato.tratoDelCargo('Guía de Obra', null), 'Guía de Obra');
  assert.equal(trato.tratoDelCargo('Guía de Obra', 'Femenino'), 'Guía de Obra');
  assert.equal(trato.tratoDelCargo('Guía de Obra', 'Masculino'), 'Guía de Obra');
});

test('el cargo de Pastora ya dice el trato en su propio nombre', () => {
  assert.equal(trato.tratoDelCargo('Pastora', null), 'Pastora');
  assert.equal(trato.tratoDelCargo('Pastora', 'Masculino'), 'Pastora');
});

test('las gradas de la escala se escriben en masculino, y ahí decide el sexo', () => {
  for (const cargo of ['Pastor Probando', 'Pastor Diácono', 'Pastor Presbítero', 'Pastor Presidente']) {
    assert.equal(trato.tratoDelCargo(cargo, 'Masculino'), 'Pastor', cargo);
    assert.equal(trato.tratoDelCargo(cargo, 'Femenino'), 'Pastora', cargo);
    assert.equal(trato.tratoDelCargo(cargo, null), 'Pastor', cargo);
  }
});

test('sin cargo no hay trato', () => {
  assert.equal(trato.tratoDelCargo(null, 'Femenino'), '');
  assert.equal(trato.tratoDelCargo('', null), '');
});

test('un cargo de la lista anterior sigue siendo pastoral, como antes', () => {
  // La migración de los cargos conserva estas fichas como estaban y pide que
  // alguien las abra: mientras tanto no pueden quedarse sin trato.
  assert.equal(trato.tratoDelCargo('Pastor', 'Masculino'), 'Pastor');
  assert.equal(trato.tratoDelCargo('Anciano', 'Femenino'), 'Pastora');
});

// ----------------------------------------------------- sin ficha de miembro ----

test('el guía de obra sin ficha de miembro ya no sale pelado', () => {
  assert.equal(comoSeLeDice(pastor('Gaspar', 'Guía de Obra')), 'Guía de Obra Gaspar');
});

test('la pastora sin ficha de miembro sale Pastora: lo dice su cargo', () => {
  assert.equal(comoSeLeDice(pastor('Rut', 'Pastora')), 'Pastora Rut');
});

test('el presbítero sin ficha de miembro sale Pastor', () => {
  assert.equal(comoSeLeDice(pastor('Simón', 'Pastor Presbítero')), 'Pastor Simón');
});

test('y la presbítera, con su sexo anotado en la ficha de pastor, sale Pastora', () => {
  assert.equal(
    comoSeLeDice(pastor('Débora', 'Pastor Presbítero', { genero: 'Femenino' })),
    'Pastora Débora'
  );
});

// ----------------------------------------------------- con ficha de miembro ----

test('con ficha de miembro el trato sigue saliendo de allá', () => {
  const m = miembro('Pablo', 'Masculino');
  assert.equal(comoSeLeDice(pastor('Pablo', 'Pastor Presbítero', { miembroId: m })), 'Pastor Pablo');
});

test('la ficha de miembro manda sobre el sexo anotado en la de pastor', () => {
  const m = miembro('Ester', 'Femenino');
  const p = pastor('Ester', 'Pastor Presbítero', { miembroId: m, genero: 'Masculino' });
  assert.equal(comoSeLeDice(p), 'Pastora Ester');
});

test('y si la ficha de miembro no dice el sexo, decide la de pastor', () => {
  const m = miembro('Priscila', null);
  const p = pastor('Priscila', 'Pastor Presbítero', { miembroId: m, genero: 'Femenino' });
  assert.equal(trato.tratamientoDe(db.prepare('SELECT * FROM miembros WHERE id = ?').get(m), db), 'Pastora');
});

test('el trato fijado a mano en la ficha de miembro manda sobre todo', () => {
  const m = db
    .prepare(`INSERT INTO miembros (nombres, apellidos, genero, tratamiento_personalizado, estado)
              VALUES (?, ?, 'Masculino', 'Oficial', 'Activo')`)
    .run('Esteban', `Trato ${marca()}`).lastInsertRowid;
  assert.equal(comoSeLeDice(pastor('Esteban', 'Pastor Presbítero', { miembroId: m })), 'Oficial Esteban');
});

// -------------------------------------------------- la ficha por el RUT ----

test('la ficha de miembro se reconoce por el RUT aunque no esté enlazada', () => {
  const rut = `9${marca().replace(/\D/g, '').slice(0, 7)}-0`;
  db.prepare("INSERT INTO miembros (nombres, apellidos, rut, genero, estado) VALUES (?, ?, ?, 'Femenino', 'Activo')")
    .run('Lidia', `Trato ${marca()}`, rut);
  const p = pastor('Lidia', 'Pastor Presbítero', { rut });
  assert.equal(trato.conTratamientoDePastor(p, db).startsWith('Pastora Lidia'), true);
});

// ------------------------------------------- por dónde sale a la pantalla ----

test('la lista «A cargo de la iglesia» le da su trato al que no tiene ficha', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Sofonías', 'Pastora');
  const { estado, json } = await api('GET', '/pastores/con-conyuge');
  assert.equal(estado, 200);
  const suya = json.find((o) => o.id === p.id);
  assert.ok(suya, 'el pastor sembrado tiene que estar en la lista');
  assert.match(suya.label, /^Pastora Sofonías/);
});

test('y la ficha de la iglesia dice quién está a cargo con su trato', () => {
  const p = pastor('Josías', 'Pastor Presbítero', { genero: 'Femenino' });
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, pastor_id) VALUES (?, ?)")
    .run(`Trato ${marca()}`, p.id).lastInsertRowid;
  const IGLESIAS = require('../../server/registry').getModule('iglesias');
  const calc = IGLESIAS.computed.find((c) => c.name === 'responsables').calc;
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(iglesia);
  assert.match(calc(fila, { db }), /^Pastora Josías/);
});

// ------------------------------------ lo que se copia a la ficha que nace ----

test('la ficha de miembro que se crea desde acá se lleva el sexo', async () => {
  const api = await elSistemaAndando();
  const iglesia = db.prepare('INSERT INTO iglesias (nombre) VALUES (?)').run(`Trato ${marca()}`).lastInsertRowid;
  const rut = `10${marca().replace(/\D/g, '').slice(0, 6)}-0`;
  const p = db.prepare(`INSERT INTO pastores (nombres, apellidos, cargo, estado, iglesia_id, genero, rut)
                        VALUES (?, ?, 'Pastor Presbítero', 'Activo', ?, 'Femenino', ?)`)
    .run('Ana', `Trato ${marca()}`, iglesia, rut).lastInsertRowid;
  const { estado, json } = await api('POST', `/pastores/${p}/ficha-miembro`, {});
  assert.equal(estado, 201, JSON.stringify(json));
  const suya = db.prepare('SELECT * FROM miembros WHERE id = ?').get(json.miembro_id);
  assert.equal(suya.genero, 'Femenino');
});

// ------------------------------------------- a quién se le ofrece de cónyuge ----

test('sin ficha de miembro, los cónyuges que se ofrecen ya no son de los dos sexos', async () => {
  const api = await elSistemaAndando();
  // Dos candidatos con trato de pastor por su propio registro, uno de cada sexo
  const ella = miembro('Priscila', 'Femenino');
  pastor('Priscila', 'Pastora', { miembroId: ella });
  const varon = miembro('Aquila', 'Masculino');
  pastor('Aquila', 'Pastor Presbítero', { miembroId: varon });

  const el = pastor('Bernabé', 'Pastor Presbítero', { genero: 'Masculino' });
  const { estado, json } = await api('GET', `/pastores/conyuges?pastor_id=${el.id}`);
  assert.equal(estado, 200);
  const ofrecidos = json.map((o) => o.id);
  assert.ok(ofrecidos.includes(ella), 'la pastora del otro sexo tiene que ofrecerse');
  assert.ok(!ofrecidos.includes(varon), 'a un pastor no se le ofrece un varón de cónyuge');
});

// ------------------------------------------- el campo, tal como se declara ----

test('la ficha de pastor lleva su campo de sexo, opcional', () => {
  const PASTORES = require('../../server/registry').getModule('pastores');
  const campo = PASTORES.fields.find((f) => f.name === 'genero');
  assert.ok(campo, 'tiene que existir el campo');
  assert.equal(campo.type, 'select');
  assert.deepEqual(campo.options, ['Femenino', 'Masculino']);
  assert.ok(!campo.required, 'es opcional: se puede registrar a un pastor sin él');
});

test('y la columna existe en la base', () => {
  const columnas = db.prepare('PRAGMA table_info("pastores")').all().map((c) => c.name);
  assert.ok(columnas.includes('genero'));
});

// ---------------------------------------- una sola versión de cada camino ----

test('la ficha de miembro de un pastor se busca en un solo lugar', () => {
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/pastores.js'), 'utf8');
  assert.ok(
    !/function fichaDeMiembro\(/.test(modulo),
    'el módulo no vuelve a definir fichaDeMiembro: la toma de tratamiento.js'
  );
  assert.match(modulo, /fichaDeMiembro,?\s*\n?\s*\}? = require\('\.\.\/tratamiento'\)|fichaDeMiembro,/);
});
