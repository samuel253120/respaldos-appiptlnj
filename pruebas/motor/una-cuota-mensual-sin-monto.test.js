/**
 * Un cuerpo que cobra cuota mensual y no dice de cuánto.
 *
 * Medido sobre la base de trabajo:
 *
 *   cuerpos que cobran cuota .......... 16 de 16
 *   de ésos, con el monto escrito ..... 0
 *   personas alcanzadas ............... 603
 *
 * Toda la membresía figuraba debiendo una cuota mensual de monto desconocido.
 * No es un defecto del programa —un cuerpo nace cobrando, y el monto es otro
 * campo— sino un dato que falta; el defecto era que NADIE SE ENTERABA. En la
 * planilla de cuotas del cuerpo se veía, pero había que entrar cuerpo por
 * cuerpo, y ni el listado, ni el panel, ni el estado de cumplimiento lo
 * decían.
 *
 * Así que el arreglo es que se note, en los tres lugares donde se mira, y que
 * ENCENDER la cuota sin poner el monto pregunte.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const faltante = require('../../server/cuota-sin-monto');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const laIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia CQ ${marca()}`, `CQ${marca()}`).lastInsertRowid;

const cuerpo = ({ cobra = 1, monto = null, tipo = 'Cuerpo' } = {}) => db
  .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual) VALUES (?, ?, ?, ?, ?, ?)')
  .run(`Cuerpo CQ ${marca()}`, tipo, laIglesia, 'Activo', cobra, monto).lastInsertRowid;
const fila = (id) => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(id);

// ------------------------------------------------------ quién es el que falta ----

test('le falta el monto al que cobra y no lo dice', () => {
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 1, cuota_mensual: null }), true);
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 1, cuota_mensual: 0 }), true,
    'un monto de cero es lo mismo que ninguno: no se le puede cobrar a nadie');
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 1, cuota_mensual: '' }), true);
});

test('y no le falta al que lo dice, ni al que no cobra', () => {
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 1, cuota_mensual: 2000 }), false);
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 0, cuota_mensual: null }), false,
    'un cuerpo que no cobra no tiene ningún monto que poner');
  assert.equal(faltante.leFaltaElMonto({ cobra_cuota: 0, cuota_mensual: 2000 }), false);
});

// -------------------------------------------------- el estado de cumplimiento ----

const cumplimientoDe = (id) => getModule('cuerpos').computed
  .find((c) => c.name === 'cumplimiento')
  .calc(fila(id), { db });
const laCuota = (id) => cumplimientoDe(id).items.find((i) => i.texto === 'Cuota mensual con monto');

test('el cumplimiento lo cuenta entre los requisitos del cuerpo', () => {
  assert.equal(laCuota(cuerpo({ cobra: 1, monto: null })).ok, false);
  assert.match(laCuota(cuerpo({ cobra: 1, monto: null })).detalle,
    /no dice de cuánto: no se le puede registrar el pago a nadie/);
});

test('y lo da por cumplido cuando el monto está, o cuando no cobra', () => {
  const conMonto = laCuota(cuerpo({ cobra: 1, monto: 2500 }));
  assert.equal(conMonto.ok, true);
  assert.match(conMonto.detalle, /2\.500 al mes/, 'y dice cuánto es, que es el dato que se venía a mirar');

  const sinCobrar = laCuota(cuerpo({ cobra: 0 }));
  assert.equal(sinCobrar.ok, true);
  assert.equal(sinCobrar.detalle, 'No cobra cuota mensual');
});

test('y por eso suma un reproche donde antes no había ninguno', () => {
  /*
   * Es exactamente el punto: los dieciséis cuerpos de la base pasan a decirlo
   * en la etiqueta que el listado ya muestra, sin tener que abrir su planilla
   * de cuotas uno por uno.
   */
  const sinMonto = cumplimientoDe(cuerpo({ cobra: 1, monto: null }));
  const conMonto = cumplimientoDe(cuerpo({ cobra: 1, monto: 2500 }));
  const cuantosFaltan = (c) => c.items.filter((i) => !i.ok).length;
  assert.equal(cuantosFaltan(sinMonto) - cuantosFaltan(conMonto), 1);
  assert.match(sinMonto.texto, /^(Observado|Pendiente) \(/);
});

