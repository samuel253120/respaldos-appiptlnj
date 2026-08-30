/**
 * LO QUE SE LE ENTREGA A UNA PERSONA NO ES DE CONSULTA GENERAL.
 *
 * El sistema ya había decidido que esto es delicado y lo dejó por escrito: al
 * rol de consulta se le cierran las fichas de No Miembros porque «son de gente
 * en situación vulnerable y las lleva quien administra las ayudas». El mismo
 * comentario agregaba que a esa persona «le basta con el nombre que aparece en
 * la ayuda que esté mirando», y eso describía algo distinto de lo que pasaba.
 *
 * Medido con un usuario de rol consulta recién creado, contra el sistema
 * andando:
 *
 *   listar No Miembros / abrir una ficha .....  403 · 403
 *   listar Ayudas Sociales ...................  200, las seis
 *   abrir una ayuda con sus notas ............  200 — «está en tratamiento
 *                                                oncológico»
 *   bajar la boleta adjunta ..................  200
 *   el historial completo de una señora ......  200 · 5 ayudas, $123.000
 *   el informe, con nombre y apellido ........  200
 *   bajarlo todo en planilla, notas incluidas   200 · 6 filas
 *
 * Ver un nombre de paso no es poder listar a todas las personas que la iglesia
 * ayudó, leer por qué, cuánto se les dio y qué se anotó de su salud, y
 * llevárselo en un archivo que ya no vuelve.
 *
 * ── Y LA NOVENA PUERTA ──
 *
 * Al cerrar el módulo, ocho de las nueve puertas contestaron 403 y una siguió
 * contestando 200: la boleta adjunta. `puedeVer` preguntaba solo por el
 * ALCANCE —de qué iglesias es lo que esta persona puede mirar— y no por el
 * PERMISO —qué módulos puede abrir—. A quien tiene el módulo cerrado el
 * alcance le contesta que sí, porque no está acotado a ninguna iglesia en
 * particular. Cerrar la puerta dejaba la ventana abierta, y no era de este
 * módulo: valía para cualquiera que un rol tenga cerrado.
 *
 * Lo que cuida este archivo:
 *   · que la ayuda social quede cerrada para el rol de consulta, junto a la
 *     ficha de la que sale
 *   · que a los cuatro roles que administran las ayudas no les cambie nada
 *   · que quien la necesite la reciba por su nombre, con una excepción
 *   · que un archivo se entregue solo si su módulo se puede abrir Y su ficha
 *     está dentro del alcance
 *   · y que no se haya cerrado de más: el logo de la institución y el archivo
 *     recién subido siguen como estaban
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
require('../../server/ajustes');
const { db, UPLOADS_DIR } = require('../../server/db');
const permisos = require('../../server/permissions');
const archivos = require('../../server/archivos');

/* ------------------------------- la puerta del módulo */

test('la ayuda social queda cerrada para quien solo consulta', () => {
  assert.deepEqual(permisos.permisosDelRol('consulta', 'ayudas_sociales'), []);
});

test('y queda junto a la ficha de la que sale, para que nadie abra una sin ver la otra', () => {
  assert.deepEqual(permisos.permisosDelRol('consulta', 'no_miembros'), []);
  const src = fs.readFileSync(path.join(__dirname, '../../server/permissions.js'), 'utf8');
  assert.match(src, /no_miembros: \[\],\s*\n\s*ayudas_sociales: \[\],/,
    'escritas seguidas: separadas, un día se abre una y nadie mira la otra');
});

test('la razón queda escrita, con lo que se midió', () => {
  /*
   * No es adorno: la frase que estaba antes —«le basta con el nombre que
   * aparece en la ayuda que esté mirando»— fue lo que dejó la puerta abierta
   * durante versiones. Lo que hay ahora es la medición, que no se puede leer
   * de dos maneras.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/permissions.js'), 'utf8');
  assert.match(src, /listar Ayudas Sociales \.+\s+200, las seis/);
  assert.match(src, /bajarlo todo en planilla, notas incluidas/);
  /*
   * La frase vieja sigue apareciendo, entre comillas y con lo que le pasa
   * detrás: se cita para decir que describía algo distinto de lo que ocurría.
   * La primera versión de esta prueba la prohibía a secas y fallaba por eso —
   * borrar la cita habría dejado el arreglo sin su porqué—.
   */
  assert.match(src, /«le basta con el nombre que aparece en la ayuda que\s+\*\s+esté mirando», y eso describía algo distinto de lo que pasaba/,
    'la frase vieja queda citada y contestada, no borrada');
});

test('a los cuatro que administran las ayudas no les cambia nada', () => {
  for (const rol of ['admin', 'pastor', 'tesorero']) {
    assert.deepEqual(permisos.permisosDelRol(rol, 'ayudas_sociales'), ['view', 'create', 'edit', 'delete'], rol);
  }
  assert.deepEqual(permisos.permisosDelRol('secretario', 'ayudas_sociales'), ['view', 'create', 'edit']);
});

