/**
 * LAS OTRAS TRES CARPETAS, CON LOS MISMOS ARREGLOS.
 *
 * Un miembro, una iglesia, un pastor y una solicitud tienen cada uno su
 * carpeta de documentos. Entre la 1.191.0 y la 1.200.0 se le arreglaron diez
 * cosas a la de los miembros, y tres de ellas eran huecos idénticos en las
 * otras tres. Medido antes, contra el servidor:
 *
 *                                  el mismo papel     al borrarlo, su
 *                                  dos veces          historial
 *   documentos_iglesias .........  201 y 201          5 a 5
 *   documentos_pastores .........  201 y 201          5 a 5
 *   documentos_solicitudes ......  201 y 201          4 a 4
 *
 *   la hoja impresa de una iglesia ...  sin secciones: ni historial ni carpeta
 *   la hoja impresa de un pastor .....  sin secciones
 *
 * Lo que cuida este archivo:
 *   · que la pregunta del papel repetido viva UNA vez y la usen las cuatro
 *   · que cada carpeta pregunte por lo suyo y no por lo del vecino
 *   · que quitar un papel deje su línea en el historial de su dueño, sea quien
 *     sea, y con las comillas de su propio «se adjuntó»
 *   · que la hoja de una iglesia y la de un pastor lleven su historial y su
 *     carpeta, como la de un miembro desde la 1.196.0
 *   · y que la columna de vencimiento salga solo donde dice algo
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
require('../../server/ajustes');
const { db } = require('../../server/db');
const registry = require('../../server/registry');
const bitacora = require('../../server/bitacora');
const carpetas = require('../../server/carpetas');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
const quien = { id: 1, nombre: 'Secretaria de las carpetas', rol: 'secretario' };
const HOY = new Date().toISOString().slice(0, 10);

/* ------------------------------- el escenario: las cuatro carpetas */

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de las carpetas','IG-CAR1','Activa')")
  .run().lastInsertRowid;
const otraIglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de las carpetas','IG-CAR2','Activa')")
  .run().lastInsertRowid;
const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa','De las Carpetas',?,'Activo')")
  .run(iglesia).lastInsertRowid;
const pastor = db.prepare("INSERT INTO pastores (nombres, apellidos, iglesia_id, estado) VALUES ('Elías','De las Carpetas',?,'Activo')")
  .run(iglesia).lastInsertRowid;
const solicitud = db.prepare(
  "INSERT INTO solicitudes (iglesia_id, miembro_id, solicitante_tipo, tipo, asunto, fecha, estado)"
  + " VALUES (?,?,'Miembro','Certificado','Un certificado','2026-08-01','Pendiente')"
).run(iglesia, miembro).lastInsertRowid;

const CARPETAS = [
  { modulo: 'documentos_iglesias', campo: 'iglesia_id', dueno: () => iglesia, tipo: 'Otro',
    deQuien: 'esta iglesia', historial: 'historial_iglesias', campoHist: 'iglesia_id', comillas: '"' },
  { modulo: 'documentos_pastores', campo: 'pastor_id', dueno: () => pastor, tipo: 'Otro Documento',
    deQuien: 'este pastor', historial: 'historial_pastores', campoHist: 'pastor_id', comillas: '"' },
  { modulo: 'documentos_solicitudes', campo: 'solicitud_id', dueno: () => solicitud, tipo: 'Antecedente',
    deQuien: 'esta solicitud', historial: 'historial_solicitudes', campoHist: 'solicitud_id', comillas: '«' },
];

const guardar = (c, data, opciones) => registry.getModule(c.modulo).hooks.beforeSave(data, {
  user: quien, isNew: true, id: null, existing: null, db, confirmado: false, ...opciones,
});

