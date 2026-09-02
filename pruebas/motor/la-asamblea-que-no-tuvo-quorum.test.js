/**
 * La asamblea que no tuvo quórum, y la que dice que sí sin decir con cuántos.
 *
 * El quórum es lo único que este libro tiene y el de reuniones no: la reunión de
 * un cuerpo no lo necesita, y una asamblea sí, porque es lo que decide si lo que
 * se acordó ahí vale. La casilla «¿Hubo quórum?» existía, venía marcada que sí
 * de fábrica, y no la miraba nadie.
 *
 * MEDIDO en la v1.279.0, todas con 201 y sin una palabra:
 *
 *   «no hubo quórum» + «Se aprueba la venta del inmueble
 *   por unanimidad» .............................................. 201
 *   «hubo quórum» + 0 asistentes ................................. 201
 *   «hubo quórum» + el total de asistentes en blanco .............. 201
 *
 * SE PREGUNTA Y NO SE IMPIDE, por dos razones. La primera: si un acuerdo tomado
 * sin quórum es nulo o solo anulable lo dicen los estatutos de la corporación,
 * no este programa. La segunda: hay un caso legítimo y frecuente —la asamblea
 * que se levanta por falta de quórum, y de la que igual se levanta acta— que
 * quedaría prohibido por error.
 *
 * LO QUE ESTO NO HACE, y hay que decirlo: no CALCULA el quórum. El sistema sabe
 * cuántos miembros tiene cada iglesia, así que podría; lo que no sabe es cuánto
 * es el quórum ni sobre qué padrón se cuenta, y eso lo dicen los estatutos. Las
 * dos preguntas de acá son lo que se puede comprobar sin inventar esa regla: una
 * mira el acta contra sí misma, la otra mira lo que el acta afirma contra lo que
 * el acta trae escrito.
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
    .run(`Iglesia quórum ${m}`, `QUO${m}`).lastInsertRowid;
  return { m, iglesia: id };
}

const unActa = (api, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `QUO-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-04-25', tipo: 'Ordinaria', iglesia_id: e.iglesia, ...cambios,
});

test('sin quórum y con acuerdos escritos, se pregunta', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), {
    hubo_quorum: 0, total_asistentes: 8,
    acuerdos: '<p>Se aprueba la venta del inmueble por unanimidad.</p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'asamblea_sin_quorum');
  assert.match(r.json.error, /NO hubo quórum, y trae acuerdos escritos/);
  assert.match(r.json.error, /estatutos/, 'la consecuencia la dicen los estatutos, no el programa');
  assert.match(r.json.error, /deje los acuerdos en blanco/, 'y hay que decir qué hacer en vez de eso');
});

test('y confirmando se guarda, porque preguntar no es impedir', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), {
    hubo_quorum: 0, acuerdos: '<p>Se aprueba igual.</p>', igual_asi: true });
  assert.equal(r.estado, 201);
});

test('una asamblea que se levanta por falta de quórum no molesta a nadie', async () => {
  /*
   * Es el caso legítimo y el motivo de que esto pregunte en vez de prohibir: se
   * levanta acta de que no hubo quórum, sin acordar nada. Si esto avisara, el
   * aviso saldría en el caso correcto y enseñaría a apretar «guardar igual».
   */
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), {
    hubo_quorum: 0, total_asistentes: 8,
    desarrollo: '<p>Se levanta la sesión por falta de quórum.</p>' });
  assert.equal(r.estado, 201, r.texto);
});

test('unos acuerdos que solo traen etiquetas vacías no cuentan como acuerdos', async () => {
  /*
   * El campo es de texto con formato: al borrarlo todo, el editor puede dejar
   * «<p></p>». Eso es tan vacío como el blanco aunque no lo parezca, y si
   * contara, un acta sin quórum y sin acuerdos preguntaría por nada.
   */
  const api = await elSistemaAndando();
  for (const vacio of ['<p></p>', '<p><br></p>', '<p>&nbsp;</p>']) {
    const r = await unActa(api, unaIglesia(), { hubo_quorum: 0, acuerdos: vacio, agenda: 'x' });
    assert.equal(r.estado, 201, `con acuerdos = ${vacio}: ${r.texto}`);
  }
});

