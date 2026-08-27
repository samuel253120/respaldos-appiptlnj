/**
 * CÓMO HA ASISTIDO, EN SU PROPIA FICHA.
 *
 * El informe por persona existía y estaba bien hecho —abre su porcentaje en
 * cada cuerpo y detalla marca por marca—, pero había que ir a buscarlo a la
 * pestaña de Informes y escribir su nombre. En la ficha, que es donde uno la
 * está mirando antes de una entrevista o de evaluar su período de prueba, no
 * había ni una palabra de su asistencia.
 *
 * Lo que cuida este archivo:
 *   · que la ficha pida el MISMO informe, y no se arme una cuenta propia que
 *     el día de mañana diga un porcentaje distinto que la pestaña de Informes
 *   · que el informe por persona abra su asistencia por cuerpo, que es lo que
 *     la ficha muestra cuando participa en más de uno
 *   · y que el enlace al informe completo llegue de verdad: la dirección
 *     `#/asistencia/informes?tipo=persona&miembro_id=7` se perdía por el
 *     camino y salía el informe general
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la ficha', 'IG-FC', 'Activa')")
  .run().lastInsertRowid;
const unCuerpo = (nombre) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(nombre, iglesia).lastInsertRowid;
const damas = unCuerpo('Damas');
const coro = unCuerpo('Coro');

const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Ana Luisa', 'Soto Vera', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const noMiembro = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Pedro', 'Lara Vidal', ?)")
  .run(iglesia).lastInsertRowid;
const otra = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Berta', 'Ruiz', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

const marcar = (quien, cuerpoId, fecha, estado, motivo) => {
  const id = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?, 'Culto', ?, ?)")
    .run(fecha, iglesia, JSON.stringify([cuerpoId])).lastInsertRowid;
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, no_miembro_id, estado, motivo,
                                     cuerpo_id, fecha, iglesia_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, quien.no_miembro_id ? 'No miembro' : 'Miembro',
    quien.miembro_id || null, quien.no_miembro_id || null,
    estado, motivo || null, cuerpoId, fecha, iglesia
  );
  return id;
};

// Ana: en Damas anda bien (3 de 4) y en el Coro mal (1 de 3)
marcar({ miembro_id: miembro }, damas, '2026-03-01', 'Presente');
marcar({ miembro_id: miembro }, damas, '2026-03-08', 'Presente');
marcar({ miembro_id: miembro }, damas, '2026-03-15', 'Presente');
marcar({ miembro_id: miembro }, damas, '2026-03-22', 'Ausente');
marcar({ miembro_id: miembro }, coro, '2026-03-04', 'Presente');
marcar({ miembro_id: miembro }, coro, '2026-03-11', 'Ausente');
marcar({ miembro_id: miembro }, coro, '2026-03-18', 'Justificado', 'Enfermedad');
// Pedro, que no está inscrito, sirve en el Coro
marcar({ no_miembro_id: noMiembro }, coro, '2026-03-04', 'Presente');
marcar({ no_miembro_id: noMiembro }, coro, '2026-03-11', 'Presente');

const YO = { id: 1, rol: 'admin', iglesias: [iglesia], cuerpos: [] };

function informe(consulta) {
  let atender = null;
  asistencias.extraRoutes(
    { get(ruta, permiso, mano) { if (ruta === '/asistencias/informe') atender = mano; }, post() {} },
    { db, requirePerm: () => (req, res, next) => next(), can: () => true }
  );
  let salida = null;
  atender({ user: YO, params: {}, query: consulta }, { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

// --------------------------------------- lo que la ficha va a mostrar ---

test('el informe de una persona trae su porcentaje, sus cuerpos y sus marcas', () => {
  const d = informe({ tipo: 'persona', miembro_id: miembro });
  assert.equal(d.general.total, 7);
  assert.equal(d.general.presentes, 4);
  assert.equal(d.general.ausentes, 2);
  assert.equal(d.general.justificados, 1);
  assert.equal(d.marcas.length, 7);
});

test('y lo abre POR CUERPO: en uno puede andar al día y en otro no', () => {
  const d = informe({ tipo: 'persona', miembro_id: miembro });
  const porCuerpo = Object.fromEntries(d.porMiembroCuerpo.map((f) => [f.cuerpo, f]));
  assert.deepEqual(Object.keys(porCuerpo).sort(), ['Coro', 'Damas']);
  assert.equal(porCuerpo.Damas.pct_presente, 75);
  assert.equal(Math.round(porCuerpo.Coro.pct_presente), 33);
});

test('cada marca trae con qué quedarse: fecha, cuerpo, actividad, estado y motivo', () => {
  const d = informe({ tipo: 'persona', miembro_id: miembro });
  const justificada = d.marcas.find((m) => m.estado === 'Justificado');
  assert.deepEqual(
    { fecha: justificada.fecha, cuerpo: justificada.cuerpo, actividad: justificada.actividad, motivo: justificada.motivo },
    { fecha: '2026-03-18', cuerpo: 'Coro', actividad: 'Culto', motivo: 'Enfermedad' }
  );
});

test('las marcas vienen de la más nueva a la más vieja: la ficha muestra las últimas', () => {
  const d = informe({ tipo: 'persona', miembro_id: miembro });
  const fechas = d.marcas.map((m) => m.fecha);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
});

test('quien no está inscrito en la membresía también tiene el suyo', () => {
  const d = informe({ tipo: 'persona', no_miembro_id: noMiembro });
  assert.equal(d.general.total, 2);
  assert.equal(d.general.pct_presente, 100);
  assert.equal(d.marcas.length, 2);
});

test('y no se le mezcla con la del miembro que lleva el mismo número', () => {
  /*
   * El miembro n.º 7 y el no miembro n.º 7 son dos personas distintas. Pedir
   * el informe de uno no puede traer las marcas del otro.
   */
  const suyo = informe({ tipo: 'persona', no_miembro_id: noMiembro });
  assert.equal(suyo.marcas.every((m) => m.cuerpo === 'Coro'), true);
  assert.equal(suyo.general.total, 2, 'se le colaron marcas del miembro');
});