const meter = (c, nombre, fecha = '2020-04-12') => {
  const id = db.prepare(
    `INSERT INTO "${c.modulo}" ("${c.campo}", iglesia_id, tipo, nombre, fecha, archivo) VALUES (?,?,?,?,?,?)`
  ).run(c.dueno(), iglesia, c.tipo, nombre, fecha, 'papel.txt').lastInsertRowid;
  return db.prepare(`SELECT * FROM "${c.modulo}" WHERE id = ?`).get(id);
};

/** Otro dueño del mismo tipo, para probar que las carpetas no se mezclan. */
const otrosDuenos = {};
const otroDuenoDe = (c) => {
  if (otrosDuenos[c.modulo]) return otrosDuenos[c.modulo];
  if (c.campo === 'iglesia_id') otrosDuenos[c.modulo] = otraIglesia;
  else if (c.campo === 'pastor_id') {
    otrosDuenos[c.modulo] = db.prepare("INSERT INTO pastores (nombres, apellidos, iglesia_id, estado) VALUES ('Otro','Pastor de las Carpetas',?,'Activo')")
      .run(otraIglesia).lastInsertRowid;
  } else {
    otrosDuenos[c.modulo] = db.prepare(
      "INSERT INTO solicitudes (iglesia_id, solicitante_tipo, tipo, asunto, fecha, estado)"
      + " VALUES (?,'Miembro','Otro','Otra solicitud','2026-08-02','Pendiente')"
    ).run(iglesia).lastInsertRowid;
  }
  return otrosDuenos[c.modulo];
};

const suHistorial = (c) => db
  .prepare(`SELECT descripcion, fecha, tipo FROM "${c.historial}" WHERE "${c.campoHist}" = ? ORDER BY id`)
  .all(c.dueno());

/* ------------------------------- la pregunta, una sola vez */

