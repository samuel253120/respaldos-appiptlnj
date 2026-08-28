/**
 * Encontrar un movimiento por lo que uno recuerda de él.
 *
 * Un gasto se recuerda por su monto —«el de los doscientos cincuenta mil»— y se
 * teclea con puntos o sin ellos. Medido antes: «250000» daba CERO y «250.000»
 * también, porque el monto está guardado como número y ninguna de las dos es el
 * texto que hay en la columna. El método de pago se podía filtrar pidiéndolo por
 * dirección, pero la barra no lo ofrecía. Y el rango de montos —«los egresos
 * sobre quinientos mil de este año», la pregunta con que empieza cualquier
 * revisión— no existía: se bajaba la planilla entera y se filtraba en Excel.
 *
 * Lo que se vigila acá, además de que las tres cosas funcionen: que buscar por
 * monto NO se lo salte el recorte de los datos reservados. Quien no puede ver
 * los montos tampoco puede dar con un movimiento probando cifras en el
 * buscador; si pudiera, el dato quedaría igual de expuesto que si se mostrara.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { normalizarParaPruebas: normalizar } = require('../../server/registry');
const tesoreria = require('../../server/modules/tesoreria');
const busqueda = require('../../server/busqueda');
const sensibles = require('../../server/sensibles');
const { consultaDeUnListado } = require('../../server/crud');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');

/* ------------------------------------------- lo que se compara de corrido */

test('un monto tecleado con puntos se compara también sin ellos', () => {
  assert.equal(busqueda.seComparaDeCorrido('250.000'), true);
  assert.equal(busqueda.seComparaDeCorrido('250000'), true);
});

test('y el RUT sigue entrando por la suya, con su dígito verificador', () => {
  assert.equal(busqueda.seComparaDeCorrido('21.000.000-3'), true);
  assert.equal(busqueda.seComparaDeCorrido('21000000-k'), true);
});

test('una palabra no se compara de corrido: no hay nada que quitarle', () => {
  assert.equal(busqueda.seComparaDeCorrido('Sillas'), false);
  assert.equal(busqueda.seComparaDeCorrido('3'), false, 'un dígito solo no lleva separadores');
});

test('la condición de búsqueda pregunta las dos formas cuando es un número', () => {
  const { sql, params } = busqueda.condicion('250.000', ['concepto'], []);
  assert.equal(params.length, 2, 'la tecleada y la de corrido');
  assert.match(sql, / OR /);
  assert.ok(params.includes('%250000%'), 'la de corrido, sin el punto');
});

/* ----------------------------------------------- buscar por monto de verdad */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Monto SS','TES-MON','Activa')")
  .run().lastInsertRowid;
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES ('General del Monto SS','Iglesia local','General',?,'Activa',0)`)
  .run(iglesia).lastInsertRowid;

const anotar = (monto, concepto) => db
  .prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, metodo)
     VALUES ('2026-04-04','Egreso','Compras',?,?,?,?,'Cheque')`
  ).run(concepto, monto, cuenta, iglesia).lastInsertRowid;

anotar(250000, 'Sillas del salón SS');
anotar(9900, 'Cafetería SS');
anotar(1500000, 'Techo SS');

/* `normalizar` deja el módulo listo en el sitio y no devuelve nada: se le pasa
   una copia para no tocar el que ya cargó el registro. */
const def = { ...tesoreria };
normalizar(def);
/*
 * La llave de los montos viene «para todos» de fábrica, así que quien la tiene
 * es cualquiera; a quien no la tiene hay que quitársela a mano, que es lo que
 * hace una iglesia que la restringe. Los roles se nombran por su valor
 * —«admin», no «Administrador»—, que es lo que compara server/permissions.js.
 */
const conLlave = { id: 1, rol: 'admin' };
const sinLlave = { id: 2, rol: 'secretario', permisos: JSON.stringify({ tesoreria_montos: [] }) };

/** Cuántos movimientos de esta prueba encuentra este texto, para este usuario. */
function encuentra(texto, usuario) {
  const cond = busqueda.condicion(
    texto,
    sensibles.buscablesPara(def, usuario),
    sensibles.buscaTambienPara(def, usuario)
  );
  if (!cond) return 0;
  return db
    .prepare(`SELECT COUNT(*) c FROM tesoreria WHERE cuenta_id = ? AND (${cond.sql})`)
    .get(cuenta, ...cond.params).c;
}

test('el monto encuentra su movimiento, escrito como se teclee', () => {
  assert.equal(encuentra('250000', conLlave), 1);
  assert.equal(encuentra('250.000', conLlave), 1);
  assert.equal(encuentra('1.500.000', conLlave), 1);
  assert.equal(encuentra('1500000', conLlave), 1);
});

test('y el concepto sigue encontrando lo suyo', () => {
  assert.equal(encuentra('Sillas', conLlave), 1);
  assert.equal(encuentra('SS', conLlave), 3);
});

test('un monto que no existe no encuentra nada', () => {
  assert.equal(encuentra('777777', conLlave), 0);
});

