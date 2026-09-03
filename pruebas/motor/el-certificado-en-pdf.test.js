/**
 * CE-11 · El certificado no se podía bajar.
 *
 * MEDIDO en la v1.300.0: `GET /certificados/:id/pdf` contestaba 404. Imprimir
 * desde la pantalla funcionaba —y funciona—, pero imprimir y bajar no son lo
 * mismo: imprimir es apretar el botón del navegador y aceptar lo que ese
 * navegador decida —sus márgenes, la dirección de la página arriba, el «1/3»
 * del pie—; bajar es tener el archivo, con su nombre puesto, para adjuntarlo a
 * un correo cuando alguien pide una copia.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE BAJA ES LA CONSTANCIA, NO LA HOJA CEREMONIAL, y eso es una
 * decisión, no una limitación que se descubrió a mitad de camino.
 *
 * La hoja ceremonial —la de la orla, los colores y las tres disposiciones—
 * la dibuja el navegador, y su aspecto lo ELIGE LA IGLESIA: los colores, las
 * tres tipografías, los tamaños, el margen, el marco y su grosor, la imagen
 * de fondo con su opacidad, la disposición y el tamaño del papel. Un segundo
 * dibujante hecho con pdfkit tendría que respetar todo eso igual que el
 * primero, y nada podría comprobar que los dos dibujan lo mismo: quedaría una
 * segunda hoja separándose de la primera sin que nadie se enterara, y lo
 * notaría quien recibe el papel.
 *
 * Un certificado impreso que no se parece al que se mandó por correo es peor
 * que no poder mandarlo. Así que la constancia no se le parece A PROPÓSITO, y
 * lo dice de sí misma en su encabezado y en su pie.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL PDF SE ARMA LLAMANDO AL GENERADOR, no pidiéndolo por HTTP: el cuerpo
 * binario de una respuesta llega corrompido a estas pruebas, porque se lee
 * como texto. Por HTTP se comprueba lo que sí se puede: el estado, el permiso
 * y las cabeceras.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { loQueDiceElPdf } = require('./lo-que-dice-el-pdf');
const pdf = require('../../server/pdf/certificados');
const palabras = require('../../server/certificado-en-palabras');

require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia(nombre) {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado, ciudad) VALUES (?, ?, 'Activa', 'Chillán')")
    .run(nombre || `PDF ${m}`, `PD${m}`.slice(0, 18)).lastInsertRowid;
}

function unFormato(campos = {}) {
  const nombre = `Hoja ${marca()}`;
  // Lo que venga en `campos` MANDA sobre lo de fábrica: declarándolos aparte,
  // pedir otra disposición dejaba la columna nombrada dos veces en el INSERT
  const fila = { disposicion: 'Clásica', tamano_hoja: 'Carta', orientacion: 'Vertical', ...campos };
  const claves = Object.keys(fila);
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, ${claves.map((c) => `"${c}"`).join(', ')})
     VALUES (?, 1, 100, ${claves.map(() => '?').join(', ')})`
  ).run(nombre, ...claves.map((c) => fila[c]));
  return nombre;
}

/** El PDF armado y ya leído, como texto. */
function loQueDice(fila, opciones) {
  const doc = pdf.generarCertificado(fila, opciones || {});
  return new Promise((listo, falla) => {
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => listo(loQueDiceElPdf(Buffer.concat(trozos)).replace(/\s+/g, ' ')));
    doc.on('error', falla);
  });
}

async function unCertificado(api, campos = {}) {
  const r = await api('POST', '/certificados', {
    iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

// ═════════════════════════════════ la ruta contesta ══

test('la ruta ya no contesta 404, y manda un PDF con su nombre', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: unFormato({ texto: 'Certifica lo suyo.' }) });

  const r = await api('GET', `/certificados/${cert.id}/pdf`);
  assert.equal(r.estado, 200, 'antes era 404');
});

test('un id que no existe sigue siendo 404, y «libro» no se lee como un certificado', async () => {
  const api = await elSistemaAndando();
  assert.equal((await api('GET', '/certificados/999999/pdf')).estado, 404);

  const raro = await api('GET', '/certificados/loquesea/pdf');
  assert.equal(raro.estado, 404, 'la guarda del (\\d+) está puesta');
  assert.ok(!/certificado/i.test(String((raro.json || {}).error || '')),
    'y contesta el 404 del motor, no uno de este módulo');
});

