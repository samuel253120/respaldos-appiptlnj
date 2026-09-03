/**
 * CE-03 · Borrar un certificado no preguntaba, y se llevaba casi todo.
 *
 * Un certificado es lo único de este sistema que se firma, se sella y sale del
 * edificio. Borrarlo hace dos cosas que no se ven: deja fuera del alcance de
 * nadie lo que decía, y libera su número, que el sistema volverá a proponer.
 *
 * MEDIDO en la v1.293.0, sobre un certificado de bautismo completo —con su
 * fecha de evento, su oficiante, un texto propio y la nota «Se entregó en mano
 * el 3 de marzo»—:
 *
 *   · `DELETE /certificados/:id` contestaba **200** sin una palabra.
 *   · De los dieciséis datos escritos quedaban **seis** en el Registro de
 *     Cambios: los del listado. No estaba la fecha del bautismo, que es lo que
 *     el papel certifica.
 *   · Y el número volvía a ofrecerse: emitido el CERT-001-2026 y borrado, el
 *     sistema proponía otra vez el CERT-001-2026.
 *
 * Es el mismo hallazgo que la oficina de partes cerró en la v1.286.0. Acá pesa
 * más: un documento de la oficina de partes es la anotación de algo que pasó;
 * un certificado ES el documento.
 *
 * NO SE PROHÍBE BORRAR, y eso también se prueba: un certificado mal emitido hay
 * que poder sacarlo. Lo que se arregla es que quien borra vea qué se lleva.
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

function unaIglesia(ciudad = 'Concepción') {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado, ciudad) VALUES (?, ?, 'Activa', ?)")
    .run(`Borrar ${m}`, `BC${m}`.slice(0, 18), ciudad).lastInsertRowid;
}

/**
 * UN FORMATO PROPIO PARA CADA FORMA DE HOJA, Y NO LOS QUE TRAE EL SISTEMA.
 *
 * Los archivos del motor comparten UNA base, y hay uno —hojas-de-certificado—
 * que A PROPÓSITO le reescribe el texto y la disposición al formato
 * «Matrimonio» que trae el sistema, para comprobar que la actualización no pisa
 * lo que la iglesia editó. Es una prueba legítima y deja el formato así, de
 * modo que dar por hecho que «Matrimonio» tiene la disposición Matrimonio
 * depende de en qué orden corrieron los dos archivos.
 */
function unFormatoCon(disposicion) {
  const nombre = `Hoja ${disposicion} ${marca()}`;
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, texto, disposicion, tamano_hoja, orientacion)
     VALUES (?, 1, 100, 'Certifica lo suyo.', ?, 'Carta', ?)`
  ).run(nombre, disposicion, disposicion === 'Clásica' ? 'Vertical' : 'Horizontal');
  return nombre;
}

const PRESENTACION = unFormatoCon('Presentación de niños');
const MATRIMONIO = unFormatoCon('Matrimonio');
/* Uno cuyo texto no nombra ningún día, para poder emitir una ficha pelada */
const SIN_DIA = unFormatoCon('Clásica');

async function unCertificado(api, campos = {}) {
  const r = await api('POST', '/certificados', {
    // Con la fecha del evento, que desde la v1.297.0 un certificado cuyo texto
    // nombra el día no se emite sin él (CE-06): la hoja saldría con el hueco.
    tipo: 'Bautismo', iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', fecha_evento: '2026-02-01', numero: `CERT-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

/** El aviso que contesta el servidor al intentar borrarlo sin confirmar. */
async function loQueDiceAlBorrar(api, id) {
  const r = await api('DELETE', `/certificados/${id}`);
  assert.equal(r.estado, 400, 'antes contestaba 200 y borraba en silencio');
  assert.equal(r.json.confirmar, 'certificado_que_se_borra');
  return String(r.json.error);
}

/** La línea que quedó en el Registro de Cambios por haberlo borrado. */
function laConstanciaDe(id) {
  return db
    .prepare("SELECT detalle FROM registro_cambios WHERE modulo = 'Certificados' AND accion = 'Eliminación' AND registro_id = ?")
    .get(id);
}

// ═══════════════════════════════════════════ borrar pregunta ══

