/**
 * DE UNA SALIDA QUEDABA EL RESULTADO, NO ADÓNDE NI CUÁNDO.
 *
 * El estado decía «Trasladado» o «Fallecido» y ahí terminaba. No había dónde
 * anotar a qué iglesia se fue, ni desde cuándo, ni la fecha de fallecimiento.
 *
 * «Cuántos se trasladaron este año y a qué iglesias» es una pregunta de
 * informe anual, y había que reconstruirla leyendo bitácoras una por una.
 * Cuando la iglesia que recibe pide el traslado, tampoco había dónde anotar
 * que se mandó ni cuándo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la que se van', 'IG-SAL', 'Activa')")
  .run().lastInsertRowid;
const laQueRecibe = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La que recibe', 'IG-SAL2', 'Activa')")
  .run().lastInsertRowid;

let n = 0;
const alguien = () => {
  n++;
  return db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, fecha_nacimiento) VALUES (?, ?, ?, 'Activo', '1990-05-03')")
    .run(`Salida${n}`, `Delaiglesia${n}`, iglesia).lastInsertRowid;
};
const fila = (id) => db.prepare('SELECT * FROM miembros WHERE id = ?').get(id);
const guardar = (datos, opciones = {}) => miembros.hooks.beforeSave(datos, {
  id: opciones.id || null,
  existing: opciones.id ? fila(opciones.id) : null,
  db,
  confirmado: !!opciones.confirmado,
});
const campo = (nombre) => miembros.fields.find((f) => f.name === nombre);

// ------------------------- los campos, y cuándo salen ----------------------

test('la ficha tiene dónde anotar adónde se fue y desde cuándo', () => {
  for (const [nombre, cuando] of [
    ['fecha_salida', 'Trasladado'],
    ['iglesia_destino_id', 'Trasladado'],
    ['iglesia_destino', 'Trasladado'],
    ['fecha_fallecimiento', 'Fallecido'],
  ]) {
    const f = campo(nombre);
    assert.ok(f, `falta el campo ${nombre}`);
    assert.deepEqual(f.showIf, { field: 'estado', equals: cuando },
      `${nombre} tiene que aparecer solo con estado «${cuando}», como las fechas de matrimonio`);
  }
});

test('la iglesia de destino se puede elegir o escribir', () => {
  assert.equal(campo('iglesia_destino_id').type, 'ref');
  assert.equal(campo('iglesia_destino_id').ref, 'iglesias');
  assert.equal(campo('iglesia_destino').type, 'text');
});

test('las fechas de salida no pueden ser anteriores al nacimiento', () => {
  for (const nombre of ['fecha_salida', 'fecha_fallecimiento']) {
    assert.equal(campo(nombre).noAntesDe, 'fecha_nacimiento', `${nombre} admite salir antes de nacer`);
  }
});

test('ni venir del futuro: ninguna declara `futuro`', () => {
  for (const nombre of ['fecha_salida', 'fecha_fallecimiento']) {
    assert.ok(!campo(nombre).futuro, `${nombre} dejaría anotar una salida que todavía no ocurre`);
  }
});

// ------------------------- se pregunta adónde, una vez ---------------------

test('marcar un traslado sin decir adónde pregunta antes de guardar', () => {
  const quien = alguien();
  const problema = guardar({ estado: 'Trasladado' }, { id: quien });

  assert.ok(problema, 'el estado decía «Trasladado» y ahí terminaba');
  assert.equal(problema.confirmar, 'traslado_sin_destino', 'a veces de verdad no se sabe: se pregunta, no se bloquea');
  assert.match(problema.error, /único momento en que alguien lo sabe/);
});

test('con la iglesia elegida no pregunta nada', () => {
  const quien = alguien();
  assert.equal(guardar({ estado: 'Trasladado', iglesia_destino_id: laQueRecibe }, { id: quien }), null);
});

test('ni con el nombre escrito, para una iglesia de fuera de la organización', () => {
  const quien = alguien();
  assert.equal(guardar({ estado: 'Trasladado', iglesia_destino: 'Iglesia Bautista de Chillán' }, { id: quien }), null);
});

test('un nombre en blanco no cuenta como haberlo anotado', () => {
  const quien = alguien();
  assert.ok(guardar({ estado: 'Trasladado', iglesia_destino: '   ' }, { id: quien }));
});

test('confirmando, entra sin destino', () => {
  const quien = alguien();
  assert.equal(guardar({ estado: 'Trasladado' }, { id: quien, confirmado: true }), null);
});

test('y no vuelve a preguntar cada vez que se toca la ficha', () => {
  /*
   * Se pregunta cuando el estado CAMBIA a trasladado, no mientras lo esté: si
   * no, corregirle el teléfono a alguien que se fue hace un año volvería a
   * preguntar por un destino que ya se decidió no anotar.
   */
  const quien = alguien();
  db.prepare("UPDATE miembros SET estado = 'Trasladado' WHERE id = ?").run(quien);
  assert.equal(guardar({ telefono: '+56911112222' }, { id: quien }), null);
});

