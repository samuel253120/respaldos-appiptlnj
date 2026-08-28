/**
 * LA MISMA PERSONA, DOS VECES.
 *
 * El RUT es único, pero no obligatorio, y en una base traída de otro sistema
 * casi nadie lo trae. Sin RUT, dos fichas de la misma persona eran dos
 * personas distintas para el sistema.
 *
 * Medido antes del arreglo, sobre el sistema andando: se creó «Zzprueba
 * Duplicada Del Carmen» dos veces seguidas en la misma iglesia y las dos
 * entraron con un 201, sin una palabra. Quedaban 2 fichas.
 *
 * Lo que cuesta no es la fila de más: su asistencia queda partida en dos, se le
 * puede emitir dos veces el mismo certificado, y entra dos veces al cuerpo. Y
 * como buscar «María González» todavía no encuentra a María González, el paso
 * siguiente natural es justamente crearla de nuevo.
 *
 * No bloquea: PREGUNTA. Dos hermanas llamadas igual existen.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las repetidas', 'IG-DOSV', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La de al lado', 'IG-DOSV2', 'Activa')")
  .run().lastInsertRowid;

/** Mete una ficha derecho a la base, como si ya estuviera. */
function yaEstaba(nombres, apellidos, extra = {}) {
  return db
    .prepare(
      `INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, rut, fecha_nacimiento)
       VALUES (?, ?, ?, 'Activo', ?, ?)`
    )
    .run(nombres, apellidos, extra.iglesia || iglesia, extra.rut || null, extra.nace || null)
    .lastInsertRowid;
}

/** Lo que contesta el módulo al guardar. */
const guardar = (datos, opciones = {}) => miembros.hooks.beforeSave(datos, {
  id: opciones.id || null,
  existing: opciones.existing || null,
  db,
  confirmado: !!opciones.confirmado,
});

const nueva = (nombres, apellidos, extra = {}) => ({
  nombres, apellidos, iglesia_id: extra.iglesia || iglesia, estado: 'Activo', ...extra,
});

// ------------------------------- lo que pregunta ---------------------------

test('crear a alguien que ya está pregunta antes de guardar', () => {
  yaEstaba('Ludmila Rep', 'Quintanilla Bahamondes', { nace: '1990-05-03' });

  const problema = guardar(nueva('Ludmila Rep', 'Quintanilla Bahamondes'));
  assert.ok(problema, 'entraba sin decir nada: dos fichas de la misma señora');
  assert.equal(problema.confirmar, 'miembro_con_el_mismo_nombre',
    'tiene que ser una PREGUNTA y no un rechazo: dos hermanas llamadas igual existen');
  assert.match(problema.error, /Ya hay una ficha de Ludmila Rep Quintanilla Bahamondes/);
  assert.match(problema.error, /nacida el 03-05-1990/, 'dice con qué distinguirla de la que se está creando');
  assert.match(problema.error, /abra la que ya existe/, 'y qué hacer');
});

test('lo dice con el RUT cuando lo tiene, que es lo que de verdad distingue', () => {
  yaEstaba('Casimira Rep', 'Undurraga Lastra', { rut: '15.111.222-3' });
  assert.match(guardar(nueva('Casimira Rep', 'Undurraga Lastra')).error, /RUT 15\.111\.222-3/);
});

test('y avisa cuando ya hay más de una', () => {
  yaEstaba('Herminia Rep', 'Valdebenito Cifuentes');
  yaEstaba('Herminia Rep', 'Valdebenito Cifuentes');
  const problema = guardar(nueva('Herminia Rep', 'Valdebenito Cifuentes'));
  assert.match(problema.error, /Ya hay 2 fichas con ese mismo nombre/);
});

test('el segundo nombre se escribe unas veces sí y otras no: es la misma señora', () => {
  yaEstaba('Ninfa Rep Del Carmen', 'Ossandón Peralta');
  assert.ok(guardar(nueva('Ninfa Rep', 'Ossandón Peralta')),
    '«María José» y «María» son la misma persona: por eso se compara el PRIMER nombre');
});

