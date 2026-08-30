/**
 * El responsable de una cuenta es la persona a la que se le pregunta por esa
 * plata, y el campo no miraba de qué iglesia era.
 *
 * Medido: una cuenta de la Iglesia Central quedó a nombre de un miembro de la
 * Norte, al crearla y al editarla, con un 200 y sin decir nada. No es que el
 * sistema se rompa: es que un error de tecleo —dos personas con apellidos
 * parecidos— se convierte en un dato que después nadie vuelve a revisar, y esa
 * persona probablemente ni alcance la cuenta que figura a su nombre.
 *
 * SE PREGUNTA, NO SE BLOQUEA: hay casos legítimos —un tesorero de la
 * corporación a cargo de una cuenta de proyecto de una iglesia local—, y
 * negárselo sería peor que el problema.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');

const central = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del Responsable','IG-RESP-C','Activa')").run().lastInsertRowid;
const norte = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte del Responsable','IG-RESP-N','Activa')").run().lastInsertRowid;

const miembro = (nombres, iglesiaId) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, 'del Responsable', ?, 'Activo')")
  .run(nombres, iglesiaId).lastInsertRowid;
const deAca = miembro('Ana', central);
const deAlla = miembro('Berta', norte);
const sinIglesia = db
  .prepare("INSERT INTO miembros (nombres, apellidos, estado) VALUES ('Carmen', 'del Responsable', 'Activo')")
  .run().lastInsertRowid;

const abrir = (nombre, opciones = {}) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial, fecha_apertura, responsable, responsable_id)
            VALUES (?, ?, 'Proyecto / Trabajo', ?, 'Activa', 0, '2020-01-01', ?, ?)`)
  .run(nombre, opciones.ambito || 'Iglesia local',
    opciones.iglesia === undefined ? central : opciones.iglesia,
    opciones.responsable || null, opciones.responsable_id || null).lastInsertRowid;

const fila = (id) => db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(id);
/** Corre el hook como lo corre el motor. */
const guardar = (id, data, confirmado = false) =>
  cuentasMod.hooks.beforeSave(data, { isNew: !id, existing: id ? fila(id) : null, id, db, confirmado });

// --------------------------------------------------------------- se pregunta ----

test('al crear una cuenta con un responsable de otra iglesia, se pregunta', () => {
  const r = guardar(null, {
    nombre: 'Caja ajena nueva del Responsable', ambito: 'Iglesia local',
    tipo: 'Proyecto / Trabajo', iglesia_id: central, estado: 'Activa', saldo_inicial: 0,
    responsable: 'Berta del Responsable', responsable_id: deAlla,
  });
  assert.ok(r, 'antes esto pasaba con un 201 y sin decir nada');
  assert.equal(r.confirmar, 'responsable_de_otra_iglesia');
  assert.match(r.error, /Berta del Responsable/, 'dice quién');
  assert.match(r.error, /Norte del Responsable/, 'de qué iglesia es');
  assert.match(r.error, /Central del Responsable/, 'y de cuál es la cuenta');
});

test('y al ponérselo después a una cuenta que ya existía, también', () => {
  const cual = abrir('Caja que cambia de responsable del Responsable');
  const r = guardar(cual, { responsable: 'Berta del Responsable', responsable_id: deAlla });
  assert.equal(r && r.confirmar, 'responsable_de_otra_iglesia');
});

test('confirmando, se guarda: hay casos legítimos y no se bloquea', () => {
  const cual = abrir('Caja del tesorero de la corporación del Responsable');
  assert.equal(guardar(cual, { responsable: 'Berta del Responsable', responsable_id: deAlla }, true), null);
});

test('la pregunta ofrece la salida en vez de dejarla adivinar', () => {
  const r = guardar(null, {
    nombre: 'Caja con salida del Responsable', ambito: 'Iglesia local', tipo: 'Proyecto / Trabajo',
    iglesia_id: central, estado: 'Activa', saldo_inicial: 0, responsable_id: deAlla,
  });
  assert.match(r.error, /tesorero de la corporación/,
    'sin el caso legítimo escrito, quien lo lea no sabe si es un error suyo o del sistema');
  assert.match(r.error, /confirme/);
});

