/**
 * Un borrador impreso no puede parecer el documento definitivo.
 *
 * Un acta se saca del sistema por dos caminos: la hoja para imprimir de la
 * pantalla y el PDF que se baja. Los dos salen del mismo registro, y uno decía
 * el estado y el otro no. Medido en la v1.273.0, sobre la misma acta en
 * «Borrador»:
 *
 *   el PDF (server/pdf/acta.js) ............... decía «Estado: Borrador»
 *   la hoja impresa (printActa) ............... no lo decía
 *   las dos líneas de firma al pie ............ en las dos, con los nombres
 *
 * Una vez en papel, ese borrador era indistinguible del acta firmada: mismo
 * membrete de la institución, mismos datos, mismas firmas. Y un papel así
 * circula —se lleva a una reunión, se archiva, se muestra—.
 *
 * Ahora las dos hojas llevan el mismo sello cuando el acta no está firmada, y
 * las mismas dos rayas dicen que la firma falta. Lo que se cuida acá es
 * justamente eso: QUE LOS DOS CAMINOS DIGAN LO MISMO. Se revisa sobre el
 * código de los dos —como las demás pruebas de hojas impresas— porque lo que
 * puede separarse en silencio es el texto, no el dibujo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const raiz = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'public/styles.css'), 'utf8');
const pdf = fs.readFileSync(path.join(raiz, 'server/pdf/acta.js'), 'utf8');
const laHoja = app.slice(app.indexOf('function printActa'), app.indexOf('function printBienAjeno'));

test('el trozo que se revisa es el de la hoja del acta', () => {
  /*
   * Una guardia de que el recorte SEA la función: si el índice de arriba deja
   * de encontrarla, las pruebas de abajo pasarían mirando el archivo entero
   * —que son seiscientos mil caracteres— y no comprobarían nada.
   *
   * El techo es una RED, no una medida: no dice cuánto debe medir la función,
   * dice que no puede haberse convertido en el archivo. Se sube sin remordimiento
   * cuando la hoja crece de verdad.
   */
  assert.ok(laHoja.length > 1200 && laHoja.length < 9000, `el recorte mide ${laHoja.length}`);
  assert.match(laHoja, /acta-firmas/);
});

// ------------------------------------------ los dos caminos, lo mismo ----

test('las dos hojas se fijan en lo mismo: si está firmada o no', () => {
  assert.match(laHoja, /row\.estado === 'Firmada'/, 'la hoja de la pantalla');
  assert.match(pdf, /actaFila\.estado !== 'Firmada'/, 'y el PDF');
});

const LAS_FRASES = [
  'Documento de trabajo: no ha sido aprobado ni firmado.',
  'Aprobada en la reunión y todavía sin firmar: no es el documento definitivo.',
  'Pendiente de firma',
];

test('y las dos dicen las mismas palabras', () => {
  /*
   * Es el corazón del hallazgo. Si mañana alguien cambia el texto en un lado y
   * no en el otro, vuelven a decir cosas distintas de la misma acta.
   */
  for (const frase of LAS_FRASES) {
    assert.ok(laHoja.includes(frase), `falta en la hoja: «${frase}»`);
    assert.ok(pdf.includes(frase), `falta en el PDF: «${frase}»`);
  }
});

test('las dos distinguen el borrador de la aprobada', () => {
  assert.match(laHoja, /row\.estado === 'Aprobada'/);
  assert.match(pdf, /actaFila\.estado === 'Aprobada'/);
});

test('la hoja de la pantalla dice el estado y quién la firmó', () => {
  assert.match(laHoja, /Estado<\/td>/, 'el estado, que antes solo estaba en el PDF');
  assert.match(laHoja, /Firmada por<\/td>/);
  assert.match(laHoja, /row\.firmada_por/);
});

test('y el PDF también, con el mismo rótulo', () => {
  assert.match(pdf, /dato\('Estado'/);
  assert.match(pdf, /dato\('Firmada por'/);
});

/**
 * Lo que un PDF de pdfkit DICE de verdad.
 *
 * Hace falta porque comprobar el código fuente no distingue una regla escrita
 * de una regla conectada: se probó rompiendo a propósito el `if` del sello
 * —dejándolo escrito pero apagado— y ninguna prueba de las de arriba se puso
 * roja. Es exactamente el defecto contra el que existe pruebas/motor/andando.js,
 * en el otro extremo del sistema.
 *
 * El texto va comprimido y escrito en hexadecimal, con la separación entre
 * letras metida como números entre los trozos: «APROBADA» se escribe
 * `<APR> 10 <OB> 10 <AD> 10 <A>`. Así que se inflan los flujos, se juntan SOLO
 * los trozos de cada arreglo —tirando los números y los espacios que los
 * separan, que no son del texto— y se decodifican. Los espacios de verdad
 * viajan dentro del hexadecimal y sobreviven.
 */
function loQueDiceElPdf(buf) {
  const zlib = require('zlib');
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m; let crudo = '';
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf('endstream', ini);
    if (fin < 0) continue;
    let d;
    try { d = zlib.inflateSync(buf.slice(ini, fin)).toString('latin1'); } catch (e) { continue; }
    if (/T[jJ]/.test(d)) crudo += d;
  }
  const hex = (x) => Buffer.from(x, 'hex').toString('latin1');
  const lineas = [];
  crudo.replace(/\[([^\]]*)\]\s*TJ|<([0-9A-Fa-f]*)>\s*Tj/g, (_, arreglo, suelto) => {
    lineas.push(arreglo !== undefined
      ? (arreglo.match(/<[0-9A-Fa-f]*>/g) || []).map((t) => hex(t.slice(1, -1))).join('')
      : hex(suelto));
    return '';
  });
  return lineas.join('\n');
}

