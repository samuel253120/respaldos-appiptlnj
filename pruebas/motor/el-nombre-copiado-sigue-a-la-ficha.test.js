/**
 * El nombre de una persona, donde se copió.
 *
 * Seis registros del sistema guardan el nombre de una persona en una columna
 * propia, copiada de su ficha al guardar. La 1.226.0 lo arregló para UNA de las
 * seis —el beneficiario de una ayuda social— y ahí se quedó. Medido antes de
 * esto, con la misma persona puesta en todos los papeles y corrigiéndole el
 * nombre en su ficha:
 *
 *   ayudas_sociales.beneficiario ...... Ana María Corregida   ✔ seguía
 *   cuerpos.lider ..................... Ana Vieja
 *   integrantes_cuerpo.persona ........ Ana Vieja
 *   cuotas_cuerpo.persona ............. Ana Vieja
 *   solicitudes.solicitante ........... Ana Vieja
 *
 * Un apellido no se corrige por capricho, y esas columnas son las que el
 * listado muestra, las que titulan cada registro y por las que se busca.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const copiado = require('../../server/el-nombre-copiado');
const miembros = require('../../server/modules/miembros');
const noMiembros = require('../../server/modules/no_miembros');
const { losNombresCopiadosQueQuedaronViejos } = require('../../server/migraciones');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const laIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia NC ${marca()}`, `NC${marca()}`).lastInsertRowid;

const miembro = (nombres, apellidos) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, estado, iglesia_id) VALUES (?, ?, 'Activo', ?)")
  .run(nombres, apellidos, laIglesia).lastInsertRowid;
const noMiembro = (nombres, apellidos) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?, ?, ?)')
  .run(nombres, apellidos, laIglesia).lastInsertRowid;

/** Deja a una persona puesta en los seis papeles donde su nombre se copia. */
function enTodosLosPapeles(deDonde, id, comoSeLlamaba) {
  const esMiembro = deDonde === 'miembros';
  const cu = db
    .prepare(`INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, lider_tipo, ${esMiembro ? 'lider_id' : 'lider_no_miembro_id'}, lider)
              VALUES (?, ?, ?, 'Activo', ?, ?, ?)`)
    .run(`Cuerpo NC ${marca()}`, esMiembro ? 'Cuerpo' : 'Grupo', laIglesia,
         esMiembro ? 'Miembro' : 'No miembro', id, comoSeLlamaba).lastInsertRowid;
  const fi = db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, ${esMiembro ? 'miembro_id' : 'no_miembro_id'}, iglesia_id, fecha_ingreso, estado, persona)
              VALUES (?, ?, ?, ?, '2026-01-05', 'Activo', ?)`)
    .run(cu, esMiembro ? 'Miembro' : 'No miembro', id, laIglesia, comoSeLlamaba).lastInsertRowid;
  const cuota = db
    .prepare(`INSERT INTO cuotas_cuerpo (integrante_id, cuerpo_id, ${esMiembro ? 'miembro_id' : 'iglesia_id'}, anio, mes, monto, fecha_pago, persona, iglesia_id)
              VALUES (?, ?, ?, 2026, '01', 1000, '2026-01-20', ?, ?)`)
    .run(fi, cu, esMiembro ? id : laIglesia, comoSeLlamaba, laIglesia).lastInsertRowid;
  const ayuda = db
    .prepare(`INSERT INTO ayudas_sociales (beneficiario_tipo, ${esMiembro ? 'miembro_id' : 'no_miembro_id'}, tipo_ayuda, fecha, valor_estimado, iglesia_id, estado, beneficiario)
              VALUES (?, ?, 'Alimentos', '2026-01-10', 1000, ?, 'Solicitada', ?)`)
    .run(esMiembro ? 'Miembro' : 'No miembro', id, laIglesia, comoSeLlamaba).lastInsertRowid;
  const sol = db
    .prepare(`INSERT INTO solicitudes (solicitante_tipo, ${esMiembro ? 'miembro_id' : 'no_miembro_id'}, tipo, asunto, fecha, iglesia_id, estado, solicitante)
              VALUES (?, ?, 'Certificado', ?, '2026-01-11', ?, 'Pendiente', ?)`)
    .run(esMiembro ? 'Miembro' : 'No miembro', id, `Asunto NC ${marca()}`, laIglesia, comoSeLlamaba).lastInsertRowid;
  const enSol = db
    .prepare(`INSERT INTO personas_solicitud (solicitud_id, persona_tipo, ${esMiembro ? 'miembro_id' : 'no_miembro_id'}, persona)
              VALUES (?, ?, ?, ?)`)
    .run(sol, esMiembro ? 'Miembro' : 'No miembro', id, comoSeLlamaba).lastInsertRowid;

  return { cu, fi, cuota, ayuda, sol, enSol };
}

/** Qué dice cada copia hoy. */
const comoDicen = (p) => ({
  'cuerpos.lider': db.prepare('SELECT lider AS v FROM cuerpos WHERE id = ?').get(p.cu).v,
  'integrantes_cuerpo.persona': db.prepare('SELECT persona AS v FROM integrantes_cuerpo WHERE id = ?').get(p.fi).v,
  'cuotas_cuerpo.persona': db.prepare('SELECT persona AS v FROM cuotas_cuerpo WHERE id = ?').get(p.cuota).v,
  'ayudas_sociales.beneficiario': db.prepare('SELECT beneficiario AS v FROM ayudas_sociales WHERE id = ?').get(p.ayuda).v,
  'solicitudes.solicitante': db.prepare('SELECT solicitante AS v FROM solicitudes WHERE id = ?').get(p.sol).v,
  'personas_solicitud.persona': db.prepare('SELECT persona AS v FROM personas_solicitud WHERE id = ?').get(p.enSol).v,
});

// ------------------------------------------------- las seis, de una vez ----

test('corregirle el nombre a un MIEMBRO lo corrige en los seis lugares', () => {
  const id = miembro('Ana', `Vieja ${marca()}`);
  const vieja = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  const papeles = enTodosLosPapeles('miembros', id, copiado.comoSeLlama(vieja));
  assert.equal(new Set(Object.values(comoDicen(papeles))).size, 1, 'guardia: los seis parten diciendo lo mismo');

  db.prepare('UPDATE miembros SET nombres = ?, apellidos = ? WHERE id = ?')
    .run('Ana María', `Corregida ${marca()}`, id);
  const cuantas = copiado.ponerAlDiaElNombre(db, 'miembros', id);
  assert.equal(cuantas, 6, 'las seis copias tienen que quedar al día');

  const ahora = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  for (const [donde, dice] of Object.entries(comoDicen(papeles))) {
    assert.equal(dice, copiado.comoSeLlama(ahora), `${donde} se quedó con el nombre viejo`);
  }
});

test('y a un NO MIEMBRO también, por sus propias columnas', () => {
  /*
   * Un no inscrito puede encargar un grupo, ser integrante, pagar su cuota,
   * recibir una ayuda y presentar una solicitud. Escritas por separado, ya
   * pasó lo que pasó: una mitad se ponía al día y la otra no.
   */
  const id = noMiembro('Rut', `Vieja ${marca()}`);
  const vieja = db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(id);
  const papeles = enTodosLosPapeles('no_miembros', id, copiado.comoSeLlama(vieja));

  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run(`Corregida ${marca()}`, id);
  assert.equal(copiado.ponerAlDiaElNombre(db, 'no_miembros', id), 6);

  const ahora = db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(id);
  for (const [donde, dice] of Object.entries(comoDicen(papeles))) {
    assert.equal(dice, copiado.comoSeLlama(ahora), `${donde} se quedó con el nombre viejo`);
  }
});

test('la cuota se alcanza por su ficha de integrante, no por el miembro', () => {
  /*
   * `cuotas_cuerpo` no tiene columna para un no miembro —solo `miembro_id`—
   * así que la cuota de alguien no inscrito no se alcanza por ese camino.
   * Siguiendo al integrante se alcanzan las dos, y además se copia de donde de
   * verdad salió (ver server/modules/cuotas_cuerpo.js).
   */
  const id = noMiembro('Rut', `Cuota ${marca()}`);
  const vieja = copiado.comoSeLlama(db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(id));
  const papeles = enTodosLosPapeles('no_miembros', id, vieja);
  assert.equal(db.prepare('SELECT miembro_id AS v FROM cuotas_cuerpo WHERE id = ?').get(papeles.cuota).v, null,
    'guardia: la cuota de un no inscrito no tiene miembro al que apuntar');

  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run(`Cuota Corregida ${marca()}`, id);
  copiado.ponerAlDiaElNombre(db, 'no_miembros', id);
  assert.notEqual(comoDicen(papeles)['cuotas_cuerpo.persona'], vieja);
});

test('corregirle el TELÉFONO no toca ni una fila', () => {
  const id = miembro('Ana', `Quieta ${marca()}`);
  const vieja = copiado.comoSeLlama(db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id));
  enTodosLosPapeles('miembros', id, vieja);
  assert.equal(copiado.ponerAlDiaElNombre(db, 'miembros', id), 0,
    'solo escribe donde el nombre cambió de verdad');
});

test('una ficha sin nombre no borra las copias', () => {
  /*
   * Cambiar «no sabemos si el nombre está al día» por «no sabemos de quién se
   * trata» es mucho peor.
   */
  const id = miembro('Sin', `Nombre ${marca()}`);
  const vieja = copiado.comoSeLlama(db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id));
  const papeles = enTodosLosPapeles('miembros', id, vieja);
  db.prepare("UPDATE miembros SET nombres = '', apellidos = NULL WHERE id = ?").run(id);
  assert.equal(copiado.ponerAlDiaElNombre(db, 'miembros', id), 0);
  assert.equal(comoDicen(papeles)['cuerpos.lider'], vieja);
});

test('una ficha que ya no está no rompe nada', () => {
  assert.equal(copiado.ponerAlDiaElNombre(db, 'miembros', 999999), 0);
});

test('las filas con el nombre escrito a mano, que no apuntan a nadie, no se tocan', () => {
  /*
   * Ahí ese texto es lo único que hay, y es la constancia de verdad.
   */
  const suelta = db
    .prepare(`INSERT INTO ayudas_sociales (beneficiario_tipo, tipo_ayuda, fecha, valor_estimado, iglesia_id, estado, beneficiario)
              VALUES ('Miembro', 'Alimentos', '2020-01-10', 1000, ?, 'Solicitada', ?)`)
    .run(laIglesia, `Alguien De Antes ${marca()}`).lastInsertRowid;
  const comoDecia = db.prepare('SELECT beneficiario AS v FROM ayudas_sociales WHERE id = ?').get(suelta).v;

  const id = miembro('Otra', `Persona ${marca()}`);
  db.prepare('UPDATE miembros SET apellidos = ? WHERE id = ?').run(`Cambiada ${marca()}`, id);
  copiado.ponerAlDiaElNombre(db, 'miembros', id);
  assert.equal(db.prepare('SELECT beneficiario AS v FROM ayudas_sociales WHERE id = ?').get(suelta).v, comoDecia);
});

// --------------------------------------------- que los módulos lo llamen ----

test('al guardar la ficha de un miembro se ponen al día sus copias', () => {
  /*
   * La regla puede estar perfecta y no llamarla nadie. Es la misma lección que
   * dejó la de la iglesia inactiva: estaba escrita, comprobada y desconectada.
   */
  const id = miembro('Ana', `Gancho ${marca()}`);
  const vieja = copiado.comoSeLlama(db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id));
  const papeles = enTodosLosPapeles('miembros', id, vieja);
  db.prepare('UPDATE miembros SET apellidos = ? WHERE id = ?').run(`Gancho Corregido ${marca()}`, id);

  miembros.hooks.afterSave(db.prepare('SELECT * FROM miembros WHERE id = ?').get(id),
    { db, user: { id: 1, rol: 'admin' }, isNew: false, existing: null });
  assert.notEqual(comoDicen(papeles)['cuerpos.lider'], vieja, 'el módulo tiene que llamarlo');
});

test('y al guardar la de un no miembro, también', () => {
  const id = noMiembro('Rut', `Gancho ${marca()}`);
  const vieja = copiado.comoSeLlama(db.prepare('SELECT nombres, apellidos FROM no_miembros WHERE id = ?').get(id));
  const papeles = enTodosLosPapeles('no_miembros', id, vieja);
  db.prepare('UPDATE no_miembros SET apellidos = ? WHERE id = ?').run(`Gancho Corregido ${marca()}`, id);

  noMiembros.hooks.afterSave({ id }, { db, user: { id: 1, rol: 'admin' } });
  assert.notEqual(comoDicen(papeles)['cuerpos.lider'], vieja);
});

test('la lista de dónde se copia está en un solo lugar', () => {
  /*
   * Escrita módulo por módulo, se olvidó en cinco de seis. El que venga
   * después se agrega en una línea, y acá se comprueba que sigan siendo las
   * seis: quitar una de la lista es exactamente el defecto que esto arregla.
   */
  const tablas = copiado.DONDE_SE_COPIA.map((d) => d.tabla).concat(copiado.POR_SU_INTEGRANTE.tabla);
  assert.deepEqual(tablas.sort(), [
    'ayudas_sociales', 'cuerpos', 'cuotas_cuerpo', 'integrantes_cuerpo',
    'personas_solicitud', 'solicitudes',
  ]);
});

test('el hook que copia y el refresco arman el nombre igual', () => {
  /*
   * Escritos por separado, un día difieren por un espacio y los registros
   * quedan «cambiando» solos.
   */
  assert.equal(copiado.comoSeLlama({ nombres: 'Ana', apellidos: 'Torres' }), 'Ana Torres');
  assert.equal(copiado.comoSeLlama({ nombres: 'Ana', apellidos: null }), 'Ana', 'sin espacios de sobra');
  assert.equal(copiado.comoSeLlama(null), null);

  const comoLoArman = /`\$\{ficha\.nombres \|\| ''\} \$\{ficha\.apellidos \|\| ''\}`\.trim\(\)/;
  for (const modulo of ['cuerpos', 'integrantes_cuerpo', 'personas_solicitud']) {
    const texto = fs.readFileSync(path.join(__dirname, `../../server/modules/${modulo}.js`), 'utf8');
    assert.match(texto, comoLoArman, `${modulo} arma el nombre de otra manera`);
  }
});

// ------------------------------------ lo que ya quedó viejo, al día ----

test('los nombres que ya estaban viejos se ponen al día al arrancar', () => {
  /*
   * La regla nueva vale de aquí en adelante; lo que ya quedó viejo sigue
   * viejo, y no es un rótulo cualquiera —es el nombre por el que se busca a
   * esa persona—.
   *
   * Se corre sobre una COPIA de la base: los archivos de motor comparten una
   * sola y corren en paralelo, así que una puesta al día que pasa por TODAS
   * las personas pisaría lo que otro archivo está sembrando.
   */
  const copia = path.join(os.tmpdir(), `nombres-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    const igl = otra.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los Viejos','IG-VIE','Activa')").run().lastInsertRowid;
    const m = otra.prepare("INSERT INTO miembros (nombres, apellidos, estado, iglesia_id) VALUES ('Ana','Nueva','Activo',?)").run(igl).lastInsertRowid;
    const cu = otra
      .prepare(`INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, lider_tipo, lider_id, lider)
                VALUES ('Coro de los Viejos','Cuerpo',?,'Activo','Miembro',?,'Ana Vieja')`)
      .run(igl, m).lastInsertRowid;
    const fi = otra
      .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, iglesia_id, fecha_ingreso, estado, persona)
                VALUES (?, 'Miembro', ?, ?, '2019-03-01', 'Activo', 'Ana Vieja')`)
      .run(cu, m, igl).lastInsertRowid;

    // Y un NO MIEMBRO, que es la otra mitad de la pasada: sin él, quitar los no
    // miembros del recorrido no habría hecho fallar nada
    const nm = otra.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Rut','Nueva',?)").run(igl).lastInsertRowid;
    const gr = otra
      .prepare(`INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, lider_tipo, lider_no_miembro_id, lider)
                VALUES ('Aseo de los Viejos','Grupo',?,'Activo','No miembro',?,'Rut Vieja')`)
      .run(igl, nm).lastInsertRowid;

    assert.equal(otra.prepare('SELECT lider AS v FROM cuerpos WHERE id = ?').get(cu).v, 'Ana Vieja');
    assert.equal(otra.prepare('SELECT lider AS v FROM cuerpos WHERE id = ?').get(gr).v, 'Rut Vieja');

    otra.prepare("DELETE FROM migraciones WHERE nombre = 'los nombres copiados que quedaron viejos'").run();
    losNombresCopiadosQueQuedaronViejos(otra);

    assert.equal(otra.prepare('SELECT lider AS v FROM cuerpos WHERE id = ?').get(cu).v, 'Ana Nueva');
    assert.equal(otra.prepare('SELECT persona AS v FROM integrantes_cuerpo WHERE id = ?').get(fi).v, 'Ana Nueva');
    assert.equal(otra.prepare('SELECT lider AS v FROM cuerpos WHERE id = ?').get(gr).v, 'Rut Nueva',
      'la pasada tiene que recorrer los dos registros, no solo los miembros');
    assert.ok(
      otra.prepare("SELECT nombre FROM migraciones WHERE nombre = 'los nombres copiados que quedaron viejos'").get(),
      'queda marcada como aplicada, para no volver a pasarla'
    );
  } finally {
    otra.close();
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s); } catch (e) { /* no estaba */ } }
  }
});

test('y la puesta al día usa la MISMA regla que corre de aquí en adelante', () => {
  /*
   * No se adivina nada: se le pide a la regla que ponga al día a cada persona.
   * Así el resultado es el que habría si la regla hubiera existido siempre, y
   * no una segunda versión escrita en la migración que un día diga otra cosa.
   */
  const migraciones = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');
  const desde = migraciones.indexOf('function losNombresCopiadosQueQuedaronViejos(');
  const trozo = migraciones.slice(desde, migraciones.indexOf('\n}', desde));
  assert.match(trozo, /require\('\.\/el-nombre-copiado'\)/);
  assert.doesNotMatch(trozo, /UPDATE /, 'la migración no escribe SQL propio: le pide a la regla que lo haga');
});

// ------------------------------------ y andando de verdad ----

const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: se le corrige el nombre y el cuerpo deja de decir el viejo', async () => {
  const api = await elSistemaAndando();
  const m = `copiado-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia del nombre ${m}`, codigo: `NOM${process.pid}`, estado: 'Activa',
  })).json;
  const persona = (await api('POST', '/miembros', {
    nombres: 'Ana', apellidos: `Vieja ${m}`, iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Coro del nombre ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const ficha = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu.id, persona_tipo: 'Miembro', miembro_id: persona.id,
    fecha_ingreso: '2026-01-05', estado: 'Activo',
  });
  assert.equal(ficha.estado, 201, ficha.texto.slice(0, 200));
  assert.equal((await api('PUT', `/cuerpos/${cu.id}`, { lider_tipo: 'Miembro', lider_id: persona.id })).estado, 200);
  assert.equal((await api('GET', `/cuerpos/${cu.id}`)).json.lider, `Ana Vieja ${m}`, 'guardia: parte con el viejo');

  const correccion = await api('PUT', `/miembros/${persona.id}`,
    { nombres: 'Ana María', apellidos: `Corregida ${m}`, igual_asi: true });
  assert.equal(correccion.estado, 200, correccion.texto.slice(0, 200));

  assert.equal((await api('GET', `/cuerpos/${cu.id}`)).json.lider, `Ana María Corregida ${m}`);
  assert.equal((await api('GET', `/integrantes_cuerpo/${ficha.json.id}`)).json.persona, `Ana María Corregida ${m}`);
});