test('y de eso se encarga el motor, no este módulo', () => {
  /*
   * Esta regla tiene dueño: server/textorico.js vacía el texto con formato antes
   * de que el guardado llegue acá, por las dos puertas —la pantalla y la
   * importación de planillas—. Repetirla en el módulo sería escribirla dos veces
   * y arreglarla dos veces.
   *
   * Se comprueba en su dueño para que la de arriba no dependa de la casualidad:
   * si mañana el motor dejara de vaciarlo, ESTA se pone roja y dice dónde.
   */
  const { limpiar } = require('../../server/textorico');
  for (const vacio of ['<p></p>', '<p><br></p>', '<div><br/></div>', '<p>  </p>', '<p>&nbsp;</p>']) {
    assert.equal(limpiar(vacio), null, `«${vacio}» tendría que quedar en nada`);
  }
  assert.equal(limpiar('<p>Se aprueba.</p>'), '<p>Se aprueba.</p>', 'y lo escrito de verdad se conserva');
});

test('diciendo que hubo quórum con 0 asistentes, se pregunta', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), {
    hubo_quorum: 1, total_asistentes: 0, acuerdos: '<p>Se aprueba.</p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'quorum_sin_asistentes');
  assert.match(r.json.error, /anota 0 asistentes/);
});

test('y con el total de asistentes en blanco, también, pero lo dice distinto', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), { hubo_quorum: 1, acuerdos: '<p>Se aprueba.</p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'quorum_sin_asistentes');
  assert.match(r.json.error, /no dice cuántos asistieron/);
});

test('un acta recién creada, en blanco, NO pregunta nada del quórum', async () => {
  /*
   * Ésta es la prueba que evita el aviso que sale siempre.
   *
   * La casilla «¿Hubo quórum?» viene marcada que sí de fábrica, así que un acta
   * recién creada —lo único obligatorio es número, fecha, tipo e iglesia— dice
   * «hubo quórum» sin que nadie lo haya declarado, y todavía no dice con cuánta
   * gente porque todavía no dice nada. Medido con la primera versión de esta
   * regla, sin esta condición: TODA acta nueva preguntaba. Un aviso que sale
   * siempre enseña a apretar «guardar igual» sin leerlo, y entonces el día que
   * importe tampoco se lee.
   */
  const api = await elSistemaAndando();
  const enBlanco = await unActa(api, unaIglesia(), {});
  assert.equal(enBlanco.estado, 201, enBlanco.texto);

  // Y una que va por la mitad tampoco: todavía es un borrador que se está llenando
  const aMedias = await unActa(api, unaIglesia(), { agenda: '1. Lo de siempre', lugar: 'Templo' });
  assert.equal(aMedias.estado, 201, aMedias.texto);
});

test('pero un acta que dejó de ser borrador sí, aunque no tenga acuerdos', async () => {
  /*
   * Marcarla «Aprobada» o «Firmada» la convierte en un documento que alguien va
   * a leer. Ahí la contradicción pesa aunque los acuerdos todavía no estén
   * transcritos: el acta afirma que hubo quórum y no dice con cuánta gente.
   */
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), { estado: 'Aprobada', agenda: '1. Lo de siempre' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'quorum_sin_asistentes');
});

test('con quórum y con gente, no se pregunta nada', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(), {
    hubo_quorum: 1, total_asistentes: 120, acuerdos: '<p>Se aprueba.</p>' });
  assert.equal(r.estado, 201, r.texto);
});

