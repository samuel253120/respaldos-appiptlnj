/**
 * A UN CUERPO DE UNA IGLESIA NO ENTRA GENTE DE OTRA.
 *
 * La regla estaba escrita y se aplicaba a UNA sola de las dos clases de
 * persona: a la del registro aparte —«Esa persona está registrada en otra
 * iglesia»— y no al miembro inscrito, que es el caso normal. Medido en la
 * v1.393.0, alguien de la Iglesia Norte a un cuerpo de la Iglesia Central:
 *
 *   no inscrita ... formulario 400 · planilla rechazada
 *   miembro ....... formulario 201 · planilla «correctas: 1»
 *
 * Y la ficha quedaba diciendo que esa persona es de la iglesia del cuerpo, así
 * que contaba como una más: entraba en la lista del cuerpo y en su planilla de
 * cuotas —la iglesia le empezaba a cobrar una cuota mensual a alguien que no es
 * suyo— y, lo peor, la encargada de ese cuerpo veía su nombre y su RUT sin
 * poder abrir su ficha, que le contesta 403.
 *
 * La otra mitad de esta prueba es igual de importante: la comprobación frena el
 * guardado que PROVOCA el cruce, no el que simplemente no lo arregla. Una ficha
 * que ya venía cruzada se tiene que poder seguir guardando para corregirle una
 * nota, que es la regla del motor para todas las comprobaciones de este tipo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const integrantes = getModule('integrantes_cuerpo');
const admin = { id: 1, rol: 'admin' };

const iglesia = (nombre) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`${nombre} CI ${marca}`, `CI${nombre.slice(0, 3)}${marca}`).lastInsertRowid;
const central = iglesia('Central');
const norte = iglesia('Norte');

const cuerpo = (iglesiaId, tipo = 'Cuerpo') => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(`Damas ${tipo} ${++n} CI ${marca}`, tipo, iglesiaId).lastInsertRowid;
let n = 0;
const miembro = (iglesiaId) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(`Quien${++n}`, `Sirve CI ${marca}`, iglesiaId).lastInsertRowid;
const noMiembro = (iglesiaId) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)')
  .run(`Visita${++n}`, `Ayuda CI ${marca}`, iglesiaId).lastInsertRowid;

const alGuardar = (data, existing = null, id = null) => integrantes.hooks.beforeSave(
  { ...data }, { existing, id, db, confirmado: true }
);

// ------------------------------------------------------- el miembro inscrito

test('un miembro de otra iglesia no entra a un cuerpo', () => {
  const suyo = cuerpo(central);
  const forastero = miembro(norte);
  const aviso = alGuardar({
    cuerpo_id: suyo, persona_tipo: 'Miembro', miembro_id: forastero,
    fecha_ingreso: '2026-03-01', estado: 'Activo',
  });
  assert.equal(typeof aviso, 'string', 'tiene que rechazarse, no preguntarse');
  assert.match(aviso, /Cada iglesia lleva los suyos/);
  assert.match(aviso, /Norte CI/, 'y decir en cuál figura la persona');
  assert.match(aviso, /Central CI/, 'y de cuál es el cuerpo');
});

test('y uno de la misma iglesia entra sin decir nada', () => {
  const suyo = cuerpo(central);
  assert.equal(alGuardar({
    cuerpo_id: suyo, persona_tipo: 'Miembro', miembro_id: miembro(central),
    fecha_ingreso: '2026-03-01', estado: 'Activo',
  }), null);
});

test('la persona no inscrita, que ya se comprobaba, se sigue comprobando', () => {
  const grupo = cuerpo(central, 'Grupo');
  const aviso = alGuardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: noMiembro(norte),
    fecha_ingreso: '2026-03-01', estado: 'Activo',
  });
  assert.match(String(aviso), /Cada iglesia lleva los suyos/);
  assert.equal(alGuardar({
    cuerpo_id: grupo, persona_tipo: 'No miembro', no_miembro_id: noMiembro(central),
    fecha_ingreso: '2026-03-01', estado: 'Activo',
  }), null, 'y la del propio grupo entra');
});

// ------------------------------- lo que ya venía cruzado se sigue corrigiendo

test('una ficha que YA venía cruzada se puede seguir guardando', () => {
  const suyo = cuerpo(central);
  const forastero = miembro(norte);
  // se mete a mano, como si viniera de una carga vieja
  const vieja = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', 'De Antes', 'Activo', '2024-01-05', ?)`
  ).run(suyo, forastero, central).lastInsertRowid;
  const guardada = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(vieja);

  assert.equal(alGuardar({ observaciones: 'una nota cualquiera' }, guardada, vieja), null,
    'corregirle una nota no empeora nada, y tiene que poder hacerse');

  const mudarla = alGuardar({ cuerpo_id: cuerpo(central) }, guardada, vieja);
  assert.match(String(mudarla), /Cada iglesia lleva los suyos/,
    'pero mudarla a otro cuerpo de esta iglesia sí es armar el cruce de nuevo');

  assert.equal(alGuardar({ miembro_id: miembro(central) }, guardada, vieja), null,
    'y cambiarle la persona por una de la iglesia correcta es justamente arreglarlo');
});

// -------------------------------------------------------------- por planilla

test('la planilla contesta lo mismo que el formulario', async () => {
  const api = await elSistemaAndando();
  const suyo = cuerpo(central);
  const forastero = miembro(norte);
  const fila = {
    cuerpo_id: String(suyo), persona_tipo: 'Miembro', miembro_id: String(forastero),
    fecha_ingreso: '01/03/2026', estado: 'Activo',
  };

  const porFormulario = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: suyo, persona_tipo: 'Miembro', miembro_id: forastero,
    fecha_ingreso: '2026-03-01', estado: 'Activo',
  });
  assert.equal(porFormulario.estado, 400, porFormulario.texto.slice(0, 200));

  const { errores } = prepararFila(integrantes, fila, admin);
  assert.equal(errores.length, 1, JSON.stringify(errores));
  assert.equal(errores[0], porFormulario.json.error,
    'las dos puertas tienen que decir exactamente lo mismo');
});
