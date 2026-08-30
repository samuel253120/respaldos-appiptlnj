/**
 * LA MISMA AYUDA ANOTADA DOS VECES LE INFLA EL HISTORIAL A UNA PERSONA.
 *
 * Se mandó dos veces exactamente la misma ayuda —la misma persona, el mismo
 * tipo, la misma fecha, el mismo monto y la misma descripción—. Medido antes de
 * esto:
 *
 *   la segunda vez .............  201, sin decir nada
 *   su historial pasó de .......  3 ayudas a 4
 *   y lo entregado, de .........  $123.000 a $168.000
 *
 * Pasa solo: dos personas atienden el mismo mostrador, o alguien vuelve a
 * registrar la entrega porque no la encontró. Y el daño va más allá de la
 * cifra: la insignia de la ficha —«3 entregas · la última el 01-08-2026»— es lo
 * que se mira antes de decidir si se le entrega otra vez, y con una entrega
 * repetida dice que ya recibió más de lo que recibió.
 *
 * ── QUÉ HACE QUE DOS SEAN «LA MISMA» ──
 *
 * La misma persona, el mismo tipo y el mismo día. Ni el monto ni la descripción
 * entran: los dos casos que se quieren atrapar casi nunca los traen tecleados
 * igual, y exigir que coincidan dejaría pasar justo lo que se busca.
 *
 * La fecha SÍ entra, al revés que en las carpetas de documentos, y por una
 * razón concreta: allá el mismo papel se vuelve a escanear semanas después;
 * acá una ayuda ES un hecho de un día, y la misma canasta al mes siguiente es
 * una entrega nueva que nadie tiene por qué confirmar.
 *
 * Lo que cuida este archivo:
 *   · que la segunda igual pregunte, con las señas de la que ya estaba
 *   · que se pueda seguir confirmando
 *   · que otro tipo, otro día u otra persona NO pregunten
 *   · que el monto y la descripción distintos no salven a la repetida
 *   · que corregir una guardada sin tocar lo que la hace «la misma» no vuelva
 *     a preguntar
 *   · y que esta pregunta vaya antes que la de los datos que faltan
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

require('../../server/ajustes');
const { db } = require('../../server/db');
const AYUDAS = require('../../server/modules/ayudas_sociales');
const puente = require('../../server/ayuda-tesoreria');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del repetido','IG-REP1','Activa')")
  .run().lastInsertRowid;
const ROSA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Rosa','Del Mostrador')")
  .run().lastInsertRowid;
const OTRA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Otra','Persona Distinta')")
  .run().lastInsertRowid;
/*
 * Un miembro y un no miembro CON EL MISMO NÚMERO, a propósito.
 *
 * Cada uno cuelga de su propia columna, y una prueba con números distintos no
 * distingue «miró la columna que corresponde» de «no encontró nada». Se vio al
 * romper a propósito la elección de columna y ver que no se caía nada. Con el
 * mismo número, mirar la columna equivocada encuentra la ayuda de la otra
 * persona y la prueba se pone roja, que es lo que tiene que pasar.
 *
 * El número va escrito y es alto: estas pruebas comparten la base con las
 * demás, que usan los que da la tabla —chicos y correlativos—, así que uno de
 * seis cifras no se le pisa a nadie.
 */
const MISMO_NUMERO = 930101;
const SOCIO = db
  .prepare("INSERT INTO miembros (id, nombres, apellidos, iglesia_id, estado) VALUES (?,'Juan','Inscrito',?,'Activo')")
  .run(MISMO_NUMERO, IGLESIA).lastInsertRowid;
const GEMELA = db
  .prepare("INSERT INTO no_miembros (id, nombres, apellidos) VALUES (?,'Gemela','Del Mismo Número')")
  .run(MISMO_NUMERO).lastInsertRowid;

