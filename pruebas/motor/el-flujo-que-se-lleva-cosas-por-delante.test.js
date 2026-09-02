/**
 * CAMBIAR EL FLUJO VACIABA CINCO CAMPOS SIN DECIR UNA PALABRA, Y UN CONTRATO
 * NO PODÍA DECIR CON QUIÉN ERA.
 *
 * Son dos hallazgos y el mismo campo mirado por los dos lados: qué se limpia al
 * cambiar de flujo, y qué queda sin dónde escribirse.
 *
 * MEDIDO en la v1.286.0, sobre un documento recibido completo pasado a
 * «Interno o de archivo» mandando UNA SOLA COSA —el flujo—:
 *
 *   qué contestó ............... 200
 *   qué preguntó ............... nada
 *   qué quedó en nulo .......... el número, el remitente, el plazo,
 *                                quién lo recibió y a quién se derivó
 *   y a medias ................. «Derivado a» en blanco con su enlace
 *                                todavía apuntando a alguien
 *
 * Y sobre un contrato de arriendo guardado como archivo, con la contraparte
 * escrita en los dos campos que había: los dos volvían en nulo. En la pantalla
 * ni se ofrecían —el remitente es de lo recibido y el destinatario de lo
 * emitido—, así que un contrato quedaba guardado sin decir con quién se firmó.
 *
 * LA REGLA DE LIMPIAR ES CORRECTA y no se tocó: un número de oficina de partes
 * puesto a una escritura afirma que esa escritura entró un día, y un plazo para
 * responder en algo que nadie mandó no es el plazo de nadie. Lo que faltaba era
 * decirlo antes, y tener dónde escribir lo que sí es del archivo.
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
    .run(`Iglesia ${m}`, `FL${m}`.slice(0, 18)).lastInsertRowid;
}

function unMiembro(iglesia) {
  const m = marca();
  return db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run('Persona', m, iglesia).lastInsertRowid;
}

/** Un recibido completo, del que hay algo que perder. */
async function unRecibidoCompleto(api, iglesia, quien) {
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: iglesia, numero: `REC-050-${m}`,
    titulo: 'Oficio que después se archiva', remitente: 'Servicio de Impuestos Internos',
    plazo: '2026-12-01', medio: 'Correo postal', folios: 9, estado: 'Derivado',
    derivado_a_id: quien,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

/* ═══════════════════ OP-04 · el flujo que se lleva cosas ═══════════════ */

test('cambiar el flujo pregunta antes, y nombra lo que se va a vaciar', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unRecibidoCompleto(api, iglesia, unMiembro(iglesia));

  const r = await api('PUT', `/documentos/${doc.id}`, { flujo: 'Interno o de archivo' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'documento_que_cambia_de_flujo');
  for (const rotulo of ['N.º de la oficina de partes', 'Remitente', 'Derivado a', 'Plazo para responder']) {
    assert.ok(r.json.error.includes(`«${rotulo}»`), `falta «${rotulo}» en el aviso`);
  }
  assert.match(r.json.error, /de «Recibido» a «Interno o de archivo»/);
});

test('y dice lo que le pasa al libro cuando lo que se va es el número', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unRecibidoCompleto(api, iglesia, unMiembro(iglesia));
  const { json } = await api('PUT', `/documentos/${doc.id}`, { flujo: 'Interno o de archivo' });
  assert.match(json.error, /El número se libera y el libro vuelve a ofrecerlo/);
});

test('preguntar no es guardar: el documento se queda como estaba', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unRecibidoCompleto(api, iglesia, unMiembro(iglesia));
  await api('PUT', `/documentos/${doc.id}`, { flujo: 'Interno o de archivo' });

  const sigue = db.prepare('SELECT flujo, numero, remitente FROM documentos WHERE id = ?').get(doc.id);
  assert.equal(sigue.flujo, 'Recibido');
  assert.equal(sigue.numero, doc.numero);
  assert.equal(sigue.remitente, 'Servicio de Impuestos Internos');
});

