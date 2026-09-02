/**
 * La iglesia de un documento: mudarlo, y a qué puede contestar.
 *
 * Cada congregación lleva su propia oficina de partes, con su propio
 * correlativo. De ahí salen las dos cosas que este archivo fija, que son la
 * misma vista por sus dos caras:
 *
 *   OP-08  Mover un documento de una oficina a otra no preguntaba nada.
 *          MEDIDO en la v1.288.0: PUT {iglesia_id: la otra} → 200, sin una
 *          palabra. El número se iba con él al libro de otra oficina, dejando
 *          un hueco en el de origen y una anotación ajena en el de destino.
 *
 *   OP-09  Un emitido podía responder a un recibido de OTRA iglesia.
 *          MEDIDO en la v1.288.0: POST con responde_a de la otra → 201,
 *          enlazado. El hilo de la respuesta cruzaba dos libros.
 *
 * Y las dos juntas dan la tercera, que no estaba en el informe y aparece sola
 * en cuanto las dos primeras existen: si mudar arrastrara un enlace ya hecho,
 * la regla de OP-09 se saltaría por la puerta de atrás.
 *
 * El alcance NO es lo que se prueba acá: quien está acotado a una congregación
 * ya recibía 403 en las dos cosas, y eso sigue estando. Esto es para quien
 * alcanza las dos —un administrador de la corporación—, que sí debe poder
 * mover y por eso tiene que enterarse.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

/** Una iglesia recién hecha, con su nombre, para que su libro empiece vacío. */
function unaIglesia(quien = 'Oficina') {
  const m = marca();
  const nombre = `${quien} ${m}`;
  const id = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(nombre, `OP${m}`.slice(0, 18)).lastInsertRowid;
  return { id, nombre };
}

/** Un documento anotado por la API, que es como los anota una persona. */
async function unDocumento(api, campos) {
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', titulo: `Oficio ${marca()}`, numero: `REC-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

// ═══════════════════════════════════ OP-08 · mudar el documento de oficina ══

test('mover un documento a otra iglesia pregunta antes', async () => {
  const api = await elSistemaAndando();
  const desde = unaIglesia('Central');
  const hasta = unaIglesia('Norte');
  const doc = await unDocumento(api, { iglesia_id: desde.id, titulo: 'Oficio que se muda' });

  const r = await api('PUT', `/documentos/${doc.id}`, { iglesia_id: hasta.id });
  assert.equal(r.estado, 400, 'ya no se muda en silencio');
  assert.equal(r.json.confirmar, 'documento_que_cambia_de_iglesia');
});

test('y el aviso nombra las dos oficinas, el número y el hueco que deja', async () => {
  const api = await elSistemaAndando();
  const desde = unaIglesia('Central');
  const hasta = unaIglesia('Norte');
  const doc = await unDocumento(api, {
    iglesia_id: desde.id, numero: `REC-333-${marca()}`, titulo: 'Oficio con número',
  });

  const r = await api('PUT', `/documentos/${doc.id}`, { iglesia_id: hasta.id });
  assert.equal(r.estado, 400);
  assert.ok(r.json.error.includes(desde.nombre), 'dice de dónde sale');
  assert.ok(r.json.error.includes(hasta.nombre), 'y adónde va');
  assert.ok(r.json.error.includes(doc.numero), 'nombra el documento por su número');
  /*
   * Las dos frases enteras, y no un «hueco» suelto: la otra rama de este mismo
   * aviso —la de lo que no lleva correlativo— dice «ningún libro queda con un
   * hueco», así que buscar la palabra sola daba por buenas las dos. Se vio
   * rompiendo el aviso a propósito y comprobando que nadie lo notaba.
   */
  assert.match(r.json.error, /queda el hueco/, 'dice qué le pasa al libro de origen');
  assert.match(r.json.error, /no pasó por esa ventanilla/, 'y qué recibe el de destino');
  assert.match(r.json.error, /quién puede verlo/, 'y que cambia quién lo alcanza');
});

test('contestando que sí, se mueve', async () => {
  const api = await elSistemaAndando();
  const desde = unaIglesia('Central');
  const hasta = unaIglesia('Norte');
  const doc = await unDocumento(api, { iglesia_id: desde.id });

  const r = await api('PUT', `/documentos/${doc.id}`, { iglesia_id: hasta.id, igual_asi: true });
  assert.equal(r.estado, 200);
  assert.equal(Number(r.json.iglesia_id), Number(hasta.id), 'quedó en la otra oficina');
});

test('lo interno, que no lleva correlativo, avisa que no deja ningún hueco', async () => {
  /*
   * La misma pregunta no puede decir lo mismo para las dos cosas: un documento
   * de archivo no está en ningún correlativo, y prometer un hueco que no
   * existe es lo que hace que estos avisos dejen de leerse.
   */
  const api = await elSistemaAndando();
  const desde = unaIglesia('Central');
  const hasta = unaIglesia('Norte');
  const doc = await unDocumento(api, {
    flujo: 'Interno o de archivo', numero: undefined, iglesia_id: desde.id,
    titulo: 'Escritura del templo', tipo: 'Escritura / Propiedad',
  });
  assert.equal(doc.numero, null, 'no lleva número');

  const r = await api('PUT', `/documentos/${doc.id}`, { iglesia_id: hasta.id });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /ningún libro queda con un hueco/);
  assert.ok(!/queda el hueco/.test(r.json.error), 'y no promete uno que no hay');
});

