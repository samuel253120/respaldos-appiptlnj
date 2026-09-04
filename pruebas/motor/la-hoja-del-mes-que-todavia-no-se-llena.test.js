/**
 * La planilla mensual dibuja también los días que TODAVÍA no tienen lista.
 *
 * La hoja se armaba con una sola pregunta —«¿qué días tienen marcas?»— y esta
 * hoja se imprime apaisada y se lleva a la reunión: el mes que uno quiere
 * imprimir para ir llenándolo a mano es justamente el que no tiene ninguna
 * marca. Medido en la v1.374.0 sobre el cuerpo con más actividades de junio
 * —diez—: la hoja salía con sus cincuenta y un integrantes y CERO columnas.
 *
 * Son dos preguntas distintas y ahora se contestan por separado:
 *
 *   · los días con LISTA PASADA, de los que cuelga toda la cuenta —la columna
 *     «T.», el porcentaje de cada integrante y el pie de cada día—;
 *   · los días PROGRAMADOS, que tienen actividad y todavía no tienen lista.
 *
 * Lo delicado es que los segundos NO entren en ninguna cuenta: un día en que
 * no se pasó lista no le baja el porcentaje a nadie. Van como columna en
 * blanco, que es lo que hay que llenar. Eso es lo que se comprueba acá, en las
 * dos mitades: la que calcula (server/planilla-asistencia.js) y la que dibuja
 * (`pintarPlanilla`, en public/app.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const planilla = require('../../server/planilla-asistencia');

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central HL ${marca}`, `HL-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Ciclistas HL ${marca}`, iglesia).lastInsertRowid;
const laFila = () => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpo);

/** Cuatro integrantes, que es gente de sobra para que los porcentajes se vean. */
const gente = [];
for (let i = 0; i < 4; i++) {
  const numero = `${21000000 + (marca * 13 + i) % 900000}`;
  const id = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, genero, estado) VALUES (?,?,?,?,'Masculino','Activo')")
    .run(`Persona${i}`, `HL ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(cuerpo, id, iglesia);
  gente.push(id);
}

/** Una actividad de este cuerpo ese día. Sin marcas: todavía no se pasa lista. */
function seProgramo(fecha, deQuien = cuerpo) {
  return db.prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, nombre, iglesia_id, cuerpos)
     VALUES (?, 'Ensayo', 'Reunión', ?, ?)`
  ).run(fecha, iglesia, JSON.stringify([deQuien])).lastInsertRowid;
}

/** Y se le pasa la lista, que es lo que convierte el día en día con reunión. */
function seLePasoLista(actividad, fecha, estados) {
  estados.forEach((estado, i) => {
    db.prepare(
      `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
       VALUES (?,?,?,?,?,?)`
    ).run(actividad, gente[i], estado, cuerpo, fecha, iglesia);
  });
}

// El mes de la prueba: tres actividades, y a una sola se le pasó la lista
const conLista = seProgramo('2026-06-03');
seLePasoLista(conLista, '2026-06-03', ['Presente', 'Presente', 'Justificado', 'Ausente']);
seProgramo('2026-06-10');
seProgramo('2026-06-24');

// ------------------------------------------------- lo que calcula el servidor

test('el día que ya tiene lista es día con reunión, y no se repite como programado', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.deepEqual(p.diasConReunion, [3]);
  assert.ok(!p.diasProgramados.includes(3), 'el 3 ya tiene su lista: no está esperando ninguna');
});

test('los días con actividad y sin lista salen aparte, en orden', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.deepEqual(p.diasProgramados, [10, 24]);
});

test('un mes entero sin una sola lista igual trae sus columnas', () => {
  seProgramo('2026-09-06');
  seProgramo('2026-09-13');
  const p = planilla.armar(db, laFila(), '2026-09');
  assert.deepEqual(p.diasConReunion, [], 'no se pasó ninguna lista');
  assert.deepEqual(p.diasProgramados, [6, 13], 'y aun así la hoja tiene qué imprimir');
  assert.equal(p.integrantes.length, 4, 'con su gente');
});

// ---------------------------------- y lo delicado: que no entren en la cuenta

