/**
 * QUIEN ESTUVO SIN SER DEL CUERPO.
 *
 * La lista sale de los integrantes de los cuerpos convocados, y quien llegó
 * sin pertenecer a ninguno —una visita, alguien de otro cuerpo que pasó, un
 * familiar— no se podía anotar: el servidor contestaba «no está en ninguno de
 * los cuerpos convocados a esta actividad».
 *
 * Esa regla está bien y se queda: es la que impide ensuciar el porcentaje con
 * gente que no corresponde. Lo que faltaba era la otra mitad. Una VISITA deja
 * constancia de que estuvo —que es lo que se quiere saber de una visita— y
 * queda fuera de todos los porcentajes: del avance de la lista, del informe y
 * de la planilla del cuerpo. Así no le altera el cumplimiento a nadie.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const planilla = require('../../server/planilla-asistencia');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las visitas', 'IG-VI', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La de al lado de las visitas', 'IG-VI2', 'Activa')")
  .run().lastInsertRowid;

const unCuerpo = (nombre, ig) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(nombre, ig || iglesia).lastInsertRowid;
const damas = unCuerpo('Damas');
const coro = unCuerpo('Coro');          // convocado, pero no le toca a la secretaria
const otroCuerpo = unCuerpo('Jóvenes'); // ni siquiera convocado

let n = 0;
function unMiembro(cuerpoId, ig) {
  n++;
  const m = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(`Vis${n}`, `Ita${n}`, ig || iglesia).lastInsertRowid;
  if (cuerpoId) {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
       VALUES (?, ?, ?, 'Activo', '2024-01-01')`
    ).run(cuerpoId, m, ig || iglesia);
  }
  return m;
}

const lasDamas = [unMiembro(damas), unMiembro(damas), unMiembro(damas), unMiembro(damas)];
const delCoro = unMiembro(coro);
const deJovenes = unMiembro(otroCuerpo);          // de la misma iglesia, otro cuerpo
const suelto = unMiembro(null);                   // sin cuerpo
const deLaOtraIglesia = unMiembro(null, otraIglesia);
const noInscrito = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Pedro', 'Vega', ?)")
  .run(iglesia).lastInsertRowid;

const actividadId = db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-05-10', 'Culto', ?, ?)")
  .run(iglesia, JSON.stringify([damas, coro])).lastInsertRowid;

const usuario = db
  .prepare("INSERT INTO usuarios (rut, nombre, rol, iglesia_id, activo) VALUES ('22000001-2', 'Ana Soto Vera', 'consulta', ?, 1)")
  .run(iglesia).lastInsertRowid;
/** La secretaria de Damas: la actividad convoca a dos cuerpos, ella lleva uno. */
const ANA = { id: usuario, rol: 'consulta', iglesias: [iglesia], cuerpos: [damas], nombre: 'Ana Soto Vera' };
const JEFA = { id: usuario, rol: 'admin', iglesias: [iglesia], cuerpos: [], nombre: 'Ana Soto Vera' };

function porLaRuta(metodo, cual, usuarioQuePide, { body, query, id } = {}) {
  let atender = null;
  const guardar = (ruta, permiso, mano) => { if (ruta === cual) atender = mano; };
  const router = { get: metodo === 'get' ? guardar : () => {}, post: metodo === 'post' ? guardar : () => {} };
  asistencias.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next(), can: () => true });
  assert.ok(atender, `la ruta ${cual} tiene que estar registrada`);
  let salida = null; let estado = 200;
  atender(
    { user: usuarioQuePide, params: { id: String(id || actividadId) }, query: query || {}, body: body || {} },
    { json: (d) => { salida = d; }, status(c) { estado = c; return this; } }
  );
  return { estado, ...salida };
}
const pasar = (quien, marcas, id) => porLaRuta('post', '/asistencias/:id(\\d+)/lista', quien, { body: { marcas }, id });
const laLista = (quien) => porLaRuta('get', '/asistencias/:id(\\d+)/lista', quien);
const buscar = (quien, texto) => porLaRuta('get', '/asistencias/:id(\\d+)/quien-puede-visitar', quien, { query: { buscar: texto } });
const agenda = (quien) => porLaRuta('get', '/asistencias/agenda', quien, { query: { desde: '2026-05-10', hasta: '2026-05-10' } })
  .actividades.find((a) => a.id === actividadId);

const marca = (miembroId, cuerpoId, estado, extra) =>
  ({ persona_tipo: 'Miembro', miembro_id: miembroId, no_miembro_id: null, cuerpo_id: cuerpoId, estado, ...extra });