test('un GRUPO sigue sin evaluarse: no tiene requisitos formales', () => {
  assert.equal(cumplimientoDe(cuerpo({ tipo: 'Grupo', cobra: 1, monto: null })).texto, 'No aplica');
});

// --------------------------------------------------- la pregunta al guardar ----

const alGuardar = (id, data, confirmado = false) => getModule('cuerpos').hooks.beforeSave(
  data, { id, existing: fila(id), isNew: false, db, confirmado }
);

test('encender la cuota sin poner el monto pregunta', () => {
  const cu = cuerpo({ cobra: 0 });
  const aviso = alGuardar(cu, { cobra_cuota: 1 });
  assert.equal(aviso && aviso.confirmar, 'cobra_cuota_sin_monto', 'es una pregunta, no un rechazo');
  assert.match(aviso.error, /Está marcando que este cuerpo cobra cuota mensual, y no dice de cuánto/);
  assert.match(aviso.error, /no se le puede registrar el pago a nadie/);
  assert.match(aviso.error, /va a aparecer en el panel y en su estado de cumplimiento/i,
    'y dice dónde va a quedar a la vista mientras tanto');
});

test('y encenderla CON el monto, no', () => {
  const cu = cuerpo({ cobra: 0 });
  assert.equal(alGuardar(cu, { cobra_cuota: 1, cuota_mensual: 3000 }), null);
});

test('borrarle el monto a uno que sí lo tenía también pregunta', () => {
  const cu = cuerpo({ cobra: 1, monto: 3000 });
  assert.match(String(alGuardar(cu, { cuota_mensual: null }).error), /Está dejando sin monto/);
  assert.match(String(alGuardar(cu, { cuota_mensual: 0 }).error), /Está dejando sin monto/);
});

test('apagar la cuota no pregunta nada: ahí no falta ningún monto', () => {
  const cu = cuerpo({ cobra: 1, monto: 3000 });
  assert.equal(alGuardar(cu, { cobra_cuota: 0, cuota_mensual: null }), null);
});

test('y corregirle el teléfono a uno que YA estaba así no vuelve a preguntar', () => {
  /*
   * La mitad que decide si esto sirve o estorba. Los dieciséis cuerpos de la
   * base están cobrando sin monto: si el aviso saliera en cada guardado,
   * tocarle cualquier cosa a cualquiera de ellos lo mostraría, y un aviso que
   * sale siempre enseña a apretar «Está bien» sin leer.
   */
  const cu = cuerpo({ cobra: 1, monto: null });
  assert.equal(alGuardar(cu, { descripcion: 'Otra cosa' }), null);
  assert.equal(alGuardar(cu, { cobra_cuota: 1 }), null, 'volver a mandar lo mismo no es encender nada');
});

test('crear un cuerpo tampoco pregunta, y es a propósito', () => {
  /*
   * Un cuerpo NACE cobrando —así se decidió y está bien—, así que preguntarlo
   * al crear sería un aviso en cada cuerpo nuevo por un valor que en ese
   * momento casi nunca se sabe: el monto lo fija el cuerpo cuando se reúne.
   * Aparece igual en el panel y en su cumplimiento desde el primer día.
   */
  const data = { nombre: `Nuevo CQ ${marca()}`, tipo: 'Cuerpo', iglesia_id: laIglesia };
  const aviso = getModule('cuerpos').hooks.beforeSave(data, { id: null, existing: null, isNew: true, db, confirmado: false });
  assert.equal(aviso, null);
  assert.equal(data.cobra_cuota, 1, 'guardia: efectivamente nace cobrando, que es lo que hace falta que sea cierto');
});

test('contestando que sí, se guarda', () => {
  const cu = cuerpo({ cobra: 0 });
  assert.equal(alGuardar(cu, { cobra_cuota: 1 }, true), null);
});

