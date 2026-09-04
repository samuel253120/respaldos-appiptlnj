/**
 * Lo que el Registro de Cambios y los historiales dicen de más.
 *
 * El sistema reserva unas cuantas cifras con su propia llave: el monto de un
 * movimiento, el RUT y la fecha de nacimiento de una persona, su teléfono y su
 * dirección. Quien no tiene la llave no las ve en la ficha, no las baja en la
 * planilla y tampoco puede dar con alguien buscando por ellas, «que sería la
 * misma fuga por otra puerta».
 *
 * Había tres campos que las copiaban y quedaban fuera de esa regla, porque para
 * el módulo que los guarda son texto y nada más: el DETALLE de una línea del
 * Registro de Cambios, la DESCRIPCIÓN de la bitácora de un miembro y la del
 * historial de un pastor. Medido en la 1.368.0 con las dos llaves cerradas a
 * propósito: el monto llegaba «sin dato» en Tesorería y «Monto: $ 445.000 →
 * $ 990.000» en el Registro de Cambios; buscar esa cifra ahí devolvía la línea;
 * y la planilla salía con los montos y los RUT.
 *
 * Lo que se vigila acá:
 *
 *   · que el texto copiado se RECORTE al leerlo, dejando la etiqueta —«Monto:
 *     (reservado)» dice que el monto se tocó, que es lo que la llave promete—;
 *   · que a quien SÍ tiene la llave le llegue igual que antes, letra por letra:
 *     el registro existe para contestar «¿quién cambió este monto?»;
 *   · que no se pueda buscar ni filtrar por él sin las llaves;
 *   · y que los datos de SALUD no cierren nada, porque no viajan copiados: de
 *     ellos se anota que cambiaron, no cuáles eran.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const sensibles = require('../../server/sensibles');
const bitacora = require('../../server/bitacora');
const { consultaDeUnListado, expandRows } = require('../../server/crud');

const miembros = getModule('miembros');
const tesoreria = getModule('tesoreria');
const registro = getModule('registro_cambios');

/*
 * Los roles se nombran por su valor —«admin», no «Administrador»—, que es lo
 * que compara server/permissions.js. Las dos llaves vienen «para todos» de
 * fábrica, así que a quien no las tiene hay que quitárselas a mano, que es lo
 * que hace una iglesia que las restringe.
 */
const conLlaves = { id: 1, rol: 'admin' };
const sinMontos = { id: 2, rol: 'tesorero', permisos: JSON.stringify({ tesoreria_montos: [] }) };
const sinRut = { id: 3, rol: 'secretario', permisos: JSON.stringify({ miembros_identidad: [] }) };
/* La secretaria de verdad: le falta la llave de salud y ninguna otra. */
const sinSalud = { id: 4, rol: 'secretario' };

/* ------------------------------------------------ el recorte de un texto */

const UNA_LINEA = 'Fecha: 01-08-2026 · Concepto / Descripción: La ofrenda del domingo · Monto: $ 445.000 → $ 990.000';

test('el texto copiado le llega entero a quien tiene la llave', () => {
  assert.equal(sensibles.sinLoReservado(tesoreria, UNA_LINEA, conLlaves), UNA_LINEA);
});

test('y sin la cifra a quien no la tiene, pero con su etiqueta', () => {
  const recortada = sensibles.sinLoReservado(tesoreria, UNA_LINEA, sinMontos);
  assert.ok(!recortada.includes('445.000'), 'la cifra vieja no está');
  assert.ok(!recortada.includes('990.000'), 'la nueva tampoco');
  assert.match(recortada, /Monto: \(reservado\)/,
    'la etiqueta se queda: hay que poder ver QUE el monto se tocó');
  assert.match(recortada, /Concepto \/ Descripción: La ofrenda del domingo/,
    'lo que no es reservado no se toca');
  assert.match(recortada, /^Fecha: 01-08-2026 · /, 'ni lo de antes');
});

