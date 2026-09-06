/**
 * Los cuatro historiales contestan lo mismo sobre lo que anotó el sistema.
 *
 * Cada historial mezcla dos cosas en la misma lista: lo que escribió el equipo
 * y lo que anotó el sistema al ocurrir el hecho. La columna «Origen» dice cuál
 * es cuál. Lo que no estaba decidido era qué se puede hacer con las segundas, y
 * la respuesta dependía de en qué pestaña estuviera parado quien preguntara.
 *
 * MEDIDO en la v1.433.0, sobre una anotación que dejó el sistema, en los cuatro:
 *
 *   historial_solicitudes  ·  corregirla 400 «no se modifica»  ·  borrarla 400
 *   historial_iglesias ....  corregirla 200 (guarda el original)  ·  borrarla 200 BORRADA
 *   historial_pastores ....  corregirla 200 (guarda el original)  ·  borrarla 200 BORRADA
 *   bitacora ..............  corregirla 200 (guarda el original)  ·  borrarla 200 BORRADA
 *
 * Son CUATRO y no los tres del informe: la bitácora de un miembro tiene la
 * misma forma y no estaba en la revisión, igual que pasó en el hallazgo SA-01.
 *
 * ── LO QUE SE DECIDIÓ, Y POR QUÉ ──
 *
 * Las dos posturas eran defendibles y ninguna estaba escrita como decisión. Se
 * eligió una sola regla, con una razón para cada mitad:
 *
 *   SE CORRIGE, y queda escrito lo que decía y quién lo corrigió. Una redacción
 *   se arregla, y lo que anotó el sistema no se pierde: está en la misma fila.
 *   Ese mecanismo existía, con su porqué escrito, en tres de los cuatro; al de
 *   una solicitud le faltaba, y por eso su única respuesta posible era negarse.
 *
 *   NO SE ELIMINA. Acá no hay nada equivalente al texto original: la línea
 *   desaparece de la lista donde la gente la lee, y lo único que queda es una
 *   entrada del Registro de Cambios, que es otra pantalla y otros permisos.
 *
 * Si la corporación prefiere la mitad contraria —que lo automático tampoco se
 * corrija—, el cambio está descrito en server/lo-que-decia-el-sistema.js. Lo
 * que no puede volver es que cada pestaña conteste una cosa distinta (SA-05).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const { hoy } = require('../../server/fechas');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let cuantos = 0;
const unRut = () => {
  const n = `${22000000 + (marca * 29 + cuantos++ * 4093) % 900000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Constancia ${marca}`, `CO-${marca}`).lastInsertRowid;

/** Una anotación automática de verdad, escrita como la escribe el sistema. */
function unaAutomatica(tabla, campo, dueno, texto) {
  return db.prepare(
    `INSERT INTO "${tabla}" ("${campo}", fecha, tipo, descripcion, origen, registrado_por, iglesia_id)
     VALUES (?,?,?,?,'Automático','Sistema',?)`
  ).run(dueno, hoy(), 'Anotación', `${texto} ${marca}`, iglesia).lastInsertRowid;
}
/** Y una escrita a mano, para comprobar que a ésa no se le hace nada. */
function unaAMano(tabla, campo, dueno, texto) {
  return db.prepare(
    `INSERT INTO "${tabla}" ("${campo}", fecha, tipo, descripcion, origen, registrado_por, iglesia_id)
     VALUES (?,?,?,?,'Manual','Una secretaria',?)`
  ).run(dueno, hoy(), 'Anotación', `${texto} ${marca}`, iglesia).lastInsertRowid;
}

const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run('Rosa', `Díaz CO ${marca}`, unRut(), iglesia).lastInsertRowid;
const pastor = db
  .prepare("INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, estado, cargo) VALUES (?,?,?,?,'Activo','Pastor Presbítero')")
  .run('Elías', `Vera CO ${marca}`, unRut(), iglesia).lastInsertRowid;
const solicitud = db
  .prepare(
    `INSERT INTO solicitudes (fecha, iglesia_id, solicitante_tipo, miembro_id, tipo, asunto, estado)
     VALUES (?, ?, 'Miembro', ?, 'Otro', ?, 'Pendiente')`
  ).run(hoy(), iglesia, miembro, `Constancia ${marca}`).lastInsertRowid;

/** Los cuatro, con su tabla, su columna de dueño y de quién cuelgan. */
const LOS_CUATRO = [
  ['historial_solicitudes', 'solicitud_id', () => solicitud],
  ['historial_iglesias', 'iglesia_id', () => iglesia],
  ['historial_pastores', 'pastor_id', () => pastor],
  ['bitacora', 'miembro_id', () => miembro],
];

// ------------------------------------------- la regla, en los cuatro -------

test('los cuatro historiales declaran las dos mitades de la regla', () => {
  /*
   * Escrita como regla y no como cuatro casos: el día que aparezca un quinto
   * historial, esta comprobación lo va a pedir también.
   */
  const compartido = require('../../server/lo-que-decia-el-sistema');
  for (const [modulo] of LOS_CUATRO) {
    const def = getModule(modulo);
    assert.ok(def.fields.some((f) => f.name === 'texto_original'),
      `${modulo}: sin dónde guardar lo que decía, corregir una automática la borra de hecho`);
    assert.equal(typeof def.hooks.beforeDelete, 'function', `${modulo}: sin gancho de borrado`);
    assert.equal(def.hooks.beforeDelete({ origen: 'Manual' }), null,
      `${modulo}: lo escrito a mano se sigue pudiendo borrar`);
    assert.ok(def.hooks.beforeDelete({ origen: 'Automático' }),
      `${modulo}: lo que anotó el sistema se sigue pudiendo borrar`);
  }
  assert.equal(typeof compartido.noSeElimina, 'function', 'la regla vive en un solo sitio');
});

