/**
 * La migración que nunca corrió.
 *
 * «marcas de asistencia con su cuerpo» pedía `a.cuerpo_id`, y `asistencias`
 * había perdido esa columna un poco antes, cuando una actividad pasó a
 * convocar VARIOS cuerpos y el campo se volvió `cuerpos`, que es una lista.
 * Medido sobre una base recién creada, en cada arranque:
 *
 *   ⚠️  No se pudo aplicar la migración "marcas de asistencia con su cuerpo":
 *       no such column: a.cuerpo_id
 *   marcada como aplicada ....... NO      (y por eso lo reintentaba siempre)
 *   otras migraciones marcadas ... 34
 *
 * Sin cuerpo, esas marcas no salen en el informe de ningún cuerpo y la
 * pantalla no sabe a qué fila corresponden: la persona figura sin marcar y al
 * pasar lista de nuevo se le vuelve a preguntar algo ya contestado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const migraciones = require('../../server/migraciones');

/**
 * Una base de juguete con lo justo, para poder darle la forma que se quiera
 * —incluida la ANTIGUA, con la columna que ya no existe—. La forma de verdad
 * la comprueba la última prueba de este archivo, arrancando el sistema entero.
 */
function baseDeJuguete({ conLaColumnaVieja = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migraciones (nombre TEXT PRIMARY KEY);
    CREATE TABLE asistencias (
      id INTEGER PRIMARY KEY, cuerpos TEXT${conLaColumnaVieja ? ', cuerpo_id INTEGER' : ''}
    );
    CREATE TABLE asistencia_detalle (
      id INTEGER PRIMARY KEY, asistencia_id INTEGER,
      miembro_id INTEGER, no_miembro_id INTEGER, cuerpo_id INTEGER
    );
    CREATE TABLE integrantes_cuerpo (
      id INTEGER PRIMARY KEY, cuerpo_id INTEGER,
      miembro_id INTEGER, no_miembro_id INTEGER, estado TEXT
    );
  `);
  return db;
}

const actividad = (db, id, cuerpos, cuerpoViejo) => db
  .prepare(`INSERT INTO asistencias (id, cuerpos${cuerpoViejo !== undefined ? ', cuerpo_id' : ''})
            VALUES (?, ?${cuerpoViejo !== undefined ? ', ?' : ''})`)
  .run(...[id, cuerpos === null ? null : JSON.stringify(cuerpos),
           ...(cuerpoViejo !== undefined ? [cuerpoViejo] : [])]);

const marca = (db, actividadId, { miembro = null, noMiembro = null } = {}) => db
  .prepare('INSERT INTO asistencia_detalle (asistencia_id, miembro_id, no_miembro_id) VALUES (?,?,?)')
  .run(actividadId, miembro, noMiembro).lastInsertRowid;

const integra = (db, cuerpo, { miembro = null, noMiembro = null, estado = 'Activo' } = {}) => db
  .prepare('INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, no_miembro_id, estado) VALUES (?,?,?,?)')
  .run(cuerpo, miembro, noMiembro, estado);

const cuerpoDe = (db, id) => db.prepare('SELECT cuerpo_id FROM asistencia_detalle WHERE id = ?').get(id).cuerpo_id;

// ------------------------------------------------- que corra siquiera ----

test('la migración corre, en vez de reventar', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7]);
  const m = marca(db, 1, { miembro: 100 });

  migraciones.marcasDeAsistenciaConSuCuerpo(db);   // antes: no such column: a.cuerpo_id

  assert.equal(cuerpoDe(db, m), 7);
});

test('y se marca aplicada, que es lo que la hacía reintentarse para siempre', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7]);
  marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.ok(db.prepare('SELECT 1 FROM migraciones WHERE nombre = ?').get('marcas de asistencia con su cuerpo'));
});

test('y una vez aplicada no vuelve a tocar nada', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7]);
  migraciones.marcasDeAsistenciaConSuCuerpo(db);       // se marca con cero marcas
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null, 'ya estaba aplicada: no le toca el turno de nuevo');
});

// --------------------------------------------- lo que sabe deducir ----

test('con un solo cuerpo convocado, la marca es de ése', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7]);
  const m = marca(db, 1, { miembro: 100 });   // ni siquiera es integrante
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 7);
});

test('con varios convocados, el único al que la persona pertenece', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8, 9]);
  integra(db, 8, { miembro: 100 });
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 8);
});

test('si pertenece a dos de los convocados, no se inventa ninguno', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8]);
  integra(db, 7, { miembro: 100 });
  integra(db, 8, { miembro: 100 });
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null, 'hay más de una respuesta posible: se deja como está');
});

test('un integrante retirado ya no cuenta como suyo', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8]);
  integra(db, 7, { miembro: 100, estado: 'Retirado' });
  integra(db, 8, { miembro: 100 });
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 8);
});

test('sin cuerpos convocados no hay nada que deducir', () => {
  const db = baseDeJuguete();
  actividad(db, 1, null);
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null);
});

test('una lista de cuerpos ilegible no la hace reventar', () => {
  const db = baseDeJuguete();
  db.prepare('INSERT INTO asistencias (id, cuerpos) VALUES (1, ?)').run('{esto no es json');
  const m = marca(db, 1, { miembro: 100 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null);
});

test('las que ya tenían cuerpo no se tocan', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7]);
  const m = marca(db, 1, { miembro: 100 });
  db.prepare('UPDATE asistencia_detalle SET cuerpo_id = 99 WHERE id = ?').run(m);
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 99);
});

// ------------------------------------------ la gente no inscrita ----

test('una persona no inscrita también se resuelve por el cuerpo que integra', () => {
  /*
   * A un cuerpo lo integra también gente que no está en la membresía. Antes
   * de esto la consulta solo miraba `miembro_id`, así que sus marcas se
   * quedaban sin resolver aunque el cuerpo fuera deducible con certeza.
   */
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8, 9]);
  integra(db, 9, { noMiembro: 55 });
  const m = marca(db, 1, { noMiembro: 55 });
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 9);
});

test('y no se confunde con el miembro que lleva ese mismo número', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8]);
  integra(db, 7, { miembro: 55 });        // el MIEMBRO 55 está en el cuerpo 7
  const m = marca(db, 1, { noMiembro: 55 });  // pero quien vino es la NO MIEMBRO 55
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null, 'no integra ninguno de los convocados');
});

test('una marca sin persona no revienta ni se le inventa un cuerpo', () => {
  const db = baseDeJuguete();
  actividad(db, 1, [7, 8]);
  const m = marca(db, 1, {});
  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), null);
});

// -------------------------------------- la base vieja, la que motivó todo ----

test('en una base ANTIGUA el respaldo que se quitó no hace falta', () => {
  /*
   * La consulta pedía `a.cuerpo_id` para las actividades viejas de un solo
   * cuerpo. Ese respaldo se quitó en vez de ponerle un guardia, porque la
   * migración «actividades con varios cuerpos» corre ANTES en la misma lista
   * y copia ese cuerpo_id dentro de `cuerpos`. Acá se le devuelve la columna
   * a la base y se corren las dos en su orden: la marca queda resuelta igual.
   */
  const db = baseDeJuguete({ conLaColumnaVieja: true });
  actividad(db, 1, null, 7);               // como quedaba antes: cuerpo_id suelto
  const m = marca(db, 1, { miembro: 100 });

  migraciones.actividadesConVariosCuerpos(db);
  assert.equal(db.prepare('SELECT cuerpos FROM asistencias WHERE id = 1').get().cuerpos, '[7]',
    'la vecina tiene que haber llenado la lista antes');

  migraciones.marcasDeAsistenciaConSuCuerpo(db);
  assert.equal(cuerpoDe(db, m), 7);
});

// ------------------------------------ y que NINGUNA migración reviente ----

test('el sistema entero arranca sin que falle ninguna migración', () => {
  /*
   * Esto es lo que no existía y por eso el defecto vivió tanto: nadie corría
   * las migraciones de verdad, sobre el esquema de verdad, comprobando que
   * ninguna se cayera. Se arranca en un proceso aparte con su propia carpeta
   * de datos, porque las migraciones necesitan SU base y no la compartida.
   */
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-'));
  try {
    const r = spawnSync(process.execPath, ['-e', `
      const m = require(${JSON.stringify(path.join(__dirname, '../../server/migraciones'))});
      m.ejecutarMigraciones();
      const { db } = require(${JSON.stringify(path.join(__dirname, '../../server/db'))});
      process.stdout.write('APLICADAS:' + db.prepare('SELECT COUNT(*) n FROM migraciones').get().n);
    `], {
      env: { ...process.env, DATA_DIR: carpeta, PRUEBAS_DEL_MOTOR: '1' },
      encoding: 'utf8',
      cwd: path.join(__dirname, '../..'),
    });
    const salida = `${r.stdout}${r.stderr}`;

    assert.equal(r.status, 0, `el arranque tendría que terminar bien:\n${salida}`);
    assert.doesNotMatch(salida, /No se pudo aplicar la migración/,
      `ninguna migración puede fallar al arrancar:\n${salida}`);
    assert.doesNotMatch(salida, /no such column/, `y menos por una columna que no existe:\n${salida}`);

    const cuantas = Number((salida.match(/APLICADAS:(\d+)/) || [])[1] || 0);
    assert.ok(cuantas >= 35, `tendrían que quedar todas marcadas, quedaron ${cuantas}`);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test('y la que nos ocupa queda marcada entre ellas', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-'));
  try {
    const r = spawnSync(process.execPath, ['-e', `
      const m = require(${JSON.stringify(path.join(__dirname, '../../server/migraciones'))});
      m.ejecutarMigraciones();
      const { db } = require(${JSON.stringify(path.join(__dirname, '../../server/db'))});
      const hay = db.prepare('SELECT 1 FROM migraciones WHERE nombre = ?')
        .get('marcas de asistencia con su cuerpo');
      process.stdout.write(hay ? 'MARCADA' : 'FALTA');
    `], {
      env: { ...process.env, DATA_DIR: carpeta, PRUEBAS_DEL_MOTOR: '1' },
      encoding: 'utf8',
      cwd: path.join(__dirname, '../..'),
    });
    assert.match(`${r.stdout}${r.stderr}`, /MARCADA/);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
