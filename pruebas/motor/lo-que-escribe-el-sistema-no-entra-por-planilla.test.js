/**
 * Un campo de solo lectura no se escribe por planilla.
 *
 * El motor lo dice con todas sus letras donde el formulario lo cumple: un campo
 * así «lo escribe el sistema, y aceptarlo del formulario sería dejar que
 * cualquiera se invente el número de serie de una credencial». La importación
 * por planilla no tenía esa línea, así que el mismo dato entraba por una puerta
 * y no por la otra.
 *
 * MEDIDO en la v1.381.0, los mismos dos campos y los mismos valores:
 *
 *   «Marcada el» / «Marcada por»   formulario: descartados, quedan en nulo
 *                                  planilla:   «01-01-2020 08:00», y apuntando
 *                                              a otra persona
 *
 * Y esos dos son justamente la constancia de quién pasó la lista y cuándo, que
 * el sistema agregó para poder responder por ella. Contando lo declarado, la
 * puerta alcanzaba 97 campos en 27 módulos.
 *
 * `soloAlCrear` es la única excepción, y es la misma del formulario: se acepta
 * al CREAR y nunca más. Importar crea, así que ahí sí entra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { allModules } = require('../../server/registry');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central SL ${marca}`, `SL-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas SL ${marca}`, iglesia).lastInsertRowid;

// ------------------------------------------- el mismo dato, las dos puertas -

test('el número de una solicitud lo pone el sistema, se mande el que se mande', async () => {
  const api = await elSistemaAndando();
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Quien', `Pide SL ${marca}`, iglesia).lastInsertRowid;
  const base = {
    fecha: '2026-08-26', iglesia_id: iglesia, solicitante_tipo: 'Miembro', miembro_id: miembro,
    tipo: 'Certificado',
  };
  const inventado = `INVENTADO-${marca}`;

  const porFormulario = await api('POST', '/solicitudes', {
    ...base, asunto: `Por el formulario SL ${marca}`, numero: inventado,
  });
  assert.equal(porFormulario.estado, 201, porFormulario.texto.slice(0, 200));
  assert.notEqual(porFormulario.json.numero, inventado, 'el formulario ya lo descartaba');

  const porPlanilla = await api('POST', '/importar/solicitudes', {
    filas: [{ ...base, asunto: `Por la planilla SL ${marca}`, numero: inventado }], prueba: false,
  });
  assert.equal(porPlanilla.json.correctas, 1, JSON.stringify(porPlanilla.json).slice(0, 300));
  const suya = db.prepare('SELECT numero FROM solicitudes WHERE asunto = ?').get(`Por la planilla SL ${marca}`);
  assert.ok(suya, 'la fila entró: lo que se descarta es el campo, no la fila');
  assert.notEqual(suya.numero, inventado, 'y por la planilla, ahora también');
  assert.match(suya.numero, /^SOL-/, 'el correlativo lo sigue poniendo el sistema');
});

test('quién firmó un acta y cuándo no se escriben por planilla', async () => {
  /*
   * El caso aísla la regla: el gancho de actas solo estampa esos dos cuando el
   * acta llega como «Firmada», así que en un borrador nadie los toca y lo único
   * que puede ponerlos es lo que llegó en la fila.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/importar/actas_reuniones', {
    filas: [{
      cuerpo_id: cuerpo, fecha: '2026-08-05', numero_acta: `A-SL-${marca}`, tipo: 'Ordinaria',
      estado: 'Borrador', desarrollo: 'Se trató lo de siempre.', acuerdos: 'Se acordó comprar sillas.',
      firmada_por: 1, fecha_firma: '2020-01-01',
    }],
    prueba: false,
  });
  assert.equal(r.json.correctas, 1, JSON.stringify(r.json).slice(0, 300));
  const acta = db.prepare('SELECT * FROM actas_reuniones WHERE numero_acta = ?').get(`A-SL-${marca}`);
  assert.equal(acta.estado, 'Borrador');
  assert.equal(acta.firmada_por, null, 'firmar un acta desde una planilla ya no se puede');
  assert.equal(acta.fecha_firma, null);
});

// ------------------------------------------------------- y la excepción -----

test('lo que se acepta al crear sí entra, y lo de al lado no', async () => {
  const api = await elSistemaAndando();
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Quien', `Pide otra SL ${marca}`, iglesia).lastInsertRowid;
  const sol = await api('POST', '/solicitudes', {
    fecha: '2026-08-26', iglesia_id: iglesia, solicitante_tipo: 'Miembro', miembro_id: miembro,
    tipo: 'Certificado', asunto: `La que origina SL ${marca}`,
  });
  assert.equal(sol.estado, 201, sol.texto.slice(0, 200));

  const r = await api('POST', '/importar/certificados', {
    filas: [{
      numero: `CERT-SL-${marca}`, tipo: 'Bautismo', iglesia_id: iglesia,
      nombre_titular: 'Titular de prueba', fecha_emision: '2026-08-26', fecha_evento: '2026-06-01',
      solicitud_id: sol.json.id,          // readonly + soloAlCrear: entra
      ciudad: 'Ciudad Inventada',         // readonly a secas: no entra
    }],
    prueba: false,
  });
  assert.equal(r.json.correctas, 1, JSON.stringify(r.json).slice(0, 300));
  const cert = db.prepare('SELECT * FROM certificados WHERE numero = ?').get(`CERT-SL-${marca}`);
  assert.equal(cert.solicitud_id, sol.json.id, 'de dónde salió se sabe al emitirlo, y se acepta al crear');
  assert.equal(cert.ciudad, null, 'la ciudad se congela al emitir: no se manda');
});

// ------------------------------------------ la regla, escrita en un solo sitio

test('la planilla usa la MISMA línea que el formulario', () => {
  const importar = fs.readFileSync(path.join(__dirname, '../../server/importar.js'), 'utf8');
  const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(crud, /if \(f\.readonly && !\(f\.soloAlCrear && isNew\)\) continue;/,
    'la del formulario, que es la que estaba bien');
  assert.match(importar, /if \(f\.readonly && !f\.soloAlCrear\) continue;/,
    'y la de la planilla, que crea siempre');
});

test('cuántos campos protege, para que se vea el tamaño de la puerta', () => {
  /*
   * No es una cifra bonita: es lo que se podía escribir por planilla y no por
   * el formulario. Si mañana baja mucho o sube mucho, conviene venir a mirar
   * por qué.
   */
  let campos = 0;
  let modulos = 0;
  for (const def of allModules()) {
    if (def.soloLectura && def.soloLectura.alGuardar) continue;  // esa puerta ya está cerrada entera
    const suyos = (def.fields || []).filter((f) => f.readonly && !f.soloAlCrear);
    if (!suyos.length) continue;
    modulos++;
    campos += suyos.length;
  }
  assert.ok(campos > 60, `se esperaban decenas de campos protegidos y son ${campos}`);
  assert.ok(modulos > 15, `en decenas de módulos, y son ${modulos}`);
});

test('y la pantalla no ofrece mapear una columna a un campo que se va a descartar', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /f\.type !== 'file' && !f\.computed && \(!f\.readonly \|\| f\.soloAlCrear\)/,
    'ofrecer una columna que el servidor descarta es prometer algo que no pasa');
});

test('la excepción viaja hasta la pantalla, o el mapeo escondería lo que sí se acepta', () => {
  const { comoLoVeLaPantalla } = require('../../server/meta-liviana');
  const soloAlCrear = comoLoVeLaPantalla({ name: 'x', label: 'X', type: 'ref', readonly: true, soloAlCrear: true });
  assert.equal(soloAlCrear.readonly, true);
  assert.equal(soloAlCrear.soloAlCrear, true);
  const aSecas = comoLoVeLaPantalla({ name: 'y', label: 'Y', type: 'text', readonly: true });
  assert.equal(aSecas.soloAlCrear, false);
});
