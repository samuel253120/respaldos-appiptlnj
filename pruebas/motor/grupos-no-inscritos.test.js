/**
 * En los GRUPOS también sirve gente que no está inscrita en la membresía.
 *
 * POR QUÉ IMPORTA. Un cuerpo de la iglesia es una entidad formal —reglamento,
 * deberes y derechos, y su directiva sale de sus integrantes— y se compone de
 * miembros inscritos. Un grupo no: en el equipo de aseo, en el de sonido o en
 * el apoyo social sirve gente que no está en el registro oficial, y hasta
 * ahora la única forma de anotarla era inscribirla como miembro, ensuciando el
 * registro y los conteos de la membresía.
 *
 * Lo que se cuida acá, en orden de gravedad:
 *
 *   · QUE NO SE CONFUNDAN LOS DOS REGISTROS. El miembro n.º 7 y el no miembro
 *     n.º 7 son dos personas distintas. Si en algún lado se sigue usando el
 *     número solo, una aparece por la otra: en una lista de asistencia, en el
 *     alcance de un usuario, en el cuerpo de oficiales. Por eso hay funciones
 *     que devuelven SOLO miembros y otras que devuelven a todos, y no se
 *     pueden intercambiar.
 *   · Que un CUERPO no admita gente de fuera, aunque el dato llegue armado a
 *     mano: es lo que lo distingue de un grupo.
 *   · Que quien se inscribe después se lleve su historial. Sin eso, cada
 *     inscripción deja dos fichas y el recorrido de la persona colgando de la
 *     que ya no se usa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const integrantes = require('../../server/integrantes');
const def = require('../../server/modules/integrantes_cuerpo');
const detalle = require('../../server/modules/asistencia_detalle');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los grupos', 'IG-GR', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La de al lado', 'IG-AL', 'Activa')")
  .run().lastInsertRowid;

const cuerpoFormal = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const grupo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Equipo de sonido', 'Grupo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

const unMiembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
  .run(nombres, apellidos, iglesia).lastInsertRowid;
const unNoMiembro = (nombres, apellidos, dondeVive = iglesia) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?, ?, ?)')
  .run(nombres, apellidos, dondeVive).lastInsertRowid;

/** Guarda una ficha de integrante pasando por su hook, como lo hace el motor. */
function guardar(datos, { id = null, existing = null } = {}) {
  const copia = { ...datos };
  const error = def.hooks.beforeSave(copia, { id, existing, db });
  if (error) return { error };
  const campos = Object.keys(copia).filter((c) => copia[c] !== undefined);
  const fila = db
    .prepare(
      `INSERT INTO integrantes_cuerpo (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => copia[c]));
  return { id: Number(fila.lastInsertRowid), datos: copia };
}

/* ── 1. Sumar a alguien no inscrito, y a un grupo nada más ─────────── */

const ana = unMiembro('Ana', 'Miembro');
const nelson = unNoMiembro('Nelson', 'Sinficha');

test('a un GRUPO se puede sumar a alguien que no está inscrito', () => {
  const r = guardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: nelson,
    estado: 'Activo', fecha_ingreso: '2026-03-01',
  });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.datos.persona, 'Nelson Sinficha', 'el nombre queda escrito en la ficha');
  assert.equal(r.datos.miembro_id, null, 'el enlace del otro registro queda suelto');
  assert.equal(Number(r.datos.iglesia_id), Number(iglesia));
});

test('a un CUERPO no, aunque el dato llegue armado a mano', () => {
  // La pantalla ya no ofrece la opción cuando el destino es un cuerpo, pero lo
  // que la pantalla no ofrece el servidor lo tiene que rechazar igual: un
  // cuerpo tiene reglamento y su directiva sale de sus propios integrantes.
  const r = guardar({
    cuerpo_id: cuerpoFormal, persona_tipo: 'No miembro', no_miembro_id: nelson,
    estado: 'Activo', fecha_ingreso: '2026-03-01',
  });
  assert.match(String(r.error), /es un cuerpo, no un grupo/);
});

test('ni a un grupo de otra iglesia: cada iglesia lleva a los suyos', () => {
  const ajena = unNoMiembro('Perla', 'Deotrolado', otraIglesia);
  const r = guardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: ajena,
    estado: 'Activo', fecha_ingreso: '2026-03-01',
  });
  /*
   * El aviso nombra las DOS iglesias desde la v1.394.0, cuando la regla pasó a
   * valer también para el miembro inscrito: decir «otra iglesia» a secas no
   * dejaba claro cuál era la de cada uno. Lo que esta prueba cuida es la regla,
   * así que se mira que las nombre, no la frase con que lo decía antes.
   */
  assert.match(String(r.error), /Cada iglesia lleva los suyos/);
  assert.match(String(r.error), /La de al lado/, 'la iglesia en que figura la persona');
  assert.match(String(r.error), /De los grupos/, 'y la del grupo al que se la quiere sumar');
});

test('nadie tiene dos fichas en el mismo grupo', () => {
  const r = guardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: nelson,
    estado: 'Activo', fecha_ingreso: '2026-04-01',
  });
  assert.match(String(r.error), /ya tiene su ficha/);
});

test('una persona que ya no está en el registro aparte no se puede sumar', () => {
  const r = guardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: 999999,
    estado: 'Activo', fecha_ingreso: '2026-03-01',
  });
  assert.match(String(r.error), /ya no está en el sistema/);
});

/* ── 2. LO QUE MÁS IMPORTA: los dos registros no se confunden ──────── */

test('idsDeIntegrantes devuelve SOLO miembros, nunca gente del otro registro', () => {
  /*
   * Es la comprobación que sostiene todo lo demás. Este número lo usan el
   * alcance de cada usuario, el cuerpo de oficiales y las directivas para
   * buscar en la tabla de miembros. Si acá se colara el n.º de un no miembro,
   * el sistema traería al MIEMBRO que tenga ese mismo número: otra persona.
   */
  guardar({
    cuerpo_id: grupo, persona_tipo: 'Miembro', miembro_id: ana,
    estado: 'Activo', fecha_ingreso: '2026-01-01',
  });
  const ids = integrantes.idsDeIntegrantes(db, grupo);
  assert.deepEqual(ids, [Number(ana)]);

  const todos = db.prepare('SELECT no_miembro_id FROM integrantes_cuerpo WHERE cuerpo_id = ? AND no_miembro_id IS NOT NULL').all(grupo);
  assert.equal(todos.length, 1, 'y el no inscrito sí está guardado en el grupo');
});

test('personasDelCuerpo trae a los dos, cada uno con la letra de su registro', () => {
  const gente = integrantes.personasDelCuerpo(db, grupo);
  const claves = gente.map((g) => g.clave).sort();
  assert.deepEqual(claves, [`m${ana}`, `n${nelson}`].sort());
  const suelto = gente.find((g) => g.persona_tipo === 'No miembro');
  assert.equal(suelto.nombres, 'Nelson');
  assert.equal(suelto.miembro_id, null);
});

test('el miembro n.º 7 y el no miembro n.º 7 no son la misma persona', () => {
  // Se fuerza el choque de números que el sistema tiene que saber distinguir
  const m = integrantes.clavePersona({ miembro_id: 7, no_miembro_id: null });
  const n = integrantes.clavePersona({ miembro_id: null, no_miembro_id: 7 });
  assert.notEqual(m, n);
  assert.deepEqual(integrantes.personaDeClave(m), { miembro_id: 7, no_miembro_id: null });
  assert.deepEqual(integrantes.personaDeClave(n), { miembro_id: null, no_miembro_id: 7 });
});

test('integrantesDe trae las fichas de los dos registros', () => {
  const fichas = integrantes.integrantesDe(db, grupo);
  assert.equal(fichas.length, 2);
  assert.deepEqual(
    fichas.map((f) => f.persona_tipo).sort(),
    ['Miembro', 'No miembro']
  );
  // El `id` sigue siendo el de la FICHA: con ese número se cobran las cuotas
  for (const f of fichas) {
    const existe = db.prepare('SELECT cuerpo_id FROM integrantes_cuerpo WHERE id = ?').get(f.id);
    assert.equal(Number(existe.cuerpo_id), Number(grupo));
  }
});

/* ── 3. La asistencia ──────────────────────────────────────────────── */

/*
 * A QUIÉN APUNTA UNA MARCA: a uno de los dos registros, nunca a los dos.
 *
 * Acá había dos pruebas que se lo preguntaban al gancho de guardado del módulo
 * de marcas —una le mandaba los dos lados puestos y comprobaba que soltara uno;
 * la otra, ninguno—. Desde la v1.381.0 ese gancho no existe: la marca se
 * escribe pasando lista, y ahí la persona no llega como dos campos sueltos sino
 * resuelta desde los integrantes convocados, así que no hay forma de armar una
 * que apunte a los dos ni a ninguno. La pregunta se hacía a una pieza que ya no
 * decide nada.
 *
 * Lo que este archivo cuida —que a quien no está inscrito se le pueda marcar
 * igual que a los demás, y que salga en la planilla del grupo— se sigue
 * comprobando abajo, y por la puerta de verdad. La marca de Nelson se pone con
 * la toma de lista, como la pone la iglesia.
 */
test('a quien no está inscrito se le marca por la toma de lista, como a los demás', () => {
  const actividad = db
    .prepare(
      `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
       VALUES ('2026-03-08', 'Culto', ?, ?)`
    )
    .run(iglesia, JSON.stringify([grupo])).lastInsertRowid;

  const convocados = require('../../server/modules/asistencias')
    .integrantesConvocados({ id: actividad, cuerpos: JSON.stringify([grupo]), iglesia_id: iglesia }, db,
      { id: 1, rol: 'admin' });
  const suya = [...convocados.values()].find((p) => Number(p.no_miembro_id) === Number(nelson));
  assert.ok(suya, 'sale entre los convocados del grupo, que es lo que permite marcarlo');
  assert.equal(suya.persona_tipo, 'No miembro');
  assert.equal(suya.miembro_id, null, 'apunta a un registro y suelta el otro: no puede decir dos personas');
  assert.equal(Number(suya.cuerpo_id), Number(grupo));
});

test('la planilla mensual del grupo trae también a quien no está inscrito', () => {
  const planilla = require('../../server/planilla-asistencia');
  const cuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(grupo);
  const hoja = planilla.armar(db, cuerpo, '2026-03');
  const nombres = hoja.integrantes.map((i) => i.nombre);
  assert.ok(nombres.includes('Nelson Sinficha'), `salieron: ${nombres.join(', ')}`);
  const suyo = hoja.integrantes.find((i) => i.nombre === 'Nelson Sinficha');
  assert.equal(suyo.persona_tipo, 'No miembro');
  assert.equal(suyo.trato, '', 'no lleva trato: el trato sale de la ficha de miembro y no tiene una');
});

/* ── 4. «Ahora sí se inscribió» ────────────────────────────────────── */

test('al inscribirse, sus grupos y su asistencia se van con ella', () => {
  /*
   * Es el caso que hay que resolver desde el principio: alguien empieza
   * sirviendo en un grupo, se convierte, se bautiza y se inscribe. Sin este
   * paso queda con dos fichas y su historial colgando de la que ya no se usa.
   */
  const actividad = db
    .prepare(
      `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
       VALUES ('2026-03-15', 'Culto', ?, ?)`
    )
    .run(iglesia, JSON.stringify([grupo])).lastInsertRowid;
  db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, no_miembro_id, estado, cuerpo_id, fecha, iglesia_id)
     VALUES (?, 'No miembro', ?, 'Presente', ?, '2026-03-15', ?)`
  ).run(actividad, nelson, grupo, iglesia);

  // Lo mismo que hace la ruta /no_miembros/:id/inscribir
  const ficha = db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(nelson);
  const nuevo = db
    .prepare(
      `INSERT INTO miembros (iglesia_id, nombres, apellidos, estado, tipo_miembro, fecha_ingreso)
       VALUES (?, ?, ?, 'Activo', 'Miembro Nuevo', '2026-06-01')`
    )
    .run(ficha.iglesia_id, ficha.nombres, ficha.apellidos).lastInsertRowid;
  db.prepare("UPDATE integrantes_cuerpo SET miembro_id = ?, no_miembro_id = NULL, persona_tipo = 'Miembro' WHERE no_miembro_id = ?")
    .run(nuevo, nelson);
  db.prepare("UPDATE asistencia_detalle SET miembro_id = ?, no_miembro_id = NULL, persona_tipo = 'Miembro' WHERE no_miembro_id = ?")
    .run(nuevo, nelson);
  db.prepare('UPDATE no_miembros SET miembro_id = ? WHERE id = ?').run(nuevo, nelson);

  // Sigue en el grupo, ahora como miembro, y con su fecha de ingreso de siempre
  const suya = integrantes.integrantesDe(db, grupo).find((f) => Number(f.miembro_id) === Number(nuevo));
  assert.ok(suya, 'sigue en el grupo después de inscribirse');
  assert.equal(suya.persona_tipo, 'Miembro');
  assert.equal(suya.fecha_ingreso, '2026-03-01', 'conserva desde cuándo pertenece');

  // Y su asistencia lo sigue, para que su porcentaje no parta de cero
  const marcas = db.prepare('SELECT COUNT(*) c FROM asistencia_detalle WHERE miembro_id = ?').get(nuevo).c;
  assert.equal(marcas, 1);

  // La ficha de acá NO se borra: de ella cuelgan las ayudas que se le
  // entregaron cuando todavía no era miembro
  const vieja = db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(nelson);
  assert.ok(vieja, 'la ficha del registro aparte sigue existiendo');
  assert.equal(Number(vieja.miembro_id), Number(nuevo), 'y queda apuntando a la nueva');
});

