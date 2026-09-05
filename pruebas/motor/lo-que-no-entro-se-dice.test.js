/**
 * Un desplegable que se pregunta cada vez, y lo que no entra se dice.
 *
 * Son dos hallazgos de la misma familia, y se notan juntos.
 *
 * CO-05 · LOS DESPLEGABLES SE CONGELABAN AL ARRANCAR. El ajuste «Actividad que
 * viene elegida al pasar lista» armaba su lista con una propiedad corriente y
 * no con un `get`, así que se evaluaba UNA VEZ al cargar el archivo. Los tipos
 * de actividad, en cambio, son datos que la iglesia mantiene desde su propia
 * pantalla. Medido en la v1.423.0: se creó «Vigilia de Año Nuevo», se volvió a
 * abrir Configuración, y el desplegable seguía ofreciendo los doce de antes.
 *
 * CO-06 · Y LO QUE SE DESCARTABA NO SE DECÍA. La comprobación del guardado usa
 * esa misma lista, así que elegir el tipo nuevo no daba error: se descartaba y
 * el servidor contestaba «ok». Igual con una lista que trae un valor inventado
 * y con un número que no es un número:
 *
 *   PUT credencial_qr_modo = "telepatia" ....  ok = true · quedó 'linea'
 *   PUT zona_horaria = "Marte/Olympus" .....  ok = true · quedó 'America/Santiago'
 *   PUT respaldo_conservar = "muchas" ......  ok = true · quedó '7'
 *
 * La pantalla mostraba su aviso verde, el campo volvía solo a lo de antes, y no
 * había nada que lo explicara. Un error del que no se avisa se repite.
 *
 * Lo que ya estaba bien y no se tocó: un número FUERA DE RANGO se ajusta al
 * límite y se dice en cuánto quedó. Esto es el mismo trato para lo que no entra
 * en absoluto, y va por separado porque no es lo mismo «lo puse en el máximo»
 * que «no lo puse».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const ajustes = require('../../server/ajustes');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

/** Las opciones que Configuración ofrece hoy para una clave. */
async function loQueOfrece(api, clave) {
  const r = await api('GET', '/configuracion');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const o = r.json.grupos.flatMap((g) => g.items).find((x) => x.clave === clave);
  assert.ok(o, `no vino la opción ${clave}`);
  return (o.opciones || []).map((x) => x.valor);
}

// ------------------------------------------- CO-05 · la lista viva ---------

test('el desplegable de la actividad ofrece un tipo creado después de arrancar', async () => {
  const api = await elSistemaAndando();
  const nuevo = `Vigilia CO05 ${marca}`;

  assert.ok(!(await loQueOfrece(api, 'asistencia_actividad_defecto')).includes(nuevo),
    'todavía no existe');

  const creado = await api('POST', '/tipos_actividad', { nombre: nuevo, activo: 1 });
  assert.equal(creado.estado, 201, creado.texto.slice(0, 200));

  assert.ok((await loQueOfrece(api, 'asistencia_actividad_defecto')).includes(nuevo),
    'la lista se arma cada vez que se pide, no una sola al arrancar el servidor');
});

test('y elegirlo se puede: la comprobación mira la misma lista viva', async () => {
  const api = await elSistemaAndando();
  const nuevo = `Retiro CO05 ${marca}`;
  assert.equal((await api('POST', '/tipos_actividad', { nombre: nuevo, activo: 1 })).estado, 201);

  const habia = ajustes.obtener('asistencia_actividad_defecto');
  try {
    const r = await api('PUT', '/configuracion', { asistencia_actividad_defecto: nuevo });
    assert.equal(r.estado, 200, r.texto.slice(0, 200));
    assert.deepEqual(r.json.descartados, [], 'no se descartó nada');
    assert.equal(ajustes.obtener('asistencia_actividad_defecto'), nuevo, 'y quedó puesto de verdad');
  } finally {
    ajustes.guardar('asistencia_actividad_defecto', habia);
  }
});

test('la lista se pregunta con un `get`, no se copia al cargar el archivo', () => {
  const opcion = ajustes.POR_CLAVE.asistencia_actividad_defecto;
  const comoEsta = Object.getOwnPropertyDescriptor(opcion, 'opciones');
  assert.equal(typeof comoEsta.get, 'function',
    'con una propiedad corriente la lista se queda con la foto del arranque');
  // La de al lado ya lo hacía así: son la misma clase de dato
  const directiva = Object.getOwnPropertyDescriptor(ajustes.POR_CLAVE.directiva_categoria, 'opciones');
  assert.equal(typeof directiva.get, 'function');
});

// ------------------------------------------- CO-06 · lo que no entró -------

test('una lista con un valor que no existe se rechaza diciéndolo', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('credencial_qr_modo');
  const r = await api('PUT', '/configuracion', { credencial_qr_modo: 'telepatia' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(ajustes.obtener('credencial_qr_modo'), habia, 'no se guardó, como antes');

  assert.equal(r.json.descartados.length, 1, 'pero ahora se dice');
  const cual = r.json.descartados[0];
  assert.equal(cual.clave, 'credencial_qr_modo');
  assert.equal(cual.pedido, 'telepatia');
  assert.match(cual.porque, /no es una de las opciones/);
  assert.equal(cual.quedo, habia, 'y se dice en qué quedó');
  assert.match(cual.label, /QR/, 'con el nombre que la persona ve, no con la clave');
});

test('un número que no es un número, igual', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('respaldo_conservar');
  const r = await api('PUT', '/configuracion', { respaldo_conservar: 'muchas' });
  assert.equal(r.estado, 200);
  assert.equal(ajustes.obtener('respaldo_conservar'), habia);
  assert.equal(r.json.descartados.length, 1);
  assert.match(r.json.descartados[0].porque, /no es un número/);
});

test('lo que sí entra no aparece en la lista de lo descartado', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('iglesia_lema');
  try {
    const r = await api('PUT', '/configuracion', { iglesia_lema: `Lema CO06 ${marca}` });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.descartados, []);
  } finally {
    ajustes.guardar('iglesia_lema', habia);
  }
});

test('un número fuera de rango sigue ajustándose, que no es lo mismo', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('respaldo_conservar');
  try {
    const r = await api('PUT', '/configuracion', { respaldo_conservar: '9999' });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.descartados, [], 'esto no se descartó: se ajustó');
    assert.equal(r.json.ajustados.length, 1);
    assert.equal(r.json.ajustados[0].pedido, 9999);
    assert.equal(r.json.ajustados[0].quedo, 60, 'quedó en el máximo que declara');
    assert.equal(ajustes.obtener('respaldo_conservar'), '60');
  } finally {
    ajustes.guardar('respaldo_conservar', habia);
  }
});

test('los dos avisos salen en la pantalla, y son dos distintos', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf("const ajustados = (r && r.ajustados) || [];");
  const trozo = app.slice(desde, desde + 2200);
  assert.match(trozo, /Se ajustó lo que no cabía/, 'el de los números que no cabían, que ya estaba');
  assert.match(trozo, /Esto no se guardó/, 'y el de lo que no entró en absoluto');
  assert.match(trozo, /r\.descartados/, 'que sale de lo que contesta el servidor');
  assert.match(app, /avisoDeLimites \+ avisoDeLoQueNoEntro/, 'los dos se pintan, no uno u otro');
  // Y el aviso corto no puede decir «guardada» cuando algo no entró
  assert.match(app, /hay algo que no entró/);
});
