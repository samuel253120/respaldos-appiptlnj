/**
 * La regla de «una sola cuenta general por nivel» es sobre las VIGENTES.
 *
 * El módulo tiene una regla buena: una sola cuenta «General» por nivel, un solo
 * «Fondo para la corporación» por iglesia y una sola de «Cuotas» por cuerpo. Lo
 * que no miraba era el estado, y eso dejaba a una iglesia sin poder abrir la
 * cuenta que reemplaza a la que acaba de cerrar:
 *
 *   «Ya existe la cuenta general de ese nivel ("Tesorería general — Iglesia
 *    Central"). Las demás cuentas deben ser de tipo «Proyecto / Trabajo».»
 *
 * nombrando justo la cuenta que la iglesia dio por terminada, y sin ofrecer
 * ninguna salida. Cambiar de banco es lo más común que le pasa a una cuenta.
 *
 * Contar solo las activas arregla las DOS direcciones de una vez: también
 * impide volver a abrir la vieja cuando su reemplazo ya está andando, que sería
 * quedarse con dos cuentas generales vigentes. Y son dos actos distintos, así
 * que el consejo que se da también: abrir una segunda no es lo mismo que
 * reabrir la de antes.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Reemplazo','IG-REEM','Activa')").run().lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas del Reemplazo','Cuerpo',?,'Activo')").run(iglesia).lastInsertRowid;

const abrir = (nombre, tipo, estado = 'Activa', cuerpoId = null, ambito = 'Iglesia local') => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, ?, ?, ?, ?, ?, 0, '2020-01-01')`)
  .run(nombre, ambito, tipo, ambito === 'Corporación' ? null : iglesia, cuerpoId, estado).lastInsertRowid;

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);
/** Crear una cuenta nueva, como la crea el motor. */
const crear = (data) => cuentasMod.hooks.beforeSave(data, { isNew: true, existing: null, id: null, db, confirmado: true });
/** Guardar una que ya existe. */
const guardar = (id, data) => cuentasMod.hooks.beforeSave(data, { isNew: false, existing: fila(id), id, db, confirmado: true });

// ------------------------------------------------- la regla sigue en pie ----

test('con la general vigente, no se abre una segunda', () => {
  abrir('General del Reemplazo', 'General');
  const r = crear({ nombre: 'Otra general del Reemplazo', ambito: 'Iglesia local', iglesia_id: iglesia, tipo: 'General', estado: 'Activa' });
  assert.match(String(r), /Ya existe la cuenta general de ese nivel/);
  assert.match(String(r), /"General del Reemplazo"/, 'y se dice con cuál choca');
  assert.match(String(r), /Proyecto \/ Trabajo/, 'con el consejo que sirve para este caso');
});

test('vale igual para el fondo de la corporación y para las cuotas de un cuerpo', () => {
  abrir('Fondo del Reemplazo', 'Fondo para la corporación');
  abrir('Cuotas del Reemplazo', 'Cuotas de integrantes', 'Activa', cuerpo, 'Cuerpo / Grupo');
  assert.match(
    String(crear({ nombre: 'Otro fondo', ambito: 'Iglesia local', iglesia_id: iglesia, tipo: 'Fondo para la corporación', estado: 'Activa' })),
    /Ya existe el fondo para la corporación/
  );
  assert.match(
    String(crear({ nombre: 'Otras cuotas', ambito: 'Cuerpo / Grupo', iglesia_id: iglesia, cuerpo_id: cuerpo, tipo: 'Cuotas de integrantes', estado: 'Activa' })),
    /Ya existe la cuenta de cuotas/
  );
});

// -------------------------------------------------- lo que estaba trabado ----

test('cerrada la vieja, la que la reemplaza sí se abre', () => {
  const vieja = abrir('General que cambia de banco del Reemplazo', 'General', 'Cerrada');
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Banco Nuevo','IG-BANC','Activa')").run().lastInsertRowid;
  db.prepare('UPDATE cuentas_tesoreria SET iglesia_id = ? WHERE id = ?').run(igl, vieja);

  const r = cuentasMod.hooks.beforeSave(
    { nombre: 'General nueva del Banco Nuevo', ambito: 'Iglesia local', iglesia_id: igl, tipo: 'General', estado: 'Activa' },
    { isNew: true, existing: null, id: null, db, confirmado: true }
  );
  assert.equal(r, null, 'cambiar de banco es lo más común que le pasa a una cuenta');
});

// ------------------------------------------- y la otra dirección, cerrada ----

