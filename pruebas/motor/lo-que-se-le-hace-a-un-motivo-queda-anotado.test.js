/**
 * LO QUE SE LE HACE A UN MOTIVO DE AUSENCIA QUEDA EN EL REGISTRO DE CAMBIOS.
 *
 * Renombrar un motivo, desactivarlo o cambiarle la casilla «Pide explicación»
 * cambia cómo se lee un informe de asistencia de años, y no dejaba rastro en
 * ninguna parte. MEDIDO en la v1.362.0: cero líneas del módulo.
 *
 * HABÍA UNA SEÑAL de que esto se decidió hace tiempo y nadie lo volvió a mirar:
 * este módulo era el ejemplo que usaba la suite de seguridad para comprobar que
 * «un módulo que no es del dinero también deja rastro al borrarse», y lo era
 * precisamente porque NO estaba vigilado. Heredó ese puesto en la v1.346.0,
 * cuando las categorías de tesorería entraron a la lista.
 *
 * Desde la v1.365.0 hay una razón más: renombrar un motivo en uso arrastra las
 * marcas de asistencia a su nombre nuevo, y una operación que mueve datos de
 * años tiene que quedar anotada.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { MODULOS_VIGILADOS } = require('../../server/bitacora');

after(cerrarElSistema);

const MARCA = `w${process.pid}`;

const unMotivo = async (api, nombre) => {
  const r = await api('POST', '/motivos_ausencia', { nombre: `${nombre} ${MARCA}`, activo: 1, pide_detalle: 0 });
  assert.equal(r.estado, 201, r.texto.slice(0, 220));
  return r.json;
};

const lineasDe = (nombre) => db
  .prepare('SELECT * FROM registro_cambios WHERE registro = ? ORDER BY id').all(nombre);

/* ─────────────────────── el módulo está en la lista ───────────────────── */

test('los motivos de ausencia están entre los módulos vigilados', () => {
  assert.ok(MODULOS_VIGILADOS.includes('motivos_ausencia'),
    'los tipos de actividad entraron en la v1.353.0 por la misma razón');
});

test('y el ejemplo de la suite de seguridad ya no es éste', () => {
  /*
   * Esa comprobación necesita un módulo que NO esté vigilado. Cuando su ejemplo
   * queda vigilado, deja de probar lo que quiere probar sin ponerse roja: la
   * peor manera de romperse. Ahora la suite lo comprueba ella misma, y acá
   * queda escrito por qué.
   */
  const fs = require('fs');
  const path = require('path');
  const suite = fs.readFileSync(path.join(__dirname, '../../pruebas/seguridad.js'), 'utf8');
  assert.match(suite, /const EJEMPLO = 'no_miembros';/);
  assert.match(suite, /sigue fuera de los módulos vigilados/,
    'la suite tiene que comprobar que su propio ejemplo le sirve');
});

/* ─────────────────── crear, renombrar, apagar y borrar ────────────────── */

test('crear un motivo deja su línea', async () => {
  const api = await elSistemaAndando();
  const m = await unMotivo(api, 'Recién creado');

  const lineas = lineasDe(m.nombre);
  assert.equal(lineas.length, 1, 'medido en la v1.362.0: el módulo dejaba cero líneas');
  assert.equal(lineas[0].accion, 'Creación');
  assert.equal(lineas[0].modulo, 'Motivos de Ausencia');
});

test('desactivarlo, también', async () => {
  const api = await elSistemaAndando();
  const m = await unMotivo(api, 'El que se apaga');

  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, activo: 0 });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.match(lineasDe(m.nombre).map((l) => l.detalle || '').join(' | '), /En uso/,
    'desactivar un motivo cambia lo que se ofrece de ahí en adelante');
});

test('y marcarle «Pide explicación»', async () => {
  const api = await elSistemaAndando();
  const m = await unMotivo(api, 'El que pasa a exigir');

  await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, pide_detalle: 1 });
  assert.match(lineasDe(m.nombre).map((l) => l.detalle || '').join(' | '), /explicación/i,
    'desde ese momento ese motivo exige un porqué: es un cambio de regla');
});

test('renombrarlo deja la línea del motor y la del arrastre', async () => {
  const api = await elSistemaAndando();
  const m = await unMotivo(api, 'El que se renombra');
  const seVaALlamar = `Ya con otro nombre ${MARCA}`;

  const r = await api('PUT', `/motivos_ausencia/${m.id}`, { ...m, nombre: seVaALlamar });
  assert.equal(r.estado, 200, 'sin marcas encima no pregunta nada');

  const detalles = lineasDe(seVaALlamar).concat(lineasDe(m.nombre))
    .map((l) => l.detalle || '').join(' | ');
  assert.match(detalles, new RegExp(seVaALlamar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'el nombre nuevo tiene que quedar dicho');
});

test('borrar uno sin usar deja su línea, como todo lo que se borra', async () => {
  const api = await elSistemaAndando();
  const m = await unMotivo(api, 'El que se borra');

  const r = await api('DELETE', `/motivos_ausencia/${m.id}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.ok(lineasDe(m.nombre).some((l) => l.accion === 'Eliminación'));
});
