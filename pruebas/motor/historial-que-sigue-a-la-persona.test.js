/**
 * EL HISTORIAL DE UNA PERSONA SE VE DONDE SE VE LA PERSONA.
 *
 * Cada anotación de la bitácora guarda a qué iglesia pertenece, y era esa
 * columna la que decidía quién podía leerla. Pero esa columna dice DÓNDE PASÓ
 * la cosa, no de quién es hoy la ficha.
 *
 * Medido sobre una miembro creada en la Iglesia Central y pasada a la Norte:
 * juntó 4 anotaciones y quedó con 6. La secretaria de su nueva iglesia abría su
 * ficha sin problema —200— y su pestaña de Historial le mostraba 2 de 6. Entre
 * las cuatro que no veía estaba el reconocimiento por veinte años de servicio en
 * el coro, que es justo para lo que un historial existe. La persona se mudaba y
 * su historia no se mudaba con ella: la veía entera quien ya no trabajaba con
 * ella, y partida quien sí.
 *
 * El mecanismo ya estaba y decía exactamente esto —«lo mío se ve donde se ve mi
 * ficha»—, pero solo se preguntaba en la parte de los cuerpos: la parte de las
 * iglesias seguía acotando por la columna propia. Ahora contesta entero.
 *
 * Lo que cuida este archivo:
 *   · que la historia siga a la persona cuando cambia de iglesia
 *   · que NO se abra de más: la de alguien de otra iglesia sigue sin verse
 *   · que la fila por fila diga lo mismo que el listado, o se vería en la lista
 *     algo que después no se deja abrir
 *   · que lo acotado por cuerpos siga acotado igual que antes
 *   · y que a los tres módulos que ya usaban el mecanismo no les cambie nada
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const alcance = require('../../server/alcance');
const registry = require('../../server/registry');

const BITACORA = registry.getModule('bitacora');

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;

const CENTRAL = unaIglesia('Central que la vio nacer', 'IG-HSP1');
const NORTE = unaIglesia('Norte que la recibe', 'IG-HSP2');
const SUR = unaIglesia('Sur que no tiene nada que ver', 'IG-HSP3');

const unMiembro = (nombres, apellidos, iglesia) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;

const anotar = (miembro, iglesia, tipo, texto) => db
  .prepare(
    `INSERT INTO bitacora (miembro_id, iglesia_id, fecha, tipo, descripcion, origen, registrado_por)
     VALUES (?,?, '2026-05-04', ?, ?, 'Manual', 'Quien Escribe')`
  ).run(miembro, iglesia, tipo, texto).lastInsertRowid;

/* ---- la miembro que se muda: su historia se escribió en la Central ---- */
const elba = unMiembro('Elba', 'Mella Soto', CENTRAL);
const suHistoria = [
  anotar(elba, CENTRAL, 'Anotación', 'Alta del miembro en el sistema.'),
  anotar(elba, CENTRAL, 'Cambio de datos', 'Teléfono: +56 9 3000 1000 → +56 9 3000 2000'),
  anotar(elba, CENTRAL, 'Cambio de datos', 'Dirección: (vacío) → Pasaje Uno 12'),
  anotar(elba, CENTRAL, 'Reconocimiento', 'Se le reconoce por veinte años de servicio en el coro.'),
];
// …y ahora su ficha pasa a la Norte, con dos anotaciones nuevas allá
db.prepare('UPDATE miembros SET iglesia_id = ? WHERE id = ?').run(NORTE, elba);
suHistoria.push(anotar(elba, NORTE, 'Cambio de datos', 'Iglesia: Central → Norte'));
suHistoria.push(anotar(elba, NORTE, 'Cambio de datos', 'Profesión u oficio: (vacío) → Profesora'));

/* ---- y una miembro de la Sur, que no le toca a nadie de la Norte ---- */
const ajena = unMiembro('Ajena', 'De La Sur', SUR);
const suyaAjena = anotar(ajena, SUR, 'Visita', 'Anotación de una iglesia que no es la suya.');

