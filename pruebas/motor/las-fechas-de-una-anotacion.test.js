/**
 * UNA FECHA DENTRO DE UNA ANOTACIÓN, ESCRITA COMO SE LEE.
 *
 * Medido: anotarle el bautismo a una ficha dejaba escrito en su historial
 * «Fecha de bautismo: (vacío) → 2005-11-06», que es como la guarda la base y no
 * como se escribe acá. En el Registro de Cambios, 87 de 205 líneas llevaban una
 * fecha así.
 *
 * El texto de cada cambio lo arma una función que ya sabía escribir bien casi
 * todo: la plata con su signo y sus miles, un enlace con el nombre de aquello a
 * lo que apunta —«Cuenta: Tesorería general» y no «Cuenta: 5»—, una lista de
 * enlaces con todos sus nombres, un sí o un no en vez de un uno o un cero. Las
 * fechas eran lo único que se le escapaba.
 *
 * Y no son las líneas que menos importan. Son 55 los campos de fecha del
 * sistema, y los ocho de una ficha de miembro son el nacimiento, la conversión,
 * el bautismo, el ingreso a la iglesia, los dos matrimonios, el traslado y el
 * fallecimiento: justo las que alguien va a leer en voz alta.
 *
 * (Anotarle el bautismo POR PRIMERA VEZ ya no pasa por esta línea: desde BM-09
 * tiene su propia anotación, con su tipo y en su fecha. Acá sigue apareciendo el
 * bautismo cuando la fecha se CORRIGE, que sí es un cambio de datos, y el resto
 * se comprueba con las otras siete fechas de la ficha.)
 *
 * Lo que cuida este archivo:
 *   · que una fecha salga como se lee acá
 *   · que lo que NO sea una fecha se deje como está, en vez de traducirlo a
 *     medias: en una columna vieja puede haber cualquier cosa
 *   · que lo que esa función ya escribía bien siga igual
 *   · y que valga para los tres historiales y para el Registro de Cambios, que
 *     usan todos la misma función
 *
 * Lo que NO cambia, y está bien: el texto de una anotación se guarda hecho y no
 * se vuelve a componer al leerlo, así que las líneas escritas antes siguen
 * diciendo lo que decían el día en que se escribieron —medido: 40 en la base de
 * prueba—. Son la constancia de ese día. Esto arregla de acá en adelante. No se
 * escribe una prueba de eso porque no habría manera de hacerla fallar: sería
 * insertar una fila y volver a leerla.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const registry = require('../../server/registry');

const MIEMBROS = registry.getModule('miembros');
const deNacimiento = MIEMBROS.fields.find((f) => f.name === 'fecha_nacimiento');
const deBautismo = MIEMBROS.fields.find((f) => f.name === 'fecha_bautismo');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las fechas', 'IG-LFA', 'Activa')")
  .run().lastInsertRowid;
const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run('Elsa', 'Con Fechas', iglesia).lastInsertRowid;

/** Lo que queda escrito al guardar un cambio, como lo escribe el motor. */
function alCambiar(despues, antes) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(MIEMBROS, {
    isNew: false, antes, despues: { id: miembro, iglesia_id: iglesia, ...despues },
    datos: despues, user: { id: 1, nombre: 'Quien Guarda' },
  });
  const fila = db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde)[0];
  return fila ? fila.descripcion : null;
}

/* ------------------------------- una fecha se lee como acá se lee */

test('una fecha sale como se escribe acá, no como la guarda la base', () => {
  assert.equal(alCambiar({ fecha_conversion: '2005-11-06' }, { fecha_conversion: null }),
    'Fecha de conversión: (vacío) → 06-11-2005');
});

test('las dos, la de antes y la de después', () => {
  assert.equal(alCambiar({ fecha_bautismo: '2005-11-06' }, { fecha_bautismo: '2004-01-31' }),
    'Fecha de bautismo: 31-01-2004 → 06-11-2005');
});

test('vale para todas las fechas de la ficha, no solo para una', () => {
  const texto = alCambiar(
    { fecha_nacimiento: '1979-04-12', fecha_conversion: '2003-08-24' },
    { fecha_nacimiento: null, fecha_conversion: null }
  );
  assert.match(texto, /Fecha de nacimiento: \(vacío\) → 12-04-1979/);
  assert.match(texto, /Fecha de conversión: \(vacío\) → 24-08-2003/);
  assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2}/, 'ninguna fecha de máquina queda en la línea');
});

test('son ocho las fechas de una ficha de miembro, y ninguna está reservada', () => {
  // Si alguna lo estuviera, no llegaría a esta función: quedaría en
  // «actualizada», que es lo que se hace con los datos de salud.
  const fechas = MIEMBROS.fields.filter((f) => f.type === 'date');
  assert.equal(fechas.length, 8);
  assert.equal(fechas.filter((f) => f.sensible).length, 0);
});

