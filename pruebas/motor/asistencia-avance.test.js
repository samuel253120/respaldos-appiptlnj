/**
 * LOS DOS NÚMEROS QUE ENGAÑABAN.
 *
 * 1) EL AVANCE «MARCADOS / CONVOCADOS» DE LA AGENDA contaba cuerpos que no le
 *    tocaban a quien preguntaba. Medido contra un servidor con 600 miembros y
 *    30.000 marcas: una encargada de un cuerpo de 49 personas abría una
 *    actividad que convoca a dos cuerpos y la agenda le decía «200 / 98» —su
 *    lista tenía 49 filas—. La barra quedaba en 204 %, y «Faltan N» en
 *    negativo. De 25 actividades cotejadas, 22 no cuadraban con la lista que
 *    esa persona iba a abrir; al administrador le fallaban 24 de 25.
 *
 * 2) EL PORCENTAJE DEL LISTADO se repartía entre los MARCADOS, no entre los
 *    convocados: una lista recién empezada —una persona de 49, presente— salía
 *    «100 %», y la misma marca puesta en ausente la dejaba en «0 %». Ninguno de
 *    los dos describía lo que pasó en esa reunión.
 *
 * La regla que lo cierra: el avance cuenta EXACTAMENTE lo que va a mostrar la
 * lista que esa persona abre. De ahí sale que «marcados» no pueda pasar de
 * «convocados», y que un porcentaje solo se muestre cuando están todos
 * marcados.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const { avanceDe, integrantesConvocados } = asistencias;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del avance', 'IG-AV', 'Activa')")
  .run().lastInsertRowid;

const unCuerpo = (nombre) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(nombre, iglesia).lastInsertRowid;

const damas = unCuerpo('Damas');
const jovenes = unCuerpo('Jóvenes');

let n = 0;
function alguienEn(...cuerpos) {
  n++;
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(`Av${n}`, `Ance${n}`, iglesia).lastInsertRowid;
  for (const c of cuerpos) {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
       VALUES (?, ?, ?, 'Activo', '2024-01-01')`
    ).run(c, miembro, iglesia);
  }
  return miembro;
}

// Damas 5, Jóvenes 8: dos cuerpos de tamaño distinto convocados a lo mismo
const lasDamas = [];
for (let i = 0; i < 5; i++) lasDamas.push(alguienEn(damas));
const losJovenes = [];
for (let i = 0; i < 8; i++) losJovenes.push(alguienEn(jovenes));

const actividadId = db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-08-26', 'Culto', ?, ?)")
  .run(iglesia, JSON.stringify([damas, jovenes])).lastInsertRowid;
const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(actividadId);

/** Quien no tiene cuerpos asignados alcanza todo: el administrador. */
const admin = { id: 1, rol: 'admin', iglesias: [iglesia], cuerpos: [] };
/** Quien solo lleva Damas. */
const deDamas = { id: 2, rol: 'consulta', iglesias: [iglesia], cuerpos: [damas] };