test('a un fallecimiento no se le pregunta por un destino', () => {
  const quien = alguien();
  assert.equal(guardar({ estado: 'Fallecido', fecha_fallecimiento: '2026-08-01' }, { id: quien }), null);
});

// ------------------------------ lo que no se permite -----------------------

test('la iglesia que recibe no puede ser la misma de la que se va', () => {
  const quien = alguien();
  const problema = guardar({ estado: 'Trasladado', iglesia_destino_id: iglesia }, { id: quien });
  assert.match(String(problema), /no puede ser la misma/);
});

test('elegida una de la organización, el nombre escrito se borra', () => {
  const quien = alguien();
  const datos = { estado: 'Trasladado', iglesia_destino_id: laQueRecibe, iglesia_destino: 'Lo que alguien escribió' };
  assert.equal(guardar(datos, { id: quien }), null);
  assert.equal(datos.iglesia_destino, null,
    'lo mismo guardado dos veces termina diciendo cosas distintas');
});

// ---------------------- lo escrito no se pierde al cambiar -----------------

test('si el estado cambia después, lo anotado NO se borra', () => {
  /*
   * Es la regla de esta ficha desde el principio, la misma de las fechas de
   * matrimonio: el dato queda guardado, solo deja de mostrarse. Y el historial
   * de la persona conserva cuándo pasó cada cosa.
   */
  const quien = alguien();
  guardar({ estado: 'Trasladado', iglesia_destino_id: laQueRecibe, fecha_salida: '2026-07-15' }, { id: quien });
  db.prepare("UPDATE miembros SET estado = 'Trasladado', iglesia_destino_id = ?, fecha_salida = '2026-07-15' WHERE id = ?")
    .run(laQueRecibe, quien);

  const datos = { estado: 'Activo' };
  assert.equal(guardar(datos, { id: quien }), null, 'volver atrás no puede quedar trancado');
  assert.equal(datos.fecha_salida, undefined, 'no lo toca');
  assert.equal(datos.iglesia_destino_id, undefined);
  assert.equal(fila(quien).fecha_salida, '2026-07-15', 'y lo que estaba escrito sigue ahí');
});

// -------------------- la pregunta del informe anual, contestable ----------

test('«quiénes se trasladaron, adónde y cuándo» se puede consultar', () => {
  db.prepare('DELETE FROM miembros WHERE iglesia_id = ?').run(iglesia);
  const uno = alguien();
  const otro = alguien();
  db.prepare("UPDATE miembros SET estado='Trasladado', fecha_salida='2026-03-01', iglesia_destino_id=? WHERE id=?")
    .run(laQueRecibe, uno);
  db.prepare("UPDATE miembros SET estado='Trasladado', fecha_salida='2026-06-10', iglesia_destino='Otra de fuera' WHERE id=?")
    .run(otro);

  const salidas = db
    .prepare(
      `SELECT fecha_salida, COALESCE(i.nombre, m.iglesia_destino) AS destino
         FROM miembros m LEFT JOIN iglesias i ON i.id = m.iglesia_destino_id
        WHERE m.estado = 'Trasladado' AND m.iglesia_id = ? ORDER BY fecha_salida`
    )
    .all(iglesia);

  assert.equal(salidas.length, 2, 'había que reconstruirlo leyendo bitácoras una por una');
  assert.deepEqual(salidas.map((s) => s.destino), ['La que recibe', 'Otra de fuera'],
    'la de la organización sale con su nombre y la de fuera con lo que se escribió');
  assert.deepEqual(salidas.map((s) => s.fecha_salida), ['2026-03-01', '2026-06-10']);
});

// ------------------------------ dónde está puesto --------------------------

test('la pantalla sabe qué cara ponerle a la pregunta', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /traslado_sin_destino: \{/,
    'sin su entrada, la pregunta sale con el encabezado de reserva y no dice de qué se trata');
  assert.match(app, /No se sabe, guardar igual/);
});