/**
 * Un acta en el estado que se pida, y el texto de su PDF.
 *
 * El acta se crea por la API —para que pase por el gancho que anota la firma—
 * y el PDF se arma llamando al generador con la fila ya guardada, en vez de
 * pedirlo por HTTP: el pase de las pruebas devuelve el cuerpo como texto, y un
 * PDF es binario, así que por ese camino llega roto. La ruta ya está probada
 * aparte; lo que se mira acá es lo que el documento dice.
 */
async function elPdfDeUnActa(api, estado, extra) {
  const marca = `${estado}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${marca}`, `PD${marca}`.slice(0, 18)).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${marca}`, iglesia).lastInsertRowid;
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: marca, fecha: '2026-03-15', cuerpo_id: cuerpo, estado,
    presidida_por: 'Juan Pérez', secretario: 'Ana Soto',
    acuerdos: '<p>Se aprueba comprar sillas.</p>', ...extra,
  });
  assert.equal(a.estado, 201, `crear una ${estado}`);

  const fila = db.prepare('SELECT * FROM actas_reuniones WHERE id = ?').get(a.json.id);
  const doc = require('../../server/pdf/acta').generar(fila, { quien: 'Quien lo emite' });
  const trozos = [];
  doc.on('data', (c) => trozos.push(c));
  await new Promise((listo, falla) => { doc.on('end', listo); doc.on('error', falla); });
  return loQueDiceElPdf(Buffer.concat(trozos));
}

test('el PDF de un borrador lo dice en la cara', async () => {
  const api = await elSistemaAndando();
  const dice = await elPdfDeUnActa(api, 'Borrador');
  assert.ok(dice.includes('BORRADOR'), 'el sello');
  assert.ok(dice.includes(LAS_FRASES[0]), 'y por qué');
  assert.ok(dice.includes('Pendiente de firma'), 'y al pie, que las firmas faltan');
});

test('el de una aprobada dice que le falta la firma, no que sea un borrador', async () => {
  const api = await elSistemaAndando();
  const dice = await elPdfDeUnActa(api, 'Aprobada');
  assert.ok(dice.includes('APROBADA'));
  assert.ok(dice.includes(LAS_FRASES[1]));
  assert.ok(!dice.includes('BORRADOR'), 'no es lo mismo, y no se pueden confundir');
  assert.ok(dice.includes('Pendiente de firma'));
});

test('y el de una firmada no lleva sello, pero sí quién la firmó', async () => {
  const api = await elSistemaAndando();
  const dice = await elPdfDeUnActa(api, 'Firmada');
  assert.ok(!dice.includes('BORRADOR') && !dice.includes('APROBADA'),
    'un acta firmada ES el documento definitivo: no lleva advertencia');
  assert.ok(!dice.includes('Pendiente de firma'), 'ni firmas pendientes');
  assert.ok(dice.includes('FIRMADA POR'), 'y dice quién la firmó');
});

// -------------------------------------------------- que salga en papel ----

test('el sello se dibuja con borde y no con fondo de color', () => {
  /*
   * La trampa: los navegadores NO imprimen los fondos salvo que la persona
   * marque «gráficos de fondo» en el diálogo de impresión, y este aviso tiene
   * que salir en el papel justamente cuando alguien imprime. Un borde y un
   * color de letra se imprimen siempre.
   */
  const regla = css.slice(css.indexOf('.acta-sin-firmar {'), css.indexOf('.acta-sin-firmar b'));
  assert.ok(regla, 'la regla existe');
  assert.match(regla, /border:\s*2px solid/, 'lleva borde');
  assert.ok(!/background/.test(regla), 'y NO lleva fondo, que es lo que no se imprimiría');
  assert.match(regla, /color:/, 'con su color de letra, que sí se imprime');
});

test('las firmas que faltan se dicen con letra, no con un fondo', () => {
  const regla = css.slice(css.indexOf('.acta-firmas .firma .pend'), css.indexOf('.print-generic {'));
  assert.match(regla, /color:/);
  assert.ok(!/background/.test(regla));
});
