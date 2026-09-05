/**
 * UNA NEGACIÓN NO HEREDA EL COLOR DE LO QUE NIEGA, NI «INACTIVO» EL DE «ACTIVO».
 *
 * Los colores de las píldoras de estado se deciden buscando trozos de palabra.
 * Buscarlos en CUALQUIER PARTE de la palabra tenía tres consecuencias medidas
 * en la v1.399.0:
 *
 *   «No aprobado (se extiende la prueba)» ..  VERDE, porque contiene «aprobad»
 *   «Inactivo» / «Inactiva» ...............  VERDE, porque contienen «activ»
 *   «Traslado de membresía» ...............  VERDE, porque «membresía» lleva «sí»
 *
 * El segundo es el peor y no es de ningún módulo en particular: un cuerpo
 * disuelto y una congregación cerrada se veían con el color de lo que está
 * bien, en todo el sistema. Comprobado en la pantalla, en el listado de
 * Cuerpos: la píldora de «Inactivo» venía con fondo verde (#DCFCE7). Y la
 * regla que los pinta de rojo está escrita en la línea siguiente y no llegaba
 * a correr nunca, porque la verde ganaba antes.
 *
 * Es la misma familia de defectos que la 1.352.0: comparar texto sin mirar
 * cómo está escrito.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { modules } = require('../../server/registry');

/** La función de verdad, sacada de la pantalla: probar una copia no prueba nada. */
function badgeClassDeLaPantalla() {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const i = app.indexOf('function badgeClass');
  assert.ok(i > 0, 'se encontró badgeClass en la pantalla');
  const trozo = app.slice(i, app.indexOf('\n}\n', i) + 3);
  assert.ok(trozo.length < 3000, `el recorte mide ${trozo.length}: es una red por si el corte se corriera`);
  // eslint-disable-next-line no-eval
  return eval(`(${trozo.replace('function badgeClass', 'function')})`);
}

const badgeClass = badgeClassDeLaPantalla();

test('lo negado no se pinta como lo afirmado', () => {
  assert.equal(badgeClass('Aprobado'), 'green');
  assert.notEqual(badgeClass('No aprobado (se extiende la prueba)'), 'green',
    'era el resultado de que a alguien no se le aprobara su prueba, en verde');
  assert.notEqual(badgeClass('Sin definir'), 'green');
  assert.notEqual(badgeClass('Nunca entregado'), 'green');
});

test('«Inactivo» se pinta como lo que es, y no como «Activo»', () => {
  assert.equal(badgeClass('Activo'), 'green');
  assert.equal(badgeClass('Activa'), 'green');
  assert.equal(badgeClass('Inactivo'), 'red', 'un cuerpo disuelto no está bien');
  assert.equal(badgeClass('Inactiva'), 'red', 'ni una congregación cerrada');
});

test('y un trozo en medio de una palabra ya no decide el color', () => {
  assert.notEqual(badgeClass('Traslado de membresía'), 'green',
    '«membresía» contiene «sí», y un tipo de solicitud no es bueno ni malo');
});

test('ningún trozo decide el color desde el medio de una palabra', () => {
  /*
   * Los tres grupos se anclaron, no solo el verde. Hoy el único valor del
   * sistema que caía en la trampa por el lado rojo o el amarillo no existe
   * —se contaron los 356 y ninguno lleva un trozo rojo dentro de otra
   * palabra—, así que estas tres se comprueban con valores construidos: la
   * trampa es de la manera de decidir el color y vale igual para los tres.
   *
   * Los tres son palabras que este sistema usa a diario en otras partes:
   * «desactivado» está en las cuatro listas que la iglesia mantiene,
   * «predisciplinar» en el vocabulario de la organización, y «prerevisión» es
   * la forma en que se nombra una comprobación previa.
   */
  assert.notEqual(badgeClass('Desactivado'), 'green', 'lleva «activ» en el medio');
  assert.notEqual(badgeClass('Predisciplinar'), 'red', 'lleva «disciplina» en el medio');
  assert.notEqual(badgeClass('Prerevisión'), 'yellow', 'lleva «revisi» en el medio');
});

test('lo que ya estaba bien sigue igual', () => {
  // El anclaje no puede llevarse por delante lo que funcionaba: se comprueban
  // los tres colores por sus casos corrientes.
  assert.equal(badgeClass('Vigente'), 'green');
  assert.equal(badgeClass('Firmada'), 'green');
  assert.equal(badgeClass('Emitido'), 'green');
  assert.equal(badgeClass('Anulado'), 'red');
  assert.equal(badgeClass('Vencida'), 'red');
  assert.equal(badgeClass('Fallecido'), 'red');
  assert.equal(badgeClass('Pendiente'), 'yellow');
  assert.equal(badgeClass('Borrador'), 'yellow');
  assert.equal(badgeClass('Retirado del cuerpo'), 'blue');
});

test('de los 356 valores del sistema, solo cambian los cuatro que estaban mal', () => {
  /*
   * La red que hace que este arreglo se pueda mirar entero: se recorren todos
   * los valores de todos los desplegables de los cuarenta y un módulos y se
   * cuenta cuántos cambian de color. Si mañana alguien toca los patrones y se
   * lleva por delante otros, esta cuenta lo dice.
   */
  const comoEraAntes = (value) => {
    const v = String(value || '').toLowerCase();
    if (/(activ|vigente|aprobad|firmad|emitido|entregad|bueno|completad|ingreso|sí)/.test(v)) return 'green';
    if (/(inactiv|anulad|vencid|rechazad|fallecid|malo|de baja|suspendid|egreso|disciplina)/.test(v)) return 'red';
    if (/(pendiente|borrador|revisi|solicitad|regular|reparaci)/.test(v)) return 'yellow';
    return 'blue';
  };
  const todos = Array.isArray(modules) ? modules : Object.values(modules);
  const vistos = new Set();
  const cambian = [];
  for (const def of todos) {
    for (const f of def.fields || []) {
      if (f.type !== 'select' || !f.options) continue;
      for (const o of f.options) {
        const v = typeof o === 'object' ? o.value : o;
        if (vistos.has(v)) continue;
        vistos.add(v);
        if (comoEraAntes(v) !== badgeClass(v)) cambian.push(v);
      }
    }
  }
  assert.ok(vistos.size > 300, `se recorrieron ${vistos.size} valores distintos`);
  assert.deepEqual(cambian.sort(), [
    'Inactiva', 'Inactivo', 'No aprobado (se extiende la prueba)', 'Traslado de membresía',
  ], `cambiaron: ${JSON.stringify(cambian)}`);
});

test('el resultado de una evaluación no viene decidido de fábrica', () => {
  const evaluaciones = require('../../server/modules/evaluaciones_integrantes');
  const campo = evaluaciones.fields.find((f) => f.name === 'resultado');
  assert.equal(campo.default, undefined,
    'traer «Aprobado» puesto invita a aprobar por descuido, y además dejaba al buen '
    + 'resultado como el único de los tres sin distintivo en el listado');
  assert.equal(campo.required, true, 'pero sigue habiendo que elegir uno');
});
