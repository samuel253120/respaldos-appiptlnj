/**
 * Una condición puede colgar de un campo que a su vez tiene condición.
 *
 * «Detalle del motivo» depende del motivo de la ausencia, y el motivo solo
 * existe cuando la asistencia está «Justificada». Mirar solo el VALOR del de
 * arriba no basta: ese valor puede estar ahí de antes, o venir puesto por la
 * pantalla —un desplegable escondido se dibuja con su primera opción aunque el
 * registro no tenga ninguna—.
 *
 * MEDIDO en la v1.283.0, sobre una asistencia marcada «Presente» y con el
 * motivo en null en la base:
 *
 *   la pantalla mandaba .................. motivo: «Emergencia» (el primero)
 *   el servidor contestaba ............... 400 «El campo "Detalle del motivo"
 *                                          es obligatorio»
 *   el botón Guardar ..................... no hacía nada, sin ningún mensaje
 *
 * Ese registro no se podía guardar por ningún camino. Y si se hubiera podido,
 * habría quedado con un motivo de justificación puesto a alguien que sí fue.
 *
 * Se descubrió al exigir el número de la oficina de partes: la comprobación que
 * se sumó entonces a la suite de humo —que ningún obligatorio a la vista quede
 * vacío en un formulario de edición— lo encontró en otro módulo, ya revisado y
 * cerrado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { seAplica } = require('../../server/crud');
const { getModule } = require('../../server/registry');

const CAMPOS = [
  { name: 'estado' },
  { name: 'motivo', showIf: { field: 'estado', equals: 'Justificado' }, required: true },
  { name: 'detalle', showIf: { field: 'motivo', in: ['Emergencia', 'Otro motivo'] }, required: true },
];

test('si el de arriba no aplica, el de abajo tampoco', () => {
  const detalle = CAMPOS[2];
  // El caso medido: «Presente», con un motivo que viene puesto igual
  assert.equal(
    seAplica(detalle, { estado: 'Presente', motivo: 'Emergencia' }, null, CAMPOS),
    false,
    'un motivo que no aplica no puede exigir su detalle'
  );
});

test('y si el de arriba sí aplica, el de abajo se decide por su propio valor', () => {
  const detalle = CAMPOS[2];
  assert.equal(seAplica(detalle, { estado: 'Justificado', motivo: 'Emergencia' }, null, CAMPOS), true);
  assert.equal(seAplica(detalle, { estado: 'Justificado', motivo: 'Enfermedad' }, null, CAMPOS), false);
});

test('sin la lista de campos se decide como antes, sin mirar la cadena', () => {
  /*
   * La lista es opcional a propósito: hay un llamador que no la tiene a mano.
   * Se deja fijado para que se sepa que ese camino existe y qué contesta.
   */
  const detalle = CAMPOS[2];
  assert.equal(seAplica(detalle, { estado: 'Presente', motivo: 'Emergencia' }, null), true);
});

test('un círculo de condiciones no deja al servidor dando vueltas', () => {
  const enCirculo = [
    { name: 'a', showIf: { field: 'b', equals: 'sí' } },
    { name: 'b', showIf: { field: 'a', equals: 'sí' } },
  ];
  assert.equal(seAplica(enCirculo[0], { a: 'sí', b: 'sí' }, null, enCirculo), true);
});

test('en el sistema de verdad hay una sola cadena así, y es la del detalle', () => {
  /*
   * Si mañana aparece otra, esta prueba se pone roja: no porque esté mal
   * —encadenar condiciones es legítimo— sino para que quien la escriba sepa
   * que entra en esta regla y venga a mirar esta prueba.
   */
  const { modules } = require('../../server/registry');
  const todos = Array.isArray(modules) ? modules : Object.values(modules || {});
  assert.ok(todos.length > 20, `se recorren ${todos.length} módulos`);

  const cadenas = [];
  for (const def of todos) {
    const porNombre = Object.fromEntries((def.fields || []).map((f) => [f.name, f]));
    for (const f of (def.fields || [])) {
      if (!f.showIf) continue;
      const manda = porNombre[f.showIf.field];
      if (manda && manda.showIf) cadenas.push(`${def.name}.${f.name}`);
    }
  }
  assert.deepEqual(cadenas, ['asistencia_detalle.detalle']);
});

