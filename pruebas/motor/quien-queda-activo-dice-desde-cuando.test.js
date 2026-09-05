/**
 * UN INTEGRANTE PUESTO «ACTIVO» A MANO QUEDABA SIN LA FECHA EN QUE PASÓ A SERLO.
 *
 * El camino que el sistema espera funciona bien: la ficha entra «En prueba»,
 * se evalúa, y al aprobar el informe pasa a «Activo» con la fecha del día en
 * que se aprobó. El campo lo dice: «La fecha en que se aprobó su informe. La
 * pone la evaluación».
 *
 * Pero el estado es una lista de tres y nada impide elegir «Activo», que
 * además es lo que uno hace al cargar por primera vez a los que ya estaban.
 * Medido en la v1.398.0, los dos caminos hasta «Activo»:
 *
 *   por su evaluación, aprobada ....  pasó a oficial el 20-03-2026
 *   escribiéndolo en la ficha ......  (vacío)
 *
 * La ficha quedaba diciendo que es integrante oficial sin decir desde cuándo,
 * y eso es lo que muestra su hoja impresa en esa columna: quien la mire no
 * sabe si falta el dato o faltó la evaluación.
 *
 * Y había una segunda mitad de lo mismo: la evaluación aprobada deja el plazo
 * de la prueba en blanco, y poniendo «Activo» a mano se quedaba puesto, así
 * que la ficha de alguien que ya es oficial seguía mostrando «Termina el
 * período de prueba: 10-04-2026».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const integrantes = require('../../server/modules/integrantes_cuerpo');
const { hoy } = require('../../server/fechas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central OF ${marca}`, `OF-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas OF ${marca}`, iglesia).lastInsertRowid;

const alguien = () => db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(`Quien${++n}`, `Sirve OF ${marca}`, iglesia).lastInsertRowid;

/**
 * Lo que el gancho deja escrito en los datos, sin llegar a guardar.
 *
 * Se exige que el gancho NO haya rechazado. Sin eso, una prueba mal armada se
 * pasa por buena: al escribir este archivo faltaba el `id` de la ficha que se
 * está editando, así que la comprobación de repetidos la encontraba a ella
 * misma —«ya tiene su ficha en este cuerpo»— y el gancho salía antes de llegar
 * a lo que se quería mirar. Los campos quedaban en `undefined` y tres de las
 * pruebas decían que el arreglo no funcionaba, cuando el que estaba mal era el
 * andamio.
 */
function alGuardar(datos, existing) {
  const copia = {
    cuerpo_id: cuerpo, persona_tipo: 'Miembro',
    miembro_id: existing ? existing.miembro_id : alguien(),
    ...datos,
  };
  const error = integrantes.hooks.beforeSave(copia, {
    existing: existing || null,
    id: existing ? existing.id : undefined,
    db,
    confirmado: true,
  });
  assert.equal(error, null, `el gancho rechazó el guardado: ${JSON.stringify(error)}`);
  return { error, datos: copia };
}

