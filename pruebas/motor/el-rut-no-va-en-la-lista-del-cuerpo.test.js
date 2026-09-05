/**
 * LA LISTA DE INTEGRANTES DE UN CUERPO NO REPARTE EL RUT.
 *
 * El RUT es uno de los datos reservados del sistema, con su propia llave —«RUT
 * y fecha de nacimiento de las fichas»—: quien no la tiene ve la ficha completa
 * menos eso, no lo baja en la planilla y tampoco puede dar con alguien
 * buscándolo por su RUT.
 *
 * La ruta que dibuja el panel de integrantes de un cuerpo lo mandaba igual, sin
 * mirar la llave. Medido en la v1.393.0 con una cuenta de consulta que la tenía
 * cerrada: el listado de Miembros venía sin el RUT y su ficha también, y esta
 * lista traía los CINCUENTA de un cuerpo, completos.
 *
 * Y no lo usaba nadie: la pantalla de la ficha del cuerpo dibuja el nombre, las
 * fechas y las marcas, y la hoja impresa lo excluye a propósito desde la
 * 1.255.0. Era un dato bajo llave viajando al navegador de quien no debía
 * tenerlo, para no pintarse en ninguna parte.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central RL ${marca}`, `RL-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas RL ${marca}`, iglesia).lastInsertRowid;

/** Tres personas con RUT, metidas al cuerpo. */
for (let i = 0; i < 3; i++) {
  const quien = db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(`Quien${i}`, `Pertenece RL ${marca}`, `${40000000 + marca * 3 + i}-K`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-05', ?)`
  ).run(cuerpo, quien, `Quien${i} Pertenece RL ${marca}`, iglesia);
}

test('la lista del cuerpo no trae el RUT de nadie, ni para el administrador', async () => {
  const api = await elSistemaAndando();
  const r = await api('GET', `/cuerpos/${cuerpo}/integrantes`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const gente = r.json.integrantes || [];
  assert.equal(gente.length, 3, 'las tres tienen que venir');
  for (const g of gente) {
    assert.ok(!('rut' in g), `«${g.nombre}» sigue trayendo el campo del RUT`);
  }
  assert.ok(!/\d{7,8}-[\dkK]/.test(JSON.stringify(gente)),
    'y ningún RUT se cuela por otro campo');
});

test('lo que la lista sí trae es lo que la pantalla dibuja', async () => {
  const api = await elSistemaAndando();
  const uno = (await api('GET', `/cuerpos/${cuerpo}/integrantes`)).json.integrantes[0];
  for (const cual of ['nombre', 'estado', 'fecha_ingreso', 'persona_tipo', 'lidera', 'exento_cuota']) {
    assert.ok(cual in uno, `«${cual}» hace falta y tiene que seguir`);
  }
});

test('y nadie lo usaba: la pantalla y la hoja no lo nombran', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('/cuerpos/${cuerpoId}/integrantes');
  assert.ok(desde > 0, 'no se encontró el panel de integrantes de la ficha del cuerpo');
  const panel = app.slice(desde, desde + 4500);
  assert.ok(!/\bg\.rut\b/.test(panel), 'el panel del cuerpo nunca dibujó el RUT');
  const hoja = app.indexOf('const susIntegrantes = suGente');
  assert.ok(hoja > 0, 'no se encontró la parte de la hoja impresa');
  assert.ok(!/\.rut\b/.test(app.slice(hoja, hoja + 2500)),
    'la hoja impresa lo excluye a propósito desde la 1.255.0');
});
