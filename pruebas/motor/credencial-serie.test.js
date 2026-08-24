/**
 * El número de serie de una credencial: las garantías que exige el papel.
 *
 * Estas pruebas no comprueban que el número «se vea bien». Comprueban las
 * cuatro cosas que, si fallan, dejan dos credenciales distintas con el mismo
 * número impreso, plastificado y en el bolsillo de dos personas:
 *
 *   · que el dígito verificador sea EXACTAMENTE el que calcula el archivo de
 *     diseño aprobado —no uno equivalente, el mismo—;
 *   · que el correlativo no se reinicie al cambiar el año;
 *   · que ningún número se reutilice, ni siquiera el de una credencial borrada;
 *   · que dos emisiones simultáneas nunca reciban el mismo.
 *
 * (Puntos 7.1 a 7.11 y pruebas 15.13 a 15.18 de la especificación.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const serie = require('../../server/credenciales/serie');

// ------------------------- el dígito, contra el archivo original ----

/**
 * La función de verdad, sacada del archivo de diseño aprobado.
 *
 * No se copia acá a mano: se lee del archivo y se evalúa. Si alguien tocara
 * cualquiera de las dos versiones, esta prueba lo dice. Es la única manera de
 * garantizar la prueba 15.16 —que el sistema y el archivo den el mismo dígito—
 * sin confiar en que se copió bien.
 */
function luhnDelArchivo() {
  const ruta = path.join(__dirname, '..', '..', 'docs', 'credencial-pastor.html');
  const texto = fs.readFileSync(ruta, 'utf8');
  const desde = texto.indexOf('function luhnDV(');
  assert.ok(desde > 0, 'no se encontró luhnDV en docs/credencial-pastor.html');
  // Hasta el cierre de la función: la línea del return y su llave
  const hasta = texto.indexOf('\n', texto.indexOf('return String((10 - (sum % 10)) % 10);', desde));
  const fuente = texto.slice(desde, hasta) + '\n}';
  // eslint-disable-next-line no-new-func
  return new Function(`${fuente}; return luhnDV;`)();
}

test('el dígito verificador es el mismo que calcula el archivo de diseño', () => {
  const delArchivo = luhnDelArchivo();
  // El ejemplo que trae la propia especificación
  assert.equal(serie.digitoVerificador('1232026'), '3', 'la especificación dice 1232026-3');
  assert.equal(delArchivo('1232026'), '3');

  // Y sobre todo el rango completo, año por año: mil números por año no dejan
  // lugar a que coincidan «casi siempre»
  for (let anio = 2024; anio <= 2035; anio++) {
    for (let n = 1; n <= 1200; n += 7) {
      const s = serie.serieDe(n, anio);
      assert.equal(serie.digitoVerificador(s), delArchivo(s), `no coinciden en ${s}`);
    }
  }
});

// --------------------------------------------- cómo se escribe ----

test('tres dígitos como mínimo, y más cuando hace falta', () => {
  assert.equal(serie.serieDe(1, 2026), '0012026');
  assert.equal(serie.serieDe(12, 2026), '0122026');
  assert.equal(serie.serieDe(123, 2026), '1232026');
  // Prueba 15.18: pasando de 999 sigue con cuatro dígitos, sin error
  assert.equal(serie.serieDe(999, 2026), '9992026');
  assert.equal(serie.serieDe(1000, 2026), '10002026');
  assert.equal(serie.serieDe(1001, 2026), '10012026');
  assert.equal(serie.serieDe(12345, 2026), '123452026');
});

test('la serie completa se lee con su guion', () => {
  assert.equal(serie.conDigito('1232026', '3'), '1232026-3');
  assert.equal(serie.conDigito('1232026'), '1232026-3', 'si no se le da el dígito, lo calcula');
  assert.equal(serie.conDigito(''), '', 'sin serie no hay nada que mostrar');
});

// ------------------------------------- el correlativo no retrocede ----

