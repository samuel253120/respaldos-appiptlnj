/**
 * Los tres que cierran el libro de asambleas: el PDF, el formulario y el número.
 *
 * AS-10 · EL PDF QUE NO ESTABA. De los dos caminos para sacar un acta del
 * sistema, el acta de asamblea tenía uno solo: la vista de impresión. Su ruta de
 * PDF contestaba 404, y el botón no aparecía. Es el documento más formal que
 * este sistema levanta —el que se le muestra a un banco o a un notario— y el
 * único de su clase sin descarga propia.
 *
 * No se escribió un segundo generador: server/pdf/acta.js sabe hacer los dos, y
 * lo poco que cambia —cómo se llama, de quién es, cómo se llama la sesión en los
 * títulos— vive en una tabla de dos entradas. Un generador copiado habría que
 * arreglarlo dos veces, que es la lección que este módulo ya dejó tres veces.
 *
 * AS-11 · EL FORMULARIO Y UNA PALABRA. Eran dieciocho campos en una sola tirada,
 * sin un título que los separara, mientras el del acta de reunión declara sus
 * cuatro secciones. Y el sello de «Aprobada» decía «aprobada en la reunión»
 * sobre un acta de asamblea: una reunión que no hubo.
 *
 * AS-12 · EL NÚMERO ÚNICO, QUE ES DEL MOTOR. Un número puede ser único DENTRO de
 * algo, y entonces lo que se mueve puede ser ese algo con el número quieto.
 * Medido en la v1.282.0: mover un acta a una iglesia donde su número ya estaba
 * usado, sin mandar el número en la petición, contestaba 500 con un número de
 * incidencia en vez del aviso que el sistema ya tenía escrito.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { loQueDiceElPdf } = require('./lo-que-dice-el-pdf');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unaIglesia(cuantos = 40) {
  const m = marca();
  const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia PDF ${m}`, `PDF${m}`.slice(0, 18)).lastInsertRowid;
  const mete = db.prepare(
    "INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')");
  for (let i = 0; i < cuantos; i += 1) mete.run(`Persona${i}`, `De ${m}`, id);
  return { m, iglesia: id };
}

const unActa = (api, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `PDF-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-07-01', tipo: 'Extraordinaria', iglesia_id: e.iglesia,
  lugar: 'Templo Central', hora_inicio: '10:00', hora_fin: '13:00',
  presidida_por: 'Pastor Pérez', secretario: 'Ana Soto', total_asistentes: 20,
  agenda: '1. Venta del inmueble', desarrollo: '<p>Se debatió largamente.</p>',
  acuerdos: '<p>Se aprueba la venta por 118 votos.</p>', ...cambios,
});

/**
 * El PDF de un acta, armado llamando al generador con la fila ya guardada.
 *
 * No se pide por HTTP porque el pase de las pruebas devuelve el cuerpo como
 * texto y un PDF es binario: por ese camino llega roto. Que la RUTA exista y
 * responda se comprueba aparte, más abajo.
 */
function elPdfDe(fila, modulo) {
  const { generar } = require('../../server/pdf/acta');
  return new Promise((listo, mal) => {
    const trozos = [];
    const doc = generar(fila, { quien: 'Administradora de prueba', modulo });
    doc.on('data', (t) => trozos.push(t));
    doc.on('error', mal);
    doc.on('end', () => listo(loQueDiceElPdf(Buffer.concat(trozos))));
  });
}

// ------------------------------------------------- AS-10 · el PDF ----

test('el acta de asamblea se descarga en PDF', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  const pdf = await api('GET', `/actas_asambleas/${r.json.id}/pdf`);
  assert.notEqual(pdf.estado, 404, 'la ruta no existe para las asambleas');
  assert.equal(pdf.estado, 200);
});