test('los rechazos del gancho salen ANTES que esta pregunta', () => {
  /*
   * Un rechazo no se puede contestar. Preguntando primero, alguien contestaría
   * «está bien» para toparse enseguida con un no.
   */
  const otra = db.prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, reune_lideres) VALUES (?, ?, ?, ?, 1)')
    .run(`Directiva CQ ${marca()}`, 'Cuerpo', laIglesia, 'Activo').lastInsertRowid;
  const cu = cuerpo({ cobra: 0 });
  const aviso = alGuardar(cu, { cobra_cuota: 1, reune_lideres: 1 });
  assert.equal(typeof aviso, 'string', 'gana el rechazo de la directiva, que no se puede contestar');
  assert.match(aviso, /ya es la directiva de esta iglesia/);
});

// ------------------------------------------------------------ el panel ----

const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };

test('el panel los junta a todos, con cuánta gente alcanza cada uno', () => {
  const cu = cuerpo({ cobra: 1, monto: null });
  const persona = () => db
    .prepare("INSERT INTO miembros (nombres, apellidos, estado, iglesia_id) VALUES ('Persona', ?, 'Activo', ?)")
    .run(`CQ ${marca()}`, laIglesia).lastInsertRowid;
  const meter = (estado) => db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, iglesia_id, fecha_ingreso, estado)
              VALUES (?, 'Miembro', ?, ?, '2026-01-05', ?)`)
    .run(cu, persona(), laIglesia, estado);
  meter('Activo'); meter('Activo'); meter('En prueba'); meter('Retirado');

  const suyo = faltante.losQueCobranSinMonto(db, admin).find((c) => c.id === cu);
  assert.ok(suyo, 'tiene que salir en la lista del panel');
  assert.equal(suyo.integrantes, 3,
    'los que pertenecen HOY —activos y en prueba—: al retirado no se le cobra, y contarlo daría un número falso');
  assert.ok(suyo.iglesia, 'y trae el nombre de su iglesia, para distinguir dos que se llamen igual');
});

test('el que tiene monto y el que no cobra no salen', () => {
  const conMonto = cuerpo({ cobra: 1, monto: 2500 });
  const sinCobrar = cuerpo({ cobra: 0 });
  const ids = faltante.losQueCobranSinMonto(db, admin).map((c) => c.id);
  assert.ok(!ids.includes(conMonto));
  assert.ok(!ids.includes(sinCobrar));
});

test('y la lista respeta el alcance de quien pregunta', () => {
  /*
   * El secretario de un cuerpo ve el suyo, no los de la organización entera.
   * Es lo mismo que hace el resto del panel.
   */
  const mio = cuerpo({ cobra: 1, monto: null });
  const ajeno = cuerpo({ cobra: 1, monto: null });
  const suyos = faltante.losQueCobranSinMonto(db, { id: 2, rol: 'consulta', iglesias: [laIglesia], cuerpos: [mio] })
    .map((c) => c.id);
  assert.ok(suyos.includes(mio));
  assert.ok(!suyos.includes(ajeno), 'un cuerpo que no tiene asignado no puede aparecerle en el panel');
});

// ------------------------------------ y andando de verdad ----

const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: se pregunta, se guarda, y queda dicho en los dos lugares', async () => {
  const api = await elSistemaAndando();
  const m = `cuota-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia de la cuota ${m}`, codigo: `CTA${process.pid}`, estado: 'Activa',
  })).json;
  assert.ok(igl && igl.id);

  // Nace cobrando y sin monto, sin que nadie pregunte nada
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Damas de la cuota ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  assert.ok(cu && cu.id);
  assert.equal(cu.cobra_cuota, 1);
  assert.ok(!cu.cuota_mensual);

  // Y desde el primer día lo dice su cumplimiento…
  const cump = (await api('GET', `/cuerpos/${cu.id}/cumplimiento`)).json;
  const item = cump.items.find((i) => i.texto === 'Cuota mensual con monto');
  assert.ok(item && item.ok === false, `${JSON.stringify(cump).slice(0, 250)}`);

  /*
   * …y el panel. La ruta del panel vive en server/index.js y este banco de
   * pruebas monta solo el router del motor, así que acá se le pregunta a la
   * misma función que ella llama, y que el panel salga de verdad se comprueba
   * sobre el sistema andando. Lo que sí se fija acá es que index.js la esté
   * pidiendo: sin eso, la lista sería correcta y no la vería nadie.
   */
  const suyo = faltante.losQueCobranSinMonto(db, { id: 1, rol: 'admin', iglesias: [], cuerpos: [] })
    .find((c) => c.id === cu.id);
  assert.ok(suyo, 'el panel tiene que nombrarlo');

  // Apagarla y volver a encenderla sin monto pregunta
  assert.equal((await api('PUT', `/cuerpos/${cu.id}`, { cobra_cuota: 0 })).estado, 200);
  const pregunta = await api('PUT', `/cuerpos/${cu.id}`, { cobra_cuota: 1 });
  assert.equal(pregunta.estado, 400, `tenía que preguntar: ${pregunta.texto.slice(0, 200)}`);
  assert.equal(pregunta.json.confirmar, 'cobra_cuota_sin_monto');

  // Con el monto puesto, entra sin preguntar y sale de las dos listas
  assert.equal((await api('PUT', `/cuerpos/${cu.id}`, { cobra_cuota: 1, cuota_mensual: 3000 })).estado, 200);
  const despues = (await api('GET', `/cuerpos/${cu.id}/cumplimiento`)).json;
  assert.equal(despues.items.find((i) => i.texto === 'Cuota mensual con monto').ok, true);
  assert.ok(!faltante.losQueCobranSinMonto(db, { id: 1, rol: 'admin', iglesias: [], cuerpos: [] })
    .some((c) => c.id === cu.id), 'con el monto puesto tiene que salir de la lista del panel');
});

test('y el panel la pide de verdad, en el servidor y en la pantalla', () => {
  /*
   * La lista puede estar perfecta y no verla nadie. Estas dos líneas son las
   * que la conectan: la ruta del panel que la arma, y la pantalla que la
   * pinta. La misma lección que dejó la regla de la iglesia inactiva —estaba
   * escrita, comprobada y desconectada, y ninguna prueba lo decía—.
   */
  const fs = require('fs');
  const path = require('path');
  const index = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(index, /losQueCobranSinMonto\(db, req\.user\)/);
  assert.match(index, /cuerposSinCuota,/, 'y viaja en la respuesta del panel');

  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /d\.cuerposSinCuota \|\| \[\]/);
  assert.match(app, /\$\{avisoCuota\}/, 'y se pinta: armarla sin ponerla en la página no sirve de nada');
});

test('y la planilla de cuotas sigue negándose a cobrar sin monto', async () => {
  /*
   * Esto ya funcionaba y es lo que hacía que el dato faltante fuera visible
   * —para quien entrara a la planilla—. Se comprueba acá porque es la
   * consecuencia de la que hablan el aviso y el cumplimiento: si un día
   * dejara de negarse, los dos estarían diciendo algo que no es.
   */
  const api = await elSistemaAndando();
  const m = `planilla-${process.pid}`;
  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia de la planilla ${m}`, codigo: `PLL${process.pid}`, estado: 'Activa',
  })).json;
  const cu = (await api('POST', '/cuerpos', {
    nombre: `Coro de la planilla ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const persona = (await api('POST', '/miembros', {
    nombres: 'Quien', apellidos: `Pagaria ${m}`, iglesia_id: igl.id, estado: 'Activo',
  })).json;
  const ficha = (await api('POST', '/integrantes_cuerpo', {
    cuerpo_id: cu.id, persona_tipo: 'Miembro', miembro_id: persona.id,
    fecha_ingreso: '2026-01-05', estado: 'Activo',
  })).json;
  assert.ok(ficha && ficha.id);

  const cobro = await api('POST', `/cuerpos/${cu.id}/cuotas`, { integrante_id: ficha.id, anio: 2026, mes: '01' });
  assert.equal(cobro.estado, 400, `no puede cobrarse sin monto: ${cobro.texto.slice(0, 200)}`);
  assert.match(cobro.json.error, /no tiene definido el monto de su cuota/i);
});
