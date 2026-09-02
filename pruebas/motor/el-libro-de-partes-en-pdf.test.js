/**
 * OP-12 · El libro que no se podía bajar.
 *
 * MEDIDO en la v1.290.0: la vista de impresión del libro salía bien —membrete,
 * cierre y las dos firmas—, y las dos rutas de archivo contestaban 404:
 *
 *   GET /documentos/:id/pdf ........ 404
 *   GET /documentos/libro/pdf ...... 404
 *
 * Imprimir y bajar no son lo mismo. Imprimir es apretar el botón del navegador
 * y aceptar lo que ese navegador decida —sus márgenes, la dirección de la
 * página arriba, el «1/3» del pie—; bajar es tener el documento. Y un libro de
 * partes es exactamente lo que se manda por correo a un auditor, a un abogado o
 * a la Superintendencia: tiene que salir igual siempre y tiene que poder
 * adjuntarse. Los dos libros de actas ya lo tenían desde la 1.100.0 y la
 * 1.283.0.
 *
 * LO QUE ESTE ARCHIVO CUIDA, además de que el PDF salga: que diga LO MISMO que
 * la hoja de la pantalla. Son dos maneras de sacar el mismo libro, y el cierre
 * —«En este libro constan 3 documento(s)…»— es la parte que AFIRMA algo y que
 * alguien firma. Escrito dos veces, tarde o temprano dirían cosas distintas, así
 * que las palabras se escriben una sola vez (server/libro-en-palabras.js) y
 * viajan con el libro.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { loQueDiceElPdf } = require('./lo-que-dice-el-pdf');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia(nombre = 'Oficina') {
  const m = marca();
  return {
    id: db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
      .run(`${nombre} ${m}`, `OP${m}`.slice(0, 18)).lastInsertRowid,
    nombre: `${nombre} ${m}`,
  };
}

/**
 * LO QUE DICE UN PDF, armado llamando al generador con lo que ya está guardado.
 *
 * No se pide por HTTP: el pase de las pruebas devuelve el cuerpo como texto y
 * un PDF es binario, así que por ese camino llega roto —se probó, y el texto
 * salía vacío—. Es el mismo arreglo que usa la prueba del acta de asamblea. Que
 * la RUTA exista, conteste 200 y traiga su nombre se comprueba aparte, por
 * HTTP, que es donde eso se puede comprobar.
 */
function loQueDice(doc) {
  return new Promise((listo, mal) => {
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('error', mal);
    doc.on('end', () => listo(loQueDiceElPdf(Buffer.concat(trozos)).replace(/\s+/g, ' ')));
  });
}

/** El libro tal como lo arma la ruta, y su PDF. */
function elLibro(iglesiaId, { anio, flujo } = {}) {
  const { armarElLibro } = require('../../server/modules/documentos');
  return armarElLibro(db, { iglesiaId, anio, flujo });
}
const pdfDelLibro = (libro) => {
  const { generarLibro } = require('../../server/pdf/oficina-de-partes');
  return loQueDice(generarLibro(libro, { quien: 'Administradora de prueba' }));
};
const pdfDelDocumento = (id) => {
  const { generarDocumento } = require('../../server/pdf/oficina-de-partes');
  const fila = db.prepare('SELECT * FROM documentos WHERE id = ?').get(id);
  return loQueDice(generarDocumento(fila, { quien: 'Administradora de prueba' }));
};

/** Un libro con un hueco a propósito: el 002 no se anota. */
async function unLibroConHueco(api) {
  const iglesia = unaIglesia('Central');
  const uno = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: iglesia.id, numero: 'REC-001-2026',
    titulo: 'Oficio de la Superintendencia', remitente: 'Superintendencia de Cultos',
    tipo: 'Oficio', folios: 4, fecha: '2026-03-02', fecha_registro: '2026-03-04',
    referencia: 'ORD. 1.234', descripcion: 'Solicita antecedentes.',
    observaciones: 'Se derivó a secretaría.', estado: 'En trámite',
  });
  assert.equal(uno.estado, 201, JSON.stringify(uno.json));
  const tres = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: iglesia.id, numero: 'REC-003-2026',
    titulo: 'Carta de la municipalidad', remitente: 'Municipalidad',
    folios: 2, fecha_registro: '2026-03-20',
  });
  assert.equal(tres.estado, 201);
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: iglesia.id, numero: 'EMI-001-2026',
    titulo: 'Respuesta a la Superintendencia', responde_a: uno.json.id,
    fecha_registro: '2026-03-18',
  });
  assert.equal(respuesta.estado, 201);
  return { iglesia, uno: uno.json, tres: tres.json, respuesta: respuesta.json };
}

