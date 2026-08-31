/**
 * La credencial de un pastor que ya no ejerce.
 *
 * La credencial pastoral tiene una PÁGINA PÚBLICA de verificación: quien la
 * recibe escanea el QR y el sistema le contesta si es auténtica. Medido antes
 * de la 1.241.0, marcando FALLECIDA a la titular de la credencial 0012026 y
 * consultando esa página con su código de autenticidad, antes y después:
 *
 *   marcarla fallecida ................ 200, sin avisar
 *   la credencial quedó .............. «Vigente»
 *   la página pública contestó ....... «VIGENTE · Credencial vigente y
 *                                       emitida por la institución»
 *
 * Es lo único de la revisión de Pastores / Guías que se ve FUERA del sistema:
 * mientras no se toquen los dos hechos, el sistema afirma en público algo que
 * él mismo sabe que no es así.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const ejercen = require('../../server/pastor-que-ejerce');
const CREDENCIALES = getModule('credenciales');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const pastor = (estado) => db
  .prepare('INSERT INTO pastores (nombres, apellidos, cargo, estado) VALUES (?, ?, ?, ?)')
  .run('Josué', `Credencial ${marca()}`, 'Pastor Presbítero', estado).lastInsertRowid;

const credencial = (pastorId, estado = 'Vigente') => db
  .prepare(
    `INSERT INTO credenciales (pastor_id, serie, serie_dv, correlativo, estado,
                               snap_nombres, snap_apellidos, fecha_emision, fecha_vencimiento)
     VALUES (?, ?, '1', ?, ?, 'Josué', 'Credencial', '2026-01-01', '2028-01-01')`
  )
  .run(pastorId, `9${String(++n).padStart(6, '0')}`, n, estado).lastInsertRowid;

const estadoDe = (id) => db.prepare('SELECT estado, motivo_revocacion FROM credenciales WHERE id = ?').get(id);
const fichaDe = (id) => db.prepare('SELECT * FROM pastores WHERE id = ?').get(id);

// -------------------------------------------------- cuáles se cuentan ----

test('las vigentes de un pastor son las que hoy contestarían «vigente»', () => {
  const p = pastor('Activo');
  const viva = credencial(p, 'Vigente');
  credencial(p, 'Borrador');
  credencial(p, 'Revocada');
  credencial(p, 'Reemplazada');
  const suyas = CREDENCIALES.lasVigentesDe(p).map((c) => c.id);
  assert.deepEqual(suyas, [viva], 'un borrador no salió en papel; una revocada o reemplazada ya no vale');
});

test('y un pastor sin credenciales no tiene ninguna', () => {
  assert.deepEqual(CREDENCIALES.lasVigentesDe(pastor('Activo')), []);
});

// -------------------------------------------------------- la pregunta ----

const alDejarDeEjercer = (id, data, existing, confirmado = false) =>
  ejercen.avisoSiDejaDeEjercer(db, id, { data, existing, confirmado });

test('marcarlo fallecido con una credencial vigente pregunta', () => {
  const p = pastor('Activo');
  credencial(p);
  const pregunta = alDejarDeEjercer(p, { estado: 'Fallecido' }, fichaDe(p));
  assert.equal(pregunta.confirmar, 'deja_de_ejercer_y_esta_a_cargo');
  assert.match(pregunta.error, /queda revocada/, 'tiene que decir qué va a pasar con ella');
  assert.match(pregunta.error, /p[úu]blica/, 'y por qué importa: la página que la verifica');
});

test('el aviso nombra la credencial por su número', () => {
  const p = pastor('Activo');
  const c = credencial(p);
  const suSerie = db.prepare('SELECT serie FROM credenciales WHERE id = ?').get(c).serie;
  assert.match(alDejarDeEjercer(p, { estado: 'Fallecido' }, fichaDe(p)).error, new RegExp(suSerie));
});

test('con varias, las cuenta y las nombra a todas', () => {
  const p = pastor('Activo');
  credencial(p); credencial(p);
  const aviso = alDejarDeEjercer(p, { estado: 'Jubilado' }, fichaDe(p)).error;
  assert.match(aviso, /sus 2 credenciales vigentes/);
});

test('sin nada colgando no se pregunta nada', () => {
  const p = pastor('Activo');
  credencial(p, 'Revocada');
  assert.equal(alDejarDeEjercer(p, { estado: 'Fallecido' }, fichaDe(p)), null);
});

test('la pregunta es UNA sola aunque las consecuencias sean dos', () => {
  /*
   * El motor deja pasar una pregunta por guardado. Preguntar «¿y su iglesia?»
   * y después «¿y su credencial?» significaría que la primera se guarda y la
   * segunda aparece recién al guardar de nuevo.
   */
  const p = pastor('Activo');
  credencial(p);
  db.prepare("INSERT INTO iglesias (nombre, codigo, estado, pastor_id) VALUES (?, ?, 'Activa', ?)")
    .run(`Iglesia Suya ${marca()}`, `CRE${marca()}`, p);
  const aviso = alDejarDeEjercer(p, { estado: 'Fallecido' }, fichaDe(p)).error;
  assert.match(aviso, /sin pastor principal/, 'nombra lo de la iglesia');
  assert.match(aviso, /queda revocada/, 'y lo de la credencial, en el mismo aviso');
});

