/**
 * EL INFORME SE ACOTA POR TIPO DE ACTIVIDAD.
 *
 * Se podía pedir por cuerpo, por persona y por período, pero no por tipo. Con
 * doce tipos configurados no había manera de contestar «¿cómo anda la
 * asistencia al Estudio Bíblico?», que es justo la pregunta que hace que valga
 * la pena tener tipos. Medido: pedir el informe acotado a «Ensayo» devolvía las
 * mismas 30.000 marcas que sin acotar, porque el parámetro no existía.
 *
 * Y hay una trampa que este archivo cuida especialmente: `tipo` ya estaba
 * tomado por QUÉ INFORME se pide —general, por cuerpo, por persona—. Al
 * principio el filtro se llamó igual y las dos cosas se pisaron: el informe
 * general se pedía a sí mismo acotado a las actividades de tipo «general», que
 * no existen, y salía en cero. Se vio en la pantalla, no en las pruebas: con el
 * mismo nombre en los dos lados, una prueba habría estado igual de equivocada.
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
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del filtro', 'IG-FI', 'Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

let n = 0;
const alguien = () => {
  n++;
  const m = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(`Fil${n}`, `Tro${n}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
     VALUES (?, ?, ?, 'Activo', '2024-01-01')`
  ).run(cuerpo, m, iglesia);
  return m;
};
const gente = [alguien(), alguien(), alguien(), alguien()];

/** Una actividad de ese tipo, con su lista pasada. */
function actividadDe(tipo, fecha, presentes) {
  const id = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?, ?, ?, ?)")
    .run(fecha, tipo, iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  gente.forEach((m, i) => {
    db.prepare(
      `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
       VALUES (?, 'Miembro', ?, ?, ?, ?, ?)`
    ).run(id, m, i < presentes ? 'Presente' : 'Ausente', cuerpo, fecha, iglesia);
  });
  return id;
}

// Culto: 3 actividades, todos presentes menos uno. Estudio: 1, la mitad.
actividadDe('Culto', '2026-03-01', 4);
actividadDe('Culto', '2026-03-08', 4);
actividadDe('Culto', '2026-03-15', 4);
actividadDe('Estudio Bíblico', '2026-03-04', 2);
actividadDe('Ensayo', '2026-03-07', 0);

const YO = { id: 1, rol: 'admin', iglesias: [iglesia], cuerpos: [] };

function informe(consulta = {}) {
  let atender = null;
  asistencias.extraRoutes(
    { get(ruta, permiso, mano) { if (ruta === '/asistencias/informe') atender = mano; }, post() {} },
    { db, requirePerm: () => (req, res, next) => next(), can: () => true }
  );
  assert.ok(atender, 'la ruta del informe tiene que estar registrada');
  let salida = null;
  atender({ user: YO, params: {}, query: consulta }, { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

// ------------------------------------------------------------ el filtro ---

test('sin acotar, el informe trae todas las actividades', () => {
  const d = informe();
  assert.equal(d.general.actividades, 5);
  assert.equal(d.general.total, 20);
});

test('EL CASO: acotado a un tipo, trae solo el de ese tipo', () => {
  const d = informe({ tipo_actividad: 'Estudio Bíblico' });
  assert.equal(d.general.actividades, 1);
  assert.equal(d.general.total, 4);
  assert.equal(d.general.presentes, 2);
  assert.equal(d.general.pct_presente, 50);
});

test('y los tipos se reparten el total, sin perder ni repetir nada', () => {
  const todo = informe().general.total;
  const suma = ['Culto', 'Estudio Bíblico', 'Ensayo']
    .reduce((n, t) => n + informe({ tipo_actividad: t }).general.total, 0);
  assert.equal(suma, todo);
});

test('un tipo que no tiene ninguna actividad devuelve cero, no todo', () => {
  const d = informe({ tipo_actividad: 'Vigilia' });
  assert.equal(d.general.actividades, 0);
  assert.equal(d.general.total, 0);
});

test('el filtro llega a TODAS las tablas del informe, no solo al resumen', () => {
  const d = informe({ tipo_actividad: 'Culto' });
  assert.equal(d.porActividad.length, 3);
  assert.equal(d.porDia.length, 3);
  assert.deepEqual(d.porDia.map((f) => f.fecha).sort(), ['2026-03-01', '2026-03-08', '2026-03-15']);
  assert.equal(d.porCuerpo.length, 1);
  assert.equal(d.porCuerpo[0].total, 12);
  assert.equal(d.porMiembro.length, 4);
  assert.equal(d.marcas.every((m) => m.actividad === 'Culto'), true, 'se colaron marcas de otro tipo');
});

test('se combina con el período, no lo reemplaza', () => {
  const d = informe({ tipo_actividad: 'Culto', desde: '2026-03-05', hasta: '2026-03-31' });
  assert.equal(d.general.actividades, 2, 'el 1 de marzo quedó fuera por fecha');
  assert.deepEqual(d.porDia.map((f) => f.fecha).sort(), ['2026-03-08', '2026-03-15']);
});

test('y con el informe de una persona', () => {
  const d = informe({ tipo: 'persona', miembro_id: gente[3], tipo_actividad: 'Culto' });
  assert.equal(d.general.total, 3, 'sus tres cultos');
  assert.equal(d.marcas.every((m) => m.actividad === 'Culto'), true);
});

// ---------------------------------- el nombre del parámetro, que se pisó ---

test('LA TRAMPA: «tipo» sigue siendo QUÉ informe se pide, no de qué actividad', () => {
  /*
   * El informe general se pedía a sí mismo con `tipo=general`. Si el filtro se
   * llamara igual, esa misma palabra se leería como el tipo de la actividad
   * —«general», que no existe— y el informe saldría en cero.
   */
  const d = informe({ tipo: 'general' });
  assert.equal(d.general.actividades, 5, 'pedir el informe general lo dejó vacío');
  assert.equal(d.tipo, 'general');
  assert.equal(d.tipo_actividad, null);
});

test('el informe dice a qué tipo quedó acotado, para poder decirlo en la hoja', () => {
  assert.equal(informe().tipo_actividad, null);
  assert.equal(informe({ tipo_actividad: 'Ensayo' }).tipo_actividad, 'Ensayo');
});

test('la pantalla manda el parámetro con su nombre propio', () => {
  assert.match(app, /params\.set\('tipo_actividad', st\.actividad\)/);
  assert.equal(/params\.set\('tipo', st\.actividad\)/.test(app), false,
    'la pantalla volvió a pisar el parámetro que dice qué informe se pide');
});

// ------------------------------------------------- lo que dice la pantalla ---

test('un informe acotado lo dice: sin eso se lee —y se imprime— como el de todo', () => {
  assert.match(app, /const soloDe = d\.tipo_actividad \? `solo «\$\{d\.tipo_actividad\}», ` : '';/);
  // y esa misma frase es la que se baja en la planilla, por ir en el período
  assert.match(app, /comilla\('Período'\), comilla\(INFORME\.periodo\)/);
});

test('los tipos que ofrece el filtro salen de donde los mantiene la iglesia', () => {
  // La misma lección del filtro del calendario: una lista escrita aparte se
  // desactualiza sin que nada avise
  assert.match(app, /const tiposDeActividad = await opcionesDelCampo\('asistencias', 'tipo_reunion'\)/);
});