test('el monto se compara entero, sin el decimal con que lo guarda la base', () => {
  /*
   * La columna es REAL: el motor la pegaría como «250000.0» y nadie teclea eso.
   * Por eso el trozo va con CAST a entero (mismo tropiezo que la cita bíblica
   * de un servicio en la 1.155.0).
   */
  assert.match(tesoreria.buscaTambien[0].sql || tesoreria.buscaTambien[0], /CAST\(monto AS INTEGER\)/);
  assert.equal(encuentra('250000.0', conLlave), 0, 'nadie busca así, y no tiene por qué funcionar');
});

/* ------------------------------------ y no se salta lo reservado */

test('quien no puede ver los montos tampoco los encuentra buscando', () => {
  assert.ok(sensibles.vedados(def, sinLlave, null).includes('tesoreria_montos'),
    'esta persona no alcanza los montos');
  assert.equal(encuentra('250000', sinLlave), 0,
    'si los encontrara, probando cifras se averiguarían uno por uno');
  assert.equal(encuentra('Sillas', sinLlave), 1, 'pero el concepto lo sigue viendo');
});

test('el motor no deja declarar un trozo reservado sin decir de qué grupo es', () => {
  assert.throws(
    () => normalizar({ ...tesoreria, buscaTambien: ['CAST(monto AS INTEGER)'] }),
    /busca de más por «monto»/,
    'sin el grupo declarado, el servidor no parte'
  );
});

test('y tampoco con el grupo equivocado', () => {
  assert.throws(
    () => normalizar({ ...tesoreria, buscaTambien: [{ sql: 'CAST(monto AS INTEGER)', reservado: 'otro_grupo' }] }),
    /busca de más por «monto»/
  );
});

/* ------------------------------------------------------ filtrar */

test('el método está en la barra de filtros, no solo en la dirección', () => {
  assert.ok(tesoreria.filterFields.includes('metodo'));
});

/**
 * Cuántos movimientos de esta prueba devuelve el LISTADO con estos parámetros.
 *
 * Se arma con la misma función del motor que usa la ruta —no repitiendo el SQL
 * acá—, porque lo que hay que probar es que el motor acota, no que uno sabe
 * escribir un WHERE.
 */
function listadoDa(query, usuario = conLlave) {
  const { whereSql, params } = consultaDeUnListado(def, { query, user: usuario });
  return db
    .prepare(`SELECT COUNT(*) c FROM tesoreria ${whereSql}${whereSql ? ' AND' : 'WHERE'} cuenta_id = ?`)
    .get(...params, cuenta).c;
}

test('el rango de montos acota de verdad', () => {
  assert.equal(listadoDa({}), 3, 'sin rango, los tres');
  assert.equal(listadoDa({ monto_desde: '500000' }), 1, 'solo el techo');
  assert.equal(listadoDa({ monto_hasta: '10000' }), 1, 'solo la cafetería');
  assert.equal(listadoDa({ monto_desde: '10000', monto_hasta: '300000' }), 1, 'solo las sillas');
});

test('y acepta el monto escrito con puntos, como se escribe la plata acá', () => {
  assert.equal(listadoDa({ monto_desde: '500.000' }), 1);
  assert.equal(listadoDa({ monto_desde: '1.500.000' }), 1);
});

test('lo que no es un número no acota nada: el listado se ve entero', () => {
  assert.equal(listadoDa({ monto_desde: 'hola' }), 3);
  assert.equal(listadoDa({ monto_desde: '500000; DROP TABLE tesoreria' }), 3);
  assert.equal(listadoDa({ monto_hasta: '' }), 3);
});

test('quien no puede ver los montos tampoco puede tantear un rango', () => {
  assert.equal(listadoDa({ monto_desde: '500000' }, sinLlave), 3,
    'acotar por monto sin poder verlo sería la misma fuga por otra puerta');
});

test('el rango se le ofrece solo a un módulo que muestra su monto', () => {
  const { tieneRangoDeMonto } = require('../../server/registry');
  assert.equal(tieneRangoDeMonto(def), true, 'Tesorería muestra el monto en su listado');
  assert.equal(tieneRangoDeMonto({ ...def, listFields: ['fecha', 'concepto'] }), false,
    'sin el monto a la vista, acotar por una cifra sería pedirle a alguien que adivine');
  assert.equal(tieneRangoDeMonto({ fields: [{ name: 'x', type: 'text' }], listFields: ['x'] }), false);
});

/*
 * Lo que sigue es un vistazo al código de la pantalla, no una prueba de que
 * ande: acá no hay navegador. Que el rango de verdad se pida y acote se
 * comprueba en el barrido móvil y a mano en el navegador; esto solo ataja que
 * alguien borre el control sin darse cuenta.
 */
test('los controles del rango están escritos en la pantalla', () => {
  assert.match(app, /hayRangoDeMonto/);
  assert.match(app, /id="fMontoDesde"/);
  assert.match(app, /id="fMontoHasta"/);
  assert.match(app, /params\.set\('monto_desde'/);
  assert.match(app, /params\.set\('monto_hasta'/);
});
