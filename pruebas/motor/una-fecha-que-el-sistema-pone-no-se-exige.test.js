/**
 * Un campo que el sistema rellena solo no puede estar marcado como obligatorio.
 *
 * La comprobación de los campos obligatorios del motor corre ANTES del gancho
 * de guardado del módulo (server/crud.js). Así que si un campo se declara
 * obligatorio Y su gancho lo rellena cuando viene en blanco, el relleno no se
 * ejecuta nunca: el guardado se rechaza por no traer un valor que el sistema
 * tenía puesto para ponerle. Las dos líneas dicen cosas contrarias sobre la
 * misma casilla, y gana la que la persona no ve.
 *
 * MEDIDO en la v1.429.0, la misma anotación sin fecha por las tres puertas:
 *
 *   POST /historial_solicitudes  ...  201 · fecha = '2026-09-05'
 *   POST /historial_iglesias  ......  400 · «El campo "Fecha" es obligatorio»
 *   POST /historial_pastores  ......  400 · «El campo "Fecha" es obligatorio»
 *
 * Y lo más elocuente: el comentario que explica la trampa estaba escrito, hace
 * tiempo, en el único de los tres que no cayó en ella (hallazgo SA-01).
 *
 * ── POR QUÉ LA REGLA Y NO LOS DOS CASOS ──
 *
 * El informe nombraba dos módulos. Escribir la regla general en vez de arreglar
 * los dos a mano destapó un CUARTO: la bitácora de un miembro tenía la misma
 * contradicción y no estaba en ninguna revisión. Por eso la prueba que importa
 * es la de abajo, que recorre los cuarenta y un módulos: los tres casos de
 * arriba son ejemplos, la regla es lo que se vigila.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { allModules, getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

// ------------------------------------------- la regla ----------------------

/** Los campos que el gancho de un módulo rellena cuando vienen en blanco. */
function losQueElGanchoRellena(archivo) {
  const src = fs.readFileSync(archivo, 'utf8');
  const suyos = new Set();
  // «if (!data.x) data.x =» y «if (isNew && !data.x) data.x =»
  for (const m of src.matchAll(/if \((?:isNew && )?!data\.([a-z_]+)\) data\.\1 =/g)) suyos.add(m[1]);
  // «data.x = data.x || …»
  for (const m of src.matchAll(/data\.([a-z_]+) = data\.\1 \|\|/g)) suyos.add(m[1]);
  return suyos;
}

test('ningún módulo exige un campo que su propio gancho iba a rellenar', () => {
  const carpeta = path.join(__dirname, '../../server/modules');
  const contradicciones = [];
  let mirados = 0;
  for (const archivo of fs.readdirSync(carpeta).filter((f) => f.endsWith('.js'))) {
    let def;
    try { def = getModule(archivo.replace(/\.js$/, '')); } catch (e) { continue; }
    if (!def) continue;
    mirados++;
    for (const campo of losQueElGanchoRellena(path.join(carpeta, archivo))) {
      const declarado = (def.fields || []).find((f) => f.name === campo);
      if (declarado && declarado.required) contradicciones.push(`${def.name}.${campo}`);
    }
  }
  assert.ok(mirados > 35, `solo se miraron ${mirados} módulos`);
  assert.deepEqual(contradicciones, [],
    'estos campos se rellenan solos y además se exigen, así que el relleno no corre nunca:\n  '
    + contradicciones.join('\n  '));
});

test('y el detector encuentra de verdad el patrón que busca', () => {
  /*
   * Una prueba que recorre archivos buscando algo puede pasar por no encontrar
   * nada, y entonces no vigila nada. Se comprueba que sí ve los rellenos que
   * hay: los tres historiales rellenan su fecha, y el módulo de una solicitud
   * rellena su responsable.
   */
  const carpeta = path.join(__dirname, '../../server/modules');
  for (const [archivo, campo] of [['historial_solicitudes.js', 'fecha'], ['historial_iglesias.js', 'fecha'],
    ['historial_pastores.js', 'fecha'], ['bitacora.js', 'fecha'], ['solicitudes.js', 'responsable_id']]) {
    assert.ok(losQueElGanchoRellena(path.join(carpeta, archivo)).has(campo),
      `no se vio el relleno de ${campo} en ${archivo}`);
  }
});

// ------------------------------------------- y lo que se ve --------------

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Sin fecha ${marca}`, `SF-${marca}`).lastInsertRowid;

const numero = `${23000000 + (marca * 7) % 900000}`;
const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run('Persona', `SF ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;

const pastorNumero = `${24000000 + (marca * 11) % 900000}`;
const pastor = db
  .prepare("INSERT INTO pastores (nombres, apellidos, rut, iglesia_id, estado, cargo) VALUES (?,?,?,?,'Activo','Pastor Presbítero')")
  .run('Pastor', `SF ${marca}`, `${pastorNumero}-${digitoVerificador(pastorNumero)}`, iglesia).lastInsertRowid;

const solicitud = db
  .prepare(
    `INSERT INTO solicitudes (fecha, iglesia_id, solicitante_tipo, miembro_id, tipo, asunto, estado)
     VALUES ('2026-09-05', ?, 'Miembro', ?, 'Otro', ?, 'Pendiente')`
  ).run(iglesia, miembro, `Sin fecha ${marca}`).lastInsertRowid;

test('los cuatro historiales aceptan una anotación sin fecha, y la ponen ellos', async () => {
  const api = await elSistemaAndando();
  const { hoy } = require('../../server/fechas');
  const casos = [
    ['historial_solicitudes', { solicitud_id: solicitud, tipo: 'Gestión', descripcion: `Se llamó por teléfono. ${marca}` }],
    ['historial_iglesias', { iglesia_id: iglesia, tipo: 'Anotación', descripcion: `Se pintó el templo. ${marca}` }],
    ['historial_pastores', { pastor_id: pastor, tipo: 'Anotación', descripcion: `Se le encargó la visitación. ${marca}` }],
    ['bitacora', { miembro_id: miembro, tipo: 'Anotación', descripcion: `Se conversó con ella. ${marca}` }],
  ];
  for (const [modulo, cuerpo] of casos) {
    const r = await api('POST', `/${modulo}`, cuerpo);
    assert.equal(r.estado, 201, `${modulo}: ${r.texto.slice(0, 160)}`);
    assert.equal(r.json.fecha, hoy(), `${modulo}: la puso el sistema, y es el día de la iglesia`);
  }
});

test('y la fecha que se escriba manda sobre la que pondría el sistema', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/historial_pastores', {
    pastor_id: pastor, fecha: '2015-03-01', tipo: 'Ordenación',
    descripcion: `Ordenado el 1 de marzo de 2015. ${marca}`,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 160));
  assert.equal(r.json.fecha, '2015-03-01', 'un hecho antiguo se anota con su fecha, no con la de hoy');
});

test('lo que sí es obligatorio lo sigue siendo', async () => {
  const api = await elSistemaAndando();
  // Quitar el `required` de la fecha no puede haber aflojado el resto
  const r = await api('POST', '/historial_iglesias', { iglesia_id: iglesia, tipo: 'Anotación' });
  assert.equal(r.estado, 400, r.texto.slice(0, 160));
  assert.match(r.json.error, /Descripción/, 'una anotación sin nada escrito no dice nada');
});