test('guardar sin tocarle la iglesia no pregunta nada', async () => {
  /*
   * El contrapeso, y es lo que decide si el aviso sirve: una pregunta que sale
   * en cada guardado se aprieta sin leer. Se manda la MISMA iglesia a
   * propósito, que es lo que hace el formulario en cada edición.
   */
  const api = await elSistemaAndando();
  const suya = unaIglesia('Central');
  const doc = await unDocumento(api, { iglesia_id: suya.id });

  /*
   * La iglesia va como TEXTO a propósito: así la manda el formulario —el valor
   * de un desplegable es una cadena— y así llega en cada edición. Comparando
   * sin convertir, «12» y 12 son distintos y el sistema preguntaría por una
   * mudanza que nadie pidió, en todos los guardados.
   */
  const r = await api('PUT', `/documentos/${doc.id}`, {
    iglesia_id: String(suya.id), observaciones: 'Se derivó a secretaría',
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.observaciones, 'Se derivó a secretaría');
});

test('y crear uno nuevo tampoco: no viene de ningún libro', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia('Central');
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: suya.id, titulo: 'Oficio nuevo', numero: `REC-${marca()}`,
  });
  assert.equal(r.estado, 201);
});

// ═════════════════════════════ OP-09 · a qué puede contestar un emitido ══

test('un emitido no puede responder a un recibido de otra iglesia', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const ajeno = await unDocumento(api, {
    iglesia_id: norte.id, numero: `REC-900-${marca()}`, titulo: 'Oficio de la Norte',
  });

  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta que cruza',
    numero: `EMI-${marca()}`, responde_a: ajeno.id,
  });
  assert.equal(r.estado, 400, 'antes contestaba 201');
  assert.ok(r.json.error.includes(norte.nombre), 'dice de qué oficina es el otro');
  assert.ok(r.json.error.includes(central.nombre), 'y en cuál se está anotando éste');
  assert.match(r.json.error, /misma oficina/);
});

