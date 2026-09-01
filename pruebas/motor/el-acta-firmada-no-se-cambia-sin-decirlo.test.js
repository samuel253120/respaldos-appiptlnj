/**
 * «Firmada» tiene que significar algo.
 *
 * Era una palabra que se elegía de un desplegable, como se elegiría un color, y
 * no tenía ninguna consecuencia. Medido en la v1.270.0, sobre el sistema
 * andando:
 *
 *   crear un acta directamente como «Firmada» ............... 201
 *   ya firmada, cambiarle los acuerdos de $2.000.000 a $9.000.000 ... 200
 *   y quedaron cambiados .................................... sí
 *   devolverla de «Firmada» a «Borrador» .................... 200
 *   ¿dice quién la firmó y qué día? ......................... no existe ese campo
 *
 * Un acta firmada es un documento que existe en papel. Que el registro diga una
 * cosa y el papel otra es el problema entero de llevar un libro de actas
 * digital. Lo que faltaba no era la huella —el Registro de Cambios ya anotaba
 * la edición con el texto del antes y el después— sino la PUERTA, y la
 * constancia de quién firmó.
 *
 * Se decidió preguntar y dejar seguir, que es lo que hace el resto del sistema:
 * una coma mal puesta en un acta firmada se arregla, pero no sin que quien lo
 * hace sepa qué está tocando.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { hoy } = require('../../server/fechas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia con un cuerpo, que es todo lo que un acta necesita. */
function unCuerpo() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `FIR${m}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${m}`, iglesia).lastInsertRowid;
  return { m, iglesia, cuerpo };
}

const unActa = (api, e, cambios) => api('POST', '/actas_reuniones', {
  numero_acta: `${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-03-15', cuerpo_id: e.cuerpo,
  acuerdos: '<p>Se aprueba comprar sillas por $2.000.000.</p>', ...cambios,
});

/** Como la manda la pantalla: la ficha entera, con lo que ya tenía cargado. */
async function comoElFormulario(api, id, cambios) {
  const ficha = (await api('GET', `/actas_reuniones/${id}`)).json;
  const cuerpo = { ...ficha, ...cambios };
  delete cuerpo.id;
  return api('PUT', `/actas_reuniones/${id}`, cuerpo);
}

const traer = (id) => db.prepare('SELECT * FROM actas_reuniones WHERE id = ?').get(id);

// ------------------------------------------- la firma queda por escrito ----

test('un acta que nace firmada anota quién la firmó y qué día', async () => {
  /*
   * No se pregunta al crearla: así es como se carga el libro viejo, que está
   * firmado hace años.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  assert.equal(a.estado, 201);
  const fila = traer(a.json.id);
  assert.ok(fila.firmada_por, 'tiene que decir quién');
  assert.equal(fila.fecha_firma, hoy(), 'y qué día');
});

test('un acta en borrador no lleva constancia de firma', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e);
  const fila = traer(a.json.id);
  assert.ok(!fila.firmada_por);
  assert.ok(!fila.fecha_firma);
});

test('firmar un borrador la anota, y no pregunta nada', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e);
  const r = await comoElFormulario(api, a.json.id, { estado: 'Firmada' });
  assert.equal(r.estado, 200, 'firmar es el paso normal: no hay nada que advertir');
  assert.ok(traer(a.json.id).firmada_por);
});

test('los dos campos de la firma son de solo lectura', () => {
  const campos = getModule('actas_reuniones').fields;
  for (const cual of ['firmada_por', 'fecha_firma']) {
    const f = campos.find((x) => x.name === cual);
    assert.equal(f.readonly, true, `${cual} lo escribe el sistema, no la persona`);
  }
});

test('los campos de la firma no abren una segunda sección', () => {
  /*
   * Se vio en pantalla y no en una prueba: poniéndole `seccion: 'Documento y
   * estado'` a «Firmada por» —el mismo título que ya había abierto el adjunto—
   * la ficha no metía los campos ahí, abría una SEGUNDA sección con el mismo
   * encabezado, y salía dos veces seguidas. Un campo continúa la sección del
   * último que la declaró: para entrar en una que ya está abierta hay que NO
   * nombrarla.
   */
  const campos = getModule('actas_reuniones').fields;
  const abre = campos.filter((f) => f.seccion === 'Documento y estado').map((f) => f.name);
  assert.deepEqual(abre, ['documento'], 'solo el adjunto la abre; los demás caen dentro');
  const orden = campos.map((f) => f.name);
  assert.ok(orden.indexOf('firmada_por') > orden.indexOf('documento'), 'y van después de ella');
});

