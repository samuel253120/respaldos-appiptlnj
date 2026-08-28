/**
 * Una vigilia empieza a las diez de la noche y termina de madrugada.
 *
 * El módulo ofrece «Servicio Vigilia» entre sus tipos, y sin embargo rechazaba
 * todo servicio cuya hora de término fuera anterior a la de inicio: comparaba
 * las dos horas como si fueran del mismo día. Medido en la revisión del módulo:
 * una vigilia del 5 de septiembre de 22:00 a 02:30 devolvía 400 y no se
 * guardaba. Quien la registraba tenía tres salidas y las tres malas: dejar la
 * hora de término en blanco, inventar una, o no anotar el servicio.
 *
 * Lo que se vigila acá es que la vigilia se guarde, que donde se muestre se
 * diga que el término es del día siguiente —«22:00 a 02:30 del día
 * siguiente»—, y que el error de tipeo que la regla vieja quería atajar se
 * siga atajando: un servicio que sale durando más de doce horas se pregunta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const servicios = require('../../server/modules/servicios');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la Vigilia ZZ','SRV-VIG','Activa')")
  .run().lastInsertRowid;

const horario = servicios.computed.find((c) => c.name === 'horario');

/** Lo que contesta el módulo al guardar: null si pasa, texto u objeto si no. */
const alGuardar = (data, opciones = {}) =>
  servicios.hooks.beforeSave(
    { fecha: '2026-09-05', tipo: 'Servicio Vigilia', iglesia_id: iglesia, ...data },
    { existing: null, db, ...opciones }
  );

/* ---------------------------------------------------------------- guardar */

test('la vigilia que cruza la medianoche se guarda', () => {
  assert.equal(alGuardar({ hora_inicio: '22:00', hora_termino: '02:30' }), null);
});

test('un servicio normal sigue guardándose', () => {
  assert.equal(alGuardar({ hora_inicio: '10:00', hora_termino: '12:00' }), null);
});

test('el rechazo por «término anterior al inicio» ya no existe', () => {
  const respuesta = alGuardar({ hora_inicio: '23:00', hora_termino: '01:00' });
  assert.equal(respuesta, null);
  assert.ok(
    !/no puede ser anterior a la hora de inicio/.test(
      fs.readFileSync(path.join(__dirname, '../../server/modules/servicios.js'), 'utf8')
    ),
    'la regla vieja sigue en el módulo'
  );
});

/* -------------------------------------------------------------- cómo se ve */

test('el horario dice que el término es del día siguiente', () => {
  assert.equal(horario.calc({ hora_inicio: '22:00', hora_termino: '02:30' }), '22:00 a 02:30 del día siguiente');
});

test('un horario del mismo día no dice nada de más', () => {
  assert.equal(horario.calc({ hora_inicio: '10:00', hora_termino: '12:00' }), '10:00 a 12:00');
});

test('un servicio que empieza y termina a la misma hora es del mismo día', () => {
  assert.equal(horario.calc({ hora_inicio: '19:00', hora_termino: '19:00' }), '19:00 a 19:00');
});

test('con una sola de las dos horas, se muestra la que hay', () => {
  assert.equal(horario.calc({ hora_inicio: '19:30' }), '19:30');
  assert.equal(horario.calc({ hora_termino: '21:00' }), 'hasta las 21:00');
  assert.equal(horario.calc({}), '');
});

test('las horas importadas con segundos se leen igual', () => {
  assert.equal(horario.calc({ hora_inicio: '22:00:00', hora_termino: '02:30:00' }), '22:00 a 02:30 del día siguiente');
});

test('una hora que no es una hora no rompe la pantalla', () => {
  assert.equal(horario.calc({ hora_inicio: 'mediodía', hora_termino: '99:99' }), '');
  assert.equal(horario.calc({ hora_inicio: '22:00', hora_termino: 'de madrugada' }), '22:00');
});

/* ------------------------------------------------- el error de tipeo, atajado */

test('un servicio de más de doce horas se pregunta antes de guardar', () => {
  const respuesta = alGuardar({ hora_inicio: '10:00', hora_termino: '09:00' });
  assert.equal(typeof respuesta, 'object');
  assert.equal(respuesta.confirmar, 'el_servicio_duro_muchas_horas');
  assert.match(respuesta.error, /23 horas/);
  assert.match(respuesta.error, /de las 10:00 a las 09:00 del día siguiente/);
});

test('doce horas justas no se preguntan: una vigilia larga es una vigilia', () => {
  assert.equal(alGuardar({ hora_inicio: '21:00', hora_termino: '09:00' }), null);
});

test('una vigilia de las diez a las dos y media pasa sin preguntar nada', () => {
  assert.equal(alGuardar({ hora_inicio: '22:00', hora_termino: '02:30' }), null);
});

test('la duración se cuenta cruzando la medianoche, no al revés', () => {
  // De 23:00 a 12:00 hay trece horas: se pregunta. Contadas del revés serían
  // once y pasaría sin decir nada.
  const respuesta = alGuardar({ hora_inicio: '23:00', hora_termino: '12:00' });
  assert.equal(respuesta.confirmar, 'el_servicio_duro_muchas_horas');
  assert.match(respuesta.error, /13 horas/);
});

test('los minutos se dicen cuando los hay', () => {
  assert.match(alGuardar({ hora_inicio: '08:00', hora_termino: '20:45' }).error, /12 horas y 45 minutos/);
});

test('quien dice que sí, guarda', () => {
  assert.equal(alGuardar({ hora_inicio: '10:00', hora_termino: '09:00' }, { confirmado: true }), null);
});

test('sin una de las dos horas no se pregunta nada', () => {
  assert.equal(alGuardar({ hora_inicio: '22:00' }), null);
  assert.equal(alGuardar({ hora_termino: '02:30' }), null);
});

test('la pregunta se hereda de la ficha guardada, no solo de lo que se manda', () => {
  // Corregirle el término a un servicio que ya tenía inicio también se revisa
  const respuesta = servicios.hooks.beforeSave(
    { hora_termino: '09:00' },
    { existing: { hora_inicio: '10:00', ofrenda_porcentaje: 10 }, db }
  );
  assert.equal(respuesta.confirmar, 'el_servicio_duro_muchas_horas');
});

/* ------------------------------------------------------- lo que ve la gente */

/*
 * El horario completo NO va en el listado, y se midió por qué: la columna es
 * angosta —el listado lleva siete— y «22:00 a 02:30 del día siguiente» parte en
 * cuatro líneas la fila de cada vigilia y en dos la de todos los demás
 * servicios. El listado sigue mostrando la hora de inicio.
 */
test('el listado sigue mostrando la hora de inicio, que es la que se busca', () => {
  assert.ok(servicios.listFields.includes('hora_inicio'), 'el listado se quedó sin la hora');
  assert.ok(!servicios.listFields.includes('horario'), 'el horario entero parte en cuatro líneas cada fila');
});

test('la hoja impresa muestra el horario armado', () => {
  assert.ok(app.includes("fila('Horario', row.horario)"), 'la hoja impresa no usa el horario armado');
  assert.ok(
    !app.includes("[row.hora_inicio, row.hora_termino].filter(Boolean).join(' a ')"),
    'la hoja impresa sigue pegando las dos horas sin decir de qué día es cada una'
  );
});

test('la pantalla sabe explicar la pregunta de las muchas horas', () => {
  assert.match(app, /el_servicio_duro_muchas_horas: \{/);
});

test('la hora de término dice que una vigilia se anota igual', () => {
  const campo = servicios.fields.find((f) => f.name === 'hora_termino');
  assert.match(campo.help, /día siguiente/);
});
