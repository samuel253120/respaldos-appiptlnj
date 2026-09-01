/**
 * Quién puede dirigir un cuerpo o un grupo.
 *
 * El módulo dice de sí mismo, desde que se escribió, que «a un cuerpo lo dirige
 * un miembro inscrito: es formal, y DE SUS INTEGRANTES SALE SU DIRECTIVA».
 * Nadie comprobaba ninguna de las dos cosas. Medido:
 *
 *   poner de líder a alguien que NO es integrante ..... 200
 *   el cuerpo queda con .................. 0 integrantes y 1 líder
 *   poner de líder a un miembro de OTRA iglesia ....... 200
 *
 * Y con una asimetría al revés de como tenía que ser: al encargado NO INSCRITO
 * de un GRUPO sí se le comprobaba la iglesia. La regla más estricta se le
 * aplicaba al caso más suelto.
 *
 * Ahora la iglesia se FRENA —para los dos registros, con las mismas palabras—
 * y ser integrante se PREGUNTA, porque ahí sí hay casos legítimos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const dirige = require('../../server/quien-dirige-el-cuerpo');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = (como) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`${como} QD ${marca()}`, `QD${marca()}`).lastInsertRowid;
const A = iglesia('Central');
const B = iglesia('Norte');

const cuerpo = ({ tipo = 'Cuerpo', iglesiaId = A } = {}) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual) VALUES (?, ?, ?, 'Activo', 0, 0)")
  .run(`Cuerpo QD ${marca()}`, tipo, iglesiaId).lastInsertRowid;
const fila = (id) => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(id);

const miembro = (iglesiaId = A) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, estado, iglesia_id) VALUES ('Persona', ?, 'Activo', ?)")
  .run(`QD ${marca()}`, iglesiaId).lastInsertRowid;
const noMiembro = (iglesiaId = A) => db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Suelto', ?, ?)")
  .run(`QD ${marca()}`, iglesiaId).lastInsertRowid;

const meter = (cuerpoId, tipo, personaId, estado = 'Activo') => db
  .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, ${tipo === 'Miembro' ? 'miembro_id' : 'no_miembro_id'}, iglesia_id, fecha_ingreso, estado)
            VALUES (?, ?, ?, ?, '2026-01-05', ?)`)
  .run(cuerpoId, tipo, personaId, A, estado).lastInsertRowid;

const alGuardar = (id, data, confirmado = false) => getModule('cuerpos').hooks.beforeSave(
  data, { id, existing: fila(id), isNew: false, db, confirmado }
);

// -------------------------------------------------- la iglesia se frena ----

test('un miembro de OTRA iglesia no puede dirigir el cuerpo', () => {
  const cu = cuerpo();
  const aviso = alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(B) });
  assert.equal(typeof aviso, 'string', 'es un rechazo, no una pregunta: no hay caso legítimo');
  assert.equal(aviso, 'Esa persona está registrada en otra iglesia. Cada iglesia lleva a los suyos.');
});

test('y no se pasa contestando que sí', () => {
  const cu = cuerpo();
  assert.equal(typeof alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(B) }, true), 'string');
});

test('el encargado no inscrito de un grupo se frena con LAS MISMAS PALABRAS', () => {
  /*
   * Ésa era la única mitad que ya se comprobaba. Lo que cambió es que ahora la
   * otra también, y que las dos lo dicen igual: es la misma regla, y decirla
   * distinto haría parecer que son dos.
   */
  const gr = cuerpo({ tipo: 'Grupo' });
  const deGrupo = alGuardar(gr, { lider_tipo: 'No miembro', lider_no_miembro_id: noMiembro(B) });
  const deCuerpo = alGuardar(cuerpo(), { lider_tipo: 'Miembro', lider_id: miembro(B) });
  assert.equal(deGrupo, deCuerpo);
});

test('el de la misma iglesia entra', () => {
  const cu = cuerpo();
  const m = miembro(A);
  meter(cu, 'Miembro', m);
  assert.equal(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: m }), null);
});

test('y uno sin iglesia anotada no se frena: no contradice nada', () => {
  const cu = cuerpo();
  const suelto = db
    .prepare("INSERT INTO miembros (nombres, apellidos, estado) VALUES ('Sin', ?, 'Activo')")
    .run(`Iglesia QD ${marca()}`).lastInsertRowid;
  const aviso = alGuardar(cu, { lider_tipo: 'Miembro', lider_id: suelto });
  assert.notEqual(typeof aviso, 'string', 'no lo frena la iglesia');
});

// -------------------------------------------- ser integrante se pregunta ----

test('quien no es integrante del cuerpo se pregunta, no se frena', () => {
  const cu = cuerpo();
  const aviso = alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(A) });
  assert.equal(aviso && aviso.confirmar, 'quien_lo_dirige_no_es_integrante');
  assert.match(aviso.error, /no figura entre los integrantes de este cuerpo, que hoy no tiene ninguno/);
  assert.match(aviso.error, /De los integrantes de un cuerpo sale su directiva/);
  assert.match(aviso.error, /agréguelo primero a los integrantes del cuerpo/i);
});