// --------------------------------------------- y confirmado, se revoca ----

test('al confirmar, la credencial queda revocada con su motivo', () => {
  const p = pastor('Activo');
  const c = credencial(p);
  db.prepare("UPDATE pastores SET estado = 'Fallecido' WHERE id = ?").run(p);
  ejercen.soltarLoSuyo(db, fichaDe(p), null);
  const quedo = estadoDe(c);
  assert.equal(quedo.estado, 'Revocada');
  assert.ok(quedo.motivo_revocacion, 'sin motivo, la página pública no puede explicar nada');
});

test('el motivo que se publica no dice si murió, se jubiló o se trasladó', () => {
  /*
   * Se muestra en la página que abre cualquiera con un teléfono. Ahí lo que
   * hace falta saber es que quien tiene esa tarjeta ya no representa a la
   * institución; el estado exacto es asunto de adentro y queda en el historial
   * del pastor.
   */
  const p = pastor('Activo');
  const c = credencial(p);
  db.prepare("UPDATE pastores SET estado = 'Fallecido' WHERE id = ?").run(p);
  ejercen.soltarLoSuyo(db, fichaDe(p), null);
  const motivo = estadoDe(c).motivo_revocacion;
  assert.doesNotMatch(motivo, /Fallecido|Jubilado|Trasladado|Inactivo/);
  assert.match(motivo, /ya no ejerce/);
});

test('no se borra nunca: una credencial emitida es un documento', () => {
  /*
   * Y no basta con que quede una fila con ese número: lo que hace que
   * conservarla sirva de algo es que siga LO IMPRESO —el nombre, el grado, las
   * fechas—, que es lo que alguien tiene en la mano cuando la verifica.
   */
  const p = pastor('Activo');
  const c = credencial(p);
  const antes = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(c);
  db.prepare("UPDATE pastores SET estado = 'Jubilado' WHERE id = ?").run(p);
  ejercen.soltarLoSuyo(db, fichaDe(p), null);

  const despues = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(c);
  assert.ok(despues, 'la fila sigue ahí');
  for (const campo of ['serie', 'serie_dv', 'snap_nombres', 'snap_apellidos',
                       'fecha_emision', 'fecha_vencimiento', 'pastor_id']) {
    assert.equal(String(despues[campo]), String(antes[campo]), `se conserva ${campo}`);
  }
});

test('y no se toca un borrador ni una ya revocada', () => {
  const p = pastor('Activo');
  const borrador = credencial(p, 'Borrador');
  const revocada = credencial(p, 'Revocada');
  db.prepare("UPDATE pastores SET estado = 'Fallecido' WHERE id = ?").run(p);
  ejercen.soltarLoSuyo(db, fichaDe(p), null);
  assert.equal(estadoDe(borrador).estado, 'Borrador');
  assert.equal(estadoDe(revocada).estado, 'Revocada');
});

