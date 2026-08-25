/**
 * Ninguna transacción que escribe se abre suelta.
 *
 * POR QUÉ ESTO SE VIGILA. `db.transaction(algo)()` abre la transacción suelta:
 * parte leyendo y pide permiso de escribir recién en el primer INSERT. Si para
 * entonces otro proceso ya escribió, SQLite la rechaza en el acto —lo que
 * había leído quedó viejo— y el busy_timeout no interviene: sale «database is
 * locked» con ocho segundos de paciencia configurados. Abriéndola con
 * `.immediate()` el permiso se pide al empezar y el segundo espera su turno.
 * (El detalle completo está en el comentario de afinar(), en server/db.js.)
 *
 * No se prueba corriendo dos procesos a la vez, sino LEYENDO EL CÓDIGO. Es a
 * propósito: una prueba de choque solo falla cuando el choque ocurre, y el
 * choque ocurre una vez de cada tantas. Acá, en cambio, la transacción número
 * trece que alguien escriba suelta falla siempre, el día que la escribe.
 *
 * Si esta prueba falla, la corrección es de una palabra: `})()` pasa a ser
 * `}).immediate()`, o `guardar()` pasa a ser `guardar.immediate()`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');

const SERVIDOR = path.join(__dirname, '..', '..', 'server');

/** Todos los .js del servidor, incluidos los de las carpetas de adentro. */
function archivosDelServidor(dir = SERVIDOR) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosDelServidor(completa));
    else if (entrada.name.endsWith('.js')) salida.push(completa);
  }
  return salida;
}

/**
 * Dónde se abre una transacción, y con qué nombre queda.
 *
 * Se busca `db.transaction(` y se mira cómo se la invoca después. Hay dos
 * formas en el código: la que se arma y se llama de una —`db.transaction(()
 * => {...})()`— y la que se guarda en una variable para llamarla más abajo
 * —`const guardar = db.transaction(...)`, y después `guardar()`—.
 */
function transaccionesDe(texto) {
  const encontradas = [];
  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    const m = linea.match(/(?:const|let|var)\s+(\w+)\s*=\s*db\.transaction\(/);
    if (m) encontradas.push({ nombre: m[1], linea: i + 1 });
    else if (/db\.transaction\(/.test(linea)) encontradas.push({ nombre: null, linea: i + 1 });
  });
  return encontradas;
}

const ARCHIVOS = archivosDelServidor();

test('en el servidor hay transacciones que revisar', () => {
  const cuantas = ARCHIVOS.reduce((n, a) => n + transaccionesDe(fs.readFileSync(a, 'utf8')).length, 0);
  assert.ok(cuantas >= 10, `solo se encontraron ${cuantas}: la búsqueda dejó de encontrarlas`);
});

test('la que se arma y se llama de una vez, se llama inmediata', () => {
  const sueltas = [];
  for (const archivo of ARCHIVOS) {
    const texto = fs.readFileSync(archivo, 'utf8');
    // El cierre de una transacción llamada en el acto: «})();» o «})(algo);»
    // Se mira solo en archivos que abren transacciones, para no confundirla
    // con el cierre de cualquier otra función que se llama sola.
    if (!/db\.transaction\(/.test(texto)) continue;
    texto.split('\n').forEach((linea, i) => {
      if (/^\s*\}\)\([^)]*\);\s*$/.test(linea) && !/immediate/.test(linea)) {
        sueltas.push(`${path.relative(SERVIDOR, archivo)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(sueltas, [], `transacción(es) abiertas sueltas: ${sueltas.join(', ')}`);
});

test('la que se guarda en una variable, se llama inmediata', () => {
  const sueltas = [];
  for (const archivo of ARCHIVOS) {
    const texto = fs.readFileSync(archivo, 'utf8');
    for (const { nombre } of transaccionesDe(texto)) {
      if (!nombre) continue;
      // Cada vez que se la invoca tiene que ser con .immediate()
      const llamadas = texto.match(new RegExp(`\\b${nombre}\\s*(?:\\.\\w+)?\\s*\\(`, 'g')) || [];
      const inmediatas = texto.match(new RegExp(`\\b${nombre}\\.immediate\\s*\\(`, 'g')) || [];
      // Una de las llamadas es la declaración misma: db.transaction( no cuenta
      const invocaciones = llamadas.filter((l) => !/transaction/.test(l)).length;
      if (invocaciones > inmediatas.length) {
        sueltas.push(`${path.relative(SERVIDOR, archivo)} → ${nombre}()`);
      }
    }
  }
  assert.deepEqual(sueltas, [], `transacción(es) invocadas sueltas: ${sueltas.join(', ')}`);
});

// Tabla propia de este archivo: los del motor comparten UNA base, y contar
// filas de una tabla que otro archivo también toca da un número que va
// cambiando solo.
db.exec('CREATE TABLE IF NOT EXISTS prueba_transaccion (id INTEGER PRIMARY KEY, v TEXT)');

test('una transacción inmediata escribe igual que una suelta', () => {
  const meter = db.transaction((cuantos) => {
    for (let i = 0; i < cuantos; i++) db.prepare('INSERT INTO prueba_transaccion (v) VALUES (?)').run(`v${i}`);
  });
  meter.immediate(3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM prueba_transaccion').get().c, 3);
});

test('y si algo falla adentro, no queda nada a medias', () => {
  const antes = db.prepare('SELECT COUNT(*) c FROM prueba_transaccion').get().c;
  const meter = db.transaction(() => {
    db.prepare('INSERT INTO prueba_transaccion (v) VALUES (?)').run('la que no debería quedar');
    throw new Error('algo salió mal a mitad de camino');
  });
  assert.throws(() => meter.immediate(), /a mitad de camino/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM prueba_transaccion').get().c, antes);
});