test('y el aviso dice cuántos integrantes tiene hoy', () => {
  const cu = cuerpo();
  meter(cu, 'Miembro', miembro(A));
  meter(cu, 'Miembro', miembro(A), 'En prueba');
  meter(cu, 'Miembro', miembro(A), 'Retirado');
  const aviso = alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(A) });
  assert.match(aviso.error, /que hoy tiene 2\./, 'los que pertenecen HOY: al retirado no se le cuenta');
});

test('quien SÍ es integrante no pregunta nada', () => {
  const cu = cuerpo();
  const m = miembro(A);
  meter(cu, 'Miembro', m);
  assert.equal(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: m }), null);
});

test('y quien está EN PRUEBA también cuenta como integrante', () => {
  const cu = cuerpo();
  const m = miembro(A);
  meter(cu, 'Miembro', m, 'En prueba');
  assert.equal(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: m }), null,
    'pertenece hoy al cuerpo, que es la misma definición que usa todo el resto del sistema');
});

test('pero quien se RETIRÓ, no', () => {
  const cu = cuerpo();
  const m = miembro(A);
  meter(cu, 'Miembro', m, 'Retirado');
  assert.ok(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: m }));
});

test('contestando que sí, se guarda', () => {
  const cu = cuerpo();
  assert.equal(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(A) }, true), null);
});

test('el encargado no inscrito de un grupo se pregunta igual', () => {
  const gr = cuerpo({ tipo: 'Grupo' });
  const aviso = alGuardar(gr, { lider_tipo: 'No miembro', lider_no_miembro_id: noMiembro(A) });
  assert.equal(aviso && aviso.confirmar, 'quien_lo_dirige_no_es_integrante');
  assert.match(aviso.error, /encargado\(a\)/, 'y se le dice encargado, no interino');
});

test('y si ya está entre los integrantes del grupo, no', () => {
  const gr = cuerpo({ tipo: 'Grupo' });
  const nm = noMiembro(A);
  meter(gr, 'No miembro', nm);
  assert.equal(alGuardar(gr, { lider_tipo: 'No miembro', lider_no_miembro_id: nm }), null);
});

test('corregirle el teléfono a un cuerpo no vuelve a preguntar por su líder', () => {
  /*
   * La mitad que decide si esto sirve o estorba: hay cuerpos cuyo líder nunca
   * fue integrante, y un aviso en cada guardado enseña a apretar «Está bien»
   * sin leer.
   */
  const cu = cuerpo();
  const m = miembro(A);
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(m, cu);
  assert.equal(alGuardar(cu, { descripcion: 'Otra cosa' }), null);
  assert.equal(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: m }), null,
    'volver a mandar el mismo líder no lo está cambiando');
});

test('pero CAMBIARLE el líder sí pregunta', () => {
  const cu = cuerpo();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(miembro(A), cu);
  assert.ok(alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(A) }));
});

test('quitarle el líder no pregunta nada', () => {
  const cu = cuerpo();
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ? WHERE id = ?").run(miembro(A), cu);
  assert.equal(alGuardar(cu, { lider_id: null }), null);
});

test('crear el cuerpo con su líder no pregunta, y es a propósito', () => {
  /*
   * Un cuerpo recién creado no tiene integrantes todavía, así que ahí el aviso
   * saldría siempre y no diría nada.
   */
  const data = { nombre: `Nuevo QD ${marca()}`, tipo: 'Cuerpo', iglesia_id: A,
    lider_tipo: 'Miembro', lider_id: miembro(A) };
  const aviso = getModule('cuerpos').hooks.beforeSave(
    data, { id: null, existing: null, isNew: true, db, confirmado: false }
  );
  assert.equal(aviso, null);
  assert.ok(data.lider, 'guardia: el nombre del líder sí se copia, que es lo que hace el gancho');
});

// -------------------------------------------------- lo de siempre sigue ----

test('a un CUERPO no lo dirige alguien no inscrito: eso sigue frenándose', () => {
  const cu = cuerpo({ tipo: 'Cuerpo' });
  const aviso = alGuardar(cu, { lider_tipo: 'No miembro', lider_no_miembro_id: noMiembro(A) });
  assert.equal(typeof aviso, 'string');
  assert.match(aviso, /Un cuerpo lo dirige un miembro inscrito/);
});

test('y el enlace del otro registro se suelta al cambiar de uno a otro', () => {
  const gr = cuerpo({ tipo: 'Grupo' });
  const m = miembro(A);
  meter(gr, 'Miembro', m);
  const data = { lider_tipo: 'No miembro', lider_no_miembro_id: noMiembro(A) };
  alGuardar(gr, data, true);
  assert.equal(data.lider_id, null,
    'si no, corregir de un registro al otro dejaría el enlace viejo apuntando a alguien que ya no dirige nada');
});

