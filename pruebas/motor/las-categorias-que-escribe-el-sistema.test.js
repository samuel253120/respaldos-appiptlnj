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
 *   · que las siete del sistema no se puedan renombrar
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

/* ------------------------------------------------- y la que ya se usó se lleva lo suyo */

/*
 * Antes el renombrado pasaba callado y hacía el mismo daño que el borrado, que
 * sí estaba frenado: los movimientos guardan el NOMBRE, así que seguían
 * diciendo el viejo. MEDIDO en la v1.341.0, con tres diezmos por $445.000:
 * borrar contestó 400 con su mensaje; renombrar contestó 200 sin una palabra, y
 * el informe quedó partido en «Diezmos $445.000» y «Diezmos y primicias
 * $150.000», para siempre.
 *
 * La v1.345.0 lo cerró rechazando el renombrado, y estaba mal elegido: le
 * quitaba a la iglesia una cosa que necesita hacer. Desde la v1.349.0 se
 * pregunta y, si dice que sí, el nombre nuevo SE LLEVA LOS MOVIMIENTOS.
 */
const conUnMovimiento = (nombre, cuantos = 1) => {
  const fila = unaCategoria(nombre, 'Ingreso');
  for (let i = 0; i < cuantos; i++) {
    db.prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto)
       VALUES (date('now','localtime'), 'Ingreso', ?, 'Un diezmo', 120000)`
    ).run(nombre);
  }
  return fila;
};

/** `afterSave` como lo corre el motor, dentro de su transacción. */
const alTerminarDeGuardar = (row, existing) =>
  CATEGORIAS.hooks.afterSave(row, { db, isNew: false, existing, user: { id: 1, nombre: 'La que ordenó la lista' } });

const cuantosDicen = (nombre) => db
  .prepare('SELECT COUNT(*) c FROM tesoreria WHERE categoria = ?').get(nombre).c;

test('renombrar una categoría que ya se usó se pregunta primero', () => {
  const fila = conUnMovimiento(`Diezmos del norte ${MARCA}`, 3);
  const r = alGuardar({ ...fila, nombre: `Diezmos y primicias ${MARCA}` }, fila);
  assert.ok(r && typeof r === 'object', 'no es un rechazo: es una pregunta');
  assert.ok(r.confirmar, 'la pantalla la convierte en dos botones');
  assert.match(r.confirmar, /3 movimiento\(s\)/, 'dice cuántos son');
  assert.match(r.confirmar, /pasan a quedar clasificados con el nombre nuevo/);
  assert.match(r.confirmar, /la fecha, el monto, el concepto y la cuenta quedan igual/,
    'y dice lo que NO se toca, que es lo que a nadie le da lo mismo');
});

test('y contestando que sí, no se frena', () => {
  const fila = conUnMovimiento(`Ofrenda de misiones ${MARCA}`);
  const r = CATEGORIAS.hooks.beforeSave(
    { ...fila, nombre: `Misiones ${MARCA}` },
    { db, isNew: false, existing: fila, id: fila.id, confirmado: true }
  );
  assert.equal(r, null, 'quien dijo que sí ya sabe lo que va a pasar');
});

test('el nombre nuevo se lleva los movimientos consigo', () => {
  const viejo = `Pro-Templo del cerro ${MARCA}`;
  const nuevo = `Pro-Templo Sede Sur ${MARCA}`;
  const fila = conUnMovimiento(viejo, 4);
  assert.equal(cuantosDicen(viejo), 4);

  alTerminarDeGuardar({ ...fila, nombre: nuevo }, fila);

  assert.equal(cuantosDicen(viejo), 0, 'ninguno se queda con el nombre viejo');
  assert.equal(cuantosDicen(nuevo), 4, 'los cuatro pasan al nuevo, y el informe no se parte');
});

test('y de cada movimiento no se toca nada más', () => {
  const viejo = `Ofrenda del aniversario ${MARCA}`;
  const nuevo = `Aniversario de la iglesia ${MARCA}`;
  const fila = unaCategoria(viejo, 'Ingreso');
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo)
     VALUES ('2026-03-15', 'Ingreso', ?, ?, 345678, 'Transferencia')`
  ).run(viejo, `Lo del aniversario ${MARCA}`);

  alTerminarDeGuardar({ ...fila, nombre: nuevo }, fila);

  const m = db.prepare('SELECT * FROM tesoreria WHERE concepto = ?').get(`Lo del aniversario ${MARCA}`);
  assert.equal(m.categoria, nuevo, 'la etiqueta cambia');
  assert.equal(m.fecha, '2026-03-15', 'la fecha no');
  assert.equal(m.monto, 345678, 'ni el monto');
  assert.equal(m.metodo, 'Transferencia', 'ni el método');
  assert.equal(m.tipo, 'Ingreso');
});

