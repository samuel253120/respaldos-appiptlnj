/**
 * El acta de asamblea firmada, y la que se borra.
 *
 * «Firmada» es el único estado que quiere decir algo fuera del sistema: hay un
 * papel firmado, en una carpeta, con la firma de quien presidió y de quien fue
 * secretario. El libro de asambleas no lo miraba.
 *
 * MEDIDO en la v1.278.0, sobre un acta de asamblea guardada como Firmada:
 *
 *   darle vuelta los acuerdos —de «se aprueba la compra
 *   del terreno» a «se rechaza»— ......................... 200, sin preguntar
 *   devolverla a «Borrador» ............................... 200, sin preguntar
 *   ¿quién la firmó y cuándo? ............................. no se guardaba
 *   borrarla con todo lo que decía adentro ................ 200, sin preguntar
 *
 * Y lo que quedaba anotado al borrarla eran las seis columnas del listado. De
 * un acta que decía «Se aprueba la venta por 118 votos a favor» no quedaba esa
 * frase en ninguna parte.
 *
 * Las dos reglas son las mismas que el libro de reuniones estrenó en la
 * v1.272.0 y la v1.273.0, y por eso NO se copiaron: viven en
 * server/acta-firmada.js y los dos módulos las usan. Este sistema ya tropezó
 * dos veces con una regla copiada que hubo que arreglar dos veces, y la última
 * prueba de este archivo existe para que no vuelva a pasar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unaIglesia() {
  const m = marca();
  const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia asamblea ${m}`, `FIR${m}`).lastInsertRowid;
  return { m, iglesia: id };
}

const unActa = (api, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `FIR-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-04-20', tipo: 'Ordinaria', iglesia_id: e.iglesia,
  presidida_por: 'Pastor Pérez', secretario: 'Ana Soto',
  // Un acta que anota acuerdos anota también con cuánta gente se tomaron: sin
  // esto, el aviso del quórum de la v1.280.0 sale en cada fixture y tapa lo que
  // estas pruebas vienen a mirar.
  total_asistentes: 120, ...cambios,
});

/** Un acta ya firmada, con algo escrito adentro. */
async function unaFirmada(api, cambios) {
  const e = unaIglesia();
  const r = await unActa(api, e, {
    estado: 'Firmada', acuerdos: '<p>Se aprueba la compra del terreno por 118 votos.</p>', ...cambios,
  });
  assert.equal(r.estado, 201, r.texto);
  return { e, id: r.json.id };
}

test('un acta de asamblea firmada no se cambia sin decirlo', async () => {
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const r = await api('PUT', `/actas_asambleas/${id}`, { acuerdos: '<p>Se rechaza la compra.</p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_firmada');
});

test('y el aviso dice quién la firmó, cuándo, y qué va a cambiar', async () => {
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const r = await api('PUT', `/actas_asambleas/${id}`, { acuerdos: '<p>Se rechaza la compra.</p>' });
  const dice = r.json.error;
  assert.match(dice, /está firmada por /, 'sin quién la firmó, no se puede contestar la pregunta');
  assert.match(dice, /\d{2}-\d{2}-\d{4}/, 'ni sin cuándo');
  assert.match(dice, /Va a cambiar Acuerdos y resoluciones/, 'y tiene que decir QUÉ cambia');
  assert.match(dice, /Registro de Cambios/);
});

test('sacarle la firma avisa distinto, y eso va primero', async () => {
  /*
   * Dejar de estar firmada es lo más grave que puede pasarle, así que ese aviso
   * manda por sobre el de los demás cambios: el resto queda de añadidura.
   */
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const r = await api('PUT', `/actas_asambleas/${id}`, { estado: 'Borrador', lugar: 'Otro salón' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /Va a dejar de estarlo/);
  assert.match(r.json.error, /se borra la constancia de quién la firmó/);
  assert.match(r.json.error, /Además cambia Lugar/, 'lo otro que cambia va como añadidura');
  assert.doesNotMatch(r.json.error, /Además cambia .*Estado/, 'el estado ya lo dijo la primera frase');
});

test('confirmando, se guarda', async () => {
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const r = await api('PUT', `/actas_asambleas/${id}`, {
    acuerdos: '<p>Se rechaza la compra.</p>', igual_asi: true });
  assert.equal(r.estado, 200);
  const g = await api('GET', `/actas_asambleas/${id}`);
  assert.match(String(g.json.acuerdos), /Se rechaza/);
});

test('al pasar a firmada queda anotado quién y qué día', async () => {
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const g = await api('GET', `/actas_asambleas/${id}`);
  assert.ok(g.json.firmada_por, 'no quedó quién la firmó');
  assert.match(String(g.json.fecha_firma), /^\d{4}-\d{2}-\d{2}$/);
});

test('y al dejar de estarlo, los dos se borran', async () => {
  /*
   * Un acta que volvió a borrador y que siguiera diciendo «la firmó Fulana el
   * 25 de agosto» estaría mintiendo, y de las dos mentiras posibles ésa es la
   * peligrosa: la otra —no decir nada— se nota.
   */
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  await api('PUT', `/actas_asambleas/${id}`, { estado: 'Borrador', igual_asi: true });
  const g = await api('GET', `/actas_asambleas/${id}`);
  assert.equal(g.json.firmada_por, null);
  assert.equal(g.json.fecha_firma, null);
});

test('guardar otra vez un acta ya firmada no vuelve a estampar la fecha', async () => {
  /*
   * La firma ocurrió el día que ocurrió. Re-escribirla en cada guardado
   * convertiría el dato en «la última vez que alguien tocó esta ficha», que es
   * otra cosa y que ya lleva el Registro de Cambios.
   */
  const api = await elSistemaAndando();
  const { id } = await unaFirmada(api);
  const antes = (await api('GET', `/actas_asambleas/${id}`)).json;
  db.prepare('UPDATE actas_asambleas SET fecha_firma = ? WHERE id = ?').run('2020-01-01', id);
  await api('PUT', `/actas_asambleas/${id}`, { lugar: 'Templo Central', igual_asi: true });
  const despues = (await api('GET', `/actas_asambleas/${id}`)).json;
  assert.equal(despues.fecha_firma, '2020-01-01', 'se volvió a estampar, y no debía');
  assert.equal(despues.firmada_por, antes.firmada_por);
});

test('un acta que no está firmada se cambia sin que nadie pregunte', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { estado: 'Borrador', agenda: '1. Lo de siempre' });
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { acuerdos: '<p>Se acuerda.</p>' });
  assert.equal(g.estado, 200, 'preguntar por un borrador enseña a apretar «guardar igual» sin leer');
});