test('y no hay «guardar igual» que lo pase', async () => {
  /*
   * Es una negativa, no una pregunta: no hay manera de que un hilo que cruza
   * dos libros quede bien. Si esto se convirtiera en una confirmación, el
   * primero que la apretara dejaría el enlace cruzado igual.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const ajeno = await unDocumento(api, { iglesia_id: norte.id });

  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta que insiste',
    numero: `EMI-${marca()}`, responde_a: ajeno.id, igual_asi: true,
  });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, undefined, 'no se ofrece confirmarlo');
});

test('a uno de la misma oficina, sí', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const suyo = await unDocumento(api, { iglesia_id: central.id, titulo: 'Oficio recibido' });

  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta como corresponde',
    numero: `EMI-${marca()}`, responde_a: suyo.id,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(Number(r.json.responde_a), Number(suyo.id));
});

test('pero no a un emitido: lo que se contesta es lo que llegó', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const salido = await unDocumento(api, {
    flujo: 'Emitido', iglesia_id: central.id, numero: `EMI-${marca()}`, titulo: 'Carta enviada',
  });

  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta a lo propio',
    numero: `EMI-${marca()}`, responde_a: salido.id,
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no es un documento recibido/);
});

test('ni a sí mismo, que ya estaba y sigue', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const doc = await unDocumento(api, {
    flujo: 'Emitido', iglesia_id: central.id, numero: `EMI-${marca()}`, titulo: 'Carta sola',
  });

  const r = await api('PUT', `/documentos/${doc.id}`, { responde_a: doc.id });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /respuesta de sí mismo/);
});

test('un enlace a un documento que no existe lo para el motor, antes de esta regla', async () => {
  /*
   * ESTA PRUEBA ESCRIBE UNA GARANTÍA AJENA, y por eso está.
   *
   * La regla de más arriba lee el otro documento de la base y lo usa sin
   * preguntarse si vino vacío. Puede hacerlo porque el motor revisa las
   * referencias rotas ANTES de llamar al gancho del módulo. Se escribió
   * primero con un «por las dudas» y se sacó al comprobar que no había manera
   * de alcanzarlo: en vez de una rama que no se puede probar, queda esta
   * prueba, que es la que se pondría roja si ese orden cambiara.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta a la nada',
    numero: `EMI-${marca()}`, responde_a: 88888888,
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no existe/, 'y lo dice el motor, no el módulo');
});

test('si el flujo se lleva el enlace por delante, no se niega la mudanza por él', async () => {
  /*
   * El enlace que se mira es el que QUEDA, no el que llega. Un emitido que en
   * el mismo guardado pasa a «Interno o de archivo» pierde el «Responde al
   * documento» —no es un campo de ese flujo—, así que no queda ninguna
   * respuesta apuntando a ninguna parte y no hay nada que negar.
   *
   * Mirando el enlace de antes, esto contestaría «quítele el enlace primero»
   * para un enlace que este mismo guardado estaba quitando: una negativa
   * imposible de entender y de cumplir.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const recibido = await unDocumento(api, { iglesia_id: central.id });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'Respuesta que se archiva',
    numero: `EMI-${marca()}`, responde_a: recibido.id,
  });
  assert.equal(respuesta.estado, 201);

  const preguntando = await api('PUT', `/documentos/${respuesta.json.id}`, {
    flujo: 'Interno o de archivo', iglesia_id: norte.id, tipo: 'Escritura / Propiedad',
  });
  assert.equal(preguntando.estado, 400, 'pregunta, que es otra cosa que negarse');
  assert.ok(!/quitarle antes el enlace/.test(preguntando.json.error), 'y no pide quitar lo que ya se va');

  const r = await api('PUT', `/documentos/${respuesta.json.id}`, {
    flujo: 'Interno o de archivo', iglesia_id: norte.id, tipo: 'Escritura / Propiedad',
    igual_asi: true,
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(Number(r.json.iglesia_id), Number(norte.id));
  assert.ok(!r.json.responde_a, 'el enlace se fue con el flujo');
});

test('un enlace viejo mal hecho no bloquea corregir otra cosa del documento', async () => {
  /*
   * La regla mira SOLO EL ENLACE QUE ESTE GUARDADO PONE, que es la misma que
   * usan los desplegables y las fechas del motor: se frena lo que empeora las
   * cosas, no lo que simplemente no arregla algo que ya estaba. Un documento
   * enlazado antes de esta regla —o al que le cambiaron el flujo al otro
   * lado— tiene que poder seguir editándose por lo demás; si no, quedaría
   * imposible de guardar y nadie podría ni escribirle una observación.
   *
   * Se escribe directo en la base porque por la API ya no hay manera de
   * hacerlo, que es justamente lo que se acaba de arreglar.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const ajeno = await unDocumento(api, { iglesia_id: norte.id });
  const propio = await unDocumento(api, {
    flujo: 'Emitido', iglesia_id: central.id, numero: `EMI-${marca()}`, titulo: 'Enlace de antes',
  });
  db.prepare('UPDATE documentos SET responde_a = ? WHERE id = ?').run(ajeno.id, propio.id);

  const r = await api('PUT', `/documentos/${propio.id}`, { observaciones: 'Se corrige el asunto' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(Number(r.json.responde_a), Number(ajeno.id), 'y el enlace queda como estaba');

  // Pero tocarlo sí se revisa: es el guardado que empeora las cosas.
  const otro = await unDocumento(api, { iglesia_id: norte.id });
  const cambiarlo = await api('PUT', `/documentos/${propio.id}`, { responde_a: otro.id });
  assert.equal(cambiarlo.estado, 400);
});

// ══════════════════ y la tercera: mudar no puede saltarse lo anterior ══

test('un documento que contesta a otro no se muda de oficina', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const recibido = await unDocumento(api, {
    iglesia_id: central.id, numero: `REC-777-${marca()}`, titulo: 'Oficio que se contesta',
  });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'La respuesta',
    numero: `EMI-${marca()}`, responde_a: recibido.id,
  });
  assert.equal(respuesta.estado, 201);

  const r = await api('PUT', `/documentos/${respuesta.json.id}`, {
    iglesia_id: norte.id, igual_asi: true,
  });
  assert.equal(r.estado, 400, 'ni con la marca de guardar igual');
  assert.ok(r.json.error.includes(recibido.numero), 'nombra a qué contesta');
  assert.match(r.json.error, /quitarle antes el enlace/, 'y dice cómo se hace, si de verdad va allá');
});

test('ni uno al que le responden', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const recibido = await unDocumento(api, { iglesia_id: central.id, titulo: 'Oficio contestado' });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'La respuesta',
    numero: `EMI-555-${marca()}`, responde_a: recibido.id,
  });
  assert.equal(respuesta.estado, 201);

  const r = await api('PUT', `/documentos/${recibido.id}`, { iglesia_id: norte.id, igual_asi: true });
  assert.equal(r.estado, 400);
  assert.ok(r.json.error.includes(respuesta.json.numero), 'nombra las respuestas que se quedarían');
  assert.match(r.json.error, /apuntando a\s+otro libro|apuntando a otro libro/);
});

test('quitando el enlace en el mismo guardado, sí se muda', async () => {
  /*
   * La salida que el aviso promete tiene que existir. Acá se hacen las dos
   * cosas de una vez: se quita el enlace y se muda, que es lo que haría quien
   * lee la negativa y corrige.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const recibido = await unDocumento(api, { iglesia_id: central.id });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: central.id, titulo: 'La respuesta',
    numero: `EMI-${marca()}`, responde_a: recibido.id,
  });
  assert.equal(respuesta.estado, 201);

  const r = await api('PUT', `/documentos/${respuesta.json.id}`, {
    responde_a: '', iglesia_id: norte.id, igual_asi: true,
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(Number(r.json.iglesia_id), Number(norte.id));
  assert.ok(!r.json.responde_a, 'y queda sin enlace');
});

test('cambiar de flujo y de iglesia a la vez avisa de las dos cosas, numeradas', async () => {
  /*
   * La marca de «guardar igual» es UNA para toda la petición: si las preguntas
   * salieran de a una, quien contesta la primera pasaría la segunda sin
   * haberla leído. Las dos de este módulo pueden caer en el mismo guardado.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const doc = await unDocumento(api, {
    iglesia_id: central.id, numero: `REC-444-${marca()}`, remitente: 'Superintendencia',
  });

  const r = await api('PUT', `/documentos/${doc.id}`, {
    flujo: 'Interno o de archivo', iglesia_id: norte.id,
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /Hay dos cosas que revisar/);
  assert.match(r.json.error, /\(1\)/);
  assert.match(r.json.error, /\(2\)/);
  assert.match(r.json.error, /vacía/, 'la del flujo');
  assert.ok(r.json.error.includes(norte.nombre), 'y la de la iglesia');
});

// ════════════════════════════ la lista de la que se elige ══

test('la lista para responder ofrece solo lo recibido por esa oficina', async () => {
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const suyo = await unDocumento(api, { iglesia_id: central.id, titulo: 'Recibido propio' });
  const ajeno = await unDocumento(api, { iglesia_id: norte.id, titulo: 'Recibido ajeno' });
  const salido = await unDocumento(api, {
    flujo: 'Emitido', iglesia_id: central.id, numero: `EMI-${marca()}`, titulo: 'Emitido propio',
  });
  const interno = await unDocumento(api, {
    flujo: 'Interno o de archivo', numero: undefined, iglesia_id: central.id,
    titulo: 'Escritura propia', tipo: 'Escritura / Propiedad',
  });

  const r = await api('GET', `/documentos/para-responder?iglesia_id=${central.id}`);
  assert.equal(r.estado, 200);
  const ids = r.json.map((o) => Number(o.id));
  assert.ok(ids.includes(suyo.id), 'ofrece el recibido de esta oficina');
  assert.ok(!ids.includes(ajeno.id), 'y no el de la otra');
  assert.ok(!ids.includes(salido.id), 'ni un emitido');
  assert.ok(!ids.includes(interno.id), 'ni lo de archivo');

  const cual = r.json.find((o) => Number(o.id) === suyo.id);
  assert.ok(cual.label.includes(suyo.numero), 'se nombra por su número, que es como se cita');
});

test('y agrega el que la ficha ya tenía, para no perderlo al abrirla', async () => {
  /*
   * Sin esto, abrir un documento cuyo enlace apunta a algo que la lista ya no
   * ofrece lo mostraría en blanco y lo borraría al guardar. Es el mismo
   * arreglo que la 1.232.0 le hizo a las iglesias inactivas.
   */
  const api = await elSistemaAndando();
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');
  const ajeno = await unDocumento(api, { iglesia_id: norte.id });

  const sinEl = await api('GET', `/documentos/para-responder?iglesia_id=${central.id}`);
  assert.ok(!sinEl.json.some((o) => Number(o.id) === ajeno.id));

  const conEl = await api('GET', `/documentos/para-responder?iglesia_id=${central.id}&ademas=${ajeno.id}`);
  assert.ok(conEl.json.some((o) => Number(o.id) === ajeno.id), 'el que ya estaba se ofrece igual');
});

