/**
 * Un año de servicios registrados y ni un solo total.
 *
 * Cada servicio guarda cuánta gente asistió y cuánto se ofrendó, y el listado
 * los mostraba uno por uno sin sumar nada: para saber cuánto se ofrendó en
 * agosto había que ir fila por fila con una calculadora. Medido en la revisión
 * del módulo: el listado devolvía filas, total, página y páginas, y ningún
 * total de ofrenda ni de asistencia; una pantalla de resumen no existía.
 *
 * Lo que se vigila acá son las cuentas —que sumen lo que hay que sumar, que el
 * promedio no reparta entre servicios sin asistencia anotada, y que lo abierto
 * por mes y por tipo cuadre con el total— y que las dos rutas sumen las mismas
 * filas que el listado muestra, que es lo que las hace confiables.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const servicios = require('../../server/modules/servicios');
const sumas = require('../../server/servicios-resumen');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const crud = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Sumas ZZ','SRV-SUM','Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Sumas Sur ZZ','SRV-SU2','Activa')")
  .run().lastInsertRowid;

/** Un servicio ya registrado, puesto directo en la base. */
function servicio(campos) {
  const fila = {
    tipo: 'Servicio General', iglesia_id: iglesia,
    ofrenda_total: 0, ofrenda_fondo: 0, ofrenda_iglesia: 0,
    asistencia_adultos: 0, asistencia_ninos: 0, asistencia_total: 0, ...campos,
  };
  const claves = Object.keys(fila);
  db.prepare(`INSERT INTO servicios (${claves.join(',')}) VALUES (${claves.map(() => '?').join(',')})`)
    .run(...claves.map((k) => fila[k]));
}

// Tres servicios de esta iglesia: dos con asistencia y ofrenda, uno sin nada
servicio({
  fecha: '2028-03-05', ofrenda_total: 200000, ofrenda_fondo: 20000, ofrenda_iglesia: 180000,
  asistencia_adultos: 80, asistencia_ninos: 20, asistencia_total: 100,
});
servicio({
  fecha: '2028-04-02', tipo: 'Servicio Vigilia', ofrenda_total: 100000, ofrenda_fondo: 10000,
  ofrenda_iglesia: 90000, asistencia_adultos: 40, asistencia_ninos: 0, asistencia_total: 40,
});
servicio({ fecha: '2028-04-09' });
// Y uno de la otra iglesia, que no tiene que aparecer en ninguna cuenta de acá
servicio({
  fecha: '2028-04-16', iglesia_id: otraIglesia, ofrenda_total: 999999, ofrenda_fondo: 99999,
  ofrenda_iglesia: 900000, asistencia_adultos: 500, asistencia_total: 500,
});

const LOS_MIOS = 'WHERE iglesia_id = ?';
const total = () => sumas.resumen(db, LOS_MIOS, [iglesia]);

/* ------------------------------------------------------------- las cuentas */

test('el total suma la ofrenda, el aporte y lo que le queda a la iglesia', () => {
  const r = total();
  assert.equal(r.ofrenda, 300000);
  assert.equal(r.aporte, 30000);
  assert.equal(r.queda, 270000);
});

test('y suma la asistencia, con adultos y niños por separado', () => {
  const r = total();
  assert.equal(r.asistencia, 140);
  assert.equal(r.adultos, 120);
  assert.equal(r.ninos, 20);
});

test('cuenta cuántos servicios entraron en la cuenta', () => {
  assert.equal(total().servicios, 3);
});

test('el promedio sale de los servicios con asistencia anotada, no de todos', () => {
  const r = total();
  // 140 entre los DOS que tienen asistencia, no entre los tres: un servicio sin
  // anotar no es un servicio al que no fue nadie
  assert.equal(r.con_asistencia, 2);
  assert.equal(r.promedio_asistencia, 70);
});

test('y se dice de cuántos salió, para poder decirlo en pantalla', () => {
  assert.notEqual(total().con_asistencia, total().servicios);
  assert.match(app, /El promedio sale de \$\{fmtNumero\(r\.con_asistencia\)\}/);
});

test('sin ningún servicio, todo en cero y sin dividir por cero', () => {
  const vacio = sumas.resumen(db, 'WHERE iglesia_id = ?', [-1]);
  assert.equal(vacio.servicios, 0);
  assert.equal(vacio.ofrenda, 0);
  assert.equal(vacio.promedio_asistencia, 0);
});

/* --------------------------------------------------------- mes por mes */

test('el mes sale de la fecha y va de enero a diciembre', () => {
  const meses = sumas.porMes(db, LOS_MIOS, [iglesia]);
  assert.deepEqual(meses.map((m) => m.mes), ['2028-03', '2028-04']);
});

