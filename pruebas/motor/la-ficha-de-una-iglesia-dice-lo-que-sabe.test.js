/**
 * Lo que la ficha de una iglesia cuenta de la iglesia.
 *
 * Se abrió la ficha de una congregación y se contó, por un lado lo que muestra
 * y por otro lo que el sistema sabía de ella en ese mismo momento:
 *
 *   lo que la ficha mostraba ..... 5 datos (nombre, tipo, código, ciudad,
 *                                  estado) y nueve campos en blanco
 *   lo que el sistema sabía ...... 600 miembros, 13 cuerpos, 1 pastor,
 *                                  28 cuentas, 3.001 movimientos,
 *                                  150 actividades
 *   pestañas .....................  4, contra las 7 del cuerpo más chico
 *
 * Para saber cuánta gente tiene una congregación había que ir a Miembros y
 * filtrar; para saber cuánto tiene en caja, a Cuentas de Tesorería y filtrar.
 * La ficha del cuerpo más chico de la organización decía más de sí mismo que la
 * de la iglesia entera.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia con gente, cuerpos, un pastor y una caja adentro. */
function unaIglesiaConVida() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia con vida ${m}`, `VIV${m}`).lastInsertRowid;

  let rut = 22000000 + (process.pid % 500000) + n * 1000;
  const persona = (estado) => db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES ('Alguien', ?, ?, ?, ?)")
    .run(`Delaiglesia ${m}`, `${++rut}-${digitoVerificador(String(rut))}`, iglesia, estado);
  const cuerpo = (estado) => db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, ?)")
    .run(`Cuerpo ${m}-${Math.random()}`, iglesia, estado).lastInsertRowid;
  const pastor = (estado) => db
    .prepare("INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, estado) VALUES ('Pastor', ?, ?, ?, ?)")
    .run(`Delaiglesia ${m}`, `${++rut}-${digitoVerificador(String(rut))}`, iglesia, estado);

  return { id: iglesia, m, persona, cuerpo, pastor, rutSiguiente: () => `${++rut}-${digitoVerificador(String(rut))}` };
}

const resumen = async (api, id) => (await api('GET', `/iglesias/${id}/resumen`)).json;

// ------------------------------------------------ quién sigue siendo parte ----

test('el resumen cuenta la gente, los cuerpos y los pastores de ESA iglesia', async () => {
  const api = await elSistemaAndando();
  const a = unaIglesiaConVida();
  const b = unaIglesiaConVida();
  a.persona('Activo'); a.persona('Activo'); a.cuerpo('Activo'); a.pastor('Activo');
  b.persona('Activo'); b.cuerpo('Activo');

  const r = await resumen(api, a.id);
  assert.equal(r.miembros.activos, 2, 'la gente de la otra iglesia no puede entrar en esta cifra');
  assert.equal(r.cuerpos.activos, 1);
  assert.equal(r.pastores.activos, 1);
});

test('un estado en blanco no es una salida: es un dato que nadie llenó', async () => {
  /*
   * La primera versión contaba «estado = Activo» a secas, y sobre una iglesia
   * con trece cuerpos el resumen decía «1» porque doce tenían el estado sin
   * escribir —mientras el listado de al lado los mostraba a los trece sin una
   * sola marca de retirados—. Dos cifras de lo mismo, contradiciéndose en la
   * misma pantalla. El resto del sistema ya lo lee así: ver server/cumpleanos.js
   * y server/directiva.js.
   */
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  i.cuerpo(null); i.cuerpo(null); i.cuerpo('Activo');
  const r = await resumen(api, i.id);
  assert.equal(r.cuerpos.activos, 3);
  assert.equal(r.cuerpos.total, 3, 'y entonces no hay ninguno «que ya no está» que apuntar');
});

test('quien está en disciplina sigue siendo miembro; el trasladado y el fallecido, no', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  i.persona('Activo'); i.persona('En disciplina');
  i.persona('Trasladado'); i.persona('Fallecido'); i.persona('Inactivo');

  const r = await resumen(api, i.id);
  assert.equal(r.miembros.activos, 2, 'una persona en disciplina no dejó la congregación');
  assert.equal(r.miembros.total, 5);
});

test('y un pastor jubilado ya no la pastorea, aunque su ficha no diga «Inactivo»', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  i.pastor('Activo'); i.pastor('Jubilado'); i.pastor('Trasladado');
  const r = await resumen(api, i.id);
  assert.equal(r.pastores.activos, 1);
  assert.equal(r.pastores.total, 3);
});

// --------------------------------------------------------------- la caja ----

test('la caja de la iglesia va aparte de las de sus cuerpos', async () => {
  /*
   * Es la misma separación que el inventario de la 1.231.0: la plata de la
   * iglesia y la de sus cuerpos tienen dueños distintos, y una sola cifra que
   * las sume no contesta ninguna de las dos preguntas.
   */
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  const cuerpo = i.cuerpo('Activo');
  const caja = (cuerpoId, saldoInicial) => db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial)
     VALUES (?, ?, ?, ?, 'General', 'Activa', ?)`
  ).run(`Caja ${i.m}-${Math.random()}`, cuerpoId ? 'Cuerpo / Grupo' : 'Iglesia local',
        i.id, cuerpoId, saldoInicial).lastInsertRowid;

  caja(null, 100000);
  caja(null, 50000);
  caja(cuerpo, 7000);

  const r = await resumen(api, i.id);
  assert.equal(r.tesoreria.cuentas, 2);
  assert.equal(r.tesoreria.saldo, 150000);
  assert.equal(r.tesoreria.cuentas_de_cuerpos, 1);
  assert.equal(r.tesoreria.saldo_de_cuerpos, 7000, 'los $ 7.000 del cuerpo no son de la iglesia');
});

