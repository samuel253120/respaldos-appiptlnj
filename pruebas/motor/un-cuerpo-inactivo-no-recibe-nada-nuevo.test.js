/**
 * Lo que significa que un cuerpo o grupo esté INACTIVO.
 *
 * Hasta acá, nada. El campo tenía sus dos opciones, se guardaba, se pintaba en
 * el listado, y ninguna regla del sistema lo consultaba. Medido sobre un cuerpo
 * creado directamente como inactivo:
 *
 *   agregarle un integrante ................... 201
 *   meterle plata en su caja .................. 201
 *   anotarle un acta de reunión ............... 201
 *   convocarlo a una actividad ................ 201
 *   inventariarle un bien ..................... 201
 *   ¿lo ofrece el desplegable de cuerpos? ..... sí, 1 de 17
 *
 * Y antes de eso había otra cosa que decidir, porque el estado no estaba
 * escrito en casi ninguno: DOCE DE DIECISÉIS lo tenían en blanco —el valor de
 * fábrica solo se aplica al abrir el formulario— y el cumplimiento los
 * castigaba por eso, con un «Cuerpo activo ✗ Sin estado». El vacío significa
 * activo, se lee así en todas partes y se escribe al arrancar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const inactivos = require('../../server/cuerpo-inactivo');
const { elEstadoDeCadaCuerpo } = require('../../server/migraciones');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = () => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia CU ${marca()}`, `CUI${marca()}`).lastInsertRowid;

const laIglesia = iglesia();
const cuerpo = (estado = 'Activo', tipo = 'Cuerpo') => db
  .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)')
  .run(`Cuerpo CU ${marca()}`, tipo, laIglesia, estado).lastInsertRowid;

const cerrado = cuerpo('Inactivo');
const abierto = cuerpo('Activo');
const enBlanco = db
  .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES (?, ?, ?)')
  .run(`Cuerpo CU sin estado ${marca()}`, 'Cuerpo', laIglesia).lastInsertRowid;

/** Corre la regla como la corre el motor, después del gancho del módulo. */
const alGuardar = (modulo, data, { existing = null, isNew = true } = {}) =>
  inactivos.avisoSiElCuerpoEstaInactivo(db, getModule(modulo), { data, existing, isNew });

// ------------------------------------------------- no recibe nada nuevo ----

test('un cuerpo inactivo no recibe gente, plata, actas ni bienes nuevos', () => {
  for (const modulo of ['integrantes_cuerpo', 'actas_reuniones', 'directivas', 'inventarios',
                        'cuentas_tesoreria', 'tesoreria', 'deudas', 'documentos']) {
    const aviso = alGuardar(modulo, { cuerpo_id: cerrado });
    assert.match(String(aviso), /está marcado como inactivo/i, `${modulo} lo dejó pasar`);
  }
});

test('ni se lo convoca a una actividad, que llega por un campo de VARIOS', () => {
  /*
   * «Cuerpos convocados» es un multiref, no una referencia suelta. Una regla
   * que solo mirara `type === 'ref'` habría dejado esta puerta abierta, y es
   * una de las cinco cosas que se midieron.
   */
  const aviso = alGuardar('asistencias', { cuerpos: JSON.stringify([cerrado]) });
  assert.match(String(aviso), /está marcado como inactivo/i);
  assert.match(String(aviso), /Cuerpos convocados/, 'y dice por qué campo entró');
});

test('y da igual si viene acompañado de uno que sí funciona', () => {
  const aviso = alGuardar('asistencias', { cuerpos: JSON.stringify([abierto, cerrado]) });
  assert.match(String(aviso), /está marcado como inactivo/i,
    'convocar a los dos de una vez no puede ser la manera de colar al que se cerró');
});