// ════════════════════════════════════ el libro, como archivo ══

test('el libro se baja como PDF, con su nombre puesto', async () => {
  const api = await elSistemaAndando();
  const { iglesia } = await unLibroConHueco(api);

  const r = await api('GET', `/documentos/libro/pdf?iglesia_id=${iglesia.id}&anio=2026`);
  assert.equal(r.estado, 200, 'antes contestaba 404');
  assert.ok(r.texto.startsWith('%PDF-'), 'y es un PDF de verdad');
  assert.ok(r.texto.length > 3000, `pesa ${r.texto.length} caracteres`);

  /*
   * Y CÓMO SE LLAMA, que es lo único que se ve en la carpeta de descargas. Un
   * archivo llamado «documento.pdf» al lado de otros doce no sirve de nada: el
   * nombre lo pone el servidor y lleva de qué libro es y de qué año.
   */
  const { nombreDelLibro } = require('../../server/pdf/oficina-de-partes');
  const comoSeLlama = nombreDelLibro(elLibro(iglesia.id, { anio: '2026' }));
  assert.match(comoSeLlama, /^Libro de partes /);
  assert.ok(comoSeLlama.includes(iglesia.nombre), 'dice de qué congregación es');
  assert.ok(comoSeLlama.includes('2026'), 'y de qué año');
  assert.ok(comoSeLlama.endsWith('.pdf'));
});

test('y dice lo mismo que la hoja de la pantalla, palabra por palabra', async () => {
  /*
   * LA PRUEBA QUE JUSTIFICA TODO ESTO. El cierre es lo que alguien firma: si la
   * hoja impresa dijera «constan 3» y el archivo «constan 4», el libro dejaría
   * de servir para lo único que sirve. Las palabras salen de un solo lado y
   * esta prueba lo comprueba comparando las dos salidas de verdad, no leyendo
   * el código.
   */
  const api = await elSistemaAndando();
  const { iglesia } = await unLibroConHueco(api);

  const enPantalla = await api('GET', `/documentos/libro?iglesia_id=${iglesia.id}&anio=2026`);
  assert.equal(enPantalla.estado, 200);
  const { sinMarcas } = require('../../server/libro-en-palabras');
  const cierre = sinMarcas(enPantalla.json.enPalabras.cierre);
  assert.match(cierre, /constan 3 documento\(s\): 2 recibido\(s\) y 1 emitido\(s\), con un total de 6 folio\(s\)/);

  const dice = await pdfDelLibro(elLibro(iglesia.id, { anio: '2026' }));
  assert.ok(dice.includes(cierre), `el PDF tiene que decir «${cierre}»`);
});

test('el PDF declara los huecos del correlativo, que es lo que un libro demuestra', async () => {
  const api = await elSistemaAndando();
  const { iglesia } = await unLibroConHueco(api);

  const dice = await pdfDelLibro(elLibro(iglesia.id, { anio: '2026' }));
  assert.match(dice, /Lo que falta en el correlativo/);
  assert.match(dice, /Entre REC-001-2026 y REC-003-2026 falta 1: REC-002-2026/);
});