test('mal escrito —sin tildes, en mayúsculas, con espacios de más— igual la encuentra', () => {
  yaEstaba('Begoña Rep', 'Zúñiga Iturriaga');
  for (const [nombres, apellidos] of [
    ['BEGOÑA REP', 'ZUÑIGA ITURRIAGA'],
    ['begoña rep', 'zuniga iturriaga'],
    ['  Begoña Rep  ', 'Zúñiga   Iturriaga'],
  ]) {
    assert.ok(guardar(nueva(nombres, apellidos)), `se le escapó «${nombres} ${apellidos}»`);
  }
});

// ------------------------------ lo que NO pregunta -------------------------

test('con otro apellido no pregunta: no es la misma persona ni de lejos', () => {
  /*
   * Medido sobre las 603 fichas cargadas: comparar solo el PRIMER apellido
   * daba 1.726 choques —«Luis Pérez Soto» contra «Luis Pérez González»— y
   * comparar los dos da 185. Nueve veces menos ruido.
   */
  yaEstaba('Melitón Rep', 'Carrasco Fuenzalida');
  assert.equal(guardar(nueva('Melitón Rep', 'Carrasco Villablanca')), null);
  assert.equal(guardar(nueva('Melitón Rep', 'Barrientos Fuenzalida')), null);
});

test('ni con el mismo nombre en otra iglesia', () => {
  yaEstaba('Ovidio Rep', 'Sanhueza Maldonado');
  assert.equal(guardar(nueva('Ovidio Rep', 'Sanhueza Maldonado', { iglesia: otraIglesia })), null,
    'cada iglesia lleva la suya, y de la otra no se ve nada');
});

test('ni cuando las dos traen RUT y son distintos: son dos personas distintas', () => {
  yaEstaba('Grimanesa Rep', 'Painecura Antileo', { rut: '16.222.333-4' });
  assert.equal(guardar(nueva('Grimanesa Rep', 'Painecura Antileo', { rut: '17.333.444-5' })), null);
});

test('pero si a una le falta el RUT sí pregunta, que es el caso que importa', () => {
  yaEstaba('Eleuteria Rep', 'Chandía Ormeño', { rut: '18.444.555-6' });
  assert.ok(guardar(nueva('Eleuteria Rep', 'Chandía Ormeño')),
    'sin RUT no hay nada que las distinga: es justo cuando se repiten');
});

test('ni pregunta si ya se respondió que sí', () => {
  yaEstaba('Fresia Rep', 'Millalonco Nahuel');
  assert.equal(guardar(nueva('Fresia Rep', 'Millalonco Nahuel'), { confirmado: true }), null,
    'confirmada, la ficha tiene que entrar');
});

test('ni a una ficha a medio llenar, sin nombre o sin iglesia', () => {
  yaEstaba('Aureliano Rep', 'Ñanco Curihuinca');
  assert.equal(guardar({ apellidos: 'Ñanco Curihuinca', iglesia_id: iglesia, estado: 'Activo' }), null);
  assert.equal(guardar({ nombres: 'Aureliano Rep', apellidos: 'Ñanco Curihuinca', estado: 'Activo' }), null,
    'sin iglesia no hay con qué comparar; el motor ya la exige por su cuenta');
});

// --------------------- editar una ficha que ya está no se tranca -----------

test('corregirle el teléfono a quien tiene homónima NO se tranca', () => {
  /*
   * Es el error que este módulo ya cometió una vez con las reglas del trato
   * pastoral: la ficha no se dejaba guardar más, ni para corregirle el
   * teléfono, por algo que quien venía a arreglar otra cosa no hizo.
   */
  const yo = yaEstaba('Rigoberto Rep', 'Huenchullán Marilaf');
  yaEstaba('Rigoberto Rep', 'Huenchullán Marilaf');
  const antes = db.prepare('SELECT * FROM miembros WHERE id = ?').get(yo);

  assert.equal(guardar({ telefono: '+56911112222' }, { id: yo, existing: antes }), null);
  assert.equal(guardar({ notas: 'algo' }, { id: yo, existing: antes }), null);
});