test('revocar se escribe UNA vez: la ruta y el gancho llaman a la misma función', () => {
  /*
   * Escrita dos veces, un día una de las dos se olvidaría de anotarlo en el
   * historial del pastor y una credencial dejaría de valer sin quedar dicho.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/credenciales.js'), 'utf8');
  assert.match(modulo, /res\.json\(\{ ok: true, credencial: revocarLa\(/, 'la ruta');
  const regla = fs.readFileSync(path.join(__dirname, '../../server/pastor-que-ejerce.js'), 'utf8');
  assert.match(regla, /credenciales\.revocarLa\(c, \{/, 'y el gancho');
});

// ------------------------------------------ las que quedaron de antes ----

test('las vigentes de quienes ya no ejercen salen para el panel', () => {
  const p = pastor('Fallecido');
  const c = credencial(p);
  const suyas = CREDENCIALES.deQuienesYaNoEjercen({ id: 1, rol: 'admin', iglesias: [] })
    .filter((x) => x.id === c);
  assert.equal(suyas.length, 1);
  assert.equal(suyas[0].estadoPastor, 'Fallecido', 'y dice por qué está en la lista');
});

test('las de quienes sí ejercen, no', () => {
  const c = credencial(pastor('Activo'));
  const suyas = CREDENCIALES.deQuienesYaNoEjercen({ id: 1, rol: 'admin', iglesias: [] })
    .filter((x) => x.id === c);
  assert.equal(suyas.length, 0);
});

test('no se revocan solas al arrancar, y es a propósito', () => {
  /*
   * Revocar es un acto con fecha y con motivo. Hacerlo al arrancar el servidor
   * le estamparía a todas la fecha de hoy y un motivo que nadie escribió.
   */
  const migraciones = fs.readFileSync(path.join(__dirname, '../../server/migraciones.js'), 'utf8');
  assert.doesNotMatch(migraciones, /revocarLa|estado = 'Revocada'/,
    'ninguna puesta al día puede revocar credenciales sola');
});

test('el panel las entrega, o el aviso no llega a ninguna parte', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(index, /deQuienesYaNoEjercen\(req\.user\)/,
    'el panel tiene que PEDIRLAS: que la palabra aparezca no basta');
  assert.match(index, /credencialesSinTitular,?\s*\n?\s*\}\);|credencialesSinTitular,/,
    'y mandarlas en la respuesta');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /d\.credencialesSinTitular/, 'y la pantalla tiene que pintarlas');
});

// ------------------------------------------------ guardando de verdad ----

test('guardando de verdad: la pregunta, la revocación y lo que ve quien verifica', async () => {
  const api = await elSistemaAndando();
  const m = `cred-${process.pid}`;

  const p = (await api('POST', '/pastores', {
    nombres: 'Josué', apellidos: `Verifica ${m}`, cargo: 'Pastor Presbítero', estado: 'Activo',
  })).json;
  const c = credencial(p.id);

  const pregunta = await api('PUT', `/pastores/${p.id}`, { estado: 'Fallecido' });
  assert.equal(pregunta.estado, 400, 'tiene que preguntar antes');
  assert.equal(pregunta.json.confirmar, 'deja_de_ejercer_y_esta_a_cargo');
  assert.equal(estadoDe(c).estado, 'Vigente', 'y mientras no confirme, no toca nada');

  assert.equal((await api('PUT', `/pastores/${p.id}`, { estado: 'Fallecido', igual_asi: true })).estado, 200);
  assert.equal(estadoDe(c).estado, 'Revocada');

  // Lo que contesta la verificación: el estado sale al día, que es todo el
  // sentido de que el QR lleve una dirección y no los datos adentro
  const verificacion = require('../../server/credenciales/verificacion');
  const qr = require('../../server/credenciales/qr');
  const fila = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(c);
  const resultado = verificacion.verificar(fila.serie, qr.queCodigoLeToca(fila), {
    buscar: (num) => db.prepare('SELECT * FROM credenciales WHERE serie = ?').get(num),
    situacionDe: CREDENCIALES.situacionDe,
  });
  assert.equal(resultado.valida, true, 'sigue siendo una credencial de la institución, no una falsa');
  assert.equal(resultado.situacion, 'Revocada');
  assert.equal(resultado.sirve, false, 'y ya no sirve');
  assert.match(resultado.datos.motivo_revocacion, /ya no ejerce/);
});

test('y emitirle una credencial nueva a quien ya no ejerce sigue frenado', () => {
  /*
   * Eso lo cierra la 1.240.0 desde el motor. Se comprueba acá también porque
   * las dos mitades son la misma regla: no se le emite, y la que tenía deja de
   * valer.
   */
  const aviso = ejercen.avisoSiElPastorYaNoEjerce(db, CREDENCIALES, {
    data: { pastor_id: pastor('Fallecido') }, existing: null, isNew: true,
  });
  assert.equal(typeof aviso, 'string');
});