const marcarEn = (enQue, miembroId, cuerpoId, estado) => {
  // La marca lleva la fecha de SU actividad: por ahí la busca el informe
  const cuando = db.prepare('SELECT fecha FROM asistencias WHERE id = ?').get(enQue).fecha;
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
     VALUES (?, 'Miembro', ?, ?, ?, ?, ?)`
  ).run(enQue, miembroId, estado, cuerpoId, cuando, iglesia);
};
const marcar = (miembroId, cuerpoId, estado) => marcarEn(actividadId, miembroId, cuerpoId, estado);
const lasMarcas = () => db
  .prepare('SELECT miembro_id, no_miembro_id, cuerpo_id, estado FROM asistencia_detalle WHERE asistencia_id = ?')
  .all(actividadId);

// ---------------------------------------------------------------- el padrón

test('a quien lleva un cuerpo se le cuenta SU cuerpo, no los dos', () => {
  assert.equal(avanceDe(actividad, db, deDamas, lasMarcas()).convocados, 5);
});

test('a quien no tiene cuerpos asignados se le cuentan los dos convocados', () => {
  assert.equal(avanceDe(actividad, db, admin, lasMarcas()).convocados, 13);
});

test('el padrón es el mismo que la lista que esa persona va a abrir', () => {
  // Es la regla de la que sale todo lo demás: lo que se cuenta arriba tiene
  // su fila abajo.
  for (const quien of [admin, deDamas]) {
    assert.equal(
      avanceDe(actividad, db, quien, lasMarcas()).convocados,
      integrantesConvocados(actividad, db, quien).size
    );
  }
});

// -------------------------------------------------------------- lo marcado

test('EL CASO: las marcas del otro cuerpo no le suman a quien no lo lleva', () => {
  for (const m of losJovenes) marcar(m, jovenes, 'Presente'); // 8 marcas ajenas

  const suyo = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.equal(suyo.marcados, 0, 'le está contando marcas de Jóvenes');
  assert.equal(suyo.convocados, 5);

  // y al administrador, que sí lleva los dos, se le cuentan
  const todo = avanceDe(actividad, db, admin, lasMarcas());
  assert.equal(todo.marcados, 8);
  assert.equal(todo.convocados, 13);
});

test('lo marcado NUNCA pasa del padrón', () => {
  for (const m of lasDamas) marcar(m, damas, 'Presente');
  for (const quien of [admin, deDamas]) {
    const av = avanceDe(actividad, db, quien, lasMarcas());
    assert.ok(av.marcados <= av.convocados,
      `${av.marcados}/${av.convocados}: el avance pasa del 100 %`);
  }
});

test('con la lista entera, marcados y convocados coinciden', () => {
  const av = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.equal(av.marcados, 5);
  assert.equal(av.convocados, 5);
});

test('los tres estados se cuentan por separado, y solo los suyos', () => {
  const av = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.deepEqual(
    { p: av.presentes, a: av.ausentes, j: av.justificados },
    { p: 5, a: 0, j: 0 }
  );
});

// ------------------------------------------- quien salió después de marcado

test('a quien salió del cuerpo se lo cuenta en las DOS mitades', () => {
  /*
   * La lista lo sigue mostrando —«(ya no figura)»— para que su marca no
   * desaparezca sin que nadie lo note. Si se contara solo arriba, el avance
   * volvería a pasar del 100 %.
   */
  const seFue = lasDamas[0];
  db.prepare('DELETE FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?').run(damas, seFue);

  const av = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.equal(av.convocados, 5, 'son 4 en el cuerpo + 1 que ya no figura pero tiene marca');
  assert.equal(av.marcados, 5);
  assert.equal(av.convocados, integrantesConvocados(actividad, db, deDamas).size + 1);
});

test('una marca de un cuerpo que no lleva no le entra por ese camino', () => {
  const av = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.equal(av.marcados, 5, 'se le colaron las 8 de Jóvenes');
});

test('una marca sin persona no cuenta en ninguna de las dos mitades', () => {
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, estado, cuerpo_id, fecha, iglesia_id)
     VALUES (?, 'Miembro', 'Presente', ?, '2026-08-26', ?)`
  ).run(actividadId, damas, iglesia);
  const av = avanceDe(actividad, db, deDamas, lasMarcas());
  assert.equal(av.marcados, 5);
  assert.equal(av.convocados, 5);
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id IS NULL').run(actividadId);
});

// ------------------------------------------------------ el porcentaje

/*
 * Con su propio cuerpo y su propia actividad: acá se mira UNA lista de diez y
 * cómo se va diciendo mientras se pasa, sin que la arrastren los cambios que
 * hicieron las comprobaciones de más arriba.
 */
const coro = unCuerpo('Coro');
const elCoro = [];
for (let i = 0; i < 10; i++) elCoro.push(alguienEn(coro));
const ensayoId = db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-09-02', 'Ensayo', ?, ?)")
  .run(iglesia, JSON.stringify([coro])).lastInsertRowid;