test('un valor con un punto medio adentro no deja escapar su segunda mitad', () => {
  /*
   * El corte no es por el separador a secas sino por la etiqueta que viene
   * detrás: si fuera por el separador, «Los Aromos 45 · depto 2» se partiría en
   * dos y «depto 2» se salvaría del recorte con la dirección entera adentro.
   */
  const linea = 'Nombres: Rosa · Dirección: Los Aromos 45 · depto 2 · Teléfono: 912345678 · Estado: Activo';
  const recortada = sensibles.sinLoReservado(miembros, linea, {
    id: 5, rol: 'secretario', permisos: JSON.stringify({ miembros_contacto: [] }),
  });
  assert.ok(!recortada.includes('Aromos'), 'la calle no está');
  assert.ok(!recortada.includes('depto 2'), 'ni lo que venía después del punto medio');
  assert.ok(!recortada.includes('912345678'), 'ni el teléfono');
  assert.match(recortada, /Nombres: Rosa/);
  assert.match(recortada, /Estado: Activo/);
});

test('de la salud no hay nada que tapar: no viaja copiada', () => {
  const linea = 'RUT: 15111222-6 → 17555444-0 · Enfermedades: actualizada';
  assert.equal(sensibles.sinLoReservado(miembros, linea, sinSalud), linea,
    'a la secretaria le llega igual: lo único reservado que trae es el RUT, y ese sí lo alcanza');
  assert.match(sensibles.sinLoReservado(miembros, linea, sinRut), /Enfermedades: actualizada/,
    'y a quien no alcanza el RUT se le tapa el RUT y no la línea de salud');
});

/* --------------------------------- la línea del Registro de Cambios entera */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Registro RD','REG-RD','Activa')")
  .run().lastInsertRowid;

const anotarLinea = (modulo, accion, detalle) => db
  .prepare(
    `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id)
     VALUES ('2026-08-01','10:00',?,?,'De la prueba RD',1,?,'Sistema',?)`
  ).run(modulo, accion, detalle, iglesia).lastInsertRowid;

const laLinea = (id, usuario) => expandRows(registro, [db.prepare('SELECT * FROM registro_cambios WHERE id = ?').get(id)], usuario)[0];

test('la línea de Tesorería se recorta al leerla, y por las cuatro puertas', () => {
  const id = anotarLinea('Tesorería', 'Cambio', 'Monto: $ 445.000 → $ 990.000');
  assert.equal(laLinea(id, conLlaves).detalle, 'Monto: $ 445.000 → $ 990.000');
  assert.equal(laLinea(id, sinMontos).detalle, 'Monto: (reservado)');
});

test('y la de un miembro borrado, con su RUT', () => {
  const id = anotarLinea('Miembros', 'Eliminación',
    'Nombres: Rosa · Apellidos: Vive · RUT: 16777777-5 · Estado: Activo');
  assert.match(laLinea(id, conLlaves).detalle, /RUT: 16777777-5/);
  const recortada = laLinea(id, sinRut).detalle;
  assert.ok(!recortada.includes('16777777'), 'el RUT no sale');
  assert.match(recortada, /Nombres: Rosa · Apellidos: Vive · RUT: \(reservado\) · Estado: Activo/);
});

test('lo que el borrado se llevó por delante no se pierde en el recorte', () => {
  /*
   * La cola la agrega `registrarEliminado` y no sale de ningún campo, así que
   * se separa antes de recortar: si no, un módulo cuyo último dato sea
   * reservado —una cuota, cuyo listado termina en el monto— se llevaría la
   * cola adentro y nadie sabría qué más desapareció.
   */
  const id = anotarLinea('Cuotas de Deudas', 'Eliminación',
    'N.º de cuota: 3 · Monto de la cuota: $ 50.000 — Se llevó consigo 2 registro(s): 2 en Tesorería.');
  const recortada = laLinea(id, sinMontos).detalle;
  assert.ok(!recortada.includes('50.000'), 'la cifra no sale');
  assert.match(recortada, /Se llevó consigo 2 registro\(s\): 2 en Tesorería\./,
    'y lo que arrastró sigue escrito');
});

test('una línea de un módulo sin nada reservado se lee igual para todos', () => {
  const id = anotarLinea('Usuarios', 'Creación', 'Nombre completo: Ayudante · Rol: tesorero');
  assert.equal(laLinea(id, sinMontos).detalle, laLinea(id, conLlaves).detalle);
});

/* ------------------------------------------- buscar y filtrar por el texto */

