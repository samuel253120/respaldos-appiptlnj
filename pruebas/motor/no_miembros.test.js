/**
 * El registro de No Miembros y a quién se le ayudó.
 *
 * Las ayudas sociales de una iglesia son en su mayoría para gente que no
 * pertenece a la congregación, y antes el beneficiario era un nombre escrito
 * a mano. Al darle ficha propia hay dos cosas que pueden salir mal en
 * silencio, y las dos se prueban acá:
 *
 *   · la ayuda podría quedar apuntando a una persona y diciendo el nombre de
 *     otra, o quedar con los dos enlaces puestos
 *   · la migración que le da ficha a los beneficiarios de antes podría crear
 *     una ficha por ayuda en vez de una por persona, y entonces el historial
 *     que se quería ver seguiría sin verse
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const ayudas = require('../../server/modules/ayudas_sociales');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central','IG-A','Activa')").run().lastInsertRowid;
const otraIglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Norte','IG-B','Activa')").run().lastInsertRowid;

const miembro = db.prepare(
  `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
   VALUES (?, '16789012-3', 'Pedro Antonio', 'Ramirez Soto', 'Activo')`
).run(iglesia).lastInsertRowid;

const noMiembro = db.prepare(
  `INSERT INTO no_miembros (iglesia_id, nombres, apellidos) VALUES (?, 'Rosa Elena', 'Muñoz Vera')`
).run(iglesia).lastInsertRowid;

const guardar = (data, existing = null) =>
  ayudas.hooks.beforeSave(data, { isNew: !existing, existing, db });

// ------------------------------------- de quién es la ayuda que se registra

test('el nombre lo copia el sistema de la ficha, no se escribe', () => {
  const data = { beneficiario_tipo: 'No miembro', no_miembro_id: noMiembro, beneficiario: 'Lo que sea' };
  assert.equal(guardar(data), null);
  assert.equal(data.beneficiario, 'Rosa Elena Muñoz Vera');
});

test('una ficha sin apellido igual da un nombre, sin espacios de sobra', () => {
  const soloNombre = db.prepare("INSERT INTO no_miembros (iglesia_id, nombres) VALUES (?, 'Señora de la esquina')").run(iglesia).lastInsertRowid;
  const data = { beneficiario_tipo: 'No miembro', no_miembro_id: soloNombre };
  assert.equal(guardar(data), null);
  assert.equal(data.beneficiario, 'Señora de la esquina');
});

test('elegir el tipo y no elegir la persona se rechaza', () => {
  assert.match(String(guardar({ beneficiario_tipo: 'No miembro' })), /no está indicado/);
  assert.match(String(guardar({ beneficiario_tipo: 'Miembro' })), /no está indicado/);
});

test('apuntar a una ficha que ya no existe se rechaza', () => {
  assert.match(String(guardar({ beneficiario_tipo: 'No miembro', no_miembro_id: 99999 })), /ya no está en el sistema/);
});

test('al corregir de miembro a no miembro se suelta el enlace viejo', () => {
  const existing = { beneficiario_tipo: 'Miembro', miembro_id: miembro, no_miembro_id: null };
  const data = { beneficiario_tipo: 'No miembro', no_miembro_id: noMiembro };
  assert.equal(guardar(data, existing), null);
  assert.equal(data.miembro_id, null, 'el miembro no recibió nada: no puede quedar enlazado');
  assert.equal(data.beneficiario, 'Rosa Elena Muñoz Vera');
});

test('y al revés también', () => {
  const existing = { beneficiario_tipo: 'No miembro', miembro_id: null, no_miembro_id: noMiembro };
  const data = { beneficiario_tipo: 'Miembro', miembro_id: miembro };
  assert.equal(guardar(data, existing), null);
  assert.equal(data.no_miembro_id, null);
  assert.equal(data.beneficiario, 'Pedro Antonio Ramirez Soto');
});

test('editar otra cosa de la ayuda no le cambia el beneficiario', () => {
  const existing = { beneficiario_tipo: 'No miembro', miembro_id: null, no_miembro_id: noMiembro };
  const data = { valor_estimado: 50000 }; // solo se corrige el monto
  assert.equal(guardar(data, existing), null);
  assert.equal(data.beneficiario, 'Rosa Elena Muñoz Vera');
});

test('una ayuda de antes, sin tipo, se queda como está', () => {
  const data = { valor_estimado: 1000 };
  assert.equal(guardar(data, { beneficiario_tipo: null, beneficiario: 'Nombre viejo' }), null);
  assert.equal(data.beneficiario, undefined, 'no se le inventa un nombre nuevo');
});

// ------------------------- la migración que le da ficha a los de antes -----

test('a cada beneficiario de antes se le da su ficha, una por persona', () => {
  const meter = db.prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario, miembro_id, tipo_ayuda, valor_estimado)
     VALUES (?,?,?,?,?,?)`
  );
  // la misma señora escrita de tres formas distintas
  meter.run('2026-01-10', iglesia, 'Juana Perez', null, 'Alimentos', 10000);
  meter.run('2026-02-10', iglesia, '  juana perez  ', null, 'Ropa', 20000);
  meter.run('2026-03-10', iglesia, 'Juana  Perez', null, 'Otro', 30000);
  // el mismo nombre en otra iglesia: NO es la misma persona
  meter.run('2026-03-11', otraIglesia, 'Juana Perez', null, 'Alimentos', 5000);
  // una a nombre de un miembro
  meter.run('2026-04-10', iglesia, 'Pedro Antonio Ramirez Soto', miembro, 'Económica', 40000);
  // una sin nombre
  meter.run('2026-05-10', iglesia, '', null, 'Otro', 1000);

  /*
   * Se cuentan las fichas DE ESTAS DOS IGLESIAS y no las de toda la tabla: los
   * archivos de prueba comparten una sola base y corren a la vez, así que
   * cualquier otro que siembre una ayuda con el beneficiario escrito a mano le
   * hacía fallar esta cuenta sin tener nada que ver con la migración.
   */
  const cuantasAca = () => db
    .prepare('SELECT COUNT(*) c FROM no_miembros WHERE iglesia_id IN (?, ?)')
    .get(iglesia, otraIglesia).c;
  const antes = cuantasAca();
  require('../../server/migraciones').ayudasConFichaDelBeneficiario();

  const fichas = db.prepare("SELECT * FROM no_miembros WHERE nombres LIKE 'Juana%'").all();
  assert.equal(fichas.length, 2, 'una por persona y por iglesia, no una por ayuda');
  assert.equal(cuantasAca(), antes + 2);

  const suya = fichas.find((f) => f.iglesia_id === iglesia);
  const susAyudas = db.prepare('SELECT COUNT(*) c, SUM(valor_estimado) t FROM ayudas_sociales WHERE no_miembro_id = ?').get(suya.id);
  assert.equal(susAyudas.c, 3, 'sus tres ayudas cuelgan de la misma ficha');
  assert.equal(susAyudas.t, 60000, 'y por fin se puede sumar cuánto se le ha dado');
  assert.equal(suya.nombres, 'Juana Perez', 'el nombre queda como se escribió la primera vez');
});

