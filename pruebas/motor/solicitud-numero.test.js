/**
 * El número de cada solicitud: `SOL-CENTRAL-0001-2026`.
 *
 * Tiene que contestar dos preguntas de una sola mirada —de qué iglesia es y
 * cuál del año es— y no puede repetirse. Las cuatro maneras de que eso falle
 * se prueban acá:
 *
 *   · que el correlativo sea de todo el sistema y no de cada iglesia, y
 *     entonces «la 12 de este año» no signifique nada mientras haya más de una
 *     congregación
 *   · que el número no diga de qué iglesia es
 *   · que el correlativo se calcule contando filas o buscando el máximo, y
 *     entonces al borrar una se vuelva a entregar su número
 *   · que no se reinicie con el año, o que dos peticiones a la vez reciban el
 *     mismo
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const numero = require('../../server/solicitudes/numero');
const codigos = require('../../server/codigo-iglesia');

const contador = (iglesia, anio) =>
  (db.prepare('SELECT ultimo FROM solicitud_contador_iglesia WHERE iglesia_id = ? AND anio = ?')
    .get(iglesia, anio) || { ultimo: 0 }).ultimo;

let cuantas = 0;
/** Una iglesia con el código que se le pida. */
function unaIglesia(codigo) {
  cuantas += 1;
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Numerada ${cuantas}`, codigo || `NUM${cuantas}`).lastInsertRowid;
}

const CENTRAL = unaIglesia('CENTRAL');
const NORTE = unaIglesia('NORTE');

// ------------------------------------------------------------ cómo se ve ---

test('lleva el prefijo, el código de la iglesia, el correlativo y el año', () => {
  assert.equal(numero.comoSeEscribe(1, 2026, 'CENTRAL', 'SOL-'), 'SOL-CENTRAL-0001-2026');
  assert.equal(numero.comoSeEscribe(45, 2026, 'CENTRAL', 'SOL-'), 'SOL-CENTRAL-0045-2026');
  assert.equal(numero.comoSeEscribe(999, 2026, 'NORTE', 'SOL-'), 'SOL-NORTE-0999-2026');
});

test('pasado el 9999 sigue creciendo, no se corta', () => {
  assert.equal(numero.comoSeEscribe(10000, 2026, 'CENTRAL', 'SOL-'), 'SOL-CENTRAL-10000-2026');
  assert.equal(numero.comoSeEscribe(123456, 2026, 'CENTRAL', 'SOL-'), 'SOL-CENTRAL-123456-2026');
});

test('sin prefijo y sin código sigue saliendo un número legible', () => {
  assert.equal(numero.comoSeEscribe(7, 2026, '', ''), '0007-2026');
});

test('se sabe leer de qué año es y qué número es, en los dos formatos', () => {
  assert.equal(numero.anioDe('SOL-CENTRAL-0045-2026'), 2026);
  assert.equal(numero.correlativoDe('SOL-CENTRAL-0045-2026'), 45);
  // El formato anterior sigue circulando: hay que poder contarlo
  assert.equal(numero.anioDe('0045-2026'), 2026);
  assert.equal(numero.correlativoDe('0045-2026'), 45);
  assert.equal(numero.anioDe('10000-2031'), 2031);
  assert.equal(numero.anioDe('no es un número'), null);
  assert.equal(numero.anioDe(''), null);
  assert.equal(numero.anioDe(null), null);
});

// ------------------------------------- el correlativo, por iglesia y año ---

test('el primero del año de una iglesia es el 0001, y dice cuál es', () => {
  assert.equal(numero.siguiente(CENTRAL, 2030), 'SOL-CENTRAL-0001-2030');
});

test('y después van uno tras otro', () => {
  assert.equal(numero.siguiente(CENTRAL, 2030), 'SOL-CENTRAL-0002-2030');
  assert.equal(numero.siguiente(CENTRAL, 2030), 'SOL-CENTRAL-0003-2030');
});

test('CADA IGLESIA LLEVA SU PROPIA CUENTA: la nueva no hereda la de las otras', () => {
  assert.equal(numero.siguiente(NORTE, 2030), 'SOL-NORTE-0001-2030',
    'la primera de esta iglesia es la 0001, aunque la otra vaya en la 0003');
  assert.equal(numero.siguiente(CENTRAL, 2030), 'SOL-CENTRAL-0004-2030', 'y la otra sigue donde iba');
  assert.equal(numero.siguiente(NORTE, 2030), 'SOL-NORTE-0002-2030');
});

test('cada año lleva su propia cuenta', () => {
  assert.equal(numero.siguiente(CENTRAL, 2031), 'SOL-CENTRAL-0001-2031', 'el año nuevo parte de cero');
  assert.equal(numero.siguiente(CENTRAL, 2030), 'SOL-CENTRAL-0005-2030', 'y el anterior sigue donde iba');
});

test('registrar una de un año pasado no toca la cuenta del año en curso', () => {
  const antes = contador(CENTRAL, 2030);
  numero.siguiente(CENTRAL, 2029);
  assert.equal(contador(CENTRAL, 2030), antes);
});

test('el código sale de la ficha de la iglesia, no de otro lado', () => {
  const suya = unaIglesia('LOSMAITENES');
  assert.equal(numero.siguiente(suya, 2032), 'SOL-LOSMAITENES-0001-2032');
});

test('una iglesia sin código igual queda identificada, por su ficha', () => {
  const sinNada = db.prepare("INSERT INTO iglesias (nombre, estado) VALUES ('Sin código', 'Activa')")
    .run().lastInsertRowid;
  assert.equal(numero.siguiente(sinNada, 2032), `SOL-IG${sinNada}-0001-2032`,
    'un número que no dice de qué iglesia es no sirve para nombrar nada');
});

// ---------------------- lo que NO puede pasar: repetir un número ------------

test('el número no sale de contar filas: borrar una no lo devuelve', () => {
  const antes = contador(NORTE, 2033);
  const uno = numero.siguiente(NORTE, 2033);
  const dos = numero.siguiente(NORTE, 2033);
  assert.equal(uno, numero.comoSeEscribe(antes + 1, 2033, 'NORTE', 'SOL-'));
  assert.equal(dos, numero.comoSeEscribe(antes + 2, 2033, 'NORTE', 'SOL-'));
  // Se «borra» la última: el contador NO baja
  assert.equal(contador(NORTE, 2033), antes + 2);
  const tres = numero.siguiente(NORTE, 2033);
  assert.equal(tres, numero.comoSeEscribe(antes + 3, 2033, 'NORTE', 'SOL-'), 'sigue de largo, no reutiliza');
  assert.notEqual(tres, dos);
});

test('mil números seguidos son mil números distintos', () => {
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(numero.siguiente(CENTRAL, 2034));
  assert.equal(vistos.size, 1000);
});

test('dos iglesias no pueden dar el mismo número, porque el código no se repite', () => {
  assert.throws(
    () => db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Copiona','CENTRAL','Activa')").run(),
    /UNIQUE/,
    'dos iglesias con el mismo código darían dos series idénticas'
  );
});

test('la columna del número no admite repetidos', () => {
  const meter = db.prepare(
    `INSERT INTO solicitudes (numero, fecha, iglesia_id, asunto, tipo, estado)
     VALUES (?, '2026-01-01', ?, 'Prueba', 'Otro', 'Pendiente')`
  );
  meter.run('SOL-CENTRAL-0777-2026', CENTRAL);
  assert.throws(() => meter.run('SOL-CENTRAL-0777-2026', CENTRAL), /UNIQUE/,
    'la base tiene que rechazarlo aunque el contador fallara');
});

// ------------------------------- dejar el contador al día tras la migración --

test('«alMenos» adelanta el contador de esa iglesia, y nunca lo hace retroceder', () => {
  numero.alMenos(CENTRAL, 2035, 12);
  assert.equal(contador(CENTRAL, 2035), 12);
  assert.equal(numero.siguiente(CENTRAL, 2035), 'SOL-CENTRAL-0013-2035');
  numero.alMenos(CENTRAL, 2035, 5); // más atrás: no debe mover nada
  assert.equal(contador(CENTRAL, 2035), 13, 'retroceder repetiría números ya entregados');
  assert.equal(numero.siguiente(CENTRAL, 2035), 'SOL-CENTRAL-0014-2035');
});

test('«alMenos» sobre un libro que no existía lo crea, y no toca el de al lado', () => {
  numero.alMenos(NORTE, 2040, 7);
  assert.equal(contador(NORTE, 2040), 7);
  assert.equal(contador(CENTRAL, 2040), 0, 'el libro de una iglesia no adelanta el de otra');
  assert.equal(numero.siguiente(NORTE, 2040), 'SOL-NORTE-0008-2040');
  assert.equal(numero.siguiente(CENTRAL, 2040), 'SOL-CENTRAL-0001-2040');
});

// ------------------------------------------- el código con que se identifica --

test('el código se deja como se puede escribir en cualquier parte', () => {
  assert.equal(codigos.normalizar('IG-001'), 'IG-001');
  assert.equal(codigos.normalizar('  central  '), 'CENTRAL');
  assert.equal(codigos.normalizar('Iglesia Ñuñoa'), 'IGLESIA-NUNOA', 'sin tildes y sin espacios');
  assert.equal(codigos.normalizar('///'), '');
  assert.equal(codigos.normalizar(null), '');
});

test('LO QUE ESCRIBE UNA PERSONA NO SE CORTA EN SILENCIO', () => {
  const largo = 'ZZ-PRUEBA-AISLAMIENTO-N';
  assert.equal(codigos.normalizar(largo), largo, 'se devuelve entero, para poder avisar del largo');
  // Cortándolos, estos dos serían el MISMO código, y la segunda iglesia no se
  // podría guardar por un choque que nadie provocó
  assert.notEqual(
    codigos.normalizar('ZZ-PRUEBA-AISLAMIENTO-N'),
    codigos.normalizar('ZZ-PRUEBA-AISLAMIENTO-S')
  );
});

test('el que PROPONE el sistema sí se corta, que para eso hay un largo máximo', () => {
  assert.equal(codigos.recortar('ZZ-PRUEBA-AISLAMIENTO-N').length, codigos.LARGO_MAXIMO);
  assert.ok(codigos.deSuNombre('Iglesia de la Santísima Concepción', 4).length <= codigos.LARGO_MAXIMO);
  assert.ok(!codigos.recortar('ABCDEFGHIJKLMNO-PQ').endsWith('-'), 'ni queda un guion colgando');
});

test('a una iglesia sin código se le propone uno que se reconozca', () => {
  assert.equal(codigos.deSuNombre('Iglesia Central', 3), 'CENTRAL', 'la palabra que de verdad distingue');
  assert.equal(codigos.deSuNombre('Iglesia de la Nueva Jerusalén', 7), 'NUEVA');
  assert.equal(codigos.deSuNombre('Iglesia', 9), 'IG9', 'si el nombre no distingue, al menos su ficha');
});

test('y si dos quedaran iguales, la segunda lleva un número', () => {
  const suyo = codigos.libre(db, 'CENTRAL', 0);
  assert.notEqual(suyo, 'CENTRAL', 'CENTRAL ya está tomado');
  assert.match(suyo, /^CENTRAL\d+$/);
  assert.equal(codigos.libre(db, 'CENTRAL', CENTRAL), 'CENTRAL', 'salvo para la que ya lo tiene');
});