test('bajarlo pide el permiso de imprimir, además del de ver', async () => {
  /*
   * Bajarse un certificado es sacarlo del sistema, igual que imprimirlo. Es la
   * misma llave que ya piden el acta y el documento.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: unFormato({ texto: 'Certifica lo suyo.' }) });

  const sinLlave = db.prepare(
    `INSERT INTO usuarios (nombre, rut, password, rol, activo, permisos)
     VALUES ('Sin imprimir', ?, 'x', 'admin', 1, ?)`
  ).run(`9${marca()}`.slice(0, 12), JSON.stringify({ datos_impresion: [] })).lastInsertRowid;

  const otro = comoOtroUsuario(sinLlave);
  const r = await otro('GET', `/certificados/${cert.id}/pdf`);
  assert.equal(r.estado, 403);
  assert.match(String(r.json.error), /No tiene permiso para imprimir ni descargar/);
});

test('el archivo se llama por su número: es lo que se ve en la carpeta de descargas', () => {
  assert.equal(pdf.nombreDelCertificado({ numero: 'CERT-001-2026', id: 7 }), 'certificado-CERT-001-2026.pdf');
  assert.equal(pdf.nombreDelCertificado({ numero: null, id: 7 }), 'certificado-7.pdf');
  // Lo que no sirve en un nombre de archivo se cambia, no se deja pasar
  assert.equal(pdf.nombreDelCertificado({ numero: 'A/B C', id: 1 }), 'certificado-A-B-C.pdf');
});

// ═════════════════════════════ qué dice la hoja ══

test('la constancia dice lo que el certificado dice', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Iglesia de Chillán');
  const tipo = unFormato({ texto: 'Certifica que {titular} fue bautizado(a) el día {fecha_evento}, en {iglesia}.' });
  const cert = await unCertificado(api, {
    tipo, iglesia_id: iglesia, nombre_titular: 'Ana Soto Vera',
    fecha_evento: '2026-02-01', notas: 'Se entregó en mano.',
  });

  const dice = await loQueDice(cert, { quien: 'La Secretaria' });
  assert.ok(dice.includes(cert.numero), 'su número');
  assert.match(dice, /Ana Soto Vera/, 'a nombre de quién');
  assert.match(dice, /Certifica que Ana Soto Vera fue bautizado\(a\) el día 1 de febrero de 2026, en Iglesia de Chillán/,
    'y lo que certifica, con las llaves ya rellenadas');
  assert.match(dice, /Se entregó en mano/, 'las notas internas');
  assert.match(dice, /Chillán/, 'la ciudad congelada');
  assert.match(dice, /La Secretaria/, 'y quién la sacó del sistema');
});

test('EL QUE IMPORTA: la hoja dice que es una constancia, no el certificado', async () => {
  /*
   * Quien la recibe por correo tiene que saber de inmediato qué está mirando.
   * Si no lo dijera, el día que alguien comparara las dos hojas pensaría que
   * una de las dos es falsa.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: unFormato({ texto: 'Certifica lo suyo.' }) });
  const dice = await loQueDice(cert);

  assert.match(dice, /CONSTANCIA DE CERTIFICADO EMITIDO/, 'lo dice en el encabezado');
  /*
   * SIN LOS ESPACIOS. Ese párrafo va justificado, y pdfkit reparte el aire
   * moviendo cada palabra por su cuenta: leído del archivo, el texto sale
   * pegado. Lo que se comprueba es que la frase esté, no cómo se separan sus
   * palabras — que en la hoja impresa se ven bien.
   */
  const pegado = dice.replace(/\s+/g, '');
  assert.ok(pegado.includes('Elcertificadofirmadoyselladoeseldocumentoenpapelquelaiglesiaentrega'),
    `no lo explica al pie: ${dice.slice(-300)}`);
});

test('un certificado anulado lo dice arriba, antes que lo que certifica', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, {
    tipo: unFormato({ texto: 'Certifica lo suyo.' }), estado: 'Anulado',
  });
  const dice = await loQueDice(cert);

  assert.match(dice, /A\s*N\s*U\s*L\s*A\s*D\s*O/, 'el sello, con sus letras separadas');
  assert.match(dice, /no tiene validez/);
  assert.ok(dice.indexOf('ANULADO'.split('').join(' ')) < dice.indexOf('Certifica lo suyo'),
    'va antes: es lo primero que hay que saber de este papel');
});