test('borrar un certificado PREGUNTA en vez de borrarlo', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);

  const r = await api('DELETE', `/certificados/${cert.id}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'certificado_que_se_borra',
    'es una PREGUNTA, no una negativa: un certificado mal emitido hay que poder sacarlo');

  const sigue = await api('GET', `/certificados/${cert.id}`);
  assert.equal(sigue.estado, 200, 'mientras no contesten, el certificado sigue ahí');
});

test('y contestando que sí, se borra: no se prohíbe', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);

  const r = await api('DELETE', `/certificados/${cert.id}?igual_asi=1`);
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal((await api('GET', `/certificados/${cert.id}`)).estado, 404);
});

// ═══════════════════════════════════════════ qué dice el aviso ══

test('el aviso dice CUÁL es: su número, de qué es y de quién', async () => {
  // Se borra desde un listado donde todas las filas se parecen
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { nombre_titular: 'Pedro Díaz Rojas' });
  const aviso = await loQueDiceAlBorrar(api, cert.id);

  assert.match(aviso, new RegExp(`n\\.º ${cert.numero}`));
  assert.match(aviso, /de Bautismo/);
  assert.match(aviso, /a nombre de Pedro Díaz Rojas/);
  assert.match(aviso, /emitido el 10-03-2026/, 'y de cuándo, como el sistema escribe las fechas');
});

test('dice QUÉ SE LLEVA, dato por dato', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, {
    fecha_evento: '2026-02-01',
    texto: 'Certifica que fue bautizada en las aguas.',
    notas: 'Se entregó en mano el 3 de marzo.',
  });
  const aviso = await loQueDiceAlBorrar(api, cert.id);

  assert.match(aviso, /la fecha del evento \(01-02-2026\)/);
  assert.match(aviso, /un texto propio/);
  assert.match(aviso, /las notas internas/);
});

test('y una ficha sin nada más lo dice, en vez de inventar una lista', async () => {
  /*
   * Con un formato cuyo texto no nombra ningún día: desde la v1.297.0, uno que
   * sí lo nombra no se puede emitir sin la fecha del evento (CE-06), y con la
   * fecha puesta esta ficha ya no estaría pelada.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { tipo: SIN_DIA, fecha_evento: null });
  assert.match(await loQueDiceAlBorrar(api, cert.id), /No tiene nada más escrito/);
});

test('EL QUE IMPORTA: dice que el número vuelve a ofrecerse, y nombra «Anulado»', async () => {
  /*
   * Es lo único que esta pregunta sabe y el «¿está seguro?» del navegador no.
   * Si el papel ya se entregó, el número liberado produce dos certificados en
   * circulación diciendo ser el mismo.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);
  const aviso = await loQueDiceAlBorrar(api, cert.id);

  assert.match(aviso, new RegExp(`El número ${cert.numero} vuelve a quedar disponible`));
  assert.match(aviso, /dos certificados en circulación/);
  assert.match(aviso, /«Anulado»/, 'y nombra la operación que conserva el número');
});

test('uno sin número dice que no libera ninguno', async () => {
  // El número es obligatorio por el formulario, así que se hace por la base:
  // hay certificados viejos importados sin él, y el aviso no puede mentirles
  const iglesia = unaIglesia();
  db.prepare(
    `INSERT INTO certificados (numero, tipo, iglesia_id, nombre_titular, fecha_emision, estado)
     VALUES (NULL, 'Bautismo', ?, 'Sin Número', '2026-03-10', 'Emitido')`
  ).run(iglesia);
  const fila = db.prepare('SELECT * FROM certificados WHERE nombre_titular = ? AND iglesia_id = ?')
    .get('Sin Número', iglesia);

  const aviso = def.hooks.beforeDelete(fila, { confirmado: false }).error;
  assert.match(aviso, /un certificado sin número/);
  assert.match(aviso, /no libera ninguno/);
  assert.ok(!/vuelve a quedar disponible/.test(aviso));
});

test('uno ya anulado lo dice: la fila es la constancia de que existió', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });
  assert.match(await loQueDiceAlBorrar(api, cert.id), /Ya está anulado/);
});

test('y uno que salió de una solicitud, también', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = db.prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Ana', ?)")
    .run(`Soto ${marca()}`).lastInsertRowid;
  const sol = await api('POST', '/solicitudes', {
    iglesia_id: iglesia, fecha: '2026-03-01', tipo: 'Certificado',
    solicitante_tipo: 'No miembro', no_miembro_id: quien,
    asunto: 'Pide un certificado de bautismo',
  });
  assert.equal(sol.estado, 201, JSON.stringify(sol.json));
  const cert = await unCertificado(api, { iglesia_id: iglesia, solicitud_id: sol.json.id });
  assert.match(await loQueDiceAlBorrar(api, cert.id), /Salió de una solicitud/);
});

// ══════════════════════════ qué queda en el Registro de Cambios ══

test('EL OTRO QUE IMPORTA: la constancia guarda la ficha entera, no seis datos', async () => {
  const api = await elSistemaAndando();
  const pastor = db.prepare(
    "INSERT INTO pastores (nombres, apellidos, estado) VALUES ('Luis', ?, 'Activo')"
  ).run(`Díaz ${marca()}`).lastInsertRowid;
  const cert = await unCertificado(api, {
    iglesia_id: unaIglesia('Chillán'),
    fecha_evento: '2026-02-01', oficiante_id: pastor,
    texto: 'Certifica que fue bautizada en las aguas.',
    notas: 'Se entregó en mano el 3 de marzo.',
  });

  await api('DELETE', `/certificados/${cert.id}?igual_asi=1`);
  const linea = laConstanciaDe(cert.id);
  assert.ok(linea, 'quedó la línea del borrado');
  const dice = linea.detalle;

  // Los seis de siempre, que ya estaban
  assert.match(dice, new RegExp(`Número: ${cert.numero}`));
  assert.match(dice, /Nombre del titular: Ana Soto Vera/);
  // Y los que faltaban
  assert.match(dice, /Fecha del evento[^·]*01-02-2026/, 'lo que el papel certifica');
  assert.match(dice, /Oficiante \/ Firma: Luis Díaz/, 'y con su nombre, no con su número');
  assert.match(dice, /Texto del certificado: Certifica que fue bautizada/);
  assert.match(dice, /Notas internas: Se entregó en mano el 3 de marzo\./);
  assert.match(dice, /Ciudad: Chillán/, 'la ciudad congelada al emitir');
  assert.match(dice, /Forma de la hoja: Clásica/);
});

test('de una presentación de niños quedan los padres y los padrinos', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, {
    tipo: PRESENTACION, nombre_titular: 'Matías Rojas Soto',
    fecha_nacimiento: '2025-11-06', padre: 'Juan Rojas', madre: 'Eva Soto',
    padrino_1: 'Luis Pérez', madrina_1: 'Rosa Pérez',
    padrino_2: 'Pablo Vera', madrina_2: 'Sara Vera',
  });
  const aviso = await loQueDiceAlBorrar(api, cert.id);
  assert.match(aviso, /los datos de la presentación \(los padres y los padrinos\)/,
    'el aviso los cuenta juntos: siete nombres seguidos no se leen');

  await api('DELETE', `/certificados/${cert.id}?igual_asi=1`);
  const dice = laConstanciaDe(cert.id).detalle;
  for (const quien of ['Juan Rojas', 'Eva Soto', 'Luis Pérez', 'Rosa Pérez', 'Pablo Vera', 'Sara Vera']) {
    assert.ok(dice.includes(quien), `no quedó ${quien}: ${dice}`);
  }
  assert.match(dice, /06-11-2025/, 'y la fecha de nacimiento');
});

test('y de un matrimonio, el otro cónyuge', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, {
    tipo: MATRIMONIO, nombre_titular: 'Pedro Díaz', conyuge: 'María Rojas Soto',
  });
  assert.match(await loQueDiceAlBorrar(api, cert.id), /el otro cónyuge/);

  await api('DELETE', `/certificados/${cert.id}?igual_asi=1`);
  assert.match(laConstanciaDe(cert.id).detalle, /María Rojas Soto/);
});

// ═════════════════════════════════ el número que vuelve a salir ══

test('el número liberado se vuelve a proponer, y por eso la pregunta lo dice', async () => {
  /*
   * Esto NO se arregla acá: que el correlativo se cierre solo es otra decisión
   * —un libro con huecos y un libro que reutiliza números tienen cada uno su
   * problema—. Lo que se prueba es que el aviso dice la verdad.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const propuesto = (await api('GET', `/certificados/proximo-numero?iglesia_id=${iglesia}`)).json.numero;
  const cert = await unCertificado(api, { iglesia_id: iglesia, numero: propuesto });

  const siguiente = (await api('GET', `/certificados/proximo-numero?iglesia_id=${iglesia}`)).json.numero;
  assert.notEqual(siguiente, propuesto, 'con el certificado puesto, propone el que sigue');

  await api('DELETE', `/certificados/${cert.id}?igual_asi=1`);
  const despues = (await api('GET', `/certificados/proximo-numero?iglesia_id=${iglesia}`)).json.numero;
  assert.equal(despues, propuesto, 'borrado, vuelve a proponer el suyo — que es lo que el aviso advierte');
});

// ═════════════════════════════════════════ lo que quedó declarado ══

test('el módulo declara qué conserva al borrar, y están los que faltaban', () => {
  /*
   * La lista por omisión son los campos del LISTADO, pensada para caber en
   * columnas. Escrita acá, se ve; y si un día alguien agrega un campo nuevo al
   * certificado sin agregarlo acá, esta prueba no lo atrapa — pero al menos la
   * lista está a la vista en el módulo y no escondida en el motor.
   */
  for (const campo of ['fecha_evento', 'oficiante_id', 'texto', 'notas', 'ciudad', 'conyuge',
    'padre', 'madre', 'padrino_1', 'madrina_1', 'padrino_2', 'madrina_2', 'fecha_nacimiento']) {
    assert.ok(def.camposAlBorrar.includes(campo), `falta ${campo}`);
  }
  for (const campo of def.camposAlBorrar) {
    assert.ok(def.fields.some((f) => f.name === campo), `«${campo}» no es un campo de este módulo`);
  }
});

test('la pregunta del borrado NO se agrega a la tabla de las de guardar', () => {
  /*
   * `COMO_SE_PREGUNTA` la lee solo el camino de GUARDAR. Un borrado pregunta
   * por `borrarPreguntando`, en la caja del navegador, con el texto entero del
   * servidor. Ya hubo una entrada de borrado ahí que no se leía nunca.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'), app.indexOf('const como = COMO_SE_PREGUNTA['));
  assert.ok(!tabla.includes('certificado_que_se_borra'), 'esa entrada no se leería nunca');
});
