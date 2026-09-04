/**
 * EL MOTIVO DE UNA JUSTIFICACIÓN SE COMPRUEBA CONTRA LA LISTA, POR LAS DOS
 * PUERTAS.
 *
 * El módulo de Motivos de Ausencia acotaba el desplegable del navegador y nada
 * más. Y acá hay una puerta más que en Tipos de Actividad: la PANTALLA DE PASAR
 * LISTA, que es por donde entran todas las marcas, escribe derecho en la base
 * sin pasar por el guardado del módulo.
 *
 * MEDIDO en la v1.362.0, contra el sistema andando, por las dos:
 *
 *                                  por la ficha   por la toma de lista
 *   «Motivo Que No Existe» ......... 201            200
 *   uno desactivado ................ 201            200
 *   «enfermedad», en minúscula ..... 201            200 · quedó «enfermedad»
 *
 * La tercera es la que muerde en el día a día: el informe de asistencia agrupa
 * por el texto guardado, así que «Enfermedad» y «enfermedad» salen como dos
 * motivos distintos en la misma tabla.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

after(cerrarElSistema);

const MARCA = `x${process.pid}`;

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia del motivo ${MARCA}`, `IG-MO${process.pid}`.slice(0, 12)).lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(`Damas del motivo ${MARCA}`, iglesia).lastInsertRowid;
const miembro = db
  .prepare(
    `INSERT INTO miembros (iglesia_id, rut, nombres, apellidos, estado)
     VALUES (?, ?, 'Rosa Elena', 'Muñoz Díaz', 'Activo')`
  ).run(iglesia, `${process.pid}77-0`).lastInsertRowid;
db.prepare(
  `INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, estado, fecha_ingreso)
   VALUES (?, 'Miembro', ?, 'Activo', '2026-01-01')`
).run(cuerpo, miembro);
const actividad = db
  .prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
     VALUES ('2026-08-02', 'Servicio General', ?, ?)`
  ).run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
/** Otra reunión del mismo cuerpo, para lo que se comprueba POR ACTIVIDAD. */
const otraActividad = db
  .prepare(
    `INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos)
     VALUES ('2026-08-09', 'Servicio General', ?, ?)`
  ).run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;

/** Un motivo propio de este archivo: la lista es de todos los que corren. */
const unMotivo = (nombre, { activo = 1, pideDetalle = 0 } = {}) => db
  .prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, ?)')
  .run(`${nombre} ${MARCA}`, pideDetalle, activo).lastInsertRowid;

const SUYO = `Cuidando a su madre ${MARCA}`;
unMotivo('Cuidando a su madre');

const limpiar = () =>
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(actividad);

/**
 * Por la ficha suelta de una marca. Desde la v1.381.0 esa puerta no existe.
 *
 * Se deja el ayudante porque este archivo se escribió sobre la idea de que hay
 * DOS puertas y las dos tienen que comprobar lo mismo. Hoy hay una, y la manera
 * de que eso siga siendo verdad no es repetir la comprobación en la otra: es
 * que la otra no deje escribir. Eso es lo que se comprueba abajo, una vez.
 */
const porLaFicha = (api, motivo, extra) => {
  limpiar();
  return api('POST', '/asistencia_detalle', Object.assign({
    asistencia_id: actividad, persona_tipo: 'Miembro', miembro_id: miembro,
    iglesia_id: iglesia, cuerpo_id: cuerpo, fecha: '2026-08-02', estado: 'Justificado', motivo,
  }, extra));
};

