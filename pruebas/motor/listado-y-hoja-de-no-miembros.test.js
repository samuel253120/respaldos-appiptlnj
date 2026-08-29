/**
 * LO QUE SE MIRA TODOS LOS DÍAS, Y LA HOJA QUE SE LLEVA A LA CASA.
 *
 * Dos cosas del mismo módulo, medidas contra el sistema andando:
 *
 * EL LISTADO mostraba nombre, apellido, RUT, teléfono, si se acerca y la
 * iglesia. Sobre 60 fichas: 73 de las 125 celdas con título estaban en blanco
 * —el 58 %— y el RUT lo estaba en las 60, porque quien llega al mostrador casi
 * nunca anda con el carnet; el módulo lo dice en su propio encabezado. Y lo
 * único que este registro existe para saber —cuántas veces se le ha entregado
 * algo a esta persona— no estaba en ninguna columna.
 *
 * LA FICHA no se podía imprimir. La de un miembro tiene su botón; esta no, y
 * la visita a domicilio se hace en papel: el nombre, la dirección, el teléfono
 * y qué se le llevó se copiaban a mano de la pantalla.
 *
 * Lo que cuida este archivo:
 *   · que el RUT salga de las columnas y entren las entregas y la última
 *   · que «entregas» diga cero y no vacío: un cero es un dato
 *   · que las entregas de todo el listado salgan en UNA consulta, no una por
 *     fila, que es lo que haría caro mostrarlas
 *   · que se pueda separar a quien ya se inscribió
 *   · y que la hoja impresa lleve el detalle de lo entregado
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const noMiembros = require('../../server/modules/no_miembros');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Listado', 'IG-LST', 'Activa')")
  .run().lastInsertRowid;
const ficha = (nombres, apellidos) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)')
  .run(nombres, apellidos, iglesia).lastInsertRowid;
const entregar = (quien, fecha, estado) => db
  .prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id, beneficiario,
                                  tipo_ayuda, valor_estimado, estado)
     VALUES (?, ?, 'No miembro', ?, 'x', 'Mercadería', 1000, ?)`
  )
  .run(fecha, iglesia, quien, estado || 'Entregada');

const conTres = ficha('Ayudada', 'Tres Veces');
entregar(conTres, '2026-01-10');
entregar(conTres, '2026-03-15');
entregar(conTres, '2026-07-20');
entregar(conTres, '2026-08-01', 'Rechazada');
const sinNada = ficha('Nunca', 'Recibió');

/** El campo calculado, llamado como lo llama el motor. */
const calcular = (nombre, id, recuerdo) => {
  const c = noMiembros.computed.find((x) => x.name === nombre);
  assert.ok(c, `el módulo tiene que ofrecer el campo calculado «${nombre}»`);
  return c.calc({ id }, { db, usuario: { id: 1, rol: 'admin' }, recuerdo: recuerdo || new Map() });
};

/* --------------------------------------------------- las columnas */

test('el RUT sale del listado: en este registro está en blanco siempre', () => {
  assert.equal(noMiembros.listFields.includes('rut'), false);
  assert.ok(noMiembros.fields.some((f) => f.name === 'rut'), 'pero sigue en la ficha');
  assert.ok(noMiembros.searchFields.includes('rut'), 'y se sigue buscando por él');
});

test('entran las dos columnas por las que este registro existe', () => {
  assert.deepEqual(noMiembros.listFields,
    ['nombres', 'apellidos', 'telefono', 'entregas', 'ultima_ayuda', 'asistencia', 'iglesia_id']);
});

test('«entregas» cuenta las entregadas y dice cero, no vacío', () => {
  assert.equal(calcular('entregas', conTres), '3', 'la rechazada no fue una entrega');
  assert.equal(calcular('entregas', sinNada), '0',
    'que a esta señora no se le haya entregado nada es un dato, no un hueco');
});

test('«última entrega» sale escrita como se lee', () => {
  assert.equal(calcular('ultima_ayuda', conTres), '20-07-2026',
    'al lado de un «3» tiene que decir 20-07-2026, no 2026-07-20');
  assert.equal(calcular('ultima_ayuda', sinNada), '');
});

test('la última es la última ENTREGADA, no la última anotada', () => {
  assert.equal(calcular('ultima_ayuda', conTres), '20-07-2026',
    'la del 01-08 se rechazó: decir que se le entregó ese día sería falso');
});

/* ------------------------------- una consulta, no una por fila */

