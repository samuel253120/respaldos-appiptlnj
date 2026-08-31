/**
 * El aviso de lo prestado que hay que devolver, y la hoja que se firma.
 *
 * Un hermano presta algo para el aniversario y a los dos meses nadie se
 * acuerda: quien lo recibió puede llevar un año sin venir, y el dueño termina
 * teniendo que ir a pedirlo. El sistema ya sabía avisar de una credencial por
 * vencer, de un documento de la carpeta, de una ayuda que nadie entregó y de
 * cuotas al debe; esto es una línea más en el mismo vigía.
 *
 * Lo que está EN DEPÓSITO no avisa, a propósito: ahí no hay plazo ni compromiso
 * de devolver nada. La cosa está guardada por voluntad de su dueño y él la
 * retira cuando quiera.
 *
 * Y la hoja: es lo que hace que el régimen sirva fuera de la pantalla. Sin ella
 * la responsabilidad queda de palabra, en una nota sin fecha, sin firma y que
 * el dueño nunca vio.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const inventarios = require('../../server/modules/inventarios');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Aviso','IG-AVI','Activa')")
  .run().lastInsertRowid;
const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };

let n = 0;
/** Un artículo puesto directo en la base, con los días que se le digan. */
const anotar = ({ regimen = 'Prestado', dias = null, devuelto = null, dueno = 'Juan Pérez' }) => {
  const cuando = dias === null ? null
    : db.prepare("SELECT date('now','localtime', ? || ' days') AS d").get(String(dias)).d;
  return db
    .prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cantidad, regimen, dueno,
                                       fecha_devolucion, fecha_devuelto)
              VALUES (?, 'Iglesia local', ?, 1, ?, ?, ?, ?)`)
    .run(`Prestado ${++n} del Aviso`, iglesia, regimen, dueno, cuando, devuelto).lastInsertRowid;
};
/** Solo los de esta prueba: la base es compartida y corren varios archivos a la vez. */
const losMios = (usuario = admin, dentroDe = 15) =>
  inventarios.porVencer(usuario, dentroDe).filter((a) => /del Aviso$/.test(a.articulo));

// ------------------------------------------------ a quién le toca salir ----

test('lo prestado con fecha dentro del plazo sale en el aviso', () => {
  const id = anotar({ dias: 5 });
  const suyo = losMios().find((a) => a.id === id);
  assert.ok(suyo, 'tendría que salir: se devuelve en cinco días');
  assert.equal(suyo.dias, 5);
  assert.equal(suyo.dueno, 'Juan Pérez');
});

test('y lo que ya se pasó de la fecha sale con los días en negativo', () => {
  /*
   * Algo que había que devolver hace un mes es más urgente que algo que vence
   * en veinte días, y los dos tienen que salir en la misma lista.
   */
  const id = anotar({ dias: -30 });
  const suyo = losMios().find((a) => a.id === id);
  assert.ok(suyo);
  assert.equal(suyo.dias, -30);
});

test('lo que se devuelve más allá del plazo todavía no avisa', () => {
  const id = anotar({ dias: 90 });
  assert.equal(losMios().find((a) => a.id === id), undefined);
});

test('lo ya devuelto no vuelve a avisar nunca', () => {
  const id = anotar({ dias: -30, devuelto: '2026-01-15' });
  assert.equal(losMios().find((a) => a.id === id), undefined,
    'la fecha de devolución real es el fin del asunto');
});

test('un préstamo sin plazo no avisa: no hay fecha que se pueda pasar', () => {
  const id = anotar({ dias: null });
  assert.equal(losMios().find((a) => a.id === id), undefined);
});

test('lo que está EN DEPÓSITO no avisa aunque tenga fecha', () => {
  /*
   * No es un olvido: ahí no hay compromiso de devolver nada. La cosa está
   * guardada por voluntad de su dueño y él la retira cuando quiera.
   */
  const id = anotar({ regimen: 'En depósito', dias: -5 });
  assert.equal(losMios().find((a) => a.id === id), undefined);
});

test('y lo propio tampoco, por si a alguien le queda una fecha puesta', () => {
  const id = anotar({ regimen: 'Propio', dias: -5 });
  assert.equal(losMios().find((a) => a.id === id), undefined);
});

// ------------------------------------------- cada uno ve lo suyo ----

test('quien administra otra iglesia no ve estos préstamos', () => {
  anotar({ dias: 3 });
  const otra = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Ajena del Aviso','IG-AVJ','Activa')")
    .run().lastInsertRowid;
  const deOtra = { id: 2, rol: 'secretaria', iglesias: JSON.stringify([otra]), cuerpos: '[]' };
  assert.equal(losMios(deOtra).length, 0, 'el alcance es el mismo del listado, no uno escrito aparte');
});

// ------------------------------------------------- el vigía lo conoce ----

test('el vigía lo revisa y el aviso tiene su tipo declarado', () => {
  const vigia = fs.readFileSync(path.join(__dirname, '../../server/avisos/vigia.js'), 'utf8');
  assert.match(vigia, /const REVISIONES = \[[^\]]*prestamosPorDevolver/s,
    'una revisión que no está en la lista no corre nunca');
  assert.match(vigia, /tipo: 'prestamo_por_devolver'/);

  const { TIPOS } = require('../../server/avisos/avisos');
  assert.ok(TIPOS.prestamo_por_devolver, 'sin tipo declarado el aviso no se puede apagar ni explicar');
  assert.equal(TIPOS.prestamo_por_devolver.llave, 'inventarios',
    'solo a quien lleva el inventario: para el resto es un aviso sobre algo que no está en sus manos');
});

test('el plazo del aviso lo pone Configuración, no el código', () => {
  /*
   * No basta con que la opción exista: hay que ver que el aviso la MIRE. La
   * primera versión de esta prueba solo comprobaba que estuviera declarada y
   * que valiera 15, y con eso reemplazar la lectura de la configuración por un
   * 15 escrito a mano no rompía nada: la opción quedaba de adorno y moverla en
   * la pantalla no habría cambiado el aviso.
   *
   * Así que se mueve de verdad y se mira si la ventana se movió. Se llama a
   * `porVencer` SIN decirle los días, que es como la llama el vigía.
   */
  const ajustes = require('../../server/ajustes');
  const item = ajustes.POR_CLAVE['inventario_aviso_devolucion_dias'];
  assert.ok(item, 'no está la opción');
  assert.equal(item.tipo, 'number');
  assert.equal(item.defecto, '15');

  const id = anotar({ dias: 40 });
  const sale = () => !!inventarios.porVencer(admin).find((a) => a.id === id);
  const antes = ajustes.obtener('inventario_aviso_devolucion_dias');
  try {
    ajustes.guardar('inventario_aviso_devolucion_dias', '10', null);
    assert.equal(sale(), false, 'a 10 días, algo que se devuelve en 40 todavía no avisa');
    ajustes.guardar('inventario_aviso_devolucion_dias', '60', null);
    assert.equal(sale(), true, 'a 60 días, sí');
  } finally {
    ajustes.guardar('inventario_aviso_devolucion_dias', antes, null);
  }
  assert.equal(ajustes.numero('inventario_aviso_devolucion_dias', 1, 365), 15,
    'y queda como estaba: la base es compartida');
});

test('y el aviso lleva al listado ya filtrado por lo prestado', () => {
  const vigia = fs.readFileSync(path.join(__dirname, '../../server/avisos/vigia.js'), 'utf8');
  assert.match(vigia, /enlace: '#\/m\/inventarios\?f_regimen=Prestado'/,
    'llevar al listado entero obliga a buscar de nuevo lo que el aviso ya sabía');
});

// ------------------------------------------------------- la hoja ----

test('la hoja de un bien ajeno se arma aparte de la ficha corriente', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function printBienAjeno(');
  assert.ok(desde > 0, 'no está la hoja');
  const hoja = app.slice(desde, app.indexOf('\n}', desde));

  assert.match(hoja, /Constancia de depósito/);
  assert.match(hoja, /Constancia de préstamo/);
  assert.match(hoja, /acta-firmas/, 'un papel así se firma');
  assert.match(hoja, /Dueño del bien/);
  assert.match(hoja, /Por la iglesia/);
  assert.match(hoja, /dos copias/, 'una queda en la iglesia y la otra se la lleva el dueño');
  assert.match(hoja, /responde por él mientras lo tenga en su poder/,
    'en el préstamo la iglesia SÍ responde, y eso tiene que decirlo la hoja');
});

test('el texto del depósito no está escrito en la hoja: viene de Configuración', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function printBienAjeno(');
  const hoja = app.slice(desde, app.indexOf('\n}', desde));

  assert.match(hoja, /esc\(clausula \|\| ''\)/, 'sale tal cual como lo escribió la corporación');
  assert.doesNotMatch(hoja, /NO ASUME RESPONSABILIDAD/,
    'si estuviera acá, cambiarlo en Configuración no cambiaría el papel que se firma');
  assert.match(app, /\/inventarios\/clausula-deposito/, 'y se pide por su propia ruta');
});

test('la ruta de la cláusula pide la llave del inventario, no la de configuración', () => {
  /*
   * Quien lleva el inventario no tiene por qué poder ver la configuración del
   * sistema; sin esto se quedaría sin poder imprimir la hoja que necesita hacer
   * firmar. Y sale solo ese texto: no es una puerta trasera a lo demás.
   */
  const mod = fs.readFileSync(path.join(__dirname, '../../server/modules/inventarios.js'), 'utf8');
  assert.match(mod, /router\.get\('\/inventarios\/clausula-deposito', requirePerm\('inventarios', 'view'\)/);
  assert.match(mod, /obtener\('inventario_clausula_deposito'\)/);
});
