/**
 * EL LIBRO DE ACTAS NO PESA EN EL ESTADO DE CUMPLIMIENTO DE UN CUERPO.
 *
 * Es una decisión de la corporación, tomada cuando se midió el asunto:
 * levantar actas es una práctica que se cuida, no un papel que se exige. De los
 * diecisiete cuerpos de la base de trabajo, dos tenían alguna acta anotada;
 * agregar un requisito de actas al cumplimiento habría cambiado a «Pendiente» a
 * quince de un día para otro, sin que nadie hubiera hecho nada distinto.
 *
 * Hubo además, entre la v1.352.0 y la v1.393.0, un aviso en el panel de control
 * que nombraba a los cuerpos que no estaban levantando actas —avisaba, no
 * reprochaba— y la corporación pidió sacarlo. Con él se fue su prueba, pero NO
 * esta parte: la decisión de fondo sigue en pie y sin nada que la cuide se
 * podría deshacer por descuido. Por eso queda acá, sola y dicha.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

test('ningún requisito del cumplimiento de un cuerpo habla de actas', async () => {
  /*
   * Se mira por donde se mira de verdad —la ficha del cuerpo, que es la que
   * publica su cumplimiento— y no llamando a una función por dentro: lo que
   * importa es que la persona no vea el reproche, no dónde se calcula.
   */
  const api = await elSistemaAndando();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`Iglesia LA ${marca}`, `LA-${marca}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas LA ${marca}`, iglesia).lastInsertRowid;   // sin una sola acta

  const ficha = (await api('GET', `/cuerpos/${cuerpo}`)).json;
  const items = (ficha.cumplimiento && ficha.cumplimiento.items) || [];
  assert.ok(items.length >= 5, `la ficha trae su cumplimiento (${items.length} requisitos)`);
  assert.ok(!items.some((i) => /acta/i.test(`${i.texto} ${i.detalle || ''}`)),
    'ningún requisito del cumplimiento puede hablar de actas');
});

test('y el módulo del cuerpo no mira su libro para decidirlo', () => {
  const fs = require('fs');
  const path = require('path');
  const cuerpos = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  const cumplimiento = cuerpos.slice(cuerpos.indexOf('cumplimiento'), cuerpos.indexOf('cumplimiento') + 6000);
  assert.ok(!/actas_reuniones/.test(cumplimiento),
    'si un día se le enchufa al cumplimiento, que sea a propósito y no de rebote');
});
