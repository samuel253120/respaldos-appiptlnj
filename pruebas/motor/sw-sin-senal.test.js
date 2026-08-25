/**
 * El ayudante que deja abrir el sistema sin señal: qué guarda y qué NO.
 *
 * Se prueba haciéndolo correr de verdad —el mismo archivo que se le manda al
 * navegador— con un mundo de mentira alrededor: una bodega falsa y una red
 * falsa. Así se le pueden dar peticiones y mirar qué hace con cada una.
 *
 * LAS DOS COSAS QUE NO PUEDEN FALLAR, y por eso están acá:
 *
 *   · QUE NO GUARDE DATOS DE PERSONAS. Por «/api/» y por «/uploads/» viajan
 *     RUTs, datos de salud, fotos y documentos. Una copia de eso quedaría en el
 *     navegador después de cerrar la sesión, en un teléfono que se presta o se
 *     pierde. Y además una lista de miembros de ayer mostrada como si fuera de
 *     hoy es peor que no mostrar nada.
 *
 *   · QUE NUNCA SIRVA UNA PÁGINA VIEJA HABIENDO RED. Es la razón por la que
 *     este ayudante no guardaba nada durante mucho tiempo. Si la copia le
 *     ganara a la red aunque sea una vez, quedaría gente trabajando con una
 *     versión de la semana pasada sin manera de darse cuenta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGEN = 'https://gestion.example.cl';
const CODIGO = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'avisos-sw.js'), 'utf8');

const laDireccion = (x) => (typeof x === 'string' ? new URL(x, ORIGEN).href : x.url);

/** Un ayudante recién arrancado, con su bodega y su red de mentira. */
function unAyudante({ red } = {}) {
  const dentro = new Map();
  const pedidas = [];

  const unaBodega = () => ({
    async keys() { return [...dentro.keys()].map((url) => ({ url })); },
    async put(pet, res) { dentro.set(laDireccion(pet), res); },
    async delete(pet) { return dentro.delete(laDireccion(pet)); },
    async match(pet) { return dentro.get(laDireccion(pet)); },
  });

  const oyentes = {};
  const mundo = {
    self: null,
    caches: {
      async open() { return unaBodega(); },
      async keys() { return ['iglesias-v1']; },
      async delete() { return true; },
      async match(pet) { return dentro.get(laDireccion(pet)); },
    },
    async fetch(pet) {
      pedidas.push(laDireccion(pet));
      if (red) return red(laDireccion(pet));
      return { status: 200, type: 'basic', clone: () => ({ text: async () => '' }) };
    },
    Response: function (cuerpo, init) { return { cuerpo, init, status: 200, type: 'basic' }; },
    URL,
    console,
  };
  mundo.self = {
    location: { origin: ORIGEN },
    addEventListener: (que, fn) => (oyentes[que] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { showNotification: async () => {} },
  };
  vm.createContext(mundo);
  vm.runInContext(CODIGO, mundo);

  /** Le da una petición y devuelve qué contestó, o null si no se metió. */
  const pedir = async (url, { metodo = 'GET', modo = 'no-cors' } = {}) => {
    const peticion = { url: new URL(url, ORIGEN).href, method: metodo, mode: modo };
    let respondio = null;
    await oyentes.fetch({ request: peticion, respondWith: (p) => (respondio = p) });
    return respondio === null ? null : await respondio;
  };

  return { pedir, bodega: dentro, pedidas, oyentes };
}

// ------------------------------------------- lo que NO se guarda, pase lo que pase

for (const donde of ['/api/miembros', '/api/miembros?page=1', '/api/configuracion/logo', '/api/avisos']) {
  test(`«${donde}» ni siquiera pasa por el ayudante`, async () => {
    const a = unAyudante();
    assert.equal(await a.pedir(donde), null, 'los datos de las personas no se guardan nunca');
  });
}

test('los archivos subidos —fotos, documentos— tampoco', async () => {
  const a = unAyudante();
  assert.equal(await a.pedir('/uploads/miembros/12345.jpg'), null);
});

test('lo que no sea GET no se toca', async () => {
  const a = unAyudante();
  for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal(await a.pedir('/app.js?v=1.0.0', { metodo }), null, `un ${metodo} no se guarda`);
  }
});

test('lo de otros sitios no es asunto suyo', async () => {
  const a = unAyudante();
  assert.equal(await a.pedir('https://otro-sitio.cl/algo.js'), null);
});

// ------------------------------------------------ las páginas: la red manda