test('el aviso dice cuál es, si es cuerpo o grupo, y cuál es la salida', () => {
  const grupo = cuerpo('Inactivo', 'Grupo');
  const aviso = alGuardar('integrantes_cuerpo', { cuerpo_id: cerrado });
  assert.match(aviso, /^El cuerpo "Cuerpo CU/, 'lo nombra, y dice que es un cuerpo');
  assert.match(aviso, /cámbiele el estado a «Activo» en su ficha/i, 'y dice cómo salir');
  assert.match(String(alGuardar('integrantes_cuerpo', { cuerpo_id: grupo })), /^El grupo "/,
    'a un grupo se le dice grupo: el módulo lleva las dos realidades y el aviso también');
});

test('un cuerpo activo recibe lo que sea', () => {
  assert.equal(alGuardar('integrantes_cuerpo', { cuerpo_id: abierto }), null);
  assert.equal(alGuardar('asistencias', { cuerpos: JSON.stringify([abierto]) }), null);
});

test('y uno SIN ESTADO ESCRITO también: el vacío está activo', () => {
  /*
   * La mitad que decide si esto se puede encender. Doce de los dieciséis
   * cuerpos de la organización tenían el estado en blanco; si el vacío cerrara
   * la puerta, esta versión habría dejado tres cuartas partes de los cuerpos
   * sin poder recibir nada.
   */
  assert.equal(alGuardar('integrantes_cuerpo', { cuerpo_id: enBlanco }), null);
  assert.equal(inactivos.elInactivo(db, enBlanco), null);
  assert.equal(inactivos.funciona({ estado: null }), true);
  assert.equal(inactivos.funciona({ estado: '' }), true);
  assert.equal(inactivos.funciona({ estado: 'Inactivo' }), false);
});

// ------------------------------------- lo que ya está se sigue corrigiendo ----

test('lo que ya cuelga de un cuerpo inactivo se sigue pudiendo corregir', () => {
  /*
   * Es la mitad que importa: un cuerpo cerrado es historia, y la historia se
   * corrige cuando está mal escrita. Frenarlo entero obligaría a reactivar el
   * cuerpo para arreglarle la fecha a un acta.
   */
  const existing = { id: 9, cuerpo_id: cerrado };
  assert.equal(alGuardar('actas_reuniones', { tema: 'Corregido' }, { existing, isNew: false }), null);
  assert.equal(alGuardar('actas_reuniones', { cuerpo_id: cerrado }, { existing, isNew: false }), null,
    'y volver a mandar el mismo cuerpo no es mudarse a ninguna parte');
});

test('pero MUDAR un registro hacia un cuerpo inactivo se frena', () => {
  const existing = { id: 9, cuerpo_id: abierto };
  const aviso = alGuardar('actas_reuniones', { cuerpo_id: cerrado }, { existing, isNew: false });
  assert.match(String(aviso), /no puede pasarse nada nuevo en él/i);
});

test('y sacarlo de él hacia uno activo, no', () => {
  const existing = { id: 9, cuerpo_id: cerrado };
  assert.equal(alGuardar('actas_reuniones', { cuerpo_id: abierto }, { existing, isNew: false }), null,
    'es justamente lo que hay que hacer al cerrar un cuerpo: repartir lo suyo');
});

test('y a una actividad ya convocada se le corrige la fecha sin repreguntar', () => {
  const existing = { id: 9, cuerpos: JSON.stringify([cerrado]) };
  assert.equal(alGuardar('asistencias', { fecha: '2026-09-02' }, { existing, isNew: false }), null);
  assert.equal(alGuardar('asistencias', { cuerpos: JSON.stringify([cerrado]) }, { existing, isNew: false }), null,
    'los que ya estaban convocados no se vuelven a preguntar');
  assert.match(String(alGuardar('asistencias', { cuerpos: JSON.stringify([cerrado, cuerpo('Inactivo')]) },
    { existing, isNew: false })), /está marcado como inactivo/i, 'pero AGREGAR otro cerrado sí');
});

// ------------------------------------------ lo que SÍ se le puede escribir ----

test('pasarle lista a una actividad que ya estaba convocada se puede', () => {
  /*
   * La actividad es lo nuevo y por eso se frena convocarlo; pasar la lista de
   * una que ya se convocó no lo es, y frenarlo dejaría una reunión que se hizo
   * sin poder anotarse.
   */
  assert.equal(alGuardar('asistencia_detalle', { cuerpo_id: cerrado }), null);
  assert.ok(inactivos.PUEDEN_ESCRIBIRLE.includes('asistencia_detalle'));
});

test('y una cuenta de usuario, porque ahí «cuerpos» quiere decir otra cosa', () => {
  /*
   * En una ficha cualquiera `cuerpo_id` dice de qué cuerpo es el registro; en
   * una cuenta de usuario, «Cuerpos que administra» dice de cuáles se hace
   * cargo esa persona, y alguien tiene que poder quedar a cargo de los papeles
   * de un cuerpo que se cerró. Es lo mismo que ya está escrito para la iglesia
   * inactiva.
   */
  assert.equal(alGuardar('usuarios', { cuerpos: JSON.stringify([cerrado]) }), null);
  assert.ok(inactivos.PUEDEN_ESCRIBIRLE.includes('usuarios'));
});

test('la ficha del propio cuerpo se edita: es como se lo reactiva', () => {
  /*
   * Sale por la puerta general y no por una excepción escrita a su nombre: un
   * guardado de `cuerpos` no lleva ningún campo que apunte a `cuerpos`, así que
   * la regla no tiene ninguno al que mirar.
   */
  const def = getModule('cuerpos');
  assert.equal(def.fields.filter((f) => f.ref === 'cuerpos').length, 0,
    'si un día la ficha del cuerpo apuntara a otro cuerpo, habría que nombrarla aparte');
  const existing = { id: cerrado, estado: 'Inactivo' };
  assert.equal(alGuardar('cuerpos', { estado: 'Activo' }, { existing, isNew: false }), null,
    'si esto se frenara, un cuerpo inactivo no se podría volver a abrir nunca');
});

test('un módulo sin cuerpo no entra en la regla', () => {
  assert.equal(alGuardar('perfiles_permisos', { nombre: 'Uno' }), null);
});

test('y un cuerpo que no existe no frena nada', () => {
  assert.equal(alGuardar('integrantes_cuerpo', { cuerpo_id: 999999 }), null,
    'de eso se encarga la comprobación de referencias rotas, no ésta');
});

// -------------------------------------------------- el cumplimiento ----

test('el cumplimiento deja de castigar el estado en blanco', () => {
  /*
   * Medido antes de esto: el «Cuerpo de prueba 1», con 49 integrantes activos,
   * salía «Pendiente (4)» y uno de los cuatro reproches era «Cuerpo activo ✗
   * Sin estado», por un dato que nadie le había pedido.
   */
  const como = (id) => getModule('cuerpos').computed
    .find((c) => c.name === 'cumplimiento')
    .calc(db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(id), { db });

  const item = (id) => como(id).items.find((i) => i.texto === 'Cuerpo activo');
  assert.equal(item(enBlanco).ok, true, 'sin estado escrito, el cuerpo funciona');
  assert.equal(item(enBlanco).detalle, 'Activo', 'y lo dice, en vez de «Sin estado»');
  assert.equal(item(abierto).ok, true);
  assert.equal(item(cerrado).ok, false, 'y uno cerrado sigue sin cumplir ese requisito');
  assert.equal(item(cerrado).detalle, 'Inactivo');
});

// ------------------------------------ y el motor la aplica, de verdad ----

/*
 * Hasta acá todo llama a la regla a mano, y eso deja fuera lo único que se ve:
 * que el MOTOR la corra al guardar. Es la lección que dejó la misma regla para
 * las iglesias inactivas —borrando de server/crud.js la línea que lanza el
 * aviso, sus diecisiete pruebas seguían en verde—.
 */
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: un cuerpo que se cierra deja de recibir cosas', async () => {
  const api = await elSistemaAndando();
  const m = `cierre-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia del cierre ${m}`, codigo: `CIE${process.pid}`, estado: 'Activa',
  })).json;
  assert.ok(igl && igl.id);

  const nuevo = await api('POST', '/cuerpos', {
    nombre: `Damas del cierre ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  });
  assert.ok(nuevo.json && nuevo.json.id, nuevo.texto.slice(0, 200));
  const cu = nuevo.json.id;

  const persona = (await api('POST', '/miembros', {
    nombres: 'Gente', apellidos: `Delcuerpo ${m}`, iglesia_id: igl.id, estado: 'Activo',
  })).json;
  assert.ok(persona && persona.id);

  /*
   * Este paso es el guardia de todo lo que sigue: si el alta de un integrante
   * fallara por cualquier otro motivo, los 400 de más abajo saldrían igual y
   * la prueba aprobaría sin haber probado nada.
   */
  const mientras = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu, persona_tipo: 'Miembro', miembro_id: persona.id,
    fecha_ingreso: '2026-01-05', estado: 'Activo',
  });
  assert.equal(mientras.estado, 201,
    `mientras el cuerpo funciona, agregar gente tiene que servir: ${mientras.texto.slice(0, 250)}`);

  // Se cierra desde su propia ficha, que es la única salida que el sistema ofrece
  const cierre = await api('PUT', `/cuerpos/${cu}`, { estado: 'Inactivo' });
  assert.equal(cierre.estado, 200, `no se pudo marcar inactivo: ${cierre.texto.slice(0, 200)}`);

  const otra = (await api('POST', '/miembros', {
    nombres: 'Otra', apellidos: `Despues ${m}`, iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const despues = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu, persona_tipo: 'Miembro', miembro_id: otra.id,
    fecha_ingreso: '2026-02-05', estado: 'Activo',
  });
  assert.equal(despues.estado, 400, `metió gente en un cuerpo cerrado: ${despues.texto.slice(0, 250)}`);
  assert.match(despues.json.error, /está marcado como inactivo/i);

  const acta = await api('POST', '/actas_reuniones', {
    cuerpo_id: cu, fecha: '2026-02-10', tipo: 'Ordinaria', numero: `A${process.pid}`,
  });
  assert.equal(acta.estado, 400, 'le anotó un acta nueva');

  const bien = await api('POST', '/inventarios', {
    articulo: `Atril ${m}`, ambito: 'Cuerpo / Grupo', cuerpo_id: cu,
    regimen: 'Propio', cantidad: 1, igual_asi: true,
  });
  assert.equal(bien.estado, 400, 'le inventarió un bien nuevo');

  const actividad = await api('POST', '/asistencias', {
    fecha: '2026-02-15', cuerpos: [cu], tipo_reunion: 'Culto', igual_asi: true,
  });
  assert.equal(actividad.estado, 400, 'lo convocó a una actividad');
  assert.match(actividad.json.error, /está marcado como inactivo/i);

  // Pero lo que ya cuelga de él se sigue corrigiendo
  const correccion = await api('PUT', `/integrantes_cuerpo/${mientras.json.id}`, { notas: 'Corregido' });
  assert.equal(correccion.estado, 200,
    `lo que ya vive en él se sigue corrigiendo: ${correccion.texto.slice(0, 250)}`);

  // Y si el cuerpo vuelve a funcionar, se reabre por donde el aviso dice
  assert.equal((await api('PUT', `/cuerpos/${cu}`, { estado: 'Activo' })).estado, 200);
  const alVolver = await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu, persona_tipo: 'Miembro', miembro_id: otra.id,
    fecha_ingreso: '2026-03-05', estado: 'Activo',
  });
  assert.equal(alVolver.estado, 201,
    `reactivado tiene que volver a recibir gente: ${alVolver.texto.slice(0, 250)}`);
});

test('guardando de verdad: la plata tampoco entra por la puerta de atrás', async () => {
  /*
   * La razón por la que la regla corre DESPUÉS del gancho del módulo. Un
   * movimiento de tesorería no nombra el cuerpo: lo deduce de su cuenta. Al
   * llegar al motor trae `cuerpo_id` vacío, así que preguntando antes del
   * gancho entraría igual en un cuerpo cerrado.
   */
  const api = await elSistemaAndando();
  const m = `platatras-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia de la plata ${m}`, codigo: `PLA${process.pid}`, estado: 'Activa',
  })).json;
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Coro de la plata ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  assert.ok(cu && cu.id);

  // Cada cuerpo estrena sus dos cajas al crearse: se usa la suya
  const cajas = (await api('GET', `/cuentas_tesoreria?q=${encodeURIComponent(m)}&page=1&pageSize=50`))
    .json.rows || [];
  const caja = cajas.find((c) => String(c.cuerpo_id) === String(cu.id));
  assert.ok(caja, `el cuerpo tendría que haber estrenado su caja: ${JSON.stringify(cajas).slice(0, 200)}`);

  const movimiento = {
    tipo: 'Ingreso', categoria: 'Ofrendas', monto: 1000, fecha: '2026-02-01',
    cuenta_id: caja.id, concepto: `Ofrenda ${m}`, igual_asi: true,
  };
  const mientras = await api('POST', '/tesoreria', movimiento);
  assert.equal(mientras.estado, 201,
    `guardia: sin cuerpo_id el movimiento tiene que entrar mientras el cuerpo funciona: ${mientras.texto.slice(0, 250)}`);
  assert.equal(String(mientras.json.cuerpo_id), String(cu.id),
    'y su cuerpo lo pone el módulo, copiándolo de la cuenta: eso es lo que la regla tiene que alcanzar a ver');

  await api('PUT', `/cuerpos/${cu.id}`, { estado: 'Inactivo' });

  const despues = await api('POST', '/tesoreria', { ...movimiento, concepto: `Otra ${m}` });
  assert.equal(despues.estado, 400,
    'entró plata a un cuerpo cerrado: la regla está corriendo antes del gancho del módulo');
  assert.match(despues.json.error, /está marcado como inactivo/i);
});

test('guardando de verdad: ni por la planilla de cuotas', async () => {
  /*
   * La otra puerta de atrás, y la más usada: la planilla de cuotas escribe el
   * pago derecho —y con él su ingreso en tesorería— desde su propia ruta, sin
   * pasar por el guardado. Escrita la regla solo en el motor, ésta habría sido
   * la manera de meterle plata nueva a un cuerpo cerrado. Es la misma lección
   * que dejó el plan de cuotas de una deuda en la 1.248.0.
   */
  const api = await elSistemaAndando();
  const m = `cuotatras-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia de la cuota ${m}`, codigo: `CUO${process.pid}`, estado: 'Activa',
  })).json;
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Damas de la cuota ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
    cobra_cuota: 1, cuota_mensual: 2000,
  })).json;
  const persona = (await api('POST', '/miembros', {
    nombres: 'Quien', apellidos: `Paga ${m}`, iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const ficha = (await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu.id, persona_tipo: 'Miembro', miembro_id: persona.id,
    fecha_ingreso: '2026-01-05', estado: 'Activo',
  })).json;
  assert.ok(ficha && ficha.id);

  const pagar = (mes) => api('POST', `/cuerpos/${cu.id}/cuotas`,
    { integrante_id: ficha.id, anio: 2026, mes });

  const mientras = await pagar('01');
  assert.equal(mientras.estado, 200,
    `guardia: mientras el cuerpo funciona, cobrar la cuota tiene que servir: ${mientras.texto.slice(0, 250)}`);

  await api('PUT', `/cuerpos/${cu.id}`, { estado: 'Inactivo' });

  const despues = await pagar('02');
  assert.equal(despues.estado, 400, `cobró una cuota en un cuerpo cerrado: ${despues.texto.slice(0, 250)}`);
  assert.match(despues.json.error, /está marcado como inactivo/i);

  // Y la otra puerta de la cuota, la del formulario, pide la misma regla
  const porElForm = await api('POST', '/cuotas_cuerpo', {
    integrante_id: ficha.id, anio: 2026, mes: '03', monto: 2000, fecha_pago: '2026-03-05',
  });
  assert.equal(porElForm.estado, 400,
    `las dos puertas de la cuota tienen que pedir la misma regla: ${porElForm.texto.slice(0, 250)}`);
});

// --------------------------------------- y los desplegables dejan de ofrecerlo ----

test('los formularios piden los cuerpos que sí reciben cosas', async () => {
  /*
   * La otra mitad del arreglo, y la que la gente ve primero: frenar el guardado
   * sin sacarlo del desplegable deja a alguien eligiéndolo, llenando la ficha
   * entera y recibiendo el aviso recién al apretar «Guardar».
   *
   * Se pregunta a la ruta de verdad —la que el campo pide— y no al texto del
   * módulo: que la propiedad esté escrita no dice nada de lo que la ruta
   * contesta.
   */
  const api = await elSistemaAndando();
  assert.equal(getModule('cuerpos').opcionesPorDefecto, '/cuerpos/activos?ademas={cuerpo_id}',
    'y es ésa la ruta que el campo pide');

  const m = `desplegable-${process.pid}`;
  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia del desplegable ${m}`, codigo: `DES${process.pid}`, estado: 'Activa',
  })).json;
  const anda = (await api('POST', '/cuerpos', {
    nombre: `Cuerpo que sigue ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const cerrada = (await api('POST', '/cuerpos', {
    nombre: `Cuerpo cerrado ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  assert.ok(anda && anda.id && cerrada && cerrada.id);
  await api('PUT', `/cuerpos/${cerrada.id}`, { estado: 'Inactivo' });

  const ofrecidos = (await api('GET', '/cuerpos/activos')).json || [];
  const ids = ofrecidos.map((o) => String(o.id));
  assert.ok(ids.includes(String(anda.id)), 'el que funciona tiene que salir');
  assert.ok(!ids.includes(String(cerrada.id)),
    'el cerrado se sigue ofreciendo: alguien lo va a elegir y el aviso le va a llegar tarde');

  /*
   * Y el que el campo YA tenía elegido sale igual, esté como esté. Sin esto,
   * abrir el acta de un cuerpo que se cerró la dejaba sin cuerpo en el
   * desplegable, y guardar se lo habría borrado.
   */
  const conElSuyo = (await api('GET', `/cuerpos/activos?ademas=${cerrada.id}`)).json || [];
  assert.ok(conElSuyo.map((o) => String(o.id)).includes(String(cerrada.id)),
    'el acta de un cuerpo cerrado tiene que seguir mostrándolo');
});

test('y el listado de siempre los sigue trayendo todos', async () => {
  /*
   * La mitad que se rompe sin querer. Sacarlo del desplegable es el arreglo;
   * sacarlo del LISTADO sería llevarse por delante la historia que la regla
   * dice proteger.
   */
  const api = await elSistemaAndando();
  const m = `enlalista-${process.pid}`;
  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia de la lista ${m}`, codigo: `LIS${process.pid}`, estado: 'Activa',
  })).json;
  const suyo = (await api('POST', '/cuerpos', {
    nombre: `Cuerpo guardado ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  assert.ok(suyo && suyo.id);
  await api('PUT', `/cuerpos/${suyo.id}`, { estado: 'Inactivo' });

  const enLaLista = (await api('GET', `/cuerpos?q=${encodeURIComponent(m)}&page=1&pageSize=50`))
    .json.rows || [];
  assert.ok(enLaLista.some((f) => String(f.id) === String(suyo.id)),
    'un cuerpo cerrado tiene que seguir saliendo en el listado');
  assert.equal((await api('GET', `/cuerpos/${suyo.id}`)).estado, 200,
    'y su ficha tiene que seguir abriéndose');
});

test('los filtros del listado los siguen ofreciendo todos', () => {
  /*
   * Acotar un listado por un cuerpo cerrado es justamente cómo se consulta lo
   * suyo, y la pantalla de Miembros trae ese filtro. Sale por la regla que ya
   * existe en el cliente, la misma que protege a los filtros de iglesia.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function rutaOpciones(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /!filtrando && f\.type === 'ref'/,
    'solo para elegir dónde va algo nuevo: ni filtros ni campos de varias');
});

// ------------------------------------ lo que ya estaba, con su estado escrito ----

test('los cuerpos que ya estaban estrenan el estado «Activo», que es lo que tenían de hecho', () => {
  /*
   * El valor de fábrica solo se aplica al abrir el formulario, así que los
   * cuerpos que ya existían tenían el estado en blanco: DOCE DE DIECISÉIS,
   * medido. Ahora ese campo decide si el cuerpo recibe cosas nuevas, y un dato
   * que empieza a mandar no puede quedar vacío en las tres cuartas partes de
   * las filas.
   *
   * Se corre sobre una COPIA de la base y no sobre la de las pruebas: los
   * archivos de motor comparten una sola y corren en paralelo, así que una
   * puesta al día que pasa por TODAS las filas pisaría lo que otro archivo está
   * sembrando en ese mismo momento.
   */
  const copia = path.join(os.tmpdir(), `cuerpos-estado-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    const suIglesia = otra
      .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los Sin Estado','IG-SIN','Activa')")
      .run().lastInsertRowid;
    const viejo = (nombre, estado) => otra
      .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)')
      .run(nombre, 'Cuerpo', suIglesia, estado).lastInsertRowid;
    const enNulo = viejo('Damas sin estado', null);
    const enVacio = viejo('Coro con el estado vacío', '');
    const yaCerrado = viejo('Jóvenes que se cerraron', 'Inactivo');
    const yaActivo = viejo('Caballeros al día', 'Activo');

    const estadoDe = (id) => otra.prepare('SELECT estado FROM cuerpos WHERE id = ?').get(id).estado;
    assert.equal(estadoDe(enNulo), null, 'antes de pasarla, el estado está en blanco');

    otra.prepare("DELETE FROM migraciones WHERE nombre = 'el estado de cada cuerpo, escrito'").run();
    elEstadoDeCadaCuerpo(otra);

    assert.equal(estadoDe(enNulo), 'Activo');
    assert.equal(estadoDe(enVacio), 'Activo', 'el vacío escrito cuenta igual que el nulo');
    assert.equal(estadoDe(yaCerrado), 'Inactivo',
      'lo escrito manda: la puesta al día es para lo que no tiene estado, no para corregir el que tiene');
    assert.equal(estadoDe(yaActivo), 'Activo');

    assert.ok(
      otra.prepare("SELECT nombre FROM migraciones WHERE nombre = 'el estado de cada cuerpo, escrito'").get(),
      'queda marcada como aplicada, para no volver a pasarla'
    );
  } finally {
    otra.close();
    for (const s2 of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s2); } catch (e) { /* no estaba */ } }
  }
});

test('y ningún cuerpo queda sin estado después de pasarla', () => {
  const copia = path.join(os.tmpdir(), `cuerpos-todos-${process.pid}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(copia);
  const otra = new Database(copia);
  try {
    otra.prepare("DELETE FROM migraciones WHERE nombre = 'el estado de cada cuerpo, escrito'").run();
    otra.prepare("UPDATE cuerpos SET estado = NULL WHERE id IN (SELECT id FROM cuerpos LIMIT 3)").run();
    elEstadoDeCadaCuerpo(otra);
    const sinEstado = otra
      .prepare("SELECT COUNT(*) n FROM cuerpos WHERE estado IS NULL OR estado = ''").get().n;
    assert.equal(sinEstado, 0, 'la regla nueva mira este campo: dejarlo vacío sería dejarla adivinando');
  } finally {
    otra.close();
    for (const s2 of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + s2); } catch (e) { /* no estaba */ } }
  }
});
