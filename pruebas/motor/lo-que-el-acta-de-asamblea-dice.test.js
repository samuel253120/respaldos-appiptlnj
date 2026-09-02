/**
 * Lo que el acta de asamblea dice: con qué se escribe, y qué queda guardado.
 *
 * El acta de una asamblea general es el documento más formal que este sistema
 * levanta —en una asamblea se elige directiva, se aprueban los estados
 * financieros y se autoriza vender un inmueble— y sus tres campos largos eran
 * cajas de texto pelado: sin formato, sin poder traer lo que ya estaba escrito
 * en el documento adjunto, y sobre todo SIN LIMPIAR.
 *
 * Lo último es lo que pesaba. La hoja impresa arma el acta poniendo adentro lo
 * guardado, así que un campo que nadie limpia y que la hoja no escapa convierte
 * lo que alguien escribe en el código de la hoja. Se midió en la v1.277.0: un
 * acta cuyos «Acuerdos» llevaban una caja con posición y fondo propios se
 * imprimía como un acta completa distinta, con otro número y otro acuerdo,
 * tapando el membrete, la fecha y el sello de «BORRADOR». No hacía falta código
 * para eso: la política de contenido del sistema no deja ejecutar nada, pero sí
 * permite estilos escritos en la etiqueta.
 *
 * Se cerró por los dos lados, y a propósito:
 *
 *   al GUARDAR ...... el desarrollo y los acuerdos pasan a ser texto con
 *                     formato, y eso los hace pasar por server/textorico.js
 *   al IMPRIMIR ..... la hoja escapa todo campo que no sea de texto con
 *                     formato, mirando el tipo declarado en el módulo
 *
 * Con una sola de las dos bastaría hoy. Con las dos, un campo largo que mañana
 * se agregue entra por el lado seguro sin que nadie se acuerde de esto.
 *
 * Acá se comprueba el lado del servidor y el del módulo. Lo que pasa EN LA HOJA
 * se comprueba en pruebas/documentos-impresos.js, con un navegador de verdad y
 * el medio de impresión puesto: leyendo el código no se distingue el texto que
 * se escapa del que se pinta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** La caja que tapaba la hoja entera, tal como se midió. */
const CAJA = '<div style="position:absolute;inset:0;background:#fff;z-index:99;padding:80px">'
  + '<h1>ACTA DE ASAMBLEA N.º FALSA-001</h1>'
  + '<p>Se acordo por unanimidad la venta del inmueble.</p></div>';

/** Una iglesia propia de esta prueba, para no pisar a las demás. */
function unaIglesia() {
  const m = marca();
  const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia asamblea ${m}`, `ASA${m}`).lastInsertRowid;
  return { m, iglesia: id };
}

const unActa = (api, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `ASA-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-04-10', tipo: 'Ordinaria', iglesia_id: e.iglesia, ...cambios,
});

const elModulo = () => require('../../server/modules/actas_asambleas');
const tipoDe = (nombre) => (elModulo().fields.find((f) => f.name === nombre) || {}).type;

test('el desarrollo y los acuerdos del acta de asamblea son de texto con formato', () => {
  assert.equal(tipoDe('desarrollo'), 'richtext');
  assert.equal(tipoDe('acuerdos'), 'richtext');
});

test('y por eso lo que se guarda en ellos llega limpio, sin un solo atributo', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { acuerdos: `Se acuerda lo de siempre. ${CAJA}` });
  assert.equal(r.estado, 201);
  const g = await api('GET', `/actas_asambleas/${r.json.id}`);
  const guardado = String(g.json.acuerdos || '');
  assert.doesNotMatch(guardado, /style\s*=/i, 'el estilo es por donde entra la caja que tapa');
  assert.doesNotMatch(guardado, /<[a-z]+\s+[a-z-]+\s*=/i, 'ninguna etiqueta puede llevar atributos');
  assert.doesNotMatch(guardado, /<h1/i, 'un título de nivel uno le pondría otro título a la hoja');
  assert.match(guardado, /Se acuerda lo de siempre/, 'y lo que la persona escribió se conserva');
});

test('lo mismo por el desarrollo, que es el otro campo que se escribe', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { desarrollo: `Se debatio. ${CAJA}` });
  const g = await api('GET', `/actas_asambleas/${r.json.id}`);
  assert.doesNotMatch(String(g.json.desarrollo || ''), /style\s*=|<h1/i);
});

