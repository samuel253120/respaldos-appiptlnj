/**
 * Una solicitud abierta a nombre de alguien que ya no entra al sistema.
 *
 * No se puede asignar una solicitud a una cuenta desactivada —la lista de
 * responsables solo trae las activas—, pero una asignación ANTERIOR sobrevivía
 * a la baja sin que nada lo dijera. Comprobado: desactivada la cuenta, su
 * solicitud abierta seguía a su nombre. Desde ahí los avisos iban a alguien que
 * no entra, no aparecía en la bandeja de nadie, y el recordatorio de «lleva
 * mucho sin respuesta» le llegaba a un buzón que nadie abre.
 *
 * Lo que se cuida acá:
 *
 *   · QUE SE PREGUNTE ANTES DE DESACTIVAR, diciendo cuántas lleva.
 *   · QUE NO SE BLOQUEE. Quien deja la iglesia tiene que perder el acceso hoy,
 *     no cuando alguien se acuerde de repartir sus trámites. Confirmando, entra.
 *   · QUE DESPUÉS NO SE PIERDAN: quedan en su caja de la bandeja y el vigía se
 *     lo recuerda a quien puede repartirlas.
 *
 * Y de paso, el contador del panel: dejaba fuera «En espera de antecedentes»,
 * así que una solicitud parada esperando un papel desaparecía del panel aunque
 * siguiera abierta y fuera la que había que destrabar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const usuarios = require('../../server/modules/usuarios');
const solicitudes = require('../../server/modules/solicitudes');
const vigia = require('../../server/avisos/vigia');

let cuantos = 0;
const IGLESIA = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Sin dueño','SINDUENO','Activa')")
  .run().lastInsertRowid;
const unUsuario = (nombre, activo = 1) =>
  db.prepare("INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES (?, ?, 'secretario', ?, 'x')")
    .run(nombre, `${76000000 + cuantos++}-0`, activo).lastInsertRowid;

const SEVA = unUsuario('Quien se va');
const SEQUEDA = unUsuario('Quien se queda');
const laDe = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

function unaSolicitud(campos = {}) {
  const base = {
    numero: `SOL-SINDUENO-${String(++cuantos).padStart(4, '0')}-2095`,
    fecha: '2026-08-01', iglesia_id: IGLESIA, solicitante: 'Quien pidió',
    tipo: 'Otro', asunto: 'Un asunto', estado: 'Pendiente', responsable_id: SEVA, ...campos,
  };
  return db.prepare(
    `INSERT INTO solicitudes (numero, fecha, iglesia_id, solicitante, tipo, asunto, estado, responsable_id)
     VALUES (@numero, @fecha, @iglesia_id, @solicitante, @tipo, @asunto, @estado, @responsable_id)`
  ).run(base).lastInsertRowid;
}

/**
 * Corre el gancho de usuarios como lo corre el guardado.
 *
 * Un gancho devuelve un texto cuando RECHAZA y un objeto con `confirmar`
 * cuando PREGUNTA. Se comprueban las dos formas, porque son distintas: con la
 * primera el dato no entra nunca; con la segunda entra si alguien dice que sí.
 * (Lanzar un error en vez de devolverlo hacía que el motor lo tomara por una
 * avería y contestara un 500 en vez de la pregunta.)
 */
function alDesactivar(id, { confirmado = false } = {}) {
  const r = usuarios.hooks.beforeSave(
    { activo: 0 },
    { isNew: false, id, existing: laDe(id), db, confirmado, user: { id: 1, rol: 'admin' } }
  );
  if (!r) return { error: null, pregunta: null };
  if (typeof r === 'string') return { error: r, pregunta: null };
  return { error: r.error, pregunta: r.confirmar || null };
}

// --------------------------------- se pregunta, y no se bloquea -----------

test('desactivar una cuenta sin solicitudes abiertas no pregunta nada', () => {
  assert.equal(alDesactivar(SEQUEDA).error, null);
});

test('lo que sale es una PREGUNTA, no una avería', () => {
  unaSolicitud();
  const r = usuarios.hooks.beforeSave(
    { activo: 0 },
    { isNew: false, id: SEVA, existing: laDe(SEVA), db, confirmado: false, user: { id: 1, rol: 'admin' } }
  );
  assert.equal(typeof r, 'object', 'devuelto, no lanzado: lanzado, el motor contesta un 500');
  assert.equal(r.confirmar, 'solicitudes_sin_responsable_activo');
  assert.equal(typeof r.error, 'string');
  db.prepare('DELETE FROM solicitudes WHERE responsable_id = ?').run(SEVA);
});

