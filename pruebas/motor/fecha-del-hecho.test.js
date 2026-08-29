/**
 * LA BITÁCORA ANOTA CUÁNDO PASÓ LA COSA, NO CUÁNDO LA TECLEARON.
 *
 * Medido sobre una miembro a la que se le hizo la vida entera por la API: sus
 * trece anotaciones automáticas llevaban UNA sola fecha, la del día en que se
 * hicieron, mientras sus fichas decían otra cosa.
 *
 *   la solicitud está fechada el .....  02-03-2026  → se anotaba el 29-08-2026
 *   la ayuda está fechada el .........  10-03-2026  → se anotaba el 29-08-2026
 *   el certificado se emitió el ......  15-03-2026  → se anotaba el 29-08-2026
 *   ingresó al cuerpo el .............  15-01-2026  → se anotaba el 29-08-2026
 *
 * La pantalla ordena el historial por fecha, así que la única anotación con una
 * fecha escrita por una persona —una visita de marzo— quedaba al FINAL de la
 * lista, debajo del ingreso al cuerpo de enero. El historial decía que primero
 * salió del cuerpo y después la visitaron, y que todo pasó el mismo día.
 *
 * Lo que cuida este archivo:
 *   · que cada hecho con fecha propia se anote EN SU FECHA
 *   · que un cambio —de datos, de estado, una aprobación— siga siendo de hoy,
 *     porque el hecho es que alguien lo hizo, y lo hizo hoy
 *   · que una fecha ausente o que no sea una fecha caiga en hoy, como siempre
 *   · y que con esto el historial quede en orden de verdad
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const fechas = require('../../server/fechas');
const registry = require('../../server/registry');

const HOY = fechas.hoy();

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Fecha del hecho', 'IG-FDH', 'Activa')")
  .run().lastInsertRowid;

const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run('Rosa Elena', 'Del Hecho', iglesia).lastInsertRowid;

const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES ('Damas del Hecho', 'Dorcas', ?)")
  .run(iglesia).lastInsertRowid;

const usuario = { id: 1, nombre: 'Quien Guarda' };

/** Guardar algo como lo guarda el motor, y devolver lo que quedó anotado. */
function alGuardar(modulo, fila, { isNew = true, antes = {} } = {}) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(registry.getModule(modulo), {
    isNew, antes, despues: fila, datos: fila, user: usuario,
  });
  return db
    .prepare('SELECT * FROM bitacora WHERE id > ? AND miembro_id = ? ORDER BY id')
    .all(desde, miembro);
}

/* ------------------------------- lo que tiene fecha propia */

test('la solicitud se anota en la fecha de la solicitud', () => {
  const [fila] = alGuardar('solicitudes', {
    id: 901, miembro_id: miembro, iglesia_id: iglesia,
    fecha: '2026-03-02', asunto: 'Certificado de bautismo', estado: 'Pendiente',
  });
  assert.equal(fila.fecha, '2026-03-02', `antes se anotaba el día del tecleo (${HOY})`);
  assert.match(fila.descripcion, /Certificado de bautismo/);
});

test('la ayuda se anota en la fecha de la ayuda', () => {
  const [fila] = alGuardar('ayudas_sociales', {
    id: 902, miembro_id: miembro, iglesia_id: iglesia,
    fecha: '2026-03-10', tipo_ayuda: 'Mercadería', estado: 'Entregada',
  });
  assert.equal(fila.fecha, '2026-03-10');
});

test('el certificado se anota en la fecha en que se emitió', () => {
  const [fila] = alGuardar('certificados', {
    id: 903, miembro_id: miembro, iglesia_id: iglesia,
    fecha_emision: '2026-03-15', fecha_evento: '2005-11-06',
    tipo: 'Bautismo', numero: 'FDH-1',
  });
  assert.equal(fila.fecha, '2026-03-15',
    'la de emisión, no la del hecho que certifica: la anotación habla del papel');
});

test('el documento se anota en la fecha del documento', () => {
  const [fila] = alGuardar('documentos_miembros', {
    id: 904, miembro_id: miembro, iglesia_id: iglesia,
    fecha: '2026-02-20', nombre: 'Carnet', tipo: 'Identificación',
  });
  assert.equal(fila.fecha, '2026-02-20');
});