test('una ficha que ya se inscribió no se puede eliminar', () => {
  const noMiembros = require('../../server/modules/no_miembros');
  const fila = db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(nelson);
  assert.match(String(noMiembros.hooks.beforeDelete(fila, { db })), /ya se inscribió/);
});

test('ni una que todavía pertenece a un grupo', () => {
  const noMiembros = require('../../server/modules/no_miembros');
  const otro = unNoMiembro('Rosa', 'Enelgrupo');
  guardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: otro,
    estado: 'Activo', fecha_ingreso: '2026-05-01',
  });
  const fila = db.prepare('SELECT * FROM no_miembros WHERE id = ?').get(otro);
  assert.match(String(noMiembros.hooks.beforeDelete(fila, { db })), /pertenece a 1 grupo/);
});

/* ── 5. La cuota dice a nombre de quién se pagó ────────────────────── */

test('el movimiento de una cuota dice el nombre de quien pagó, esté inscrito o no', () => {
  /*
   * El movimiento de tesorería se escribe con el número de miembro de quien
   * pagó. Quien sirve en un grupo sin estar inscrito no tiene ese número, así
   * que el ingreso quedaba en el libro diciendo «un integrante»: plata que
   * entró sin decir de quién.
   */
  const cobra = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual) VALUES ('Grupo con cuota', 'Grupo', ?, 'Activo', 1, 2000)")
    .run(iglesia).lastInsertRowid;
  const quien = unNoMiembro('Marta', 'Aportante');
  const ficha = guardar({
    cuerpo_id: cobra, persona_tipo: 'No miembro', no_miembro_id: quien,
    estado: 'Activo', fecha_ingreso: '2026-02-01',
  });
  assert.equal(ficha.error, undefined, String(ficha.error));

  const cuotas = require('../../server/modules/cuotas_cuerpo');
  const pago = { integrante_id: ficha.id, anio: 2026, mes: '03', monto: 2000, fecha_pago: '2026-03-05' };
  const error = cuotas.hooks.beforeSave(pago, { existing: null, id: null, db });
  assert.equal(error, null, String(error));
  assert.equal(pago.persona, 'Marta Aportante', 'la cuota queda diciendo quién pagó');
  assert.equal(pago.miembro_id, null, 'y sin número de miembro, porque no tiene');
});