test('cada mes suma lo suyo', () => {
  const [marzo, abril] = sumas.porMes(db, LOS_MIOS, [iglesia]);
  assert.equal(marzo.servicios, 1);
  assert.equal(marzo.ofrenda, 200000);
  assert.equal(abril.servicios, 2);
  assert.equal(abril.ofrenda, 100000);
  // En abril hay dos servicios y uno solo tiene asistencia: el promedio es ese
  assert.equal(abril.promedio_asistencia, 40);
});

test('lo de cada mes suma lo mismo que el total', () => {
  const meses = sumas.porMes(db, LOS_MIOS, [iglesia]);
  assert.equal(meses.reduce((a, m) => a + m.ofrenda, 0), total().ofrenda);
  assert.equal(meses.reduce((a, m) => a + m.asistencia, 0), total().asistencia);
  assert.equal(meses.reduce((a, m) => a + m.servicios, 0), total().servicios);
});

/* ------------------------------------------------------ por tipo de servicio */

test('por tipo, empezando por el que más veces se celebró', () => {
  const tipos = sumas.porTipo(db, LOS_MIOS, [iglesia]);
  assert.deepEqual(tipos.map((t) => t.tipo), ['Servicio General', 'Servicio Vigilia']);
  assert.equal(tipos[0].servicios, 2);
  assert.equal(tipos[1].ofrenda, 100000);
});

test('un servicio sin tipo no desaparece de la cuenta: sale como «Sin tipo»', () => {
  const sinTipo = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Sin Tipo ZZ','SRV-SU3','Activa')")
    .run().lastInsertRowid;
  servicio({ fecha: '2028-05-07', tipo: null, iglesia_id: sinTipo, ofrenda_total: 5000 });
  servicio({ fecha: '2028-05-14', tipo: '   ', iglesia_id: sinTipo, ofrenda_total: 5000 });
  const tipos = sumas.porTipo(db, 'WHERE iglesia_id = ?', [sinTipo]);
  assert.deepEqual(tipos.map((t) => t.tipo), ['Sin tipo']);
  assert.equal(tipos[0].servicios, 2);
});

test('lo de cada tipo suma lo mismo que el total', () => {
  const tipos = sumas.porTipo(db, LOS_MIOS, [iglesia]);
  assert.equal(tipos.reduce((a, t) => a + t.ofrenda, 0), total().ofrenda);
  assert.equal(tipos.reduce((a, t) => a + t.servicios, 0), total().servicios);
});

/* ------------------------------------------- suman lo que el listado muestra */

test('las cuentas no eligen qué sumar: eso llega hecho, en la consulta del listado', () => {
  // Lo de la otra iglesia no entra: no está en la consulta que se le pasa
  assert.equal(total().ofrenda, 300000);
  assert.equal(sumas.resumen(db, 'WHERE iglesia_id = ?', [otraIglesia]).ofrenda, 999999);
});

test('el motor le presta a las rutas del módulo la misma consulta del listado', () => {
  assert.match(crud, /comoSeArmaElListado: \(req\) => consultaDeUnListado\(def, req\)/);
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/servicios.js'), 'utf8');
  assert.match(modulo, /comoSeArmaElListado\(req\)/);
});

test('el módulo ofrece sus rutas: el total y el informe', () => {
  assert.equal(typeof servicios.extraRoutes, 'function');
  const rutas = [];
  servicios.extraRoutes(
    { get: (ruta) => rutas.push(ruta) },
    { db, requirePerm: () => {}, comoSeArmaElListado: () => ({ params: [], whereSql: '' }) }
  );
  for (const ruta of ['/servicios/resumen', '/servicios/informe']) {
    assert.ok(rutas.includes(ruta), `falta la ruta ${ruta}`);
  }
});

/* ------------------------------------------------------------- la pantalla */

test('el listado de servicios muestra sus totales arriba', () => {
  // El nombre de la función suelto no sirve: lo lleva su propia declaración, y
  // la comprobación pasaba igual con la llamada borrada. Lo que hay que vigilar
  // es que el listado la LLAME al cargar
  assert.match(app, /if \(name === 'servicios'\) cargarResumenDeServicios\(params\);/);
  assert.match(app, /id="serviciosResumen"/);
  assert.match(app, /'\/servicios\/resumen\?' \+ params\.toString\(\)/);
});

test('y hay un informe, con su botón y su dirección propia', () => {
  assert.match(app, /btnInformeServicios/);
  assert.match(app, /parts\[0\] === 'servicios' && parts\[1\] === 'informe'/);
  assert.match(app, /function viewInformeServicios/);
});

test('el informe se abre con el período y el tipo que se estaba mirando', () => {
  assert.match(app, /suyos\.set\('desde', st\.desde\)/);
  assert.match(app, /suyos\.set\('tipo', st\.filters\.tipo\)/);
});

test('el informe sale impreso con el membrete y sin los filtros', () => {
  const trozo = app.slice(app.indexOf('async function viewInformeServicios'));
  assert.match(trozo.slice(0, 6000), /class="card no-print"/);
  assert.match(trozo.slice(0, 12000), /print-only">\$\{membreteDelDocumento\(\)\}/);
});