test('y uno sin su formato lo dice, igual que la hoja de la pantalla', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: unFormato({ texto: 'Certifica lo suyo.' }) });
  db.prepare('UPDATE certificados SET tipo = ? WHERE id = ?').run(`Tipo que ya no existe ${marca()}`, cert.id);
  const huerfano = db.prepare('SELECT * FROM certificados WHERE id = ?').get(cert.id);

  const dice = await loQueDice(huerfano);
  assert.match(dice, /FALTA EL TEXTO DE ESTE CERTIFICADO/);
  assert.match(dice, /No se encontró el formato/);
});

test('los datos de las otras dos hojas también salen', async () => {
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica lo suyo.', disposicion: 'Presentación de niños' });
  const cert = await unCertificado(api, {
    tipo, nombre_titular: 'Matías Rojas Soto', fecha_nacimiento: '2025-11-06',
    padre: 'Juan Rojas', madre: 'Eva Soto',
    padrino_1: 'Luis Pérez', madrina_1: 'Rosa Pérez',
  });

  const dice = await loQueDice(cert);
  for (const quien of ['Juan Rojas', 'Eva Soto', 'Luis Pérez', 'Rosa Pérez']) {
    assert.ok(dice.includes(quien), `no salió ${quien}`);
  }
  assert.match(dice, /6 de noviembre de 2025/);
});

// ══════════════ las llaves, escritas en dos lados y atadas ══

test('EL OTRO QUE IMPORTA: el servidor y la pantalla conocen las MISMAS llaves', () => {
  /*
   * El texto del certificado viene con datos entre llaves, y ahora hay dos
   * lugares que los rellenan: la pantalla al armar la hoja ceremonial, y el
   * servidor al armar la constancia. El navegador no puede pedirle la función
   * al servidor, así que las dos copias existen.
   *
   * Lo que las ata es esta prueba. Si una aprende una llave que la otra no
   * conoce, el mismo certificado diría cosas distintas según por dónde saliera
   * — y en una de las dos hojas quedaría un «{loquesea}» impreso.
   *
   * Es la misma manera con que están atadas las medidas del papel, que también
   * viven en los dos lados por la misma razón.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function certDatos(');
  assert.ok(desde > 0, 'la función de la pantalla existe');
  const cuerpo = app.slice(app.indexOf('return {', desde), app.indexOf('\n}', desde));
  // Varias van en la misma línea —«nac_dia: …, nac_mes: …, nac_anio: …»—, así
  // que se buscan al principio de línea O después de una coma
  const enLaPantalla = [...cuerpo.matchAll(/(?:^|,)\s*(\w+):/gm)].map((m) => m[1]);

  const enElServidor = palabras.lasLlaves();
  assert.deepEqual([...enElServidor].sort(), [...new Set(enLaPantalla)].sort(),
    'una de las dos aprendió una llave que la otra no conoce');
});

test('y las llaves que el módulo OFRECE están todas', () => {
  /*
   * «Formatos de Certificado» le dice a la iglesia qué puede escribir entre
   * llaves. Ofrecer una que nadie rellena es prometer un dato que va a salir
   * impreso tal cual.
   */
  const ofrecidas = require('../../server/modules/formatos_certificado').DATOS.map(([d]) => d);
  const rellenables = palabras.lasLlaves();
  for (const llave of ofrecidas) {
    assert.ok(rellenables.includes(llave), `se ofrece «{${llave}}» y nadie la rellena`);
  }
});

test('una llave que nadie conoce se deja a la vista, no se borra', () => {
  /*
   * Borrarla dejaría la frase coja sin decir por qué. Dejándola, quien mira la
   * hoja ve que escribió un dato que no existe.
   */
  const datos = palabras.losDatos({ nombre_titular: 'Ana' }, {});
  assert.equal(palabras.rellenar('Hola {titular} y {loquesea}', datos), 'Hola Ana y {loquesea}');
});

// ═════════════════════════════ la pantalla, conectada ══

test('la ficha del certificado ofrece el botón, y dice qué se baja', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  const tabla = app.slice(app.indexOf('const SE_BAJA_EN_PDF = {'), app.indexOf('async function descargarEnPdf'));
  assert.match(tabla, /certificados: \(id\) => `Constancia del certificado \$\{id\}\.pdf`/,
    'el nombre del archivo dice qué es, para no tener que abrirlo');

  assert.match(app, /El certificado con su orla se saca con «Imprimir»/,
    'y el botón lo aclara donde se aprieta');
});
