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

/* ------------------------------------------------- las que ya se perdieron */

test('las siete se reponen solas si a una base le faltan', () => {
  /*
   * La guardia impide borrarlas de aquí en adelante, pero no arregla una base a
   * la que ya se las borraron antes de la v1.342.0. Las cuatro de deudas se
   * sembraban UNA sola vez —quedaban marcadas como aplicadas— así que una base
   * a la que se le hubieran borrado no las recuperaba nunca. Ahora las dos
   * siembras se repiten en cada arranque y reponen lo que falte.
   */
  const migraciones = require('../../server/migraciones');
  const perdidas = [CATEGORIA.DESEMBOLSO, CATEGORIA.PAGO, CATEGORIA.COBRO, CATEGORIA.PRESTADO];
  for (const nombre of perdidas) unaCategoria(nombre, 'Ambos');

  const guardadas = db.prepare('SELECT id, nombre, tipo, activo FROM categorias_tesoreria WHERE lower(nombre) IN (?, ?, ?, ?)')
    .all(...perdidas.map((n) => n.toLowerCase()));
  assert.equal(guardadas.length, 4, 'las cuatro tienen que estar antes de borrarlas');

  // Se borran a mano, como estaban las bases dañadas, y se vuelve a sembrar
  db.prepare(`DELETE FROM categorias_tesoreria WHERE lower(nombre) IN (${perdidas.map(() => '?').join(',')})`)
    .run(...perdidas.map((n) => n.toLowerCase()));
  assert.equal(
    db.prepare(`SELECT COUNT(*) c FROM categorias_tesoreria WHERE lower(nombre) IN (${perdidas.map(() => '?').join(',')})`)
      .get(...perdidas.map((n) => n.toLowerCase())).c,
    0, 'quedaron borradas'
  );

  migraciones.categoriasDeLasDeudas();

  for (const nombre of perdidas) {
    assert.ok(
      db.prepare('SELECT id FROM categorias_tesoreria WHERE lower(nombre) = lower(?)').get(nombre),
      `«${nombre}» tiene que reponerse sola`
    );
  }
});

test('y repetirlo no duplica ninguna', () => {
  const migraciones = require('../../server/migraciones');
  const cuantas = () => db
    .prepare("SELECT COUNT(*) c FROM categorias_tesoreria WHERE lower(nombre) = lower(?)")
    .get(CATEGORIA.DESEMBOLSO).c;
  migraciones.categoriasDeLasDeudas();
  const antes = cuantas();
  migraciones.categoriasDeLasDeudas();
  assert.equal(cuantas(), antes, 'solo agrega las que falten');
  assert.equal(antes, 1);
});

/* ------------------------------------------------- y la que ya se usó tampoco */

/*
 * La otra puerta al mismo daño. El módulo frenaba el BORRADO de una categoría en
 * uso con un buen argumento —dejaría los movimientos «clasificados con un nombre
 * que ya no existe»— y dejaba el RENOMBRADO abierto y sin cartel.
 *
 * MEDIDO en la v1.341.0, con tres diezmos anotados por $445.000: borrar contestó
 * 400 con su mensaje; renombrar contestó 200 sin una palabra, y el informe quedó
 * partido en «Diezmos $445.000» y «Diezmos y primicias $150.000», para siempre.
 */