test('y lo que la RUTA devuelve es el PDF de una asamblea, no el de una reunión', async () => {
  /*
   * Esta prueba existe porque faltaba. Las de abajo llaman al generador
   * derecho, pasándole de qué clase es el acta; así, la RUTA podía pasarle la
   * clase equivocada y ninguna se ponía roja. Se comprobó rompiéndolo a
   * propósito: quitarle el `modulo` a la llamada de la ruta no tumbaba nada.
   *
   * Un PDF es binario y por este camino el cuerpo llega mal decodificado, así
   * que no se le puede leer el texto. Lo que sí sobrevive es su ficha de
   * propiedades, que va en claro: ahí está el asunto —«Acta de asamblea
   * general» contra «Acta de reunión de cuerpo»— y eso es justamente lo que
   * cambia según la clase.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  const pdf = await api('GET', `/actas_asambleas/${r.json.id}/pdf`);
  assert.equal(pdf.estado, 200);
  assert.match(pdf.texto, /asamblea general/, 'la ruta lo generó como si fuera otra cosa');
  assert.doesNotMatch(pdf.texto, /reunión de cuerpo/);
});

test('y el PDF dice que es un acta de ASAMBLEA, no de reunión', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  const fila = db.prepare('SELECT * FROM actas_asambleas WHERE id = ?').get(r.json.id);
  const dice = await elPdfDe(fila, 'actas_asambleas');
  assert.match(dice, /ACTA DE ASAMBLEA/);
  assert.doesNotMatch(dice, /ACTA DE REUNIÓN/);
  assert.match(dice, new RegExp(`Iglesia PDF ${e.m}`), 'de qué congregación es');
});

test('con lo propio de una asamblea: su tipo, sus asistentes y su quórum', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { hubo_quorum: 0, igual_asi: true });
  const fila = db.prepare('SELECT * FROM actas_asambleas WHERE id = ?').get(r.json.id);
  const dice = await elPdfDe(fila, 'actas_asambleas');
  assert.match(dice, /ASISTENTES \/ QUÓRUM/);
  assert.match(dice, /20 asistentes/);
  assert.match(dice, /sin quórum/);
  assert.match(dice, /Extraordinaria/);
});

test('y con los títulos que usa una asamblea, no los de una reunión', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  const fila = db.prepare('SELECT * FROM actas_asambleas WHERE id = ?').get(r.json.id);
  const dice = await elPdfDe(fila, 'actas_asambleas');
  assert.match(dice, /DESARROLLO DE LA ASAMBLEA/);
  assert.match(dice, /ACUERDOS Y RESOLUCIONES/, 'una asamblea resuelve, un cuerpo se compromete');
  assert.doesNotMatch(dice, /ACUERDOS Y COMPROMISOS/);
  assert.match(dice, /Se aprueba la venta por 118 votos/, 'y el acta entera va adentro');
});

test('el PDF del acta de reunión sigue diciendo lo suyo', async () => {
  /*
   * El generador pasó a servir a los dos. La manera de comprobar que el cambio
   * no le movió nada al que ya existía es pedirle el otro y mirarlo.
   */
  const e = unaIglesia();
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Coro ${e.m}`, e.iglesia).lastInsertRowid;
  const api = await elSistemaAndando();
  const r = await api('POST', '/actas_reuniones', {
    numero_acta: `R-${e.m}`, fecha: '2026-07-01', cuerpo_id: cuerpo,
    agenda: '1. Lo de siempre', acuerdos: '<p>Se acuerda comprar sillas.</p>' });
  const fila = db.prepare('SELECT * FROM actas_reuniones WHERE id = ?').get(r.json.id);
  const dice = await elPdfDe(fila, 'actas_reuniones');
  assert.match(dice, /ACTA DE REUNIÓN/);
  assert.match(dice, /ACUERDOS Y COMPROMISOS/);
  assert.match(dice, new RegExp(`Coro ${e.m}`), 'de qué cuerpo es');
  assert.doesNotMatch(dice, /ASISTENTES \/ QUÓRUM/, 'una reunión de cuerpo no tiene quórum');
});

test('el archivo se llama distinto, para no confundirlo en la carpeta', () => {
  const { nombreDelArchivo } = require('../../server/pdf/acta');
  const fila = { numero_acta: 'AS-003-2026', fecha: '2026-09-01' };
  assert.match(nombreDelArchivo(fila, 'actas_asambleas'), /^Acta de asamblea AS-003-2026/);
  assert.match(nombreDelArchivo(fila, 'actas_reuniones'), /^Acta AS-003-2026/);
});

test('descargar el PDF de un acta de otra congregación no se puede', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});

  const otra = unaIglesia();
  const num = `${93000000 + (process.pid % 6000000)}`;
  const ajeno = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, iglesia_id, debe_cambiar_password)
     VALUES (?, ?, 'secretario', 1, ?, ?, 0)`
  ).run(`${num}-${require('../../server/rut').digitoVerificador(num)}`,
    `Secretaria de otra ${otra.m}`, JSON.stringify([otra.iglesia]), otra.iglesia).lastInsertRowid;

  const comoElla = require('./andando').comoOtroUsuario(ajeno);
  const pdf = await comoElla('GET', `/actas_asambleas/${r.json.id}/pdf`);
  assert.ok(pdf.estado === 403 || pdf.estado === 404, `contestó ${pdf.estado}`);
});

// ---------------------------------------- AS-11 · las secciones ----

test('el formulario del acta de asamblea tiene sus cuatro secciones', () => {
  const def = require('../../server/modules/actas_asambleas');
  const declaradas = def.fields.map((f) => f.seccion).filter(Boolean);
  assert.deepEqual(declaradas,
    ['Identificación', 'Dónde y quiénes', 'El acta', 'Documento y estado'],
    'cada sección se nombra UNA vez, en su primer campo');
  // Un campo continúa la última sección declarada: nombrarla otra vez abriría
  // una segunda con el mismo título, y la ficha saldría con el encabezado dos
  // veces. Pasó una vez, y se vio en la pantalla y no en una prueba.
  assert.equal(new Set(declaradas).size, declaradas.length, 'una sección se abre dos veces');
});

