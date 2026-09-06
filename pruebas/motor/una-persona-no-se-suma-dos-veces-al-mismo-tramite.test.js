/**
 * La misma persona no se suma dos veces con el mismo papel a la misma solicitud.
 *
 * El módulo comprobaba con cuidado de qué registro sale cada persona, que la
 * ficha exista, y soltaba el enlace del lado que no corresponde. Lo que no
 * miraba era si esa persona YA ESTABA en esa solicitud.
 *
 * MEDIDO en la v1.431.0, la misma miembro con el mismo papel, tres veces:
 *
 *   POST /personas_solicitud {miembro_id: 1, relacion: 'Beneficiario'} ... 201
 *   POST /personas_solicitud {miembro_id: 1, relacion: 'Beneficiario'} ... 201
 *   POST /personas_solicitud {miembro_id: 1, relacion: 'Beneficiario'} ... 201
 *   la solicitud quedó con 3 personas, las tres «Rosa Díaz Fuentes»
 *   y la tramitación con la misma línea escrita tres veces
 *
 * Una solicitud de ayuda social se cuenta por las personas que alcanza: el
 * grupo familiar de una entrega es lo que decide de qué tamaño es. Con la misma
 * persona repetida, la pestaña miente sobre a cuánta gente llega el asunto, y la
 * tramitación se llena de líneas idénticas que tapan las que sí dicen algo. No
 * hace falta que nadie se equivoque a propósito: basta con dos personas
 * tramitando la misma solicitud, o con volver atrás en el navegador (SA-04).
 *
 * Las dos respuestas son distintas a propósito: mismo papel se RECHAZA —no es
 * un caso legítimo por ninguna vía, y confirmarlo dejaría dos filas idénticas
 * que después nadie sabe cuál borrar—; otro papel se PREGUNTA, porque pasa de
 * verdad y el sistema no está para discutírselo a quien tiene el expediente en
 * la mano.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let cuantos = 0;
const unRut = () => {
  const n = `${21000000 + (marca * 23 + cuantos++ * 6151) % 900000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Dos veces ${marca}`, `DV-${marca}`).lastInsertRowid;

const unMiembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run(nombres, `${apellidos} DV ${marca}`, unRut(), iglesia).lastInsertRowid;

const rosa = unMiembro('Rosa', 'Díaz');
const ana = unMiembro('Ana', 'Soto');

const unaSolicitud = (asunto) => db
  .prepare(
    `INSERT INTO solicitudes (fecha, iglesia_id, solicitante_tipo, miembro_id, tipo, asunto, estado)
     VALUES ('2026-09-06', ?, 'Miembro', ?, 'Otro', ?, 'Pendiente')`
  ).run(iglesia, rosa, `${asunto} ${marca}`).lastInsertRowid;

const sumar = (api, solicitud, miembro, relacion, extra = {}) => api('POST', '/personas_solicitud', {
  solicitud_id: solicitud, persona_tipo: 'Miembro', miembro_id: miembro, relacion, ...extra,
});

// ------------------------------------------- lo que se rechaza -------------

test('la misma persona con el mismo papel no entra dos veces', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Ayuda');

  const primera = await sumar(api, s, rosa, 'Beneficiario');
  assert.equal(primera.estado, 201, primera.texto.slice(0, 200));

  const segunda = await sumar(api, s, rosa, 'Beneficiario');
  assert.equal(segunda.estado, 400, 'se anotaba tres veces a la misma persona sin decir nada');
  assert.ok(!segunda.json.confirmar, 'y ésta no se confirma: no es un caso legítimo por ninguna vía');
  assert.match(segunda.json.error, /ya está en esta solicitud/);
  assert.match(segunda.json.error, /Beneficiario/, 'se dice con qué papel ya está');

  // Ni insistiendo
  const insistiendo = await sumar(api, s, rosa, 'Beneficiario', { igual_asi: true });
  assert.equal(insistiendo.estado, 400, 'confirmar no puede saltarse un rechazo');

  const cuantas = db
    .prepare('SELECT COUNT(*) AS n FROM personas_solicitud WHERE solicitud_id = ?').get(s).n;
  assert.equal(cuantas, 1, 'la solicitud alcanza a una persona, y eso es lo que dice');
});

test('da igual cómo se escriba el papel: «beneficiario» es el mismo que «Beneficiario»', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Tildes');
  assert.equal((await sumar(api, s, rosa, 'Cónyuge')).estado, 201);
  const otra = await sumar(api, s, rosa, '  conyuge ');
  assert.equal(otra.estado, 400, 'se compara sin tildes, sin mayúsculas y sin espacios de más');
  // Y RECHAZADA, no preguntada: si la comparación fuera literal, «conyuge» sería
  // otro papel y esto pasaría por la puerta de al lado con dos botones.
  assert.ok(!otra.json.confirmar, 'es el mismo papel escrito distinto, no un papel nuevo');
});

test('y dos veces sin papel anotado también es dos veces lo mismo', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Sin papel');
  assert.equal((await sumar(api, s, rosa, '')).estado, 201);
  const otra = await sumar(api, s, rosa, '');
  assert.equal(otra.estado, 400, otra.texto.slice(0, 200));
  assert.ok(!otra.json.confirmar, 'dos filas en blanco de la misma persona son la misma fila');
  assert.match(otra.json.error, /sin papel anotado/);
});

// ------------------------------------------- lo que se pregunta ------------

test('con OTRO papel se pregunta, y confirmando entra', async () => {
  /*
   * La misma persona puede ser cónyuge de quien se traslada y testigo del mismo
   * trámite. Eso existe, así que no se prohíbe: se dice lo que ya hay y se deja
   * contestar a quien tiene el expediente en la mano.
   */
  const api = await elSistemaAndando();
  const s = unaSolicitud('Dos papeles');
  assert.equal((await sumar(api, s, ana, 'Cónyuge')).estado, 201);

  const pregunta = await sumar(api, s, ana, 'Testigo');
  assert.equal(pregunta.estado, 400, pregunta.texto.slice(0, 200));
  assert.equal(pregunta.json.confirmar, 'esa_persona_ya_esta_en_la_solicitud', 'es pregunta, no negativa');
  assert.match(pregunta.json.error, /Cónyuge/, 'se dice con qué papel ya figura');

  const confirmada = await sumar(api, s, ana, 'Testigo', { igual_asi: true });
  assert.equal(confirmada.estado, 201, confirmada.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM personas_solicitud WHERE solicitud_id = ?').get(s).n, 2
  );
});