const ADMIN = { id: 9301, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

/** Una ayuda completa, para que la única pregunta posible sea la del repetido. */
const UNA = (mas = {}) => ({
  fecha: '2026-07-14', iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro', no_miembro_id: ROSA,
  tipo_ayuda: 'Alimentos', valor_estimado: 45000, estado: 'Entregada',
  aprobada_por: 'Pastora Ruiz', soporte: 'boleta.pdf', salida: puente.EN_ESPECIE, ...mas,
});

const guardar = (datos, existing, confirmado) =>
  AYUDAS.hooks.beforeSave({ ...datos }, { user: ADMIN, isNew: !existing, existing, db, confirmado });

/** La deja anotada de verdad, como quedaría después de guardarla. */
function anotada(mas = {}) {
  const data = UNA(mas);
  const error = guardar(data, null, true);
  assert.equal(error, null, `no se pudo anotar: ${error && (error.error || error)}`);
  const campos = Object.keys(data).filter((c) => data[c] !== undefined);
  const id = db
    .prepare(
      `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
  return db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id);
}

/* ------------------------------- la pregunta */

test('la segunda ayuda igual pregunta, con las señas de la que ya estaba', () => {
  anotada();
  const r = guardar(UNA());
  assert.equal(r.confirmar, 'ayuda_ya_registrada');
  assert.match(r.error, /Ya hay una ayuda de Alimentos para Rosa Del Mostrador/);
  assert.match(r.error, /14-07-2026/, 'dice de qué día es la que ya estaba');
  assert.match(r.error, /entregada/, 'y en qué estado quedó');
  assert.match(r.error, /\$ 45\.000/, 'y por cuánto');
  assert.match(r.error, /recibió más de lo que recibió/, 'y por qué importa');
  assert.match(r.error, /confirme/, 'se pregunta, no se bloquea');
});

test('y confirmando, se anota igual: dos entregas iguales el mismo día existen', () => {
  anotada({ fecha: '2026-07-15' });
  assert.equal(guardar(UNA({ fecha: '2026-07-15' }), null, true), null);
});

/* ------------------------------- lo que no es «la misma» */

test('otro día no pregunta: la misma canasta al mes siguiente es una entrega nueva', () => {
  anotada({ fecha: '2026-07-16' });
  assert.equal(guardar(UNA({ fecha: '2026-08-16' })), null);
});

test('otro tipo de ayuda tampoco', () => {
  anotada({ fecha: '2026-07-17' });
  assert.equal(guardar(UNA({ fecha: '2026-07-17', tipo_ayuda: 'Ropa' })), null);
});

test('ni otra persona, aunque sea el mismo día y el mismo tipo', () => {
  anotada({ fecha: '2026-07-18' });
  assert.equal(guardar(UNA({ fecha: '2026-07-18', no_miembro_id: OTRA })), null);
});

test('y un miembro y un no miembro con el mismo número no se confunden', () => {
  /*
   * Sin mirar la columna que corresponde, el 930101 de miembros y el 930101 de
   * no miembros serían la misma persona, y la ayuda de una haría preguntar por
   * la de la otra.
   */
  assert.equal(SOCIO, GEMELA, 'las dos fichas llevan el mismo número, que es de lo que se trata');
  anotada({ fecha: '2026-07-19', no_miembro_id: GEMELA });
  assert.equal(
    guardar(UNA({ fecha: '2026-07-19', beneficiario_tipo: 'Miembro', miembro_id: SOCIO, no_miembro_id: null })),
    null
  );

  // Y al revés: la del miembro tampoco hace preguntar por la de la gemela
  anotada({ fecha: '2026-07-28', beneficiario_tipo: 'Miembro', miembro_id: SOCIO, no_miembro_id: null });
  assert.equal(guardar(UNA({ fecha: '2026-07-28', no_miembro_id: GEMELA })), null);
});

/* ------------------------------- lo que no la salva */

test('un monto distinto no la salva: nadie teclea dos veces lo mismo igual', () => {
  anotada({ fecha: '2026-07-20' });
  const r = guardar(UNA({ fecha: '2026-07-20', valor_estimado: 46000, descripcion: 'una caja' }));
  assert.equal(r.confirmar, 'ayuda_ya_registrada');
});

test('ni el tipo escrito con otras mayúsculas o sin tilde', () => {
  anotada({ fecha: '2026-07-21', tipo_ayuda: 'Medicamentos / Salud' });
  const r = guardar(UNA({ fecha: '2026-07-21', tipo_ayuda: 'MEDICAMENTOS / SALUD' }));
  assert.equal(r.confirmar, 'ayuda_ya_registrada');
});

/* ------------------------------- una sola vez */

test('corregirle la descripción a una guardada no vuelve a preguntar', () => {
  /*
   * La repetida ya estaba antes de abrir la ficha y alguien ya dijo que eran
   * dos: volver a preguntarlo cada vez que se le arregla una coma es ruido, y
   * el ruido enseña a confirmar sin leer.
   */
  anotada({ fecha: '2026-07-22' });
  const segunda = anotada({ fecha: '2026-07-22', descripcion: 'la segunda, confirmada' });
  assert.equal(guardar({ descripcion: 'con una coma más' }, segunda), null);
});

test('pero cambiarle la fecha a la de otra sí pregunta', () => {
  anotada({ fecha: '2026-07-23' });
  const enOtroDia = anotada({ fecha: '2026-07-24' });
  const r = guardar({ fecha: '2026-07-23' }, enOtroDia);
  assert.equal(r.confirmar, 'ayuda_ya_registrada');
});

test('y una ayuda no se avisa a sí misma como repetida', () => {
  const suya = anotada({ fecha: '2026-07-25' });
  assert.equal(guardar({ tipo_ayuda: 'Ropa' }, suya), null);
  assert.equal(guardar({ fecha: '2026-07-25', tipo_ayuda: 'Alimentos' }, suya), null,
    'ni volviendo a poner lo que ya tenía');
});

/* ------------------------------- el orden de las dos preguntas */

test('la repetida se pregunta antes que los datos que faltan', () => {
  /*
   * La confirmación es una sola para todo el guardado, así que la que se
   * muestra tiene que ser la que más importa. Una ayuda repetida dice algo
   * FALSO del historial de una persona; una a la que le falta el monto dice
   * algo INCOMPLETO. Es el mismo criterio con que Tesorería pone primero el
   * movimiento repetido.
   */
  anotada({ fecha: '2026-07-26' });
  const r = guardar(UNA({
    fecha: '2026-07-26', valor_estimado: null, aprobada_por: null, soporte: null,
  }));
  assert.equal(r.confirmar, 'ayuda_ya_registrada', 'primero la repetida');

  // Y confirmando esa, la de los datos que faltan ya no se muestra: quien
  // confirma manda, y el motor manda `igual_asi` para todo el guardado
  assert.equal(guardar(UNA({
    fecha: '2026-07-26', valor_estimado: null, aprobada_por: null, soporte: null,
  }), null, true), null);
});

test('sin repetida, se pregunta lo que falta, como siempre', () => {
  const r = guardar(UNA({
    fecha: '2026-07-27', valor_estimado: null, aprobada_por: null, soporte: null,
  }));
  assert.equal(r.confirmar, 'ayuda_entregada_sin_datos');
});
