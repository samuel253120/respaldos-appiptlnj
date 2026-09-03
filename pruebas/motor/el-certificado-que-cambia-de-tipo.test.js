/**
 * CE-05 · Cambiarle el tipo a un certificado borraba datos en silencio.
 *
 * Cada forma de hoja pide sus propios datos: la de matrimonio nombra al otro
 * cónyuge, la de presentación de niños nombra la fecha de nacimiento, los dos
 * padres y las dos parejas de padrinos. Al cambiar el tipo, el módulo suelta
 * los que ya no son de esa hoja, y ESO ESTÁ BIEN: un cónyuge no significa nada
 * en un certificado de membresía, y dejarlo guardado ahí lo haría aparecer de
 * vuelta el día que alguien vuelva a cambiar el tipo.
 *
 * MEDIDO en la v1.295.0, lo que faltaba era avisar:
 *
 *   · Un matrimonio a nombre de dos, pasado a «Membresía» → 200, y el cónyuge
 *     en nulo.
 *   · Una presentación de niños completa, pasada a «Bautismo» → 200, y de una
 *     vez la fecha de nacimiento, los dos padres y las dos parejas de padrinos:
 *     SIETE datos, sin una palabra.
 *
 * Es la misma clase de hallazgo que la oficina de partes cerró en la v1.287.0,
 * y la solución de allá sirve tal cual: nombrar SOLO lo que de verdad tiene
 * algo escrito, y preguntar una vez.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/certificados');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

/*
 * La siembra primero, porque este archivo también CREA formatos y la siembra
 * solo siembra si la tabla está vacía.
 */
require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * UN FORMATO PROPIO PARA CADA FORMA DE HOJA, Y NO LOS QUE TRAE EL SISTEMA.
 *
 * Los archivos del motor comparten UNA base, y hay uno —hojas-de-certificado—
 * que A PROPÓSITO le reescribe el texto y la disposición al formato
 * «Matrimonio» que trae el sistema, para comprobar que la actualización no pisa
 * lo que la iglesia editó. Es una prueba legítima y deja el formato así.
 *
 * Cualquier archivo que después dé por hecho que «Matrimonio» tiene la
 * disposición Matrimonio queda a merced de en qué orden corrieron los dos. Acá
 * se crean formatos propios, con nombre único y disposición escrita: lo que se
 * comprueba no depende de nadie más.
 */
function unFormatoCon(disposicion) {
  const nombre = `Hoja ${disposicion} ${marca()}`;
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, texto, disposicion, tamano_hoja, orientacion)
     VALUES (?, 1, 100, 'Certifica lo suyo.', ?, 'Carta', ?)`
  ).run(nombre, disposicion, disposicion === 'Clásica' ? 'Vertical' : 'Horizontal');
  return nombre;
}

const MATRIMONIO = unFormatoCon('Matrimonio');
const PRESENTACION = unFormatoCon('Presentación de niños');
const CLASICO = unFormatoCon('Clásica');
const OTRO_CLASICO = unFormatoCon('Clásica');

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Tipo ${m}`, `TP${m}`.slice(0, 18)).lastInsertRowid;
}