test('sin las llaves no se busca por el detalle', () => {
  assert.ok(sensibles.buscablesPara(registro, conLlaves).includes('detalle'),
    'con todas las llaves se busca como siempre');
  assert.ok(!sensibles.buscablesPara(registro, sinMontos).includes('detalle'),
    'probando cifras en el buscador se averiguarían una por una');
  assert.ok(sensibles.buscablesPara(registro, sinMontos).includes('registro'),
    'pero el resto del buscador le sigue sirviendo');
});

test('a la secretaria de siempre no se le cierra nada', () => {
  assert.ok(sensibles.buscablesPara(registro, sinSalud).includes('detalle'),
    'la llave de salud no la tienen ni el secretario ni el tesorero, y los datos de salud ' +
    'no se copian: si contara, se les cerraría la búsqueda del historial a casi todos');
  assert.ok(sensibles.buscablesPara(getModule('bitacora'), sinSalud).includes('descripcion'));
});

/** Cuántas líneas de esta prueba devuelve el listado con estos parámetros. */
function listadoDa(def, tabla, query, usuario) {
  const { whereSql, params } = consultaDeUnListado(def, { query, user: usuario });
  return db
    .prepare(`SELECT COUNT(*) c FROM "${tabla}" ${whereSql}${whereSql ? ' AND' : ' WHERE'} iglesia_id = ?`)
    .get(...params, iglesia).c;
}

test('ni se filtra por un campo reservado poniéndolo en la dirección', () => {
  const nombre = db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES ('Rosa','Vive RD','19111222-3',?,'Activo')")
    .run(iglesia);
  assert.ok(nombre.lastInsertRowid);
  assert.equal(listadoDa(miembros, 'miembros', { f_rut: '19111222-3' }, conLlaves), 1,
    'con la llave, el filtro acota');
  assert.equal(listadoDa(miembros, 'miembros', { f_rut: '19111222-3' }, sinRut), 1,
    'sin ella se ignora el filtro y se ve el listado entero, como con el rango de montos');
  assert.equal(listadoDa(miembros, 'miembros', { f_rut: 'no-existe' }, sinRut), 1,
    'y por eso no sirve para probar valores: cualquier RUT devuelve lo mismo');
  assert.equal(listadoDa(miembros, 'miembros', { f_rut: 'no-existe' }, conLlaves), 0);
});

test('tampoco se cuenta a quién le falta un dato reservado', () => {
  assert.equal(listadoDa(miembros, 'miembros', { sin: 'rut' }, conLlaves), 0);
  assert.equal(listadoDa(miembros, 'miembros', { sin: 'rut' }, sinRut), 1,
    'se ignora: quién tiene y quién no tiene el dato tampoco se pregunta desde afuera');
});

/* -------------------------------------------------- lo que queda declarado */

test('los tres campos que copian dicen de quién copian', () => {
  const deQuien = (modulo, campo) => getModule(modulo).fields.find((f) => f.name === campo).copiaDe;
  assert.equal(deQuien('registro_cambios', 'detalle'), '*', 'ahí queda anotado el borrado de cualquier ficha');
  assert.equal(deQuien('bitacora', 'descripcion'), 'miembros');
  assert.equal(deQuien('historial_pastores', 'descripcion'), 'pastores');
  assert.equal(deQuien('historial_iglesias', 'descripcion'), 'iglesias');
});

test('el motor no deja nombrar a un módulo que no existe', () => {
  const { normalizarParaPruebas } = require('../../server/registry');
  const roto = { name: 'inventado', fields: [{ name: 'texto', label: 'Texto', copiaDe: 'los_apuntes' }] };
  normalizarParaPruebas(roto);
  assert.throws(
    () => require('../../server/registry').revisarDeQuienCopiaParaPruebas(roto),
    /copiar de «los_apuntes»/,
    'un nombre mal escrito dejaría el campo abierto creyendo que está resguardado'
  );
});

test('y el grupo de un dato que no viaja no cuenta como que viaja', () => {
  const viajan = [...sensibles.gruposQueViajan(miembros)];
  assert.ok(viajan.includes('miembros_identidad'));
  assert.ok(viajan.includes('miembros_contacto'));
  assert.ok(!viajan.includes('miembros_salud'), 'de la salud se anota que cambió, no cuál era');
});
