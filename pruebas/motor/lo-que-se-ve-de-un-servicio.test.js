/**
 * LO QUE MUESTRA LA PANTALLA DE REGISTRO DE SERVICIOS.
 *
 * Seis datos, pedidos así por la corporación: la fecha, qué servicio fue,
 * quiénes lo llevaron —coordinador, salmista y predicador— y cuánta gente
 * hubo. Es lo que se mira para saber quién estuvo a cargo del culto del
 * viernes, que es la pregunta con que se abre esta pantalla.
 *
 * Salieron tres que estaban: la hora de inicio, el pasaje del mensaje y la
 * ofrenda. Los tres siguen en la ficha y en la hoja impresa.
 *
 * Del listado cuelgan dos cosas más, y por eso se comprueban acá: la
 * constancia de un borrado se arma con lo que el listado muestra, así que
 * sacar la ofrenda de la vista la habría sacado también de ahí —borrar un
 * servicio dejaría de decir cuánta plata tenía anotada—; y el acotar por rango
 * de ofrenda se va con ella, porque el sistema solo deja filtrar por una cifra
 * que esté a la vista.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const registry = require('../../server/registry');
const { getModule } = registry;
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const servicios = getModule('servicios');
const marca = process.pid % 100000;
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central SV ${marca}`, `SV-${marca}`).lastInsertRowid;

test('la pantalla muestra los seis datos pedidos, en ese orden', () => {
  assert.deepEqual(servicios.listFields,
    ['fecha', 'tipo', 'coordinador', 'salmista', 'predicador', 'asistencia_total']);
});

test('los tres que salieron siguen siendo campos del servicio', () => {
  for (const cual of ['hora_inicio', 'cita_mensaje', 'ofrenda_total']) {
    const enLaFicha = servicios.fields.some((f) => f.name === cual)
      || (servicios.computed || []).some((c) => c.name === cual);
    assert.ok(enLaFicha, `«${cual}» salió de la vista, no de la ficha`);
    assert.ok(!servicios.listFields.includes(cual), `«${cual}» tenía que salir del listado`);
  }
});

test('borrar un servicio sigue dejando anotada la ofrenda que tenía', async () => {
  const api = await elSistemaAndando();
  const creado = await api('POST', '/servicios', {
    fecha: '2026-03-20', tipo: 'Servicio General', iglesia_id: iglesia,
    asistencia_adultos: 100, asistencia_ninos: 20, ofrenda_total: 129980,
  });
  assert.equal(creado.estado, 201, creado.texto.slice(0, 200));

  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM registro_cambios').get().n;
  const borrado = await api('DELETE', `/servicios/${creado.json.id}?igual_asi=true`);
  assert.ok([200, 204].includes(borrado.estado), borrado.texto.slice(0, 200));

  const linea = db.prepare(
    "SELECT * FROM registro_cambios WHERE id > ? AND accion = 'Eliminación' AND modulo = ? ORDER BY id")
    .all(desde, servicios.label).pop();
  assert.ok(linea, 'borrar un servicio tiene que dejar constancia');
  assert.match(linea.detalle, /129\.980/,
    'sin `camposAlBorrar`, sacar la ofrenda de la vista la sacaba también de acá');
});

test('y el acotar por rango de ofrenda se fue con ella, que es la regla', () => {
  assert.equal(registry.tieneRangoDeMonto(servicios), false,
    'el sistema solo deja filtrar por una cifra que esté a la vista');
  assert.equal(registry.tieneRangoDeMonto(getModule('tesoreria')), true,
    'y donde el monto sí se ve, el rango sigue estando');
});