test('sin iglesia no ofrece nada, y sobre una ajena contesta 403', async () => {
  const api = await elSistemaAndando();
  const vacia = await api('GET', '/documentos/para-responder');
  assert.equal(vacia.estado, 200);
  assert.deepEqual(vacia.json, [], 'primero hay que elegir la iglesia');

  const suya = unaIglesia('Central');
  const ajena = unaIglesia('Norte');

  /*
   * Una cuenta acotada a UNA congregación. Lo que la acota es la lista
   * `iglesias`, no la columna `iglesia_id`: ésa dice con cuál trabaja por
   * omisión, y sola no restringe nada (ver server/alcance.js). El rol es
   * «admin» a propósito, para que el 403 no pueda venir de un permiso que
   * falte y sea el alcance el que contesta.
   */
  const { comoOtroUsuario } = require('./andando');
  const { digitoVerificador } = require('../../server/rut');
  const numero = `${70000000 + (process.pid % 9000000)}`;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, iglesia_id, iglesias) VALUES (?, ?, 'admin', 1, ?, ?)"
  ).run(`Secretaria ${marca()}`, `${numero}-${digitoVerificador(numero)}`, suya.id,
    JSON.stringify([suya.id])).lastInsertRowid;
  const suyoApi = comoOtroUsuario(usuario);

  const laSuya = await suyoApi(`GET`, `/documentos/para-responder?iglesia_id=${suya.id}`);
  assert.equal(laSuya.estado, 200, 'la de su propia oficina sí la alcanza');

  const r = await suyoApi('GET', `/documentos/para-responder?iglesia_id=${ajena.id}`);
  assert.equal(r.estado, 403, 'la lista no dice qué recibió una oficina que no le toca');

  /*
   * Y el «además» tampoco es una rendija. Es el enlace que la ficha ya tenía,
   * y se agrega DENTRO del alcance: pidiendo la lista de la oficina propia con
   * el número de un documento ajeno, ese documento no aparece. Si se agregara
   * por fuera, cualquiera con una cuenta acotada podría leer el número y el
   * asunto de lo que recibió otra congregación, probando números.
   */
  const ajeno = await unDocumento(api, { iglesia_id: ajena.id, titulo: 'Oficio reservado' });
  const conRendija = await suyoApi(
    'GET', `/documentos/para-responder?iglesia_id=${suya.id}&ademas=${ajeno.id}`
  );
  assert.equal(conRendija.estado, 200);
  assert.ok(!conRendija.json.some((o) => Number(o.id) === ajeno.id),
    'el «además» no saca nada de fuera del alcance');
});

