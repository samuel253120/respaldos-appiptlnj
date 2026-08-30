/**
 * Cuando un cuerpo se cambia de iglesia, lo suyo se va con él.
 *
 * La iglesia de un cuerpo no es un rótulo: es lo que decide QUIÉN VE cada cosa
 * suya. Y varias tablas no la eligen, la COPIAN del cuerpo al guardarse —la
 * cuenta de tesorería toma la del cuerpo, la ficha de integrante toma la del
 * cuerpo, el movimiento toma la de la cuenta—. Esa copia se hacía una vez y no
 * se volvía a mirar.
 *
 * Medido sobre un cuerpo con 52 integrantes al mudarlo de la Iglesia Central a
 * la Norte: sus 2 cuentas de tesorería, sus 52 fichas de integrante y los
 * movimientos de esas cuentas se quedaron en la Central. Lo que queda es un
 * cuerpo que dice pertenecer a una iglesia donde no está nada de lo suyo: la
 * tesorera de la iglesia nueva no ve su caja, la de la vieja la sigue viendo
 * con su plata y la suma en su balance. No es un rótulo desactualizado: es una
 * diferencia de alcance, o sea de quién tiene acceso a esa plata y a esa gente.
 *
 * EL CRITERIO: sigue al cuerpo lo que COPIÓ su iglesia. No sigue lo que la
 * lleva escrita por derecho propio —un acta de reunión, una ficha de
 * inventario—, donde «Iglesia» es un campo que alguien elige y dice dónde pasó
 * la cosa.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { db } = require('../../server/db');
require('../../server/registry');
const cuerposMod = require('../../server/modules/cuerpos');
const sigue = require('../../server/lo-que-sigue-al-cuerpo');
const { loQueSeQuedoEnLaIglesiaAnterior } = require('../../server/migraciones');

const central = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la Mudanza','IG-MUD-C','Activa')").run().lastInsertRowid;
const norte = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de la Mudanza','IG-MUD-N','Activa')").run().lastInsertRowid;

const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de la Mudanza','Cuerpo',?,'Activo')")
  .run(central).lastInsertRowid;

/** Todo lo que este cuerpo tiene, sembrado en la iglesia de origen. */
const cuenta = db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
            VALUES ('Caja de las Damas de la Mudanza', 'Cuerpo / Grupo', 'General', ?, ?, 'Activa', 0)`)
  .run(central, cuerpo).lastInsertRowid;
const integrantes = [1, 2, 3].map((n) => db
  .prepare("INSERT INTO integrantes_cuerpo (cuerpo_id, persona, estado, iglesia_id) VALUES (?, ?, 'Activo', ?)")
  .run(cuerpo, `Integrante ${n} de la Mudanza`, central).lastInsertRowid);
const movimiento = db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, cuerpo_id)
            VALUES ('2026-03-01','Ingreso','Otros','Lo de las Damas',20000,?,?,?)`)
  .run(cuenta, central, cuerpo).lastInsertRowid;