// ------------------------------------------------ la regla que se queda ---

test('sin decir que es visita, a quien no está convocado se le sigue rechazando', () => {
  const r = pasar(ANA, [marca(deJovenes, damas, 'Presente')]);
  assert.equal(r.estado, 403);
  assert.match(r.error, /no es de los cuerpos que a usted le toca|no está en ninguno de los cuerpos/);
});

// ------------------------------------------------------------ la visita ---

test('EL CASO: a quien estuvo sin ser del cuerpo se lo puede anotar como visita', () => {
  pasar(ANA, lasDamas.map((m) => marca(m, damas, 'Presente')));
  const r = pasar(ANA, [marca(deJovenes, damas, 'Presente', { visita: true })]);
  assert.equal(r.estado, 200);
  assert.equal(r.guardadas, 1);
});

test('sale en la lista, marcada como visita', () => {
  const suya = laLista(ANA).personas.find((p) => p.miembro_id === deJovenes);
  assert.ok(suya, 'la visita no aparece en la lista');
  assert.equal(suya.visita, true);
  assert.equal(suya.estado, 'Presente');
  assert.equal(suya.cuerpo, 'Damas', 'queda en la lista a la que se la sumó');
});

test('y NO le mueve el avance al cuerpo: ni el padrón ni lo marcado', () => {
  const av = agenda(ANA);
  assert.equal(av.convocados, 4, 'la visita engrosó el padrón');
  assert.equal(av.marcados, 4, 'la visita se contó como marcada');
  assert.equal(av.presentes, 4);
  assert.equal(av.visitas, 1, 'y se cuenta aparte');
});

test('ni el porcentaje del informe', () => {
  const inf = porLaRuta('get', '/asistencias/informe', JEFA, { query: { desde: '2026-05-10', hasta: '2026-05-10' } });
  assert.equal(inf.general.total, 4);
  assert.equal(inf.general.presentes, 4);
  assert.equal(inf.general.pct_presente, 100);
  assert.equal(inf.visitas, 1);
});

test('ni la planilla mensual del cuerpo: no le abre una fila', () => {
  const hoja = planilla.armar(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(damas), '2026-05');
  assert.equal(hoja.integrantes.length, 4);
  assert.equal(hoja.integrantes.some((f) => f.miembro_id === deJovenes), false, 'la visita entró a la planilla');
});

test('y un día con SOLO visitas no le abre una columna al cuerpo', () => {
  /*
   * Es el efecto que la planilla sí podía sufrir: un día en que se anotó una
   * visita y todavía no se marcó a nadie del cuerpo aparecía como día de
   * reunión, con las cuatro integrantes en ausente. El cuerpo no se reunió ese
   * día —o no se le había pasado lista— y la planilla decía que faltaron
   * todas.
   */
  const otroDia = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-05-24', 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([damas])).lastInsertRowid;
  const r = pasar(ANA, [marca(suelto, damas, 'Presente', { visita: true })], otroDia);
  assert.equal(r.estado, 200);

  const hoja = planilla.armar(db, db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(damas), '2026-05');
  assert.equal(hoja.diasConReunion.includes(24), false,
    'el día de la visita salió como día de reunión del cuerpo');
  assert.equal(hoja.porDia[24], undefined, 'y con todas las integrantes en ausente');
  // el día en que sí se pasó lista sigue estando
  assert.equal(hoja.diasConReunion.includes(10), true);
});

test('una visita también puede ser alguien que no está inscrito en la membresía', () => {
  const r = pasar(ANA, [{ persona_tipo: 'No miembro', miembro_id: null, no_miembro_id: noInscrito, cuerpo_id: damas, estado: 'Presente', visita: true }]);
  assert.equal(r.estado, 200);
  const suya = laLista(ANA).personas.find((p) => p.no_miembro_id === noInscrito);
  assert.equal(suya.visita, true);
  assert.equal(agenda(ANA).visitas, 2);
});

test('corregirle el estado a una visita no la convierte en integrante', () => {
  /*
   * La corrección no repite `visita: true` —la pantalla manda lo que cambió—,
   * y sin acordarse de lo que ya estaba guardado, la marca pasaría a contar en
   * el porcentaje del cuerpo sin que nadie lo haya pedido.
   */
  const r = pasar(ANA, [marca(deJovenes, damas, 'Justificado', { motivo: 'Enfermedad' })]);
  assert.equal(r.estado, 200);
  const suya = laLista(ANA).personas.find((p) => p.miembro_id === deJovenes);
  assert.equal(suya.visita, true, 'dejó de ser visita al corregirla');
  assert.equal(agenda(ANA).marcados, 4, 'y se le coló al avance del cuerpo');
});

