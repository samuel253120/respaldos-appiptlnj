/**
 * Lo que viene después de aprobar, y lo que pidió cada persona.
 *
 * Son las dos maneras en que una solicitud se conecta con el resto del
 * sistema, y las dos estaban a medias:
 *
 *   · HACIA ADELANTE. Solo la ayuda social se conectaba con lo que produce.
 *     Aprobar una de «Certificado» o de «Credencial» no proponía emitir nada, y
 *     una de «Traslado de membresía» no tocaba el traslado: había que
 *     acordarse, ir a otro módulo y copiar a mano lo que ya estaba escrito.
 *
 *   · HACIA ATRÁS. El módulo se diseñó «para poder ver todo lo que pidió una
 *     persona», pero para eso había que ir al listado y buscarla por nombre.
 *
 * Lo que se cuida acá: que se OFREZCA y no se haga solo —emitir un certificado
 * es una decisión, no una consecuencia—, que no se ofrezca dos veces lo que ya
 * se emitió, y que ver lo de una persona no abra nada que su alcance no abra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const solicitudes = require('../../server/modules/solicitudes');
const paso = require('../../server/solicitudes/paso-siguiente');
const { CONCEDIDA } = require('../../server/solicitud-ayuda');

let cuantos = 0;
const unaIglesia = (codigo) =>
  db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Del paso ${++cuantos}`, codigo).lastInsertRowid;
const IGLESIA = unaIglesia('PASO');
const OTRA = unaIglesia('PASO2');

const unUsuario = (nombre) =>
  db.prepare("INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, 'secretario', 1, 'x')")
    .run(nombre, `${73000000 + cuantos++}-0`).lastInsertRowid;
const YO = unUsuario('Quien tramita');

const unMiembro = (nombres) =>
  db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, rut, estado) VALUES (?, 'Del Paso', ?, ?, 'Activo')")
    .run(nombres, IGLESIA, `${74000000 + cuantos++}-0`).lastInsertRowid;
const unNoMiembro = (nombres, iglesia) =>
  db.prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?, ?, ?)')
    .run(nombres, 'Del Paso', iglesia || IGLESIA).lastInsertRowid;

function unaSolicitud(campos = {}) {
  const base = {
    numero: `SOL-PASO-${String(++cuantos).padStart(4, '0')}-2096`,
    fecha: '2026-08-20', iglesia_id: IGLESIA, solicitante_tipo: 'No miembro',
    miembro_id: null, no_miembro_id: null, solicitante: 'Quien pidió',
    tipo: 'Otro', asunto: 'Un asunto', estado: 'Pendiente', responsable_id: YO,
    ayuda_social_id: null, ...campos,
  };
  const id = db.prepare(
    `INSERT INTO solicitudes (numero, fecha, iglesia_id, solicitante_tipo, miembro_id, no_miembro_id,
                              solicitante, tipo, asunto, estado, responsable_id, ayuda_social_id)
     VALUES (@numero, @fecha, @iglesia_id, @solicitante_tipo, @miembro_id, @no_miembro_id,
             @solicitante, @tipo, @asunto, @estado, @responsable_id, @ayuda_social_id)`
  ).run(base).lastInsertRowid;
  return db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id);
}
const queSigue = (fila) => paso.deLaSolicitud(db, fila, { CONCEDIDA });

// ------------------------------------------- qué tipo lleva a qué lugar ----

test('las que no llevan a ninguna parte no ofrecen nada', () => {
  for (const tipo of ['Otro', 'Permiso / Licencia', 'Uso de instalaciones', 'Materiales / Equipo',
    'Audiencia con liderazgo']) {
    assert.equal(queSigue(unaSolicitud({ tipo, estado: 'Aprobada' })), null, tipo);
  }
});

test('la de certificado lleva a emitir un certificado', () => {
  const p = queSigue(unaSolicitud({ tipo: 'Certificado', estado: 'Aprobada' }));
  assert.equal(p.modulo, 'certificados');
  assert.equal(p.abreLaFicha, false);
});

test('la de credencial, a emitir una credencial', () => {
  const p = queSigue(unaSolicitud({ tipo: 'Credencial', estado: 'Aprobada' }));
  assert.equal(p.modulo, 'credenciales');
});

test('la de traslado lleva a la ficha del miembro, y no crea nada', () => {
  const quien = unMiembro('Pedro');
  const p = queSigue(unaSolicitud({
    tipo: 'Traslado de membresía', estado: 'Aprobada', solicitante_tipo: 'Miembro', miembro_id: quien,
  }));
  assert.equal(p.modulo, 'miembros');
  assert.equal(p.abreLaFicha, true, 'un traslado es un cambio de estado en el registro oficial');
  assert.equal(p.precarga.id, quien);
});

test('la de traslado de alguien que NO está inscrito no lleva a ninguna ficha', () => {
  const p = queSigue(unaSolicitud({
    tipo: 'Traslado de membresía', estado: 'Aprobada',
    solicitante_tipo: 'No miembro', no_miembro_id: unNoMiembro('Rosa'),
  }));
  assert.equal(p, null, 'no hay membresía que trasladar');
});

// --------------------------------- SE OFRECE, NO SE HACE, Y NO ANTES ------

test('mientras no esté aprobada se anuncia, pero no se ofrece el botón', () => {
  for (const estado of ['Pendiente', 'En revisión', 'En espera de antecedentes']) {
    const p = queSigue(unaSolicitud({ tipo: 'Certificado', estado }));
    assert.equal(p.concedida, false, estado);
    assert.equal(p.precarga, null, 'emitir un papel de algo que todavía se revisa es emitirlo antes de tiempo');
  }
});

test('aprobada sí, y con lo que la solicitud ya sabe', () => {
  const quien = unMiembro('Ana');
  const s = unaSolicitud({
    tipo: 'Certificado', estado: 'Aprobada', solicitante_tipo: 'Miembro',
    miembro_id: quien, solicitante: 'Ana Del Paso',
  });
  const p = queSigue(s);
  assert.equal(p.concedida, true);
  assert.equal(p.precarga.iglesia_id, IGLESIA);
  assert.equal(p.precarga.miembro_id, quien);
  assert.equal(p.precarga.nombre_titular, 'Ana Del Paso');
});

test('el TIPO de certificado no se adivina', () => {
  const p = queSigue(unaSolicitud({ tipo: 'Certificado', estado: 'Aprobada' }));
  assert.equal(p.precarga.tipo, undefined,
    'la solicitud dice «Certificado» y nada más: elegir cuál sería inventar el contenido de un papel firmado');
});

test('la credencial propone al pastor solo si quien pide tiene ficha de pastor', () => {
  const suelto = unMiembro('Luis');
  const sinFicha = queSigue(unaSolicitud({
    tipo: 'Credencial', estado: 'Aprobada', solicitante_tipo: 'Miembro', miembro_id: suelto,
  }));
  assert.equal(sinFicha.precarga.pastor_id, undefined, 'una credencial no es de cualquiera');

  const conFicha = unMiembro('Carlos');
  const pastor = db.prepare(
    `INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, miembro_id, estado)
     VALUES ('Carlos', 'Del Paso', ?, ?, ?, 'Activo')`
  ).run(`${75000000 + cuantos++}-0`, IGLESIA, conFicha).lastInsertRowid;
  const p = queSigue(unaSolicitud({
    tipo: 'Credencial', estado: 'Aprobada', solicitante_tipo: 'Miembro', miembro_id: conFicha,
  }));
  assert.equal(p.precarga.pastor_id, pastor);
});

// ------------------------------- lo que ya salió no se vuelve a ofrecer ----

test('si ya se emitió, se muestra lo emitido y no el botón', () => {
  const s = unaSolicitud({ tipo: 'Certificado', estado: 'Aprobada' });
  db.prepare(
    `INSERT INTO certificados (numero, tipo, iglesia_id, nombre_titular, fecha_emision, solicitud_id)
     VALUES ('CERT-042-2026', 'Bautismo', ?, 'Quien pidió', '2026-08-21', ?)`
  ).run(IGLESIA, s.id);
  const p = queSigue(s);
  assert.ok(p.hecho, 'la solicitud tiene que saber que ya salió');
  assert.equal(p.hecho.nombre, 'CERT-042-2026');
  assert.equal(p.precarga, null, 'ofrecerlo otra vez invita a emitir el mismo papel dos veces');
});

test('la ayuda social ya se hace sola: se dice, no se ofrece', () => {
  const s = unaSolicitud({ tipo: 'Ayuda social', estado: 'Pendiente' });
  const p = queSigue(s);
  assert.equal(p.automatico, true);
  assert.equal(p.precarga, null);
});

test('y cuando la ayuda nació, se enlaza a ella', () => {
  const ayuda = db.prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario, tipo_ayuda, estado)
     VALUES ('2026-08-21', ?, 'Quien pidió', 'Alimentos', 'Entregada')`
  ).run(IGLESIA).lastInsertRowid;
  const p = queSigue(unaSolicitud({ tipo: 'Ayuda social', estado: 'Aprobada', ayuda_social_id: ayuda }));
  assert.equal(p.hecho.id, ayuda);
});

// ------------------- el enlace de vuelta se pone al crear y nunca más -----

test('«solo al crear»: el origen se acepta al emitir, y después ya no se toca', () => {
  const certificados = require('../../server/modules/certificados');
  const credenciales = require('../../server/modules/credenciales');
  for (const mod of [certificados, credenciales]) {
    const campo = mod.fields.find((f) => f.name === 'solicitud_id');
    assert.ok(campo, `${mod.name} tiene que llevar el enlace de vuelta`);
    assert.equal(campo.readonly, true, 'no se elige a mano de una lista');
    assert.equal(campo.soloAlCrear, true,
      'sin esto el motor lo descarta —y con razón— y el enlace nunca se guarda');
  }
});

test('y el motor entiende esa regla: al crear entra, al editar no', () => {
  const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.ok(/if \(f\.readonly && !\(f\.soloAlCrear && isNew\)\) continue;/.test(crud),
    'la excepción tiene que ser esa y solo esa: aceptar cualquier campo de solo lectura del formulario '
    + 'dejaría que alguien se invente el número de serie de una credencial');
});

// --------------------------- lo que pidió una persona, en su ficha --------

/** Llama a la ruta como lo haría el servidor. */
function dePersona(usuario, consulta) {
  let atender = null;
  const router = { get(ruta, permiso, mano) { if (ruta === '/solicitudes/de-persona') atender = mano; }, post() {} };
  solicitudes.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next() });
  assert.ok(atender, 'la ruta tiene que estar registrada');
  let salida = null;
  let estado = 200;
  atender({ user: usuario, query: consulta },
    { json: (d) => { salida = d; }, status(c) { estado = c; return this; } });
  return { estado, ...(salida || {}) };
}
const ADMIN = { id: YO, rol: 'admin' };

