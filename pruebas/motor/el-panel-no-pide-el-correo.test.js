/**
 * «Datos por completar» no pide el correo electrónico.
 *
 * Esa tarjeta del panel existe para una cosa: que alguien mire la lista, baje
 * la planilla y salga a pedir lo que falta. Vale mientras lo que nombra se
 * pueda conseguir preguntando.
 *
 * El correo no cumple eso en esta corporación. MEDIDO en la Iglesia Matriz:
 * de 179 fichas, 109 sin correo —el 61%—, y no porque nadie lo haya cargado,
 * sino porque buena parte de la membresía es gente mayor que no usa correo.
 * Encabezaba la tarjeta con la cifra más alta y empujaba hacia abajo el
 * teléfono (12) y el contacto de emergencia (87), que sí se consiguen
 * preguntando.
 *
 * Y la mitad que menos se ve: el correo contaba para «tienen todos estos datos
 * puestos», así que esas 109 fichas quedaban incompletas por lo único que no
 * se les va a poder llenar, y el avance en todo lo demás no se notaba nunca —
 * «46 de 179» no se movía aunque se completara media congregación.
 *
 * ── LAS DOS MITADES ──
 *
 * Sacar la línea de la lista es una; que las fichas sin correo pasen a contar
 * como completas es la otra, y es la que se olvida. Se comprueban las dos, con
 * fichas propias en una iglesia propia: estos archivos corren en paralelo
 * sobre UNA base, así que una cuenta global dependería de lo que hagan los
 * demás.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const pendientes = require('../../server/pendientes');
const { LO_QUE_IMPORTA } = pendientes;

/* ------------------------------------------------------------ el mundo */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Correo no se pide', 'IG-COR', 'Activa')")
  .run().lastInsertRowid;

/**
 * Una congregación vecina, con una ficha suya. No entra en ninguna cuenta de
 * acá: está para que el guardia del alcance, al final, tenga algo de más que
 * ver sin depender de lo que hagan los otros archivos del motor.
 */
const laVecina = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Correo, la vecina', 'IG-COV', 'Activa')")
  .run().lastInsertRowid;
db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Ajena', 'Correo', ?, 'Activo')")
  .run(laVecina);

/** Quien mira: acotada a esta iglesia, que es como la mira una secretaria. */
const suya = { rol: 'secretario', iglesia_id: iglesia, iglesias: [iglesia] };

/**
 * Una ficha con TODO lo que la lista pide puesto. El correo se decide aparte,
 * que es justamente lo que está en juego.
 */
function unaFichaCompleta(nombre, correo) {
  return db
    .prepare(
      `INSERT INTO miembros
         (nombres, apellidos, iglesia_id, telefono, fecha_nacimiento, direccion,
          genero, fecha_ingreso, emergencia_telefono, estado, tipo_miembro, email)
       VALUES (?, 'Correo', ?, '+56 9 1111 1111', '1950-03-04', 'Calle Una 123',
               'Femenino', '2001-05-06', '+56 9 2222 2222', 'Activo', 'Miembro Activo', ?)`
    )
    .run(nombre, iglesia, correo).lastInsertRowid;
}

// Tres hermanas mayores sin correo, con todo lo demás puesto, y una con correo.
unaFichaCompleta('Rosa', null);
unaFichaCompleta('Elena', '');
unaFichaCompleta('Marta', null);
unaFichaCompleta('Sofía', 'sofia@ejemplo.cl');

// ------------------------------------------- la lista ----------------------

test('el correo no es una línea de «Datos por completar»', () => {
  const r = pendientes.resumen(suya);

  assert.equal(
    r.faltas.find((f) => f.campo === 'email'),
    undefined,
    'tres de las cuatro fichas no tienen correo y aun así no debe salir la línea: ' +
      'un dato que la congregación no tiene por cómo es no es una tarea pendiente'
  );

  // La lista no se vació: lo que sí se pide preguntando sigue estando. Sin
  // esto, borrar LO_QUE_IMPORTA entera pasaría la prueba de arriba.
  const pide = LO_QUE_IMPORTA.map((d) => d.campo);
  for (const campo of ['telefono', 'emergencia_telefono', 'direccion']) {
    assert.ok(pide.includes(campo), `«${campo}» sí se consigue preguntando y tiene que seguir en la lista`);
  }
  assert.ok(!pide.includes('email'), 'la línea del correo no puede volver a la lista');
});

// ------------------------------- la mitad que se olvida --------------------

test('una ficha sin correo cuenta como completa', () => {
  const r = pendientes.resumen(suya);

  assert.equal(r.total, 4, 'el alcance tiene que estar acotado a esta iglesia');
  assert.equal(
    r.conTodo,
    4,
    'las cuatro tienen puesto todo lo que la lista pide; contando el correo eran 1 de 4, ' +
      'y ése es el número que decía «46 de 179» sin moverse nunca'
  );
});

test('lo que sí falta se sigue viendo, y el correo no lo tapa', () => {
  // A una se le quita el teléfono: eso sí se pide preguntando.
  db.prepare("UPDATE miembros SET telefono = '' WHERE nombres = 'Rosa' AND iglesia_id = ?").run(iglesia);

  const r = pendientes.resumen(suya);
  const tel = r.faltas.find((f) => f.campo === 'telefono');
  assert.ok(tel, 'sacar el correo no puede haber apagado el resto de la tarjeta');
  assert.equal(tel.cuantos, 1);
  assert.equal(r.conTodo, 3, 'la que se quedó sin teléfono deja de estar completa');
  assert.equal(r.faltas.find((f) => f.campo === 'email'), undefined);
});

// ------------------------- y que la pantalla no lo reponga -----------------

test('el alcance sigue acotando', () => {
  /*
   * Sin esto, un usuario mal armado devuelve el total del sistema y las cuentas
   * de arriba pasan a depender de lo que hagan los otros archivos del motor,
   * que corren en paralelo sobre la misma base. Ya pasó una vez, con la lista
   * de iglesias escrita como texto en vez de como lista.
   *
   * La ficha de la congregación vecina está justamente para esto: sin ella,
   * este archivo corriendo solo veía las mismas cuatro por las dos vías y el
   * guardia no comprobaba nada.
   */
  const suyas = pendientes.resumen(suya).total;
  const todas = pendientes.resumen({ rol: 'admin' }).total;
  assert.ok(todas > suyas, `el alcance no está acotando: acotado ${suyas}, de todas ${todas}`);
});