test('trae la tabla, sus títulos, las dos firmas y el pie de todas las páginas', async () => {
  const api = await elSistemaAndando();
  const { iglesia } = await unLibroConHueco(api);

  const dice = await pdfDelLibro(elLibro(iglesia.id, { anio: '2026' }));

  /*
   * El membrete de la INSTITUCIÓN va primero, antes del título de la hoja: es
   * lo que hace que el papel sea de alguien. Vive en server/pdf/hoja.js, que es
   * la pieza que este PDF comparte con las dos clases de acta.
   */
  const ajustes = require('../../server/ajustes');
  assert.ok((ajustes.obtener('iglesia_nombre') || '').trim(), 'el sistema tiene su nombre puesto');
  assert.ok(dice.toUpperCase().includes(String(ajustes.obtener('iglesia_nombre')).toUpperCase()),
    'la hoja lleva el membrete de la institución');

  assert.match(dice, /LIBRO DE LA OFICINA DE PARTES/);
  assert.ok(dice.includes(iglesia.nombre), 'de qué congregación es');
  assert.match(dice, /A.o 2026/, 'y de qué año');
  // Los títulos de la tabla, enteros: «DOCUMENTO» mide más que su columna y se
  // partía en dos, con la «O» sola encima de la raya
  for (const t of ['N.º', 'REGISTRO', 'DOCUMENTO', 'TIPO', 'MATERIA / ASUNTO', 'DE / PARA', 'FS.', 'ESTADO']) {
    assert.ok(dice.includes(t), `falta el título «${t}»`);
  }
  assert.match(dice, /REC-001-2026/);
  assert.match(dice, /Oficio de la Superintendencia/);
  assert.match(dice, /Secretar.a/);
  assert.match(dice, /Pastor\(a\) \/ Encargado\(a\)/);
  assert.match(dice, /P.gina 1 de 1/);
});

test('con un filtro puesto, baja lo que la hoja muestra y el cierre lo dice', async () => {
  const api = await elSistemaAndando();
  const { iglesia } = await unLibroConHueco(api);

  const dice = await pdfDelLibro(elLibro(iglesia.id, { anio: '2026', flujo: 'Recibido' }));
  assert.match(dice, /Documentos recibidos/);
  assert.match(dice, /constan 2 documento\(s\) recibido\(s\)/, 'una frase por cada filtro');
  assert.ok(!dice.includes('EMI-001-2026'), 'y no baja lo que la hoja no muestra');
});

