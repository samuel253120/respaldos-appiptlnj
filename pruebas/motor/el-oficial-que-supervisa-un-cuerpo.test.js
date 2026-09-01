/**
 * El sexto cargo, que era el único sin comprobar en el servidor.
 *
 * Los cinco cargos que salen del cuerpo se comprueban al guardar contra sus
 * integrantes. El oficial supervisor es la excepción por diseño —viene del
 * cuerpo de oficiales, porque supervisa a los demás desde fuera— y esa excepción
 * se había quedado a medias:
 *
 *   el selector filtra por el cuerpo de oficiales ..... sí
 *   el servidor lo comprueba al guardar .............. no
 *   poner de supervisor a un miembro cualquiera ...... 200
 *   y a uno de otra iglesia .......................... 200
 *
 * Y como en la base de trabajo el cuerpo de oficiales no está armado, el selector
 * ofrecía los 603 miembros: no quedaba ninguna comprobación en pie por ningún
 * lado.
 *
 * Lo que se cuida acá son tres cosas. Que se pregunte cuando ESTE guardado pone
 * de supervisor a quien no es oficial. Que la IGLESIA NO se exija, que no es un
 * olvido sino lo que este cargo es. Y que cuando el cuerpo de oficiales no está
 * armado —la regla apagada, según la propia configuración— alguien se entere.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { TIPOS } = require('../../server/avisos/avisos');
const vigia = require('../../server/avisos/vigia');
const oficiales = require('../../server/oficiales');
const cargos = require('../../server/cargos-de-la-directiva');
const ajustes = require('../../server/ajustes');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 28200000 + (process.pid % 150000) * 2;
const otroRut = () => { const c = String(++rut); return `${c}-${digitoVerificador(c)}`; };

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

/**
 * Una iglesia con su cuerpo, su gente, y —si se pide— su cuerpo de oficiales.
 *
 * El nombre del cuerpo de oficiales sale del ajuste, así que se lee de ahí en vez
 * de escribir «Oficiales»: si mañana la organización lo llama de otra manera,
 * estas pruebas siguen probando lo mismo.
 */
function unEscenario({ conOficiales = true, cuantosOficiales = 3 } = {}) {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ofi ${m}`, `OFIC${m}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ofi ${m}`, iglesia).lastInsertRowid;

  const persona = (enIglesia = iglesia) => db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
    .run(`Nombre${++n}`, `Deofi ${m}`, otroRut(), enIglesia).lastInsertRowid;
  const meter = (enCuerpo, quien, enIglesia = iglesia) => db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado, iglesia_id)
              VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?)`).run(enCuerpo, quien, enIglesia);

  const gente = [persona(), persona(), persona()];
  for (const g of gente) meter(cuerpo, g);

  /*
   * El cuerpo de oficiales es UNO para toda la organización y se lo busca por
   * nombre, así que acá no se crea otro: se usa el que haya, y si no hay se
   * crea. Estas pruebas corren en procesos paralelos sobre la misma base, y la
   * primera versión creaba uno propio en cada escenario —con lo cual sus
   * «oficiales» no eran los del cuerpo que el sistema encuentra, y la
   * comprobación los rechazaba con razón—.
   */
  let cuerpoOficiales = null;
  const losOficiales = [];
  if (conOficiales) {
    const suyo = oficiales.cuerpoDeOficiales(db);
    cuerpoOficiales = suyo
      ? suyo.id
      : db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
          .run(ajustes.obtener('cuerpo_oficiales') || 'Oficiales', iglesia).lastInsertRowid;
    for (let i = 0; i < cuantosOficiales; i++) {
      const o = persona();
      meter(cuerpoOficiales, o);
      losOficiales.push(o);
    }
  }
  return { m, iglesia, cuerpo, gente, cuerpoOficiales, losOficiales, persona, meter };
}

/**
 * El cuerpo de oficiales es UNO para toda la organización, y se lo busca por
 * nombre sin mirar de qué iglesia es. Como estas pruebas corren en paralelo
 * sobre la misma base, el que encuentre puede ser el de otra: por eso cada
 * comprobación que depende de él lo pregunta y trabaja con ESE, en vez de dar
 * por hecho que es el suyo.
 */
const elDeVerdad = () => oficiales.cuerpoDeOficiales(db);