test('corregir una automática deja escrito lo que decía y quién la corrigió', async () => {
  const api = await elSistemaAndando();
  for (const [modulo, campo, dueno] of LOS_CUATRO) {
    const id = unaAutomatica(modulo, campo, dueno(), 'Lo anotó el sistema.');
    const r = await api('PUT', `/${modulo}/${id}`, {
      descripcion: `Se le arregla la redacción. ${marca}`, igual_asi: true,
    });
    assert.equal(r.estado, 200, `${modulo}: ${r.texto.slice(0, 200)}`);
    const fila = db.prepare(`SELECT * FROM "${modulo}" WHERE id = ?`).get(id);
    assert.match(fila.texto_original, /Lo anotó el sistema/, `${modulo}: se perdió lo que decía`);
    assert.ok(fila.corregido_por, `${modulo}: no quedó quién la corrigió`);
    assert.equal(fila.origen, 'Automático', `${modulo}: sigue siendo del sistema`);
  }
});

test('y borrarla se rechaza en los cuatro, con las mismas palabras', async () => {
  const api = await elSistemaAndando();
  const avisos = new Set();
  for (const [modulo, campo, dueno] of LOS_CUATRO) {
    const id = unaAutomatica(modulo, campo, dueno(), 'Constancia de algo que pasó.');
    const r = await api('DELETE', `/${modulo}/${id}?igual_asi=true`);
    assert.equal(r.estado, 400, `${modulo}: se llevó por delante una constancia`);
    assert.ok(!r.json.confirmar, `${modulo}: esto no se confirma, se niega`);
    assert.ok(db.prepare(`SELECT id FROM "${modulo}" WHERE id = ?`).get(id), `${modulo}: se borró igual`);
    avisos.add(r.json.error);
  }
  assert.equal(avisos.size, 1, `los cuatro tienen que decir lo mismo, y dijeron ${avisos.size} cosas`);
  assert.match([...avisos][0], /no se elimina/);
  assert.match([...avisos][0], /corríjale el texto/, 'y se dice qué hacer en cambio');
});

// ------------------------------------------- lo escrito a mano, intacto ----

test('lo que escribió una persona se sigue corrigiendo y borrando', async () => {
  const api = await elSistemaAndando();
  for (const [modulo, campo, dueno] of LOS_CUATRO) {
    const id = unaAMano(modulo, campo, dueno(), 'La escribió la secretaria.');
    const ed = await api('PUT', `/${modulo}/${id}`, {
      descripcion: `Corregida por su autora. ${marca}`, igual_asi: true,
    });
    assert.equal(ed.estado, 200, `${modulo}: ${ed.texto.slice(0, 160)}`);
    assert.equal(
      db.prepare(`SELECT texto_original FROM "${modulo}" WHERE id = ?`).get(id).texto_original, null,
      `${modulo}: en una nota a mano «Origen» sigue siendo cierto después de corregirla: son sus palabras`
    );
    const bo = await api('DELETE', `/${modulo}/${id}?igual_asi=true`);
    assert.equal(bo.estado, 200, `${modulo}: ${bo.texto.slice(0, 160)}`);
  }
});

// ------------------------------------------- y el arrastre, intacto --------

test('borrar la ficha madre SÍ se lleva sus automáticas: la regla no frena el arrastre', async () => {
  /*
   * Importa: si el gancho frenara el arrastre, una iglesia recién creada no se
   * podría borrar nunca —el sistema le anota su línea de apertura al crearla—,
   * y eso es justo lo que la v1.232.0 arregló. El arrastre borra las filas por
   * el camino de server/dependencias.js, sin pasar por este gancho.
   */
  const api = await elSistemaAndando();
  const suya = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`Recién creada ${marca}`, `RC-${marca}`).lastInsertRowid;
  unaAutomatica('historial_iglesias', 'iglesia_id', suya, 'Se registra la iglesia.');

  const r = await api('DELETE', `/iglesias/${suya}?igual_asi=true`);
  assert.equal(r.estado, 200, r.texto.slice(0, 250));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM historial_iglesias WHERE iglesia_id = ?').get(suya).n, 0,
    'sus líneas se fueron con ella'
  );
});

// ------------------------------------------- y la pantalla ----------------

test('la pantalla esconde la papelera de una automática, y en las cuatro pestañas', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /const noSeBorra = \(r\) => r\.origen === 'Automático';/,
    'la pantalla decide por el origen y no por en qué pestaña está');
  assert.doesNotMatch(app, /automaticasFijas/,
    'ya no hay una pestaña con reglas propias: la regla es una y es del servidor');
  /*
   * Y el LÁPIZ queda fuera de lo que el candado tapa: en las cuatro pestañas se
   * corrige. Se mira el orden dentro del bloque de botones de una fila: primero
   * el lápiz, y después el ternario que decide entre candado y papelera. Si
   * alguien volviera a meter el lápiz dentro del ternario, la pestaña de una
   * solicitud dejaría de poder corregir y volveríamos al hallazgo.
   */
  const botones = app.slice(app.indexOf('<div class=\"ha\">', app.indexOf('const noSeBorra')));
  const lapiz = botones.indexOf('data-editar');
  const candado = botones.indexOf('noSeBorra(r)');
  assert.ok(lapiz > 0, 'no se encontró el lápiz en los botones de la fila');
  assert.ok(candado > lapiz, 'el lápiz se ofrece antes y fuera de lo que el candado tapa');
});
