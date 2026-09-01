/**
 * Borrar un acta: la pregunta que no se hacía, y lo que no quedaba de ella.
 *
 * Son dos huecos de la misma forma. Medido en la v1.272.0, sobre un acta
 * FIRMADA con su agenda, su desarrollo, sus acuerdos y su escaneo adentro:
 *
 *   DELETE, sin confirmar ................... 200, borrada
 *   ¿preguntó algo el servidor? ............. no
 *   lo que guardó el Registro de Cambios .... Número · Fecha · Cuerpo · Iglesia · Preside · Estado
 *   ¿guardó la agenda, el desarrollo o los acuerdos? ... no
 *
 * La única barrera era el «¿está seguro?» genérico del navegador, el mismo que
 * aparece al borrar una categoría de tesorería vacía. Y el escaneo se va con la
 * ficha —eso está bien hecho—, así que un clic de más se llevaba el acta
 * firmada y su documento sin decir qué se estaba llevando.
 *
 * Lo segundo no era propio de este módulo: el resumen de una eliminación se
 * armaba con los campos del LISTADO, que es una lista pensada para que quepa en
 * columnas. Para casi todos alcanza; para un libro de actas no, porque lo que
 * hay que conservar es justamente lo que no cabe en una columna. Ahora un
 * módulo puede nombrar en `camposAlBorrar` lo que quiere que sobreviva.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unCuerpo() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `BOR${m}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Damas ${m}`, iglesia).lastInsertRowid;
  return { m, iglesia, cuerpo };
}

/** Un acta escrita entera, que es el caso en que borrar duele. */
const unActaEscrita = (api, e, cambios) => api('POST', '/actas_reuniones', {
  numero_acta: `${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-03-15', cuerpo_id: e.cuerpo, lugar: 'Salón parroquial',
  presidida_por: 'Juan Pérez', secretario: 'Ana Soto',
  agenda: '1. Presupuesto anual\n2. Aniversario',
  desarrollo: '<p>Se discutió largamente el presupuesto.</p>',
  acuerdos: '<p>Se aprueba comprar sillas por $9.000.000.</p>', ...cambios,
});

/** La constancia que el Registro de Cambios dejó de esa eliminación. */
function laConstancia(numero) {
  const fila = db.prepare(
    `SELECT detalle FROM registro_cambios
      WHERE modulo = 'Actas de Reuniones' AND accion = 'Eliminación' AND registro LIKE ?
      ORDER BY id DESC LIMIT 1`
  ).get(`%${numero}%`);
  return fila ? fila.detalle : null;
}

// ------------------------------------------------ AR-03 · la pregunta ----

test('borrar un acta escrita pregunta antes, y no borra nada mientras tanto', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);

  const r = await api('DELETE', `/actas_reuniones/${a.json.id}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_que_se_borra');
  assert.ok(db.prepare('SELECT id FROM actas_reuniones WHERE id = ?').get(a.json.id),
    'la pregunta no borra: la ficha sigue ahí hasta que alguien conteste');
});