test('un libro vacío también se baja, y lo dice', async () => {
  /*
   * Bajar un libro sin documentos tiene que dar un papel que diga que no hay
   * nada, no un archivo roto ni un error: es lo que se archiva al cerrar un año
   * en que no entró nada.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Vacía');
  const porHttp = await api('GET', `/documentos/libro/pdf?iglesia_id=${iglesia.id}`);
  assert.equal(porHttp.estado, 200);
  const dice = await pdfDelLibro(elLibro(iglesia.id));
  assert.match(dice, /no tiene documentos con esos filtros/);
  assert.match(dice, /constan 0 documento\(s\)/);
});

test('sin iglesia no hay libro, y sobre una ajena tampoco', async () => {
  const api = await elSistemaAndando();
  const sinNada = await api('GET', '/documentos/libro/pdf');
  assert.equal(sinNada.estado, 400);
  assert.match(sinNada.json.error, /de qué iglesia/);

  const suya = unaIglesia('Suya');
  const ajena = unaIglesia('Ajena');
  const { digitoVerificador } = require('../../server/rut');
  const numero = `${50000000 + (process.pid % 9000000)}`;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, iglesia_id, iglesias) VALUES (?, ?, 'admin', 1, ?, ?)"
  ).run(`Secretaria ${marca()}`, `${numero}-${digitoVerificador(numero)}`, suya.id,
    JSON.stringify([suya.id])).lastInsertRowid;

  const suyoApi = comoOtroUsuario(usuario);
  assert.equal((await suyoApi('GET', `/documentos/libro/pdf?iglesia_id=${suya.id}`)).estado, 200);
  assert.equal((await suyoApi('GET', `/documentos/libro/pdf?iglesia_id=${ajena.id}`)).estado, 403);
});

test('bajar el libro pide el permiso de imprimir, no solo el de mirarlo', async () => {
  /*
   * Sacar el libro del sistema es otra cosa que mirarlo en pantalla: es la
   * misma regla que las dos clases de acta, y la llave se llama
   * «datos_impresion».
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Central');
  const { digitoVerificador } = require('../../server/rut');
  const numero = `${40000000 + (process.pid % 9000000)}`;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, permisos) VALUES (?, ?, 'admin', 1, ?)"
  ).run(`Sin imprenta ${marca()}`, `${numero}-${digitoVerificador(numero)}`,
    // Una lista VACÍA de acciones: es como el editor de permisos le quita una
    // llave a alguien (ver `can` en server/permissions.js, que solo mira los
    // permisos propios cuando son una lista).
    JSON.stringify({ datos_impresion: [] })).lastInsertRowid;

  const r = await comoOtroUsuario(usuario)('GET', `/documentos/libro/pdf?iglesia_id=${iglesia.id}`);
  assert.equal(r.estado, 403);
  assert.match(r.json.error, /imprimir ni descargar/);
});

// ════════════════════════════════ y un documento suelto ══

test('un documento se baja con lo que la tabla del libro no puede llevar', async () => {
  const api = await elSistemaAndando();
  const { uno } = await unLibroConHueco(api);

  const porHttp = await api('GET', `/documentos/${uno.id}/pdf`);
  assert.equal(porHttp.estado, 200, 'antes contestaba 404');
  assert.ok(porHttp.texto.startsWith('%PDF-'));
  const dice = await pdfDelDocumento(uno.id);

  assert.match(dice, /DOCUMENTO N.º REC-001-2026/);
  assert.match(dice, /Oficio de la Superintendencia/);
  assert.match(dice, /Superintendencia de Cultos/);
  assert.match(dice, /4 hoja\(s\)/, 'los folios, con su unidad');
  assert.match(dice, /Solicita antecedentes/, 'la descripción entera');
  assert.match(dice, /Se derivó a secretaría/, 'y las observaciones');

  const { nombreDelDocumento } = require('../../server/pdf/oficina-de-partes');
  const fila = db.prepare('SELECT * FROM documentos WHERE id = ?').get(uno.id);
  assert.equal(nombreDelDocumento(fila), 'Documento REC-001-2026 2026-03-04.pdf',
    'el archivo se llama por su número y su fecha de registro');
});

test('y dice su hilo: a qué contesta y quién lo contestó', async () => {
  /*
   * Es lo que un papel suelto no puede decir de sí mismo. Sin esto, la ficha
   * impresa de un oficio no dice si alguna vez se respondió, que es una de las
   * tres preguntas para las que existe un libro de partes.
   */
  const api = await elSistemaAndando();
  const { uno, respuesta } = await unLibroConHueco(api);

  const delOficio = await pdfDelDocumento(uno.id);
  assert.match(delOficio, /EL HILO/);
  assert.match(delOficio, /Le responde: EMI-001-2026/);

  const deLaRespuesta = await pdfDelDocumento(respuesta.id);
  assert.match(deLaRespuesta, /Contesta a: REC-001-2026/);
  assert.match(deLaRespuesta, /en estado «En trámite»/);
});

test('el documento de otra congregación no se baja', async () => {
  const api = await elSistemaAndando();
  const { uno } = await unLibroConHueco(api);
  const suya = unaIglesia('Suya');
  const { digitoVerificador } = require('../../server/rut');
  const numero = `${30000000 + (process.pid % 9000000)}`;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, iglesia_id, iglesias) VALUES (?, ?, 'admin', 1, ?, ?)"
  ).run(`Secretaria ${marca()}`, `${numero}-${digitoVerificador(numero)}`, suya.id,
    JSON.stringify([suya.id])).lastInsertRowid;

  const r = await comoOtroUsuario(usuario)('GET', `/documentos/${uno.id}/pdf`);
  assert.equal(r.estado, 403);
});