test('quitarle la marca a una visita la saca de la lista', () => {
  pasar(ANA, [marca(deJovenes, damas, null)]);
  assert.equal(laLista(ANA).personas.some((p) => p.miembro_id === deJovenes), false);
  assert.equal(agenda(ANA).visitas, 1);
});

// --------------------------------------------------- lo que no se acepta ---

test('una visita se suma a un cuerpo QUE A UNO LE TOCA, no a cualquiera', () => {
  // El Coro está convocado, pero Ana no lo lleva
  const r = pasar(ANA, [marca(deJovenes, coro, 'Presente', { visita: true })]);
  assert.equal(r.estado, 403);
  assert.match(r.error, /un cuerpo que le toca pasar/);
});

test('ni a un cuerpo que ni siquiera está convocado', () => {
  const r = pasar(JEFA, [marca(deJovenes, otroCuerpo, 'Presente', { visita: true })]);
  assert.equal(r.estado, 403);
});

test('una visita que no está en el sistema se rechaza', () => {
  const r = pasar(ANA, [marca(999999, damas, 'Presente', { visita: true })]);
  assert.equal(r.estado, 400);
  assert.match(r.error, /no está en el sistema/);
});

test('ni alguien de otra iglesia', () => {
  const r = pasar(ANA, [marca(deLaOtraIglesia, damas, 'Presente', { visita: true })]);
  assert.equal(r.estado, 403);
  assert.match(r.error, /iglesia/);
});

// ------------------------------------------------- a quién se puede sumar ---

test('se busca en los dos registros, por nombre', () => {
  const d = buscar(ANA, 'Vis');
  assert.ok(d.gente.length > 0);
  assert.equal(d.gente.every((p) => ['Miembro', 'No miembro'].includes(p.persona_tipo)), true);
});

test('LA REGLA: se busca por IGLESIA, no por cuerpo', () => {
  /*
   * El caso que esto viene a resolver es justamente el de alguien de OTRO
   * cuerpo que pasó. Buscarlo entre los del cuerpo propio no lo encontraría
   * nunca, y la pantalla diría que esa persona no existe.
   */
  const d = buscar(ANA, 'Vis');
  assert.equal(d.gente.some((p) => p.miembro_id === deJovenes), true, 'no encuentra a alguien de otro cuerpo');
  assert.equal(d.gente.some((p) => p.miembro_id === suelto), true, 'no encuentra a alguien sin cuerpo');
});

test('pero no en otra iglesia', () => {
  const d = buscar(ANA, 'Vis');
  assert.equal(d.gente.some((p) => p.miembro_id === deLaOtraIglesia), false);
});

test('y no se ofrece a quien ya está en la lista', () => {
  const d = buscar(ANA, 'Vis');
  for (const m of lasDamas) {
    assert.equal(d.gente.some((p) => p.miembro_id === m), false, 'ofrece a alguien que ya está convocado');
  }
  assert.equal(d.gente.some((p) => p.no_miembro_id === noInscrito), false, 'ofrece a una visita ya anotada');
});

test('dice a qué cuerpos se la puede sumar: los que a uno le tocan', () => {
  assert.deepEqual(buscar(ANA, 'Vis').cuerpos.map((c) => c.nombre), ['Damas']);
  assert.deepEqual(buscar(JEFA, 'Vis').cuerpos.map((c) => c.nombre).sort(), ['Coro', 'Damas']);
});

test('con menos de dos letras no se busca: se dice y no se recorre la iglesia entera', () => {
  const d = buscar(ANA, 'V');
  assert.deepEqual(d.gente, []);
  assert.equal(d.corto, true);
});

// ------------------------------------------------- lo que dice la pantalla ---

test('la lista no cuenta las visitas en el avance', () => {
  assert.match(app, /const propias = filas\(\)\.filter\(\(li\) => li\.dataset\.visita !== '1'\);/);
});

test('la marca que se manda dice si es visita', () => {
  assert.match(app, /visita: li\.dataset\.visita === '1' \|\| undefined,/);
});

test('«Todos presentes» no toca a las visitas: cada una se anotó a mano', () => {
  assert.match(app, /const aLaVista = filas\(\)\.filter\(\(li\) => !li\.hidden && li\.dataset\.visita !== '1'\);/);
});

test('y la fila de una visita se distingue a simple vista', () => {
  assert.match(app, /class="badge yellow" title="Estuvo, pero no es del cuerpo: no cuenta en el porcentaje">Visita/);
});
