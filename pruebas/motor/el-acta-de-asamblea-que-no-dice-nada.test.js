/**
 * El acta de asamblea que no dice nada, sus horas y su gente.
 *
 * Dos hallazgos chicos del libro de asambleas, que son los mismos que el libro
 * de reuniones cerró en la v1.274.0 y la v1.275.0 más uno propio.
 *
 * MEDIDO en la v1.280.0, las cuatro con 201 y sin una palabra:
 *
 *   un acta sin agenda, sin desarrollo, sin acuerdos
 *   y sin documento adjunto ...................... 201, y se imprime igual
 *   «empieza 21:00, termina 19:00» ............... 201
 *   «−50 asistentes» ............................. 201
 *   «999.999 asistentes» ......................... 201
 *
 * LAS REGLAS NO SE COPIARON. El acta vacía y las horas son idénticas en los dos
 * libros, así que se sacaron a server/reglas-del-acta.js junto con las de la
 * firma; lo único que cambia es cómo se llama la sesión en el aviso —«la
 * reunión», «la asamblea»—, y eso va por parámetro.
 *
 * LO DE LOS ASISTENTES ES PROPIO DE ACÁ, y tiene dos mitades. El PISO lo declara
 * el campo (`min: 0`) y lo hace cumplir el motor, que ya sabía: el mismo dato en
 * Servicios ya lo declaraba, así que no era una decisión de la organización sino
 * una línea que faltaba. El TECHO no se escribió a mano, porque un número grande
 * puesto a dedo no dice nada; el que sí dice algo lo tiene la base —cuántos
 * miembros tiene esa congregación— y con eso se pregunta en vez de prohibir.
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

/** Una iglesia con la cantidad de miembros que se le pida. */
function unaIglesia(cuantosMiembros = 0) {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia vacía ${m}`, `VAC${m}`).lastInsertRowid;
  const mete = db.prepare(
    "INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')");
  for (let i = 0; i < cuantosMiembros; i += 1) mete.run(`Persona${i}`, `De ${m}`, iglesia);
  return { m, iglesia };
}

const unActa = (api, e, cambios) => api('POST', '/actas_asambleas', {
  numero_acta: `VAC-${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-05-05', tipo: 'Ordinaria', iglesia_id: e.iglesia,
  total_asistentes: 10, ...cambios,
});

// --------------------------------------------- AS-05 · el acta vacía ----

test('un acta de asamblea que no dice nada se pregunta antes de guardarla', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(50), {});
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_sin_nada');
  assert.match(r.json.error, /no tiene agenda, ni desarrollo, ni acuerdos, ni documento adjunto/);
  assert.match(r.json.error, /membrete de la institución/, 'el motivo es lo que sale impreso');
});

test('se pregunta y no se rechaza: crear la ficha para adjuntar después es lo corriente', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(50), { igual_asi: true });
  assert.equal(r.estado, 201, r.texto);
});

test('con cualquiera de las tres cosas escritas, no molesta', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia(50);
  for (const campo of ['agenda', 'desarrollo', 'acuerdos']) {
    const r = await unActa(api, e, { [campo]: '<p>Algo dice.</p>' });
    assert.equal(r.estado, 201, `con «${campo}» escrito: ${r.texto}`);
  }
});

test('ni con el acta solo adjunta, sin una palabra escrita', async () => {
  /*
   * Es la mitad del motivo de que esto pregunte en vez de rechazar: un acta que
   * llega escaneada y se guarda tal cual es un acta completa.
   *
   * El adjunto se pone derecho en la base porque el motor comprueba que el
   * archivo exista de verdad en el servidor —lo hace bien, y no es lo que se
   * mira acá—; lo que se comprueba es que un acta CON adjunto y sin texto no
   * dispare el aviso.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia(50);
  const r = await unActa(api, e, { igual_asi: true });
  assert.equal(r.estado, 201, r.texto);
  db.prepare('UPDATE actas_asambleas SET documento = ? WHERE id = ?').run('acta-escaneada.pdf', r.json.id);

  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { lugar: 'Templo Central' });
  assert.equal(g.estado, 200, `el acta trae su escaneo y no dice nada: ${g.texto}`);
});

test('y vaciar un acta que decía algo se avisa distinto: eso es una pérdida', async () => {
  const api = await elSistemaAndando();
  const e = unaIglesia(50);
  const r = await unActa(api, e, { acuerdos: '<p>Se aprueba la venta.</p>' });
  assert.equal(r.estado, 201, r.texto);

  const g = await api('PUT', `/actas_asambleas/${r.json.id}`, { acuerdos: '' });
  assert.equal(g.estado, 400);
  assert.equal(g.json.confirmar, 'acta_sin_nada');
  assert.match(g.json.error, /decía algo y va a quedar sin nada/);
  assert.match(g.json.error, /Registro de Cambios/, 'y dónde queda lo que decía');
});

// ------------------------------------------------ AS-06 · las horas ----

test('las horas al revés se preguntan, y el aviso habla de una asamblea', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(50), {
    agenda: 'x', hora_inicio: '21:00', hora_fin: '19:00' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'horas_del_acta');
  assert.match(r.json.error, /la asamblea empezó a las 21:00 y terminó a las 19:00/);
  assert.doesNotMatch(r.json.error, /la reunión/, 'este libro no levanta actas de reuniones');
});

test('una asamblea que empieza y termina a la misma hora no duró nada', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(50), {
    agenda: 'x', hora_inicio: '10:00', hora_fin: '10:00' });
  assert.equal(r.json.confirmar, 'horas_del_acta');
  assert.match(r.json.error, /no duró nada/);
});

test('con una sola hora anotada no hay nada que comparar', async () => {
  /*
   * Muchas actas dicen a qué hora empezó la asamblea y no a qué hora terminó.
   * Preguntar por eso sería un aviso que sale casi siempre.
   */
  const api = await elSistemaAndando();
  const e = unaIglesia(50);
  for (const solo of [{ hora_inicio: '10:00' }, { hora_fin: '13:00' }]) {
    const r = await unActa(api, e, { agenda: 'x', ...solo });
    assert.equal(r.estado, 201, `${JSON.stringify(solo)}: ${r.texto}`);
  }
});