test('y el caso real se guarda', async () => {
  /*
   * Lo mismo, pero por la ruta de verdad y sobre el módulo de verdad: una
   * asistencia «Presente» a la que le llega un motivo puesto —como lo mandaba
   * la pantalla— y sin detalle. Antes contestaba 400.
   */
  const { db } = require('../../server/db');
  const { elSistemaAndando, cerrarElSistema } = require('./andando');
  test.after(cerrarElSistema);

  const api = await elSistemaAndando();
  const m = `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `AS${m}`.slice(0, 18)).lastInsertRowid;
  const miembro = db.prepare(
    'INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, ?)'
  ).run('Persona', m, iglesia, 'Activo').lastInsertRowid;
  const asistencia = db.prepare(
    "INSERT INTO asistencias (fecha, iglesia_id) VALUES ('2026-04-06', ?)"
  ).run(iglesia).lastInsertRowid;

  /*
   * Y UN MOTIVO QUE SÍ PIDE EXPLICACIÓN, porque si no la prueba pasa por el
   * motivo equivocado: cuáles motivos la piden lo decide cada iglesia en su
   * ficha, y en una base recién hecha no hay ninguno marcado, así que la
   * condición del detalle queda con la lista vacía y no se exige nunca. Sin
   * esta fila, romper el arreglo a propósito no ponía roja ninguna prueba —se
   * comprobó—.
   */
  db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, 1, 1)')
    .run(`Emergencia ${m}`);
  const queExige = `Emergencia ${m}`;

  const creado = await api('POST', '/asistencia_detalle', {
    asistencia_id: asistencia, persona_tipo: 'Miembro', miembro_id: miembro,
    estado: 'Presente', iglesia_id: iglesia, fecha: '2026-04-06',
  });
  assert.equal(creado.estado, 201, JSON.stringify(creado.json));

  // Primero, que la condición del detalle DE VERDAD alcance a este motivo: si
  // no, lo de abajo no comprobaría nada.
  const detalle = getModule('asistencia_detalle').fields.find((x) => x.name === 'detalle');
  assert.ok(detalle.showIf.in.includes(queExige),
    `el motivo sembrado tiene que estar entre los que piden explicación: ${JSON.stringify(detalle.showIf.in)}`);

  const guardado = await api('PUT', `/asistencia_detalle/${creado.json.id}`, {
    estado: 'Presente', motivo: queExige, detalle: '',
  });
  assert.equal(guardado.estado, 200,
    `un «Presente» con un motivo colgando no puede exigir detalle: ${JSON.stringify(guardado.json)}`);

  // Y al revés: en un «Justificado», ese mismo motivo sí exige la explicación.
  const justificado = await api('PUT', `/asistencia_detalle/${creado.json.id}`, {
    estado: 'Justificado', motivo: queExige, detalle: '',
  });
  assert.equal(justificado.estado, 400, 'ahí sí se pide');
  assert.match(justificado.json.error, /Detalle del motivo/);
});

test('pero un «Justificado» con un motivo que pide explicación sí la exige', () => {
  /*
   * La otra mitad: el arreglo no puede consistir en dejar de exigir. Se
   * comprueba sobre la declaración del módulo de verdad, porque cuáles motivos
   * piden explicación lo decide cada iglesia en su ficha y acá no hay ninguno
   * marcado.
   */
  const f = getModule('asistencia_detalle').fields.find((x) => x.name === 'detalle');
  assert.equal(f.required, true);
  assert.equal(f.showIf.field, 'motivo');
  assert.ok(Array.isArray(f.showIf.in));
});