test('la ficha de un miembro dice lo que ha pedido', () => {
  const quien = unMiembro('Marta');
  const suya = unaSolicitud({ solicitante_tipo: 'Miembro', miembro_id: quien, asunto: 'Lo que pidió Marta' });
  const ajena = unaSolicitud({ solicitante_tipo: 'Miembro', miembro_id: unMiembro('Otra') });
  const d = dePersona(ADMIN, { tipo: 'Miembro', id: quien });
  const ids = d.titular.map((s) => s.id);
  assert.ok(ids.includes(suya.id));
  assert.ok(!ids.includes(ajena.id), 'lo de otra persona no es lo que pidió esta');
});

test('y la de un no miembro también, que antes no tenía ninguna', () => {
  const quien = unNoMiembro('Rosa la vecina');
  const suya = unaSolicitud({ solicitante_tipo: 'No miembro', no_miembro_id: quien });
  const d = dePersona(ADMIN, { tipo: 'No miembro', id: quien });
  assert.deepEqual(d.titular.map((s) => s.id), [suya.id]);
});

test('donde figura sin haberla presentado va aparte, y no se repite', () => {
  const quien = unMiembro('Julia');
  const suya = unaSolicitud({ solicitante_tipo: 'Miembro', miembro_id: quien });
  const deOtro = unaSolicitud({ solicitante_tipo: 'Miembro', miembro_id: unMiembro('Tercero') });
  const meter = db.prepare(
    `INSERT INTO personas_solicitud (solicitud_id, persona_tipo, miembro_id, persona, relacion, iglesia_id)
     VALUES (?, 'Miembro', ?, 'Julia Del Paso', ?, ?)`
  );
  meter.run(deOtro.id, quien, 'La niña que se presenta', IGLESIA);
  meter.run(suya.id, quien, 'Ella misma', IGLESIA); // en la suya propia

  const d = dePersona(ADMIN, { tipo: 'Miembro', id: quien });
  assert.ok(d.titular.map((s) => s.id).includes(suya.id));
  const otros = d.involucrada.map((s) => s.id);
  assert.ok(otros.includes(deOtro.id), 'figura en la de otro');
  assert.ok(!otros.includes(suya.id), 'la suya propia ya salió arriba: verla dos veces no dice nada nuevo');
  assert.equal(d.involucrada.find((s) => s.id === deOtro.id).relacion, 'La niña que se presenta');
});

test('NO ABRE NADA: pasa por el mismo alcance que el listado', () => {
  const forastera = unNoMiembro('De otra iglesia', OTRA);
  const suya = unaSolicitud({
    solicitante_tipo: 'No miembro', no_miembro_id: forastera, iglesia_id: OTRA, responsable_id: null,
  });
  const acotado = { id: YO, rol: 'secretario', iglesias: [IGLESIA] };
  const d = dePersona(acotado, { tipo: 'No miembro', id: forastera });
  assert.ok(!d.titular.map((s) => s.id).includes(suya.id),
    'quien solo administra una iglesia no ve por acá las solicitudes de otra');
});

test('sin decir de quién, no se contesta', () => {
  assert.equal(dePersona(ADMIN, { tipo: 'Miembro' }).estado, 400);
});
