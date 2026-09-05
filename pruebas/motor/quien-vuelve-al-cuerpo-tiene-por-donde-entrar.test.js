/**
 * QUIEN VUELVE NO TENÍA POR DÓNDE VOLVER A ENTRAR.
 *
 * Alguien se retiró de un cuerpo el 30-06-2025 y vuelve el 01-03-2026. Las dos
 * puertas estaban cerradas:
 *
 *   ficha nueva ....  400  «ya tiene su ficha en este cuerpo. Ábrala en vez de
 *                          crear otra»
 *   abrir la suya ..  400  «"Fecha de retiro" (30-06-2025) no puede ser
 *                          anterior a "Fecha de ingreso" (01-03-2026)»
 *
 * La primera es correcta y es el modelo del sistema —server/directiva.js:
 * la ficha se reusa para que el historial de esa persona en ese cuerpo quede
 * en un solo lugar—. La segunda hablaba de un campo QUE LA PANTALLA YA NO
 * MUESTRA: al poner el estado en «En prueba» la sección de Retiro desaparece
 * del formulario, así que esa fecha no se ve, no se puede borrar y no se manda.
 * El aviso salía en rojo al pie y no había nada que corregir arriba.
 *
 * La comprobación de coherencia corre ANTES que el gancho del módulo —que es
 * quien borra la fecha de retiro—, así que comparaba el valor viejo contra el
 * ingreso nuevo. Y el sistema SÍ sabía devolver a alguien a un cuerpo: la
 * regla de la directiva reabre la ficha con un UPDATE que no pasa por ahí. Lo
 * hacía solo y una persona no podía.
 *
 * No era de este módulo: de los 23 pares con `noAntesDe`, 11 comparan un campo
 * condicionado, en seis módulos. Acá se prueban dos —integrantes de cuerpo y
 * cuentas de tesorería— y se comprueba que la regla real sigue exigiéndose
 * cuando las dos fechas están a la vista.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const fechas = require('../../server/fechas');
const integrantes = require('../../server/modules/integrantes_cuerpo');
const cuentas = require('../../server/modules/cuentas_tesoreria');
const inventarios = require('../../server/modules/inventarios');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

// ------------------------------------------------- la regla, por dentro ----

/** La ficha como quedó al retirarse, que es contra lo que se compara. */
const retirada = {
  estado: 'Retirado',
  fecha_ingreso: '2024-01-10',
  fecha_retiro: '2025-06-30',
  motivo_retiro: 'Cambio de ciudad',
};

test('vuelve al cuerpo: la fecha de retiro que la ficha va a perder no lo frena', () => {
  // Es lo que manda la pantalla: el estado nuevo y el ingreso nuevo. La fecha
  // de retiro NO viaja, porque su sección ya no está en el formulario.
  const aviso = fechas.revisarCoherencia(
    integrantes,
    { estado: 'En prueba', fecha_ingreso: '2026-03-01' },
    retirada,
  );
  assert.equal(aviso, null,
    'antes contestaba que el retiro no puede ser anterior al ingreso, hablando de un campo invisible');
});

test('pero si la ficha SIGUE retirada, las dos fechas están a la vista y se exigen', () => {
  const aviso = fechas.revisarCoherencia(
    integrantes,
    { estado: 'Retirado', fecha_ingreso: '2026-03-01', fecha_retiro: '2025-01-01' },
    retirada,
  );
  assert.match(aviso, /"Fecha de retiro" \(01-01-2025\)/);
  assert.match(aviso, /"Fecha de ingreso" \(01-03-2026\)/);
});

test('y las fechas que siempre se ven se siguen comparando igual', () => {
  // fecha_fin_prueba no tiene condición: nunca se salta.
  const aviso = fechas.revisarCoherencia(
    integrantes,
    { estado: 'En prueba', fecha_ingreso: '2026-03-01', fecha_fin_prueba: '2025-12-01' },
    retirada,
  );
  assert.match(aviso, /"Termina el período de prueba" \(01-12-2025\)/);
});

test('no es de un módulo: reabrir una cuenta cerrada tenía el mismo callejón', () => {
  const cerrada = { estado: 'Cerrada', fecha_apertura: '2020-01-01', fecha_cierre: '2022-03-15' };
  assert.equal(
    fechas.revisarCoherencia(cuentas, { estado: 'Activa', fecha_apertura: '2023-06-01' }, cerrada),
    null,
    'antes: «"Fecha de cierre" (15-03-2022) no puede ser anterior a "Fecha de apertura" (01-06-2023)»',
  );
  assert.ok(
    fechas.revisarCoherencia(cuentas, { estado: 'Cerrada', fecha_apertura: '2023-06-01' }, cerrada),
    'cerrada sigue estando, así que la contradicción se sigue avisando',
  );
});