const ensayo = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(ensayoId);
const delCoro = { id: 3, rol: 'consulta', iglesias: [iglesia], cuerpos: [coro] };

const campoPorcentaje = (asistencias.computed || []).find((c) => c.name === 'porcentaje');
const laInsignia = (quien, fila = ensayo) =>
  campoPorcentaje.calc(fila, { db, usuario: quien, recuerdo: new Map() });

/** Deja la lista con `presentes` presentes, `ausentes` ausentes y el resto sin marcar. */
const comoQuedo = (presentes, ausentes = 0) => {
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(ensayoId);
  elCoro.forEach((m, i) => {
    if (i < presentes) marcarEn(ensayoId, m, coro, 'Presente');
    else if (i < presentes + ausentes) marcarEn(ensayoId, m, coro, 'Ausente');
  });
  return laInsignia(delCoro);
};

test('sin ninguna marca dice «Sin lista», no un porcentaje', () => {
  assert.equal(comoQuedo(0).texto, 'Sin lista');
});

test('EL CASO: una marca de diez no es «100 %», es «1 de 10 marcados»', () => {
  const b = comoQuedo(1);
  assert.notEqual(b.texto, '100%');
  assert.equal(b.texto, '1 de 10 marcados');
  assert.equal(b.nivel, 'parcial');
});

test('y esa misma marca puesta en ausente tampoco es «0 %»', () => {
  const b = comoQuedo(0, 1);
  assert.notEqual(b.texto, '0%');
  assert.equal(b.texto, '1 de 10 marcados');
});

test('a medio pasar se sigue diciendo a medio pasar', () => {
  assert.equal(comoQuedo(6, 3).texto, '9 de 10 marcados');
});

test('con la lista entera, recién ahí sale el porcentaje', () => {
  assert.equal(comoQuedo(8, 2).texto, '80%');
});

test('el porcentaje se reparte entre los CONVOCADOS, no entre los marcados', () => {
  /*
   * Donde los dos números se separan: 3 presentes y 1 ausente de 10. Por el
   * camino viejo —dividir por los 4 marcados— daba 75 %; por el bueno, la
   * lista todavía no está pasada y no hay porcentaje que dar.
   */
  const b = comoQuedo(3, 1);
  assert.notEqual(b.texto, '75%');
  assert.equal(b.texto, '4 de 10 marcados');
});

test('un porcentaje de verdad lleva el color que le toca', () => {
  assert.equal(comoQuedo(10).nivel, 'ok');       // 100 %
  assert.equal(comoQuedo(8, 2).nivel, 'ok');     //  80 %
  assert.equal(comoQuedo(7, 3).nivel, 'medio');  //  70 %
  assert.equal(comoQuedo(2, 8).nivel, 'bajo');   //  20 %
  assert.equal(comoQuedo(0, 10).nivel, 'bajo');  //   0 %
});

test('a quien no lleva ese cuerpo el porcentaje no le cuenta lo ajeno', () => {
  comoQuedo(10);
  // La misma actividad, mirada por alguien de Damas: el Coro no es suyo
  assert.equal(laInsignia(deDamas).texto, 'Sin integrantes');
});

test('un cuerpo sin nadie se dice, en vez de dividir por cero', () => {
  const vacio = unCuerpo('Recién creado');
  const sola = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-08-27', 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([vacio])).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(sola);
  assert.equal(laInsignia(admin, fila).texto, 'Sin integrantes');
});

// ------------------------------- las dos rutas que muestran estos números ---

