/**
 * Qué archivos se aceptan y cómo se entregan.
 *
 * Sin esto, alguien que pudiera adjuntar un documento podía subir una página
 * web y el sistema se la entregaba al siguiente que la abriera **como página
 * propia**, con la sesión de esa persona adentro.
 *
 * Se cierra por el nombre y por el contenido, y las dos cosas hacen falta:
 * el nombre solo no basta —basta con renombrarlo— y el contenido solo
 * tampoco, porque hay formatos de oficina que no tienen firma reconocible.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tipos = require('../../server/tiposdearchivo');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n');
const HTML = Buffer.from('<script>alert(1)</script>');

test('una foto de verdad se acepta', () => {
  assert.equal(tipos.seAcepta('foto.jpg', JPEG).ok, true);
  assert.equal(tipos.seAcepta('foto.JPG', JPEG).ok, true, 'la extensión en mayúsculas es la misma');
  assert.equal(tipos.seAcepta('captura.png', PNG).ok, true);
  assert.equal(tipos.seAcepta('acta.pdf', PDF).ok, true);
});

test('una página web no se puede subir', () => {
  for (const nombre of ['trampa.html', 'trampa.htm', 'trampa.svg', 'trampa.js', 'trampa.xml', 'trampa.exe', 'trampa.sh']) {
    const r = tipos.seAcepta(nombre, HTML);
    assert.equal(r.ok, false, `«${nombre}» no debería aceptarse`);
    assert.match(r.motivo, /Se aceptan/, 'el aviso tiene que decir qué sí se puede');
  }
});

test('ni disfrazada de foto: se le miran los bytes', () => {
  const r = tipos.seAcepta('trampa.jpg', HTML);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /contenido/);
});

test('un archivo sin extensión no entra', () => {
  assert.equal(tipos.seAcepta('sinpunto', JPEG).ok, false);
  assert.equal(tipos.seAcepta('', JPEG).ok, false);
});

test('los documentos de oficina entran sin mirarles los bytes', () => {
  // Varían entre versiones y no tienen una firma única; se entregan como
  // descarga, así que no se abren en el navegador de nadie.
  for (const nombre of ['reglamento.docx', 'libro.xlsx', 'charla.pptx', 'acta.odt', 'notas.txt', 'datos.csv']) {
    assert.equal(tipos.seAcepta(nombre, Buffer.from('cualquier cosa')).ok, true, `«${nombre}» debería aceptarse`);
  }
});

test('las fotos y los PDF se muestran; lo demás se baja', () => {
  for (const nombre of ['foto.jpg', 'captura.png', 'acta.pdf']) {
    assert.equal(tipos.comoSeEntrega(nombre)['Content-Disposition'], 'inline', `${nombre} debería verse en pantalla`);
  }
  for (const nombre of ['reglamento.docx', 'libro.xlsx', 'notas.txt']) {
    assert.equal(tipos.comoSeEntrega(nombre)['Content-Disposition'], 'attachment', `${nombre} debería bajarse`);
  }
});

test('el tipo lo pone el sistema, nunca el nombre del archivo', () => {
  assert.equal(tipos.comoSeEntrega('foto.jpg')['Content-Type'], 'image/jpeg');
  assert.equal(tipos.comoSeEntrega('acta.pdf')['Content-Type'], 'application/pdf');
  // Uno de antes de esta revisión, con un formato que no está en la lista:
  // se entrega igual, pero como archivo que se baja y sin tipo que lo abra
  const viejo = tipos.comoSeEntrega('deantes.xyz');
  assert.equal(viejo['Content-Type'], 'application/octet-stream');
  assert.equal(viejo['Content-Disposition'], 'attachment');
});

test('siempre se le prohíbe al navegador adivinar el tipo', () => {
  for (const nombre of ['foto.jpg', 'reglamento.docx', 'deantes.xyz']) {
    assert.equal(tipos.comoSeEntrega(nombre)['X-Content-Type-Options'], 'nosniff');
  }
});