test('el salto mira los DOS lados del par, no solo el campo que se compara', () => {
  // En inventario, la fecha contra la que se compara también es condicional:
  // si el régimen deja de ser prestado, ninguna de las dos queda en la ficha.
  const def = {
    fields: [
      { name: 'regimen', label: 'Régimen', type: 'select' },
      {
        name: 'fecha_recepcion', label: 'Fecha de recepción', type: 'date',
        showIf: { field: 'regimen', equals: 'Prestado' },
      },
      {
        name: 'fecha_devuelto', label: 'Fecha de devolución', type: 'date',
        noAntesDe: 'fecha_recepcion',
      },
    ],
  };
  const prestado = { regimen: 'Prestado', fecha_recepcion: '2025-01-10', fecha_devuelto: '2026-05-01' };
  assert.equal(
    fechas.revisarCoherencia(def, { regimen: 'Propio', fecha_devuelto: '2024-01-01' }, prestado),
    null,
    'la recepción deja de existir: no hay contra qué comparar',
  );
  assert.ok(
    fechas.revisarCoherencia(def, { regimen: 'Prestado', fecha_devuelto: '2024-01-01' }, prestado),
    'con el régimen intacto, la recepción sigue ahí y la contradicción también',
  );
});

test('la fecha que SÍ viene en el guardado se compara, se sepa o no si aplica', () => {
  /*
   * Se aprendió rompiéndolo. Una planilla de inventario puede no traer la
   * columna «Régimen»: entonces no se sabe si la recepción y la devolución van
   * en la ficha, y no saberlo se parecía a saber que no, así que la fila se
   * dejaba de revisar. Pero las dos fechas llegaron escritas en ella —se ven y
   * se pueden corregir—, y eso es lo que decide: la que se salta es la que
   * nadie mandó y nadie puede tocar.
   */
  const aviso = fechas.revisarCoherencia(
    inventarios,
    { fecha_recepcion: '2026-03-10', fecha_devolucion: '2026-03-01' },
    null,
  );
  assert.match(String(aviso), /01-03-2026/);
  assert.match(String(aviso), /10-03-2026/);
});

test('un `noAntesDe` que apunta a un campo que no existe no revienta el guardado', () => {
  // Nadie comprueba al arrancar que ese nombre exista, así que un error de
  // tecleo tiene que quedarse en no comparar nada, como se quedaba antes, y no
  // en un 500 al guardar.
  const def = {
    fields: [
      { name: 'fecha_a', label: 'Fecha A', type: 'date' },
      { name: 'fecha_b', label: 'Fecha B', type: 'date', noAntesDe: 'fecha_que_no_esta' },
    ],
  };
  assert.equal(fechas.revisarCoherencia(def, { fecha_a: '2026-01-01', fecha_b: '2025-01-01' }, null), null);
});

// -------------------------------------------------- y por la puerta ----

test('el motor deja volver a quien se retiró, con lo que manda la pantalla', async () => {
  const api = await elSistemaAndando();

  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`Central VU ${marca}`, `VU-${marca}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
    .run(`Damas VU ${marca}`, iglesia).lastInsertRowid;
  const quien = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Vuelve${++n}`, `Sirve VU ${marca}`, iglesia).lastInsertRowid;

  const comun = { cuerpo_id: cuerpo, persona_tipo: 'Miembro', miembro_id: quien };

  const alta = await api('POST', '/integrantes_cuerpo',
    { ...comun, estado: 'Activo', fecha_ingreso: '2024-01-10' });
  assert.equal(alta.estado, 201, alta.texto);
  const ficha = alta.json.id;

  const baja = await api('PUT', `/integrantes_cuerpo/${ficha}`,
    { ...comun, estado: 'Retirado', fecha_ingreso: '2024-01-10',
      fecha_retiro: '2025-06-30', motivo_retiro: 'Cambio de ciudad' });
  assert.equal(baja.estado, 200, baja.texto);

  // Crear otra ficha se sigue rechazando: la suya es la que hay que abrir.
  const otra = await api('POST', '/integrantes_cuerpo',
    { ...comun, estado: 'En prueba', fecha_ingreso: '2026-03-01' });
  assert.equal(otra.estado, 400, 'el modelo es una ficha por persona y cuerpo');
  assert.match(otra.json.error, /Ábrala en vez de crear otra/);

  // Y la suya se abre con lo que la pantalla manda: sin la fecha de retiro.
  const vuelve = await api('PUT', `/integrantes_cuerpo/${ficha}`,
    { ...comun, estado: 'En prueba', fecha_ingreso: '2026-03-01' });
  assert.equal(vuelve.estado, 200, vuelve.texto);

  const quedo = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(ficha);
  assert.equal(quedo.estado, 'En prueba');
  assert.equal(quedo.fecha_ingreso, '2026-03-01');
  assert.equal(quedo.fecha_retiro, null, 'el gancho del módulo borra el retiro al volver');
  assert.equal(quedo.motivo_retiro, null);
  assert.ok(quedo.fecha_fin_prueba, 'y le cuenta su período de prueba desde el ingreso nuevo');
});