test('confirmando se limpia, y el enlace de la persona se va con su nombre', async () => {
  /*
   * Quedaba a medias: «Derivado a» en blanco y su enlace todavía apuntando a
   * alguien, así que la ficha mostraba el nombre —el motor lo rehace desde el
   * enlace— mientras la base decía que no había nadie.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unRecibidoCompleto(api, iglesia, unMiembro(iglesia));

  const antes = db.prepare('SELECT derivado_a, derivado_a_id FROM documentos WHERE id = ?').get(doc.id);
  assert.ok(antes.derivado_a && antes.derivado_a_id, 'el fixture tiene que traer los dos puestos');

  /*
   * En un GUARDADO el «igual asá» viaja en el cuerpo; en un borrado va en la
   * dirección. Son dos caminos distintos del motor y es fácil confundirlos.
   */
  const r = await api('PUT', `/documentos/${doc.id}`, { flujo: 'Interno o de archivo', igual_asi: true });
  assert.equal(r.estado, 200);

  const fila = db.prepare(
    'SELECT numero, remitente, plazo, derivado_a, derivado_a_id FROM documentos WHERE id = ?'
  ).get(doc.id);
  for (const [campo, valor] of Object.entries(fila)) {
    assert.equal(valor, null, `${campo} tenía que quedar en nulo y quedó ${JSON.stringify(valor)}`);
  }
});

test('guardar SIN tocar el flujo no pregunta nada', async () => {
  /*
   * La trampa que este módulo ya se conoce: un aviso que sale en cada guardado
   * es un aviso que se aprieta sin leer. Solo pregunta cuando el flujo CAMBIA.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const doc = await unRecibidoCompleto(api, iglesia, unMiembro(iglesia));

  const r = await api('PUT', `/documentos/${doc.id}`, { titulo: 'El mismo oficio, retocado' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
});

test('ni al crear, que no hay nada que perder', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: unaIglesia(), numero: `EMI-001-${m}`,
    titulo: 'Carta nueva', destinatario: 'Municipalidad',
  });
  assert.equal(r.estado, 201);
});

test('ni al crear mandando un campo que es de otro flujo: se ignora y ya', async () => {
  /*
   * Éste es el caso que hace falta el guardián de «solo cuando el flujo
   * CAMBIA». Al crear no se está perdiendo nada —ese dato nunca estuvo
   * guardado—, así que preguntar sería preguntar por algo que no existió.
   * Sin el guardián, esto contestaba una pregunta en vez de un 201; se
   * comprobó rompiéndolo a propósito.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: unaIglesia(), numero: `EMI-002-${m}`,
    titulo: 'Carta con un remitente que no le toca',
    destinatario: 'Municipalidad', remitente: 'Alguien', plazo: '2026-12-01',
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.remitente, null, 'y el dato que no le toca no se guarda');
  assert.equal(r.json.plazo, null);
});

test('y si lo que se limpiaría está vacío, tampoco pregunta', async () => {
  /*
   * Nombrar cinco campos cuando cuatro están en blanco convierte la pregunta en
   * un trámite. Se avisa de lo que DE VERDAD tiene algo escrito.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const creado = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), numero: `REC-070-${m}`, titulo: 'Carta pelada',
  });
  assert.equal(creado.estado, 201);

  // Se le quita el número por la base, para que no quede nada que perder
  db.prepare('UPDATE documentos SET numero = NULL WHERE id = ?').run(creado.json.id);
  const r = await api('PUT', `/documentos/${creado.json.id}`, { flujo: 'Interno o de archivo' });
  assert.equal(r.estado, 200, `no había nada escrito que perder: ${JSON.stringify(r.json)}`);
});

test('la tabla de qué es de cada flujo es una sola, y de ahí sale todo', () => {
  /*
   * Estaba escrita en tres «if» sueltos dentro del gancho. Si se vuelve a
   * partir, el aviso y la limpieza pueden decir cosas distintas — que es la
   * manera de que el sistema avise de una cosa y haga otra.
   */
  const fs = require('fs');
  const path = require('path');
  const mod = fs.readFileSync(path.join(__dirname, '../../server/modules/documentos.js'), 'utf8');
  assert.match(mod, /const LO_QUE_ES_DE_CADA_FLUJO = \{/);
  assert.equal((mod.match(/function loQueNoEsDeEsteFlujo/g) || []).length, 1);
  // El gancho no vuelve a nombrar campos a mano para limpiarlos
  assert.ok(!/data\.remitente = null/.test(mod), 'la limpieza sale de la tabla, no de líneas sueltas');
  assert.ok(!/data\.destinatario = null/.test(mod));
});

/* ═══════════ OP-05 · el contrato que no podía decir con quién es ═══════ */

test('un documento de archivo puede decir con quién es', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: 'Contrato de arriendo del salón', tipo: 'Convenio o contrato',
    contraparte: 'Inmobiliaria Los Robles',
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.contraparte, 'Inmobiliaria Los Robles');
});