test('el aviso mira cómo QUEDA el acta, no solo lo que cambia', async () => {
  /*
   * Un acta que ya estaba sin quórum y a la que recién ahora se le escriben los
   * acuerdos es el mismo caso. Mirando solo lo que trae la petición —que no
   * incluye la casilla, porque no cambió— se pasaría de largo.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, { hubo_quorum: 0, total_asistentes: 8, agenda: 'x' });
  assert.equal(r.estado, 201, r.texto);
  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { acuerdos: '<p>Se aprueba la venta.</p>' });
  assert.equal(g.estado, 400, 'la casilla no venía en la petición, y el acta queda igual de mal');
  assert.equal(g.json.confirmar, 'asamblea_sin_quorum');
});

test('un «0» escrito como texto no se lee como un sí', () => {
  /*
   * La casilla entra por tres puertas —el formulario, la API y la importación de
   * planillas— y no todas mandan lo mismo. Un «0» de texto es VERDADERO en
   * JavaScript, así que leído sin cuidado, un acta que una planilla trae sin
   * quórum se guardaría como si lo hubiera tenido.
   *
   * De normalizarlo se encarga el motor antes de llegar al módulo (`coerce` en
   * server/crud.js), y por eso se comprueba ahí: es donde vive la regla.
   */
  const { coerce } = require('../../server/crud');
  const campo = { name: 'hubo_quorum', type: 'boolean' };
  for (const si of [1, '1', true, 'true']) assert.equal(coerce(campo, si), 1, `${JSON.stringify(si)} es un sí`);
  for (const no of [0, '0', false, 'false']) assert.equal(coerce(campo, no), 0, `${JSON.stringify(no)} es un no`);
});

test('y con la casilla ya normalizada, las dos reglas salen donde corresponde', async () => {
  const api = await elSistemaAndando();
  for (const valor of [1, '1', true]) {
    const r = await unActa(api, unaIglesia(), {
      hubo_quorum: valor, total_asistentes: 0, acuerdos: '<p>Se aprueba.</p>' });
    assert.equal(r.json.confirmar, 'quorum_sin_asistentes', `con hubo_quorum = ${JSON.stringify(valor)}`);
  }
  for (const valor of [0, '0', false]) {
    const r = await unActa(api, unaIglesia(), { hubo_quorum: valor, acuerdos: '<p>Se aprueba.</p>' });
    assert.equal(r.json.confirmar, 'asamblea_sin_quorum', `con hubo_quorum = ${JSON.stringify(valor)}`);
  }
});

test('las advertencias de un mismo guardado van juntas, numeradas y por gravedad', async () => {
  /*
   * La marca de «guardar igual» es UNA para toda la petición: preguntando de a
   * una, quien confirma la primera pasaría las demás sin haberlas leído.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia();
  const r = await unActa(api, e, {
    estado: 'Firmada', hubo_quorum: 1, total_asistentes: 120,
    acuerdos: '<p>Se aprueba.</p>', igual_asi: true });
  assert.equal(r.estado, 201, r.texto);

  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { hubo_quorum: 0, total_asistentes: 0 });
  assert.equal(g.estado, 400);
  assert.match(g.json.error, /^Hay dos cosas que revisar antes de guardar\./);
  assert.match(g.json.error, /\(1\) El acta n\.º .* está firmada/, 'el acta firmada va primero: es la más grave');
  assert.match(g.json.error, /\(2\) El acta dice que NO hubo quórum/);
  assert.equal(g.json.confirmar, 'acta_firmada', 'la marca es la de la primera');
});

test('la hoja impresa dice «sin quórum» donde se lee, y no en una fila cualquiera', () => {
  /*
   * El dato ya salía impreso, perdido en su fila de la tabla entre la hora y el
   * lugar. En una asamblea el quórum decide si lo acordado vale, y quien recibe
   * la hoja tiene que verlo antes de leer los acuerdos.
   *
   * Lo que la hoja dice es el HECHO y no su consecuencia: afirmar que un acuerdo
   * sin quórum es nulo sería decir algo que este sistema no sabe.
   *
   * Que se vea de verdad se comprueba en el navegador; acá se comprueba que la
   * regla esté escrita y conectada a la asamblea que corresponde.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../..', 'public/app.js'), 'utf8');
  const desde = app.indexOf('const avisoDelQuorum');
  assert.ok(desde > 0, 'no está el aviso del quórum en la hoja');
  const bloque = app.slice(desde, desde + 400);
  assert.match(bloque, /esAsamblea && !row\.hubo_quorum/, 'solo en una asamblea, y solo si no lo hubo');
  assert.match(bloque, /SIN QUÓRUM/);
  assert.doesNotMatch(bloque, /nulo|no valen|sin valor/i, 'la consecuencia la dicen los estatutos');
  assert.match(app, /\$\{avisoDelQuorum\}/, 'está escrito pero no se pone en la hoja');
});