// ═══════════════════════ la pieza compartida, probada suelta ══

test('la mudanza se detecta aunque la iglesia venga escrita como texto', () => {
  /*
   * `laMudanza` (server/cambio-de-iglesia.js) la usan los dos libros que son
   * de una congregación: éste y el de actas de asamblea. Compara convirtiendo
   * a número, y esto es lo que fija esa conversión.
   *
   * POR LA API NO SE PUEDE LLEGAR ACÁ, y por eso la prueba llama a la pieza
   * derecho: el motor convierte los campos de referencia a número antes de
   * llamar al gancho del módulo (`coerce`, en server/crud.js). Pero la pieza
   * está escrita para poder llamarse suelta —lo dice su propio archivo—, y
   * comparando sin convertir, la misma iglesia escrita «12» y 12 pareceria una
   * mudanza: el sistema preguntaría por un traslado que nadie pidió.
   */
  const { laMudanza } = require('../../server/cambio-de-iglesia');
  const central = unaIglesia('Central');
  const norte = unaIglesia('Norte');

  assert.equal(
    laMudanza({ iglesia_id: String(central.id) }, { iglesia_id: central.id }, db), null,
    'la misma iglesia escrita distinto no es una mudanza'
  );

  const m = laMudanza({ iglesia_id: String(norte.id) }, { iglesia_id: central.id }, db);
  assert.ok(m, 'y otra sí lo es');
  assert.equal(m.deDonde, central.nombre);
  assert.equal(m.aDonde, norte.nombre);
});