test('la pregunta dice de qué acta se trata y qué trae adentro', async () => {
  /*
   * «¿Está seguro?» a secas no es información. La pregunta tiene que permitir
   * contestarla sin ir a mirar la ficha que está por desaparecer.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);
  const r = await api('DELETE', `/actas_reuniones/${a.json.id}`);

  assert.match(r.json.error, /15-03-2026/, 'la fecha, como se lee');
  assert.match(r.json.error, /Damas/, 'de qué cuerpo es');
  assert.match(r.json.error, /su agenda/);
  assert.match(r.json.error, /el desarrollo escrito/);
  assert.match(r.json.error, /los acuerdos/);
  assert.match(r.json.error, /Registro de Cambios/,
    'y dice dónde queda lo que el acta decía, que es lo único que esta pregunta sabe y '
    + 'el «¿está seguro?» del navegador no');
});

test('un acta firmada lo dice, con quién la firmó', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e, { estado: 'Firmada' });
  const r = await api('DELETE', `/actas_reuniones/${a.json.id}`);
  assert.match(r.json.error, /FIRMADA/, 'es el dato que hace pensar dos veces');
  assert.match(r.json.error, new RegExp(db.prepare('SELECT firmada_por AS q FROM actas_reuniones WHERE id = ?')
    .get(a.json.id).q));
});

test('un acta vacía también pregunta, pero dice que no trae nada', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: `vacia ${e.m}`, fecha: '2026-03-15', cuerpo_id: e.cuerpo,
  });
  const r = await api('DELETE', `/actas_reuniones/${a.json.id}`);
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /No tiene nada escrito ni adjunto/,
    'no es lo mismo botar una ficha en blanco que un acta firmada');
});

test('confirmando, se borra', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);
  const r = await api('DELETE', `/actas_reuniones/${a.json.id}?igual_asi=true`);
  assert.equal(r.estado, 200);
  assert.ok(!db.prepare('SELECT id FROM actas_reuniones WHERE id = ?').get(a.json.id));
});

// --------------------------------------- AR-04 · lo que queda de ella ----

test('la constancia del borrado guarda lo que el acta decía', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e, { estado: 'Firmada' });
  const numero = a.json.numero_acta;
  await api('DELETE', `/actas_reuniones/${a.json.id}?igual_asi=true`);

  const dice = laConstancia(numero);
  assert.ok(dice, 'la eliminación queda anotada');
  assert.match(dice, /Presupuesto anual/, 'la agenda');
  assert.match(dice, /largamente/, 'el desarrollo');
  assert.match(dice, /9\.000\.000/, 'los acuerdos, que es lo que de verdad importa');
  assert.match(dice, /Salón parroquial/, 'y dónde fue');
});

test('y sigue diciendo de qué acta se trataba', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);
  const numero = a.json.numero_acta;
  await api('DELETE', `/actas_reuniones/${a.json.id}?igual_asi=true`);

  const dice = laConstancia(numero);
  assert.match(dice, new RegExp(numero), 'el número');
  assert.match(dice, /Damas/, 'el cuerpo');
  assert.match(dice, /15-03-2026/, 'la fecha');
  const primero = dice.indexOf('Número de acta');
  assert.ok(primero >= 0 && primero < dice.indexOf('Agenda'),
    'primero de qué ficha se trata, después qué decía');
});

test('el nombre del adjunto queda, aunque el archivo se haya ido', async () => {
  /*
   * Los archivos no entran solos en estos resúmenes, y con razón: el nombre de
   * un adjunto no dice nada en una tabla. Pero cuando el archivo se borró CON
   * la ficha —y se borra, ver server/crud.js—, su nombre es lo único que puede
   * quedar de él, así que un módulo que lo pide expresamente lo obtiene.
   *
   * El adjunto se pone por detrás en vez de subir un archivo de verdad: lo que
   * se prueba es qué conserva el borrado, no la subida.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);
  const numero = a.json.numero_acta;
  db.prepare("UPDATE actas_reuniones SET documento = 'acta-firmada.pdf' WHERE id = ?").run(a.json.id);

  await api('DELETE', `/actas_reuniones/${a.json.id}?igual_asi=true`);
  assert.match(laConstancia(numero), /acta-firmada\.pdf/);
});

test('y la pregunta avisa de que el escaneo se va con ella', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);
  db.prepare("UPDATE actas_reuniones SET documento = 'acta-firmada.pdf' WHERE id = ?").run(a.json.id);

  const r = await api('DELETE', `/actas_reuniones/${a.json.id}`);
  assert.match(r.json.error, /el documento escaneado/);
  assert.match(r.json.error, /se borra del servidor/);
});

test('la línea de la CREACIÓN no se llena con el acta entera', async () => {
  /*
   * La misma función arma el resumen de la creación y el del borrado, así que
   * al agregar `camposAlBorrar` la creación empezó a copiar el acta completa.
   * Ahí sobra: la ficha existe, se abre y se lee. Es la ÚNICA copia lo que hay
   * que guardar, no cualquier copia. Se vio depurando, no en una prueba.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActaEscrita(api, e);

  const alCrear = db.prepare(
    `SELECT detalle FROM registro_cambios
      WHERE modulo = 'Actas de Reuniones' AND accion = 'Creación' AND registro LIKE ?
      ORDER BY id DESC LIMIT 1`
  ).get(`%${a.json.numero_acta}%`);
  assert.ok(alCrear, 'la creación se sigue anotando');
  assert.match(alCrear.detalle, new RegExp(a.json.numero_acta), 'con su cabecera de siempre');
  assert.ok(!/Presupuesto anual/.test(alCrear.detalle), 'y sin la agenda');
  assert.ok(!/9\.000\.000/.test(alCrear.detalle), 'ni los acuerdos');
});

test('los campos que se conservan son campos que el módulo tiene', () => {
  /*
   * Una lista de nombres escritos a mano se despega del módulo en silencio: si
   * mañana un campo se renombra, `camposAlBorrar` sigue nombrando al viejo y
   * deja de guardarse sin que nada falle.
   */
  const def = getModule('actas_reuniones');
  for (const nombre of def.camposAlBorrar || []) {
    assert.ok(def.fields.some((f) => f.name === nombre), `«${nombre}» ya no es un campo del acta`);
  }
  for (const cual of ['agenda', 'desarrollo', 'acuerdos', 'documento']) {
    assert.ok((def.camposAlBorrar || []).includes(cual), `falta conservar «${cual}»`);
  }
});

test('un módulo que no pide nada se sigue comportando como antes', async () => {
  /*
   * `camposAlBorrar` es opcional y el motor lo usan cuarenta módulos: el que no
   * lo declara tiene que seguir guardando exactamente sus campos de listado, ni
   * más ni menos. Se comprueba sobre una directiva, que no lo declara y sí
   * tiene su propio borrado con pregunta.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  assert.ok(!getModule('directivas').camposAlBorrar, 'directivas no lo declara');

  const d = await api('POST', '/directivas', {
    cuerpo_id: e.cuerpo, periodo: `p ${e.m}`, fecha_inicio: '2020-01-01',
    fecha_termino: '2021-12-31', estado: 'Finalizada', otros_cargos: 'Directora de música: Ana Soto',
    igual_asi: true, // una directiva sin cargos pregunta desde la 1.258.0
  });
  assert.equal(d.estado, 201);
  await api('DELETE', `/directivas/${d.json.id}?igual_asi=true`);

  const dice = db.prepare(
    `SELECT detalle FROM registro_cambios
      WHERE modulo = 'Directivas de Cuerpos' AND accion = 'Eliminación' AND registro LIKE ?
      ORDER BY id DESC LIMIT 1`
  ).get(`%p ${e.m}%`);
  assert.ok(dice, 'sigue quedando anotada');
  assert.match(dice.detalle, new RegExp(`p ${e.m}`), 'con lo suyo de siempre');
  assert.ok(!/Ana Soto/.test(dice.detalle),
    'y sin nada de más: «Otros cargos» no está en su listado y no se agregó solo');
});