test('alcanza también lo que se anotó con otras mayúsculas', () => {
  /*
   * Antes de la v1.344.0 el guardado no normalizaba la categoría a como está
   * escrita en la lista, así que puede haber movimientos viejos con otra caja
   * de letras. Se arrastran igual.
   */
  const viejo = `Compras de la cocina ${MARCA}`;
  const nuevo = `Cocina y comedor ${MARCA}`;
  const fila = unaCategoria(viejo, 'Egreso');
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto)
     VALUES (date('now','localtime'), 'Egreso', ?, 'Ollas nuevas', 50000)`
  ).run(viejo.toLowerCase());

  alTerminarDeGuardar({ ...fila, nombre: nuevo }, fila);
  assert.equal(cuantosDicen(nuevo), 1, 'el de minúsculas también se lleva');
});

test('el arrastre queda anotado, con cuántos se movieron', () => {
  const viejo = `Rifas del cuerpo ${MARCA}`;
  const nuevo = `Actividades del cuerpo ${MARCA}`;
  const fila = conUnMovimiento(viejo, 2);

  alTerminarDeGuardar({ ...fila, nombre: nuevo }, fila);

  const linea = db.prepare(
    `SELECT * FROM registro_cambios WHERE modulo = 'Categorías de Tesorería' AND registro_id = ?
      ORDER BY id DESC LIMIT 1`
  ).get(fila.id);
  assert.ok(linea, 'esto no puede pasar en silencio');
  assert.match(linea.detalle, /2 movimiento\(s\)/);
  assert.match(linea.detalle, new RegExp(`«Rifas del cuerpo ${MARCA}».*«Actividades del cuerpo ${MARCA}»`));
  assert.ok(linea.usuario, 'y quién lo hizo');
});

test('una que todavía no se ha usado se renombra sin preguntar nada', () => {
  const fila = unaCategoria(`Pro-Tenplo ${MARCA}`, 'Ingreso');
  assert.equal(alGuardar({ ...fila, nombre: `Pro-Templo ${MARCA}` }, fila), null,
    'sin movimientos que mover no hay nada que advertir');
});

test('y lo que no es el nombre se guarda sin preguntar, aunque tenga movimientos', () => {
  const fila = conUnMovimiento(`Actividades del año ${MARCA}`);
  assert.equal(alGuardar({ ...fila, activo: 0 }, fila), null);
  assert.equal(alGuardar({ ...fila, tipo: 'Ambos' }, fila), null);
  assert.equal(alGuardar({ ...fila, notas: 'Rifas y once solidarias' }, fila), null);
});

test('y guardar sin cambiar el nombre no mueve ningún movimiento', () => {
  const nombre = `Donaciones del mes ${MARCA}`;
  const fila = conUnMovimiento(nombre, 2);
  alTerminarDeGuardar({ ...fila, notas: 'Lo que llega de afuera' }, fila);
  assert.equal(cuantosDicen(nombre), 2, 'siguen donde estaban');
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

/* ------------------------------------------------- y renombrando de verdad */

/*
 * Las de arriba llaman a los ganchos. Ésta pasa por el MOTOR, que es lo único
 * que la persona toca, y es donde de verdad importa: el guardado de la
 * categoría y el arrastre de sus movimientos van en la MISMA transacción, así
 * que o cambian los dos o no cambia ninguno.
 */
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('renombrando de verdad: primero pregunta, y al confirmar se lleva los movimientos', async () => {
  const api = await elSistemaAndando();

  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Central del renombre ${MARCA}`, `IGREN${String(process.pid).slice(-4)}`).lastInsertRowid;
  const caja = db
    .prepare("INSERT INTO cuentas_tesoreria (nombre, tipo, estado, iglesia_id) VALUES (?, 'Corriente', 'Activa', ?)")
    .run(`Caja del renombre ${MARCA}`, iglesia).lastInsertRowid;

  const viejo = `Pro-Templo del norte ${MARCA}`;
  const nuevo = `Pro-Templo Sede Norte ${MARCA}`;
  const creada = await api('POST', '/categorias_tesoreria', { nombre: viejo, tipo: 'Ingreso', activo: 1 });
  assert.equal(creada.estado, 201, JSON.stringify(creada.json));

  const hoy = db.prepare("SELECT date('now','localtime') d").get().d;
  for (const monto of [120000, 85000, 240000]) {
    const m = await api('POST', '/tesoreria', {
      fecha: hoy, tipo: 'Ingreso', categoria: viejo, concepto: `Aporte para el templo ${MARCA}`,
      monto, cuenta_id: caja, metodo: 'Efectivo', iglesia_id: iglesia,
    });
    assert.equal(m.estado, 201, JSON.stringify(m.json));
  }
  assert.equal(cuantosDicen(viejo), 3);

  // Sin confirmar: pregunta, y no toca nada
  const pregunta = await api('PUT', `/categorias_tesoreria/${creada.json.id}`, {
    ...creada.json, nombre: nuevo,
  });
  assert.equal(pregunta.estado, 400, 'una pregunta viaja como 400 con «confirmar»');
  assert.ok(pregunta.json.confirmar, JSON.stringify(pregunta.json));
  assert.match(pregunta.json.confirmar, /3 movimiento\(s\)/);
  assert.equal(cuantosDicen(viejo), 3, 'preguntar no cambia nada');
  assert.equal(
    db.prepare('SELECT nombre FROM categorias_tesoreria WHERE id = ?').get(creada.json.id).nombre,
    viejo,
    'ni siquiera el nombre de la categoría'
  );

  // Confirmando: se guarda, y los tres movimientos se van con ella
  const ahora = await api('PUT', `/categorias_tesoreria/${creada.json.id}`, {
    ...creada.json, nombre: nuevo, igual_asi: true,
  });
  assert.equal(ahora.estado, 200, JSON.stringify(ahora.json));
  assert.equal(ahora.json.nombre, nuevo);
  assert.equal(cuantosDicen(viejo), 0, 'ninguno se queda atrás');
  assert.equal(cuantosDicen(nuevo), 3, 'los tres pasan al nombre nuevo');
});

test('renombrando de verdad: el informe queda en una sola línea, no partido en dos', async () => {
  /*
   * Es el efecto medido en la revisión, visto desde donde se nota: el informe
   * agrupa por el texto guardado, así que con los movimientos arrastrados las
   * cuentas de esa categoría vuelven a sumar juntas.
   */
  const api = await elSistemaAndando();
  const nuevo = `Pro-Templo Sede Norte ${MARCA}`;
  const r = await api('GET', '/tesoreria/resumen');
  assert.equal(r.estado, 200);
  const suyas = (r.json.porCategoria || []).filter((c) => /Pro-Templo (del|Sede) Norte/.test(c.categoria));
  assert.equal(suyas.length, 1, `tendría que haber UNA línea, hay ${suyas.length}: ${JSON.stringify(suyas)}`);
  assert.equal(suyas[0].categoria, nuevo);
  assert.equal(suyas[0].total, 445000, 'los $445.000 sumados en una sola línea');
});