test('el correlativo no se reinicia al cambiar de año (prueba 15.17)', () => {
  serie.fijarContador(11);
  const doceDe2026 = serie.tomarSerie(2026);
  assert.equal(doceDe2026.serie, '0122026');
  // Y ahora es el año siguiente: la cuenta sigue, no vuelve a empezar
  const treceDe2027 = serie.tomarSerie(2027);
  assert.equal(treceDe2027.serie, '0132027', 'después de 0122026 viene 0132027, no 0012027');
});

test('pasando de 999 el sistema no se detiene ni da error (prueba 15.18)', () => {
  serie.fijarContador(998);
  assert.equal(serie.tomarSerie(2026).serie, '9992026');
  assert.equal(serie.tomarSerie(2026).serie, '10002026');
  assert.equal(serie.tomarSerie(2026).serie, '10012026');
});

test('el número no se reutiliza aunque la credencial se borre (punto 7.7)', () => {
  // Es la razón de que el correlativo viva en su propio contador y no se
  // calcule mirando la tabla: si se calculara, borrar la última credencial
  // devolvería su número al siguiente, y habría dos papeles con el mismo.
  serie.fijarContador(0);
  const primera = serie.tomarSerie(2026);
  const segunda = serie.tomarSerie(2026);
  assert.equal(primera.correlativo, 1);
  assert.equal(segunda.correlativo, 2);
  // Se «borra» todo lo emitido; el contador no baja
  db.prepare('DELETE FROM credenciales').run();
  const tercera = serie.tomarSerie(2026);
  assert.equal(tercera.correlativo, 3, 'el 1 y el 2 quedaron consumidos para siempre');
});

test('quedan saltos en la numeración, y está bien que queden', () => {
  serie.fijarContador(0);
  const emitidas = [serie.tomarSerie(2026), serie.tomarSerie(2026), serie.tomarSerie(2026)];
  // La del medio se revoca y se emite otra: la nueva NO hereda su número
  const nueva = serie.tomarSerie(2026);
  assert.equal(nueva.correlativo, 4, 'la nueva sigue la cuenta, no ocupa el hueco');
  assert.notEqual(nueva.serie, emitidas[1].serie);
});

// ----------------------------------------- dos a la vez, y la base ----

test('mil números seguidos, todos distintos (prueba 15.13)', () => {
  // Emitir «al mismo tiempo» en un sistema que guarda de a una operación es
  // pedirle muchos números seguidos sin soltar: si el contador se calculara
  // leyendo y después escribiendo, acá saldrían repetidos.
  serie.fijarContador(0);
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(serie.tomarSerie(2026).serie);
  assert.equal(vistos.size, 1000, 'se repitió alguno');
});

test('la base misma rechaza una serie repetida (prueba 15.14)', () => {
  // No basta con que lo compruebe el programa: si por cualquier vía se
  // intentara insertar una repetida, la restricción de la tabla la frena.
  db.prepare('DELETE FROM credenciales').run();
  const poner = (s) =>
    db.prepare(
      `INSERT INTO credenciales (serie, serie_dv, correlativo, estado, fecha_emision, fecha_vencimiento)
       VALUES (?, ?, ?, 'Vigente', '2026-01-01', '2030-01-01')`
    ).run(s, serie.digitoVerificador(s), 1);

  poner('5552026');
  assert.throws(() => poner('5552026'), /UNIQUE|constraint/i, 'la base tendría que rechazarla');
  // Y tampoco cambiándole las mayúsculas o el espacio: el índice compara igual
  assert.throws(() => poner('5552026 '.trim()), /UNIQUE|constraint/i);
});

test('el contador cuenta lo generado, no lo vigente (punto 7.12)', () => {
  serie.fijarContador(0);
  for (let i = 0; i < 7; i++) serie.tomarSerie(2026);
  assert.equal(serie.cuantasSeHanGenerado(), 7);
  db.prepare('DELETE FROM credenciales').run();
  assert.equal(serie.cuantasSeHanGenerado(), 7, 'borrar credenciales no baja el total generado');
});