test('y quien de verdad la necesite la recibe por su nombre', () => {
  // Las excepciones por persona mandan sobre el rol: es la salida que ya tiene
  // el sistema para no abrirle el módulo a todo un rol por una persona.
  const suyo = { rol: 'consulta', permisos: JSON.stringify({ ayudas_sociales: ['view'] }) };
  assert.equal(permisos.can(suyo, 'ayudas_sociales', 'view'), true);
  assert.equal(permisos.can({ rol: 'consulta' }, 'ayudas_sociales', 'view'), false);
});

/* ------------------------------- la novena puerta: el archivo */

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la ayuda','IG-AYU1','Activa')")
  .run().lastInsertRowid;
const persona = db.prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Berta','Loyola de la Ayuda',?)")
  .run(iglesia).lastInsertRowid;

const LA_BOLETA = 'boleta-de-la-ayuda-social.txt';
fs.writeFileSync(path.join(UPLOADS_DIR, LA_BOLETA), 'BOLETA DE PRUEBA');
db.prepare(
  'INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id, beneficiario, tipo_ayuda, estado, soporte, notas)'
  + " VALUES ('2026-03-10', ?, 'No miembro', ?, 'Berta Loyola de la Ayuda', 'Alimentos', 'Entregada', ?, 'Está en tratamiento.')"
).run(iglesia, persona, LA_BOLETA);

const QUIEN_ADMINISTRA = { id: 1, rol: 'secretario' };
const SOLO_CONSULTA = { id: 2, rol: 'consulta' };

test('quien tiene el módulo cerrado tampoco baja su archivo', () => {
  const r = archivos.puedeVer(LA_BOLETA, SOLO_CONSULTA);
  assert.equal(r.ok, false, 'cerrar el módulo tiene que cerrar también su boleta');
  assert.match(r.motivo, /módulo que su cuenta no tiene habilitado/,
    'y con su motivo escrito, que es lo que lee quien se topa con esto');
});

test('y quien lo tiene abierto la baja como siempre', () => {
  assert.equal(archivos.puedeVer(LA_BOLETA, QUIEN_ADMINISTRA).ok, true);
});

test('las dos preguntas se hacen, no una', () => {
  /*
   * El alcance dice de qué iglesias; el permiso, qué módulos. Al de consulta
   * el alcance le contestaba que sí —no está acotado a ninguna iglesia— y por
   * eso el archivo salía igual. Las dos tienen que estar.
   */
  const deOtraIglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de la ayuda','IG-AYU2','Activa')")
    .run().lastInsertRowid;
  const ajena = { id: 3, rol: 'secretario', iglesia_id: deOtraIglesia, iglesias: [deOtraIglesia] };
  const r = archivos.puedeVer(LA_BOLETA, ajena);
  assert.equal(r.ok, false, 'el alcance sigue mandando para quien sí tiene el módulo');
  assert.match(r.motivo, /fuera de lo que tiene asignado/);
});

test('vale para cualquier módulo cerrado, no solo para las ayudas', () => {
  /*
   * Es lo que hace que este arreglo rinda: al rol de consulta también se le
   * cierran las credenciales y la tesorería, y sus archivos salían igual.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/archivos.js'), 'utf8');
  assert.match(src, /if \(!can\(usuario, dueno\.def\.name, 'view'\)\) \{/,
    'la pregunta se le hace al módulo dueño del archivo, sea cual sea');

  const suDocumento = 'documento-de-un-modulo-cerrado.txt';
  fs.writeFileSync(path.join(UPLOADS_DIR, suDocumento), 'x');
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa','De la Ayuda',?,'Activo')")
    .run(iglesia).lastInsertRowid;
  db.prepare(
    'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo)'
    + " VALUES (?,?,'Carnet de identidad','Su carnet','2020-04-12',?)"
  ).run(miembro, iglesia, suDocumento);
  // Documentos de Miembros sí está abierto para consulta: su carnet sale
  assert.equal(archivos.puedeVer(suDocumento, SOLO_CONSULTA).ok, true,
    'no se cerró de más: lo que el rol sí tiene abierto sigue abierto');
});

test('no se cerró de más: el logo de la institución y el recién subido siguen igual', () => {
  const logo = 'logo-de-la-institucion-ayuda.png';
  fs.writeFileSync(path.join(UPLOADS_DIR, logo), 'PNG');
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('logo_prueba_ayuda', ?)").run(logo);
  assert.equal(archivos.puedeVer(logo, SOLO_CONSULTA).ok, true,
    'no es de ninguna ficha y sale en las credenciales y las actas: se entrega a quien tenga sesión');

  const recien = 'recien-subido-por-la-ayuda.txt';
  fs.writeFileSync(path.join(UPLOADS_DIR, recien), 'x');
  archivos.recordarQuienSubio(recien, SOLO_CONSULTA.id);
  assert.equal(archivos.puedeVer(recien, SOLO_CONSULTA).ok, true, 'lo ve quien lo subió');
  assert.equal(archivos.puedeVer(recien, QUIEN_ADMINISTRA).ok, false, 'y nadie más');
});