const unaDirectiva = (e, extra = {}) => ({
  cuerpo_id: e.cuerpo, periodo: `p ${e.m}`, fecha_inicio: anios(-1), fecha_termino: anios(1),
  estado: 'Vigente', primer_jefe_id: e.gente[0], ...extra,
});

// --------------------------------------------- se pregunta en el servidor ----

test('poner de supervisor a quien no es oficial se pregunta', async () => {
  const api = await elSistemaAndando();
  const e = unEscenario();
  const suyo = elDeVerdad();
  const nadaQueVer = e.gente[1];   // integrante del cuerpo, pero no del de oficiales

  const r = await api('POST', '/directivas', unaDirectiva(e, { oficial_supervisor_id: nadaQueVer }));
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'supervisor_que_no_es_oficial');
  assert.ok(r.json.error.includes(suyo.nombre),
    'el aviso tiene que nombrar el cuerpo de oficiales, para saber dónde agregarlo');
  assert.match(r.json.error, /agr[ée]guelo primero/, 'y decir qué hacer');
});

test('y un oficial de verdad entra sin preguntar nada', async () => {
  const api = await elSistemaAndando();
  const e = unEscenario();
  const r = await api('POST', '/directivas', unaDirectiva(e, { oficial_supervisor_id: e.losOficiales[0] }));
  assert.equal(r.estado, 201);
});

test('contestada la pregunta entra, porque a veces se designa antes de anotarlo', async () => {
  const api = await elSistemaAndando();
  const e = unEscenario();
  const r = await api('POST', '/directivas',
    unaDirectiva(e, { oficial_supervisor_id: e.gente[1], igual_asi: true }));
  assert.equal(r.estado, 201);
});

test('corregirle una nota a una que ya tenía mal el supervisor no vuelve a preguntar', async () => {
  /*
   * Se pregunta lo que ESTE guardado pone, igual que con el jefe: un aviso que
   * sale en cada corrección enseña a apretar «Está bien» sin leer.
   */
  const api = await elSistemaAndando();
  const e = unEscenario();
  const puesta = await api('POST', '/directivas',
    unaDirectiva(e, { oficial_supervisor_id: e.gente[1], igual_asi: true }));

  const r = await api('PUT', `/directivas/${puesta.json.id}`, { notas: 'una corrección cualquiera' });
  assert.equal(r.estado, 200);
});

test('la pregunta del supervisor va ANTES que la del jefe', async () => {
  /*
   * Son dos clases de problema distintas: acá hay un dato PUESTO MAL —alguien
   * que no es oficial figurando como supervisor, y eso se ve bien en la
   * pantalla— y allá hay un dato QUE FALTA, que el cumplimiento del cuerpo deja
   * dicho todo el tiempo. Lo que se ve bien y está mal pesa más.
   */
  const api = await elSistemaAndando();
  const e = unEscenario();
  const r = await api('POST', '/directivas', {
    cuerpo_id: e.cuerpo, periodo: `las dos ${e.m}`, fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', oficial_supervisor_id: e.gente[1],   // ni jefe, ni supervisor válido
  });
  assert.equal(r.json.confirmar, 'supervisor_que_no_es_oficial');
});

// ------------------------------------------- la iglesia NO se exige ----