test('una página se pide SIEMPRE al servidor, aunque haya copia guardada', async () => {
  const a = unAyudante({ red: async () => ({ status: 200, type: 'basic', quien: 'del servidor', clone: () => ({}) }) });
  a.bodega.set(`${ORIGEN}/`, { quien: 'la copia vieja' });
  const r = await a.pedir('/', { modo: 'navigate' });
  assert.equal(r.quien, 'del servidor', 'si la copia ganara, se serviría una versión vieja del sistema');
});

test('y solo si la red falla se usa la copia', async () => {
  const a = unAyudante({ red: async () => { throw new Error('sin señal'); } });
  a.bodega.set(`${ORIGEN}/`, { quien: 'la copia guardada' });
  const r = await a.pedir('/', { modo: 'navigate' });
  assert.equal(r.quien, 'la copia guardada');
});

test('sin red y sin copia, contesta una pantalla propia, no un error pelado', async () => {
  const a = unAyudante({ red: async () => { throw new Error('sin señal'); } });
  const r = await a.pedir('/', { modo: 'navigate' });
  assert.ok(r, 'algo tiene que contestar');
  assert.ok(/Sin conexión/.test(r.cuerpo || ''), 'y decir qué pasa, en castellano');
});

test('cualquier pantalla del sistema cae en la copia de la aplicación', async () => {
  // El sistema arma sus pantallas con «#/», así que al servidor solo le llega
  // «/». Pero una dirección guardada o compartida puede traer otra cosa.
  const a = unAyudante({ red: async () => { throw new Error('sin señal'); } });
  a.bodega.set(`${ORIGEN}/`, { quien: 'la aplicación' });
  const r = await a.pedir('/config', { modo: 'navigate' });
  assert.equal(r.quien, 'la aplicación');
});

// ------------------------------------- los archivos del programa: la copia sirve

test('el programa se sirve de la copia: por eso abre sin señal', async () => {
  const a = unAyudante({ red: async () => { throw new Error('sin señal'); } });
  a.bodega.set(`${ORIGEN}/app.js?v=1.87.4`, { quien: 'la copia' });
  const r = await a.pedir('/app.js?v=1.87.4');
  assert.equal(r.quien, 'la copia');
});

test('una versión nueva NO puede salir de la copia de la vieja', async () => {
  // Cada versión lleva su número en la dirección, así que son archivos
  // distintos: la copia de la vieja no puede contestar por la nueva.
  const a = unAyudante({ red: async () => ({ status: 200, type: 'basic', quien: 'la nueva', clone: () => ({}) }) });
  a.bodega.set(`${ORIGEN}/app.js?v=1.87.3`, { quien: 'la vieja' });
  const r = await a.pedir('/app.js?v=1.87.4');
  assert.equal(r.quien, 'la nueva');
});

test('al guardar una versión se borran las anteriores del mismo archivo', async () => {
  const a = unAyudante({ red: async () => ({ status: 200, type: 'basic', quien: 'la nueva', clone: () => ({ quien: 'la nueva' }) }) });
  a.bodega.set(`${ORIGEN}/app.js?v=1.87.1`, { quien: 'vieja 1' });
  a.bodega.set(`${ORIGEN}/app.js?v=1.87.2`, { quien: 'vieja 2' });
  a.bodega.set(`${ORIGEN}/styles.css?v=1.87.2`, { quien: 'otro archivo' });
  await a.pedir('/app.js?v=1.87.3');
  await new Promise((s) => setImmediate(s));

  const quedan = [...a.bodega.keys()].filter((u) => u.includes('/app.js'));
  assert.equal(quedan.length, 1, `la bodega crecería para siempre: quedaron ${quedan.length} copias de app.js`);
  assert.ok(quedan[0].endsWith('v=1.87.3'));
  assert.ok([...a.bodega.keys()].some((u) => u.includes('/styles.css')), 'y no se lleva por delante otros archivos');
});

test('las hojas de estilo y los iconos también se guardan', async () => {
  for (const donde of ['/styles.css?v=1.0.0', '/credencial.css', '/icons/icon-192.png', '/favicon.ico', '/manifest.webmanifest']) {
    const a = unAyudante({ red: async () => { throw new Error('sin señal'); } });
    a.bodega.set(`${ORIGEN}${donde}`, { quien: donde });
    const r = await a.pedir(donde);
    assert.ok(r && r.quien === donde, `${donde} debería salir de la copia`);
  }
});