/** Las anotaciones de esta gente que ese usuario alcanza a leer. */
function loQueVe(usuario, miembros) {
  const params = [];
  const donde = alcance.condiciones(BITACORA, usuario, params);
  const marcas = miembros.map(() => '?').join(',');
  return db
    .prepare(`SELECT id FROM bitacora WHERE miembro_id IN (${marcas})${donde ? ` AND (${donde})` : ''}`)
    .all(...miembros, ...params)
    .map((r) => r.id);
}

const deLaNorte = { id: 91, iglesias: `[${NORTE}]`, iglesia_id: NORTE, cuerpos: '[]' };
const deLaCentral = { id: 92, iglesias: `[${CENTRAL}]`, iglesia_id: CENTRAL, cuerpos: '[]' };
const administrador = { id: 93, iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

/* ------------------------------- la historia sigue a la persona */

test('la secretaria de su nueva iglesia ve su historial entero', () => {
  const ve = loQueVe(deLaNorte, [elba]);
  assert.equal(ve.length, 6, 'antes veía 2 de 6: solo las escritas después del cambio');
  assert.deepEqual(ve.sort(), [...suHistoria].sort());
});

test('y ve la que más importa, que era la que se quedaba atrás', () => {
  const ve = new Set(loQueVe(deLaNorte, [elba]));
  const reconocimiento = db
    .prepare("SELECT id FROM bitacora WHERE miembro_id = ? AND tipo = 'Reconocimiento'").get(elba).id;
  assert.ok(ve.has(reconocimiento),
    'el reconocimiento por veinte años se escribió en la Central y es de ella, no de la Central');
});

test('la de su iglesia anterior deja de verla, que es lo correcto', () => {
  assert.deepEqual(loQueVe(deLaCentral, [elba]), [],
    'ya no trabaja con ella: antes le seguía viendo cuatro anotaciones');
});

test('el administrador sin iglesias asignadas sigue viéndolo todo', () => {
  assert.equal(loQueVe(administrador, [elba, ajena]).length, 7);
});

/* ------------------------------- y no se abre de más */

test('la historia de alguien de otra iglesia sigue sin verse', () => {
  assert.deepEqual(loQueVe(deLaNorte, [ajena]), [],
    'la regla acerca lo de su gente, no lo de todos');
});

test('fila por fila dice lo mismo que el listado', () => {
  // Si acá dijera otra cosa, se vería en la lista algo que después no se deja
  // abrir, o al revés. Se comprueba contra TODAS las filas de esta prueba.
  const todas = db
    .prepare('SELECT * FROM bitacora WHERE miembro_id IN (?, ?)').all(elba, ajena);
  const enElListado = new Set(loQueVe(deLaNorte, [elba, ajena]));
  for (const fila of todas) {
    assert.equal(alcance.alcanza(BITACORA, fila, deLaNorte), enElListado.has(fila.id),
      `la anotación ${fila.id} («${fila.tipo}») no dice lo mismo en la lista que al abrirla`);
  }
  assert.equal(enElListado.size, 6, 'y son seis, no cero: si fueran cero esto no probaría nada');
});

test('una anotación cuyo miembro ya no está no se alcanza', () => {
  assert.equal(alcance.alcanza(BITACORA, { id: -1, miembro_id: 999999, iglesia_id: NORTE }, deLaNorte), false);
  assert.equal(alcance.alcanza(BITACORA, { id: -1, miembro_id: null, iglesia_id: NORTE }, deLaNorte), false);
});

/* ------------------------------- lo acotado por cuerpos sigue igual */

test('a quien está acotado por cuerpos, la bitácora le sigue llegando por su gente', () => {
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES ('Damas que siguen', 'Dorcas', ?)")
    .run(NORTE).lastInsertRowid;
  const dentro = unMiembro('Dentro', 'Del Cuerpo', NORTE);
  const fuera = unMiembro('Fuera', 'Del Cuerpo', NORTE);
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, estado, fecha_ingreso, iglesia_id)
     VALUES (?, 'Miembro', ?, 'Activo', '2026-01-01', ?)`
  ).run(cuerpo, dentro, NORTE);
  const suya = anotar(dentro, NORTE, 'Visita', 'De alguien de su cuerpo.');
  anotar(fuera, NORTE, 'Visita', 'De alguien que no es de su cuerpo.');

  const conCuerpo = { id: 94, iglesias: `[${NORTE}]`, iglesia_id: NORTE, cuerpos: `[${cuerpo}]` };
  assert.deepEqual(loQueVe(conCuerpo, [dentro, fuera]), [suya],
    'la persona de su cuerpo sí, la otra no: eso no lo puede aflojar la regla nueva');
});

/* ------------------------------- cómo queda armada la consulta */

test('el módulo lo declara, y apunta a su miembro', () => {
  assert.deepEqual(BITACORA.alcance, { comoSuPadre: { modulo: 'miembros', campo: 'miembro_id' } });
});

test('la consulta se acota por el miembro y ya no por la columna de iglesia', () => {
  const params = [];
  const sql = alcance.condiciones(BITACORA, deLaNorte, params);
  assert.match(sql, /"miembro_id" IN \(SELECT id FROM "miembros" WHERE/);
  assert.doesNotMatch(sql, /^iglesia_id IN/,
    'la columna de iglesia se queda como dato de dónde pasó, no como la que decide quién lee');
  assert.deepEqual(params, [NORTE]);
});

test('la regla contesta entera aunque el usuario no tenga cuerpos asignados', () => {
  // Estaba escrita, pero solo se preguntaba dentro de la parte de los cuerpos:
  // un usuario acotado solo por iglesias —que es el caso corriente— nunca
  // llegaba a ella. Esto es lo que estaba mal.
  const params = [];
  const sql = alcance.condiciones(BITACORA, { id: 95, iglesias: `[${NORTE}]`, cuerpos: '[]' }, params);
  assert.match(sql, /SELECT id FROM "miembros"/);
});

/* ------------------------------- los tres que ya lo usaban */

test('a los módulos que cuelgan de una solicitud les queda la misma regla', () => {
  for (const nombre of ['historial_solicitudes', 'documentos_solicitudes', 'personas_solicitud']) {
    const params = [];
    const sql = alcance.condiciones(registry.getModule(nombre), deLaNorte, params);
    assert.match(sql, /"solicitud_id" IN \(SELECT id FROM "solicitudes" WHERE/, nombre);
    assert.deepEqual(params, [NORTE], nombre);
  }
});

test('y siguen viendo lo mismo, porque el hijo lleva la iglesia de su solicitud', () => {
  // Comprobado además contra el servidor: creados por la API, los tres nacen
  // con el iglesia_id de su solicitud. Acá se sostiene con datos.
  const quien = unMiembro('Nora', 'Solicitante', NORTE);
  const sol = db.prepare(
    `INSERT INTO solicitudes (fecha, iglesia_id, solicitante_tipo, miembro_id, tipo, asunto, estado)
     VALUES ('2026-04-01', ?, 'Miembro', ?, 'Certificado', 'Prueba de alcance', 'Pendiente')`
  ).run(NORTE, quien).lastInsertRowid;
  const paso = db.prepare(
    `INSERT INTO historial_solicitudes (solicitud_id, iglesia_id, fecha, tipo, descripcion, origen)
     VALUES (?, ?, '2026-04-01', 'Anotación', 'Se recibe la solicitud.', 'Automático')`
  ).run(sol, NORTE).lastInsertRowid;

  const suyo = (usuario) => {
    const params = [];
    const donde = alcance.condiciones(registry.getModule('historial_solicitudes'), usuario, params);
    return db
      .prepare(`SELECT id FROM historial_solicitudes WHERE solicitud_id = ?${donde ? ` AND (${donde})` : ''}`)
      .all(sol, ...params).map((r) => r.id);
  };
  assert.deepEqual(suyo(deLaNorte), [paso], 'la de su iglesia lo ve');
  assert.deepEqual(suyo(deLaCentral), [], 'la de otra, no');
});
