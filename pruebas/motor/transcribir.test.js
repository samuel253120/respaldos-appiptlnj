/**
 * Traer al sistema el texto de un documento adjunto.
 *
 * POR QUÉ IMPORTA QUE ESTO ESTÉ PROBADO. Un acta se puede registrar de dos
 * maneras —escribiéndola o adjuntándola—, y desde la 1.99.0 las dos se juntan:
 * si el documento trae texto, se puede traer al editor en vez de escribirlo de
 * nuevo. Lo que se prueba acá no es tanto que funcione como que FALLE BIEN:
 *
 *   · un acta ESCANEADA no trae texto, porque por dentro es una fotografía del
 *     papel. Es el caso más común de un acta firmada, y es justo donde esto no
 *     puede hacer nada. Si respondiera «listo» y dejara el campo vacío, la
 *     persona pensaría que el sistema se equivocó; tiene que decirlo;
 *   · lo que entra viene de AFUERA —un .docx lo trae quien sea— y termina en un
 *     campo que después leen todos, así que tiene que pasar por el saneador
 *     igual que lo que se escribe a mano;
 *   · y el nombre del archivo no puede sacar a nadie de la carpeta de adjuntos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { UPLOADS_DIR } = require('../../server/db');
const { delArchivo, comoParrafos } = require('../../server/transcribir');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const dejarArchivo = (nombre, contenido) => {
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), contenido);
  return nombre;
};

// ───────────────────────────────────────────── el texto pelado ───

test('un archivo de texto se parte en párrafos', async () => {
  dejarArchivo('acta.txt',
    'Primer párrafo del acta, donde se deja constancia de la reunión.\n\n'
    + 'Segundo párrafo, con los acuerdos que se tomaron ese día.');
  const r = await delArchivo('acta.txt');
  assert.equal(r.error, undefined, r.error);
  assert.match(r.texto, /<p>Primer párrafo del acta/);
  assert.match(r.texto, /<p>Segundo párrafo, con los acuerdos/);
});

test('un salto suelto adentro de un párrafo no lo corta en dos', () => {
  // Un acta trae direcciones y nombres cortados por el ancho de la hoja: cada
  // salto suelto es parte del mismo párrafo, no uno nuevo.
  assert.equal(comoParrafos('Una línea\ny su continuación'), '<p>Una línea<br>y su continuación</p>');
});

test('lo que venga escrito con «<» se escribe como texto, no como etiqueta', async () => {
  dejarArchivo('raro.txt', 'Se acordó que el saldo < 100 quedó pendiente para la próxima reunión.');
  const r = await delArchivo('raro.txt');
  assert.match(r.texto, /&lt;/, 'el «<» tiene que quedar escrito');
  assert.doesNotMatch(r.texto, /<100/);
});

// ─────────────────────────────────── lo que no se puede transcribir ───

test('EL CASO QUE MÁS IMPORTA: un acta escaneada lo dice, no devuelve vacío', async () => {
  /*
   * Un PDF escaneado se lee sin error y no entrega ni una letra. Devolver
   * «listo» con el campo en blanco es la peor respuesta posible: parece que el
   * sistema falló en silencio. Se comprueba con un PDF de verdad, sin capa de
   * texto, armado a mano.
   */
  const sinTexto = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
  dejarArchivo('escaneada.pdf', sinTexto);
  const r = await delArchivo('escaneada.pdf');
  assert.ok(r.error, 'tiene que negarse, no devolver un texto vacío');
  assert.match(r.error, /no trae texto|no se pudo leer/i);
  assert.equal(r.texto, undefined);
});

test('el Word antiguo (.doc) se explica y se sugiere qué hacer', async () => {
  dejarArchivo('viejo.doc', 'da lo mismo lo que diga');
  const r = await delArchivo('viejo.doc');
  assert.match(r.error, /\.docx/, 'tiene que decir cómo salir del paso');
});

test('de una planilla no se saca un acta, y se dice cuáles sí', async () => {
  dejarArchivo('numeros.xlsx', 'da lo mismo');
  const r = await delArchivo('numeros.xlsx');
  assert.match(r.error, /docx/i);
  assert.match(r.error, /PDF/);
});

test('un archivo que ya no está se explica en vez de reventar', async () => {
  const r = await delArchivo('no-existe-jamas.pdf');
  assert.match(r.error, /ya no está/i);
});

test('un archivo sin nombre no se busca', async () => {
  for (const nada of ['', null, undefined]) {
    const r = await delArchivo(nada);
    assert.ok(r.error, `${JSON.stringify(nada)} tendría que negarse`);
  }
});

// ────────────────────────────────────────────────── la carpeta ───

test('el nombre del archivo no saca a nadie de la carpeta de adjuntos', async () => {
  // La base de datos vive un nivel más arriba que los adjuntos. Sin recortar el
  // nombre, «../iglesias.db» la entregaría convertida en texto.
  const arriba = path.join(UPLOADS_DIR, '..', 'iglesias.db');
  assert.ok(fs.existsSync(arriba), 'la base está donde se supone, así que la prueba vale');
  for (const trampa of ['../iglesias.db', '../../iglesias.db', '/etc/passwd', '..\\iglesias.db']) {
    const r = await delArchivo(trampa);
    assert.ok(r.error, `${trampa} tendría que negarse`);
    assert.doesNotMatch(r.error, /SQLite/i);
  }
});

// ──────────────────────────────────────── lo que sale, ya saneado ───

test('lo que entra pasa por el saneador antes de salir', async () => {
  // Un .docx lo trae alguien de afuera, y lo transcrito termina en un campo que
  // después leen todos. Vale la misma regla que para lo que se escribe a mano.
  dejarArchivo('con-codigo.txt', 'Acuerdos de la reunión del cuerpo de coro para el año entrante.');
  const r = await delArchivo('con-codigo.txt');
  assert.doesNotMatch(r.texto, /<script|onerror=|javascript:/i);
  const textorico = require('../../server/textorico');
  assert.equal(textorico.limpiar(r.texto), r.texto, 'saneado otra vez no cambia nada: ya venía limpio');
});

test('se dice cuántas palabras se trajeron y de qué', async () => {
  dejarArchivo('cuenta.txt', 'una dos tres cuatro cinco seis siete ocho');
  const r = await delArchivo('cuenta.txt');
  assert.equal(r.palabras, 8);
  assert.match(r.de, /texto/);
});

test('un documento con casi nada no se da por transcrito', async () => {
  // Cuatro palabras sueltas no son un acta: es lo que sale de un PDF que trae
  // solo el número de página. Se trata igual que el que no trae nada.
  dejarArchivo('casi-nada.txt', 'uno dos tres');
  const r = await delArchivo('casi-nada.txt');
  assert.ok(r.error, 'tendría que negarse');
});