test('quien no tiene ninguna marca devuelve cero, no el informe de todos', () => {
  const d = informe({ tipo: 'persona', miembro_id: otra });
  assert.equal(d.general.total, 0);
  assert.equal(d.marcas.length, 0);
});

test('el período acota también el de una persona', () => {
  const d = informe({ tipo: 'persona', miembro_id: miembro, desde: '2026-03-10' });
  assert.equal(d.general.total, 4);
  assert.equal(d.marcas.every((m) => m.fecha >= '2026-03-10'), true);
});

// ------------------------------------------------- lo que hace la ficha ---

test('la ficha del miembro y la del no miembro tienen su pestaña de Asistencia', () => {
  const pestanas = app.slice(app.indexOf('function pestanasDeLaFicha'), app.indexOf('function montarPestanas'));
  assert.match(pestanas, /name === 'miembros' && MOD\['asistencias'\][\s\S]{0,200}renderAsistenciaDeLaPersona\('Miembro', id, c\)/);
  assert.match(pestanas, /name === 'no_miembros' && MOD\['asistencias'\][\s\S]{0,200}renderAsistenciaDeLaPersona\('No miembro', id, c\)/);
});

test('LA REGLA: la ficha pide el mismo informe, no arma una cuenta propia', () => {
  /*
   * Dos cálculos para lo mismo se separan, y la ficha terminaría diciendo un
   * porcentaje y la pestaña de Informes otro sobre la misma persona.
   */
  const fn = app.slice(app.indexOf('async function renderAsistenciaDeLaPersona'), app.indexOf('async function renderCuerposDelMiembro'));
  assert.match(fn, /api\('GET', '\/asistencias\/informe\?' \+ params\.toString\(\)\)/);
  assert.match(fn, /params\.set\(esNoMiembro \? 'no_miembro_id' : 'miembro_id', personaId\)/);
  // y no hay ninguna división hecha a mano ahí adentro
  assert.equal(/\/\s*\w+\.total\s*\)\s*\*\s*100/.test(fn), false, 'la ficha se puso a calcular su propio porcentaje');
});

test('y ofrece el enlace al informe completo, con esa persona ya elegida', () => {
  const fn = app.slice(app.indexOf('async function renderAsistenciaDeLaPersona'), app.indexOf('async function renderCuerposDelMiembro'));
  assert.match(fn, /#\/asistencia\/informes\?tipo=persona/);
  assert.match(fn, /\$\{esNoMiembro \? 'no_miembro_id' : 'miembro_id'\}=\$\{personaId\}/);
});

test('EL CASO QUE SE ARREGLÓ: ese enlace llega, en vez de abrir el informe general', () => {
  /*
   * `#/asistencia/informes?tipo=persona&miembro_id=7` llegaba hasta la
   * pantalla y ahí se perdía: el informe se armaba en blanco. Se veía al
   * entrar desde la ficha, que es justo para lo que existe el enlace.
   */
  assert.match(app, /renderInformeAsistencia\(document\.getElementById\('tabInformes'\), p\)/);
});

test('sin permiso para ver asistencia, la pestaña no aparece', () => {
  const fn = app.slice(app.indexOf('async function renderAsistenciaDeLaPersona'), app.indexOf('async function renderCuerposDelMiembro'));
  assert.match(fn, /if \(!MOD\['asistencias'\]\) return;/);
});
