/**
 * Los tres archivos de la institución son imágenes, y se comprueba dos veces.
 *
 * El logo, el sello y la firma se guardan como AJUSTES: lo que queda en la base
 * es el nombre del archivo, en un campo de texto libre. Nada comprobaba lo que
 * se le ponía, y una de las tres rutas que los entrega —la del logo— no pide
 * sesión, porque el logo tiene que verse en la pantalla de acceso, antes de que
 * haya nadie identificado.
 *
 * Medido en la v1.423.0, apuntando «iglesia_logo» al nombre de un documento
 * subido a una ficha:
 *
 *   GET /uploads/…reservado.txt ............  401 · pide sesión
 *   GET /api/configuracion/logo ............  200 · y su contenido entero,
 *                                             sin sesión, a internet abierta
 *
 * O sea que quien tuviera la llave de la configuración podía publicar cualquier
 * archivo subido al sistema —el carnet escaneado de un miembro, un informe de
 * tesorería, la carpeta de un pastor— y el único síntoma era que el logo se
 * veía roto (hallazgo CO-02).
 *
 * Se cierra por los DOS lados, porque cada uno tapa un pedazo distinto: al
 * guardar, para que no entre; y al entregar, porque lo guardado pudo quedar
 * puesto antes de esta versión o el archivo pudo cambiar en el disco. Es el
 * mismo criterio con que se cerró la subida de archivos en su momento.
 *
 * ── CÓMO SE MIRA, QUE ACÁ NO ES LO DE SIEMPRE ──
 *
 * El logo, el sello y la firma son UNO SOLO para todo el sistema: no cuelgan de
 * ninguna ficha, así que no se pueden marcar por proceso como se hace en el
 * resto de las pruebas del motor. Y hay otros archivos que los necesitan
 * cargados —sin ellos no se puede emitir una credencial—, de modo que los tres
 * se van pisando todo el rato, con toda razón.
 *
 * Por eso acá NO se afirma nunca cuánto vale uno de esos ajustes. Se afirma lo
 * que sí es de esta prueba: que lo que ELLA manda se acepte o se rechace. Y
 * donde hace falta mirar lo guardado —porque lo que se comprueba es justamente
 * que se entregue el archivo configurado— se reintenta hasta que el valor siga
 * siendo el suyo al terminar de pedirlo. En la práctica entra a la primera.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema, elPuerto } = require('./andando');
const ajustes = require('../../server/ajustes');
const tipos = require('../../server/tiposdearchivo');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

// Un PNG de un pixel, de verdad: empieza con la firma que el sistema conoce
const UN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Deja un archivo en la carpeta de subidas y devuelve su nombre. */
function unArchivo(nombre, contenido) {
  const suyo = `co02-${marca}-${nombre}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, suyo), contenido);
  return suyo;
}

const elDocumento = unArchivo('reservado.txt', 'INFORME RESERVADO\nDiagnóstico de un miembro.\n');
const elPdf = unArchivo('acta.pdf', Buffer.from('%PDF-1.4\nlo que sea\n'));
const elFalso = unArchivo('parece-logo.png', 'INFORME RESERVADO, pero con nombre de imagen');
const laImagen = unArchivo('logo.png', UN_PNG);

/**
 * Deja puesto un ajuste compartido, pide algo, y contesta solo si al terminar
 * el ajuste seguía siendo el nuestro. Ver la explicación de arriba.
 */
async function conElAjustePuesto(clave, valor, pedir) {
  for (let intento = 0; intento < 25; intento++) {
    ajustes.guardar(clave, valor);
    const salida = await pedir();
    if (ajustes.obtener(clave) === valor) return salida;
  }
  return null;
}

// --------------------------------------------- lo que se pregunta -----------

test('«es una imagen» se contesta como al subir: por el nombre y por dentro', () => {
  assert.equal(tipos.esUnaImagen('logo.png', UN_PNG), true);
  assert.equal(tipos.esUnaImagen('reservado.txt', Buffer.from('INFORME')), false);
  assert.equal(tipos.esUnaImagen('acta.pdf', Buffer.from('%PDF-1.4')), false, 'un PDF no es una imagen');
  assert.equal(tipos.esUnaImagen('logo.png', Buffer.from('INFORME RESERVADO')), false,
    'llamarle «.png» a otra cosa no la convierte en imagen');
  assert.equal(tipos.esUnaImagen('carta.docx', Buffer.from('PK')), false);
});

// --------------------------------------------- la puerta de guardar ---------

test('no se puede apuntar el logo a un documento que no es imagen', async () => {
  const api = await elSistemaAndando();
  const r = await api('PUT', '/configuracion', { iglesia_logo: elDocumento });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /no es una imagen/);
  assert.match(r.json.error, /Logo/, 'y dice cuál de los tres es');
  assert.notEqual(ajustes.obtener('iglesia_logo'), elDocumento, 'y no quedó puesto');
});

test('ni a un PDF, ni a un archivo con nombre de imagen que no lo es', async () => {
  const api = await elSistemaAndando();
  for (const cual of [elPdf, elFalso]) {
    const r = await api('PUT', '/configuracion', { credencial_sello: cual });
    assert.equal(r.estado, 400, `con ${cual}: ${r.texto.slice(0, 200)}`);
    assert.match(r.json.error, /no es una imagen/);
    assert.notEqual(ajustes.obtener('credencial_sello'), cual, 'y no quedó puesto');
  }
});

test('ni a un archivo que no está', async () => {
  const api = await elSistemaAndando();
  const r = await api('PUT', '/configuracion', { credencial_firma: `no-existe-${marca}.png` });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /ya no está/);
});

test('y el guardado se rechaza ENTERO, no a medias', async () => {
  const api = await elSistemaAndando();
  const elWeb = `https://co02-${marca}.cl`;
  const r = await api('PUT', '/configuracion', { iglesia_logo: elDocumento, iglesia_web: elWeb });
  assert.equal(r.estado, 400);
  assert.notEqual(ajustes.obtener('iglesia_web'), elWeb,
    'quien se equivocó de archivo tiene que enterarse, no creer que guardó');
});