test('«libro» no se lee como el número de un documento', async () => {
  /*
   * Las dos rutas se parecen —/documentos/libro/pdf y /documentos/:id/pdf— y el
   * orden en que express las prueba decide cuál gana. Sin el `(\d+)` en la
   * segunda, pedir el libro entraría por la ficha buscando un documento
   * llamado «libro».
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Central');
  const r = await api('GET', `/documentos/libro/pdf?iglesia_id=${iglesia.id}`);
  assert.equal(r.estado, 200);
  assert.ok(r.texto.startsWith('%PDF-'));

  const laHoja = await api('GET', `/documentos/libro?iglesia_id=${iglesia.id}`);
  assert.equal(laHoja.estado, 200, 'y la hoja de la pantalla sigue en su sitio');

  /*
   * Que hoy funcione porque una ruta se declaró antes que la otra no basta: el
   * día que alguien las reordene, «libro» entraría por la ficha buscando un
   * documento con ese número. Lo que lo impide de verdad es el `(\d+)`, y esto
   * es lo que lo comprueba: una dirección con un id que no es un número no
   * llega al gancho —contesta el 404 de «esa ruta no existe», no el del motor
   * diciendo que no encontró el documento—.
   */
  const inventada = await api('GET', '/documentos/loquesea/pdf');
  assert.equal(inventada.estado, 404);
  assert.ok(!/no se encontró/.test(inventada.texto || ''),
    'sin el (\\d+) esto entraría al gancho y contestaría «Ese documento no se encontró»: '
    + 'la dirección no llega a ninguna ruta, que es lo que se quiere');
});

// ══════════════════════════ una sola redacción, dos hojas ══

test('la pantalla ya no arma el cierre por su cuenta', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito. La prueba de más arriba comprueba que
   * las dos salidas DICEN lo mismo hoy; ésta comprueba que no vuelva a haber
   * dos redacciones, que es como dejarían de decirlo mañana.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  /*
   * Sin los comentarios: la historia de por qué el cierre se escribió así SÍ
   * está contada en la pantalla —«decía "En este libro constan 2 documento(s):
   * 0 recibido(s)…"»—, y contarla no es volver a escribir la frase. Lo que no
   * puede volver es el código que la arma.
   */
  const codigo = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!codigo.includes('En este libro constan'),
    'la frase del cierre no puede estar escrita también en la pantalla');
  assert.ok(!codigo.includes('Lo que falta en el correlativo'),
    'ni el título de los huecos');
  assert.match(app, /function cierreDelLibro\(d\) \{\s*return conLoDestacado\(\(d\.enPalabras \|\| \{\}\)\.cierre/,
    'la pantalla tiene que pintar lo que le manda el servidor');
});

test('y el módulo de las palabras dice lo que cada filtro necesita', () => {
  const { enPalabras } = require('../../server/libro-en-palabras');
  const conFiltro = (flujo, resumen) => enPalabras({ flujo, resumen }).cierre;
  const r = { total: 2, recibidos: 2, emitidos: 0, folios: 0, huecos: { faltan: [], sinNumero: 0 } };

  assert.match(conFiltro('Recibido', r), /constan ⟦2⟧ documento\(s\) recibido\(s\)\./);
  assert.match(conFiltro('Emitido', r), /constan ⟦2⟧ documento\(s\) emitido\(s\)\./);
  assert.match(conFiltro('Interno o de archivo', r), /En este archivo constan ⟦2⟧ documento\(s\) de archivo interno\./);
  assert.match(conFiltro('', r), /⟦2⟧ recibido\(s\) y ⟦0⟧ emitido\(s\)/);
});

test('la pantalla ofrece bajar los tres papeles que se bajan', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const SE_BAJA_EN_PDF = {');
  assert.ok(desde > 0, 'la lista existe');
  const tabla = app.slice(desde, app.indexOf('};', desde));
  for (const modulo of ['actas_reuniones', 'actas_asambleas', 'documentos']) {
    assert.ok(tabla.includes(modulo), `falta ${modulo}`);
  }
  assert.match(app, /const bpdf = document\.getElementById\('btnPdf'\);/,
    'y la ficha engancha el botón');
  assert.match(app, /`\/api\/documentos\/libro\/pdf\?iglesia_id=/,
    'y el libro tiene el suyo');
});
