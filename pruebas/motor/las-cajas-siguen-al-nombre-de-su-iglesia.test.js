/**
 * Cuando una iglesia cambia de nombre, sus cajas cambian con ella.
 *
 * Al crear una iglesia, el sistema le abre solas sus dos cuentas de tesorería y
 * les escribe el nombre de la iglesia adentro. Ese nombre se copiaba una vez y
 * no se volvía a mirar. Medido creando «Prueba A» y renombrándola:
 *
 *   al crearla ............................ Tesorería general — Prueba A
 *   renombrada a «Prueba A RENOMBRADA» .... Tesorería general — Prueba A
 *
 * Y ese nombre se ve en el listado de Cuentas de Tesorería, en el desplegable
 * al anotar un movimiento, en el título de la cartola y en la cartola IMPRESA,
 * que es la que se compara contra la del banco.
 *
 * Es el mismo problema que la 1.220.0 resolvió cuando un cuerpo se cambia de
 * iglesia: lo que se COPIÓ hay que volver a mirarlo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const suNombre = require('../../server/el-nombre-de-la-iglesia');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const IGLESIAS = getModule('iglesias');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Una iglesia creada como la crea el módulo: con sus dos cajas abiertas. */
function unaIglesia(nombre) {
  const id = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(nombre, `NOM${marca()}`).lastInsertRowid;
  suNombre.abrirLasSuyas(db, id, nombre);
  return id;
}

const susCajas = (id) => db
  .prepare('SELECT tipo, nombre, updated_by FROM cuentas_tesoreria WHERE iglesia_id = ? ORDER BY tipo')
  .all(id);
const comoSeLlaman = (id) => susCajas(id).map((c) => c.nombre).sort();

/** Renombrarla como lo hace el motor: se guarda y corre el gancho de después. */
function renombrar(id, nombreNuevo, usuario = null) {
  const antes = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(nombreNuevo, id);
  const ahora = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  IGLESIAS.hooks.afterSave(ahora, { isNew: false, existing: antes, user: usuario, db });
  return ahora;
}

// ------------------------------------------------------ al crearla ----

test('al crear una iglesia se le abren sus dos cajas, con su nombre adentro', () => {
  const nombre = `Prueba A ${marca()}`;
  const id = unaIglesia(nombre);
  assert.deepEqual(comoSeLlaman(id), [
    `Fondo para la corporación — ${nombre}`,
    `Tesorería general — ${nombre}`,
  ]);
});

test('y no se le abre otra si ya tiene una de ese tipo, aunque se llame distinto', () => {
  /*
   * Se pregunta por TIPO y no por nombre, que es como estaba escrito desde el
   * principio y es correcto: la suya puede haberla renombrado alguien.
   */
  const id = unaIglesia(`Prueba B ${marca()}`);
  db.prepare("UPDATE cuentas_tesoreria SET nombre = 'Caja chica' WHERE iglesia_id = ? AND tipo = 'General'").run(id);
  assert.equal(suNombre.abrirLasSuyas(db, id, 'Cualquier cosa'), 0, 'no tendría que abrir ninguna');
  assert.equal(susCajas(id).length, 2);
});

// ------------------------------------------------------ al renombrarla ----

test('al cambiarle el nombre, sus cajas cambian con ella', () => {
  const viejo = `Prueba C ${marca()}`;
  const id = unaIglesia(viejo);
  const nuevo = `Sede Ñuñoa ${marca()}`;
  renombrar(id, nuevo);
  assert.deepEqual(comoSeLlaman(id), [
    `Fondo para la corporación — ${nuevo}`,
    `Tesorería general — ${nuevo}`,
  ]);
});

test('pero NO la que alguien renombró a mano', () => {
  /*
   * «Caja chica de la sede» tiene ese nombre porque alguien lo decidió, y un
   * arreglo que se lo pise es peor que el defecto que viene a arreglar. Se
   * reconocen por comparación exacta contra lo que el sistema habría escrito
   * con el nombre viejo, así que una tocada a mano no calza.
   */
  const viejo = `Prueba D ${marca()}`;
  const id = unaIglesia(viejo);
  db.prepare("UPDATE cuentas_tesoreria SET nombre = 'Caja chica de la sede' WHERE iglesia_id = ? AND tipo = 'General'").run(id);
  const nuevo = `Renombrada ${marca()}`;
  renombrar(id, nuevo);

  assert.deepEqual(comoSeLlaman(id), [
    'Caja chica de la sede',
    `Fondo para la corporación — ${nuevo}`,
  ], 'la de la corporación sigue el nombre; la que alguien bautizó se queda como está');
});

