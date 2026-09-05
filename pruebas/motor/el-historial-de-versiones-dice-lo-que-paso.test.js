/**
 * El historial de versiones es lo que la iglesia lee para saber qué cambió.
 *
 * No tenía NINGUNA prueba. Se notó de la peor manera: escribiendo las
 * correcciones de la revisión de Configuración, el ayudante que agrega la
 * entrada de cada versión se llamó mal cinco veces seguidas —su tercer
 * argumento es el archivo con el TEXTO de la entrada, y se le pasó el propio
 * `server/versiones.js`—, así que en cada versión metió como «título» el
 * archivo entero, con las comillas escapadas otra vez. Cada vuelta duplicaba la
 * anterior:
 *
 *   v1.424.0 ....    493.609 caracteres de basura
 *   v1.425.0 ....    992.717
 *   v1.426.0 ....  1.997.658
 *   v1.427.0 ....  4.022.207
 *   v1.428.0 ....  8.117.618
 *
 * El archivo pasó de 500 KB a 16,8 MB, y todo eso se publicó en cuatro
 * versiones seguidas sin que nada se pusiera rojo: era JavaScript válido y
 * ninguna prueba miraba el historial. Lo destapó el barrido móvil, midiendo que
 * la pantalla de versiones se salía 462 px de lado en un teléfono —o sea el
 * síntoma, tres pantallas más allá del problema—.
 *
 * Esto es lo que faltaba. Nada de esto es exigente: son las cosas que tienen
 * que ser verdad para que la pantalla de versiones sirva para algo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { VERSIONES } = require('../../server/versiones');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('cada entrada tiene su versión, su fecha y lo que trajo', () => {
  assert.ok(VERSIONES.length > 300, `solo hay ${VERSIONES.length} entradas`);
  for (const v of VERSIONES) {
    assert.match(String(v.version), /^\d+\.\d+\.\d+$/, `versión rara: ${v.version}`);
    assert.match(String(v.fecha), /^\d{4}-\d{2}-\d{2}$/, `${v.version}: fecha rara «${v.fecha}»`);
    assert.equal(typeof v.titulo, 'string', `${v.version}: sin título`);
    assert.ok(v.titulo.trim().length > 20, `${v.version}: el título no dice nada`);
  }
});

test('ninguna entrada lleva código adentro', () => {
  /*
   * Ésta es la que habría atajado las cinco entradas de basura. Un título es
   * una frase escrita para que la lea la iglesia: si adentro aparece un trozo
   * del propio programa, es que algo se copió donde no correspondía.
   */
  const marcas = ['const VERSIONES', 'module.exports', 'require(\'./', '/* eslint'];
  for (const v of VERSIONES) {
    for (const marca of marcas) {
      assert.ok(!v.titulo.includes(marca),
        `la entrada ${v.version} lleva «${marca}» adentro: se le copió código al título`);
    }
  }
});

test('y ninguna es descomunal', () => {
  /*
   * El tope es generoso a propósito: las entradas de este sistema son largas
   * porque cuentan lo que se midió, y la más larga anda por los cinco mil
   * caracteres. Doce mil deja sitio de sobra para una entrada bien contada y
   * ataja de lejos un archivo entero copiado por error.
   */
  const TOPE = 12000;
  const largas = VERSIONES.filter((v) => v.titulo.length > TOPE)
    .map((v) => `${v.version} (${v.titulo.length})`);
  assert.deepEqual(largas, [], `entradas por sobre los ${TOPE} caracteres: ${largas.join(', ')}`);
});

test('no hay dos entradas para la misma versión', () => {
  const vistas = new Map();
  const repetidas = [];
  for (const v of VERSIONES) {
    if (vistas.has(v.version)) repetidas.push(v.version);
    vistas.set(v.version, true);
  }
  assert.deepEqual(repetidas, [], `versiones repetidas: ${repetidas.join(', ')}`);
});

test('van de la más nueva a la más vieja', () => {
  const comoNumero = (v) => v.split('.').map(Number);
  const desordenadas = [];
  for (let i = 1; i < VERSIONES.length; i++) {
    const [a1, b1, c1] = comoNumero(VERSIONES[i - 1].version);
    const [a2, b2, c2] = comoNumero(VERSIONES[i].version);
    const antes = a1 * 1e6 + b1 * 1e3 + c1;
    const despues = a2 * 1e6 + b2 * 1e3 + c2;
    if (despues >= antes) desordenadas.push(`${VERSIONES[i - 1].version} → ${VERSIONES[i].version}`);
  }
  assert.deepEqual(desordenadas, [], `están fuera de orden: ${desordenadas.join(', ')}`);
});

test('la versión que corre está anotada, y es la primera de la lista', () => {
  const corriendo = require('../../package.json').version;
  assert.equal(VERSIONES[0].version, corriendo,
    'la entrada más nueva tiene que ser la de la versión que se está publicando');
});

test('la pantalla las pide y el servidor se las da', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', '/configuracion/versiones');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(r.json.corriendo, require('../../package.json').version);
  assert.equal(r.json.anotada, true, 'el servidor dice si la versión que corre está en la lista');
  assert.equal(r.json.versiones.length, VERSIONES.length);
});

test('lo que se manda por esa ruta pesa lo que tiene que pesar', async () => {
  /*
   * Se manda el historial ENTERO en una sola respuesta, así que su tamaño es
   * algo que hay que mirar: es lo que baja un teléfono al abrir esa pantalla.
   * Con las cinco entradas de basura eran 16,8 MB.
   */
  const api = await elSistemaAndando();
  const r = await api('GET', '/configuracion/versiones');
  const mb = Buffer.byteLength(r.texto) / (1024 * 1024);
  assert.ok(mb < 2, `la pantalla de versiones baja ${mb.toFixed(1)} MB`);
});