test('la constancia de la firma no se puede escribir a mano', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {
    estado: 'Borrador', agenda: 'x', firmada_por: 'Alguien Que No Firmó', fecha_firma: '1999-01-01' });
  const g = await api('GET', `/actas_asambleas/${r.json.id}`);
  assert.equal(g.json.firmada_por, null, 'son de solo lectura: los escribe el sistema');
  assert.equal(g.json.fecha_firma, null);
});

test('borrar un acta de asamblea pregunta, y dice de quién es y qué trae', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {
    estado: 'Firmada', agenda: '1. Venta del inmueble',
    desarrollo: '<p>Se debatió largamente.</p>',
    acuerdos: '<p>Se aprueba la venta por 118 votos a favor.</p>' });
  const d = await api('DELETE', `/actas_asambleas/${r.json.id}`);
  assert.equal(d.estado, 400);
  assert.equal(d.json.confirmar, 'acta_que_se_borra');
  assert.match(d.json.error, /de la asamblea ordinaria de Iglesia asamblea/, 'de qué congregación es');
  assert.match(d.json.error, /está FIRMADA por /, 'y en qué estado se va');
  assert.match(d.json.error, /Trae su agenda, el desarrollo escrito y los acuerdos/);
  assert.match(d.json.error, /el libro de esa congregación, en cambio, queda sin ella/);
  // Y no repite lo que el navegador ya preguntó en su primer «¿Eliminar?»
  assert.doesNotMatch(d.json.error, /no se puede deshacer/i);
});

test('y lo que el acta decía queda copiado en el Registro de Cambios', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {
    estado: 'Firmada', lugar: 'Templo Central', total_asistentes: 120,
    agenda: '1. Venta del inmueble',
    desarrollo: '<p>Se debatió largamente.</p>',
    acuerdos: '<p>Se aprueba la venta por 118 votos a favor.</p>' });
  await api('DELETE', `/actas_asambleas/${r.json.id}?igual_asi=true`);

  const anotado = db.prepare(
    "SELECT detalle FROM registro_cambios WHERE modulo = 'Actas de Asambleas' AND accion = 'Eliminación'"
    + ' ORDER BY id DESC LIMIT 1').get();
  assert.ok(anotado, 'no quedó anotada la eliminación');
  const dice = anotado.detalle || '';
  assert.match(dice, /118 votos a favor/, 'la decisión de la asamblea es lo que hay que conservar');
  assert.match(dice, /Venta del inmueble/, 'y su agenda');
  assert.match(dice, /Se debatió largamente/, 'y el desarrollo');
  assert.match(dice, /Firmada por: /, 'y quién la firmó');
  assert.match(dice, /Templo Central/, 'y dónde fue');
});

test('una eliminación de un acta en blanco se dice distinto', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {});
  const d = await api('DELETE', `/actas_asambleas/${r.json.id}`);
  assert.match(d.json.error, /No tiene nada escrito ni adjunto/,
    'no es lo mismo una ficha recién creada que un acta escrita entera');
  assert.match(d.json.error, /en estado Borrador/);
});

test('los dos libros de actas usan las MISMAS reglas, no una copia de ellas', () => {
  /*
   * Ésta es la prueba que guarda la decisión de haberlas sacado afuera.
   *
   * La regla de la directiva se copió y hubo que arreglarla dos veces (v1.263.0
   * y v1.271.0). Si mañana alguien vuelve a escribir el aviso de la firma
   * adentro de uno de los dos módulos, el otro se queda atrás en silencio, y
   * eso no se nota hasta que alguien cambia un acta firmada y nadie le avisa.
   */
  const fs = require('fs');
  const path = require('path');
  const lee = (m) => fs.readFileSync(path.join(__dirname, '../..', 'server/modules', m), 'utf8');
  for (const m of ['actas_reuniones.js', 'actas_asambleas.js']) {
    const src = lee(m);
    assert.match(src, /require\('\.\.\/acta-firmada'\)/, `${m} no usa el compartido`);
    assert.doesNotMatch(src, /function avisoDeActaFirmada/, `${m} volvió a escribir el aviso por su cuenta`);
    assert.doesNotMatch(src, /function anotarLaFirma/, `${m} volvió a escribir la constancia por su cuenta`);
  }
  // Y los dos declaran los mismos campos de la firma, con el mismo tipo
  const campos = (n) => require(`../../server/modules/${n}`).fields
    .filter((f) => f.name === 'firmada_por' || f.name === 'fecha_firma')
    .map((f) => `${f.name}:${f.type}:${f.readonly ? 'ro' : 'rw'}`);
  assert.deepEqual(campos('actas_asambleas'), campos('actas_reuniones'));
  assert.deepEqual(campos('actas_asambleas'), ['firmada_por:text:ro', 'fecha_firma:date:ro']);
});