/** Por la pantalla de pasar lista, que es por donde entran todas. */
const porLaLista = (api, motivo, extra) => {
  limpiar();
  return api('POST', `/asistencias/${actividad}/lista`, {
    marcas: [Object.assign({ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado', motivo }, extra)],
  });
};

const comoQuedo = () =>
  db.prepare('SELECT motivo FROM asistencia_detalle WHERE asistencia_id = ?').get(actividad);

/* ─────────────────────────── lo que no entra ──────────────────────────── */

test('la ficha suelta de una marca ya no escribe: queda una sola puerta', async () => {
  const api = await elSistemaAndando();
  const r = await porLaFicha(api, `Motivo Que No Existe ${MARCA}`);
  assert.equal(r.estado, 400, r.texto.slice(0, 160));
  assert.match(r.json.error, /pasando lista en la pantalla de Asistencia/,
    'no la rechaza el motivo: la rechaza la puerta (v1.381.0)');
  assert.equal(comoQuedo(), undefined);
});

test('ni por la pantalla de pasar lista, que es por donde entran todas', async () => {
  const api = await elSistemaAndando();
  const r = await porLaLista(api, `Motivo Que No Existe ${MARCA}`);
  assert.equal(r.estado, 400,
    `esta ruta escribe derecho en la base, sin pasar por el guardado del módulo (${r.texto.slice(0, 160)})`);
  assert.match(r.json.error, /no está en Motivos de Ausencia/);
  assert.equal(comoQuedo(), undefined, 'y no quedó ninguna marca');
});

test('uno desactivado no se puede poner', async () => {
  const api = await elSistemaAndando();
  const apagado = `Viaje fuera de la ciudad ${MARCA}`;
  unMotivo('Viaje fuera de la ciudad', { activo: 0 });

  const r = await porLaLista(api, apagado);
  assert.equal(r.estado, 400, r.texto.slice(0, 140));
  assert.match(r.json.error, /ya no está en uso/);
  assert.match(r.json.error, /vuelva a marcarlo «En uso»/);
});

/* ──────────────────────────── lo que sí entra ─────────────────────────── */

test('uno de la lista se guarda', async () => {
  const api = await elSistemaAndando();
  const r = await porLaLista(api, SUYO);
  assert.equal(r.estado, 200, r.texto.slice(0, 160));
  assert.equal(comoQuedo().motivo, SUYO);
});

test('y escrito con otras mayúsculas queda como está en la lista', async () => {
  /*
   * El informe de asistencia agrupa por el texto guardado: dos formas de
   * escribirlo lo parten en dos.
   */
  const api = await elSistemaAndando();
  await porLaLista(api, SUYO.toUpperCase());
  assert.equal(comoQuedo().motivo, SUYO, 'quedó como está en la lista, no como se escribió');
});

test('lo que no es una justificación no lleva motivo, y eso no se comprueba', async () => {
  const api = await elSistemaAndando();
  limpiar();
  const r = await api('POST', `/asistencias/${actividad}/lista`, {
    marcas: [{ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Ausente' }],
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(comoQuedo().motivo, null);
});

test('una marca vieja con un motivo que después se apagó se sigue pudiendo corregir', async () => {
  /*
   * Es el mismo criterio del motor con los desplegables: se mira lo que ESTE
   * guardado está cambiando. Desactivar un motivo no puede dejar imposibles de
   * guardar las marcas que ya lo tenían.
   *
   * Esto se comprobaba por la ficha suelta, donde lo aplicaba el motor. Cerrada
   * esa puerta (v1.381.0), la toma de lista tuvo que aprenderlo: hasta entonces
   * comprobaba TODOS los motivos que le llegaran contra los activos, y con la
   * otra puerta cerrada esta marca se quedaba sin ninguna forma de corregirse
   * —contestaba 400 pidiendo elegir otro motivo, que es cambiar justamente lo
   * que no se quería cambiar—.
   */
  const api = await elSistemaAndando();
  const suyo = `Duelo familiar ${MARCA}`;
  const id = unMotivo('Duelo familiar');
  const creada = await porLaLista(api, suyo, { detalle: 'falleció su padre' });
  assert.equal(creada.estado, 200, creada.texto.slice(0, 200));

  db.prepare('UPDATE motivos_ausencia SET activo = 0 WHERE id = ?').run(id);
  const r = await api('POST', `/asistencias/${actividad}/lista`, {
    marcas: [{
      miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado',
      motivo: suyo, detalle: 'falleció su padre, corregido',
    }],
  });
  assert.equal(r.estado, 200, `no se está cambiando el motivo (${r.texto.slice(0, 200)})`);
  assert.equal(comoQuedo().motivo, suyo, 'y el motivo que ya tenía se queda');
});

test('y la excepción es de ESA marca: en otra reunión el motivo apagado no entra', async () => {
  /*
   * Lo que se permite es CONSERVAR el motivo que esa marca ya tenía, no volver
   * a usar uno apagado en cualquier parte. Sin esta prueba, mirar «¿esta persona
   * tiene alguna marca con ese motivo?» en vez de «¿la tiene EN ESTA actividad?»
   * pasaba sin que nada se pusiera rojo —comprobado rompiéndolo a propósito—.
   */
  const api = await elSistemaAndando();
  const suyo = `Duelo familiar ${MARCA}`;   // sigue desactivado, y la marca de la
                                            // otra actividad lo tiene puesto
  const r = await api('POST', `/asistencias/${otraActividad}/lista`, {
    marcas: [{ miembro_id: miembro, cuerpo_id: cuerpo, estado: 'Justificado', motivo: suyo, detalle: 'x' }],
  });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /ya no está en uso/);
});

test('pero a una marca que NO lo tenía no se le pone un motivo apagado', async () => {
  const api = await elSistemaAndando();
  const suyo = `Duelo familiar ${MARCA}`;   // quedó desactivado en la prueba anterior
  limpiar();
  const r = await porLaLista(api, suyo, { detalle: 'nadie lo había puesto' });
  assert.equal(r.estado, 400, r.texto.slice(0, 200));
  assert.match(r.json.error, /ya no está en uso/, 'la excepción es para el que ya estaba, no para poner uno nuevo');
});

/* ───────────────── las dos puertas preguntan lo mismo ─────────────────── */

test('las dos puertas usan la misma cuenta para buscar en la lista', () => {
  const fs = require('fs');
  const path = require('path');
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/modules/asistencias.js'), 'utf8');
  assert.match(fuente, /require\('\.\.\/opciones'\)\.laFilaDeLaLista/,
    'dos maneras de comparar serían dos verdades: la toma de lista pregunta con la del motor');
});