test('el saldo es el punto de partida más lo que YA entró y salió', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  const cuenta = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial)
     VALUES (?, 'Iglesia local', ?, 'General', 'Activa', 20000)`
  ).run(`Caja ${i.m}`, i.id).lastInsertRowid;
  const anotar = (tipo, monto, fecha) => db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES (?, ?, 'Diezmos', 'Algo', ?, ?, ?)`
  ).run(fecha, tipo, monto, cuenta, i.id);

  anotar('Ingreso', 5000, '2026-01-10');
  anotar('Egreso', 3000, '2026-01-20');
  assert.equal((await resumen(api, i.id)).tesoreria.saldo, 22000);

  /*
   * Y lo anotado MÁS ADELANTE no está en la caja todavía: la ofrenda de un
   * servicio agendado queda escrita con la fecha del servicio, y esa plata no
   * ha llegado (el porqué está en server/saldos.js). El resumen usa la misma
   * condición con que cada cuenta calcula su propio saldo, para que la cifra de
   * la ficha y la de la cartola no puedan discrepar.
   */
  anotar('Ingreso', 999000, '2099-12-31');
  assert.equal((await resumen(api, i.id)).tesoreria.saldo, 22000,
    'lo agendado para dentro de setenta años no puede estar en la caja de hoy');
});

// --------------------------------------- cada cifra pide su propio permiso ----

/** Una cuenta acotada a esta iglesia, con el rol que se le indique. */
function unaCuenta(iglesiaId, rol, permisos) {
  const rut = 24000000 + (process.pid % 400000) + (++n) * 7;
  return db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, iglesia_id, permisos)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(`${rut}-${digitoVerificador(String(rut))}`, `Cuenta ${rut}`, rol,
        JSON.stringify([iglesiaId]), iglesiaId, permisos ? JSON.stringify(permisos) : null).lastInsertRowid;
}