/** Una ficha guardada de verdad, para tener un «existing» que sea el de la base. */
function fichaGuardada(estado, campos = {}) {
  const miembro = alguien();
  const id = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, fecha_oficial, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, ?, ?, ?, ?, ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve OF ${marca}`, estado,
    campos.fecha_ingreso || '2026-01-10', campos.fecha_fin_prueba || null,
    campos.fecha_oficial || null, iglesia).lastInsertRowid;
  return db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(id);
}

test('una ficha que nace «Activo» pasó a oficial el día que entró', () => {
  // No hay prueba que contar: la ficha está diciendo que esa persona es
  // integrante oficial desde que entró, así que esa es la fecha que afirma.
  // Es lo mismo que hace la regla de la directiva al meter a un líder por su
  // cargo: inserta la ficha con fecha_ingreso y fecha_oficial iguales.
  const { datos } = alGuardar({ estado: 'Activo', fecha_ingreso: '2019-04-20' }, null);
  assert.equal(datos.fecha_oficial, '2019-04-20', 'antes quedaba en blanco');
});

test('una que nace «En prueba» no pasó a oficial todavía', () => {
  const { datos } = alGuardar({ estado: 'En prueba', fecha_ingreso: '2026-01-10' }, null);
  assert.equal(datos.fecha_oficial, null);
  assert.ok(datos.fecha_fin_prueba, 'y sí tiene plazo, que es lo que le toca');
});

test('la que pasa a «Activo» hoy, pasó a oficial hoy', () => {
  // Su fecha de ingreso es de cuando empezó la prueba: ponerla ahí adelantaría
  // el hecho.
  const antes = fichaGuardada('En prueba', { fecha_ingreso: '2026-01-10', fecha_fin_prueba: '2026-04-10' });
  const { datos } = alGuardar({ estado: 'Activo', fecha_ingreso: '2026-01-10' }, antes);
  assert.equal(datos.fecha_oficial, hoy());
  assert.notEqual(datos.fecha_oficial, antes.fecha_ingreso);
});

test('y con eso el plazo de la prueba se cierra, como lo cierra la evaluación', () => {
  const antes = fichaGuardada('En prueba', { fecha_ingreso: '2026-01-10', fecha_fin_prueba: '2026-04-10' });
  const { datos } = alGuardar({ estado: 'Activo', fecha_ingreso: '2026-01-10' }, antes);
  assert.equal(datos.fecha_fin_prueba, null,
    'antes se quedaba puesto y la ficha decía que a un oficial le corre un plazo');
});

test('la fecha que ya está no se pisa: la que puso la evaluación manda', () => {
  const evaluado = fichaGuardada('Activo', { fecha_ingreso: '2026-01-10', fecha_oficial: '2026-03-20' });
  const { datos } = alGuardar({ estado: 'Activo', fecha_ingreso: '2026-01-10', observaciones: 'Nota' }, evaluado);
  assert.equal(datos.fecha_oficial, undefined, 'el gancho no la toca, así que sigue siendo la de la base');
});

test('a la que YA estaba «Activo» sin fecha no se le inventa una', () => {
  // Eso pasó antes de que el sistema preguntara. Estampar hoy una fecha vieja
  // al corregir una nota sería escribir un hecho que no ocurrió.
  const vieja = fichaGuardada('Activo', { fecha_ingreso: '2018-05-05' });
  const { datos } = alGuardar({ estado: 'Activo', fecha_ingreso: '2018-05-05', observaciones: 'Nota' }, vieja);
  assert.equal(datos.fecha_oficial, undefined);
});

test('quien vuelve a la prueba deja de ser oficial, y la fecha se borra', () => {
  // Es lo que hace la evaluación cuando el informe no se aprueba:
  // server/modules/evaluaciones_integrantes.js pone `fecha_oficial = NULL`.
  const oficial = fichaGuardada('Activo', { fecha_ingreso: '2026-01-10', fecha_oficial: '2026-03-20' });
  const { datos } = alGuardar({ estado: 'En prueba', fecha_ingreso: '2026-01-10' }, oficial);
  assert.equal(datos.fecha_oficial, null);
  assert.ok(datos.fecha_fin_prueba, 'y le vuelve a correr un plazo');
});

test('pero quien se retira la conserva: eso es historia', () => {
  const oficial = fichaGuardada('Activo', { fecha_ingreso: '2019-04-20', fecha_oficial: '2019-04-20' });
  const { datos } = alGuardar(
    { estado: 'Retirado', fecha_ingreso: '2019-04-20', fecha_retiro: '2026-08-01', motivo_retiro: 'Cambio de ciudad' },
    oficial,
  );
  assert.equal(datos.fecha_oficial, undefined, 'no se toca: fue integrante oficial desde esa fecha');
});

test('la ayuda del campo cuenta los dos caminos, no solo el de la evaluación', () => {
  const campo = integrantes.fields.find((f) => f.name === 'fecha_oficial');
  assert.match(campo.help, /evaluación/);
  assert.match(campo.help, /a mano/, 'quien pone «Activo» a mano tiene que saber qué se anota');
});

test('por la puerta: cargar a quien ya estaba deja su ficha completa', async () => {
  const api = await elSistemaAndando();
  const miembro = alguien();
  const alta = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cuerpo, persona_tipo: 'Miembro', miembro_id: miembro,
    estado: 'Activo', fecha_ingreso: '2019-04-20',
  });
  assert.equal(alta.estado, 201, alta.texto);
  assert.equal(alta.json.fecha_oficial, '2019-04-20');

  const subida = await api('PUT', `/integrantes_cuerpo/${alta.json.id}`, {
    cuerpo_id: cuerpo, persona_tipo: 'Miembro', miembro_id: miembro,
    estado: 'En prueba', fecha_ingreso: '2026-01-10',
  });
  assert.equal(subida.estado, 200, subida.texto);
  assert.equal(subida.json.fecha_oficial, null, 'vuelve a la prueba: deja de ser oficial');

  const oficial = await api('PUT', `/integrantes_cuerpo/${alta.json.id}`, {
    cuerpo_id: cuerpo, persona_tipo: 'Miembro', miembro_id: miembro,
    estado: 'Activo', fecha_ingreso: '2026-01-10',
  });
  assert.equal(oficial.estado, 200, oficial.texto);
  assert.equal(oficial.json.fecha_oficial, hoy());
  assert.equal(oficial.json.fecha_fin_prueba, null);
});