/* ------------------------------- lo que no es una fecha se deja quieto */

test('un 30 de febrero no es una fecha: se deja tal cual', () => {
  // Tiene la forma correcta y no es un día. Traducirlo sería inventar uno.
  assert.equal(alCambiar({ fecha_bautismo: '2026-02-30' }, { fecha_bautismo: null }),
    'Fecha de bautismo: (vacío) → 2026-02-30');
});

test('un texto cualquiera en una columna vieja se deja como está', () => {
  assert.equal(alCambiar({ fecha_bautismo: 'no consta' }, { fecha_bautismo: null }),
    'Fecha de bautismo: (vacío) → no consta');
});

test('una fecha con hora se queda con su parte de fecha', () => {
  assert.equal(alCambiar({ fecha_conversion: '1999-01-01T00:00:00' }, { fecha_conversion: null }),
    'Fecha de conversión: (vacío) → 01-01-1999');
});

test('vacía sigue diciendo «(vacío)»', () => {
  assert.equal(alCambiar({ fecha_bautismo: null }, { fecha_bautismo: '2005-11-06' }),
    'Fecha de bautismo: 06-11-2005 → (vacío)');
});

/* ------------------------------- lo que ya escribía bien sigue igual */

test('el resto de lo que esa función sabe escribir no se tocó', () => {
  const texto = alCambiar(
    { estado: 'Trasladado', ocupacion: 'Costurera' },
    { estado: 'Activo', ocupacion: null }
  );
  assert.match(texto, /Estado: Activo → Trasladado/);
  assert.match(texto, /Profesión u oficio: \(vacío\) → Costurera/);

  const conIglesia = alCambiar({ iglesia_id: iglesia }, { iglesia_id: null });
  assert.match(conIglesia, /Iglesia: \(vacío\) → De las fechas/,
    'un enlace sigue saliendo con el nombre de aquello a lo que apunta, no con su número');
});

/* ------------------------------- una sola función, cuatro libros */

test('la plata sigue saliendo con su signo y sus miles, en el Registro de Cambios', () => {
  /*
   * Este es el otro libro que usa la misma función, y el único módulo con un
   * campo de dinero está vigilado por él: cambiarle el monto a un movimiento
   * escribe su línea allá. Así se comprueba de una vez que lo que esa función
   * ya escribía bien sigue igual, y que el arreglo llegó también a ese libro.
   */
  const cuenta = db
    .prepare(
      `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, estado, iglesia_id)
       VALUES ('Caja de las fechas', 'Iglesia', 'Caja', 'Activa', ?)`
    ).run(iglesia).lastInsertRowid;
  const movimiento = db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES ('2026-05-18', 'Ingreso', 'Ofrenda', 'Ofrenda del domingo', 250000, ?, ?)`
  ).run(cuenta, iglesia).lastInsertRowid;

  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  bitacora.registrarGuardado(registry.getModule('tesoreria'), {
    isNew: false,
    antes: { monto: 250000, fecha: '2026-05-18' },
    despues: { id: movimiento, iglesia_id: iglesia, monto: 310000, fecha: '2026-06-22' },
    datos: { monto: 310000, fecha: '2026-06-22' },
    user: { id: 1, nombre: 'Quien Guarda' },
  });
  const linea = db.prepare('SELECT * FROM registro_cambios WHERE id > ? ORDER BY id').all(desde)[0];
  assert.ok(linea, 'no quedó nada anotado en el Registro de Cambios');
  assert.match(linea.detalle, /Monto: \$\u00a0250\.000 → \$\u00a0310\.000/,
    'la plata con su signo y sus miles, como siempre');
  assert.match(linea.detalle, /Fecha: 18-05-2026 → 22-06-2026/,
    'y la fecha como se lee, que es lo que se arregló');
});

test('la misma función la usan los tres historiales y el Registro de Cambios', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const laFuncion = src.slice(src.indexOf('function legible'), src.indexOf('function resumenDe'));
  assert.match(laFuncion, /campo\.type === 'date'/);
  assert.match(laFuncion, /normalizar, comoSeLee/,
    'se comprueba con la misma función con que el motor valida cualquier fecha');
  // `cambios()` la usa para el «antes → después» y `resumenDe()` para el
  // resumen de lo que se borra; de ahí salen las líneas de los cuatro libros.
  const cambios = src.slice(src.indexOf('function cambios'), src.indexOf('function registrarGuardado'));
  assert.match(cambios, /legible\(f, previo\)/);
  assert.match(cambios, /legible\(f, nuevo\)/);
  const resumen = src.slice(src.indexOf('function resumenDe'), src.indexOf('function cambios'));
  assert.match(resumen, /legible\(campo, valor\)/);
});
