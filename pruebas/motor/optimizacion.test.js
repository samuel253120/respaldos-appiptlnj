/**
 * Lo que se hizo para que el sistema pese y espere menos.
 *
 * POR QUÉ IMPORTA. Las dos piezas que se prueban acá no se ven: nadie abre una
 * pantalla y dice «esto está apretado con brotli». Si un día dejan de hacer lo
 * suyo, el sistema sigue funcionando —solo que más lento y más pesado— y nadie
 * se entera hasta que alguien vuelve a medir. Justamente por eso conviene que
 * quede escrito qué tienen que hacer.
 *
 * Y hay algo que sí se rompería a la vista: si la descripción del sistema
 * empezara a botar propiedades que SÍ dicen algo —un límite en cero, un «no»
 * que es una decisión—, los formularios cambiarían de comportamiento sin que
 * nadie tocara un formulario.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { sinLoQueNoDiceNada, EL_NO_DICE_ALGO } = require('../../server/meta-liviana');
const apretados = require('../../server/apretados');

/* ── La descripción del sistema, sin lo que no dice nada ─────────────── */

test('lo que va en nulo, vacío o sin definir no viaja', () => {
  const limpio = sinLoQueNoDiceNada({
    name: 'telefono', label: 'Teléfono', type: 'text',
    options: null, help: '', accept: undefined, showIf: null,
  });
  assert.deepEqual(limpio, { name: 'telefono', label: 'Teléfono', type: 'text' });
});

test('lo que va en falso tampoco', () => {
  const limpio = sinLoQueNoDiceNada({ name: 'rut', required: false, sensible: false, computed: false });
  assert.deepEqual(limpio, { name: 'rut' });
});

test('pero el cero se queda: es un límite, no una ausencia', () => {
  // «El monto no puede ser negativo» se dice con min: 0. Si se fuera junto con
  // los nulos, el formulario dejaría de avisar y aceptaría números negativos
  // hasta que el servidor los rechazara sin explicar por qué.
  const limpio = sinLoQueNoDiceNada({ name: 'monto', min: 0, max: 0 });
  assert.deepEqual(limpio, { name: 'monto', min: 0, max: 0 });
});

test('y el texto «0» también, que es texto y no un no', () => {
  assert.deepEqual(sinLoQueNoDiceNada({ name: 'piso', default: '0' }), { name: 'piso', default: '0' });
});

test('el «no» que es una decisión se manda tal cual', () => {
  // `buscador: false` significa «este campo NO lleva buscador aunque tenga
  // muchas opciones»; no venir significa «decida usted». La pantalla los
  // distingue con f.buscador === false, así que no pueden confundirse.
  assert.deepEqual(sinLoQueNoDiceNada({ name: 'tipo', buscador: false }), { name: 'tipo', buscador: false });
  assert.ok(EL_NO_DICE_ALGO.has('buscador'));
});

test('lo verdadero, los textos y los objetos pasan enteros', () => {
  const calcula = { campo: 'monto', porcentaje: 10 };
  const limpio = sinLoQueNoDiceNada({
    name: 'diezmo', required: true, help: 'El diez por ciento',
    options: ['Sí', 'No'], calcula, showIf: { field: 'tipo', equals: 'Ingreso' },
  });
  assert.equal(limpio.required, true);
  assert.equal(limpio.help, 'El diez por ciento');
  assert.deepEqual(limpio.options, ['Sí', 'No']);
  assert.deepEqual(limpio.calcula, calcula);
  assert.deepEqual(limpio.showIf, { field: 'tipo', equals: 'Ingreso' });
});

test('no se inventa nada: lo que sale es un subconjunto de lo que entró', () => {
  const entra = { name: 'a', label: 'A', type: 'text', required: false, min: 0 };
  const sale = sinLoQueNoDiceNada(entra);
  for (const clave of Object.keys(sale)) assert.ok(clave in entra, `apareció «${clave}» de la nada`);
  for (const [clave, valor] of Object.entries(sale)) assert.equal(valor, entra[clave]);
});

/* ── Los archivos grandes, bien apretados ────────────────────────────── */

const PUBLICO = path.join(__dirname, '..', '..', 'public');

test('el programa y los estilos quedan apretados, y bastante más que antes', async () => {
  await apretados.prepararApretados(PUBLICO);
  for (const cual of ['/app.js', '/styles.css']) {
    const guardado = apretados.GUARDADOS.get(cual);
    assert.ok(guardado, `no se apretó ${cual}`);
    const original = fs.readFileSync(path.join(PUBLICO, cual.slice(1)));
    // Lo apretado tiene que ser exactamente el archivo, no otro parecido
    assert.deepEqual(zlib.brotliDecompressSync(guardado.apretado), original, `${cual} no se recupera igual`);
    // Y tiene que ganarle con holgura al que se hacía al vuelo en cada pedido.
    // Ese va en calidad 4 —la que trae «compression», que no puede permitirse
    // más porque lo hace una vez por visita—; este va en la máxima, porque se
    // hace una sola vez para todos.
    const alVuelo = zlib.brotliCompressSync(original, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    assert.ok(
      guardado.largo < alVuelo.length * 0.92,
      `${cual}: apretado ${guardado.largo} vs al vuelo ${alVuelo.length}; ya casi no se gana nada`
    );
  }
});

test('el ayudante de los avisos queda fuera a propósito', () => {
  // Se pide sin versión en la dirección y lleva sus propias cabeceras: es el
  // que más conviene dejar por el camino de siempre.
  assert.equal(apretados.GUARDADOS.has('/avisos-sw.js'), false);
});

test('las fotos y los iconos no se tocan: ya vienen comprimidos', () => {
  for (const ruta of apretados.GUARDADOS.keys()) {
    assert.ok(/\.(js|css)$/.test(ruta), `se apretó algo que no es texto: ${ruta}`);
  }
});