// ------------------------------------------------- y la puerta que faltaba ----

test('cambiarle los acuerdos a un acta firmada pregunta antes', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });

  const r = await comoElFormulario(api, a.json.id, { acuerdos: '<p>Ahora son $9.000.000.</p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_firmada');
  assert.match(r.json.error, /está firmada/i);
  assert.match(r.json.error, /Acuerdos y compromisos/,
    'el aviso dice QUÉ cambia: «¿está seguro?» a secas no es información');
  assert.match(traer(a.json.id).acuerdos, /2\.000\.000/, 'y no se guardó nada');
});

test('confirmando, entra', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  const r = await comoElFormulario(api, a.json.id, { acuerdos: '<p>Ahora son $9.000.000.</p>', igual_asi: true });
  assert.equal(r.estado, 200, 'pregunta, no impide');
  assert.match(traer(a.json.id).acuerdos, /9\.000\.000/);
});

test('el aviso nombra todos los campos que cambian', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  const r = await comoElFormulario(api, a.json.id, { lugar: 'Otro salón', presidida_por: 'Otra persona' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /Lugar/);
  assert.match(r.json.error, /Presidida por/);
});

test('guardar un acta firmada SIN cambiarle nada no pregunta', async () => {
  /*
   * Éste es el que se rompe solo si la comparación cuenta de más. El formulario
   * manda «Asistentes (escritos a mano)» como lista vacía aunque en la base
   * esté en blanco, así que contando ese campo TODO guardado de un acta firmada
   * preguntaría, incluso uno que no cambia absolutamente nada, y la pregunta se
   * volvería ruido que la gente aprende a confirmar sin leer.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  const r = await comoElFormulario(api, a.json.id, {});
  assert.equal(r.estado, 200);
});

test('un acta en borrador se corrige sin que nadie pregunte', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e);
  const r = await comoElFormulario(api, a.json.id, { acuerdos: '<p>Otra cosa.</p>' });
  assert.equal(r.estado, 200, 'un borrador es para eso');
});

// --------------------------------------------- sacarle la firma es lo grave ----

test('sacarle la firma pregunta, y el aviso dice que se pierde la constancia', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });

  const r = await comoElFormulario(api, a.json.id, { estado: 'Borrador' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_firmada');
  assert.match(r.json.error, /va a dejar de estarlo/i,
    'dejar de estar firmada es lo más grave que puede pasarle: va adelante en el aviso');
  assert.match(r.json.error, /quién la firmó/i);
});

test('y confirmado, la constancia se borra con la firma', async () => {
  /*
   * Un acta en «Borrador» que siguiera diciendo «la firmó Fulana el 15 de
   * marzo» estaría mintiendo, y de las dos mentiras posibles ésa es la
   * peligrosa: la constancia da por cierto un acto que ya no se afirma.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  assert.ok(traer(a.json.id).firmada_por);

  const r = await comoElFormulario(api, a.json.id, { estado: 'Borrador', igual_asi: true });
  assert.equal(r.estado, 200);
  const fila = traer(a.json.id);
  assert.ok(!fila.firmada_por, 'no queda firmada por nadie');
  assert.ok(!fila.fecha_firma);
});

test('la fecha de la firma no se corre al corregir el acta después', async () => {
  /*
   * La firma se anota solo cuando el estado CAMBIA. Anotarla en cada guardado
   * movería la fecha de la firma al día de la última corrección, que es
   * exactamente el dato que no sirve.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada' });
  db.prepare("UPDATE actas_reuniones SET fecha_firma = '2020-01-31', firmada_por = 'La de antes' WHERE id = ?")
    .run(a.json.id);

  await comoElFormulario(api, a.json.id, { lugar: 'Otro salón', igual_asi: true });
  const fila = traer(a.json.id);
  assert.equal(fila.fecha_firma, '2020-01-31', 'la firma es de cuando se firmó');
  assert.equal(fila.firmada_por, 'La de antes');
});
