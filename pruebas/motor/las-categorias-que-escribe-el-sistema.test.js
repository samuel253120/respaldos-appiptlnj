/**
 * SIETE CATEGORÍAS LAS ESCRIBE EL SISTEMA, Y NO ESTABAN PROTEGIDAS DE NADA.
 *
 * La lista de categorías la mantiene la iglesia, y está bien. Pero hay siete
 * que no las elige nadie al anotar un movimiento: las escribe el propio sistema
 * al registrar un préstamo, un traspaso entre cajas, la ofrenda de un culto o
 * el pago de una cuota. Estaban escritas a mano en cinco archivos y la única
 * regla del módulo —«una categoría que ya se usó no se borra»— no las alcanzaba,
 * porque frena solo si la categoría YA TIENE movimientos.
 *
 * MEDIDO en la v1.341.0, instalación recién sembrada, contra el sistema
 * andando: las siete se borraron una tras otra, las siete con un 200 y sin una
 * palabra. Después se registró un préstamo del banco por $3.000.000 para
 * arreglar el techo:
 *
 *     Ingreso · «Préstamos recibidos» · $3.000.000
 *     ¿existe esa categoría en la lista? ....... NO
 *     ¿se ofrece al clasificar un ingreso? ..... NO
 *
 * Lo que cuida este archivo:
 *   · que las siete no se puedan borrar, tengan movimientos o no
 *   · que no se puedan renombrar
 *   · que SÍ se puedan desactivar, que es la salida buena
 *   · y que los cinco archivos que las escriben las tomen de un solo sitio, para
 *     que la lista protegida no se vuelva una copia que se desincroniza
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const CATEGORIAS = require('../../server/modules/categorias_tesoreria');
const {
  CATEGORIAS_DEL_SISTEMA, CATEGORIA, quienLaEscribe, laEscribeElSistema,
} = require('../../server/categorias-del-sistema');

const MARCA = `c${process.pid}`;

/** La fila de una categoría, creándola si hace falta. */
function unaCategoria(nombre, tipo = 'Ingreso') {
  const ya = db.prepare('SELECT * FROM categorias_tesoreria WHERE lower(nombre) = lower(?)').get(nombre);
  if (ya) return ya;
  const id = db
    .prepare("INSERT INTO categorias_tesoreria (nombre, tipo, activo) VALUES (?, ?, 1)")
    .run(nombre, tipo).lastInsertRowid;
  return db.prepare('SELECT * FROM categorias_tesoreria WHERE id = ?').get(id);
}

/** Los ganchos como los corre el motor. */
const alBorrar = (fila) => CATEGORIAS.hooks.beforeDelete(fila, { db });
const alGuardar = (data, existing) =>
  CATEGORIAS.hooks.beforeSave(data, { db, isNew: !existing, existing: existing || null, id: (existing || {}).id });

/* ------------------------------------------------- la lista, en un solo sitio */

test('las siete están declaradas, cada una con quién la escribe', () => {
  assert.equal(CATEGORIAS_DEL_SISTEMA.length, 7);
  for (const c of CATEGORIAS_DEL_SISTEMA) {
    assert.ok(c.nombre && c.nombre.trim(), 'cada una tiene nombre');
    assert.ok(c.quien && c.quien.trim(), 'y dice quién la escribe, que es lo que sale en el rechazo');
  }
});

