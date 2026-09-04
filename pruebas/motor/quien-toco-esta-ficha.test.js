/**
 * «¿Quién cambió este monto?», preguntado desde la ficha del movimiento.
 *
 * Es la frase con que el Registro de Cambios explica para qué existe, y era lo
 * único que no se podía hacer con él: la pantalla no lo nombraba ni una vez
 * —cero enlaces en todo el sistema—, así que desde un movimiento, un usuario o
 * una cuenta no había manera de llegar a sus líneas. Quedaba abrir el Registro
 * entero y buscar por el texto del concepto, mirando la lista.
 *
 * El servidor sí sabía acotarlo. Lo que se vigila acá:
 *
 *   · que haga falta el MÓDULO Y EL NÚMERO juntos —el registro n.º 1 puede ser
 *     un movimiento, un miembro o un acta, y por su número solo salen los tres—;
 *   · que la ficha lo pida así y lo pinte al pie de sus datos;
 *   · y que no dibuje nada cuando no hay ninguna línea, que es lo que pasa en
 *     la mayoría de las fichas: solo dejan rastro los módulos que el registro
 *     vigila.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { consultaDeUnListado } = require('../../server/crud');

const registro = getModule('registro_cambios');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Ficha QT','QT-FIC','Activa')")
  .run().lastInsertRowid;

/*
 * El mismo NÚMERO en dos módulos distintos, que es justamente el caso que hace
 * falta distinguir. Se usa uno alto y propio de esta prueba: los archivos del
 * motor comparten la base y corren en paralelo, así que el n.º 1 de verdad
 * tiene dueños que no son de acá.
 */
const NUMERO = 909091;
const anotar = (modulo, accion, detalle) => db
  .prepare(
    `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id)
     VALUES ('2026-08-02','11:00',?,?,'De la prueba QT',?,?,'Tesorero QT',?)`
  ).run(modulo, accion, NUMERO, detalle, iglesia).lastInsertRowid;

anotar('Tesorería', 'Creación', 'Monto: $ 445.000');
anotar('Tesorería', 'Cambio', 'Monto: $ 445.000 → $ 990.000');
anotar('Miembros', 'Eliminación', 'Nombres: Otra Persona QT');

/** Cuántas líneas de esta prueba devuelve el listado con estos parámetros. */
function listadoDa(query) {
  const { whereSql, params } = consultaDeUnListado(registro, { query, user: { id: 1, rol: 'admin' } });
  return db
    .prepare(`SELECT COUNT(*) c FROM registro_cambios ${whereSql}${whereSql ? ' AND' : ' WHERE'} iglesia_id = ?`)
    .get(...params, iglesia).c;
}

test('el número del registro solo no basta: trae las de los otros módulos', () => {
  assert.equal(listadoDa({ f_registro_id: String(NUMERO) }), 3,
    'el mismo número existe en Tesorería y en Miembros');
});

test('con el módulo y el número, salen las de esa ficha y ninguna más', () => {
  assert.equal(listadoDa({ f_modulo: 'Tesorería', f_registro_id: String(NUMERO) }), 2);
  assert.equal(listadoDa({ f_modulo: 'Miembros', f_registro_id: String(NUMERO) }), 1);
});

test('y de una ficha sin líneas no sale ninguna', () => {
  assert.equal(listadoDa({ f_modulo: 'Tesorería', f_registro_id: String(NUMERO + 1) }), 0);
});

/* ------------------------------------------------------ lo que hace la ficha */

const laFuncion = (() => {
  const desde = app.indexOf('async function renderElRegistroDeLaFicha');
  assert.ok(desde > 0, 'la ficha no tiene de dónde sacar sus líneas del registro');
  return app.slice(desde, app.indexOf('\n}', desde));
})();

test('la ficha pide las líneas de ESTA ficha: el módulo y el número juntos', () => {
  assert.match(laFuncion, /f_modulo=\$\{encodeURIComponent\(m\.label\)\}/,
    'por el nombre del módulo, que es lo que queda escrito en la línea');
  assert.match(laFuncion, /f_registro_id=\$\{encodeURIComponent\(id\)\}/);
});

test('y la pide en cualquier ficha, no en una lista de módulos escrita a mano', () => {
  /*
   * Deja líneas mucho más que la lista de módulos vigilados: hay una docena de
   * rutas que anotan por su cuenta —emitir una credencial, anotar el pago de
   * una deuda, cambiar un perfil de permisos—. Una lista acá se quedaría vieja
   * sin que nadie lo notara, así que se le pregunta al servidor y se dibuja lo
   * que conteste.
   */
  const desde = app.indexOf('alPie(renderElRegistroDeLaFicha');
  assert.ok(desde > 0, 'la ficha no lo llama');
  const linea = app.slice(app.lastIndexOf('\n', desde), desde);
  assert.ok(!/if \(name ===/.test(linea), 'no se lo reserva a un módulo en particular');
});

test('sin líneas no dibuja nada, y a quien no alcanza el módulo tampoco', () => {
  assert.match(laFuncion, /if \(!datos\.rows\.length\) return;/,
    'una tarjeta vacía en cuarenta fichas es peor que no tenerla');
  assert.match(laFuncion, /const suyo = MOD\['registro_cambios'\];[\s\S]*if \(!suyo/,
    'MOD solo trae los módulos que esa persona alcanza');
  assert.match(laFuncion, /catch \(e\) \{\s*\n\s*return;/,
    'si no llega, la ficha se ve igual que siempre');
});

test('la línea se lee entera: qué pasó, cuándo, quién y qué cambió', () => {
  for (const dato of ['r.accion', 'r.detalle', 'r.hora', 'r.usuario']) {
    assert.ok(laFuncion.includes(dato), `falta ${dato} en la línea`);
  }
  assert.match(laFuncion, /fechaCorta\(r\.fecha\)/, 'la fecha como se lee acá');
});