const conUnMovimiento = (nombre) => {
  const fila = unaCategoria(nombre, 'Ingreso');
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto)
     VALUES (date('now','localtime'), 'Ingreso', ?, 'Un diezmo', 120000)`
  ).run(nombre);
  return fila;
};

test('una categoría de la iglesia que ya se usó no se renombra', () => {
  const fila = conUnMovimiento(`Diezmos del norte ${MARCA}`);
  const freno = alGuardar({ ...fila, nombre: `Diezmos y primicias ${MARCA}` }, fila);
  assert.ok(freno, 'renombrarla hace el mismo daño que borrarla, que sí estaba frenado');
  assert.match(freno, /movimiento\(s\) de tesorería/);
  assert.match(freno, /no se le puede cambiar el nombre/);
});

test('y el rechazo dice cuántos son y qué hacer en cambio', () => {
  const fila = conUnMovimiento(`Ofrenda de misiones ${MARCA}`);
  const freno = alGuardar({ ...fila, nombre: `Misiones ${MARCA}` }, fila);
  assert.match(freno, /1 movimiento\(s\)/, 'dice cuántos hay');
  assert.match(freno, new RegExp(`Misiones ${MARCA}`), 'nombra el nombre nuevo que se quería');
  assert.match(freno, /créela como una categoría nueva y desmarque ésta en «En uso»/);
});

test('una que todavía no se ha usado sí se renombra: un error de tecleo se corrige', () => {
  const fila = unaCategoria(`Pro-Tenplo ${MARCA}`, 'Ingreso');
  assert.equal(alGuardar({ ...fila, nombre: `Pro-Templo ${MARCA}` }, fila), null);
});

test('y lo que no es el nombre se puede cambiar aunque tenga movimientos', () => {
  /*
   * Ésta es la que evita que la guardia se pase de la raya: desactivarla,
   * cambiarle el tipo o escribirle una nota tiene que seguir funcionando. Lo que
   * rompe el informe es el NOMBRE, y solo ése se cuida.
   */
  const fila = conUnMovimiento(`Actividades del año ${MARCA}`);
  assert.equal(alGuardar({ ...fila, activo: 0 }, fila), null, 'desactivarla es la salida que el rechazo ofrece');
  assert.equal(alGuardar({ ...fila, tipo: 'Ambos' }, fila), null);
  assert.equal(alGuardar({ ...fila, notas: 'Rifas y once solidarias' }, fila), null);
});

/* ------------------------------------------------- lo que queda anotado */

/*
 * Las categorías son el vocabulario con que queda clasificado cada peso, y no
 * estaban entre los módulos que el Registro de Cambios vigila. Eso dejaba
 * anotada justo la operación que el módulo no deja hacer, y sin anotar las dos
 * que sí cambian las cosas en silencio.
 *
 * MEDIDO en la v1.341.0, catorce cambios en una misma sesión: 7 borrados → 7
 * anotados; 1 renombrado → 0; 6 desactivaciones → 0. Los borrados quedaban
 * porque TODO lo que se borra se anota en cualquier módulo.
 */
test('las categorías están entre los módulos que el Registro de Cambios vigila', () => {
  const { MODULOS_VIGILADOS } = require('../../server/bitacora');
  assert.ok(MODULOS_VIGILADOS.includes('categorias_tesoreria'),
    'sin esto, renombrar o desactivar una categoría no deja rastro en ninguna parte');
});

test('y están junto al dinero, que es de lo que hablan', () => {
  const { MODULOS_VIGILADOS } = require('../../server/bitacora');
  for (const delDinero of ['tesoreria', 'cuentas_tesoreria', 'traspasos']) {
    assert.ok(MODULOS_VIGILADOS.includes(delDinero));
  }
});

test('renombrar una categoría sin usar queda anotado', () => {
  const fila = unaCategoria(`Pro-Tenplo del sur ${MARCA}`, 'Ingreso');
  const antes = db.prepare(
    "SELECT COUNT(*) c FROM registro_cambios WHERE modulo = 'Categorías de Tesorería' AND registro_id = ?"
  ).get(fila.id).c;

  require('../../server/bitacora').anotarCambio({
    def: CATEGORIAS, accion: 'Cambio',
    fila: { ...fila, nombre: `Pro-Templo del sur ${MARCA}` },
    usuario: { id: 1, nombre: 'La que ordenó la lista' },
    detalle: `Nombre de la categoría: ${fila.nombre} → Pro-Templo del sur ${MARCA}`,
  });

  const linea = db.prepare(
    `SELECT * FROM registro_cambios WHERE modulo = 'Categorías de Tesorería' AND registro_id = ?
      ORDER BY id DESC LIMIT 1`
  ).get(fila.id);
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE modulo = 'Categorías de Tesorería' AND registro_id = ?")
      .get(fila.id).c,
    antes + 1
  );
  assert.match(linea.detalle, /Pro-Tenplo del sur/, 'el detalle dice cómo se llamaba');
  assert.match(linea.detalle, /Pro-Templo del sur/, 'y cómo quedó');
  assert.ok(linea.usuario, 'y quién lo hizo');
});

/* ------------------------------------------------- que quede con qué clasificar */

/*
 * Desmarcar «En uso» es la salida que el propio módulo recomienda en vez de
 * borrar, y está bien. Pero no había ningún piso: se podían apagar todas.
 *
 * MEDIDO en la v1.341.0: se desactivaron las seis categorías de ingreso, una
 * por una, y ninguna dijo nada; la ruta que las ofrece devolvió cero; y la
 * ofrenda del domingo se anotó igual —201— con el valor de fábrica. La iglesia
 * quedaba anotando toda su plata bajo una palabra que ella misma había apagado.
 *
 * Se prueba sobre una lista PROPIA, no sobre la de la base: los archivos del
 * motor corren en paralelo y apagar de verdad las categorías de todos sería
 * dejar a los demás sin poder anotar nada. Se apaga todo lo que hay, se hacen
 * las comprobaciones y se deja como estaba.
 */
function conSoloEstasEncendidas(cuales, hacer) {
  const encendidas = db.prepare('SELECT id FROM categorias_tesoreria WHERE activo = 1').all().map((f) => f.id);
  const apagar = db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?');
  const prender = db.prepare('UPDATE categorias_tesoreria SET activo = 1 WHERE id = ?');
  db.transaction(() => { for (const id of encendidas) apagar.run(id); }).immediate();
  try {
    for (const id of cuales) prender.run(id);
    return hacer();
  } finally {
    db.transaction(() => {
      for (const id of cuales) apagar.run(id);
      for (const id of encendidas) prender.run(id);
    }).immediate();
  }
}

test('apagar la última categoría de un tipo se frena', () => {
  const unica = unaCategoria(`Ofrenda única ${MARCA}`, 'Ambos');
  const freno = conSoloEstasEncendidas([unica.id], () =>
    alGuardar({ ...unica, activo: 0 }, { ...unica, activo: 1 }));
  assert.ok(freno, 'sin ninguna encendida no hay con qué clasificar nada');
  assert.match(freno, /ni para los ingresos ni para los gastos/);
  assert.match(freno, /Deje al menos una en uso/);
});

test('y borrarla, también', () => {
  const unica = unaCategoria(`Ofrenda única para borrar ${MARCA}`, 'Ambos');
  const freno = conSoloEstasEncendidas([unica.id], () => alBorrar(unica));
  assert.ok(freno);
  assert.match(freno, /el desplegable saldría vacío/);
});

test('el aviso dice de qué lado se quedaría sin nada', () => {
  const deIngreso = unaCategoria(`Diezmo único ${MARCA}`, 'Ingreso');
  const deEgreso = unaCategoria(`Gasto único ${MARCA}`, 'Egreso');
  const freno = conSoloEstasEncendidas([deIngreso.id, deEgreso.id], () =>
    alGuardar({ ...deIngreso, activo: 0 }, { ...deIngreso, activo: 1 }));
  assert.match(freno, /para los ingresos/, 'se quedaría sin las de ingreso');
  assert.ok(!/gastos/.test(freno), 'las de gasto siguen, así que no se las nombra');
  assert.match(freno, /la ofrenda del domingo/, 'y pone el caso de ese lado');
});

test('cambiarle el tipo también cuenta: de «Ambos» a «Egreso» deja los ingresos en cero', () => {
  const unica = unaCategoria(`La de los dos lados ${MARCA}`, 'Ambos');
  const freno = conSoloEstasEncendidas([unica.id], () =>
    alGuardar({ ...unica, tipo: 'Egreso' }, unica));
  assert.ok(freno, 'no hace falta apagarla para dejar un lado sin nada');
  assert.match(freno, /para los ingresos/);
});

test('con otra encendida del mismo lado, apagarla no se frena', () => {
  const una = unaCategoria(`Ofrenda de la mañana ${MARCA}`, 'Ambos');
  const otra = unaCategoria(`Ofrenda de la tarde ${MARCA}`, 'Ambos');
  const freno = conSoloEstasEncendidas([una.id, otra.id], () =>
    alGuardar({ ...una, activo: 0 }, { ...una, activo: 1 }));
  assert.equal(freno, null, 'apagar una de dos es exactamente lo que hay que poder hacer');
});

test('y crear una nueva nunca se frena por esto', () => {
  const freno = conSoloEstasEncendidas([], () =>
    alGuardar({ nombre: `Recién creada ${MARCA}`, tipo: 'Ingreso', activo: 1 }, null));
  assert.equal(freno, null, 'crear es justamente la salida que el aviso propone');
});
