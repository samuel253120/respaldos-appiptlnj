/**
 * QUIÉN DECIDIÓ QUE SIGUIERA EN EL CUERPO NO QUEDABA ANOTADO.
 *
 * Las fichas de integrante están vigiladas por el Registro de Cambios desde
 * hace versiones, y la evaluación es lo que las MUEVE: aprueba a alguien, le
 * extiende la prueba o lo saca del cuerpo, con una escritura directa que el
 * motor no ve. O sea que el registro anotaba quién ENTRÓ a un cuerpo y no
 * anotaba quién decidió que se quedara o que se fuera.
 *
 * MEDIDO en la v1.399.0, sobre una misma sesión de trabajo:
 *
 *   fichas de integrante creadas ....  26 líneas
 *   evaluaciones hechas una a una ...   0 líneas
 *   importaciones de evaluaciones ...   3 líneas
 *
 * Solo quedaban las importaciones, porque ésas las anota el propio importador
 * mire lo que mire la lista de vigilados. Y su línea prometía algo que no
 * existía: «Cada ficha que entró lo dice también en su propia línea».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central RC ${marca}`, `RC-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas RC ${marca}`, iglesia).lastInsertRowid;

function enPrueba() {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve RC ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', '2026-01-10', '2026-04-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve RC ${marca}`, iglesia).lastInsertRowid;
}

/**
 * Las líneas del registro de UNA evaluación. La base la comparten los procesos,
 * así que hay que acotar; y se acota por el id del registro y no por el texto,
 * porque la línea de un CAMBIO describe lo que cambió —«Resultado: X → Y»— y no
 * repite de quién es la ficha: eso lo dice su columna «registro».
 */
const lineasDe = (id) => db.prepare(
  `SELECT * FROM registro_cambios
    WHERE modulo = 'Evaluaciones de Integrantes' AND registro_id = ?
    ORDER BY id`
).all(id);

test('el módulo está en la lista de los que dejan rastro', () => {
  assert.ok(bitacora.MODULOS_VIGILADOS.includes('evaluaciones_integrantes'),
    'las fichas que mueve ya estaban vigiladas: la decisión que las mueve, no');
});

test('crear, corregir y borrar una evaluación deja su línea, y dice cuál es', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();

  const ev = await api('POST', '/evaluaciones_integrantes', {
    integrante_id: ficha, fecha: '2026-05-20', resultado: 'No aprobado (se extiende la prueba)',
    meses_extension: 3, evaluado_por: 'La directiva',
  });
  assert.equal(ev.estado, 201, ev.texto);

  const corr = await api('PUT', `/evaluaciones_integrantes/${ev.json.id}`, {
    integrante_id: ficha, fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'La directiva',
  });
  assert.equal(corr.estado, 200, corr.texto);

  const bor = await api('DELETE', `/evaluaciones_integrantes/${ev.json.id}?igual_asi=true`);
  assert.equal(bor.estado, 200, bor.texto);

  const lineas = lineasDe(ev.json.id);
  const acciones = lineas.map((l) => l.accion);
  assert.deepEqual(acciones, ['Creación', 'Cambio', 'Eliminación'], JSON.stringify(acciones));

  const creacion = lineas[0];
  assert.match(creacion.detalle, /Fecha de la evaluación: 20-05-2026/);
  assert.match(creacion.detalle, new RegExp(`Quien${n} Sirve RC ${marca}`), 'de quién es');
  assert.match(creacion.detalle, /Resultado: No aprobado/);
  assert.match(creacion.detalle, /Evaluado por: La directiva/, 'y quién lo decidió, que es lo que se pregunta después');

  assert.match(lineas[1].detalle, /Resultado/, 'la corrección dice qué cambió');
  assert.match(lineas[1].registro, /20-05-2026/,
    'y de qué evaluación es, en su columna: el detalle de un cambio son los campos, no la ficha');
  assert.match(lineas[2].detalle, /20-05-2026/, 'y el borrado, qué se llevó');
});

test('la promesa de la planilla se cumple: cada ficha deja su propia línea', async () => {
  /*
   * La línea de una importación dice «Cada ficha que entró lo dice también en
   * su propia línea», y hasta ahora no era verdad para este módulo: la línea de
   * la importación existía y las de las fichas no.
   */
  const api = await elSistemaAndando();
  const a = enPrueba();
  const b = enPrueba();

  const imp = await api('POST', '/importar/evaluaciones_integrantes?prueba=0', {
    prueba: false,
    filas: [
      { integrante_id: a, fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'Planilla' },
      { integrante_id: b, fecha: '2026-05-20', resultado: 'Aprobado', evaluado_por: 'Planilla' },
    ],
  });
  assert.equal(imp.estado, 200, imp.texto);
  assert.equal(imp.json.correctas, 2);

  const porFicha = db.prepare(
    `SELECT * FROM registro_cambios
      WHERE modulo = 'Evaluaciones de Integrantes' AND accion = 'Creación' AND detalle LIKE ?
      ORDER BY id`
  ).all(`%Sirve RC ${marca}%`).filter((l) => String(l.detalle).startsWith('Por planilla'));
  assert.equal(porFicha.length, 2, 'una por cada ficha que entró');
  for (const l of porFicha) {
    assert.match(l.detalle, /^Por planilla/, 'y dice por dónde entró');
  }
  const laDeLaPlanilla = db.prepare(
    "SELECT * FROM registro_cambios WHERE modulo = 'Evaluaciones de Integrantes' AND accion = 'Importación' ORDER BY id DESC LIMIT 1"
  ).get();
  assert.match(laDeLaPlanilla.detalle, /su propia/, 'la promesa que ahora se cumple');
});
