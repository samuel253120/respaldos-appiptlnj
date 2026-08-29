/**
 * LO QUE SE LE HA ENTREGADO, EN SU PROPIA FICHA.
 *
 * El registro de No Miembros existe, con todas sus letras, «por las ayudas
 * sociales»: para saber a cuántas personas distintas se ha ayudado y para ver
 * que a la misma señora se le entregó tres veces. El dato estaba bien guardado
 * desde el principio —cada ayuda apunta a su ficha— pero no había camino de
 * vuelta: medido contra el sistema andando, la ficha de la persona con tres
 * entregas no decía la palabra «ayuda» ni una vez, y sus pestañas eran Datos,
 * Asistencia y Solicitudes: decía si vino y qué pidió, no qué se le entregó.
 *
 * Lo que cuida este archivo:
 *   · que la ruta traiga las ayudas de esa persona y de nadie más
 *   · que «entregas» no sea «ayudas»: una solicitada o rechazada todavía no es
 *     mercadería que salió, y la insignia del mostrador cuenta las entregadas
 *   · que el resumen se calcule sobre TODAS sus ayudas y no sobre las que
 *     caben en la tabla, que es lo que se rompería en silencio
 *   · que pase por el alcance como cualquier listado
 *   · y que la pantalla ponga la pestaña en los dos registros y pida la cuenta
 *     para la cabecera, que es donde se mira antes de decidir
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const ayudas = require('../../server/modules/ayudas_sociales');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/* ------------------------------------------------------------ el mundo */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Ayudas de la ficha', 'IG-AYF', 'Activa')")
  .run().lastInsertRowid;
const vecina = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Vecina de ayudas', 'IG-AYV', 'Activa')")
  .run().lastInsertRowid;

const laSenora = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Carmen', 'Soto Ayuda', ?)")
  .run(iglesia).lastInsertRowid;
const otraSenora = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES ('Rosa', 'Díaz Ayuda', ?)")
  .run(iglesia).lastInsertRowid;
const unMiembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Luisa', 'Vera Ayuda', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