test('el ingreso a un cuerpo se anota en la fecha de ingreso', () => {
  const [fila] = alGuardar('integrantes_cuerpo', {
    id: 905, miembro_id: miembro, cuerpo_id: cuerpo, iglesia_id: iglesia,
    estado: 'En prueba', fecha_ingreso: '2026-01-15',
  });
  assert.equal(fila.fecha, '2026-01-15',
    'alguien puede anotar en agosto que la señora entró en enero');
  assert.equal(fila.tipo, 'Ingreso a cuerpo');
});

test('el retiro se anota en la fecha de retiro', () => {
  const [retiro] = alGuardar('integrantes_cuerpo', {
    id: 905, miembro_id: miembro, cuerpo_id: cuerpo, iglesia_id: iglesia,
    estado: 'Retirado', fecha_ingreso: '2026-01-15', fecha_retiro: '2026-06-30',
    motivo_retiro: 'Traslado de ciudad',
  }, { isNew: false, antes: { estado: 'Activo' } });
  assert.equal(retiro.fecha, '2026-06-30',
    'la escribe quien retira: el campo NO es de solo lectura');
  assert.equal(retiro.tipo, 'Salida de cuerpo');
});

test('pasar a integrante oficial es de hoy, y eso está comprobado', () => {
  /*
   * «Pasó a integrante oficial el» es de solo lectura: la pone la evaluación.
   * Y la evaluación mueve al integrante con un UPDATE directo que no pasa por
   * el motor, así que por ese camino no se escribe ninguna anotación —medido
   * contra el servidor: aprobar la evaluación deja la ficha en Activo con su
   * fecha, y la bitácora de la persona sigue con las mismas dos de antes—.
   * Acá solo se llega por el cambio de estado a mano, donde ese campo viene
   * vacío. Por eso la anotación no lo mira: sería una línea muerta.
   */
  const [fila] = alGuardar('integrantes_cuerpo', {
    id: 905, miembro_id: miembro, cuerpo_id: cuerpo, iglesia_id: iglesia,
    estado: 'Activo', fecha_ingreso: '2026-01-15', fecha_oficial: '2026-04-01',
  }, { isNew: false, antes: { estado: 'En prueba' } });
  assert.equal(fila.fecha, HOY,
    'aunque la ficha traiga fecha_oficial, lo que pasa hoy es que alguien la marcó Activa');

  const campo = registry.getModule('integrantes_cuerpo').fields.find((f) => f.name === 'fecha_oficial');
  assert.equal(campo.readonly, true, 'si dejara de ser de solo lectura, esta decisión hay que revisarla');
});

test('el cargo de una directiva se anota cuando empieza el período', () => {
  const filas = alGuardar('directivas', {
    id: 906, cuerpo_id: cuerpo, iglesia_id: iglesia,
    periodo: '2026-2027', fecha_inicio: '2026-01-20', primer_jefe_id: miembro,
  });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, '2026-01-20');
  assert.match(filas[0].descripcion, /Asume como Primer jefe/);
});

/* ------------------------------- lo que pasa hoy, sigue siendo de hoy */

test('un cambio de datos del miembro es de hoy', () => {
  const [fila] = alGuardar('miembros', {
    id: miembro, iglesia_id: iglesia, nombres: 'Rosa Elena', apellidos: 'Del Hecho',
    telefono: '+56 9 7100 9999',
  }, { isNew: false, antes: { telefono: '+56 9 7100 2200' } });
  assert.equal(fila.fecha, HOY,
    'el hecho es que alguien le cambió el teléfono, y lo hizo hoy');
  assert.equal(fila.tipo, 'Cambio de datos');
});

test('aprobar una solicitud es de hoy, aunque la solicitud sea de marzo', () => {
  const [fila] = alGuardar('solicitudes', {
    id: 901, miembro_id: miembro, iglesia_id: iglesia,
    fecha: '2026-03-02', asunto: 'Certificado de bautismo', estado: 'Aprobada',
  }, { isNew: false, antes: { estado: 'Pendiente' } });
  assert.equal(fila.fecha, HOY,
    'lo que se anota es que alguien la aprobó; la aprobó hoy');
  assert.match(fila.descripcion, /^Actualización — /);
});

