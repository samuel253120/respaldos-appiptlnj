/**
 * UN SÍ QUE NO SE ENTIENDE NO ES UN NO.
 *
 * Las columnas de Sí/No de una planilla se leían con una lista corta —«sí, si,
 * 1, true, verdadero, x, activo»— y CUALQUIER OTRA COSA se guardaba como «No»,
 * callando. Medido en la v1.386.0 sobre la columna «Este cuerpo cobra cuota
 * mensual»:
 *
 *   sí · 1 · true · VERDADERO ....... Sí
 *   no · 0 ......................... No
 *   Y · S · yes .................... No, sin aviso
 *   «tal vez» ...................... No, sin aviso
 *
 * Una planilla exportada de otro sistema con Y/N —o escrita por alguien que
 * puso «S»— dejaba todos los cuerpos sin cobrar cuota, todos los integrantes
 * sin eximir y todas las actas sin quórum, y el informe decía que las
 * quinientas filas habían entrado perfectas. Era el único dato que la planilla
 * cambiaba sin decirlo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');

const marca = process.pid % 100000;
const admin = { id: 1, rol: 'admin' };
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central SN ${marca}`, `SN-${marca}`).lastInsertRowid;

const cuerpos = getModule('cuerpos');
const conLaCasilla = (loQueDice) => prepararFila(cuerpos, {
  nombre: `Grupo SN ${marca}`, tipo: 'Grupo', iglesia_id: String(iglesia),
  ...(loQueDice === undefined ? {} : { cobra_cuota: loQueDice }),
}, admin);

test('las maneras de decir que sí se entienden todas', () => {
  for (const dice of ['sí', 'si', 'SI', 's', 'S', '1', 'true', 'TRUE', 'verdadero', 'v', 'x', 'X', 'activo', 'y', 'Y', 'yes']) {
    const { datos, errores } = conLaCasilla(dice);
    assert.deepEqual(errores, [], `«${dice}» tiene que entrar: ${JSON.stringify(errores)}`);
    assert.equal(datos.cobra_cuota, 1, `«${dice}» es un sí`);
  }
});

test('y las de decir que no, también', () => {
  for (const dice of ['no', 'NO', 'n', 'N', '0', 'false', 'falso', 'f', 'inactivo']) {
    const { datos, errores } = conLaCasilla(dice);
    assert.deepEqual(errores, [], `«${dice}» tiene que entrar: ${JSON.stringify(errores)}`);
    assert.equal(datos.cobra_cuota, 0, `«${dice}» es un no`);
  }
});

test('lo que no es ninguna de las dos cosas se rechaza, no se guarda como «No»', () => {
  for (const dice of ['tal vez', 'quizá', '2', 'xx', 'sipo', 'nel']) {
    const { errores } = conLaCasilla(dice);
    assert.equal(errores.length, 1, `«${dice}» tiene que dar un error y dio ${JSON.stringify(errores)}`);
    assert.match(errores[0], /no es un sí ni un no/);
    assert.match(errores[0], new RegExp(dice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'y tiene que decir qué decía la casilla, para poder encontrarla');
  }
});

test('una casilla vacía no es un «No»: se deja como venga de fábrica', () => {
  const vacia = conLaCasilla('   ');
  assert.deepEqual(vacia.errores, [], 'una casilla en blanco no es un error');
  const sinLaColumna = conLaCasilla(undefined);
  assert.equal(vacia.datos.cobra_cuota, sinLaColumna.datos.cobra_cuota,
    'en blanco tiene que quedar igual que si la columna no viniera');
});