// Un movimiento de la misma cuenta al que nadie le escribió el cuerpo: se lo
// alcanza por su CUENTA, no por su cuerpo (ver server/lo-que-sigue-al-cuerpo.js)
const sinCuerpo = db
  .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
            VALUES ('2026-03-02','Egreso','Otros','Sin cuerpo escrito',5000,?,?)`)
  .run(cuenta, central).lastInsertRowid;
// Y un acta, que lleva su iglesia por derecho propio
const acta = db
  .prepare(`INSERT INTO actas_reuniones (numero_acta, fecha, cuerpo_id, iglesia_id, estado)
            VALUES ('01/2026','2026-03-05',?,?,'Aprobada')`)
  .run(cuerpo, central).lastInsertRowid;

const iglesiaDe = (tabla, id) => db.prepare(`SELECT iglesia_id FROM "${tabla}" WHERE id = ?`).get(id).iglesia_id;
const fila = () => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(cuerpo);

/** Muda el cuerpo como lo muda el motor: guardando su ficha. */
function mudar(aIglesia) {
  db.prepare('UPDATE cuerpos SET iglesia_id = ? WHERE id = ?').run(aIglesia, cuerpo);
  const antes = { ...fila(), iglesia_id: aIglesia === central ? norte : central };
  cuerposMod.hooks.afterSave(fila(), { isNew: false, existing: antes, user: { id: 1, nombre: 'Quien lo movió' }, db });
}

// -------------------------------------------------------- lo que se va con él ----

test('sus cuentas, su gente y los movimientos de sus cuentas se mudan con el cuerpo', () => {
  assert.equal(iglesiaDe('cuentas_tesoreria', cuenta), central, 'antes estaba en la de origen');
  mudar(norte);
  assert.equal(iglesiaDe('cuentas_tesoreria', cuenta), norte);
  for (const id of integrantes) assert.equal(iglesiaDe('integrantes_cuerpo', id), norte);
  assert.equal(iglesiaDe('tesoreria', movimiento), norte);
});

test('también el movimiento al que nadie le escribió el cuerpo: se lo alcanza por su cuenta', () => {
  assert.equal(iglesiaDe('tesoreria', sinCuerpo), norte,
    'buscarlos solo por `cuerpo_id` habría dejado atrás los que no lo llevan');
});

test('el acta se queda: su iglesia la eligió alguien y dice dónde fue la reunión', () => {
  assert.equal(iglesiaDe('actas_reuniones', acta), central,
    'sigue al cuerpo lo que COPIÓ su iglesia, no lo que la lleva por derecho propio');
});

test('y volver a mudarlo lo devuelve todo', () => {
  mudar(central);
  assert.equal(iglesiaDe('cuentas_tesoreria', cuenta), central);
  for (const id of integrantes) assert.equal(iglesiaDe('integrantes_cuerpo', id), central);
  assert.equal(iglesiaDe('tesoreria', movimiento), central);
  assert.equal(iglesiaDe('tesoreria', sinCuerpo), central);
});

// ------------------------------------------------------------ lo que se anota ----

test('queda anotado en el Registro de Cambios, con qué se movió y cuánto', () => {
  /*
   * No es prolijidad: son filas de dinero y de gente cambiando de manos, y
   * moverlas en silencio es exactamente lo que ese registro existe para evitar.
   */
  const antes = db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c;
  mudar(norte);
  const linea = db
    .prepare("SELECT * FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c, antes + 1);
  assert.match(linea.detalle, /1 cuenta\(s\) de tesorería/);
  assert.match(linea.detalle, /3 ficha\(s\) de integrante/);
  assert.match(linea.detalle, /2 movimiento\(s\) de sus cuentas/);
  assert.equal(linea.usuario, 'Quien lo movió');
  mudar(central);
});

test('un guardado que no cambia la iglesia no mueve nada ni anota nada', () => {
  const antes = db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c;
  cuerposMod.hooks.afterSave(fila(), { isNew: false, existing: fila(), user: { id: 1 }, db });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c, antes,
    'corregirle el teléfono a un cuerpo no es mudarlo');
  assert.equal(iglesiaDe('cuentas_tesoreria', cuenta), central);
});

test('y tampoco cuando algo suyo está en otra iglesia: el cuerpo no se movió', () => {
  /*
   * Una cuenta quedó en la iglesia equivocada —así estaban las cosas antes de
   * esto—. Corregirla es trabajo de la migración, que pasa una vez; un guardado
   * cualquiera no la toca, porque si la tocara dejaría anotado «se movió con el
   * cuerpo» un día en que el cuerpo no se movió a ninguna parte, y esa línea es
   * el único lugar donde después se va a buscar qué pasó con esa plata.
   */
  const suelta = db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
              VALUES ('Caja que se quedó atrás', 'Cuerpo / Grupo', 'Ofrendas', ?, ?, 'Activa', 0)`)
    .run(norte, cuerpo).lastInsertRowid;
  const antes = db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c;

  cuerposMod.hooks.afterSave(fila(), { isNew: false, existing: fila(), user: { id: 1 }, db });

  assert.equal(iglesiaDe('cuentas_tesoreria', suelta), norte, 'nadie la tocó');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c, antes);
  db.prepare('DELETE FROM cuentas_tesoreria WHERE id = ?').run(suelta);
});