// ═══════════════════════════════════════ lo que declara la pantalla ══

test('el campo pide su lista a esa ruta, y no a todos los documentos', () => {
  const { getModule } = require('../../server/registry');
  const f = getModule('documentos').fields.find((x) => x.name === 'responde_a');
  assert.equal(f.optionsRoute, '/documentos/para-responder?iglesia_id={iglesia_id}&ademas={responde_a}');
});

test('la pregunta de la mudanza trae el texto de sus dos botones', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito. Ésta es una pregunta de GUARDAR, así
   * que sale de la tabla de la pantalla —al revés que las de borrado, que
   * preguntan en la caja del navegador—. Sin su entrada caería en el texto de
   * reserva, «Revise esto antes de guardar / Está bien, guardar así», que no
   * dice a qué se está diciendo que sí.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA'), app.indexOf('const como = COMO_SE_PREGUNTA'));
  assert.ok(tabla.length > 500, 'se encontró la tabla');

  const desde = tabla.indexOf('\n    documento_que_cambia_de_iglesia: {');
  assert.ok(desde >= 0, 'falta la entrada de esta pregunta');
  const entrada = tabla.slice(desde, tabla.indexOf('\n    },', desde));
  assert.match(entrada, /titulo: '[^']*oficina de partes/, 'el título dice de qué se trata');
  assert.match(entrada, /seguir: '[^']*moverlo/, 'y el botón dice qué se va a hacer');
});
