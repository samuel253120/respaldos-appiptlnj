/**
 * LA FAMILIA, COMO VÍNCULO Y NO COMO TEXTO ESCRITO A MANO.
 *
 * El único parentesco que el sistema entendía era el matrimonio. Del adulto
 * responsable de un menor se guardaba el NOMBRE ESCRITO, no un enlace a su
 * ficha, y eso costaba:
 *
 *   · una madre con tres hijos quedaba tecleada tres veces, con su RUT
 *     tecleado tres veces
 *   · si cambiaba de teléfono había que corregirlo en cuatro fichas
 *   · no se podía pedir «el grupo familiar de los González» para una visita
 *   · ni saber de un niño quién lo viene a buscar sin abrir su ficha y leerla
 *
 * Ahora el adulto se ELIGE de la membresía cuando está registrado, y se
 * escribe a mano solo cuando no lo está. Elegido, sus datos se leen de su
 * ficha: no se guardan dos veces, porque guardarlos dos veces es garantizar
 * que un día digan cosas distintas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');
const pendientes = require('../../server/pendientes');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las familias', 'IG-FAM', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('La de al lado', 'IG-FAM2', 'Activa')")
  .run().lastInsertRowid;

const naceHace = (anios) => db.prepare("SELECT date('now','localtime',?) d").get(`-${anios} years`).d;

let n = 0;
function alguien(anios, extra = {}) {
  n++;
  const info = db
    .prepare(
      `INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, fecha_nacimiento, rut, telefono,
                             responsable_id, responsable_nombre, responsable_rut, responsable_telefono,
                             responsable_parentesco)
       VALUES (?, ?, ?, 'Activo', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      extra.nombres || `Fam${n}`, extra.apellidos || `Delacasa${n}`,
      extra.iglesia || iglesia, anios === null ? null : naceHace(anios),
      extra.rut || null, extra.telefono || null,
      extra.responsable_id || null, extra.responsable_nombre || null,
      extra.responsable_rut || null, extra.responsable_telefono || null,
      extra.parentesco || null
    );
  return info.lastInsertRowid;
}

const fila = (id) => db.prepare('SELECT * FROM miembros WHERE id = ?').get(id);
const guardar = (datos, id) => miembros.hooks.beforeSave(datos, {
  id: id || null, existing: id ? fila(id) : null, db, confirmado: true,
});
/** El campo calculado, tal como lo ve quien abre la ficha. */
const responsableDe = (id) => miembros.computed.find((c) => c.name === 'responsable').calc(fila(id), { db });

// ------------------------- se elige, no se teclea --------------------------

test('la ficha del menor dice quién responde por él, leído de su ficha', () => {
  const madre = alguien(41, { nombres: 'Marisol Fam', apellidos: 'Painemal Huenchul',
    rut: '19.555.666-0', telefono: '+56955554444' });
  const hijo = alguien(9, { responsable_id: madre, parentesco: 'Madre' });

  assert.match(responsableDe(hijo), /Marisol Fam Painemal Huenchul/);
  assert.match(responsableDe(hijo), /19\.555\.666-0/, 'con su RUT, para poder identificarla');
  assert.match(responsableDe(hijo), /\+56955554444/, 'y su teléfono, que es para lo que se anota');
});

test('sus datos NO se copian a la ficha del menor', () => {
  const madre = alguien(41, { nombres: 'Berenice Fam', apellidos: 'Curiqueo Antileo', telefono: '+56911110000' });
  const datos = { responsable_id: madre, responsable_nombre: 'Escrito a mano', responsable_rut: '11111111-1',
    responsable_telefono: '+56900000000', responsable_parentesco: 'Madre' };
  assert.equal(guardar(datos), null);

  assert.equal(datos.responsable_nombre, null, 'guardarlo dos veces es garantizar que un día digan cosas distintas');
  assert.equal(datos.responsable_rut, null);
  assert.equal(datos.responsable_telefono, null);
  assert.equal(datos.responsable_parentesco, 'Madre', 'el parentesco NO es un dato de ella: es del vínculo');
});

test('si la madre cambia de teléfono, no hay que tocar la ficha de nadie más', () => {
  const madre = alguien(41, { nombres: 'Herminda Fam', apellidos: 'Llanquileo Paillán', telefono: '+56911112222' });
  const hijos = [alguien(9, { responsable_id: madre }), alguien(13, { responsable_id: madre }), alguien(16, { responsable_id: madre })];

  db.prepare('UPDATE miembros SET telefono = ? WHERE id = ?').run('+56933334444', madre);
  for (const h of hijos) {
    assert.match(responsableDe(h), /\+56933334444/, 'la ficha del hijo tiene que decir el teléfono de hoy');
  }
});

test('a quien no está en la membresía se le sigue escribiendo a mano', () => {
  const suelto = alguien(8, { responsable_nombre: 'Una Vecina Que No Está', responsable_telefono: '+56999998888' });
  assert.equal(responsableDe(suelto), 'Una Vecina Que No Está',
    'el enlace es una comodidad, no un requisito: hay quien no está registrado');
});

test('y si la ficha elegida ya no está, se cae al nombre escrito', () => {
  const quien = alguien(8, { responsable_id: 999999, responsable_nombre: 'El de respaldo' });
  assert.equal(responsableDe(quien), 'El de respaldo');
});

test('sin nadie anotado, no se inventa una respuesta', () => {
  assert.equal(responsableDe(alguien(8)), '');
});

// ---------------------------- lo que no se permite -------------------------

test('nadie responde por sí mismo', () => {
  const quien = alguien(9);
  assert.match(String(guardar({ responsable_id: quien }, quien)), /su propio adulto responsable/);
});