test('la que ya apuntaba a un miembro queda marcada como Miembro', () => {
  const fila = db.prepare("SELECT * FROM ayudas_sociales WHERE miembro_id = ?").get(miembro);
  assert.equal(fila.beneficiario_tipo, 'Miembro');
  assert.equal(fila.no_miembro_id, null);
});

test('la que no traía nombre se queda como estaba, sin inventarle una ficha', () => {
  const fila = db.prepare("SELECT * FROM ayudas_sociales WHERE beneficiario = ''").get();
  assert.equal(fila.beneficiario_tipo, null);
  assert.equal(fila.no_miembro_id, null);
});

test('correrla dos veces no duplica nada', () => {
  const fichas = db.prepare('SELECT COUNT(*) c FROM no_miembros WHERE iglesia_id IN (?, ?)')
    .get(iglesia, otraIglesia).c;
  const cuantosEnlaces = () => db
    .prepare('SELECT COUNT(*) c FROM ayudas_sociales WHERE no_miembro_id IS NOT NULL AND iglesia_id IN (?, ?)')
    .get(iglesia, otraIglesia).c;
  const enlaces = cuantosEnlaces();
  require('../../server/migraciones').ayudasConFichaDelBeneficiario();
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM no_miembros WHERE iglesia_id IN (?, ?)').get(iglesia, otraIglesia).c,
    fichas
  );
  assert.equal(cuantosEnlaces(), enlaces);
});

// ------------------------------------------ que no se mezcle con Miembros --

test('No Miembros y Miembros son dos tablas distintas', () => {
  /*
   * Acotado a las iglesias DE ESTA PRUEBA a propósito.
   *
   * Estaba escrito contra toda la tabla —«que no haya ningún miembro llamado
   * Juana o Rosa»— y los archivos del motor comparten una sola base. Bastaba
   * que otra prueba llamara Rosa a alguien suyo para que esta fallara sin
   * tener nada que ver, y pasó dos veces. Lo que se quiere comprobar es que
   * la migración de las ayudas no metió gente en la membresía, y eso se mira
   * en el escenario que ella misma armó.
   */
  const enMiembros = db
    .prepare(
      `SELECT COUNT(*) c FROM miembros
        WHERE iglesia_id IN (?, ?) AND (nombres LIKE 'Juana%' OR nombres LIKE 'Rosa%')`
    )
    .get(iglesia, otraIglesia).c;
  assert.equal(enMiembros, 0, 'nadie del registro de no miembros entró a la membresía');
});