test('la cifra que esa persona no puede ver NO viaja', async () => {
  /*
   * Un resumen es más peligroso que un listado, no menos: entrega la cifra sin
   * que haya que abrir nada. Pintarlo dentro de una ficha que la persona ya
   * puede abrir no convierte lo de adentro en algo que también pueda ver; es la
   * misma corrección que se le hizo a los paneles del cuerpo.
   */
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  i.persona('Activo');
  /*
   * Lo que se niega hay que NOMBRARLO con una lista vacía: los permisos propios
   * de una cuenta pisan los de su rol módulo por módulo, y lo que no se nombra
   * cae en lo que el rol ya le daba (ver permisosEfectivos en
   * server/permissions.js). La primera versión de esta prueba nombraba solo lo
   * que sí podía ver, y la cuenta seguía viéndolo todo por su rol.
   */
  const soloIglesias = comoOtroUsuario(unaCuenta(i.id, 'consulta',
    { iglesias: ['view'], miembros: [], cuerpos: [], pastores: [], cuentas_tesoreria: [], asistencias: [], solicitudes: [] }));

  const r = await soloIglesias('GET', `/iglesias/${i.id}/resumen`);
  assert.equal(r.estado, 200, 'ver la iglesia sí puede');
  assert.equal(r.json.miembros, undefined, 'pero la cifra de su gente no tendría que llegarle');
  assert.equal(r.json.tesoreria, undefined, 'ni la de su plata');
  assert.equal(r.json.cuerpos, undefined);
});

test('y con permiso de ver miembros, esa sí y las otras no', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  i.persona('Activo'); i.persona('Activo');
  const conMiembros = comoOtroUsuario(unaCuenta(i.id, 'consulta',
    { iglesias: ['view'], miembros: ['view'], cuerpos: [], pastores: [], cuentas_tesoreria: [], asistencias: [], solicitudes: [] }));

  const r = (await conMiembros('GET', `/iglesias/${i.id}/resumen`)).json;
  assert.equal(r.miembros.activos, 2);
  assert.equal(r.tesoreria, undefined, 'la plata sigue sin ser suya');
});