test('una imagen de verdad sí entra', async () => {
  const api = await elSistemaAndando();
  // Se mira que se ACEPTE. Que lo aceptado quede puesto lo comprueba, más
  // abajo, la prueba que pide el logo y compara lo que llega.
  const puesta = await api('PUT', '/configuracion', { iglesia_logo: laImagen });
  assert.equal(puesta.estado, 200, puesta.texto.slice(0, 200));
});

test('y dejarla en blanco también, que es como se vuelve al logo de fábrica', () => {
  /*
   * Éste se mira en la REGLA y no pidiendo la ruta.
   *
   * Para comprobarlo por la ruta habría que dejar el logo en blanco el rato que
   * dura la petición, y el logo es uno solo para todo el sistema: sin él no se
   * puede emitir una credencial, así que ese instante en blanco les rompe la
   * prueba a los archivos que emiten. Se mira donde vive la regla.
   */
  const { problemaDeLaImagen } = require('../../server/configuracion');
  assert.equal(problemaDeLaImagen(''), null, 'en blanco se puede: así se quita el sello');
  assert.equal(problemaDeLaImagen('   '), null);
  assert.equal(problemaDeLaImagen(null), null);
  assert.equal(problemaDeLaImagen(laImagen), null, 'y una imagen de verdad, también');
  assert.match(problemaDeLaImagen(elDocumento), /no es una imagen/);
  assert.match(problemaDeLaImagen(`no-existe-${marca}.png`), /ya no está/);
});