test('cambiarle la iglesia a la cuenta también lo pregunta, sin tocar al responsable', () => {
  /*
   * El par se rompe por los dos lados: la cuenta se muda y su responsable se
   * queda. Mirar solo el campo «Responsable» habría dejado pasar justo eso.
   */
  const cual = abrir('Caja que se muda del Responsable', { responsable: 'Ana del Responsable', responsable_id: deAca });
  const r = guardar(cual, { iglesia_id: norte });
  assert.equal(r && r.confirmar, 'responsable_de_otra_iglesia');
  assert.match(r.error, /Ana del Responsable/);
});

// ----------------------------------------------------------- no se pregunta ----

test('un responsable de la misma iglesia no pregunta nada', () => {
  const cual = abrir('Caja de casa del Responsable');
  assert.equal(guardar(cual, { responsable: 'Ana del Responsable', responsable_id: deAca }), null);
});

test('un responsable escrito a mano, sin ficha, sigue valiendo', () => {
  /*
   * El campo lo admite a propósito —«Doña Rosa, la de la esquina»— y un nombre
   * suelto no tiene iglesia con que comparar.
   */
  const cual = abrir('Caja de doña Rosa del Responsable');
  assert.equal(guardar(cual, { responsable: 'Doña Rosa, la de la esquina' }), null);
});

test('la cuenta de la corporación no es de ninguna iglesia: cualquiera le sirve', () => {
  const r = guardar(null, {
    nombre: 'Caja de la corporación del Responsable', ambito: 'Corporación',
    tipo: 'Proyecto / Trabajo', estado: 'Activa', saldo_inicial: 0, responsable_id: deAlla,
  });
  assert.equal(r, null, 'sin iglesia propia, ningún miembro le es ajeno');
});

test('un miembro sin iglesia escrita no contradice a nadie', () => {
  const cual = abrir('Caja de Carmen del Responsable');
  assert.equal(guardar(cual, { responsable_id: sinIglesia }), null);
});

test('un responsable que ya estaba puesto no se vuelve a preguntar en cada guardado', () => {
  /*
   * Preguntarlo cada vez que alguien le corrige la descripción a la cuenta no
   * es cuidar el dato: es enseñar a apretar «Está bien» sin leer.
   */
  const cual = abrir('Caja ya aceptada del Responsable', { responsable: 'Berta del Responsable', responsable_id: deAlla });
  assert.equal(guardar(cual, { descripcion: 'Le corrijo la descripción y nada más' }), null);
});

test('un responsable enlazado a una ficha que no existe no inventa un aviso', () => {
  const cual = abrir('Caja de un fantasma del Responsable');
  assert.equal(guardar(cual, { responsable_id: 99999999 }), null);
});

// ------------------------------------------------------ el orden de la fila ----

test('si el mismo guardado toca la plata y el responsable, primero sale la plata', () => {
  /*
   * Se hace UNA pregunta por guardado. Las otras dos son sobre el dinero mismo
   * —dónde queda encerrado, cómo se corren todos los saldos—; ésta es sobre a
   * quién se le pregunta por él.
   */
  const cual = abrir('Caja de las dos preguntas del Responsable');
  db.prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
              VALUES ('2026-02-10','Ingreso','Otros','Lo del responsable',250000,?,?)`).run(cual, central);

  const r = guardar(cual, { estado: 'Cerrada', responsable_id: deAlla });
  assert.equal(r.confirmar, 'cuenta_cerrada_con_saldo', 'la del dinero va primero');

  const s = guardar(cual, { saldo_inicial: 900000, responsable_id: deAlla });
  assert.equal(s.confirmar, 'saldo_inicial_cambiado', 'y la del punto de partida, antes que ésta');
});

test('las tres preguntas de este módulo tienen cada una su clave', () => {
  const texto = fs.readFileSync(path.join(__dirname, '../../server/modules/cuentas_tesoreria.js'), 'utf8');
  const claves = [...texto.matchAll(/confirmar: '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(claves, ['cuenta_cerrada_con_saldo', 'responsable_de_otra_iglesia', 'saldo_inicial_cambiado'],
    'dos preguntas con la misma clave son una sola para la pantalla');
});