test('la pregunta del papel repetido vive en un solo lugar', () => {
  assert.equal(typeof carpetas.preguntaSiSeRepite, 'function');
  for (const modulo of ['documentos_miembros', 'documentos_iglesias', 'documentos_pastores', 'documentos_solicitudes']) {
    const src = fs.readFileSync(path.join(__dirname, `../../server/modules/${modulo}.js`), 'utf8');
    assert.match(src, /carpetas\.preguntaSiSeRepite\(\{/, `${modulo} no la usa`);
    assert.doesNotMatch(src, /function elQueYaEstaba/,
      `${modulo} tiene su propia copia: escrita cuatro veces, un día una compara distinto`);
  }
});

test('cada carpeta pregunta por lo suyo y con su propio nombre', () => {
  for (const c of CARPETAS) {
    const src = fs.readFileSync(path.join(__dirname, `../../server/modules/${c.modulo}.js`), 'utf8');
    assert.match(src, new RegExp(`tabla: '${c.modulo}'`));
    assert.match(src, new RegExp(`campoDueno: '${c.campo}'`));
    assert.match(src, new RegExp(`deQuien: '${c.deQuien}'`));
  }
});

for (const c of CARPETAS) {
  test(`${c.modulo}: el mismo papel otra vez se pregunta`, () => {
    meter(c, 'Papel que ya estaba');
    const aviso = guardar(c, { [c.campo]: c.dueno(), tipo: c.tipo, nombre: 'papel  QUE ya ESTABA' });
    assert.ok(aviso, 'no dijo nada');
    assert.equal(aviso.confirmar, 'documento_ya_en_la_carpeta');
    assert.match(aviso.error, new RegExp(`en la carpeta de ${c.deQuien}`));
    assert.match(aviso.error, /del 12-04-2020/, 'con qué distinguir el que ya está');
  });

  test(`${c.modulo}: confirmando pasa, y lo distinto no molesta`, () => {
    assert.equal(guardar(c, { [c.campo]: c.dueno(), tipo: c.tipo, nombre: 'Papel que ya estaba' },
      { confirmado: true }), null);
    assert.equal(guardar(c, { [c.campo]: c.dueno(), tipo: c.tipo, nombre: 'Un papel bien distinto' }), null);
  });

  test(`${c.modulo}: el mismo papel de OTRO dueño no tiene nada que ver`, () => {
    /*
     * Esta prueba se agregó porque una rotura no cayó en nada: sacar el
     * «WHERE dueño = ?» de la consulta no ponía roja ninguna, y sin embargo
     * con eso el papel de una iglesia haría preguntar por el de otra. Faltaba
     * el escenario con dos dueños en la misma tabla.
     */
    const suyo = meter(c, 'Papel que comparten dos carpetas');
    const otro = otroDuenoDe(c);
    const aviso = guardar(c, { [c.campo]: otro, tipo: c.tipo, nombre: 'Papel que comparten dos carpetas' });
    assert.equal(aviso, null, `preguntó por el papel de otro: ${aviso && aviso.error}`);
    // y con el dueño de verdad sí pregunta, para que la prueba no pase por vacía
    assert.ok(guardar(c, { [c.campo]: c.dueno(), tipo: c.tipo, nombre: 'Papel que comparten dos carpetas' }));
    db.prepare(`DELETE FROM "${c.modulo}" WHERE id = ?`).run(suyo.id);
  });

  test(`${c.modulo}: quitar un papel deja su línea en el historial de su dueño`, () => {
    const suyo = meter(c, `Papel que se va de ${c.modulo}`, '2021-06-06');
    const antes = suHistorial(c).length;
    db.prepare(`DELETE FROM "${c.modulo}" WHERE id = ?`).run(suyo.id);
    bitacora.registrarEliminado(registry.getModule(c.modulo), suyo, quien, null);
    const lineas = suHistorial(c);
    assert.equal(lineas.length, antes + 1, 'antes se quedaba igual');
    const ultima = lineas[lineas.length - 1];
    assert.match(ultima.descripcion, new RegExp(`^Se quitó ${c.comillas === '«' ? '«' : '"'}Papel que se va`),
      'con las comillas de su propio «se adjuntó», para que las dos se lean juntas');
    assert.match(ultima.descripcion, /del 06-06-2021/, 'de cuándo era el papel');
    assert.match(ultima.descripcion, /de su carpeta\.$/);
    assert.equal(ultima.fecha, HOY, 'y con la fecha de hoy, no la del papel');
  });
}

test('la carpeta de cada uno escribe solo en el historial de su dueño', () => {
  const deOtra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Sur de las carpetas','IG-CAR3','Activa')")
    .run().lastInsertRowid;
  const antes = db.prepare('SELECT count(*) c FROM historial_iglesias WHERE iglesia_id = ?').get(deOtra).c;
  const suyo = meter(CARPETAS[0], 'Papel de la Central, no de la Sur');
  db.prepare('DELETE FROM documentos_iglesias WHERE id = ?').run(suyo.id);
  bitacora.registrarEliminado(registry.getModule('documentos_iglesias'), suyo, quien, null);
  assert.equal(db.prepare('SELECT count(*) c FROM historial_iglesias WHERE iglesia_id = ?').get(deOtra).c, antes);
  assert.ok(otraIglesia, 'la otra iglesia del escenario sigue ahí');
});

test('y no se escribe en el seguimiento de una solicitud que ya no existe', () => {
  /*
   * Cuando se borra la solicitud entera, sus antecedentes se van con ella: el
   * motor anota el borrado de la solicitud con lo que se llevó consigo, no una
   * línea por papel. Si llegara igual, no habría dónde escribirla.
   */
  const suya = db.prepare(
    "INSERT INTO solicitudes (iglesia_id, solicitante_tipo, tipo, asunto, fecha, estado)"
    + " VALUES (?,'Miembro','Otro','La que se va','2026-08-01','Pendiente')"
  ).run(iglesia).lastInsertRowid;
  const papel = db.prepare(
    'INSERT INTO documentos_solicitudes (solicitud_id, iglesia_id, tipo, nombre, fecha, archivo)'
    + " VALUES (?,?,'Antecedente','Antecedente huérfano','2020-04-12','x.txt')"
  ).run(suya, iglesia).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM documentos_solicitudes WHERE id = ?').get(papel);
  db.prepare('DELETE FROM solicitudes WHERE id = ?').run(suya);
  db.prepare('DELETE FROM documentos_solicitudes WHERE id = ?').run(papel);
  bitacora.registrarEliminado(registry.getModule('documentos_solicitudes'), fila, quien, null);
  assert.equal(
    db.prepare('SELECT count(*) c FROM historial_solicitudes WHERE solicitud_id = ?').get(suya).c, 0
  );
});

test('el Registro de Cambios sigue anotando las cuatro bajas', () => {
  const antes = db.prepare("SELECT count(*) c FROM registro_cambios WHERE accion = 'Eliminación'").get().c;
  for (const c of CARPETAS) {
    const suyo = meter(c, `Papel para el registro de ${c.modulo}`);
    db.prepare(`DELETE FROM "${c.modulo}" WHERE id = ?`).run(suyo.id);
    bitacora.registrarEliminado(registry.getModule(c.modulo), suyo, quien, null);
  }
  assert.equal(db.prepare("SELECT count(*) c FROM registro_cambios WHERE accion = 'Eliminación'").get().c,
    antes + CARPETAS.length, 'el libro del sistema no perdió nada con esto');
});

/* ------------------------------- las hojas impresas */

test('la hoja de una iglesia y la de un pastor llevan su historial y su carpeta', () => {
  assert.match(app, /const HISTORIAL_EN_LA_HOJA = \['miembros', 'iglesias', 'pastores'\];/);
  assert.match(app, /const DOCUMENTOS_EN_LA_HOJA = \['miembros', 'iglesias', 'pastores'\];/);
});

test('y las dos salen del mismo mapa que usan las pestañas', () => {
  // Si se escribiera el módulo y el campo otra vez, un día dirían cosas distintas
  assert.match(app, /HISTORIAL_EN_LA_HOJA\.includes\(name\) \? PANEL_HISTORIAL\[name\] : null/);
  assert.match(app, /DOCUMENTOS_EN_LA_HOJA\.includes\(name\) \? PANEL_DOCUMENTOS\[name\] : null/);
  for (const quienEs of ['iglesias', 'pastores']) {
    assert.match(app, new RegExp(`${quienEs}: \\{ modulo: 'documentos_${quienEs}'`));
    assert.match(app, new RegExp(`${quienEs}: \\{ modulo: 'historial_${quienEs}'`));
  }
});

test('la solicitud no entra en esas listas, porque tiene su propia hoja', () => {
  assert.doesNotMatch(app, /const HISTORIAL_EN_LA_HOJA = \[[^\]]*solicitudes/);
  assert.doesNotMatch(app, /const DOCUMENTOS_EN_LA_HOJA = \[[^\]]*solicitudes/);
  assert.match(app, /if \(name === 'solicitudes'\) sheet = printSolicitud\(/);
});

test('la columna de vencimiento sale solo cuando alguno vence', () => {
  /*
   * La carpeta de un miembro tiene esa fecha desde la 1.200.0; la de una
   * iglesia y la de un pastor no la tienen, así que en sus hojas la columna
   * saldría entera con rayas. Medido: la hoja de una iglesia y la de un pastor
   * salen con cuatro columnas, la de un miembro con carnet, con cinco.
   */
  assert.match(app, /const algunoVence = papeles\.some\(\(d\) => d\.vence\);/);
  assert.match(app, /\$\{algunoVence\s*\n?\s*\? '<th>Vence<\/th>' : ''\}/);
  assert.match(app, /\$\{algunoVence \? `<td class="nowrap">\$\{d\.vence/);
  for (const nombre of ['documentos_iglesias', 'documentos_pastores', 'documentos_solicitudes']) {
    assert.ok(!registry.getModule(nombre).fields.some((f) => f.name === 'vence'),
      `${nombre} no declara vencimiento: por eso la columna tiene que poder faltar`);
  }
});