test('ni una ficha que no existe', () => {
  assert.match(String(guardar({ responsable_id: 999999, iglesia_id: iglesia })), /no está en Miembros/);
});

test('ni alguien de otra iglesia', () => {
  const deAlla = alguien(40, { iglesia: otraIglesia, nombres: 'Ajena Fam', apellidos: 'De Otra' });
  const problema = guardar({ responsable_id: deAlla, iglesia_id: iglesia });
  assert.match(String(problema), /otra iglesia/);
  assert.match(String(problema), /Ajena Fam De Otra/, 'dice de quién se trata, no solo que no');
});

test('pero un hermano de diecisiete SÍ se puede anotar', () => {
  /*
   * Exigir que el responsable sea mayor de edad no protege a nadie: el hermano
   * de diecisiete que trae a la menor a las actividades es la persona a la que
   * hay que llamar. Se anota y listo.
   */
  const hermano = alguien(17, { nombres: 'Nahuel Fam', apellidos: 'Millaqueo Raín' });
  assert.equal(guardar({ responsable_id: hermano, iglesia_id: iglesia }), null);
});

// ------------------------------- la vuelta ---------------------------------

test('la ficha del adulto dice de qué menores responde', () => {
  const madre = alguien(41, { nombres: 'Filomena Fam', apellidos: 'Nahuelpán Cheuquián' });
  const pedro = alguien(9, { nombres: 'Pedro Fam', responsable_id: madre, parentesco: 'Madre' });
  const ana = alguien(13, { nombres: 'Ana Fam', responsable_id: madre, parentesco: 'Madre' });

  const suyos = db.prepare('SELECT id FROM miembros WHERE responsable_id = ?').all(madre).map((r) => r.id);
  assert.deepEqual(suyos.sort(), [pedro, ana].sort(),
    'sin la vuelta, el vínculo se ve desde un solo lado y no sirve para lo que se quería');
});

test('el que ya cumplió 18 se marca como tal, pero no se borra', () => {
  const ruta = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/miembros.js'), 'utf8'
  );
  assert.match(ruta, /ya_es_mayor/,
    'el vínculo es parte de su historia: se queda escrito, pero deja de ser una responsabilidad vigente');
  assert.match(ruta, /a-cargo/);
});

// --------------------- borrar al adulto no deja a nadie solo ---------------

test('si se borra la ficha del adulto, el menor no queda sin nadie anotado', () => {
  const madre = alguien(41, { nombres: 'Teodolinda Fam', apellidos: 'Huircapán Loncón',
    rut: '18.222.333-1', telefono: '+56977776666' });
  const hijo = alguien(9, { responsable_id: madre, parentesco: 'Madre' });

  miembros.hooks.beforeDelete(fila(madre), { db });
  db.prepare('DELETE FROM miembros WHERE id = ?').run(madre);

  const quedo = fila(hijo);
  assert.equal(quedo.responsable_id, null, 'no puede quedar apuntando a una ficha que ya no está');
  assert.equal(quedo.responsable_nombre, 'Teodolinda Fam Huircapán Loncón',
    'soltar el vínculo a secas dejaría a un menor sin nadie anotado, que es justo lo que hay que poder responder');
  assert.equal(quedo.responsable_rut, '18.222.333-1');
  assert.equal(quedo.responsable_telefono, '+56977776666');
  assert.equal(quedo.responsable_parentesco, 'Madre', 'y el parentesco se queda como estaba');
});

test('y si ya tenía un nombre escrito, ese no se pisa', () => {
  const abuela = alguien(70, { nombres: 'Ondina Fam', apellidos: 'Trafipán Cañumir' });
  const nieto = alguien(9, { responsable_id: abuela, responsable_nombre: null });
  db.prepare("UPDATE miembros SET responsable_nombre = 'Lo que alguien escribió' WHERE id = ?").run(nieto);

  miembros.hooks.beforeDelete(fila(abuela), { db });
  assert.equal(fila(nieto).responsable_nombre, 'Lo que alguien escribió');
});

// ----------------- lo que el panel cuenta como «le falta» ------------------

test('un menor con su adulto ELEGIDO ya no cuenta como sin responsable', () => {
  /*
   * El panel avisa de los menores sin adulto responsable, y miraba solo el
   * nombre escrito: a todo menor con su adulto elegido de la membresía se le
   * seguía contando como si no tuviera a nadie.
   */
  const antes = pendientes.resumen({ rol: 'admin' }).menoresSinResponsable;
  const madre = alguien(41, { nombres: 'Casimira Fam', apellidos: 'Antipán Colipán' });
  alguien(9, { responsable_id: madre });
  assert.equal(pendientes.resumen({ rol: 'admin' }).menoresSinResponsable, antes,
    'el menor tiene a quién llamar: no le falta nada');

  alguien(9);
  assert.equal(pendientes.resumen({ rol: 'admin' }).menoresSinResponsable, antes + 1,
    'y a este sí le falta, así que se sigue contando');
});

test('la pantalla mira los dos caminos, no solo el nombre escrito', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /!row\.responsable_nombre && !row\.responsable_id/,
    'el aviso «todavía no está registrado su adulto responsable» le salía a quien sí lo tenía');
  assert.match(app, /sin=responsable_nombre,responsable_id/,
    'y la lista que abre el panel tiene que traer a los que no tienen ninguno de los dos');
  assert.match(app, /function renderMenoresACargo/);
  assert.match(app, /alPie\(renderMenoresACargo, Number\(id\)\)/, 'escrita pero no usada es lo mismo que no escrita');
});
