/**
 * Borrar una actividad se lleva su lista, y eso se pregunta antes.
 *
 * El gancho de borrado hacía el `DELETE` de las marcas él mismo y devolvía
 * `null`: ni preguntaba ni contaba. Medido en la v1.374.0 sobre una actividad
 * con la lista pasada —cincuenta marcas—: borrar sin confirmar contestó 200,
 * las cincuenta se fueron, y la constancia del Registro de Cambios nombraba la
 * fecha, los cuerpos, el tipo y el nombre de la actividad, y ni una palabra de
 * las marcas.
 *
 * Las dos mitades se arreglan juntas y por la misma razón: quien borra tiene
 * que saber qué se lleva ANTES, y quien lo revise después tiene que poder
 * saberlo también. La cuenta la hace el motor —el mismo que ya escribe «Se
 * llevó consigo N registro(s)» en los demás módulos—, y para eso el gancho
 * tiene que dejar de borrarlas a mano.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central LS ${marca}`, `LS-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas LS ${marca}`, iglesia).lastInsertRowid;
for (let i = 0; i < 3; i++) {
  const numero = `${19000000 + (marca * 11 + i) % 900000}`;
  const id = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(`Persona${i}`, `LS ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, estado, fecha_ingreso, iglesia_id)
     VALUES (?,?,'Miembro','Activo','2026-01-01',?)`
  ).run(cuerpo, id, iglesia);
}
const TIPO = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY id LIMIT 1').get().nombre;

/** Una actividad con su lista pasada, lista para borrar. */
async function conSuLista(api, nombre) {
  const act = (await api('POST', '/asistencias', {
    fecha: '2026-06-21', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre,
  })).json;
  const lista = (await api('GET', `/asistencias/${act.id}/lista`)).json;
  await api('POST', `/asistencias/${act.id}/lista`, {
    marcas: (lista.personas || []).map((p) => ({
      clave: p.clave, miembro_id: p.miembro_id, no_miembro_id: p.no_miembro_id, cuerpo_id: p.cuerpo_id, estado: 'Presente',
    })),
  });
  return act;
}
const cuantasMarcas = (id) =>
  db.prepare('SELECT COUNT(*) AS n FROM asistencia_detalle WHERE asistencia_id = ?').get(id).n;

test('borrar una actividad con su lista pregunta antes, diciendo cuántas se lleva', async () => {
  const api = await elSistemaAndando();
  const act = await conSuLista(api, `Culto LS ${marca}`);
  assert.equal(cuantasMarcas(act.id), 3, 'la lista quedó pasada');

  const sinConfirmar = await api('DELETE', `/asistencias/${act.id}`);
  assert.equal(sinConfirmar.estado, 400, sinConfirmar.texto.slice(0, 160));
  assert.match(sinConfirmar.json.error, /3 marca\(s\) de asistencia tomadas el 21-06-2026/);
  assert.match(sinConfirmar.json.error, /los informes de ese período dejan de contarlo/);
  assert.equal(sinConfirmar.json.confirmar, 'actividad_con_lista', 'la pantalla ofrece los dos botones');

  assert.equal(cuantasMarcas(act.id), 3, 'preguntar no borra nada');
  assert.ok(db.prepare('SELECT id FROM asistencias WHERE id = ?').get(act.id), 'ni la actividad');
});

test('confirmando se borra, y la lista se va con ella', async () => {
  const api = await elSistemaAndando();
  const act = await conSuLista(api, `Culto LS confirmado ${marca}`);
  const r = await api('DELETE', `/asistencias/${act.id}?igual_asi=true`);
  assert.equal(r.estado, 200, r.texto.slice(0, 160));
  assert.equal(cuantasMarcas(act.id), 0);
  assert.equal(db.prepare('SELECT id FROM asistencias WHERE id = ?').get(act.id), undefined);
});

test('y la constancia dice cuántas se llevó', () => {
  const linea = db
    .prepare(
      /*
       * Se busca por el DETALLE y no por el «registro»: el nombre con que una
       * actividad se presenta es «{tipo} — {fecha}», que es igual para las tres
       * de esta prueba. El nombre propio de la actividad va en el detalle.
       */
      `SELECT detalle FROM registro_cambios
        WHERE modulo = 'Asistencias' AND accion = 'Eliminación' AND detalle LIKE ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(`%LS confirmado ${marca}%`);
  assert.ok(linea, 'el borrado de la actividad no quedó anotado');
  assert.match(linea.detalle, /Se llevó consigo 3 registro\(s\): 3 en Toma de Asistencia\./);
});

test('una actividad sin lista no pregunta nada: no hay nada que perder', async () => {
  const api = await elSistemaAndando();
  const act = (await api('POST', '/asistencias', {
    fecha: '2026-06-22', cuerpos: [cuerpo], tipo_reunion: TIPO, nombre: `Sin lista LS ${marca}`,
  })).json;
  const r = await api('DELETE', `/asistencias/${act.id}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 160));
});

test('las marcas las arrastra el MOTOR: es quien las cuenta', () => {
  /*
   * Si el gancho vuelve a borrarlas a mano, el borrado sigue funcionando y la
   * constancia vuelve a quedarse muda —el motor no encuentra nada que
   * arrastrar—. Eso no lo nota ninguna prueba de comportamiento, así que se
   * mira acá.
   */
  const texto = fs.readFileSync(path.join(__dirname, '../../server/modules/asistencias.js'), 'utf8');
  const gancho = texto.slice(texto.indexOf('beforeDelete(fila'), texto.indexOf('extraRoutes('));
  assert.ok(!/DELETE FROM asistencia_detalle/.test(gancho),
    'el gancho volvió a borrar las marcas a mano: la constancia se queda sin decir cuántas se llevó');
  const detalle = require('../../server/modules/asistencia_detalle');
  const suyo = detalle.fields.find((f) => f.name === 'asistencia_id');
  assert.equal(suyo.required, true, 'y es lo que hace que el motor las arrastre en vez de soltarlas');
});