test('no se vuelve a abrir la vieja si su reemplazo ya está andando', () => {
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las Dos Generales','IG-DOSG','Activa')").run().lastInsertRowid;
  const vieja = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                            VALUES ('Vieja de las Dos', 'Iglesia local', 'General', ?, 'Cerrada', 0)`).run(igl).lastInsertRowid;
  db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
              VALUES ('Nueva de las Dos', 'Iglesia local', 'General', ?, 'Activa', 0)`).run(igl);

  const r = guardar(vieja, { estado: 'Activa' });
  assert.match(String(r), /No se puede volver a abrir/,
    'sería quedarse con dos cuentas generales vigentes');
  assert.match(String(r), /"Nueva de las Dos"/);
  assert.match(String(r), /Cierre esa primero si quiere volver a usar esta/,
    'y el consejo es el de este acto, no el de abrir una segunda');
  assert.doesNotMatch(String(r), /Proyecto \/ Trabajo/,
    'ese consejo es para quien está creando una cuenta, no para quien reabre la suya');
});

test('cerrando la nueva, la vieja vuelve a poder abrirse', () => {
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Vaivén','IG-VAIV','Activa')").run().lastInsertRowid;
  const vieja = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                            VALUES ('Vieja del Vaivén', 'Iglesia local', 'General', ?, 'Cerrada', 0)`).run(igl).lastInsertRowid;
  const nueva = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                            VALUES ('Nueva del Vaivén', 'Iglesia local', 'General', ?, 'Activa', 0)`).run(igl).lastInsertRowid;

  assert.ok(guardar(vieja, { estado: 'Activa' }), 'con las dos vigentes, no');
  db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(nueva);
  assert.equal(guardar(vieja, { estado: 'Activa' }), null, 'con la nueva cerrada, sí');
});

// ------------------------------------------ la cerrada se sigue corrigiendo ----

test('a la cuenta cerrada se le sigue pudiendo corregir lo suyo', () => {
  /*
   * Sin esto el arreglo se comía su propia cola: con el reemplazo andando, la
   * regla habría rechazado hasta corregirle la descripción a la cuenta vieja,
   * que sigue siendo una cuenta general cerrada de ese mismo nivel.
   */
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Cola','IG-COLA','Activa')").run().lastInsertRowid;
  const vieja = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                            VALUES ('Vieja de la Cola', 'Iglesia local', 'General', ?, 'Cerrada', 0)`).run(igl).lastInsertRowid;
  db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
              VALUES ('Nueva de la Cola', 'Iglesia local', 'General', ?, 'Activa', 0)`).run(igl);

  assert.equal(guardar(vieja, { estado: 'Cerrada', descripcion: 'Cuenta del banco anterior' }), null);
});

test('y a la vigente se le puede cambiar el nombre sin que choque consigo misma', () => {
  /*
   * La consulta se excluye a sí misma con `id != ?`. Sin eso, corregirle el
   * nombre a la única cuenta general de una iglesia se rechazaba diciendo que
   * ya existe una cuenta general… que es ella.
   */
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Cambio de Nombre','IG-CNOM','Activa')").run().lastInsertRowid;
  const sola = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                           VALUES ('Tesorería general', 'Iglesia local', 'General', ?, 'Activa', 0)`).run(igl).lastInsertRowid;
  assert.equal(guardar(sola, { nombre: 'Tesorería general — Del Cambio de Nombre' }), null);

  // Las tres ramas de la consulta se excluyen a sí mismas: la de una iglesia,
  // la de un cuerpo y la de la corporación, que no es de ninguna iglesia
  const otroCuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Juventud del Cambio','Cuerpo',?,'Activo')").run(igl).lastInsertRowid;
  const suCuotas = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
                               VALUES ('Cuotas — Juventud', 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`).run(igl, otroCuerpo).lastInsertRowid;
  assert.equal(guardar(suCuotas, { nombre: 'Cuotas — Juventud del Cambio' }), null);

  /*
   * La tercera rama —la de la corporación— se comprueba leyendo la consulta y
   * no creando una cuenta: la corporación es UNA para todo el sistema, y estas
   * pruebas comparten la base y corren en paralelo, así que abrir acá una
   * cuenta general de la corporación choca con la que abre cualquier otro
   * archivo. La regla que se vigila es la misma en las tres.
   */
  const modulo = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');
  const consultas = modulo.match(/SELECT id, nombre FROM cuentas_tesoreria WHERE[^`]*/g) || [];
  assert.equal(consultas.length, 3, 'la de un cuerpo, la de una iglesia y la de la corporación');
  for (const q of consultas) {
    assert.match(q, /id != \?/, 'una cuenta no choca consigo misma');
    assert.match(q, /\$\{VIGENTE\}/, 'y solo compite con las vigentes');
  }
});

test('y cerrar la vigente no choca consigo misma', () => {
  const igl = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Cierre Propio','IG-CIEP','Activa')").run().lastInsertRowid;
  const sola = db.prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
                           VALUES ('Única del Cierre Propio', 'Iglesia local', 'General', ?, 'Activa', 0)`).run(igl).lastInsertRowid;
  assert.equal(guardar(sola, { estado: 'Cerrada' }), null);
});