// ------------------------------------------- AS-06 · los asistentes ----

test('un total de asistentes negativo se rechaza, no se pregunta', async () => {
  /*
   * Acá no hay nada que confirmar: −50 personas no asistieron nunca a nada. Lo
   * hace cumplir el motor, que ya sabía —el mismo dato en Servicios lo declara—
   * y contesta con un aviso escrito para una persona.
   */
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(50), { agenda: 'x', total_asistentes: -50 });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, undefined, 'no se ofrece guardarlo igual');
  assert.match(r.json.error, /no puede ser negativo/);
});

test('el piso lo declara el campo, no una línea escondida en el gancho', () => {
  const def = require('../../server/modules/actas_asambleas');
  const campo = def.fields.find((f) => f.name === 'total_asistentes');
  assert.equal(campo.min, 0, 'sin el min declarado, el motor no tiene qué hacer cumplir');
});

test('más asistentes que miembros tiene la congregación se pregunta', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(40), { agenda: 'x', total_asistentes: 999999 });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'asistentes_que_no_caben');
  assert.match(r.json.error, /anota 999999 asistentes, y esa congregación tiene 40 miembros/);
  assert.match(r.json.error, /confirme y siga/, 'se pregunta, no se prohíbe: puede haber invitados');
});

test('y no se pregunta cuando el número cabe', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(40), { agenda: 'x', total_asistentes: 40 });
  assert.equal(r.estado, 201, r.texto);
});

test('una iglesia sin miembros inscritos no dispara el aviso', async () => {
  /*
   * Con cero miembros, «más asistentes que miembros» es verdad siempre, y una
   * congregación recién creada todavía no tiene a nadie inscrito. El aviso
   * saldría en todas sus asambleas y no diría nada.
   */
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(0), { agenda: 'x', total_asistentes: 120 });
  assert.equal(r.estado, 201, r.texto);
});

// ------------------------------------------------ todas juntas ----

test('las advertencias de un guardado siguen saliendo juntas y numeradas', async () => {
  const api = await elSistemaAndando();
  const r = await unActa(api, unaIglesia(40), {
    total_asistentes: 5000, hora_inicio: '21:00', hora_fin: '19:00' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /^Hay 3 cosas que revisar antes de guardar\./);
  assert.match(r.json.error, /\(1\) El acta anota 5000 asistentes/);
  assert.match(r.json.error, /\(2\) El acta dice que la asamblea empezó a las 21:00/);
  assert.match(r.json.error, /\(3\) Este acta no dice nada/);
});

test('los dos libros de actas comparten también estas dos reglas', () => {
  /*
   * La misma guardia que la de la firma: si alguien vuelve a escribir el acta
   * vacía o las horas adentro de uno de los dos módulos, el otro se queda atrás
   * en silencio.
   */
  const fs = require('fs');
  const path = require('path');
  for (const m of ['actas_reuniones.js', 'actas_asambleas.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', 'server/modules', m), 'utf8');
    assert.match(src, /loDelActaVacia/, `${m} no usa la regla del acta vacía`);
    assert.match(src, /loDeLasHoras/, `${m} no usa la regla de las horas`);
    assert.doesNotMatch(src, /function loDelActaVacia/, `${m} volvió a escribirla por su cuenta`);
    assert.doesNotMatch(src, /function loDeLasHoras/, `${m} volvió a escribirla por su cuenta`);
  }
  // Y cada uno le pasa el nombre que le corresponde a su sesión
  const lee = (m) => fs.readFileSync(path.join(__dirname, '../..', 'server/modules', m), 'utf8');
  assert.match(lee('actas_reuniones.js'), /loDeLasHoras\(data, existing, 'la reunión'\)/);
  assert.match(lee('actas_asambleas.js'), /loDeLasHoras\(data, existing, 'la asamblea'\)/);
});
