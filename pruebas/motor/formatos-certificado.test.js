/**
 * Los formatos con que se imprime cada certificado.
 *
 * POR QUÉ IMPORTA. Un certificado se firma, se sella y se entrega: lo que
 * salió impreso no se puede corregir después. Y ahora lo que dice y cómo se ve
 * ya no está en el programa sino en una ficha que la iglesia edita, así que un
 * error acá sale en papel.
 *
 * Lo que se cuida:
 *
 *   · Que los datos entre llaves se reemplacen TODOS. Una llave que sobreviva
 *     —«{fecha_evento}» impreso tal cual— obliga a rehacer el certificado.
 *   · Que los números del diseño se acoten. Un título de 4.000 px o un margen
 *     de 300 mm no rompen nada, pero dejan la hoja inservible y a quien la
 *     emitió sin entender qué pasó.
 *   · Que un formato que ya se usó no se pueda borrar sin aviso: es el tipo con
 *     que quedaron emitidos certificados que ya están entregados.
 *   · Que el color que se guarda sea un color y nada más: termina dentro de un
 *     atributo `style` de la hoja, y ahí cualquier otra cosa es una puerta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/formatos_certificado');
const { formatosDeCertificadoQueTraiaElSistema } = require('../../server/migraciones');

/* ── Los que traía el sistema ──────────────────────────────────────── */

formatosDeCertificadoQueTraiaElSistema();
const sembrados = db.prepare('SELECT * FROM formatos_certificado ORDER BY orden').all();

test('al actualizar quedan los ocho tipos que traía el sistema', () => {
  // Si no, una iglesia que ya venía emitiendo se queda sin ningún tipo para
  // elegir, y el módulo de certificados deja de servir de un día para otro.
  assert.equal(sembrados.length, 8);
  assert.deepEqual(
    sembrados.map((f) => f.nombre),
    ['Bautismo', 'Presentación de niños', 'Matrimonio', 'Membresía', 'Traslado',
      'Buena conducta', 'Reconocimiento', 'Otro']
  );
});

test('todos vienen en uso y con su texto', () => {
  for (const f of sembrados) {
    assert.equal(f.activo, 1, `«${f.nombre}» vino desactivado`);
    assert.ok(String(f.texto || '').trim(), `«${f.nombre}» vino sin texto`);
  }
});

test('correrla de nuevo no duplica los formatos', () => {
  formatosDeCertificadoQueTraiaElSistema();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM formatos_certificado').get().c, 8);
});

/* ── Los números del diseño ────────────────────────────────────────── */

const guardando = (datos) => {
  const copia = { ...datos };
  const error = def.hooks.beforeSave(copia, { existing: null, db });
  return { error, datos: copia };
};

test('un tamaño o un margen imposible se acota en vez de guardarse', () => {
  const { datos } = guardando({
    nombre: 'De prueba', tamano_titulo: 4000, tamano_texto: 0, margen: 300, fondo_opacidad: 900, orden: -5,
  });
  assert.equal(datos.tamano_titulo, 96);
  assert.equal(datos.tamano_texto, 8);
  assert.equal(datos.margen, 40);
  assert.equal(datos.fondo_opacidad, 100);
  assert.equal(datos.orden, 0);
});

test('lo que no es número vuelve al valor de fábrica', () => {
  const { datos } = guardando({ nombre: 'De prueba', tamano_titulo: 'grande', margen: null });
  assert.equal(datos.tamano_titulo, 34);
  assert.equal(datos.margen, 18);
});

test('un formato sin nombre no se guarda: es con lo que se elige al emitir', () => {
  assert.match(String(guardando({ nombre: '   ' }).error), /necesita un nombre/);
});

test('al nombre se le sacan los espacios de los bordes', () => {
  // «Bautismo » y «Bautismo» serían dos tipos distintos en la lista, y el
  // certificado guardaría uno que después no calza con ningún formato.
  assert.equal(guardando({ nombre: '  Bautismo especial  ' }).datos.nombre, 'Bautismo especial');
});

test('la imagen de fondo tiene que ser un archivo de la carpeta de subidas', () => {
  // El nombre se pega dentro de src="/uploads/…" de la hoja impresa: una barra
  // de más apunta fuera de esa carpeta.
  assert.equal(guardando({ nombre: 'Con fondo', fondo: 'orla-1234.png' }).error, null);
  for (const intento of ['../../server/db.js', '/etc/passwd', 'x.png" onerror="alert(1)', 'algo.js']) {
    assert.match(String(guardando({ nombre: 'Con fondo', fondo: intento }).error), /no es válida/, `pasó: ${intento}`);
  }
});

/* ── Borrar un formato en uso ──────────────────────────────────────── */

test('un formato con certificados emitidos no se borra, y se explica qué hacer', () => {
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Cert', 'IG-CE', 'Activa')")
    .run().lastInsertRowid;
  db.prepare(
    `INSERT INTO certificados (numero, tipo, iglesia_id, nombre_titular, fecha_emision, estado)
     VALUES ('C-1', 'Bautismo', ?, 'Alguien', '2026-01-01', 'Emitido')`
  ).run(iglesia);

  const error = def.hooks.beforeDelete({ nombre: 'Bautismo' }, { db });
  assert.match(String(error), /certificado\(s\) ya emitido/);
  assert.match(String(error), /En uso/);   // dice la salida, no solo el problema
});

test('uno que nadie usó se borra sin más', () => {
  assert.equal(def.hooks.beforeDelete({ nombre: 'Reconocimiento' }, { db }), null);
});

/* ── El color que se guarda ────────────────────────────────────────── */

const { coerce } = require('../../server/crud');

test('un color se guarda solo si es un color', () => {
  assert.equal(coerce({ type: 'color' }, '#16265C'), '#16265c');
  assert.equal(coerce({ type: 'color' }, '#abc'), null);          // corto: no
  assert.equal(coerce({ type: 'color' }, 'red'), null);           // por nombre: no
  assert.equal(coerce({ type: 'color' }, ''), null);
});

test('EL QUE IMPORTA: lo que intenta salirse del color no se guarda', () => {
  // El valor termina dentro del atributo `style` de la hoja impresa. Sin esta
  // comprobación, cualquiera con permiso para editar un formato podría meter
  // ahí lo que quisiera y quedaría en cada certificado que se imprima.
  for (const intento of [
    'red;background:url(http://ajeno/x)',
    '#16265c;position:fixed',
    'expression(alert(1))',
    '</style><script>alert(1)</script>',
  ]) {
    assert.equal(coerce({ type: 'color' }, intento), null, `pasó: ${intento}`);
  }
});