test('con solicitudes abiertas se pregunta, y se dice cuántas', () => {
  unaSolicitud();
  unaSolicitud({ estado: 'En espera de antecedentes' });
  const r = alDesactivar(SEVA);
  assert.equal(r.pregunta, 'solicitudes_sin_responsable_activo', 'tiene que poder confirmarse');
  assert.match(r.error, /lleva 2 solicitud/);
  assert.match(r.error, /nadie va a recibir sus avisos/i);
});

test('las cerradas no cuentan: ya no hay nada que hacer con ellas', () => {
  const otro = unUsuario('Quien ya terminó');
  for (const estado of solicitudes.CERRADOS) {
    unaSolicitud({ estado, responsable_id: otro, fecha_respuesta: '2026-08-05' });
  }
  assert.equal(alDesactivar(otro).error, null);
});

test('CONFIRMANDO, entra: cerrarle el acceso a alguien no puede quedar esperando', () => {
  assert.equal(alDesactivar(SEVA, { confirmado: true }).error, null);
});

test('y volver a activarla no pregunta nada', () => {
  const err = usuarios.hooks.beforeSave(
    { activo: 1 },
    { isNew: false, id: SEVA, existing: { ...laDe(SEVA), activo: 0 }, db, confirmado: false, user: { id: 1, rol: 'admin' } }
  );
  assert.equal(err, null);
});

// ------------------------- después no se pierden: la bandeja y el aviso ----