test('la persona que ya no está en el sistema se rechaza', () => {
  assert.match(String(alGuardar(cuerpo(), { lider_tipo: 'Miembro', lider_id: 999999 })),
    /ya no está en el sistema/);
});

// ---------------------------------------------- el orden de las preguntas ----

test('el nombre repetido manda sobre la del líder, y ésta sobre la de la cuota', () => {
  /*
   * El «igual_asi» es uno solo para todo el guardado, así que el orden decide
   * cuál se llega a ver: primero la que cuesta más deshacer.
   */
  const como = `Damas QD ${marca()}`;
  db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')").run(como, A);
  const cu = cuerpo();

  const conLasTres = alGuardar(cu, { nombre: como, lider_tipo: 'Miembro', lider_id: miembro(A), cobra_cuota: 1 });
  assert.equal(conLasTres.confirmar, 'cuerpo_con_el_mismo_nombre');

  const conDos = alGuardar(cu, { lider_tipo: 'Miembro', lider_id: miembro(A), cobra_cuota: 1 });
  assert.equal(conDos.confirmar, 'quien_lo_dirige_no_es_integrante');
});

test('y la regla vale para los DOS registros desde un solo archivo', () => {
  /*
   * Escritas por separado, ya pasó: una mitad se comprobaba y la otra no.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  assert.equal((modulo.match(/avisoSiEsDeOtraIglesia\(/g) || []).length, 1);
  assert.equal((modulo.match(/avisoSiNoEsIntegrante\(/g) || []).length, 1);
  assert.doesNotMatch(modulo, /está registrada en otra iglesia/,
    'el texto vive en la regla, no repetido en el módulo');
});

// ------------------------------------ y andando de verdad ----

const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: la iglesia frena y el no ser integrante pregunta', async () => {
  const api = await elSistemaAndando();
  const m = `lider-${process.pid}`;

  const central = (await api('POST', '/iglesias', {
    nombre: `Central del lider ${m}`, codigo: `LDA${process.pid}`, estado: 'Activa',
  })).json;
  const norte = (await api('POST', '/iglesias', {
    nombre: `Norte del lider ${m}`, codigo: `LDB${process.pid}`, estado: 'Activa',
  })).json;
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Coro del lider ${m}`, tipo: 'Cuerpo', iglesia_id: central.id, estado: 'Activo',
  })).json;
  assert.ok(cu && cu.id);

  const deCentral = (await api('POST', '/miembros', {
    nombres: 'Ana', apellidos: `Central ${m}`, iglesia_id: central.id, estado: 'Activo',
  })).json;
  const deNorte = (await api('POST', '/miembros', {
    nombres: 'Beto', apellidos: `Norte ${m}`, iglesia_id: norte.id, estado: 'Activo',
  })).json;

  const ajeno = await api('PUT', `/cuerpos/${cu.id}`,
    { lider_tipo: 'Miembro', lider_id: deNorte.id, igual_asi: true });
  assert.equal(ajeno.estado, 400, `un líder de otra iglesia tiene que frenarse: ${ajeno.texto.slice(0, 200)}`);
  assert.match(ajeno.json.error, /está registrada en otra iglesia/);
  assert.ok(!ajeno.json.confirmar, 'y no hay manera de contestarla que sí');

  const noIntegrante = await api('PUT', `/cuerpos/${cu.id}`,
    { lider_tipo: 'Miembro', lider_id: deCentral.id });
  assert.equal(noIntegrante.estado, 400, `tenía que preguntar: ${noIntegrante.texto.slice(0, 200)}`);
  assert.equal(noIntegrante.json.confirmar, 'quien_lo_dirige_no_es_integrante');

  assert.equal((await api('PUT', `/cuerpos/${cu.id}`,
    { lider_tipo: 'Miembro', lider_id: deCentral.id, igual_asi: true })).estado, 200,
    'contestando que sí, entra: hay interinatos');
  assert.equal((await api('GET', `/cuerpos/${cu.id}`)).json.lider, `Ana Central ${m}`);

  // Y con su ficha de integrante puesta, ya no pregunta
  const otra = (await api('POST', '/miembros', {
    nombres: 'Clara', apellidos: `Central ${m}`, iglesia_id: central.id, estado: 'Activo',
  })).json;
  assert.equal((await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu.id, persona_tipo: 'Miembro', miembro_id: otra.id,
    fecha_ingreso: '2026-01-05', estado: 'Activo',
  })).estado, 201);
  assert.equal((await api('PUT', `/cuerpos/${cu.id}`, { lider_tipo: 'Miembro', lider_id: otra.id })).estado, 200,
    'quien sí es integrante entra sin preguntar');
});