async function unCertificado(api, campos = {}) {
  const r = await api('POST', '/certificados', {
    tipo: CLASICO, iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

const unMatrimonio = (api, extra) => unCertificado(api, {
  tipo: MATRIMONIO, nombre_titular: 'Pedro Díaz Rojas', conyuge: 'María Rojas Soto', ...extra,
});
const unaPresentacion = (api, extra) => unCertificado(api, {
  tipo: PRESENTACION, nombre_titular: 'Matías Rojas Soto',
  fecha_nacimiento: '2025-11-06', padre: 'Juan Rojas', madre: 'Eva Soto',
  padrino_1: 'Luis Pérez', madrina_1: 'Rosa Pérez',
  padrino_2: 'Pablo Vera', madrina_2: 'Sara Vera', ...extra,
});

async function loQueDiceAlCambiarA(api, id, tipo) {
  const r = await api('PUT', `/certificados/${id}`, { tipo });
  assert.equal(r.estado, 400, 'antes contestaba 200 y los soltaba en silencio');
  return { aviso: String(r.json.error), clave: r.json.confirmar };
}

// ═════════════════════════════════════════ cambiar el tipo pregunta ══

test('pasar un matrimonio a otro tipo PREGUNTA en vez de soltar al cónyuge', async () => {
  const api = await elSistemaAndando();
  const cert = await unMatrimonio(api);

  const { aviso, clave } = await loQueDiceAlCambiarA(api, cert.id, CLASICO);
  assert.equal(clave, 'certificado_que_cambia_de_tipo');
  assert.ok(aviso.includes(`de «${MATRIMONIO}» a «${CLASICO}»`), aviso);
  assert.match(aviso, /«El otro cónyuge»/, 'lo nombra por su rótulo, no por su columna');
  assert.match(aviso, /ese dato es de la hoja anterior/, 'en singular, porque es uno solo');

  const sigue = await api('GET', `/certificados/${cert.id}`);
  assert.equal(sigue.json.tipo, MATRIMONIO, 'mientras no contesten, no se cambió nada');
  assert.equal(sigue.json.conyuge, 'María Rojas Soto', 'y el cónyuge sigue ahí');
});

test('y una presentación completa nombra los siete, y dice de qué hoja a qué hoja', async () => {
  const api = await elSistemaAndando();
  const cert = await unaPresentacion(api);

  const { aviso } = await loQueDiceAlCambiarA(api, cert.id, CLASICO);
  assert.ok(aviso.includes(`de «${PRESENTACION}» a «${CLASICO}»`), aviso);
  assert.match(aviso, /de la hoja «Presentación de niños» a la «Clásica»/);
  for (const rotulo of ['Fecha de nacimiento del niño(a)', 'Padre', 'Madre', 'Padrino', 'Madrina',
    'Segundo padrino', 'Segunda madrina']) {
    assert.ok(aviso.includes(`«${rotulo}»`), `no nombra «${rotulo}»: ${aviso}`);
  }
  assert.match(aviso, /esos datos son de la hoja anterior/, 'en plural');
});

test('contestando que sí, se cambia y los datos se sueltan', async () => {
  const api = await elSistemaAndando();
  const cert = await unMatrimonio(api);

  const r = await api('PUT', `/certificados/${cert.id}`, { tipo: CLASICO, igual_asi: true });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.tipo, CLASICO);
  assert.equal(r.json.disposicion, 'Clásica');
  assert.equal(r.json.conyuge, null, 'la regla sigue siendo la de siempre: lo que sobra se suelta');
});

// ═══════════════════════════════════ cuándo NO se pregunta ══

test('SOLO SE NOMBRA LO QUE TIENE ALGO: media presentación no habla de la otra media', async () => {
  /*
   * Avisar de siete campos cuando seis están vacíos convierte la pregunta en un
   * trámite, y una pregunta que sale siempre se aprieta sin leer.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, {
    tipo: PRESENTACION, nombre_titular: 'Matías Rojas Soto',
    padre: 'Juan Rojas', // sin madre, sin padrinos, sin fecha de nacimiento
  });

  const { aviso } = await loQueDiceAlCambiarA(api, cert.id, CLASICO);
  assert.match(aviso, /«Padre»/);
  assert.ok(!aviso.includes('«Madre»'), `nombró un campo vacío: ${aviso}`);
  assert.ok(!aviso.includes('«Padrino»'), `nombró un campo vacío: ${aviso}`);
  assert.match(aviso, /ese dato es/, 'y habla en singular, porque es uno solo');
});

test('cambiar entre dos tipos de la misma hoja no pregunta nada', async () => {
  // Los dos son de hoja clásica: no hay ningún dato que soltar, y preguntar
  // igual sería ruido
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: CLASICO });
  const r = await api('PUT', `/certificados/${cert.id}`, { tipo: OTRO_CLASICO });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.tipo, OTRO_CLASICO);
});

test('y guardar un matrimonio sin tocarle el tipo, tampoco', async () => {
  const api = await elSistemaAndando();
  const cert = await unMatrimonio(api);
  const r = await api('PUT', `/certificados/${cert.id}`, { notas: 'Se entregó en mano.' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.conyuge, 'María Rojas Soto', 'y el cónyuge no se movió');
});

test('emitir uno nuevo tampoco pregunta, aunque llegue con datos que su hoja no usa', async () => {
  /*
   * En una ficha nueva no hay nada que perder —nadie escribió antes— y el
   * formulario ni siquiera muestra esos campos si la hoja no los pide. Lo que
   * llegue de más se suelta, como siempre.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: CLASICO, conyuge: 'María Rojas Soto' });
  assert.equal(cert.conyuge, null);
});

// ═════════════════════════ dos advertencias, una sola pregunta ══

test('EL QUE IMPORTA: cambiar el tipo Y anularlo en el mismo guardado se dicen los dos', async () => {
  /*
   * La marca de «guardar igual» es UNA para toda la petición: dice que sí a
   * todo lo que este guardado tenga que preguntar. Preguntando de a una, quien
   * confirma la primera pasa la segunda sin haberla leído — y la segunda puede
   * ser la grave (ver server/una-sola-pregunta.js).
   */
  const api = await elSistemaAndando();
  const cert = await unMatrimonio(api);

  const r = await api('PUT', `/certificados/${cert.id}`, { tipo: CLASICO, estado: 'Anulado' });
  assert.equal(r.estado, 400);
  const aviso = String(r.json.error);
  assert.match(aviso, /Hay dos cosas que revisar antes de guardar/);
  assert.match(aviso, /\(1\).*«El otro cónyuge»/s, 'primero el que destruye datos');
  assert.match(aviso, /\(2\).*Va a anular/s, 'y después el del estado');
  assert.equal(r.json.confirmar, 'certificado_que_cambia_de_tipo',
    'la clave es la del primero: lo del estado se deshace, los datos soltados no vuelven');

  const sigue = await api('GET', `/certificados/${cert.id}`);
  assert.equal(sigue.json.tipo, MATRIMONIO, 'y no pasó ninguna de las dos cosas');
  assert.equal(sigue.json.estado, 'Emitido');
});

test('y contestando una vez, pasan las dos', async () => {
  const api = await elSistemaAndando();
  const cert = await unMatrimonio(api);
  const r = await api('PUT', `/certificados/${cert.id}`, {
    tipo: CLASICO, estado: 'Anulado', igual_asi: true,
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.tipo, CLASICO);
  assert.equal(r.json.conyuge, null);
  assert.equal(r.json.estado, 'Anulado');
});

// ══════════════════════════════════════ el aviso, por su cuenta ══

test('el aviso usa los rótulos del formulario, no los nombres de las columnas', () => {
  /*
   * Se leen al preguntar y no al arrancar, para que un campo que se renombre no
   * deje este aviso hablando de otra cosa. Quien contesta ve «El otro cónyuge»,
   * que es lo que dice su pantalla, y no «conyuge».
   */
  const rotulos = ['conyuge', 'padrino_2'].map((c) => def.fields.find((f) => f.name === c).label);
  assert.deepEqual(rotulos, ['El otro cónyuge', 'Segundo padrino']);
});

test('la pantalla sabe qué preguntar con esa clave', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'), app.indexOf('const como = COMO_SE_PREGUNTA['));
  const entrada = tabla.slice(tabla.indexOf('certificado_que_cambia_de_tipo: {'));
  assert.ok(entrada.startsWith('certificado_que_cambia_de_tipo: {'), 'la entrada existe');
  const bloque = entrada.slice(0, entrada.indexOf('},'));
  assert.match(bloque, /volver: 'Volver y revisarlos'/);
  assert.match(bloque, /seguir: 'Cambiarlo igual'/);
});