test('y corregirle el teléfono no le renombra nada', () => {
  /*
   * Si se renombrara en cada guardado, corregirle un dato a una iglesia dejaría
   * anotado en el Registro de Cambios que se le renombraron las cuentas, que no
   * pasó. Es la misma advertencia que está escrita en el caso del cuerpo que se
   * muda de iglesia.
   */
  const nombre = `Prueba E ${marca()}`;
  const id = unaIglesia(nombre);
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  IGLESIAS.hooks.afterSave({ ...fila, telefono: '+56 2 2222 3333' },
    { isNew: false, existing: fila, user: null, db });
  assert.deepEqual(comoSeLlaman(id), [
    `Fondo para la corporación — ${nombre}`,
    `Tesorería general — ${nombre}`,
  ]);
});

test('seguirAlNombre dice qué cambió, para poder anotarlo', () => {
  const viejo = `Prueba F ${marca()}`;
  const id = unaIglesia(viejo);
  const nuevo = `Prueba F bis ${marca()}`;
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(nuevo, id);
  const cambiadas = suNombre.seguirAlNombre(db, id, viejo, nuevo);
  assert.equal(cambiadas.length, 2);
  const texto = suNombre.comoSeLee(cambiadas);
  assert.match(texto, new RegExp(`«Tesorería general — ${viejo}» pasó a «Tesorería general — ${nuevo}»`));
});

test('y no hace nada si el nombre no cambió', () => {
  const nombre = `Prueba G ${marca()}`;
  const id = unaIglesia(nombre);
  assert.deepEqual(suNombre.seguirAlNombre(db, id, nombre, nombre), []);
  assert.deepEqual(suNombre.seguirAlNombre(db, id, null, nombre), []);
});

// ---------------------------------------- las que ya quedaron atrás ----

/*
 * Estas tocan la base entera —la migración recorre todas las cuentas—, así que
 * cada prueba comprueba SOLO lo suyo. Cuántas arregla en total depende de lo que
 * hayan sembrado los otros archivos, que corren en paralelo sobre la misma base.
 */

test('la migración le pone el nombre de hoy a la caja que quedó atrás', () => {
  const viejo = `Prueba H ${marca()}`;
  const id = unaIglesia(viejo);
  const nuevo = `Prueba H nueva ${marca()}`;
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(nuevo, id); // renombrada sin el arreglo
  assert.ok(comoSeLlaman(id).every((x) => x.includes(viejo)), 'guardia: quedaron con el nombre viejo');

  suNombre.lasQueQuedaronAtras(db);
  assert.deepEqual(comoSeLlaman(id), [
    `Fondo para la corporación — ${nuevo}`,
    `Tesorería general — ${nuevo}`,
  ]);
});

test('y no toca la que alguien editó alguna vez', () => {
  /*
   * Acá no se sabe el nombre viejo, así que hacen falta las dos señales: la
   * plantilla exacta del sistema y que NADIE la haya editado. El motor escribe
   * `updated_by` cada vez que una persona guarda, así que esa marca distingue
   * una cuenta que tocó alguien de una que abrió el sistema y quedó ahí.
   */
  const viejo = `Prueba I ${marca()}`;
  const id = unaIglesia(viejo);
  db.prepare("UPDATE cuentas_tesoreria SET updated_by = 7 WHERE iglesia_id = ? AND tipo = 'General'").run(id);
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(`Prueba I nueva ${marca()}`, id);

  suNombre.lasQueQuedaronAtras(db);
  const general = susCajas(id).find((c) => c.tipo === 'General');
  assert.equal(general.nombre, `Tesorería general — ${viejo}`,
    'alguien la guardó alguna vez: su nombre es cosa suya');
});

test('ni una cuya plantilla no es la del sistema', () => {
  const id = unaIglesia(`Prueba J ${marca()}`);
  db.prepare("UPDATE cuentas_tesoreria SET nombre = 'Ofrendas del templo' WHERE iglesia_id = ? AND tipo = 'General'").run(id);
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(`Prueba J nueva ${marca()}`, id);

  suNombre.lasQueQuedaronAtras(db);
  assert.ok(comoSeLlaman(id).includes('Ofrendas del templo'), 'sin la raya y el prefijo, no es suya');
});