/* ── 6. A un grupo lo puede dirigir alguien no inscrito ────────────── */

const cuerpos = require('../../server/modules/cuerpos');

/** Guarda un cuerpo pasando por su hook, como lo hace el motor. */
function guardarCuerpo(datos, { id = null, existing = null, isNew = true } = {}) {
  const copia = { ...datos };
  const error = cuerpos.hooks.beforeSave(copia, { id, existing, isNew, db });
  if (error) return { error };
  const campos = Object.keys(copia).filter((c) => copia[c] !== undefined);
  const fila = db
    .prepare(
      `INSERT INTO cuerpos (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => copia[c]));
  return { id: Number(fila.lastInsertRowid), datos: copia };
}

test('a un GRUPO lo puede dirigir alguien que no está inscrito', () => {
  const encargado = unNoMiembro('Simón', 'Delsonido');
  const r = guardarCuerpo({
    nombre: 'Sonido', tipo: 'Grupo', iglesia_id: iglesia, estado: 'Activo',
    lider_tipo: 'No miembro', lider_no_miembro_id: encargado,
  });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.lider, 'Simón Delsonido', 'el nombre queda escrito en la ficha del grupo');
  assert.equal(r.datos.lider_id, null, 'y el enlace del otro registro queda suelto');

  // Y pertenece al grupo por dirigirlo, aunque no tenga ficha de integrante
  const gente = integrantes.personasDelCuerpo(db, r.id);
  assert.equal(gente.length, 1);
  assert.equal(gente[0].clave, `n${encargado}`);
  assert.equal(gente[0].persona_tipo, 'No miembro');

  // Pero NO entra en la lista de ids de miembros: ahí se confundiría con el
  // miembro que tenga ese mismo número
  assert.deepEqual(integrantes.idsDeIntegrantes(db, r.id), []);
});

test('a un CUERPO no: es formal y de sus integrantes sale su directiva', () => {
  const encargado = unNoMiembro('Pablo', 'Sinregistro');
  const r = guardarCuerpo({
    nombre: 'Caballeros', tipo: 'Cuerpo', iglesia_id: iglesia, estado: 'Activo',
    lider_tipo: 'No miembro', lider_no_miembro_id: encargado,
  });
  assert.match(String(r.error), /Un cuerpo lo dirige un miembro inscrito/);
});

test('ni un encargado registrado en otra iglesia', () => {
  const ajeno = unNoMiembro('Iván', 'Devisita', otraIglesia);
  const r = guardarCuerpo({
    nombre: 'Aseo', tipo: 'Grupo', iglesia_id: iglesia, estado: 'Activo',
    lider_tipo: 'No miembro', lider_no_miembro_id: ajeno,
  });
  assert.match(String(r.error), /otra iglesia/);
});

test('cambiar de registro suelta el enlace anterior', () => {
  const encargado = unNoMiembro('Rut', 'Encargada');
  const puesto = guardarCuerpo({
    nombre: 'Cocina', tipo: 'Grupo', iglesia_id: iglesia, estado: 'Activo',
    lider_tipo: 'No miembro', lider_no_miembro_id: encargado,
  });
  const antes = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(puesto.id);

  /*
   * Desde la 1.253.0, cambiar a alguien que no es integrante del grupo PREGUNTA
   * (ver server/quien-dirige-el-cuerpo.js), así que acá se contesta: lo que
   * esta prueba mide es el ENLACE, no la pregunta, que tiene las suyas aparte.
   */
  const cambio = { lider_tipo: 'Miembro', lider_id: ana };
  const pregunta = cuerpos.hooks.beforeSave(
    { ...cambio }, { id: puesto.id, existing: antes, isNew: false, db }
  );
  assert.equal(pregunta && pregunta.confirmar, 'quien_lo_dirige_no_es_integrante',
    'Ana no está entre los integrantes de este grupo');

  const error = cuerpos.hooks.beforeSave(
    cambio, { id: puesto.id, existing: antes, isNew: false, db, confirmado: true }
  );
  assert.equal(error, null, String(error));
  assert.equal(cambio.lider_no_miembro_id, null,
    'si no, el enlace viejo quedaría apuntando a alguien que ya no dirige nada');
  assert.equal(cambio.lider, 'Ana Miembro');
});

test('un cuerpo nace cobrando cuota y un grupo no', () => {
  // Casi ningún grupo cobra, y hasta ahora nacían cobrando igual que los
  // cuerpos: si nadie se acordaba de apagarlo, su gente quedaba con una deuda
  // que nunca existió.
  const unCuerpo = { nombre: 'Damas nuevas', tipo: 'Cuerpo', iglesia_id: iglesia, estado: 'Activo' };
  cuerpos.hooks.beforeSave(unCuerpo, { id: null, existing: null, isNew: true, db });
  assert.equal(unCuerpo.cobra_cuota, 1);

  const unGrupo = { nombre: 'Aseo nuevo', tipo: 'Grupo', iglesia_id: iglesia, estado: 'Activo' };
  cuerpos.hooks.beforeSave(unGrupo, { id: null, existing: null, isNew: true, db });
  assert.equal(unGrupo.cobra_cuota, 0);

  // Y quien lo dice manda: un grupo que sí cobra se crea cobrando
  const cobrador = { nombre: 'Coro', tipo: 'Grupo', iglesia_id: iglesia, estado: 'Activo', cobra_cuota: 1 };
  cuerpos.hooks.beforeSave(cobrador, { id: null, existing: null, isNew: true, db });
  assert.equal(cobrador.cobra_cuota, 1);
});

/* ── 7. La regla de la directiva también deja la ficha completa ────── */

test('la ficha que pone la regla de la directiva dice quién es y de qué registro', () => {
  /*
   * Esas fichas las escribe la regla con SQL, sin pasar por el hook del
   * módulo. Si no se les pone el registro y el nombre, la directiva de cada
   * iglesia queda con fichas en blanco donde las demás dicen quién es —y el
   * buscador de integrantes no las encuentra por nombre—.
   */
  const directiva = require('../../server/directiva');
  const cuerpoDirectiva = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES ('Directiva E2E', 'Cuerpo', ?, 'Activo', 1)")
    .run(iglesia).lastInsertRowid;
  const lider = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, tipo_miembro) VALUES ('Justo', 'Lidera', ?, 'Activo', ?)")
    .run(iglesia, directiva.categoriaQueCompone()).lastInsertRowid;

  directiva.alGuardarUnMiembro(db, db.prepare('SELECT * FROM miembros WHERE id = ?').get(lider), null, null);

  const suya = db
    .prepare('SELECT * FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?')
    .get(cuerpoDirectiva, lider);
  assert.ok(suya, 'la regla lo metió a la directiva');
  assert.equal(suya.persona_tipo, 'Miembro');
  assert.equal(suya.persona, 'Justo Lidera');
});

/* ── 8. Las migraciones dejan al día lo que ya existía ─────────────── */

test('las fichas que ya existían quedan escritas como de miembros', () => {
  const { fichasDeIntegranteConSuNombre, marcasDeAsistenciaConSuRegistro } = require('../../server/migraciones');
  // Una ficha vieja: sin registro y sin nombre escrito, como quedaban antes
  const vieja = db
    .prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso, persona_tipo, persona)
       VALUES (?, ?, ?, 'Activo', '2020-01-01', NULL, NULL)`
    )
    .run(cuerpoFormal, ana, iglesia).lastInsertRowid;

  // Un cuerpo viejo: sin registro del líder y sin su nombre escrito
  const cuerpoViejo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, lider_id, lider_tipo, lider) VALUES ('De antes', 'Cuerpo', ?, 'Activo', ?, NULL, NULL)")
    .run(iglesia, ana).lastInsertRowid;

  fichasDeIntegranteConSuNombre();
  marcasDeAsistenciaConSuRegistro();

  const puesta = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(vieja);
  assert.equal(puesta.persona_tipo, 'Miembro');
  assert.equal(puesta.persona, 'Ana Miembro');

  const suCuerpo = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpoViejo);
  assert.equal(suCuerpo.lider_tipo, 'Miembro', 'los líderes que ya existían son miembros inscritos');
  assert.equal(suCuerpo.lider, 'Ana Miembro');

  const sinRegistro = db
    .prepare("SELECT COUNT(*) c FROM asistencia_detalle WHERE persona_tipo IS NULL OR persona_tipo = ''")
    .get().c;
  assert.equal(sinRegistro, 0, 'ninguna marca queda sin decir de qué registro sale');
});