const entregar = (quien, fecha, estado, valor, tipo) => db
  .prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, miembro_id, no_miembro_id,
                                  beneficiario, tipo_ayuda, descripcion, valor_estimado, estado)
     VALUES (?, ?, ?, ?, ?, 'da lo mismo', ?, 'una caja', ?, ?)`
  )
  .run(
    fecha, quien.iglesia_id || iglesia,
    quien.miembro_id ? 'Miembro' : 'No miembro',
    quien.miembro_id || null, quien.no_miembro_id || null,
    tipo || 'Mercadería', valor, estado
  ).lastInsertRowid;

// A Carmen: tres entregas de verdad, una que le rechazaron y una en trámite
entregar({ no_miembro_id: laSenora }, '2026-03-02', 'Entregada', 20000);
entregar({ no_miembro_id: laSenora }, '2026-05-11', 'Entregada', 35000);
entregar({ no_miembro_id: laSenora }, '2026-07-20', 'Entregada', 18000, 'Medicamentos');
entregar({ no_miembro_id: laSenora }, '2026-08-01', 'Rechazada', 90000);
entregar({ no_miembro_id: laSenora }, '2026-08-15', 'Aprobada', 12000);
// A Rosa, una sola
entregar({ no_miembro_id: otraSenora }, '2026-04-04', 'Entregada', 9000);
// Y a la miembro, dos
entregar({ miembro_id: unMiembro }, '2026-02-02', 'Entregada', 30000);
entregar({ miembro_id: unMiembro }, '2026-06-06', 'Solicitada', 5000);

// Y la que se inscribió: dos entregas de cuando no lo estaba, una de después.
// Su ficha de No Miembro no se borra y queda apuntando a la de miembro.
const yaInscrita = db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Rosa', 'Vera Inscrita', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const suFichaVieja = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos, iglesia_id, miembro_id) VALUES ('Rosa', 'Vera Inscrita', ?, ?)")
  .run(iglesia, yaInscrita).lastInsertRowid;
entregar({ no_miembro_id: suFichaVieja }, '2025-11-03', 'Entregada', 22000);
entregar({ no_miembro_id: suFichaVieja }, '2025-12-20', 'Entregada', 14000);
entregar({ miembro_id: yaInscrita }, '2026-06-15', 'Entregada', 40000);

const YO = { id: 1, rol: 'admin', iglesias: [iglesia], cuerpos: [] };
const LA_DE_AL_LADO = { id: 2, rol: 'secretario', iglesias: [vecina], cuerpos: [] };

/** La ruta de verdad, llamada como la llama el motor. */
function suHistorial(consulta, usuario = YO) {
  let atender = null;
  ayudas.extraRoutes(
    { get(ruta, permiso, mano) { if (ruta === '/ayudas_sociales/de-persona') atender = mano; }, post() {} },
    { db, requirePerm: () => (req, res, next) => next(), can: () => true }
  );
  assert.ok(atender, 'el módulo tiene que ofrecer /ayudas_sociales/de-persona');
  let salida = null;
  let codigo = 200;
  atender(
    { user: usuario, params: {}, query: consulta },
    { json: (d) => { salida = d; }, status(c) { codigo = c; return this; } }
  );
  return { d: salida, codigo };
}

/* ------------------------------------------- lo que la ficha va a decir */

test('la ficha de la señora trae sus ayudas, de la más nueva a la más vieja', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: laSenora });
  assert.equal(d.registradas, 5);
  assert.equal(d.ayudas.length, 5);
  assert.deepEqual(d.ayudas.map((a) => a.fecha),
    ['2026-08-15', '2026-08-01', '2026-07-20', '2026-05-11', '2026-03-02']);
  assert.equal(d.ayudas[2].tipo_ayuda, 'Medicamentos');
});

test('«entregas» cuenta lo que salió, no lo que se pidió', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: laSenora });
  assert.equal(d.entregas, 3, 'tres entregadas: la rechazada y la aprobada todavía no son entrega');
  assert.equal(d.en_camino, 1, 'la aprobada está en trámite');
  assert.equal(d.registradas, 5, 'pero las cinco quedan registradas y a la vista');
});

test('la última entrega es la última ENTREGADA, no la última anotada', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: laSenora });
  assert.equal(d.ultima, '2026-07-20',
    'la del 15-08 está aprobada, no entregada: decir que se le entregó ese día sería falso');
});

test('lo entregado suma solo lo que se entregó', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: laSenora });
  assert.equal(d.entregado, 20000 + 35000 + 18000);
});

test('las ayudas de una son las de una, y no las de la de al lado', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: otraSenora });
  assert.equal(d.registradas, 1);
  assert.equal(d.entregado, 9000);
});

test('sirve igual para el registro de miembros', () => {
  const { d } = suHistorial({ tipo: 'Miembro', id: unMiembro });
  assert.equal(d.registradas, 2);
  assert.equal(d.entregas, 1);
  assert.equal(d.en_camino, 1);
});

test('los dos registros no se cruzan aunque compartan el número', () => {
  // Una ficha de no miembro y una de miembro pueden tener el mismo id: si la
  // ruta mirara la columna equivocada, mostraría las ayudas de otra persona.
  const gemelo = db
    .prepare("INSERT INTO no_miembros (nombres, iglesia_id) VALUES ('Gemela sin ayudas', ?)")
    .run(iglesia).lastInsertRowid;
  const comoMiembro = suHistorial({ tipo: 'Miembro', id: gemelo });
  assert.notEqual(comoMiembro.d.registradas, undefined);
  const comoNoMiembro = suHistorial({ tipo: 'No miembro', id: gemelo });
  assert.equal(comoNoMiembro.d.registradas, 0, 'esta ficha no ha recibido nada');
  assert.equal(comoNoMiembro.d.ultima, null);
  assert.equal(comoNoMiembro.d.entregado, 0);
});

test('sin decir de quién, no se contesta', () => {
  const { codigo } = suHistorial({ tipo: 'No miembro' });
  assert.equal(codigo, 400);
});

/* ------------------------- la que se inscribió: una sola historia ----- */

test('su ficha de miembro muestra también lo que se le entregó antes de inscribirse', () => {
  const { d } = suHistorial({ tipo: 'Miembro', id: yaInscrita });
  assert.equal(d.registradas, 3, 'dos de cuando no estaba inscrita y una de después');
  assert.equal(d.entregas, 3);
  assert.equal(d.entregado, 22000 + 14000 + 40000);
  assert.equal(d.antes_de_inscribirse, 2, 'y se dice cuántas son de antes, que no es lo mismo');
});

test('las de antes vienen marcadas, para no confundir las dos etapas', () => {
  const { d } = suHistorial({ tipo: 'Miembro', id: yaInscrita });
  const marcadas = d.ayudas.filter((a) => a.antes).map((a) => a.fecha).sort();
  assert.deepEqual(marcadas, ['2025-11-03', '2025-12-20']);
  assert.equal(d.ayudas.find((a) => a.fecha === '2026-06-15').antes, 0,
    'la de después de inscribirse no lleva la marca');
});

test('su ficha vieja sigue mostrando las suyas, y solo las suyas', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: suFichaVieja });
  assert.equal(d.registradas, 2, 'de esa ficha cuelgan las dos de antes');
  assert.equal(d.antes_de_inscribirse, 0,
    'mirando la ficha vieja no hay «antes»: es la ficha que las recibió');
});

test('el enlace se sigue hacia atrás y no hacia adelante', () => {
  // La ficha de no miembro apunta a la de miembro. Si la ruta siguiera ese
  // enlace también desde el lado del no miembro, la ficha vieja mostraría la
  // ayuda de 2026 que se le entregó cuando ya era miembro: sería contarle a
  // una ficha algo que nunca recibió.
  const { d } = suHistorial({ tipo: 'No miembro', id: suFichaVieja });
  assert.equal(d.ayudas.some((a) => a.fecha === '2026-06-15'), false);
});

test('una persona que nunca fue no miembro no ve ayudas de nadie', () => {
  const { d } = suHistorial({ tipo: 'Miembro', id: unMiembro });
  assert.equal(d.registradas, 2, 'las suyas y nada más');
  assert.equal(d.antes_de_inscribirse, 0);
});

/* --------------------------------------------------------- el alcance */

test('quien no ve la ayuda tampoco la ve desde la ficha', () => {
  const { d } = suHistorial({ tipo: 'No miembro', id: laSenora }, LA_DE_AL_LADO);
  assert.equal(d.registradas, 0, 'la secretaria de la otra iglesia no ve estas entregas');
  assert.equal(d.ayudas.length, 0);
  assert.equal(d.entregado, 0);
});

/* ------------------------------- el resumen no depende de la pantalla */

test('el resumen cuenta todas sus ayudas, no las que caben en la tabla', () => {
  const muchas = db
    .prepare("INSERT INTO no_miembros (nombres, iglesia_id) VALUES ('La de muchas entregas', ?)")
    .run(iglesia).lastInsertRowid;
  const meter = db.transaction((cuantas) => {
    for (let i = 0; i < cuantas; i++) entregar({ no_miembro_id: muchas }, '2026-01-01', 'Entregada', 1000);
  });
  meter(210);

  const { d } = suHistorial({ tipo: 'No miembro', id: muchas });
  assert.equal(d.registradas, 210, 'las 210 están, aunque no quepan');
  assert.equal(d.entregas, 210);
  assert.equal(d.entregado, 210000, 'y la suma es de las 210, no de las que se muestran');
  assert.equal(d.ayudas.length, 200, 'la tabla trae 200: la pantalla no muestra un listado sin fin');
  assert.ok(d.registradas > d.ayudas.length,
    'y la diferencia queda a la vista para poder avisar que hay más atrás');
});

/* ------------------------------------------------- lo que dice arriba */

/** La misma línea que arma la pantalla, sacada de su propio código. */
const resumenDeAyudas = (() => {
  const trozo = app.match(/function resumenDeAyudas\(d\) \{[\s\S]*?\n\}/);
  assert.ok(trozo, 'la pantalla tiene que armar la línea del resumen');
  // eslint-disable-next-line no-new-func
  return new Function('fmtNumero', 'fechaCorta', `${trozo[0]}; return resumenDeAyudas;`)(
    (n) => String(n),
    (f) => String(f).slice(0, 10).split('-').reverse().join('-')
  );
})();

test('la cabecera dice cuántas entregas y cuándo fue la última', () => {
  const dice = resumenDeAyudas({ registradas: 5, entregas: 3, entregado: 73000, ultima: '2026-07-20', en_camino: 1 });
  assert.match(dice, /3 entregas/);
  assert.match(dice, /20-07-2026/);
  assert.match(dice, /1 en trámite/);
});

test('a quien no se le ha entregado nada, la cabecera no le dice nada', () => {
  assert.equal(resumenDeAyudas({ registradas: 0, entregas: 0, entregado: 0, ultima: null, en_camino: 0 }), '',
    'una insignia que dice «0 entregas» en toda ficha es ruido');
  assert.equal(resumenDeAyudas(null), '');
});

test('una sola entrega se dice en singular', () => {
  assert.match(resumenDeAyudas({ registradas: 1, entregas: 1, entregado: 9000, ultima: '2026-04-04', en_camino: 0 }),
    /^1 entrega · la última el 04-04-2026$/);
});

test('si todas se rechazaron, se dice que pasó por acá y no que no hay nada', () => {
  const dice = resumenDeAyudas({ registradas: 2, entregas: 0, entregado: 0, ultima: null, en_camino: 0 });
  assert.ok(dice, 'dos ayudas rechazadas no son «nada registrado»');
  assert.match(dice, /2 ayuda/);
});

/* --------------------------------------------------- lo que hay en pantalla */

test('la pestaña de Ayudas está en los dos registros', () => {
  assert.match(app, /const COMO_RECIBE_AYUDA = \{ miembros: 'Miembro', no_miembros: 'No miembro' \};/,
    'la misma persona puede recibir antes y después de inscribirse');
  assert.match(app, /if \(COMO_RECIBE_AYUDA\[name\] && MOD\['ayudas_sociales'\]\) \{\s*\n\s*sumar\('ayudas', 'Ayudas'/,
    'la ficha tiene que ofrecer la pestaña');
});

test('la cuenta se pide para la cabecera, sin abrir la pestaña', () => {
  assert.match(app, /suCaja\.insertAdjacentHTML\('beforeend', `<span class="badge">🤝 \$\{esc\(dice\)\}<\/span>`\)/,
    'la insignia va arriba: quien abre la ficha en el mostrador no va a ir a buscarla');
  assert.match(app, /!suCaja\.isConnected/,
    'una respuesta que llega tarde no puede escribir en la cabecera de otra persona');
});

test('desde una fila se llega a la ayuda, y el botón viene con la persona puesta', () => {
  const panel = app.match(/async function renderAyudasDeLaPersona[\s\S]*?\n\}/)[0];
  // Ayudas Sociales no tiene ficha de lectura: se abre en su formulario, como
  // el propio listado del módulo. Sin el «edit» la fila lleva a una dirección
  // que no existe y la pantalla se queda en el listado sin decir nada.
  assert.match(panel, /data-ir="#\/m\/ayudas_sociales\/edit\/\$\{a\.id\}"/,
    'la fila tiene que llevar a esa ayuda');
  assert.match(panel, /#\/m\/ayudas_sociales\/new\?beneficiario_tipo=\$\{encodeURIComponent\(aQuien\)\}&\$\{campo\}=\$\{aCual\}/,
    'registrar una ayuda desde su ficha tiene que llegar con la persona ya elegida');
});

test('la ficha vieja avisa arriba que esa persona ya se inscribió', () => {
  /*
   * Se mira SOLO este bloque y no todo el archivo: el pie de la pestaña de
   * Datos ya tenía su propio enlace a la ficha de miembro, así que buscar el
   * enlace en app.js entero daba por buena esta insignia aunque no llevara a
   * ninguna parte. La prueba celebraba el enlace de al lado.
   */
  const bloque = app.match(
    /if \(name === 'no_miembros' && row\.miembro_id && MOD\['miembros'\]\) \{[\s\S]*?\n  \}/
  );
  assert.ok(bloque, 'quien abre esta ficha a registrarle algo tiene que enterarse antes de hacerlo');
  assert.match(bloque[0], /Ya se inscribió · ver su ficha de miembro/);
  assert.match(bloque[0], /<a class="badge blue" href="#\/m\/miembros\/ficha\/\$\{row\.miembro_id\}"/,
    'y tiene que ser un enlace de verdad a la ficha que sí vive');
  assert.match(bloque[0], /caja\.hidden = false;/, 'la caja de insignias puede venir escondida');
});

test('en una ficha ya inscrita, la ayuda nueva se le anota a la ficha que vive', () => {
  const panel = app.match(/async function renderAyudasDeLaPersona[\s\S]*?\n\}/)[0];
  assert.match(panel, /const aQuien = yaEsMiembro \? 'Miembro' : tipo;/);
  assert.match(panel, /const aCual = yaEsMiembro \|\| personaId;/,
    'anotarla en la ficha vieja la dejaría colgando de una que ya nadie abre');
  assert.match(app, /renderAyudasDeLaPersona\(COMO_RECIBE_AYUDA\[name\], id, c, name === 'no_miembros' \? row\.miembro_id : null\)/);
});

test('las filas de antes de inscribirse se ven distintas, y se dicen en palabras', () => {
  const panel = app.match(/async function renderAyudasDeLaPersona[\s\S]*?\n\}/)[0];
  assert.match(panel, /a\.antes \? ' <span class="badge">antes de inscribirse<\/span>' : ''/);
  // La CONDICIÓN, no la mención: dejar el texto dentro de una rama muerta lo
  // deja escrito en el archivo y apagado en la pantalla, y una prueba que solo
  // busca el nombre de la variable da eso por bueno.
  assert.match(panel, /\$\{d\.antes_de_inscribirse\n\s*\? `<div class="card-body mut"/,
    'el párrafo tiene que salir cuando y solo cuando haya alguna de antes');
  assert.match(panel, /cuando todavía no estaba inscrita/);
});

test('la pestaña usa la cuenta del servidor y no suma las filas de la tabla', () => {
  const panel = app.match(/async function renderAyudasDeLaPersona[\s\S]*?\n\}/)[0];
  assert.match(panel, /resumenDeAyudas\(d\)/, 'la misma línea que la cabecera');
  assert.doesNotMatch(panel, /\.reduce\(/,
    'sumar las filas mostradas daría un total distinto al de arriba en cuanto haya más de las que caben');
  assert.match(panel, /d\.registradas - d\.ayudas\.length/, 'y se avisa cuando quedaron más atrás');
});