test('ni la caja de un cuerpo, aunque lleve la misma plantilla', () => {
  /*
   * La caja de un cuerpo también puede ser de tipo «General» —el módulo lo
   * admite, una por cuerpo—, así que el tipo no alcanza para distinguirlas. Si
   * alguien la llamó con esta misma plantilla, sin mirar `cuerpo_id` se le
   * habría escrito encima el nombre de la iglesia: esa caja es del cuerpo.
   */
  const viejo = `Prueba K ${marca()}`;
  const id = unaIglesia(viejo);
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Coro ${marca()}`, id).lastInsertRowid;
  const deLCuerpo = `Tesorería general — Coro de ${viejo}`;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', ?, ?, 'General', 'Activa', 0)`
  ).run(deLCuerpo, id, cuerpo);

  const nuevo = `Prueba K nueva ${marca()}`;
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(nuevo, id);
  suNombre.lasQueQuedaronAtras(db);
  assert.ok(comoSeLlaman(id).includes(deLCuerpo),
    'la caja de un cuerpo es del cuerpo: su nombre no sale de la iglesia');

  /*
   * Y tampoco al renombrar en el momento, que es el otro camino. Acá la caja
   * del cuerpo se llama EXACTAMENTE como el sistema llamaría a la de la
   * iglesia: es lo que pasa cuando alguien bautiza la del cuerpo con el nombre
   * de la congregación. Sin mirar `cuerpo_id`, el renombrado se la lleva.
   */
  const comoLaDeLaIglesia = suNombre.comoSeLlamaria('Tesorería general', nuevo);
  const otraDelCuerpo = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', ?, ?, 'General', 'Activa', 0)`
  ).run(comoLaDeLaIglesia, id, cuerpo).lastInsertRowid;

  suNombre.seguirAlNombre(db, id, nuevo, `Prueba K otra vez ${marca()}`);
  assert.equal(
    db.prepare('SELECT nombre FROM cuentas_tesoreria WHERE id = ?').get(otraDelCuerpo).nombre,
    comoLaDeLaIglesia,
    'se llamaba igual que la de la iglesia, pero es del cuerpo: no se la lleva el renombrado'
  );
  assert.ok(comoSeLlaman(id).includes(deLCuerpo));
});

// ------------------------------------------- la plantilla, en un lugar ----

test('la plantilla del nombre se escribe UNA vez', () => {
  /*
   * Vivía dentro del gancho que crea las cuentas. Escrita también en el
   * renombrado, el día que una cambiara la otra dejaría de reconocer las
   * cuentas que ella misma bautizó, y el arreglo no tocaría ninguna sin que
   * nadie se enterara.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/iglesias.js'), 'utf8');
  assert.doesNotMatch(modulo, /Tesorería general — \$\{/,
    'el módulo no puede volver a armar el nombre por su cuenta');
  assert.match(modulo, /suNombre\.abrirLasSuyas\(db, fila\.id, fila\.nombre\)/);
  assert.match(modulo, /suNombre\.seguirAlNombre\(db, fila\.id, existing && existing\.nombre, fila\.nombre\)/);
  assert.equal(suNombre.comoSeLlamaria('Tesorería general', 'Iglesia Central'),
    'Tesorería general — Iglesia Central');
});

test('y las dos cuentas que abre son las dos que reconoce', () => {
  assert.deepEqual(suNombre.COMO_LAS_BAUTIZA.map((c) => c.tipo).sort(),
    ['Fondo para la corporación', 'General']);
  const tipos = (getModule('cuentas_tesoreria').fields.find((f) => f.name === 'tipo') || {}).options || [];
  for (const cual of suNombre.COMO_LAS_BAUTIZA) {
    assert.ok(tipos.includes(cual.tipo),
      `«${cual.tipo}» ya no es un tipo de cuenta: el sistema abriría cuentas de un tipo que no existe`);
  }
});

// ------------------------------------------- renombrando de verdad ----

test('renombrando de verdad: las cajas siguen, y queda anotado', async () => {
  const api = await elSistemaAndando();
  const m = `siguen-${process.pid}`;
  const nueva = await api('POST', '/iglesias', {
    nombre: `Prueba L ${m}`, codigo: `SIG${process.pid}`, estado: 'Activa',
  });
  assert.equal(nueva.estado, 201, nueva.texto.slice(0, 200));
  const id = nueva.json.id;

  const cajas = () => (db
    .prepare('SELECT nombre FROM cuentas_tesoreria WHERE iglesia_id = ? ORDER BY tipo')
    .all(id)).map((c) => c.nombre);
  assert.deepEqual(cajas(), [`Fondo para la corporación — Prueba L ${m}`, `Tesorería general — Prueba L ${m}`],
    'guardia: el módulo se las abre al crearla');

  const r = await api('PUT', `/iglesias/${id}`, { nombre: `Sede Norte ${m}`, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.deepEqual(cajas(), [`Fondo para la corporación — Sede Norte ${m}`, `Tesorería general — Sede Norte ${m}`]);

  const anotado = db
    .prepare("SELECT COUNT(*) AS n FROM registro_cambios WHERE detalle LIKE ? AND detalle LIKE ?")
    .get('%renombraron sus cuentas%', `%Sede Norte ${m}%`).n;
  assert.ok(anotado > 0,
    'renombrar cajas de dinero sin dejar constancia es lo que el Registro de Cambios existe para evitar');
});