test('un día sin lista no le baja el porcentaje a nadie', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  for (const x of p.integrantes) {
    assert.equal(x.total, 1, `${x.nombre}: el total son los días con lista, no los programados`);
    assert.equal(x.presentes + x.justificados + x.ausentes, 1, x.nombre);
  }
  const [uno, dos, tres, cuatro] = p.integrantes;
  assert.equal(uno.pct_presente, 100, 'estuvo el único día que se pasó lista');
  assert.equal(dos.pct_presente, 100);
  assert.equal(tres.pct_justificado, 100);
  assert.equal(cuatro.pct_ausente, 100);
});

test('el día sin lista tampoco lleva nada al pie', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  assert.ok(p.porDia[3], 'el 3 sí, que tiene lista');
  assert.equal(p.porDia[10], undefined, 'el 10 está esperando la suya: no hay qué totalizar');
  assert.equal(p.porDia[24], undefined);
});

test('a nadie se le marca una letra en un día sin lista', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  for (const x of p.integrantes) {
    assert.deepEqual(Object.keys(x.marcas), ['3'], `${x.nombre}: solo el día con lista lleva letra`);
  }
});

test('la actividad de otro cuerpo no programa columnas en esta hoja', () => {
  const otro = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Coro HL ${marca}`, iglesia).lastInsertRowid;
  seProgramo('2026-10-07', otro);
  const p = planilla.armar(db, laFila(), '2026-10');
  assert.deepEqual(p.diasProgramados, [], 'esa reunión es del Coro');
  assert.deepEqual(p.diasConReunion, []);
});

test('un mes en que el cuerpo no tuvo nada no inventa columnas', () => {
  const p = planilla.armar(db, laFila(), '2026-11');
  assert.deepEqual(p.diasConReunion, []);
  assert.deepEqual(p.diasProgramados, []);
  assert.equal(p.dias.length, 30, 'los treinta días del mes siguen estando, todos en gris');
});

// -------------------------------------------------- lo que dibuja la pantalla

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/** `pintarPlanilla` de app.js, sacada del propio archivo y puesta a andar. */
const pintarPlanilla = (() => {
  const desde = app.indexOf('function pintarPlanilla(d) {');
  assert.ok(desde > 0, 'app.js tiene que traer pintarPlanilla');
  let abiertas = 0;
  let hasta = desde;
  for (; hasta < app.length; hasta++) {
    if (app[hasta] === '{') abiertas++;
    else if (app[hasta] === '}' && --abiertas === 0) { hasta++; break; }
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'membreteDelDocumento', 'pieDelDocumento',
    `${app.slice(desde, hasta)}; return pintarPlanilla;`)(esc, () => '', () => '');
})();

/** Cuántas veces aparece algo en un texto. */
const cuantas = (texto, aguja) => texto.split(aguja).length - 1;

test('la hoja dibuja una casilla por llenar en cada día programado', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  const html = pintarPlanilla(p);
  // Dos días programados: una casilla por integrante más una por fila del pie
  assert.equal(cuantas(html, 'class="por-llenar"'), 2 * (p.integrantes.length + 7));
  assert.equal(cuantas(html, 'class="marca '), p.integrantes.length, 'y el día con lista lleva su letra');
});

test('el encabezado deja en gris solo los días que no van en la hoja', () => {
  const p = planilla.armar(db, laFila(), '2026-06');
  const html = pintarPlanilla(p);
  assert.equal(cuantas(html, 'col-dia sin-reunion'), 30 - 3, 'los 3 de la hoja —el 3, el 10 y el 24— no van en gris');
});

test('el mes sin una sola lista se dibuja igual, y no dice que no hubo nada', () => {
  const p = planilla.armar(db, laFila(), '2026-09');
  const html = pintarPlanilla(p);
  assert.ok(!html.includes('no tuvo ninguna actividad'), 'sí tuvo: dos, esperando su lista');
  assert.ok(html.includes('<table class="planilla-mes">'), 'la tabla se dibuja entera');
  assert.equal(cuantas(html, 'class="por-llenar"'), 2 * (p.integrantes.length + 7));
});

test('el mes en que de verdad no hubo nada lo dice, y no dibuja una tabla vacía', () => {
  const p = planilla.armar(db, laFila(), '2026-11');
  const html = pintarPlanilla(p);
  assert.ok(html.includes('no tuvo ninguna actividad'), 'acá sí corresponde decirlo');
  assert.ok(!html.includes('<table class="planilla-mes">'));
});