test('pero reenviar el que YA está puesto no rompe el guardado', async () => {
  const api = await elSistemaAndando();
  /*
   * Es el caso que apareció al correr la batería, y es la misma forma del
   * hallazgo CO-01: la pantalla manda los setenta campos, así que el nombre del
   * logo que ya está puesto viaja en cada guardado. Si lo guardado es un archivo
   * que se borró del disco, revisarlo dejaría a la persona sin poder guardar
   * NADA —y por algo que ella no hizo—.
   */
  const roto = `se-borro-del-disco-${marca}.png`;
  const r = await conElAjustePuesto('iglesia_logo', roto,
    () => api('PUT', '/configuracion', { iglesia_logo: roto, iglesia_rut: `CO ${marca}` }));
  ajustes.guardar('iglesia_logo', laImagen);   // se deja una válida para los demás
  assert.ok(r, 'no se alcanzó a guardar sin que otra prueba cambiara el logo');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  // Y cambiarlo por otro malo sigue rechazándose: lo que se revisa es lo nuevo
  const malo = await api('PUT', '/configuracion', { iglesia_logo: elDocumento });
  assert.equal(malo.estado, 400, malo.texto.slice(0, 200));
});

// --------------------------------------------- la puerta de entregar --------

/** La ruta del logo, pedida SIN sesión, que es como la pide el navegador. */
async function elLogoSinSesion() {
  const r = await fetch(`http://127.0.0.1:${elPuerto()}/api/configuracion/logo`);
  return {
    estado: r.status,
    tipo: r.headers.get('content-type'),
    cuerpo: Buffer.from(await r.arrayBuffer()),
  };
}

test('lo que quedó guardado de antes tampoco se entrega', async () => {
  await elSistemaAndando();
  // Se escribe DERECHO en la base, sin pasar por la ruta: es lo que pasa con un
  // valor puesto antes de esta versión, o con un archivo que cambió en el disco
  const r = await conElAjustePuesto('iglesia_logo', elDocumento, elLogoSinSesion);
  ajustes.guardar('iglesia_logo', laImagen);   // se deja una válida para los demás
  assert.ok(r, 'no se alcanzó a pedir el logo sin que otra prueba lo cambiara');
  assert.equal(r.estado, 200, 'la pantalla de acceso nunca queda con un hueco');
  assert.match(r.tipo, /^image\//, `se entregó «${r.tipo}»`);
  assert.ok(!r.cuerpo.toString('latin1').includes('RESERVADO'),
    'y lo que salió NO es el documento: sale el logo de fábrica');
});

test('con un logo de verdad puesto, se entrega ese', async () => {
  await elSistemaAndando();
  const r = await conElAjustePuesto('iglesia_logo', laImagen, elLogoSinSesion);
  assert.ok(r, 'no se alcanzó a pedir el logo sin que otra prueba lo cambiara');
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.length, UN_PNG.length, 'es el archivo configurado y no el de fábrica');
});

test('el sello y la firma, lo mismo, y diciendo qué pasa', async () => {
  const api = await elSistemaAndando();
  const r = await conElAjustePuesto('credencial_sello', elDocumento,
    () => api('GET', '/configuracion/recurso/sello'));
  // Se deja una imagen VÁLIDA, nunca en blanco: sin sello no se puede emitir
  // una credencial, y el sello es uno solo para todo el sistema
  ajustes.guardar('credencial_sello', laImagen);
  assert.ok(r, 'no se alcanzó a pedir el sello sin que otra prueba lo cambiara');
  assert.equal(r.estado, 404, r.texto.slice(0, 200));
  assert.match(r.json.error, /no es una imagen/);
  assert.match(r.json.error, /Vuelva a cargarlo/, 'y dice qué hacer');
});

test('las dos puertas preguntan lo mismo, y se lo preguntan al mismo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/configuracion.js'), 'utf8');
  assert.match(fuente, /require\('\.\/tiposdearchivo'\)\.esUnaImagen/,
    'se pregunta con la misma cuenta que usa el sistema al subir un archivo');
  // La de entregar sale de la de guardar: dos maneras de decidir qué es una
  // imagen habrían sido dos verdades
  assert.match(
    fuente,
    /function laImagenQueSePuedeEntregar\(clave\) \{[\s\S]*?problemaDeLaImagen\(nombre\)/,
    'la puerta de entregar se apoya en la misma comprobación que la de guardar'
  );
  assert.ok(!/const ruta = suyo \? path\.join\(UPLOADS_DIR, path\.basename\(suyo\)\) : null;/.test(fuente),
    'la ruta del logo ya no arma el camino sin preguntar qué hay al final');
});