test('sin la llave de los montos llegan las cajas pero no lo que hay dentro', async () => {
  /*
   * Un cero inventado sería peor que no decir nada: se lee como que la iglesia
   * no tiene un peso. Por eso viaja `reservado: true` y el saldo va en nulo
   * (ver server/sensibles.js).
   */
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial)
     VALUES (?, 'Iglesia local', ?, 'General', 'Activa', 800000)`
  ).run(`Caja ${i.m}`, i.id);

  const sinMontos = comoOtroUsuario(unaCuenta(i.id, 'consulta',
    { iglesias: ['view'], cuentas_tesoreria: ['view'], tesoreria_montos: [] }));
  const r = (await sinMontos('GET', `/iglesias/${i.id}/resumen`)).json;
  assert.equal(r.tesoreria.cuentas, 1, 'cuántas cajas hay sí se puede saber');
  assert.equal(r.tesoreria.saldo, null, 'cuánto hay en ellas, no');
  assert.equal(r.tesoreria.reservado, true, 'y se dice, para no dibujar un cero que no es');
});

// --------------------------------------------------------------- alcance ----

test('la iglesia de otra persona contesta 403, aunque se escriba la dirección a mano', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesiaConVida();
  const ajena = unaIglesiaConVida();
  ajena.persona('Activo');
  const acotada = comoOtroUsuario(unaCuenta(suya.id, 'admin'));

  assert.equal((await acotada('GET', `/iglesias/${suya.id}/resumen`)).estado, 200);
  const fuera = await acotada('GET', `/iglesias/${ajena.id}/resumen`);
  assert.equal(fuera.estado, 403, 'la ruta se pide desde una ficha, pero la dirección se puede escribir');
  assert.doesNotMatch(fuera.texto, /activos/, 'y no se escapa ninguna cifra en el aviso');
});

test('y una iglesia que no existe, 404', async () => {
  const api = await elSistemaAndando();
  assert.equal((await api('GET', '/iglesias/99999999/resumen')).estado, 404);
});

// ----------------------------------------------- lo que pasa y lo que falta ----

test('la última actividad y las de este año', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  const anio = new Date().getFullYear();
  const actividad = (fecha) => db
    .prepare("INSERT INTO asistencias (nombre, fecha, iglesia_id, tipo_reunion) VALUES (?, ?, ?, 'Culto')")
    .run(`Culto ${i.m}-${fecha}`, fecha, i.id);

  actividad(`${anio}-01-04`);
  actividad(`${anio}-01-11`);
  actividad(`${anio - 3}-06-01`);
  actividad('2099-01-01'); // agendada: todavía no ocurrió

  const r = await resumen(api, i.id);
  assert.equal(r.asistencia.este_ano, 3, 'las de este año, incluida la que está agendada dentro de él');
  assert.equal(r.asistencia.ultima, `${anio}-01-11`,
    'la última es la última que YA pasó, no una agendada para 2099');
});

test('las solicitudes en trámite no cuentan las cerradas', async () => {
  const api = await elSistemaAndando();
  const i = unaIglesiaConVida();
  const pedir = (estado) => db
    .prepare("INSERT INTO solicitudes (asunto, fecha, iglesia_id, estado, tipo) VALUES (?, '2026-03-01', ?, ?, 'Otro')")
    .run(`Algo ${i.m}`, i.id, estado);
  pedir('Pendiente'); pedir('En revisión'); pedir('Cerrada'); pedir('Rechazada');
  assert.equal((await resumen(api, i.id)).solicitudes.abiertas, 2);
});

// -------------------------------------------------- lo que se ve en pantalla ----

test('la ficha estrena las pestañas que le faltaban', () => {
  /*
   * Tenía cuatro —Datos, Inventario, Documentos, Historial— contra las siete
   * del cuerpo más chico de la organización.
   */
  const desde = app.indexOf("if (name === 'iglesias') {");
  assert.ok(desde > 0, 'no está el bloque de pestañas de la iglesia');
  const trozo = app.slice(desde, desde + 3000);
  for (const [clave, titulo] of [['miembros', 'Miembros'], ['cuerpos', 'Cuerpos'],
                                 ['pastores', 'Pastores'], ['tesoreria', 'Tesorería']]) {
    assert.match(trozo, new RegExp(`sumar\\('${clave}', '${titulo}'`), `falta la pestaña de ${titulo}`);
  }
});

test('y el resumen va ARRIBA, fuera de las pestañas', () => {
  /*
   * Es lo que se mira ANTES de decidir algo, y lo que está detrás de una
   * pestaña no se mira: quien abre la ficha de una iglesia a resolver algo no
   * va a ir a buscarlo.
   */
  assert.match(app, /<div id="fichaResumen"><\/div>\s*\n\s*<div id="fichaPestanas">/,
    'el resumen tiene que quedar antes de la barra de pestañas');
  assert.match(app, /renderResumenDeIglesia\(id, document\.getElementById\('fichaResumen'\)\)/);
});

test('las cifras de la pantalla llevan a la lista que las explica', () => {
  const desde = app.indexOf('async function renderResumenDeIglesia(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  for (const modulo of ['miembros', 'cuerpos', 'pastores', 'cuentas_tesoreria', 'asistencias']) {
    assert.match(trozo, new RegExp(`#/m/${modulo}\\?f_iglesia_id=`), `la cifra de ${modulo} no lleva a ninguna parte`);
  }
});

test('la tesorería de la iglesia no mezcla las cajas de sus cuerpos', () => {
  const desde = app.indexOf('async function renderTesoreriaDeLaIglesia(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /filter\(\(c\) => !c\.cuerpo_id\)/, 'las de los cuerpos no van en esta lista');
  assert.match(trozo, /esa plata tiene otro dueño/, 'y se dice dónde están, en vez de esconderlas');
});