test('el formato de verdad sí se conserva: párrafos, negrita y listas', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { desarrollo: '<p>Se debatió <b>largamente</b>.</p><ul><li>Uno</li></ul>' });
  const g = await api('GET', `/actas_asambleas/${r.json.id}`);
  const guardado = String(g.json.desarrollo || '');
  for (const etiqueta of ['<p>', '<b>', '<ul>', '<li>']) {
    assert.ok(guardado.includes(etiqueta), `se perdió ${etiqueta}: sin formato no se escribe un acta`);
  }
});

test('la agenda sigue siendo texto pelado, y se guarda tal cual se escribe', async () => {
  /*
   * No es un olvido: la agenda es una lista de puntos y no necesita formato, y
   * lo correcto para un campo de texto es guardar lo que la persona escribió y
   * escaparlo donde se muestre. Lo que cambió es que la hoja impresa ahora lo
   * escapa; limpiarlo al guardar sería guardar algo distinto de lo escrito, y
   * se notaría el día que alguien exporte la planilla o lea el respaldo.
   */
  assert.equal(tipoDe('agenda'), 'textarea');
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { agenda: `Punto 1 ${CAJA}` });
  const g = await api('GET', `/actas_asambleas/${r.json.id}`);
  assert.match(String(g.json.agenda), /style\s*=/i, 'lo escrito se guarda entero, y se escapa al mostrarlo');
});

test('la hoja impresa decide por el tipo declarado y no por una lista escrita a mano', () => {
  /*
   * Una lista de nombres de campo escrita en la impresión se olvida cuando el
   * módulo cambia, y el olvido acá no se nota: se nota como una hoja que se
   * puede fabricar. Se comprueba que mira el tipo, que lo que no es texto con
   * formato pasa por esc(), y que las tres partes largas del acta salen por ahí
   * y no por otro lado.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../..', 'public/app.js'), 'utf8');
  const desde = app.indexOf('const loQueDiceElActa');
  assert.ok(desde > 0, 'no está el que arma lo que el acta dice en la hoja');
  const bloque = app.slice(desde, app.indexOf('\n  };', desde));
  assert.match(bloque, /f\.type === 'richtext'/, 'tiene que mirar el tipo declarado del campo');
  assert.match(bloque, /esc\(valor\)/, 'y lo que no lo sea tiene que ir escapado');
  for (const campo of ['agenda', 'desarrollo', 'acuerdos']) {
    assert.match(app, new RegExp(`loQueDiceElActa\\('${campo}'`), `«${campo}» no pasa por ahí`);
  }
});

test('el acta de asamblea puede traer el texto de su documento adjunto', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { agenda: 'Punto 1' });
  const t = await api('POST', `/actas_asambleas/${r.json.id}/transcribir`);
  /*
   * Sin adjunto contesta 400 y lo explica. Lo que se comprueba acá es que la
   * ruta EXISTE para este módulo: antes contestaba 404 —estaba escrita solo
   * para las actas de reunión— y el acta de asamblea, que es la que más llega
   * escaneada, había que escribirla de nuevo entera a mano.
   */
  assert.notEqual(t.estado, 404, 'la ruta no existe para las asambleas');
  assert.equal(t.estado, 400);
  assert.match(t.json.error, /documento adjunto/i);
});

test('y traer el texto de un acta de otra congregación no se puede', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { agenda: 'Punto 1' });

  const otra = unaIglesia();
  const num = `${91000000 + (process.pid % 8000000)}`;
  // Acotada por «iglesias», que es de donde sale el alcance: poner solo
  // «iglesia_id» la deja alcanzándolo todo, y la prueba pasaría por casualidad.
  const ajeno = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, iglesia_id, debe_cambiar_password)
     VALUES (?, ?, 'secretario', 1, ?, ?, 0)`
  ).run(`${num}-${require('../../server/rut').digitoVerificador(num)}`,
    `Secretaria de otra ${otra.m}`, JSON.stringify([otra.iglesia]), otra.iglesia).lastInsertRowid;

  const comoElla = comoOtroUsuario(ajeno);
  const t = await comoElla('POST', `/actas_asambleas/${r.json.id}/transcribir`);
  assert.ok(t.estado === 403 || t.estado === 404, `contestó ${t.estado}: el alcance tiene que frenarlo`);
});