function bandeja(usuario, consulta = {}) {
  let atender = null;
  const router = { get(ruta, p, mano) { if (ruta === '/solicitudes/bandeja') atender = mano; }, post() {} };
  solicitudes.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next() });
  let salida = null;
  atender({ user: usuario, query: consulta }, { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

test('las que quedaron sin dueño tienen su caja en la bandeja', () => {
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(SEVA);
  const suyas = db.prepare('SELECT id FROM solicitudes WHERE responsable_id = ?').all(SEVA).map((s) => s.id);
  const d = bandeja({ id: SEQUEDA, rol: 'admin' }, { caja: 'huerfanas' });
  const ids = d.filas.map((f) => f.id);
  for (const id of suyas.slice(0, 2)) assert.ok(ids.includes(id), `la ${id} tendría que estar`);
  assert.ok(d.cuentas.huerfanas >= 2, `la cuenta dice ${d.cuentas.huerfanas}`);
});

test('y la fila avisa que esa cuenta ya no entra', () => {
  const d = bandeja({ id: SEQUEDA, rol: 'admin' }, { caja: 'huerfanas' });
  assert.ok(d.filas.length);
  assert.ok(d.filas.every((f) => f.responsable_activo === 0 || f.responsable_id == null),
    'del nombre no se puede adivinar que la cuenta está desactivada');
});

test('una con responsable activo NO aparece ahí', () => {
  const viva = unaSolicitud({ responsable_id: SEQUEDA });
  const d = bandeja({ id: SEQUEDA, rol: 'admin' }, { caja: 'huerfanas' });
  assert.ok(!d.filas.map((f) => f.id).includes(viva));
});

test('el vigía se lo recuerda a quien puede repartirlas, en un solo aviso', () => {
  const salieron = [];
  vigia.solicitudesSinResponsableActivo({ id: SEQUEDA, rol: 'admin' }, (a) => salieron.push(a));
  assert.equal(salieron.length, 1, 'diez avisos idénticos se ignoran');
  assert.match(salieron[0].titulo, /sin nadie que las lleve|quedó sin nadie/i);
  assert.equal(salieron[0].enlace, '#/solicitudes/bandeja?caja=huerfanas', 'el aviso lleva a donde se arregla');
});

test('a quien no puede repartirlas no se le avisa: no está en sus manos', () => {
  const salieron = [];
  vigia.solicitudesSinResponsableActivo({ id: SEQUEDA, rol: 'secretario' }, (a) => salieron.push(a));
  assert.equal(salieron.length, 0);
});

/*
 * LA CLAVE DEL AVISO DICE CUÁLES SON, NO CUÁNTAS.
 *
 * Llevaba la cuenta —«solicitudes_huerfanas:3»— y con eso una lista distinta
 * del mismo largo era, para el sistema, el mismo asunto: mientras el aviso
 * anterior siguiera sin leerse, la huérfana nueva no avisaba a nadie. MEDIDO en
 * la v1.335.0: repartida la 0045 y quedando huérfana la 0051, no salía ningún
 * aviso nuevo y el que seguía en pie nombraba la 0045, que ya tenía dueño.
 */
const laClaveDe = (usuario) => {
  const salieron = [];
  vigia.solicitudesSinResponsableActivo(usuario, (a) => salieron.push(a));
  return salieron.length ? salieron[0].clave : null;
};
const ELQUEREPARTE = { id: SEQUEDA, rol: 'admin' };

test('la clave del aviso lleva cuáles son, no cuántas', () => {
  const suya = unaSolicitud({ estado: 'Pendiente', responsable_id: SEVA });
  const clave = laClaveDe(ELQUEREPARTE);
  assert.ok(clave, 'tiene que haber aviso: acaba de quedar una sin dueño');
  assert.match(clave, /^solicitudes_huerfanas:\d+(,\d+)*$/,
    'los identificadores, como en las otras trece claves del vigía');
  assert.ok(clave.split(':')[1].split(',').includes(String(suya)),
    `la clave tiene que nombrar la ${suya}; llevaba solo el largo de la lista`);
});

test('mientras sean las mismas no vuelve a avisar todos los días', () => {
  assert.equal(laClaveDe(ELQUEREPARTE), laClaveDe(ELQUEREPARTE));
});

test('pero otra huérfana distinta, con la misma cuenta, SÍ vuelve a avisar', () => {
  /*
   * Es el caso medido: se reparte una y queda huérfana otra. La cuenta no
   * cambia; lo que cambia es cuál está sin dueño, y eso es un asunto nuevo.
   */
  const huerfanas = () => db
    .prepare("SELECT id FROM solicitudes WHERE responsable_id = ? AND estado NOT IN ('Aprobada','Rechazada','Completada','Anulada') ORDER BY fecha, id")
    .all(SEVA).map((f) => f.id);

  const antes = laClaveDe(ELQUEREPARTE);
  const laPrimera = huerfanas()[0];
  assert.ok(laPrimera, 'hace falta al menos una para repartir');

  // Se reparte esa, y queda huérfana otra recién ingresada
  db.prepare('UPDATE solicitudes SET responsable_id = ? WHERE id = ?').run(SEQUEDA, laPrimera);
  const laNueva = unaSolicitud({ estado: 'Pendiente', responsable_id: SEVA });

  const despues = laClaveDe(ELQUEREPARTE);
  assert.notEqual(despues, antes, 'la lista ya es otra: tiene que volver a sonar');
  assert.ok(despues.includes(String(laNueva)), 'y la clave nombra a la que de verdad quedó sin dueño');
  assert.ok(!despues.split(':')[1].split(',').includes(String(laPrimera)),
    'la que ya se repartió sale de la clave');
});

test('y las repartidas salen de la clave', () => {
  /*
   * No se comprueba que el aviso desaparezca del todo: quien reparte no tiene
   * iglesias asignadas, así que alcanza la base entera, y las pruebas del motor
   * corren en paralelo sobre UNA sola —otro archivo puede tener las suyas sin
   * dueño en ese mismo instante—. Lo que sí es de este archivo, y se comprueba,
   * es que ninguna de las suyas siga nombrada.
   */
  const mias = db.prepare('SELECT id FROM solicitudes WHERE responsable_id = ?').all(SEVA).map((f) => String(f.id));
  assert.ok(mias.length, 'hace falta al menos una para repartir');
  db.prepare('UPDATE solicitudes SET responsable_id = ? WHERE responsable_id = ?').run(SEQUEDA, SEVA);

  const clave = laClaveDe(ELQUEREPARTE);
  const nombradas = clave ? clave.split(':')[1].split(',') : [];
  for (const id of mias) {
    assert.ok(!nombradas.includes(id), `la ${id} ya tiene dueño y no puede seguir en la clave`);
  }
});

// ------------------------------------------- el contador del panel --------

test('el panel cuenta TODO lo abierto, no dos estados escritos a mano', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  const trozo = fuente.slice(fuente.indexOf('solicitudes_pendientes:'), fuente.indexOf('certificados: scoped'));
  assert.ok(!/'Pendiente'\s*,\s*'En revisión'/.test(trozo),
    'nombrar los estados a mano dejaba fuera «En espera de antecedentes», que sigue abierta');
  assert.ok(/CERRADOS/.test(trozo), 'la lista tiene que salir del propio módulo, para no volver a quedar corta');
});

test('y esa lista deja adentro los tres estados de trámite', () => {
  assert.deepEqual(
    solicitudes.ESTADOS.filter((e) => !solicitudes.CERRADOS.includes(e)),
    ['Pendiente', 'En revisión', 'En espera de antecedentes']
  );
});