test('lo que ya está donde va no se cuenta como movido', () => {
  /*
   * Si se contara, el Registro de Cambios diría «2 cuenta(s)» cuando se movió
   * una: una cifra falsa justo donde hay que ir a mirar la verdad.
   */
  const yaAlla = db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
              VALUES ('Caja adelantada', 'Cuerpo / Grupo', 'Ofrendas', ?, ?, 'Activa', 0)`)
    .run(norte, cuerpo).lastInsertRowid;

  const movidas = sigue.mudarLoSuyo(cuerpo, norte, db);
  const cuentas = movidas.find((m) => m.tabla === 'cuentas_tesoreria');
  assert.equal(cuentas.cuantas, 1, 'la que ya estaba en la Norte no se movió: estaba');

  sigue.mudarLoSuyo(cuerpo, central, db);
  db.prepare('DELETE FROM cuentas_tesoreria WHERE id = ?').run(yaAlla);
});

test('y un cuerpo recién creado tampoco: no viene de ninguna parte', () => {
  const antes = db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c;
  const nuevo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Juventud de la Mudanza','Cuerpo',?,'Activo')").run(norte).lastInsertRowid;
  cuerposMod.hooks.afterSave(db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(nuevo), { isNew: true, existing: null, user: { id: 1 }, db });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM registro_cambios WHERE detalle LIKE '%se movió con el cuerpo%'").get().c, antes);
});

// ------------------------------------------------------------- la regla, sola ----

test('mudarLoSuyo devuelve solo lo que de verdad movió', () => {
  const quieto = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro de la Mudanza','Cuerpo',?,'Activo')").run(central).lastInsertRowid;
  assert.deepEqual(sigue.mudarLoSuyo(quieto, central, db), [], 'un cuerpo sin nada suyo no mueve nada');
  assert.equal(sigue.comoSeLee([{ que: 'cuenta(s)', cuantas: 2 }, { que: 'ficha(s)', cuantas: 52 }]),
    '2 cuenta(s), 52 ficha(s)');
});

// ------------------------------------------------- lo que ya se quedó atrás ----

test('la migración le devuelve a los cuerpos lo que dejaron en la iglesia anterior', () => {
  /*
   * El arreglo vale de aquí en adelante; lo que ya se quedó atrás sigue atrás.
   * La migración pasa una vez por todos los cuerpos, y por eso se la prueba
   * sobre una COPIA de la base: las pruebas del motor comparten una sola entre
   * procesos, y correr aquí algo que toca todos los cuerpos les cambiaría los
   * datos a los demás archivos mientras están mirándolos.
   */
  const copia = path.join(os.tmpdir(), `mudanza-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    // Un cuerpo de la Central con su caja y su gente dejadas en la Norte, que
    // es como quedaban las cosas antes de esto
    const atrasado = otra.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Varones que se mudaron','Cuerpo',?,'Activo')").run(central).lastInsertRowid;
    const suCaja = otra
      .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
                VALUES ('Caja dejada atrás', 'Cuerpo / Grupo', 'General', ?, ?, 'Activa', 0)`)
      .run(norte, atrasado).lastInsertRowid;
    const suGente = otra
      .prepare("INSERT INTO integrantes_cuerpo (cuerpo_id, persona, estado, iglesia_id) VALUES (?, 'Uno que se quedó', 'Activo', ?)")
      .run(atrasado, norte).lastInsertRowid;
    const suPlata = otra
      .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
                VALUES ('2026-04-01','Ingreso','Otros','Lo dejado atrás',9000,?,?)`)
      .run(suCaja, norte).lastInsertRowid;

    otra.prepare("DELETE FROM migraciones WHERE nombre = 'lo del cuerpo sigue al cuerpo cuando cambia de iglesia'").run();
    loQueSeQuedoEnLaIglesiaAnterior(otra);

    const de = (tabla, id) => otra.prepare(`SELECT iglesia_id FROM "${tabla}" WHERE id = ?`).get(id).iglesia_id;
    assert.equal(de('cuentas_tesoreria', suCaja), central, 'la caja volvió con su cuerpo');
    assert.equal(de('integrantes_cuerpo', suGente), central);
    assert.equal(de('tesoreria', suPlata), central);
    assert.ok(
      otra.prepare("SELECT nombre FROM migraciones WHERE nombre = 'lo del cuerpo sigue al cuerpo cuando cambia de iglesia'").get(),
      'y queda marcada como aplicada, para no volver a pasarla'
    );

    // Correrla de nuevo no hace nada: está marcada
    loQueSeQuedoEnLaIglesiaAnterior(otra);
    assert.equal(de('cuentas_tesoreria', suCaja), central);
  } finally {
    otra.close();
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s); } catch (e) { /* no estaba */ } }
  }
});