test('volver a período de prueba no tiene fecha propia: es de hoy', () => {
  const [fila] = alGuardar('integrantes_cuerpo', {
    id: 905, miembro_id: miembro, cuerpo_id: cuerpo, iglesia_id: iglesia,
    estado: 'En prueba', fecha_ingreso: '2026-01-15',
  }, { isNew: false, antes: { estado: 'Activo' } });
  assert.equal(fila.fecha, HOY);
});

/* ------------------------------- lo que no es una fecha */

test('sin fecha propia, o con algo que no es una fecha, cae en hoy', () => {
  // La ficha se guardó sin llenar su fecha, o con un valor que no es una:
  // antes de esto TODO caía en hoy, así que esto es lo que no puede empeorar.
  for (const valor of [null, undefined, '', '   ', 'el jueves', '2026-02-30', '30-06-2026']) {
    const [fila] = alGuardar('ayudas_sociales', {
      id: 902, miembro_id: miembro, iglesia_id: iglesia,
      fecha: valor, tipo_ayuda: 'Mercadería', estado: 'Entregada',
    });
    assert.equal(fila.fecha, HOY, `con «${valor}» tendría que caer en hoy`);
  }
});

test('la fecha se comprueba con la misma función que el resto del sistema', () => {
  // El 30 de febrero tiene la forma correcta y no es un día. Que lo ataje la
  // función del motor y no una comprobación propia es lo que hace que la
  // bitácora no pueda guardar en su columna de fecha algo que no lo sea.
  assert.equal(fechas.normalizar('2026-02-30'), null);
  assert.equal(fechas.normalizar('2026-03-10'), '2026-03-10');
});

/* ------------------------------- y con esto, el historial queda en orden */

test('el historial de la persona se lee en el orden en que le pasaron las cosas', () => {
  const propio = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Elba', 'En Orden', iglesia).lastInsertRowid;
  const suCuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES ('Damas en Orden', 'Dorcas', ?)")
    .run(iglesia).lastInsertRowid;
  const guardar = (modulo, fila, opts) => bitacora.registrarGuardado(
    registry.getModule(modulo), { isNew: true, antes: {}, despues: fila, datos: fila, user: usuario, ...opts }
  );

  // se anotan DESORDENADAS, como se teclean de verdad
  guardar('certificados', { id: 911, miembro_id: propio, iglesia_id: iglesia, fecha_emision: '2026-03-15', tipo: 'Bautismo', numero: 'ORD-1' });
  guardar('integrantes_cuerpo', { id: 912, miembro_id: propio, cuerpo_id: suCuerpo, iglesia_id: iglesia, estado: 'Activo', fecha_ingreso: '2026-01-15' });
  guardar('ayudas_sociales', { id: 913, miembro_id: propio, iglesia_id: iglesia, fecha: '2026-02-10', tipo_ayuda: 'Mercadería', estado: 'Entregada' });
  // y una anotación a mano, de las que escribe el equipo
  db.prepare(
    `INSERT INTO bitacora (miembro_id, iglesia_id, fecha, tipo, descripcion, origen, registrado_por)
     VALUES (?,?,?,'Visita','Se le visitó en su casa.','Manual','Quien Escribe')`
  ).run(propio, iglesia, '2026-02-20');

  // como las lee la pestaña de la ficha: de la más nueva a la más vieja
  const suyas = db
    .prepare('SELECT fecha, tipo FROM bitacora WHERE miembro_id = ? ORDER BY fecha DESC, id DESC')
    .all(propio);
  assert.deepEqual(suyas.map((r) => r.fecha),
    ['2026-03-15', '2026-02-20', '2026-02-10', '2026-01-15'],
    'antes las tres automáticas caían todas en hoy y la visita quedaba al final');
  assert.equal(suyas[suyas.length - 1].tipo, 'Ingreso a cuerpo',
    'lo primero que le pasó va abajo del todo, que es donde empieza su historia');
});
