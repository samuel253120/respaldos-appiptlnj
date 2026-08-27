/**
 * LAS ACTIVIDADES QUE SE REPITEN.
 *
 * El servicio del domingo, el estudio del miércoles y el ensayo del sábado son
 * los mismos todas las semanas, con los mismos cuerpos y a la misma hora. Se
 * creaban a mano, de a una: más de 150 al año para una iglesia con tres
 * reuniones semanales, cada una con su diálogo, su fecha y sus cuerpos marcados
 * de nuevo.
 *
 * Lo que cuida este archivo:
 *   · el cálculo de las fechas, incluidos los meses que se saltan
 *   · que cada fecha dé una actividad INDEPENDIENTE, no una «serie»
 *   · que repetir dos veces lo mismo no duplique el calendario
 *   · y que la cuenta que la pantalla muestra ANTES de guardar sea la misma que
 *     el servidor va a hacer: son dos cálculos, y separarse sería mentirle a
 *     quien está mirando
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const repeticion = require('../../server/asistencia-repeticion');
const { fechasQueSiguen, comoSeLee, REGLAS, TOPE } = repeticion;

// ------------------------------------------------------- cada cuánto cae ---

test('cada semana: el mismo día, sin la fecha de partida', () => {
  // 2026-03-15 es domingo
  assert.deepEqual(
    fechasQueSiguen('2026-03-15', 'semanal', '2026-04-12'),
    ['2026-03-22', '2026-03-29', '2026-04-05', '2026-04-12']
  );
});

test('la fecha de partida NO sale: esa actividad ya existe', () => {
  const salen = fechasQueSiguen('2026-03-15', 'semanal', '2026-12-31');
  assert.equal(salen.includes('2026-03-15'), false);
});

test('el último día cuenta: «hasta el 12» incluye el 12', () => {
  assert.equal(fechasQueSiguen('2026-03-15', 'semanal', '2026-04-12').pop(), '2026-04-12');
  assert.equal(fechasQueSiguen('2026-03-15', 'semanal', '2026-04-11').pop(), '2026-04-05');
});

test('cada dos semanas salta una', () => {
  assert.deepEqual(
    fechasQueSiguen('2026-03-15', 'quincenal', '2026-05-15'),
    ['2026-03-29', '2026-04-12', '2026-04-26', '2026-05-10']
  );
});

test('un año entero de reunión semanal son 52 fechas más', () => {
  const salen = fechasQueSiguen('2026-01-04', 'semanal', '2026-12-31');
  assert.equal(salen.length, 51);
  assert.equal(salen[0], '2026-01-11');
  assert.equal(salen[salen.length - 1], '2026-12-27');
});

test('cruzar el año no le hace nada al cálculo', () => {
  assert.deepEqual(
    fechasQueSiguen('2026-12-20', 'semanal', '2027-01-17'),
    ['2026-12-27', '2027-01-03', '2027-01-10', '2027-01-17']
  );
});

// ------------------------------------------------------- los meses ---

test('cada mes, el mismo día del mes', () => {
  assert.deepEqual(
    fechasQueSiguen('2026-03-12', 'mensual_dia', '2026-07-31'),
    ['2026-04-12', '2026-05-12', '2026-06-12', '2026-07-12']
  );
});

test('EL CASO: el 31 se salta los meses que no llegan, en vez de correrse', () => {
  /*
   * Quien pidió «el 31» no quiso decir «el 28 de febrero». Correrlo al día que
   * más se le parezca es inventarle una reunión a la iglesia en un día que
   * nadie eligió.
   */
  assert.deepEqual(
    fechasQueSiguen('2026-01-31', 'mensual_dia', '2026-06-30'),
    ['2026-03-31', '2026-05-31']
  );
});

test('desde el 29 de febrero, los febreros que no llegan al 29 se saltan', () => {
  const salen = fechasQueSiguen('2024-02-29', 'mensual_dia', '2028-12-31');
  const febreros = salen.filter((f) => f.slice(5, 7) === '02');
  // 2025, 2026 y 2027 no tienen 29 de febrero; 2028 sí
  assert.deepEqual(febreros, ['2028-02-29']);
  // y el 29 de los demás meses sale sin problema
  assert.ok(salen.includes('2024-03-29'));
  assert.ok(salen.includes('2025-01-29'));
});