test('y cada campo cae en la sección que le corresponde', () => {
  const def = require('../../server/modules/actas_asambleas');
  const donde = {};
  let actual = null;
  for (const f of def.fields) { if (f.seccion) actual = f.seccion; donde[f.name] = actual; }
  assert.equal(donde.numero_acta, 'Identificación');
  assert.equal(donde.iglesia_id, 'Identificación');
  assert.equal(donde.hubo_quorum, 'Dónde y quiénes');
  assert.equal(donde.acuerdos, 'El acta');
  assert.equal(donde.fecha_firma, 'Documento y estado');
});

// ------------------------------- AS-12 · el número único, del motor ----

test('mover un acta a donde su número ya existe avisa, y no revienta', async () => {
  const api = await elSistemaAndando();
  const a = unaIglesia();
  const b = unaIglesia();
  const numero = `CHOQUE-${a.m}`;
  const aca = await unActa(api, a, { numero_acta: numero });
  await unActa(api, b, { numero_acta: numero });

  // Sin mandar el número: es el caso que contestaba 500
  const sin = await api('PUT', `/actas_asambleas/${aca.json.id}`,
    { iglesia_id: b.iglesia, igual_asi: true });
  assert.notEqual(sin.estado, 500, 'un error interno en vez del aviso que ya existía');
  assert.equal(sin.estado, 400);
  assert.match(sin.json.error, /Ya existe otra acta de asamblea con ese Número de acta/);

  // Y mandándolo, lo mismo
  const con = await api('PUT', `/actas_asambleas/${aca.json.id}`,
    { iglesia_id: b.iglesia, numero_acta: numero, igual_asi: true });
  assert.equal(con.estado, 400);
  assert.equal(con.json.error, sin.json.error, 'las dos puertas tienen que decir lo mismo');
});

test('el aviso nombra DENTRO DE QUÉ está tomado el número', async () => {
  const api = await elSistemaAndando();
  const a = unaIglesia();
  const b = unaIglesia();
  const numero = `NOMBRA-${a.m}`;
  const aca = await unActa(api, a, { numero_acta: numero });
  await unActa(api, b, { numero_acta: numero });
  const r = await api('PUT', `/actas_asambleas/${aca.json.id}`,
    { iglesia_id: b.iglesia, igual_asi: true });
  assert.match(r.json.error, new RegExp(`en «Iglesia PDF ${b.m}»`),
    'sin decir dónde, se lee como si el número estuviera tomado en todo el sistema');
});

test('y también cuando lo que acota es un cuerpo, que antes no se decía', async () => {
  /*
   * El aviso solo nombraba el caso de la iglesia. Para un acta de reunión
   * —acotada por cuerpo— no decía nada, y quedaba «Ya existe otra acta de
   * reunión con ese Número de acta», que se lee como si el número estuviera
   * tomado en todo el sistema cuando solo lo está en ese cuerpo.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Damas ${e.m}`, e.iglesia).lastInsertRowid;
  const numero = `RCH-${e.m}`;
  await api('POST', '/actas_reuniones', {
    numero_acta: numero, fecha: '2026-07-02', cuerpo_id: cuerpo, agenda: 'x' });
  const otra = await api('POST', '/actas_reuniones', {
    numero_acta: numero, fecha: '2026-07-03', cuerpo_id: cuerpo, agenda: 'x' });
  assert.equal(otra.estado, 400);
  assert.match(otra.json.error, new RegExp(`en «Damas ${e.m}»`));
});

test('un número que sí es único en todo el sistema no inventa un «dentro de»', () => {
  /*
   * La serie de una credencial es única en todo el sistema, no dentro de nada.
   * El aviso no puede colgarle un «en …» que no existe.
   */
  const { avisoDeDuplicado, dondeEsUnico } = require('../../server/crud');
  const def = require('../../server/modules/credenciales');
  const campo = def.fields.find((f) => f.name === 'serie');
  assert.equal(campo.unique, true);
  assert.equal(dondeEsUnico(def, campo, {}, null), '');
  assert.doesNotMatch(avisoDeDuplicado(def, campo, dondeEsUnico(def, campo, {}, null)), / en «/);
});

test('guardar sin tocar el número único no se rompe', async () => {
  /*
   * La regla nueva mira el campo único en TODO guardado, también cuando no
   * viene en la petición. Un registro no puede chocar consigo mismo.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  for (let i = 0; i < 3; i += 1) {
    const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { lugar: `Salón ${i}` });
    assert.equal(g.estado, 200, `en el guardado ${i + 1}: ${g.texto}`);
  }
});