// ------------------------------------------- lo que no se toca -------------

test('dos personas distintas con el mismo papel no se estorban', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Grupo familiar');
  assert.equal((await sumar(api, s, rosa, 'Grupo familiar')).estado, 201);
  const otra = await sumar(api, s, ana, 'Grupo familiar');
  assert.equal(otra.estado, 201, 'un grupo familiar son varias personas con el mismo papel');
});

test('la misma persona en DOS solicitudes distintas tampoco se estorba', async () => {
  const api = await elSistemaAndando();
  const uno = unaSolicitud('Trámite uno');
  const dos = unaSolicitud('Trámite dos');
  assert.equal((await sumar(api, uno, rosa, 'Beneficiario')).estado, 201);
  const enLaOtra = await sumar(api, dos, rosa, 'Beneficiario');
  assert.equal(enLaOtra.estado, 201, 'la regla es por solicitud, no por persona');
});

test('corregirle la observación a una persona ya anotada no la choca consigo misma', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Corregir');
  const p = await sumar(api, s, rosa, 'Beneficiario');
  assert.equal(p.estado, 201, p.texto.slice(0, 200));
  const r = await api('PUT', `/personas_solicitud/${p.json.id}`, {
    observaciones: `Vive con su madre. ${marca}`,
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
});

test('y cambiarle el papel a la que ya está tampoco', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Cambiar papel');
  const p = await sumar(api, s, rosa, 'Beneficiario');
  const r = await api('PUT', `/personas_solicitud/${p.json.id}`, { relacion: 'Grupo familiar' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT relacion FROM personas_solicitud WHERE id = ?').get(p.json.id).relacion,
    'Grupo familiar'
  );
});

// ------------------------------------------- y la tramitación --------------

test('la tramitación deja de repetir la misma línea', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Tramitación');
  await sumar(api, s, rosa, 'Beneficiario');
  await sumar(api, s, rosa, 'Beneficiario'); // rechazada
  await sumar(api, s, rosa, 'Beneficiario'); // rechazada

  const lineas = db
    .prepare("SELECT descripcion FROM historial_solicitudes WHERE solicitud_id = ? AND descripcion LIKE 'Se sumó%'")
    .all(s);
  assert.equal(lineas.length, 1, `la tramitación quedó con ${lineas.length} líneas iguales`);
});