test('un oficial de OTRA iglesia entra, y es lo correcto', async () => {
  /*
   * No es un olvido: es lo que este cargo es. Configuración lo define como «el
   * cuerpo cuyos integrantes pueden ser designados oficial supervisor(a) de LOS
   * DEMÁS CUERPOS», y el sistema busca UN solo cuerpo de oficiales para toda la
   * organización, sin mirar de qué iglesia es. Exigirle la congregación del
   * cuerpo supervisado rompería justamente eso. Es la diferencia con el líder de
   * un cuerpo, que sí es de los suyos y a quien la iglesia sí se le frena (ver
   * server/quien-dirige-el-cuerpo.js).
   */
  const api = await elSistemaAndando();
  const e = unEscenario();
  const suyo = elDeVerdad();
  const otraIglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia lejana ${e.m}`, `LEJ${e.m}`).lastInsertRowid;
  const forastero = e.persona(otraIglesia);
  e.meter(suyo.id, forastero, otraIglesia);

  const r = await api('POST', '/directivas', unaDirectiva(e, { oficial_supervisor_id: forastero }));
  assert.equal(r.estado, 201, 'los oficiales supervisan desde fuera, también desde otra congregación');
});

// ------------------------- mientras el cuerpo de oficiales no esté armado ----

/**
 * Una base de juguete, para preguntar por estados que en la de verdad no se
 * pueden armar sin pisarle la configuración a las otras pruebas.
 *
 * El nombre del cuerpo de oficiales es UN ajuste para toda la base, y estas
 * pruebas corren en paralelo: cambiarlo un instante para ver qué pasa «cuando no
 * existe» se lo cambiaría también a quien esté guardando una directiva en ese
 * momento. Con una base aparte, la pregunta se hace sin tocarle nada a nadie.
 */
function unaBaseDeJuguete() {
  const suya = require('better-sqlite3')(':memory:');
  suya.exec(`
    CREATE TABLE cuerpos (id INTEGER PRIMARY KEY, nombre TEXT, lider_id INTEGER);
    CREATE TABLE miembros (id INTEGER PRIMARY KEY, nombres TEXT, apellidos TEXT);
    CREATE TABLE integrantes_cuerpo (id INTEGER PRIMARY KEY, cuerpo_id INTEGER,
      miembro_id INTEGER, estado TEXT);
  `);
  return suya;
}

test('sin cuerpo de oficiales no se pregunta: la propia configuración lo dice', () => {
  /*
   * «Mientras ese cuerpo no exista o no tenga integrantes, se puede elegir a
   * cualquier miembro», dice el ajuste. Preguntar ahí sería preguntar por una
   * regla que el sistema declara apagada.
   */
  const juguete = unaBaseDeJuguete();
  try {
    // no existe ninguno con ese nombre
    assert.equal(oficiales.comoEsta(juguete, 'Oficiales').armado, false);
    assert.equal(cargos.avisoSiNoEsOficial(juguete, { supervisorId: 7, existing: null, confirmado: false }), null,
      'sin cuerpo de oficiales no hay contra qué comprobar');

    // existe, pero está vacío
    juguete.prepare("INSERT INTO cuerpos (id, nombre) VALUES (1, 'Oficiales')").run();
    const vacio = oficiales.comoEsta(juguete, 'Oficiales');
    assert.ok(vacio.cuerpo, 'lo encuentra');
    assert.equal(vacio.cuantos, 0);
    assert.equal(vacio.armado, false, 'un cuerpo de oficiales sin nadie adentro no arma la regla');

    // y con gente adentro sí
    juguete.prepare("INSERT INTO miembros (id, nombres, apellidos) VALUES (7, 'Quien', 'Sea')").run();
    juguete.prepare("INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado) VALUES (1, 7, 'Activo')").run();
    const armado = oficiales.comoEsta(juguete, 'Oficiales');
    assert.equal(armado.armado, true);
    assert.equal(armado.cuantos, 1);
  } finally {
    juguete.close();
  }
});

test('el vigía y el guardado leen la MISMA respuesta', () => {
  /*
   * La comprobación al guardar se apaga cuando el cuerpo de oficiales no está
   * armado, y el vigía es quien avisa de que lo enciendan. Escritas por separado,
   * un día una daría por armado lo que la otra sigue reclamando: por eso las dos
   * preguntan `oficiales.comoEsta`.
   */
  const fs = require('fs');
  const path = require('path');
  const leer = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  for (const cual of ['server/cargos-de-la-directiva.js', 'server/avisos/vigia.js']) {
    assert.match(leer(cual), /comoEsta\(db\)/, `${cual} tiene que preguntarle a oficiales.comoEsta`);
  }
});

test('el aviso dice qué falta, qué se pierde mientras tanto y adónde ir', () => {
  const sinCuerpo = vigia.avisoDeOficialesSinArmar({ nombre: 'Oficiales', cuerpo: null });
  assert.match(sinCuerpo.titulo, /No hay ning[úu]n cuerpo llamado "Oficiales"/);
  assert.match(sinCuerpo.cuerpo, /no puede comprobar ese cargo/,
    'tiene que decir qué se pierde mientras tanto, no solo que falta algo');
  assert.match(sinCuerpo.cuerpo, /Arme ese cuerpo|cambie el nombre/, 'y ofrecer las dos salidas');
  assert.equal(sinCuerpo.enlace, '#/config/organizacion', 'y llevar a donde se arregla');
  assert.equal(sinCuerpo.tipo, 'cuerpo_oficiales_sin_armar');

  const vacio = vigia.avisoDeOficialesSinArmar({ nombre: 'Oficiales', cuerpo: { id: 1, nombre: 'Oficiales' } });
  assert.match(vacio.titulo, /no tiene integrantes/,
    'existir vacío y no existir son dos problemas distintos y se dicen distinto');
  assert.notEqual(vacio.clave, sinCuerpo.clave,
    'con la misma clave, arreglar a medias no volvería a avisar');
});

test('y no avisa cuando sí está armado', () => {
  const admin = db.prepare("SELECT * FROM usuarios WHERE rol = 'admin' LIMIT 1").get();
  unEscenario();                       // deja un cuerpo de oficiales con gente
  assert.ok(elDeVerdad(), 'el escenario tiene que haber dejado uno');
  const salida = [];
  vigia.cuerpoDeOficialesSinArmar(admin, (a) => salida.push(a));
  assert.equal(salida.length, 0);
});

test('la revisión está en la pasada del día y su tipo está declarado', () => {
  /*
   * Sin el tipo declarado, `crear` tira el aviso a la basura en silencio: ya
   * pasó una vez con dos claves mal puestas (ver server/avisos/vigia.js).
   */
  assert.ok(vigia.REVISIONES.includes(vigia.cuerpoDeOficialesSinArmar),
    'no sirve escribirla y no llamarla');
  assert.ok(TIPOS.cuerpo_oficiales_sin_armar, 'el tipo tiene que estar declarado');
  assert.equal(TIPOS.cuerpo_oficiales_sin_armar.llave, 'sistema_configuracion',
    'solo a quien puede arreglarlo: para el resto es un aviso sobre algo que no está en sus manos');
});

test('a quien no puede entrar a Configuración no le llega', () => {
  /*
   * Quien decide a quién le llega es la LLAVE del tipo de aviso, que es la que
   * mira `avisos.crear` al repartirlo; el `can` de la revisión es un atajo para
   * no consultar la base por alguien que no podría hacer nada. Se comprueba la
   * llave, que es la que manda: la primera versión de esta comprobación llamaba
   * a la revisión con una cuenta sin permiso y daba cero, pero también daba cero
   * con permiso —porque en la base de la prueba el cuerpo de oficiales está
   * armado—, así que no distinguía nada.
   */
  assert.equal(TIPOS.cuerpo_oficiales_sin_armar.llave, 'sistema_configuracion');
  const { can } = require('../../server/permissions');
  const cualquiera = { id: 0, rol: 'consulta', permisos: JSON.stringify({ sistema_configuracion: [] }) };
  assert.equal(can(cualquiera, 'sistema_configuracion', 'view'), false,
    'y esa llave tiene que negarle de verdad a quien no la tiene');
});

// ------------------------------------------------ una sola lista ----

test('el selector y el servidor preguntan por la misma gente', () => {
  /*
   * Media regla es lo que había: el selector filtraba y el servidor no
   * comprobaba. Que los dos salgan de `idsDeOficiales` es lo que impide que
   * vuelvan a separarse.
   */
  const e = unEscenario();
  const suyo = elDeVerdad();
  const ids = oficiales.idsDeOficiales(db);
  assert.ok(ids.length, 'el cuerpo de oficiales tiene integrantes');
  for (const o of e.losOficiales) {
    if (suyo.id !== e.cuerpoOficiales) continue;   // otro proceso dejó el suyo primero
    assert.ok(ids.includes(o), 'los integrantes del cuerpo de oficiales tienen que estar en la lista');
    assert.equal(cargos.avisoSiNoEsOficial(db, { supervisorId: o, existing: null, confirmado: false }), null);
  }
});

test('el supervisor no sale de los integrantes del cuerpo supervisado', () => {
  const conCuerpo = cargos.LOS_DEL_CUERPO.map((c) => c.campo);
  assert.ok(!conCuerpo.includes('oficial_supervisor_id'),
    'si saliera de ahí, la comprobación de los cargos lo frenaría por el motivo equivocado');
});