test('cada mes, el mismo día de la semana: «el tercer domingo»', () => {
  assert.deepEqual(
    fechasQueSiguen('2026-03-15', 'mensual_semana', '2026-08-31'),
    ['2026-04-19', '2026-05-17', '2026-06-21', '2026-07-19', '2026-08-16']
  );
});

test('«el primer sábado de cada mes» cae siempre en sábado', () => {
  const salen = fechasQueSiguen('2026-03-07', 'mensual_semana', '2026-12-31');
  assert.ok(salen.length >= 9);
  for (const f of salen) {
    const [y, m, d] = f.split('-').map(Number);
    assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 6, `${f} no es sábado`);
    assert.ok(d <= 7, `${f} no es el PRIMER sábado`);
  }
});

test('un mes sin quinto domingo se salta, no se corre al primero del siguiente', () => {
  // 2026-03-29 es el quinto domingo de marzo
  const salen = fechasQueSiguen('2026-03-29', 'mensual_semana', '2026-12-31');
  for (const f of salen) {
    const d = Number(f.split('-')[2]);
    assert.ok(d >= 29, `${f} no es un quinto domingo`);
  }
  assert.equal(salen.includes('2026-04-05'), false, 'se corrió al primer domingo de abril');
});

// ------------------------------------------------- lo que no se acepta ---

test('una fecha de término anterior o igual no repite nada', () => {
  assert.deepEqual(fechasQueSiguen('2026-03-15', 'semanal', '2026-03-15'), []);
  assert.deepEqual(fechasQueSiguen('2026-03-15', 'semanal', '2026-03-01'), []);
});

test('una regla que no existe no inventa fechas', () => {
  assert.deepEqual(fechasQueSiguen('2026-03-15', 'cada rato', '2026-12-31'), []);
  assert.deepEqual(fechasQueSiguen('2026-03-15', '', '2026-12-31'), []);
});

test('una fecha mal escrita no revienta ni devuelve basura', () => {
  assert.deepEqual(fechasQueSiguen('el domingo', 'semanal', '2026-12-31'), []);
  assert.deepEqual(fechasQueSiguen('2026-03-15', 'semanal', 'fin de año'), []);
  assert.deepEqual(fechasQueSiguen(null, 'semanal', '2026-12-31'), []);
});

test('hay un tope: un año mal escrito no llena el calendario de mil', () => {
  const salen = fechasQueSiguen('2026-03-15', 'semanal', '2926-12-31');
  assert.equal(salen.length, TOPE);
  assert.equal(TOPE, 200);
});

// ------------------------------------------------------- cómo se dice ---

test('la repetición se dice como la diría una persona', () => {
  assert.equal(comoSeLee('2026-03-15', 'semanal'), 'todos los domingos');
  assert.equal(comoSeLee('2026-03-18', 'semanal'), 'todos los miércoles');
  assert.equal(comoSeLee('2026-03-21', 'semanal'), 'todos los sábados');
  assert.equal(comoSeLee('2026-03-15', 'quincenal'), 'un domingo por medio');
  assert.equal(comoSeLee('2026-03-07', 'mensual_semana'), 'el primer sábado de cada mes');
  assert.equal(comoSeLee('2026-03-15', 'mensual_semana'), 'el tercer domingo de cada mes');
  assert.equal(comoSeLee('2026-01-31', 'mensual_dia'), 'el 31 de cada mes');
});

test('solo domingo y sábado llevan la «s»: los demás días ya vienen en plural', () => {
  for (const [fecha, dice] of [
    ['2026-03-16', 'todos los lunes'], ['2026-03-17', 'todos los martes'],
    ['2026-03-19', 'todos los jueves'], ['2026-03-20', 'todos los viernes'],
  ]) assert.equal(comoSeLee(fecha, 'semanal'), dice);
});