test('las entregas de todo el listado salen en una sola consulta', () => {
  /*
   * Es lo que haría caro mostrar esta columna: 25 filas por página serían 25
   * consultas. Se cuenta cuántas veces se prepara la consulta agrupada
   * mientras se resuelve un listado entero, compartiendo el `recuerdo` como lo
   * comparte el motor.
   */
  const original = db.prepare.bind(db);
  let veces = 0;
  db.prepare = (sql) => {
    if (/FROM ayudas_sociales[\s\S]*GROUP BY no_miembro_id/.test(sql)) veces++;
    return original(sql);
  };
  try {
    const recuerdo = new Map();
    for (const id of [conTres, sinNada, conTres, sinNada, conTres]) {
      calcular('entregas', id, recuerdo);
      calcular('ultima_ayuda', id, recuerdo);
    }
    assert.equal(veces, 1, 'diez cálculos sobre cinco fichas: una sola consulta');
  } finally {
    db.prepare = original;
  }
});

test('sin recuerdo compartido igual contesta, aunque pague la consulta', () => {
  assert.equal(calcular('entregas', conTres), '3',
    'un cálculo suelto —una ficha abierta sola— no puede depender de que haya listado');
});

/* --------------------------------- separar a quien ya se inscribió */

test('se puede filtrar por quién ya se inscribió y quién no', () => {
  const f = noMiembros.filtrosPropios.find((x) => x.nombre === 'ya_inscrita');
  assert.ok(f, 'lo que NM-02 dejó para cuando se rehicieran las columnas');
  assert.deepEqual(f.opciones, ['Todavía no', 'Ya se inscribió']);
  assert.equal(f.donde('Ya se inscribió').sql, 'miembro_id IS NOT NULL');
  assert.equal(f.donde('Todavía no').sql, 'miembro_id IS NULL');
});

test('va de filtro y no de columna, que es la decisión', () => {
  assert.equal(noMiembros.listFields.includes('miembro_id'), false,
    'este listado se acaba de limpiar de columnas casi siempre en blanco: '
    + 'una que solo dice algo en un puñado de fichas sería otra de esas');
});

/* ------------------------------------------- la hoja que se imprime */

test('la ficha se puede imprimir', () => {
  assert.equal(noMiembros.printable, true);
});

test('la hoja lleva el detalle de lo que se le entregó', () => {
  const hoja = app.match(/function printGenerico[\s\S]*?\n\}/)[0];
  assert.match(hoja, /Lo que se le ha entregado/);
  assert.match(hoja, /susAyudas && susAyudas\.registradas/, 'y no sale cuando no hay nada que poner');
  assert.match(hoja, /a\.tipo_ayuda/, 'con el detalle y no solo un total');
  assert.match(hoja, /a\.descripcion/,
    'quien la lleva tiene que poder decir qué se le llevó la última vez');
});

test('la hoja pide las ayudas para los dos registros de personas', () => {
  assert.match(app, /if \(COMO_RECIBE_AYUDA\[name\] && MOD\['ayudas_sociales'\]\) \{\n\s*susAyudas = await api\(/);
  assert.match(app, /\)\.catch\(\(\) => null\);/,
    'sin permiso sobre Ayudas Sociales la ficha se imprime igual, sin esa parte');
});

test('la hoja no dice el mismo dato dos veces', () => {
  // «Entregas 3» arriba y «Lo que se le ha entregado · 3 entregas» debajo es lo
  // mismo dicho dos veces, y en una hoja que alguien firma eso hace dudar de
  // cuál de las dos manda.
  for (const cual of ['entregas', 'ultima_ayuda']) {
    assert.equal(noMiembros.computed.find((c) => c.name === cual).enElPapel, false,
      `«${cual}» va en el listado, no en el papel: abajo está con su detalle`);
  }
  const hoja = app.match(/function printGenerico[\s\S]*?\n\}/)[0];
  assert.match(hoja, /f\.enElPapel !== false/, 'y la hoja tiene que hacerle caso');

  /*
   * Y el «no» tiene que LLEGAR a la pantalla. La descripción del sistema se
   * manda podada —lo que no dice nada no viaja—, y un `false` se poda salvo
   * donde signifique algo. Sin esto la hoja no se enteraba nunca y seguía
   * imprimiendo el dato dos veces, con todo lo demás en su sitio.
   */
  const { sinLoQueNoDiceNada } = require('../../server/meta-liviana');
  assert.equal(sinLoQueNoDiceNada({ name: 'x', enElPapel: false }).enElPapel, false,
    'el «no va en el papel» es una decisión, no una ausencia');
  const indice = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(indice, /\(m\.computed \|\| \[\]\)\.map\(\(\{ name, label, type, help, ordenarPor, ancho, enElPapel \}\)/,
    'y un campo calculado tiene que poder mandarlo');
});

test('la tabla de entregas no hereda el ancho de la etiqueta de un campo', () => {
  assert.match(css, /\.print-generic table\.entregas td\.k \{ width: auto; \}/,
    'con 220 px la primera columna se come la hoja');
  assert.match(app, /<table class="entregas">/);
});