/** Llama a una ruta del módulo como lo haría el servidor. */
function porLaRuta(cual, usuario, consulta = {}) {
  let atender = null;
  const router = {
    get(ruta, permiso, mano) { if (ruta === cual) atender = mano; },
    post() {},
  };
  asistencias.extraRoutes(router, {
    db,
    requirePerm: () => (req, res, next) => next(),
    can: () => true,
  });
  assert.ok(atender, `la ruta ${cual} tiene que estar registrada`);
  let salida = null;
  atender({ user: usuario, query: consulta, params: {} },
    { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

test('LA AGENDA le da a cada quien el avance de su propia lista', () => {
  comoQuedo(4, 1); // el ensayo del Coro: 5 marcados de 10

  const suya = porLaRuta('/asistencias/agenda', delCoro, { desde: '2026-09-02', hasta: '2026-09-02' });
  const fila = suya.actividades.find((a) => a.id === ensayoId);
  assert.equal(fila.convocados, 10);
  assert.equal(fila.marcados, 5);
  assert.equal(fila.presentes, 4);
  assert.equal(fila.ausentes, 1);

  // y lo que cuenta es exactamente lo que va a mostrar su lista
  assert.equal(fila.convocados, integrantesConvocados(ensayo, db, delCoro).size);
});

test('LA AGENDA no le cuenta a nadie los cuerpos que no lleva', () => {
  // Damas y Jóvenes están convocados a la otra actividad, con marcas en ambos
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividadId);
  for (const m of losJovenes) marcar(m, jovenes, 'Presente');

  const ag = porLaRuta('/asistencias/agenda', deDamas, { desde: '2026-08-26', hasta: '2026-08-26' });
  const fila = ag.actividades.find((a) => a.id === actividadId);
  assert.equal(fila.marcados, 0, 'le está contando las 8 marcas de Jóvenes');
  assert.ok(fila.marcados <= fila.convocados, 'el avance pasa del 100 %');
});

test('EL INFORME dice de cuántos se marcó, actividad por actividad', () => {
  /*
   * Los porcentajes del informe se reparten entre los MARCADOS: para el
   * promedio de un período es lo correcto, pero en la fila de UNA actividad
   * una lista con una marca de diez salía «100 %». Ahora va al lado a cuánta
   * gente se convocó, y la pantalla puede decir «1 de 10 marcados».
   */
  comoQuedo(1); // una sola marca, presente

  const inf = porLaRuta('/asistencias/informe', delCoro, { desde: '2026-09-02', hasta: '2026-09-02' });
  const fila = inf.porActividad.find((f) => f.asistencia_id === ensayoId);
  assert.equal(fila.pct_presente, 100, 'el porcentaje sigue siendo el de siempre');
  assert.equal(fila.total, 1);
  assert.equal(fila.convocados, 10, 'sin esto la pantalla no puede decir que está a medias');
});

test('EL INFORME de una persona no trae padrón: no habría con qué compararla', () => {
  const inf = porLaRuta('/asistencias/informe', delCoro,
    { desde: '2026-09-02', hasta: '2026-09-02', miembro_id: elCoro[0] });
  const fila = inf.porActividad.find((f) => f.asistencia_id === ensayoId);
  assert.equal(fila.convocados, undefined);
});

test('EL INFORME acotado a un cuerpo cuenta el padrón de ESE cuerpo', () => {
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividadId);
  marcar(lasDamas[1], damas, 'Presente');
  for (const m of losJovenes) marcar(m, jovenes, 'Presente');

  const inf = porLaRuta('/asistencias/informe', admin,
    { desde: '2026-08-26', hasta: '2026-08-26', cuerpo_id: damas });
  const fila = inf.porActividad.find((f) => f.asistencia_id === actividadId);
  assert.equal(fila.total, 1, 'solo las marcas de Damas');
  assert.equal(fila.convocados, integrantesConvocados(actividad, db, deDamas).size);
});

// ------------------------------------------------- lo que dice la pantalla ---

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/** `loQueFaltaMarcar` de app.js, sacada del propio archivo y puesta a andar. */
const loQueFaltaMarcar = (() => {
  const desde = app.indexOf('function loQueFaltaMarcar(f) {');
  assert.ok(desde > 0, 'app.js tiene que traer loQueFaltaMarcar');
  const hasta = app.indexOf('\n}', desde) + 2;
  // eslint-disable-next-line no-new-func
  return new Function('fmtNumero', `${app.slice(desde, hasta)}; return loQueFaltaMarcar;`)(String);
})();

test('la pantalla dice «1 de 10 marcados» cuando la lista quedó a medias', () => {
  assert.equal(loQueFaltaMarcar({ total: 1, convocados: 10 }), '1 de 10 marcados');
  assert.equal(loQueFaltaMarcar({ total: 9, convocados: 10 }), '9 de 10 marcados');
});

test('y no dice nada cuando la lista está entera', () => {
  assert.equal(loQueFaltaMarcar({ total: 10, convocados: 10 }), '');
});

test('ni cuando el servidor no mandó el padrón', () => {
  // El informe de una persona no lo manda: ahí la fila no lleva la marca
  assert.equal(loQueFaltaMarcar({ total: 1 }), '');
  assert.equal(loQueFaltaMarcar({ total: 1, convocados: 0 }), '');
  assert.equal(loQueFaltaMarcar(null), '');
});

test('ni cuando hay más marcas que convocados: eso no es estar a medias', () => {
  // Pasa cuando alguien salió del cuerpo después de que le marcaran
  assert.equal(loQueFaltaMarcar({ total: 12, convocados: 10 }), '');
});

test('la pantalla y la planilla dicen lo mismo: las dos usan la misma frase', () => {
  /*
   * Se escribió dos veces —una en la tabla y otra en el CSV— y se separaron:
   * la planilla se quedó sin decirlo. Ahora es una sola función, y esto
   * vigila que ninguna de las dos se la salte.
   */
  const enLaTabla = /aMedioPasar\s*=\s*\(f\)\s*=>\s*\(loQueFaltaMarcar\(f\)/.test(app);
  assert.ok(enLaTabla, 'la tabla del informe dejó de usar loQueFaltaMarcar');
  const enLaPlanilla = /bloque\('Actividad por actividad'[\s\S]{0,320}loQueFaltaMarcar\(f\)/.test(app);
  assert.ok(enLaPlanilla, 'la planilla del informe dejó de usar loQueFaltaMarcar');
});

// -------------------------------------------------- lo que le cuesta pedirlo

test('los integrantes de un cuerpo se recorren UNA vez por respuesta', () => {
  /*
   * Es lo que hacía cara la agenda: se armaban las personas de cada cuerpo una
   * vez por cada actividad que lo convoca —153 al año sobre 12 cuerpos—, y la
   * agenda de un año costaba 300 ms. Con el recuerdo compartido bajó a 106 ms.
   * Acá se cuida la razón, contando las consultas de verdad.
   */
  const recuerdo = new Map();
  let consultas = 0;
  const original = db.prepare.bind(db);
  db.prepare = (sql) => { if (/FROM integrantes_cuerpo/i.test(sql)) consultas++; return original(sql); };
  try {
    for (let i = 0; i < 20; i++) avanceDe(actividad, db, admin, lasMarcas(), recuerdo);
  } finally {
    db.prepare = original;
  }
  assert.ok(consultas <= 2, `se recorrieron los integrantes ${consultas} veces, no una por cuerpo`);
});

test('sin recuerdo compartido cada llamada vuelve a buscar: no se guarda de más', () => {
  // Lo contrario del anterior: el recuerdo dura lo que dura una respuesta, y
  // sin él no queda nada guardado que pueda quedar viejo.
  let consultas = 0;
  const original = db.prepare.bind(db);
  db.prepare = (sql) => { if (/FROM integrantes_cuerpo/i.test(sql)) consultas++; return original(sql); };
  try {
    avanceDe(actividad, db, admin, lasMarcas());
    avanceDe(actividad, db, admin, lasMarcas());
  } finally {
    db.prepare = original;
  }
  assert.ok(consultas >= 2, 'quedó algo guardado entre llamadas');
});
