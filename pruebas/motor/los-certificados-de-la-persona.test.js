/**
 * CE-08 · La ficha de la persona no mostraba sus certificados.
 *
 * Un certificado puede quedar enlazado al miembro al que se le emitió, y ese
 * enlace se guarda. MEDIDO en la v1.298.0: la ficha de un miembro tenía OCHO
 * pestañas —Datos, Cuerpos, Asistencia, Servicios, Solicitudes, Ayudas,
 * Documentos, Historial— y ninguna era la de sus certificados.
 *
 * «¿Ya se le dio el certificado de bautismo?» es una pregunta de mostrador, y
 * se contestaba yendo al listado de Certificados y buscando por nombre, con la
 * esperanza de que quien lo emitió lo hubiera escrito igual. El dato estaba;
 * lo que faltaba era mirarlo desde donde se hace la pregunta.
 *
 * El sistema ya había hecho este mismo camino tres veces: la ficha dice qué ha
 * PEDIDO la persona, qué se le ha ENTREGADO y cómo ha ASISTIDO. Faltaba lo que
 * se le EMITIÓ.
 *
 * Lo que se comprueba acá es lo que el motor puede comprobar: que el listado
 * filtrado por persona conteste lo suyo y solo lo suyo, y que la pantalla esté
 * conectada. Que la pestaña SE VEA se mira en el navegador.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Suyos ${m}`, `SY${m}`.slice(0, 18)).lastInsertRowid;
}

function unMiembro(iglesia) {
  return db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Ana', ?, ?, 'Activo')")
    .run(`Soto ${marca()}`, iglesia).lastInsertRowid;
}

/** Un formato cuyo texto no nombra ningún día, para emitir sin más trámite. */
function unFormato() {
  const nombre = `Hoja ${marca()}`;
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, texto, disposicion, tamano_hoja, orientacion)
     VALUES (?, 1, 100, 'Certifica lo suyo.', 'Clásica', 'Carta', 'Vertical')`
  ).run(nombre);
  return nombre;
}

// ══════════════════════════ el listado por persona ══

test('el listado filtrado por persona trae los suyos y solo los suyos', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const tipo = unFormato();
  const suyo = unMiembro(iglesia);
  const otro = unMiembro(iglesia);

  const emitir = async (miembroId, numero) => {
    const r = await api('POST', '/certificados', {
      numero, tipo, iglesia_id: iglesia, miembro_id: miembroId,
      nombre_titular: 'Ana Soto', fecha_emision: '2026-03-10',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    return r.json;
  };
  await emitir(suyo, `SUYO-A-${marca()}`);
  await emitir(suyo, `SUYO-B-${marca()}`);
  await emitir(otro, `AJENO-${marca()}`);

  const r = await api('GET', `/certificados?f_miembro_id=${suyo}&limit=50`);
  assert.equal(r.estado, 200);
  assert.equal(r.json.total, 2, 'los dos suyos');
  for (const c of r.json.rows) assert.equal(c.miembro_id, suyo, 'y ninguno de otro');
});

test('y una persona sin certificados contesta una lista vacía, no un error', async () => {
  const api = await elSistemaAndando();
  const solo = unMiembro(unaIglesia());
  const r = await api('GET', `/certificados?f_miembro_id=${solo}&limit=50`);
  assert.equal(r.estado, 200);
  assert.equal(r.json.total, 0);
});

test('vienen del más nuevo al más viejo, que es como se pregunta', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const tipo = unFormato();
  const quien = unMiembro(iglesia);
  for (const [numero, fecha] of [['VIEJO', '2024-01-10'], ['NUEVO', '2026-05-20'], ['MEDIO', '2025-03-01']]) {
    const r = await api('POST', '/certificados', {
      numero: `${numero}-${marca()}`, tipo, iglesia_id: iglesia, miembro_id: quien,
      nombre_titular: 'Ana Soto', fecha_emision: fecha,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
  }
  const r = await api('GET', `/certificados?f_miembro_id=${quien}&limit=50&sort=fecha_emision&dir=desc`);
  assert.deepEqual(r.json.rows.map((c) => c.fecha_emision), ['2026-05-20', '2025-03-01', '2024-01-10']);
});

// ════════════════════════════ la pantalla, conectada ══

test('la ficha del miembro ofrece la pestaña, y la pide al módulo que corresponde', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function pestanasDeLaFicha(');
  const cuerpo = app.slice(desde, app.indexOf('\nfunction montarPestanas', desde));

  assert.match(cuerpo, /name === 'miembros' && MOD\['certificados'\]/,
    'y solo a quien puede ver el módulo: sin permiso, la pestaña no se ofrece');
  assert.match(cuerpo, /sumar\('certificados', 'Certificados', '📜'/);
  assert.match(cuerpo, /renderCertificadosDeLaPersona\(id, c\)/);
});

test('va después de Solicitudes: primero lo que pidió, después lo que se le emitió', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function pestanasDeLaFicha(');
  const cuerpo = app.slice(desde, app.indexOf('\nfunction montarPestanas', desde));

  const solicitudes = cuerpo.indexOf("sumar('solicitudes'");
  const certificados = cuerpo.indexOf("sumar('certificados'");
  const ayudas = cuerpo.indexOf("sumar('ayudas'");
  assert.ok(solicitudes > 0 && certificados > 0 && ayudas > 0);
  assert.ok(solicitudes < certificados, 'las solicitudes van antes');
  assert.ok(certificados < ayudas, 'y las ayudas después');
});

test('la de No Miembros NO la lleva: el certificado enlaza con la ficha de miembro', () => {
  /*
   * El campo del certificado es `miembro_id`, y apunta a Miembros. Ofrecer la
   * pestaña en No Miembros sería una caja que nunca puede tener nada.
   */
  const def = require('../../server/modules/certificados');
  const enlace = def.fields.find((f) => f.name === 'miembro_id');
  assert.equal(enlace.ref, 'miembros');
  assert.ok(!def.fields.some((f) => f.ref === 'no_miembros'),
    'no hay enlace a No Miembros que justificara la pestaña allá');

  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function pestanasDeLaFicha(');
  const cuerpo = app.slice(desde, app.indexOf('\nfunction montarPestanas', desde));
  assert.ok(!/name === 'no_miembros' && MOD\['certificados'\]/.test(cuerpo));
});

test('el panel marca los anulados, que es la mitad de la respuesta', () => {
  /*
   * Un certificado anulado sigue en el libro y sigue en esta lista. Quien viene
   * a preguntar si ya se le dio el de bautismo tiene que ver de una que ese
   * está dado de baja — es lo mismo que hace el sello de la hoja impresa.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderCertificadosDeLaPersona(');
  assert.ok(desde > 0, 'el panel existe');
  const cuerpo = app.slice(desde, app.indexOf('\n/**', desde + 10));

  assert.match(cuerpo, /f_miembro_id=\$\{miembroId\}/, 'pide los de esa persona');
  assert.match(cuerpo, /c\.estado === 'Anulado'/);
  assert.match(cuerpo, /badge red">Anulado/);
  assert.match(cuerpo, /Todavía no se le ha emitido ningún certificado/, 'y dice cuando no hay ninguno');
  assert.match(cuerpo, /#\/m\/certificados\/ficha\//, 'cada línea abre su ficha');
});
