/**
 * EL NOMBRE ESCRITO EN LA PLANILLA TIENE QUE ALCANZAR A TODOS.
 *
 * La importación acepta que las columnas de relación vengan con el NOMBRE en
 * vez del número interno —es la comodidad que existe para que una planilla
 * hecha por una persona se pueda subir sin conocer los números del sistema— y
 * esa búsqueda estaba resuelta trayendo la tabla entera y recorriéndola en
 * memoria UNA VEZ POR CADA CELDA, con `LIMIT 5000`.
 *
 * Las dos mitades de esa frase se midieron en la v1.384.0, con 5.601 miembros:
 *
 *   · el 5.000.º de la tabla entraba por su nombre y el 5.001.º contestaba
 *     «no se encontró», estando ahí y entrando por su número;
 *   · 500 filas por número costaban 202 ms y las mismas por nombre 33.401 ms.
 *
 * Lo que se comprueba acá es la conducta, no la implementación: que un
 * registro pasado el tope viejo se encuentre, que la tabla se lea UNA sola vez
 * por importación y no una por celda, que dos homónimos resuelvan al primero
 * —como resolvía el `find` de antes— y que una fila pueda nombrar a la que
 * entró más arriba en el mismo archivo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central NP ${marca}`, `NP-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Grupo',?,'Activo')")
  .run(`Grupo NP ${marca}`, iglesia).lastInsertRowid;

const integrantes = getModule('integrantes_cuerpo');
const unaFila = (comoSeLlamaLaPersona) => ({
  cuerpo_id: String(cuerpo), persona_tipo: 'No miembro',
  no_miembro_id: comoSeLlamaLaPersona, fecha_ingreso: '01/03/2026', estado: 'Activo',
});

// --------------------------------------------------- el tope de las cinco mil

test('un registro pasado el tope viejo se encuentra por su nombre', () => {
  /*
   * Hacen falta más de cinco mil filas en la tabla que se busca, que es
   * exactamente lo que el tope escondía. Se meten de una vez, se mide, y se
   * sacan en el acto: la base de las pruebas la comparten todos los archivos.
   */
  const meter = db.transaction(() => {
    const ins = db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)");
    for (let i = 0; i < 5100; i++) ins.run(`Monton${i}`, `Tope${marca}`, iglesia);
  });
  meter.immediate();

  try {
    const cuantos = db.prepare('SELECT COUNT(*) c FROM no_miembros').get().c;
    assert.ok(cuantos > 5000, `la tabla tiene que pasar el tope viejo: tiene ${cuantos}`);

    const ultimo = db.prepare('SELECT id, nombres, apellidos FROM no_miembros ORDER BY id DESC').get();
    const seLlama = `${ultimo.nombres} ${ultimo.apellidos}`;

    const { datos, errores } = prepararFila(integrantes, unaFila(seLlama), { id: 1, rol: 'admin' });
    assert.deepEqual(errores, [], `«${seLlama}» está en la tabla y tiene que encontrarse`);
    assert.equal(datos.no_miembro_id, ultimo.id);
  } finally {
    db.prepare('DELETE FROM no_miembros WHERE apellidos = ?').run(`Tope${marca}`);
  }
});

// ------------------------------------- una lectura por importación, no una por celda

test('la tabla que se busca se lee una sola vez, no una por cada celda', () => {
  const gente = [];
  for (let i = 0; i < 8; i++) {
    gente.push(db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)")
      .run(`Repetida${i}`, `Lectura${marca}`, iglesia).lastInsertRowid);
  }

  // se cuenta cuántas veces se lee la tabla entera, que es lo caro
  const original = db.prepare;
  let lecturas = 0;
  db.prepare = function (sql) {
    if (/^SELECT \* FROM "no_miembros"/.test(sql)) lecturas++;
    return original.call(this, sql);
  };
  try {
    const memoria = new Map();
    for (let i = 0; i < 8; i++) {
      const { errores } = prepararFila(
        integrantes, unaFila(`Repetida${i} Lectura${marca}`), { id: 1, rol: 'admin' }, memoria);
      assert.deepEqual(errores, [], `la fila ${i} tiene que resolver`);
    }
  } finally {
    db.prepare = original;
  }
  assert.equal(lecturas, 1, `ocho filas por nombre tienen que leer la tabla una vez, y leyeron ${lecturas}`);
});

// ------------------------------------------------------------ dos homónimos

test('si dos se presentan con el mismo texto, el nombre resuelve al primero', () => {
  const primero = db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)")
    .run('Homonima', `Doble${marca}`, iglesia).lastInsertRowid;
  const segundo = db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)")
    .run('Homonima', `Doble${marca}`, iglesia).lastInsertRowid;
  assert.ok(segundo > primero);

  const { datos, errores } = prepararFila(
    integrantes, unaFila(`Homonima Doble${marca}`), { id: 1, rol: 'admin' });
  assert.deepEqual(errores, []);
  assert.equal(datos.no_miembro_id, primero,
    'gana el de menor número, que es lo que devolvía la búsqueda anterior');
});

// ------------------------------- lo que entró más arriba en el mismo archivo

test('una fila puede nombrar por su texto a la que entró más arriba en el mismo archivo', async () => {
  const api = await elSistemaAndando();
  const seLlama = `Recien Llegada NP ${marca}`;

  const r = await api('POST', '/importar/no_miembros', {
    prueba: false,
    filas: [
      { nombres: 'Recien', apellidos: `Llegada NP ${marca}`, iglesia_id: String(iglesia) },
      // y esta segunda fila la nombra a ella, que todavía no existía cuando
      // empezó la importación
      { nombres: 'Otra', apellidos: `Cualquiera NP ${marca}`, iglesia_id: String(iglesia) },
    ],
  });
  assert.equal(r.json.correctas, 2, JSON.stringify(r.json).slice(0, 300));

  const memoria = new Map();
  // primero se arma el índice con una consulta cualquiera…
  prepararFila(integrantes, unaFila(`Otra Cualquiera NP ${marca}`), { id: 1, rol: 'admin' }, memoria);
  // …y después entra alguien nuevo: el índice tiene que enterarse
  const nueva = db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)")
    .run('Posterior', `Al indice NP ${marca}`, iglesia).lastInsertRowid;
  const { anotarEnLosIndices } = require('../../server/importar');
  anotarEnLosIndices(memoria, getModule('no_miembros'),
    db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(nueva));

  const despues = prepararFila(
    integrantes, unaFila(`Posterior Al indice NP ${marca}`), { id: 1, rol: 'admin' }, memoria);
  assert.deepEqual(despues.errores, [],
    'la fila de más abajo tiene que poder nombrar a la que entró más arriba');
  assert.equal(despues.datos.no_miembro_id, nueva);
  assert.ok(seLlama);
});
