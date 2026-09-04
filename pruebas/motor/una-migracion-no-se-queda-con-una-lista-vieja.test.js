/**
 * NINGUNA MIGRACIÓN GUARDA SU PROPIA COPIA DE UNA LISTA DEL SISTEMA.
 *
 * Varias migraciones ponen al día una columna comparándola contra la lista de
 * valores que ese campo admite: lo que calza se renombra, y lo que no, cae al
 * cajón de la lista. Mientras la copia y el original digan lo mismo, funciona.
 *
 * EL DÍA QUE DEJAN DE DECIR LO MISMO, la migración reescribe datos buenos. No
 * es un temor teórico: es lo que pasó con los tipos de actividad. La migración
 * tenía escritos a mano los doce nombres de cuando la lista vivía en el código;
 * la lista pasó a ser un dato que mantiene la iglesia; nadie volvió a mirar la
 * copia; y desde entonces cada arranque del servidor convertía en «Otros» toda
 * actividad con un tipo que la iglesia hubiera agregado. Medido en la revisión
 * del módulo: cuatro domingos de «Escuela Dominical» amanecidos como «Otros»,
 * con el tipo todavía ofreciéndose en el desplegable.
 *
 * Nada se ponía rojo. Ninguna prueba del sistema llamaba a esa migración.
 *
 * Esta prueba mira la FORMA del archivo, no su comportamiento, y por eso
 * atrapa la reincidencia antes de que llegue a los datos de nadie: si una
 * migración vuelve a tener adentro una lista que el sistema ya define en otra
 * parte, se pone roja acá.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { allModules } = require('../../server/registry');

const fuente = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');

/** Todos los arreglos de textos escritos a mano en el archivo. */
function losArreglosDeTextos(codigo) {
  const encontrados = [];
  for (const trozo of codigo.match(/\[[^[\]]*\]/g) || []) {
    const partes = trozo.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
    if (!partes.length) continue;
    if (!partes.every((t) => /^'[^']*'$/.test(t) || /^"[^"]*"$/.test(t))) continue;
    encontrados.push(partes.map((t) => t.slice(1, -1)));
  }
  return encontrados;
}

/** El cuerpo de una función del archivo, de su nombre a la que sigue. */
function elCuerpoDe(nombre) {
  const i = fuente.indexOf(`function ${nombre}(`);
  assert.ok(i >= 0, `no está la migración ${nombre}`);
  const j = fuente.indexOf('\nfunction ', i + 1);
  return fuente.slice(i, j < 0 ? undefined : j);
}

/** Las listas que los módulos ofrecen hoy, campo por campo. */
function lasListasDelSistema() {
  const listas = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      const op = (f.options || []).map((o) => (o && typeof o === 'object' ? o.value : o));
      // Tres o más: dos valores («Sí»/«No», «Activo»/«Inactivo») se repiten por
      // todas partes sin que eso signifique que alguien copió una lista.
      if (op.length >= 3) listas.push({ donde: `${m.name}.${f.name}`, valores: op });
    }
  }
  return listas;
}

const igualesSinOrden = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

test('ninguna migración tiene adentro una lista que un módulo ya ofrece', () => {
  const arreglos = losArreglosDeTextos(fuente);
  const copiadas = [];
  for (const { donde, valores } of lasListasDelSistema()) {
    if (arreglos.some((a) => igualesSinOrden(a, valores))) copiadas.push(donde);
  }
  assert.deepEqual(copiadas, [],
    'esa lista ya la define su módulo: pídasela con laListaQueOfrece() en vez de copiarla, '
    + 'o la migración se quedará con la copia vieja el día que el módulo cambie');
});

test('y la de los tipos de actividad ya no tiene ninguna: esa lista es de la iglesia', () => {
  const arreglos = losArreglosDeTextos(elCuerpoDe('tiposDeActividad'));
  assert.deepEqual(arreglos, [],
    'los doce nombres escritos a mano acá adentro son el hallazgo TA-01: cuando la lista pasó a '
    + 'ser un dato de la iglesia, esta copia empezó a borrar lo que la iglesia agregaba');
});

test('las que ponen al día una lista le preguntan al módulo cuál es', () => {
  for (const cual of ['formasDeIngreso', 'tiposDeServicio']) {
    assert.match(elCuerpoDe(cual), /laListaQueOfrece\(/,
      `${cual} tiene que preguntar la lista, no tenerla copiada`);
  }
});

test('y lo que preguntan es de verdad lo que el módulo ofrece', () => {
  /*
   * La prueba de arriba mira que se llame; ésta, que lo que llega sea la lista
   * y no una vacía —que dejaría la migración sin nada contra qué comparar—.
   */
  const { laListaQueOfrece } = require('../../server/migraciones');
  for (const [modulo, campo] of [['miembros', 'forma_ingreso'], ['servicios', 'tipo']]) {
    const lista = laListaQueOfrece(modulo, campo);
    assert.ok(lista.length >= 3, `${modulo}.${campo} llegó con ${lista.length} valor(es)`);
    assert.ok(lista.every((v) => typeof v === 'string' && v), 'y todos tienen que ser textos');
  }
});
