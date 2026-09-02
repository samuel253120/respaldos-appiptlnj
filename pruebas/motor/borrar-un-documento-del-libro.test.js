/**
 * BORRAR UN DOCUMENTO NO PREGUNTABA, Y SE LLEVABA LO QUE DECÍA.
 *
 * MEDIDO en la v1.285.0, sobre una denuncia de la Superintendencia con su
 * número de origen, cuarenta folios, su descripción, sus observaciones y el
 * papel escaneado adentro:
 *
 *   DELETE, sin confirmar nada .......... 200 · {"ok":true}
 *   lo que dijo el servidor ............. nada
 *   campos que quedaron anotados ........ 7, todos de cabecera
 *   el escaneo, en el servidor .......... borrado
 *
 * La única barrera era el «¿Eliminar este registro?» del navegador, el mismo
 * que sale al borrar un tipo de actividad. Y de los siete campos anotados
 * ninguno decía quién lo mandaba, con qué número venía ni qué decía: de un
 * oficio, exactamente las tres cosas que hay que poder demostrar después.
 *
 * El módulo YA SABÍA que esto importaba. Su ayuda de permisos dice, con estas
 * palabras, que «borrar uno deja un hueco en el libro: para eso está el estado
 * Archivado». Lo decía en la pantalla de permisos, donde lo lee quien reparte
 * llaves, y no en el momento de borrar.
 *
 * Lo que cuida este archivo:
 *   · que se pregunte antes, y que la pregunta diga de qué documento se trata
 *   · que nombre lo propio de este módulo: el hueco en el correlativo
 *   · que lo interno, que no lleva número, no diga que abre un hueco
 *   · que confirmando sí se borre
 *   · que lo que decía quede copiado, incluido el nombre del escaneo
 *   · y que la negativa que ya existía —el documento que otros responden—
 *     siga siendo una negativa y no una pregunta
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { getModule } = require('../../server/registry');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `BR${m}`.slice(0, 18)).lastInsertRowid;
}

/** Un oficio completo, del que hay algo que perder. */
async function unaDenuncia(api, iglesia, mas = {}) {
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: iglesia, numero: `REC-777-${m}`,
    titulo: 'Denuncia de la Superintendencia', remitente: 'Superintendencia',
    folios: 40, referencia: 'Of. 1234/2026', medio: 'Correo postal',
    descripcion: 'Detalle largo de los cargos formulados, con plazos y montos.',
    etiquetas: 'legal, urgente', observaciones: 'Se avisó al abogado el mismo día.',
    plazo: '2026-10-01', estado: 'En trámite', ...mas,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

/* --------------------------------------------------- que pregunte ------- */

test('borrar un documento pregunta antes, y no se borra', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unaDenuncia(api, iglesia);

  const r = await api('DELETE', `/documentos/${doc.id}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'documento_que_se_borra');

  const sigue = await api('GET', `/documentos/${doc.id}`);
  assert.equal(sigue.estado, 200, 'preguntar no es borrar');
});

test('la pregunta dice de qué documento se trata y de quién venía', async () => {
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const { json } = await api('DELETE', `/documentos/${doc.id}`);

  assert.match(json.error, new RegExp(`el documento n\\.º ${doc.numero}`));
  assert.match(json.error, /de Superintendencia/);
});

test('y dice qué trae adentro, para que se sepa qué se está perdiendo', async () => {
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const { json } = await api('DELETE', `/documentos/${doc.id}`);

  assert.match(json.error, /Of\. 1234\/2026/, 'el número con que venía');
  assert.match(json.error, /40 folio/);
  assert.match(json.error, /la descripción/);
  assert.match(json.error, /las observaciones/);
  assert.match(json.error, /Lo que decía queda copiado en el Registro de Cambios/);
});

test('una ficha en blanco lo dice, en vez de enumerar nada', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const creado = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), numero: `REC-001-${m}`, titulo: 'Carta pelada',
  });
  assert.equal(creado.estado, 201);
  const { json } = await api('DELETE', `/documentos/${creado.json.id}`);
  assert.match(json.error, /No tiene nada escrito ni adjunto/);
});

test('y avisa del trámite abierto y de su plazo, que es lo que hace pensar dos veces', async () => {
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const { json } = await api('DELETE', `/documentos/${doc.id}`);
  assert.match(json.error, /Está «En trámite»/);
  assert.match(json.error, /plazo para responder el 01-10-2026/);
});

/* ------------------------------------------ el hueco en el correlativo -- */

test('nombra el hueco que deja en el libro, y la salida que el módulo recomienda', async () => {
  /*
   * Es lo propio de este módulo, y lo único que esta pregunta sabe y el
   * «¿está seguro?» del navegador no: un acta que se borra deja un libro sin
   * ella; un documento numerado deja además un hueco en un correlativo, que es
   * lo único que un libro de partes tiene para demostrar que no falta nada.
   */
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const { json } = await api('DELETE', `/documentos/${doc.id}`);
  assert.match(json.error, /hueco en el correlativo/);
  assert.match(json.error, /«Archivado»/);
});

test('pero lo interno no lleva número, y no dice que abra ninguno', async () => {
  const api = await elSistemaAndando();
  const creado = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: 'Escritura del templo', tipo: 'Escritura / Propiedad',
  });
  assert.equal(creado.estado, 201);
  const { json } = await api('DELETE', `/documentos/${creado.json.id}`);
  assert.match(json.error, /un documento sin número/);
  assert.match(json.error, /no queda con ningún hueco/);
  assert.ok(!/hueco en el correlativo/.test(json.error),
    'decir lo mismo para las dos cosas sería dejar de informar');
});

/* ------------------------------------------------- que se pueda borrar -- */

test('confirmando, se borra', async () => {
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const r = await api('DELETE', `/documentos/${doc.id}?igual_asi=true`);
  assert.equal(r.estado, 200);
  assert.equal((await api('GET', `/documentos/${doc.id}`)).estado, 404);
});

/* --------------------------------------------- lo que queda anotado ----- */

test('lo que decía queda copiado, y no solo la cabecera', async () => {
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  await api('DELETE', `/documentos/${doc.id}?igual_asi=true`);

  const fila = db.prepare(
    "SELECT detalle FROM registro_cambios WHERE modulo = 'Oficina de Partes' AND accion = 'Eliminación' ORDER BY id DESC LIMIT 1"
  ).get();
  assert.ok(fila, 'la eliminación queda anotada');

  for (const dato of ['Superintendencia', 'Of. 1234/2026', '40', 'Detalle largo de los cargos',
    'Se avisó al abogado', 'legal, urgente', '01-10-2026']) {
    assert.ok(fila.detalle.includes(dato), `falta en la constancia: «${dato}»`);
  }
});

test('y ninguno sale dos veces', async () => {
  /*
   * La constancia junta los campos del LISTADO con los que el módulo pide
   * conservar, y un campo puede estar en las dos listas. Acá pasa con el
   * escaneo, y casi obligadamente: los adjuntos no entran solos en la
   * constancia, así que un módulo que lo muestra en su listado y además quiere
   * su nombre al borrar tiene que nombrarlo dos veces. Salía repetido.
   *
   * El documento se crea acá y CON ESCANEO, y se busca su propia línea. La
   * primera versión de esta prueba miraba el último borrado que hubiera —que
   * no tenía adjunto—, así que el único campo que se repetía no estaba: romper
   * el arreglo a propósito no la ponía roja. Se comprobó.
   */
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  db.prepare('UPDATE documentos SET archivo = ? WHERE id = ?').run('repetido.pdf', doc.id);
  await api('DELETE', `/documentos/${doc.id}?igual_asi=true`);

  const fila = db.prepare(
    "SELECT detalle FROM registro_cambios WHERE modulo = 'Oficina de Partes'"
    + " AND accion = 'Eliminación' AND registro LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`%${doc.numero}%`);
  assert.ok(fila, `se encontró la constancia de ${doc.numero}`);
  assert.match(fila.detalle, /repetido\.pdf/, 'y es la de un documento CON escaneo');

  const etiquetas = fila.detalle.split(' · ').map((x) => x.split(':')[0]);
  const repetidos = etiquetas.filter((e, i) => etiquetas.indexOf(e) !== i);
  assert.deepEqual(repetidos, []);
});

test('el nombre del escaneo se conserva, que es lo único que queda de él', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unaDenuncia(api, iglesia);
  // El archivo se anota directo en la base: subirlo de verdad no es lo que se
  // está probando, y el módulo comprueba que exista antes de aceptarlo.
  db.prepare('UPDATE documentos SET archivo = ? WHERE id = ?').run('escaneo-denuncia.pdf', doc.id);

  const { json } = await api('DELETE', `/documentos/${doc.id}`);
  assert.match(json.error, /el documento escaneado/);
  assert.match(json.error, /El escaneo se borra del servidor junto con él/);

  await api('DELETE', `/documentos/${doc.id}?igual_asi=true`);
  const fila = db.prepare(
    "SELECT detalle FROM registro_cambios WHERE modulo = 'Oficina de Partes' AND accion = 'Eliminación' ORDER BY id DESC LIMIT 1"
  ).get();
  assert.match(fila.detalle, /escaneo-denuncia\.pdf/);
});

test('el módulo declara qué conservar, y ahí están los que dicen algo', () => {
  const def = getModule('documentos');
  for (const cual of ['remitente', 'referencia', 'folios', 'descripcion', 'observaciones', 'archivo']) {
    assert.ok(def.camposAlBorrar.includes(cual), `falta ${cual} en camposAlBorrar`);
  }
});

/* ------------------------------------- la negativa sigue siendo negativa - */

test('el documento al que otros responden no se puede borrar, ni confirmando', async () => {
  /*
   * Esa regla ya existía y no es una pregunta: borrarlo dejaría esas respuestas
   * sin decir a qué contestan, y eso no lo arregla un «sí, igual». Se comprueba
   * que la pregunta nueva no la haya convertido en una advertencia saltable.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const m = marca();
  const recibido = await unaDenuncia(api, iglesia);
  const emitido = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: iglesia, numero: `EMI-001-${m}`,
    titulo: 'Respuesta a la denuncia', destinatario: 'Superintendencia',
    responde_a: recibido.id,
  });
  assert.equal(emitido.estado, 201);

  const sinConfirmar = await api('DELETE', `/documentos/${recibido.id}`);
  assert.equal(sinConfirmar.estado, 400);
  assert.match(sinConfirmar.json.error, /Márquelo como «Archivado»/);
  assert.equal(sinConfirmar.json.confirmar, undefined, 'es una negativa, no una pregunta');

  const confirmando = await api('DELETE', `/documentos/${recibido.id}?igual_asi=true`);
  assert.equal(confirmando.estado, 400, 'y confirmando tampoco');
  assert.equal((await api('GET', `/documentos/${recibido.id}`)).estado, 200);
});

/* ------------------------------- y cómo lo pregunta la pantalla --------- */

test('un borrado pregunta en la caja del navegador, y el texto sale entero del servidor', () => {
  /*
   * ESTA PRUEBA MIRA EL CÓDIGO, y está escrita después de equivocarse.
   *
   * La pantalla tiene una tabla —`COMO_SE_PREGUNTA`— con el título y el texto
   * de los dos botones de cada pregunta. Es fácil suponer que las preguntas de
   * BORRADO salen de ahí: había una escrita, la del acta, desde la v1.273.0.
   *
   * No salen. Esa tabla la lee `preguntarSiIgualVa`, que solo se llama al
   * GUARDAR. Un borrado va por `borrarPreguntando`, que usa la MISMA caja del
   * navegador con que se borra —y es una decisión escrita: no hay formulario
   * donde poner el aviso, porque se borra desde el listado—. Ahí los botones
   * son los del navegador y lo único que se agrega es «¿Eliminarlo igual?».
   *
   * Consecuencia para quien escriba un gancho de borrado: TODO lo que haya que
   * decir tiene que estar en el mensaje del servidor. Y la entrada del acta no
   * se leía nunca; al cerrar este hallazgo estuvo a punto de multiplicarse por
   * cuatro copiándola. Se quitaron todas.
   */
  const fs = require('fs');
  const path = require('path');
  const { modules } = require('../../server/registry');
  const todos = Array.isArray(modules) ? modules : Object.values(modules || {});
  assert.ok(todos.length > 20, `se recorren ${todos.length} módulos`);

  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  // 1 · el camino: un borrado pregunta con la caja del navegador
  const camino = app.slice(app.indexOf('async function borrarPreguntando'));
  const cuerpo = camino.slice(0, camino.indexOf('\n}\n') + 3);
  assert.match(cuerpo, /confirm\(/, 'la pregunta de borrado es la del navegador');
  assert.match(cuerpo, /¿Eliminarlo igual\?/, 'y lo único que agrega es eso');
  assert.match(cuerpo, /igual_asi=1/, 'y si contesta que sí, se manda de nuevo');

  // 2 · y por lo tanto, ninguna clave de borrado tiene por qué estar en la tabla
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA'), app.indexOf('const como = COMO_SE_PREGUNTA'));
  assert.ok(tabla.length > 500, 'se encontró la tabla de textos');
  const enLaTabla = new Set([...tabla.matchAll(/^ {4}([a-z_]+): \{/gm)].map((m) => m[1]));

  const muertas = [];
  let cuantas = 0;
  for (const def of todos) {
    const gancho = def.hooks && def.hooks.beforeDelete;
    if (!gancho) continue;
    for (const m of String(gancho).matchAll(/confirmar: '([a-z_]+)'/g)) {
      cuantas++;
      if (enLaTabla.has(m[1])) muertas.push(`${def.name} → ${m[1]}`);
    }
  }
  assert.ok(cuantas >= 4, `se encontraron ${cuantas} preguntas de borrado, y tiene que haber varias`);
  assert.deepEqual(muertas, [],
    'una clave de borrado en esa tabla no se lee nunca: lo que hay que decir va en el mensaje del servidor');
});

test('y por eso el mensaje del servidor se basta solo', async () => {
  /*
   * La otra cara de lo de arriba: como los botones son los del navegador, el
   * mensaje tiene que decir qué se va a perder SIN apoyarse en ningún título ni
   * en ningún rótulo de botón.
   */
  const api = await elSistemaAndando();
  const doc = await unaDenuncia(api, unaIglesia());
  const { json } = await api('DELETE', `/documentos/${doc.id}`);
  assert.match(json.error, /^Va a eliminar /, 'empieza diciendo qué va a pasar');
  assert.ok(json.error.length > 200, `y lo explica: mide ${json.error.length} caracteres`);
});