test('los cinco archivos que las escriben las toman de acá, y no las repiten', () => {
  /*
   * Una lista de nombres protegidos escrita aparte de los nombres que se
   * escriben es una copia, y una copia se desincroniza: el día que alguien
   * cambiara «Traspaso» por otra cosa en traspasos.js, la guardia seguiría
   * cuidando el nombre viejo sin decir nada. Se comprueba leyendo el código.
   */
  const raiz = path.join(__dirname, '..', '..', 'server');
  const escriben = [
    'deuda-tesoreria.js', 'ofrenda-tesoreria.js', 'cuotas.js',
    path.join('modules', 'traspasos.js'), path.join('modules', 'tesoreria.js'),
  ];
  for (const archivo of escriben) {
    const texto = fs.readFileSync(path.join(raiz, archivo), 'utf8');
    assert.match(texto, /require\((['"])(\.\.?\/)+categorias-del-sistema\1\)/,
      `${archivo} tiene que tomar los nombres de categorias-del-sistema.js`);
  }
});

test('el valor de fábrica de la categoría de un movimiento sale de la misma lista', () => {
  const campo = require('../../server/modules/tesoreria').fields.find((f) => f.name === 'categoria');
  assert.equal(campo.default, CATEGORIA.OFRENDAS,
    'estaba escrito a mano: era un octavo sitio con un nombre de la lista congelado en el código');
});

test('quienLaEscribe no distingue mayúsculas', () => {
  assert.ok(quienLaEscribe('Ofrendas'));
  assert.ok(quienLaEscribe('ofrendas'), 'si no, bastaría con guardar «ofrendas» para esquivar la guardia');
  assert.ok(quienLaEscribe('  TRASPASO  '));
  assert.equal(quienLaEscribe('Diezmos'), null, 'las de la iglesia no son del sistema');
  assert.equal(laEscribeElSistema('Pro-Templo'), false);
});

/* ------------------------------------------------- no se borran */

test('ninguna de las siete se puede borrar, aunque no tenga ningún movimiento', () => {
  /*
   * Se comprueba el MOTIVO del rechazo y no solo que lo haya: las pruebas del
   * motor comparten una base, y algunas de las siete van a tener movimientos
   * puestos por otro archivo en ese mismo instante. Con el motivo a la vista,
   * un rechazo que venga de la cuenta de movimientos no vale como aprobado:
   * lo que se prueba es que la frene POR SER DEL SISTEMA.
   */
  for (const { nombre, quien } of CATEGORIAS_DEL_SISTEMA) {
    const fila = unaCategoria(nombre, 'Ambos');
    const freno = alBorrar(fila);
    assert.ok(freno, `«${nombre}» tiene que frenarse`);
    assert.match(freno, /no se puede borrar: la escribe/,
      `«${nombre}» se frenó, pero no por ser del sistema`);
    assert.ok(freno.includes(quien), 'y el rechazo dice quién la escribe');
  }
});

test('y el rechazo dice quién la escribe y qué hacer en cambio', () => {
  const freno = alBorrar(unaCategoria(CATEGORIA.DESEMBOLSO, 'Ingreso'));
  assert.match(freno, /Deudas y Compromisos/, 'nombra lo que la persona conoce, no un archivo');
  assert.match(freno, /En uso/, 'y ofrece la salida buena');
});

test('una categoría de la iglesia sin movimientos sí se borra: eso no cambia', () => {
  const suya = unaCategoria(`Pro-Templo Sede Sur ${MARCA}`, 'Ingreso');
  assert.equal(alBorrar(suya), null);
});

test('y una de la iglesia CON movimientos se sigue frenando, como antes', () => {
  const suya = unaCategoria(`Actividades del mes ${MARCA}`, 'Ingreso');
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto)
     VALUES (date('now','localtime'), 'Ingreso', ?, 'Una rifa', 1000)`
  ).run(suya.nombre);
  const freno = alBorrar(suya);
  assert.ok(freno);
  assert.match(freno, /movimiento\(s\) de tesorería/);
});

/* ------------------------------------------------- no se renombran */

test('ninguna de las siete se puede renombrar', () => {
  for (const { nombre } of CATEGORIAS_DEL_SISTEMA) {
    const fila = unaCategoria(nombre, 'Ambos');
    const freno = alGuardar({ ...fila, nombre: `${nombre} de la iglesia` }, fila);
    assert.ok(freno, `«${nombre}» tiene que frenarse al renombrarse`);
    assert.match(freno, /no se puede cambiar/);
  }
});

test('cambiar mayúsculas o espacios no cuenta como renombrar', () => {
  const fila = unaCategoria(CATEGORIA.TRASPASO, 'Ambos');
  assert.equal(alGuardar({ ...fila, nombre: '  Traspaso  ' }, fila), null,
    'no es un nombre nuevo: es el mismo escrito distinto');
});

test('guardar sin tocar el nombre no se frena: hay que poder desactivarla', () => {
  const fila = unaCategoria(CATEGORIA.OFRENDAS, 'Ingreso');
  assert.equal(alGuardar({ ...fila, activo: 0 }, fila), null);
  assert.equal(alGuardar({ activo: 0 }, fila), null, 'ni mandando solo lo que cambia');
});

test('una categoría de la iglesia sí se renombra: eso no cambia', () => {
  const suya = unaCategoria(`Ofrenda especial ${MARCA}`, 'Ingreso');
  assert.equal(alGuardar({ ...suya, nombre: `Ofrenda de aniversario ${MARCA}` }, suya), null);
});

test('y crear una nueva nunca se frena', () => {
  assert.equal(alGuardar({ nombre: CATEGORIA.OFRENDAS, tipo: 'Ingreso' }, null), null);
});

/* ------------------------------------------------- la salida buena */

test('desactivarla la saca del desplegable y la deja existiendo', () => {
  /*
   * Es la salida que el rechazo ofrece, así que tiene que funcionar: una
   * iglesia que nunca ha pedido un préstamo saca esas cuatro de la lista, y el
   * día que de verdad pida uno el movimiento cae en una categoría que existe.
   */
  const fila = unaCategoria(CATEGORIA.PRESTADO, 'Egreso');
  db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?').run(fila.id);
  try {
    const ofrecidas = db
      .prepare("SELECT nombre FROM categorias_tesoreria WHERE activo = 1 AND tipo IN ('Egreso','Ambos')")
      .all().map((f) => f.nombre);
    assert.ok(!ofrecidas.includes(CATEGORIA.PRESTADO), 'desactivada, no se ofrece');
    assert.ok(
      db.prepare('SELECT id FROM categorias_tesoreria WHERE id = ?').get(fila.id),
      'pero sigue estando: el nombre sigue queriendo decir algo'
    );
  } finally {
    db.prepare('UPDATE categorias_tesoreria SET activo = 1 WHERE id = ?').run(fila.id);
  }
});