test('a los cuerpos de la corporación, que no son de ninguna iglesia, ni se les pregunta', () => {
  /*
   * La migración ni siquiera se los pasa a la regla. Se comprueba así, y no
   * solo mirando que su caja quedó como estaba, porque «quedó como estaba»
   * también sale bien por accidente: `iglesia_id != NULL` no es cierto nunca en
   * SQL, así que un UPDATE con la iglesia en blanco no toca ninguna fila aunque
   * se lo pida. Descansar en esa regla del SQL es una trampa: el día que
   * alguien escriba el `!=` de otra manera —`IS NOT`, que sí compara nulos—,
   * los cuerpos de la corporación se quedarían con la columna en blanco y nada
   * lo habría avisado.
   */
  const copia = path.join(os.tmpdir(), `mudanza-corp-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  const suyo = sigue.mudarLoSuyo;
  const preguntados = [];
  try {
    const dela = otra.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Nacional de la Mudanza','Cuerpo',NULL,'Activo')").run().lastInsertRowid;
    const conIglesia = otra.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Local de la Mudanza','Cuerpo',?,'Activo')").run(central).lastInsertRowid;
    const suCaja = otra
      .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
                VALUES ('Caja nacional de la Mudanza', 'Cuerpo / Grupo', 'General', ?, ?, 'Activa', 0)`)
      .run(central, dela).lastInsertRowid;

    sigue.mudarLoSuyo = (cuerpoId, iglesiaId, conexion) => {
      preguntados.push(cuerpoId);
      return suyo(cuerpoId, iglesiaId, conexion);
    };
    otra.prepare("DELETE FROM migraciones WHERE nombre = 'lo del cuerpo sigue al cuerpo cuando cambia de iglesia'").run();
    loQueSeQuedoEnLaIglesiaAnterior(otra);

    assert.ok(preguntados.includes(conIglesia), 'por los que sí tienen iglesia se pregunta');
    assert.ok(!preguntados.includes(dela), 'por el de la corporación no');
    assert.equal(otra.prepare('SELECT iglesia_id FROM cuentas_tesoreria WHERE id = ?').get(suCaja).iglesia_id, central,
      'y su caja quedó donde estaba');
  } finally {
    sigue.mudarLoSuyo = suyo;
    otra.close();
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s); } catch (e) { /* no estaba */ } }
  }
});

test('la migración está en la lista que se corre al arrancar', () => {
  const texto = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');
  assert.match(texto, /\['lo del cuerpo sigue al cuerpo cuando cambia de iglesia', loQueSeQuedoEnLaIglesiaAnterior\]/,
    'arreglar el código de aquí en adelante no arregla lo que ya se quedó atrás');
});

// ---------------------------------------------------------------- la lista ----

test('una tabla de la lista que no calce con el esquema revienta al cargar', () => {
  /*
   * La lista está escrita a mano y el esquema en otra parte. La primera versión
   * de esto se saltaba en silencio la tabla que no calzaba: la plata del cuerpo
   * dejaba de seguirlo y nadie se enteraba, que es el defecto que este archivo
   * vino a arreglar.
   */
  assert.equal(sigue.revisar(), true, 'las seis de verdad están y tienen sus columnas');
  assert.throws(() => sigue.revisar([{ tabla: 'la_que_no_existe', que: 'nada' }], db),
    /no existe/);
  assert.throws(() => sigue.revisar([{ tabla: 'iglesias', que: 'nada' }], db),
    /no tiene .*cuerpo_id/, 'la tabla existe pero no se la alcanza desde el cuerpo');
});

test('las seis tablas que siguen al cuerpo están nombradas en un solo lugar', () => {
  const nombres = sigue.LO_SUYO.map((x) => x.tabla).sort();
  assert.deepEqual(nombres, [
    'cuentas_tesoreria', 'cuotas_cuerpo', 'directivas',
    'evaluaciones_integrantes', 'integrantes_cuerpo', 'tesoreria',
  ]);
  const texto = fs.readFileSync(path.join(__dirname, '../../server/lo-que-sigue-al-cuerpo.js'), 'utf8');
  assert.match(texto, /Sigue al cuerpo lo que COPIÓ su iglesia/,
    'el criterio tiene que estar escrito donde está la lista');
});