// --------------------- la pantalla cuenta lo mismo que el servidor ---

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/** `cuantasVecesSeRepite` de app.js, sacada del propio archivo y puesta a andar. */
const cuantasEnPantalla = (() => {
  const desde = app.indexOf('function cuantasVecesSeRepite(desde, regla, hasta) {');
  assert.ok(desde > 0, 'app.js tiene que traer cuantasVecesSeRepite');
  const hasta = app.indexOf('\n}', desde) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${app.slice(desde, hasta)}; return cuantasVecesSeRepite;`)();
})();

test('EL RIESGO: la cuenta que se muestra antes de guardar es la que se va a crear', () => {
  /*
   * Son dos cálculos —uno en el servidor y otro en la pantalla, para poder
   * avisar sin ir y volver—, y separarse sería mentirle a quien está mirando:
   * «se crearán 42» y después aparecen 40. Se recorren cuatro años de fechas
   * de partida contra las cuatro reglas.
   */
  let comparadas = 0;
  for (const regla of REGLAS.map((r) => r.valor)) {
    for (let dia = 0; dia < 400; dia += 3) {
      const desde = new Date(Date.UTC(2026, 0, 1) + dia * 86400000).toISOString().slice(0, 10);
      for (const hasta of ['2026-06-30', '2027-01-15', '2028-02-29', '2029-12-31']) {
        const servidor = fechasQueSiguen(desde, regla, hasta).length;
        const pantalla = cuantasEnPantalla(desde, regla, hasta);
        assert.equal(pantalla, servidor,
          `${regla} del ${desde} al ${hasta}: la pantalla dice ${pantalla} y el servidor crea ${servidor}`);
        comparadas++;
      }
    }
  }
  assert.ok(comparadas > 2000, `solo se compararon ${comparadas} combinaciones`);
});

test('y la pantalla tampoco inventa nada con una regla que no existe', () => {
  assert.equal(cuantasEnPantalla('2026-03-15', 'cada rato', '2026-12-31'), 0);
  assert.equal(cuantasEnPantalla('2026-03-15', 'semanal', '2026-03-01'), 0);
});

// ----------------------------------------------------------- la ruta ---

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la repetición', 'IG-RE', 'Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const usuario = db
  .prepare("INSERT INTO usuarios (rut, nombre, rol, iglesia_id, activo) VALUES ('21000009-7', 'Rosa Pinto Vidal', 'admin', ?, 1)")
  .run(iglesia).lastInsertRowid;
const YO = { id: usuario, rol: 'admin', iglesias: [iglesia], cuerpos: [], nombre: 'Rosa Pinto Vidal' };
const AJENA = { id: usuario, rol: 'consulta', iglesias: [99], cuerpos: [], nombre: 'De otra iglesia' };

const unaActividad = (fecha, extra = {}) => db
  .prepare(
    `INSERT INTO asistencias (fecha, hora_inicio, tipo_reunion, nombre, cuerpos, lugar, observaciones, iglesia_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fecha, extra.hora || '19:30', extra.tipo || 'Culto', extra.nombre || null,
    JSON.stringify([cuerpo]), extra.lugar || 'Templo', extra.obs || null, iglesia
  ).lastInsertRowid;

function repetir(id, usuarioQuePide, cuerpo0) {
  let atender = null;
  asistencias.extraRoutes(
    { get() {}, post(ruta, permiso, mano) { if (ruta.includes('repetir')) atender = mano; } },
    { db, requirePerm: () => (req, res, next) => next(), can: () => true }
  );
  assert.ok(atender, 'la ruta de repetir tiene que estar registrada');
  let salida = null; let estado = 200;
  atender(
    { user: usuarioQuePide, params: { id: String(id) }, query: {}, body: cuerpo0 || {} },
    { json: (d) => { salida = d; }, status(c) { estado = c; return this; } }
  );
  return { estado, ...salida };
}

const lasDe = (desde, hasta) => db
  .prepare('SELECT * FROM asistencias WHERE iglesia_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha')
  .all(iglesia, desde, hasta);

test('repetir crea las actividades que faltan', () => {
  const id = unaActividad('2026-03-01');   // domingo
  const r = repetir(id, YO, { regla: 'semanal', hasta: '2026-03-29' });
  assert.equal(r.estado, 200);
  assert.equal(r.creadas, 4);
  assert.deepEqual(
    lasDe('2026-03-01', '2026-03-29').map((a) => a.fecha),
    ['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29']
  );
});

test('y cada copia lleva lo mismo que la original', () => {
  const copia = lasDe('2026-03-08', '2026-03-08')[0];
  assert.equal(copia.tipo_reunion, 'Culto');
  assert.equal(copia.hora_inicio, '19:30');
  assert.equal(copia.lugar, 'Templo');
  assert.equal(copia.iglesia_id, iglesia);
  assert.deepEqual(JSON.parse(copia.cuerpos), [cuerpo]);
  assert.equal(copia.created_by, usuario);
});

test('cada una es INDEPENDIENTE: se edita y se borra sola', () => {
  const una = lasDe('2026-03-15', '2026-03-15')[0];
  db.prepare("UPDATE asistencias SET lugar = 'Casa de retiro' WHERE id = ?").run(una.id);
  db.prepare('DELETE FROM asistencias WHERE id = ?').run(lasDe('2026-03-22', '2026-03-22')[0].id);

  const quedan = lasDe('2026-03-01', '2026-03-29');
  assert.equal(quedan.length, 4, 'borrar una se llevó a las demás');
  assert.equal(quedan.find((a) => a.fecha === '2026-03-15').lugar, 'Casa de retiro');
  assert.equal(quedan.find((a) => a.fecha === '2026-03-08').lugar, 'Templo', 'el cambio de una tocó a otra');
});

test('repetir lo mismo otra vez no duplica: solo repone la que falta', () => {
  const id = lasDe('2026-03-01', '2026-03-01')[0].id;
  const r = repetir(id, YO, { regla: 'semanal', hasta: '2026-03-29' });
  assert.equal(r.creadas, 1, 'solo la que se había borrado');
  assert.equal(r.ya_estaban, 3);
  assert.equal(lasDe('2026-03-01', '2026-03-29').length, 5);
});

test('una actividad DISTINTA el mismo día sí se crea: no son la misma', () => {
  const otroTipo = unaActividad('2026-04-05', { tipo: 'Ensayo' });
  db.prepare("INSERT INTO asistencias (fecha, tipo_reunion, cuerpos, iglesia_id) VALUES ('2026-04-12', 'Culto', ?, ?)")
    .run(JSON.stringify([cuerpo]), iglesia);
  const r = repetir(otroTipo, YO, { regla: 'semanal', hasta: '2026-04-12' });
  assert.equal(r.creadas, 1, 'el «Culto» del 12 no es el «Ensayo» que se está repitiendo');
});

test('deja UNA línea en el Registro de Cambios, no cuarenta', () => {
  const id = unaActividad('2026-06-07');
  const r = repetir(id, YO, { regla: 'semanal', hasta: '2026-08-30' });
  // Solo las de ESTA actividad: las pruebas del motor comparten base y corren
  // en paralelo, así que contar todas dependería de quién más esté escribiendo
  const lineas = db
    .prepare("SELECT * FROM registro_cambios WHERE accion = 'Repetición' AND registro_id = ?").all(id);
  assert.equal(lineas.length, 1, `${r.creadas} actividades dejaron ${lineas.length} líneas`);
  assert.equal(lineas[0].usuario, 'Rosa Pinto Vidal');
  assert.match(lineas[0].detalle, /Creó 12 actividad\(es\) más, todos los domingos, hasta el 2026-08-30/);
});

test('sin regla o sin fecha de término se dice qué falta', () => {
  const id = unaActividad('2026-09-06');
  assert.equal(repetir(id, YO, { hasta: '2026-12-31' }).estado, 400);
  assert.equal(repetir(id, YO, { regla: 'cada rato', hasta: '2026-12-31' }).estado, 400);
  assert.equal(repetir(id, YO, { regla: 'semanal' }).estado, 400);
  assert.equal(repetir(id, YO, { regla: 'semanal', hasta: 'fin de año' }).estado, 400);
});

test('una fecha de término anterior se rechaza en vez de crear cero y callar', () => {
  const id = unaActividad('2026-09-13');
  const r = repetir(id, YO, { regla: 'semanal', hasta: '2026-09-01' });
  assert.equal(r.estado, 400);
  assert.match(r.error, /posterior/);
});

test('una actividad de otra iglesia no se puede repetir', () => {
  const id = unaActividad('2026-10-04');
  const antes = lasDe('2026-10-04', '2026-12-31').length;
  const r = repetir(id, AJENA, { regla: 'semanal', hasta: '2026-12-31' });
  assert.equal(r.estado, 403);
  assert.equal(lasDe('2026-10-04', '2026-12-31').length, antes, 'igual creó actividades');
});

test('una actividad que no existe se dice, no se inventa', () => {
  assert.equal(repetir(999999, YO, { regla: 'semanal', hasta: '2026-12-31' }).estado, 404);
});

test('las reglas se le piden al servidor, no están escritas en la pantalla', () => {
  // La misma lección de los tipos de actividad: la pantalla que se arma sola
  // con una lista escrita aparte se desactualiza sin que nada avise
  assert.match(app, /reglas_de_repeticion/);
  assert.equal(/'semanal'\s*,\s*label:/.test(app), false, 'las reglas quedaron escritas en app.js');
});
