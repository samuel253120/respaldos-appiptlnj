/**
 * La carpeta y el historial de un pastor se ven donde se ve el pastor.
 *
 * Cada papel y cada línea del historial de un pastor guardan una `iglesia_id`
 * heredada de su ficha, y esa columna era la que decidía quién podía verlos.
 * Cuando el pastor se traslada, nada la mueve: se quedan apuntando a la
 * congregación anterior. Y el gancho la recalculaba en CADA guardado, sin la
 * salvedad que sí tiene la carpeta de un miembro, así que el papel al que
 * alguien le corrigiera una coma se mudaba solo y los demás se quedaban.
 *
 * MEDIDO en la v1.429.0, trasladando un pastor del Norte al Sur con tres
 * papeles y ocho líneas, y corrigiéndole después la observación a uno solo:
 *
 *   la secretaria del NORTE  ·  su ficha: NO la ve
 *                               su carpeta: 2 de 3   ·  su historial: 7 de 8
 *   la secretaria del SUR    ·  su ficha: la ve
 *                               su carpeta: 1 de 3   ·  su historial: 1 de 8
 *
 * La congregación que ya no lo tiene seguía viendo sus antecedentes y su
 * ordenación; la que sí lo tiene, un papel y una línea. Y el reparto no seguía
 * ninguna regla: dependía de a cuál se le tocó una observación (hallazgo SA-02).
 *
 * Es la misma forma del defecto que se corrigió para los miembros en la
 * v1.191.0. NO se arregla moviendo filas: se arregla preguntándole a la ficha
 * del pastor —`alcance: comoSuPadre`—, que es el mecanismo que este sistema ya
 * tiene y que usaban cinco de los siete satélites. Estos dos eran los que
 * faltaban.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

const nuevaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`${nombre} CP ${marca}`, `${codigo}-${marca}`).lastInsertRowid;
const norte = nuevaIglesia('Del Norte', 'CPN');
const sur = nuevaIglesia('Del Sur', 'CPS');

let cuantos = 0;
const unRut = (base) => {
  const n = `${base + (marca * 13 + cuantos++) % 900000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const pastor = db
  .prepare(
    `INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, estado, cargo)
     VALUES (?,?,?,?,'Activo','Pastor Presbítero')`
  ).run('Elías', `Vera CP ${marca}`, unRut(25000000), norte).lastInsertRowid;

/** Una secretaria acotada a una sola congregación. */
function unaSecretaria(iglesia, nombre) {
  return db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, iglesia_id, iglesias) VALUES (?,?,?,1,?,?)')
    .run(unRut(26000000), `${nombre} CP ${marca}`, 'secretario', iglesia, JSON.stringify([iglesia]))
    .lastInsertRowid;
}
const laDelNorte = unaSecretaria(norte, 'Secretaria del Norte');
const laDelSur = unaSecretaria(sur, 'Secretaria del Sur');