test('pero renombrarla ENCIMA de otra sí pregunta', () => {
  const otra = yaEstaba('Wenceslao Rep', 'Loncomilla Antivil');
  yaEstaba('Wenceslao Rep', 'Cayupán Nawelpán');
  const antes = db.prepare('SELECT * FROM miembros WHERE id = ?').get(otra);

  const problema = guardar({ apellidos: 'Cayupán Nawelpán' }, { id: otra, existing: antes });
  assert.ok(problema, 'cambiarle el nombre a uno que ya existe es la misma repetición');
  assert.equal(problema.confirmar, 'miembro_con_el_mismo_nombre');
});

test('y mudarla a la iglesia donde ya hay alguien así, también', () => {
  const quien = yaEstaba('Bartolomé Rep', 'Curiqueo Llanquileo', { iglesia: otraIglesia });
  yaEstaba('Bartolomé Rep', 'Curiqueo Llanquileo', { iglesia });
  const antes = db.prepare('SELECT * FROM miembros WHERE id = ?').get(quien);

  assert.ok(guardar({ iglesia_id: iglesia }, { id: quien, existing: antes }));
});

test('una ficha no choca consigo misma al agregarle un segundo nombre', () => {
  /*
   * Este es el caso en que la ficha SE VE a sí misma: agregarle el segundo
   * nombre cambia `nombres` —así que la revisión corre— pero el primer nombre
   * y los apellidos siguen siendo los suyos, que es justo con lo que se
   * compara. Sin sacarse de la búsqueda, corregirse el propio nombre avisaba
   * de que uno ya existe.
   */
  const yo = yaEstaba('Sinforosa', 'Trafipán Cañumir');
  const antes = db.prepare('SELECT * FROM miembros WHERE id = ?').get(yo);

  assert.equal(guardar({ nombres: 'Sinforosa Rep Del Tránsito' }, { id: yo, existing: antes }), null);
});

// ------------------------- por planilla, la fila queda marcada -------------

test('al importar una planilla no pregunta: marca la fila y sigue', () => {
  /*
   * En una planilla de quinientas filas no hay a quién preguntarle quinientas
   * veces, así que el importador convierte la pregunta en una marca de la fila
   * y quien importa la revisa en la vista previa. Es como el sistema resuelve
   * TODAS las preguntas por planilla, no una excepción de acá (ver
   * server/importar.js).
   *
   * Comprobado contra el servidor andando, con tres filas de las cuales una
   * estaba repetida: la vista previa dijo «2 de 3», la importación de verdad
   * metió las dos buenas y la importación NO se cayó. Lo que se cuida acá es
   * que la pregunta siga siendo un objeto con `error` —que es lo que el
   * importador sabe convertir en marca— y no algo que reviente la planilla
   * entera.
   */
  yaEstaba('Nicasia Rep', 'Antipán Colipán');
  const problema = guardar(nueva('Nicasia Rep', 'Antipán Colipán'));

  assert.equal(typeof problema.error, 'string',
    'el importador lee `.error` de lo que devuelve el gancho: sin texto, la fila se marca en blanco');
  assert.ok(problema.error.length > 40, 'y el texto tiene que decir de qué se trata');
  assert.doesNotThrow(() => guardar(nueva('Nicasia Rep', 'Antipán Colipán')),
    'lanzando en vez de devolver, el motor lo tomaría por una avería y contestaría un 500');
});

// ------------------------------ dónde está puesto --------------------------

test('la pantalla sabe qué cara ponerle a la pregunta', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /miembro_con_el_mismo_nombre: \{/,
    'sin su entrada, la pregunta sale con el encabezado de reserva y no dice de qué se trata');
  assert.match(app, /Es otra persona, crear la ficha/, 'el botón dice lo que va a pasar');
});

test('el gancho recibe si ya se confirmó', () => {
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/miembros.js'), 'utf8'
  );
  assert.match(fuente, /beforeSave\(data, \{ id, existing, db, confirmado \}\)/,
    'sin `confirmado` no hay manera de decir que sí, y la pregunta se vuelve un muro');
});