test('y sale en la columna «De / Para» del listado, como los otros dos', async () => {
  /*
   * Esa columna existe para no tener dos medio vacías: en un listado que mezcla
   * entradas y salidas, lo que uno busca es siempre la contraparte. El archivo
   * quedaba fuera y su celda salía en blanco.
   */
  const api = await elSistemaAndando();
  const m = marca();
  const creado = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: `Escritura ${m}`, tipo: 'Escritura / Propiedad',
    contraparte: 'Conservador de Bienes Raíces',
  });
  assert.equal(creado.estado, 201);

  const listado = await api('GET', `/documentos?q=${encodeURIComponent(`Escritura ${m}`)}`);
  const filas = listado.json.rows || [];
  assert.equal(filas.length, 1, 'la búsqueda trae esa fila y solo esa');
  assert.equal(filas[0].id, creado.json.id);
  assert.equal(filas[0].de_o_para, 'Conservador de Bienes Raíces');
});

test('se puede buscar por con quién es', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  // La marca sola, sin la palabra: «Municipalidad» la comparten otras filas de
  // la base, que es compartida entre los archivos de prueba.
  const soloMia = `Comodataria${m.replace(/-/g, '')}`;
  const creado = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: 'Comodato del terreno', contraparte: soloMia,
  });
  assert.equal(creado.estado, 201);
  const r = await api('GET', `/documentos?q=${encodeURIComponent(soloMia)}`);
  assert.equal((r.json.rows || []).length, 1, 'se busca por un texto que solo está en esa fila');
  assert.equal(r.json.rows[0].id, creado.json.id);
});

test('el campo solo se ofrece en el archivo, y se limpia si deja de serlo', async () => {
  const f = getModule('documentos').fields.find((x) => x.name === 'contraparte');
  assert.deepEqual(f.showIf, { field: 'flujo', equals: 'Interno o de archivo' });
  assert.equal(f.label, 'Con quién es');

  const api = await elSistemaAndando();
  const m = marca();
  const creado = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: 'Contrato que se convierte en recibido', contraparte: 'Inmobiliaria',
  });
  assert.equal(creado.estado, 201);

  const pregunta = await api('PUT', `/documentos/${creado.json.id}`, {
    flujo: 'Recibido', numero: `REC-080-${m}`,
  });
  assert.equal(pregunta.estado, 400, 'también avisa al revés');
  assert.match(pregunta.json.error, /«Con quién es»/);

  const ok = await api('PUT', `/documentos/${creado.json.id}`, {
    flujo: 'Recibido', numero: `REC-080-${m}`, igual_asi: true,
  });
  assert.equal(ok.estado, 200);
  assert.equal(db.prepare('SELECT contraparte FROM documentos WHERE id = ?').get(creado.json.id).contraparte, null);
});

test('y lo que decía se conserva si el documento se borra', () => {
  const def = getModule('documentos');
  assert.ok(def.camposAlBorrar.includes('contraparte'));
  assert.ok(def.searchFields.includes('contraparte'));
});


/* ------------------------------- y la cara que le pone la pantalla ------ */

test('la pregunta trae el texto de sus dos botones', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito. Ésta sí es una pregunta de GUARDAR, así
   * que sí sale de la tabla de la pantalla —al revés que las de borrado, que
   * preguntan en la caja del navegador—. Sin su entrada caería en el texto de
   * reserva, «Revise esto antes de guardar / Está bien, guardar así», que no
   * dice a qué se está diciendo que sí.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA'), app.indexOf('const como = COMO_SE_PREGUNTA'));
  assert.ok(tabla.length > 500, 'se encontró la tabla');

  const desde = tabla.indexOf('\n    documento_que_cambia_de_flujo: {');
  assert.ok(desde >= 0, 'falta la entrada de esta pregunta');
  const entrada = tabla.slice(desde, tabla.indexOf('\n    },', desde));
  assert.match(entrada, /titulo: '[^']*vacía datos/, 'el título dice de qué se trata');
  assert.match(entrada, /seguir: '[^']*Cambiarlo igual/, 'y el botón dice qué se va a hacer');
});