/** Tres papeles y dos líneas, guardados mientras el pastor está en el Norte. */
const papeles = [];
for (const [tipo, nombre] of [['Carnet de Identidad', 'Carnet'],
  ['Certificado de Nombramiento (Ordenacion)', 'Nombramiento 2019'],
  ['Certificado de Antecedentes', 'Antecedentes']]) {
  const archivo = `cp-${marca}-${nombre.replace(/\s+/g, '-')}.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, archivo), 'papel');
  papeles.push(db
    .prepare(
      `INSERT INTO documentos_pastores (pastor_id, tipo, nombre, archivo, fecha, iglesia_id)
       VALUES (?,?,?,?, '2019-05-10', ?)`
    ).run(pastor, tipo, `${nombre} ${marca}`, archivo, norte).lastInsertRowid);
}
const lineas = [];
for (const [fecha, tipo, desc] of [['2015-03-01', 'Ordenación', 'Ordenado en el Norte.'],
  ['2020-08-02', 'Reconocimiento', 'Reconocido por su servicio.']]) {
  lineas.push(db.prepare(
    `INSERT INTO historial_pastores (pastor_id, fecha, tipo, descripcion, origen, iglesia_id)
     VALUES (?,?,?,?, 'Manual', ?)`
  ).run(pastor, fecha, tipo, `${desc} ${marca}`, norte).lastInsertRowid);
}

const cuantasVe = async (quien, ruta) => {
  const r = await quien('GET', ruta);
  assert.equal(r.estado, 200, r.texto.slice(0, 160));
  return r.json.rows.length;
};

// ------------------------------------------- lo que decide quién ve -------

test('los dos satélites del pastor preguntan por su ficha, no por su propia columna', () => {
  for (const m of ['documentos_pastores', 'historial_pastores']) {
    assert.deepEqual(getModule(m).alcance, { comoSuPadre: { modulo: 'pastores', campo: 'pastor_id' } },
      `${m}: sin esto, quién lo ve lo decide una columna que el traslado no mueve`);
  }
});

test('y es lo mismo que hacen los otros cinco satélites', () => {
  // Los tres de una solicitud y los dos de un miembro. Los de una iglesia no:
  // ahí el padre ES la iglesia, así que la columna y la ficha son lo mismo.
  for (const [m, padre] of [['historial_solicitudes', 'solicitudes'], ['documentos_solicitudes', 'solicitudes'],
    ['personas_solicitud', 'solicitudes'], ['documentos_miembros', 'miembros'], ['bitacora', 'miembros']]) {
    const a = getModule(m).alcance;
    assert.equal(a && a.comoSuPadre && a.comoSuPadre.modulo, padre, `${m} dejó de preguntar por su ficha`);
  }
});

// ------------------------------------------- antes del traslado -----------

test('con el pastor en el Norte, su carpeta la ve la del Norte y no la del Sur', async () => {
  await elSistemaAndando();
  const norteVe = comoOtroUsuario(laDelNorte);
  const surVe = comoOtroUsuario(laDelSur);
  assert.equal(await cuantasVe(norteVe, `/documentos_pastores?f_pastor_id=${pastor}&limit=50`), 3);
  assert.equal(await cuantasVe(norteVe, `/historial_pastores?f_pastor_id=${pastor}&limit=50`), 2);
  assert.equal(await cuantasVe(surVe, `/documentos_pastores?f_pastor_id=${pastor}&limit=50`), 0);
  assert.equal(await cuantasVe(surVe, `/historial_pastores?f_pastor_id=${pastor}&limit=50`), 0);
});

// ------------------------------------------- y después --------------------

test('trasladado al Sur, su carpeta ENTERA se va con él', async () => {
  const api = await elSistemaAndando();
  const r = await api('PUT', `/pastores/${pastor}`, { iglesia_id: sur, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(r.json.iglesia_id, sur);

  const surVe = comoOtroUsuario(laDelSur);
  assert.equal(await cuantasVe(surVe, `/documentos_pastores?f_pastor_id=${pastor}&limit=50`), 3,
    'los tres papeles, no uno');

  // Tres líneas, no dos: las dos que ya tenía MÁS la que el propio traslado
  // deja escrita. Son las tres las que se ven, que es lo que se comprueba.
  const suHistorial = await surVe('GET', `/historial_pastores?f_pastor_id=${pastor}&limit=50`);
  assert.equal(suHistorial.estado, 200, suHistorial.texto.slice(0, 160));
  const tipos = suHistorial.json.rows.map((f) => f.tipo).sort();
  assert.deepEqual(tipos, ['Ordenación', 'Reconocimiento', 'Traslado de iglesia'],
    'su ordenación y su reconocimiento se van con él, y el traslado queda anotado');
});

test('y la congregación anterior deja de verla, como deja de ver su ficha', async () => {
  await elSistemaAndando();
  const norteVe = comoOtroUsuario(laDelNorte);
  const suFicha = await norteVe(`GET`, `/pastores?f_id=${pastor}&limit=5`);
  assert.equal(suFicha.json.rows.length, 0, 'ya no es su pastor');
  assert.equal(await cuantasVe(norteVe, `/documentos_pastores?f_pastor_id=${pastor}&limit=50`), 0,
    'ni sus antecedentes ni su ordenación se quedan en la iglesia que dejó');
  assert.equal(await cuantasVe(norteVe, `/historial_pastores?f_pastor_id=${pastor}&limit=50`), 0);
});

test('corregirle una coma a un papel ya no lo muda de iglesia', async () => {
  const api = await elSistemaAndando();
  const antes = db.prepare('SELECT iglesia_id FROM documentos_pastores WHERE id = ?').get(papeles[0]).iglesia_id;
  const r = await api('PUT', `/documentos_pastores/${papeles[0]}`, {
    observaciones: `Se le arregla una coma. ${marca}`, igual_asi: true,
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const despues = db.prepare('SELECT iglesia_id FROM documentos_pastores WHERE id = ?').get(papeles[0]).iglesia_id;
  assert.equal(despues, antes,
    'la columna dice en qué congregación estaba el pastor cuando se archivó: no se recalcula sola');

  // Y la carpeta no se parte: los tres siguen diciendo lo mismo
  const cuales = db.prepare('SELECT DISTINCT iglesia_id FROM documentos_pastores WHERE pastor_id = ?').all(pastor);
  assert.equal(cuales.length, 1, `la carpeta quedó repartida entre ${cuales.length} iglesias`);
});

test('ni corregirle la redacción a una línea del historial', async () => {
  /*
   * La misma salvedad, en el otro satélite. Sin ella, la línea a la que se le
   * arregla una palabra se muda a la congregación nueva y las demás se quedan
   * en la anterior: el historial de un pastor queda partido en dos según a
   * cuál se le tocó el texto, que es exactamente lo que se midió.
   */
  const api = await elSistemaAndando();
  const antes = db.prepare('SELECT iglesia_id FROM historial_pastores WHERE id = ?').get(lineas[0]).iglesia_id;
  const r = await api('PUT', `/historial_pastores/${lineas[0]}`, {
    descripcion: `Ordenado en el Norte, en ceremonia. ${marca}`, igual_asi: true,
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT iglesia_id FROM historial_pastores WHERE id = ?').get(lineas[0]).iglesia_id, antes,
    'dice dónde estaba el pastor cuando se anotó el hecho: no se recalcula sola'
  );

  // Las dos líneas manuales siguen diciendo lo mismo: el historial no se parte
  const cuales = db
    .prepare("SELECT DISTINCT iglesia_id FROM historial_pastores WHERE pastor_id = ? AND origen = 'Manual'")
    .all(pastor);
  assert.equal(cuales.length, 1, `el historial quedó repartido entre ${cuales.length} iglesias`);
});

test('pero cambiarle el dueño a un papel sí lo archiva en la carpeta del nuevo', async () => {
  const api = await elSistemaAndando();
  const otro = db
    .prepare(
      `INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, estado, cargo)
       VALUES (?,?,?,?,'Activo','Pastor Diácono')`
    ).run('Otro', `Pastor CP ${marca}`, unRut(27000000), sur).lastInsertRowid;
  const r = await api('PUT', `/documentos_pastores/${papeles[2]}`, { pastor_id: otro, igual_asi: true });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT iglesia_id FROM documentos_pastores WHERE id = ?').get(papeles[2]).iglesia_id, sur,
    'al cambiar de dueño se archiva donde está el nuevo'
  );
});
