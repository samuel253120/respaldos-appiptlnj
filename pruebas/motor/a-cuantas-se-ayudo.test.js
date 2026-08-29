/**
 * A CUÁNTAS PERSONAS DISTINTAS SE HA AYUDADO.
 *
 * Es la primera frase del módulo de No Miembros y era, medido, la pregunta que
 * el sistema no sabía contestar: `/ayudas_sociales/informe` daba 404, igual
 * que `/ayudas_sociales/resumen`, y el panel contaba iglesias, miembros,
 * cuerpos, pastores, solicitudes y certificados sin una palabra de las ayudas.
 * Se podía contar cuántas ENTREGAS hubo —el listado las trae todas— pero no
 * cuántas PERSONAS, que no es lo mismo cuando a una se le entregó tres veces.
 *
 * Lo que cuida este archivo, y sobre todo la trampa del medio:
 *   · que contar personas no sea contar enlaces: la señora que se inscribió
 *     tiene sus entregas repartidas entre dos fichas y es UNA persona
 *   · que las ayudas sin ficha —el nombre escrito a mano de antes del
 *     registro— no se cuenten entre las personas ni se pierdan de las cifras
 *   · que «entregas» no sea «ayudas»
 *   · que el corte por tipo, por iglesia y por mes cuente sus propias personas
 *   · y que el informe pase por el alcance, el período y los filtros
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const aQuien = require('../../server/a-quien-se-ayudo');
const ayudas = require('../../server/modules/ayudas_sociales');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/* ------------------------------------------------------------ el mundo */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Cuenta de ayudas', 'IG-CTA', 'Activa')")
  .run().lastInsertRowid;
const otraIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Cuenta vecina', 'IG-CTV', 'Activa')")
  .run().lastInsertRowid;

const unMiembro = (nombre) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, 'Cuenta', ?, 'Activo')")
  .run(nombre, iglesia).lastInsertRowid;
const unNoMiembro = (nombre, seInscribioEn) => db
  .prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id, miembro_id) VALUES (?, ?, ?, ?)')
  .run(nombre, 'Cuenta', iglesia, seInscribioEn || null).lastInsertRowid;

const entregar = (quien, fecha, estado, valor, tipo, dondeIglesia) => db
  .prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, miembro_id, no_miembro_id,
                                  beneficiario, tipo_ayuda, valor_estimado, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  .run(
    fecha, dondeIglesia || iglesia,
    quien.miembro_id ? 'Miembro' : quien.no_miembro_id ? 'No miembro' : null,
    quien.miembro_id || null, quien.no_miembro_id || null,
    quien.nombre || 'a nombre de alguien', tipo || 'Mercadería', valor, estado
  ).lastInsertRowid;

// Ana: no inscrita, dos entregas
const ana = unNoMiembro('Ana');
entregar({ no_miembro_id: ana }, '2026-01-10', 'Entregada', 10000);
entregar({ no_miembro_id: ana }, '2026-02-10', 'Entregada', 10000, 'Medicamentos');
// Berta: no inscrita, una sola
const berta = unNoMiembro('Berta');
entregar({ no_miembro_id: berta }, '2026-01-15', 'Entregada', 5000);
// Rosa: se inscribió. Dos entregas cuando no lo estaba y una de después.
const rosaMiembro = unMiembro('Rosa');
const rosaVieja = unNoMiembro('Rosa', rosaMiembro);
entregar({ no_miembro_id: rosaVieja }, '2026-01-20', 'Entregada', 7000);
entregar({ no_miembro_id: rosaVieja }, '2026-02-20', 'Entregada', 7000, 'Vestuario');
entregar({ miembro_id: rosaMiembro }, '2026-03-20', 'Entregada', 6000);
// Una que se pidió y no se entregó, y una rechazada
entregar({ no_miembro_id: berta }, '2026-03-01', 'Aprobada', 99000);
entregar({ no_miembro_id: ana }, '2026-03-02', 'Rechazada', 88000);
// Y dos de antes del registro: nombre escrito a mano, sin ficha detrás
entregar({ nombre: 'Juan Pérez' }, '2026-02-01', 'Entregada', 3000);
entregar({ nombre: 'Juan Pérez' }, '2026-02-02', 'Entregada', 3000);
// Una a la que solo se le tramitó algo y todavía no se le entrega nada
const soloPidio = unNoMiembro('Solo pidió');
entregar({ no_miembro_id: soloPidio }, '2026-04-01', 'Solicitada', 1000, 'Otro');
// En la otra iglesia, para el alcance
const deAlLado = unNoMiembro('Sonia');
db.prepare('UPDATE no_miembros SET iglesia_id = ? WHERE id = ?').run(otraIglesia, deAlLado);
entregar({ no_miembro_id: deAlLado }, '2026-02-05', 'Entregada', 50000, 'Mercadería', otraIglesia);

/** Solo lo sembrado acá: la base es compartida con las demás pruebas. */
const MIO = "WHERE iglesia_id IN (SELECT id FROM iglesias WHERE codigo IN ('IG-CTA','IG-CTV'))";
const SOLO_LA_MIA = "WHERE iglesia_id IN (SELECT id FROM iglesias WHERE codigo = 'IG-CTA')";

/* ------------------------------------------ contar personas, no enlaces */

test('la que se inscribió cuenta como UNA persona, no como dos', () => {
  const c = aQuien.cifrasDe(db, MIO, []);
  assert.equal(c.personas, 4,
    'Ana, Berta, Rosa y Sonia: Rosa tiene sus entregas repartidas en dos fichas y es una sola');
  assert.equal(c.entregas, 9, 'las nueve entregadas, incluidas las dos sin ficha');
});

test('y sus entregas de las dos etapas se le suman a ella', () => {
  const top = aQuien.masAyudadas(db, MIO, []);
  const rosa = top.find((f) => f.nombre.startsWith('Rosa'));
  assert.ok(rosa, 'Rosa recibió más de una vez');
  assert.equal(rosa.veces, 3, 'dos de cuando no estaba inscrita y una de después');
  assert.equal(rosa.tipo, 'Miembro', 'se la nombra por la ficha que vive');
  assert.equal(rosa.id, rosaMiembro);
});

test('contar los enlaces distintos daría una persona de más', () => {
  // La cuenta ingenua —cuántos miembro_id/no_miembro_id distintos hay— es la
  // que se escribiría sin pensarlo, y se va inflando sola: una persona de más
  // por cada una que se convierte.
  const ingenua = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT DISTINCT COALESCE('M' || miembro_id, 'N' || no_miembro_id) AS x
           FROM ayudas_sociales ${MIO} AND estado = 'Entregada'
            AND (miembro_id IS NOT NULL OR no_miembro_id IS NOT NULL))`
    )
    .get().c;
  assert.equal(ingenua, 5, 'así se contaría a Rosa dos veces');
  assert.equal(aQuien.cifrasDe(db, MIO, []).personas, 4, 'y la buena la cuenta una');
});

/* -------------------------------------- las que no apuntan a ninguna ficha */

test('las ayudas con el nombre escrito a mano no se cuentan entre las personas', () => {
  const c = aQuien.cifrasDe(db, MIO, []);
  assert.equal(c.sin_ficha, 2, 'las dos de «Juan Pérez», de antes del registro');
  assert.equal(c.personas, 4, 'y no suman personas: dos nombres iguales pueden no ser el mismo señor');
});

test('pero sí cuentan en las entregas y en la plata: no se pierden', () => {
  const c = aQuien.cifrasDe(db, MIO, []);
  assert.equal(c.entregas, 9);
  assert.equal(c.entregado, 10000 + 10000 + 5000 + 7000 + 7000 + 6000 + 3000 + 3000 + 50000);
});

/* --------------------------------------------- entregas no es ayudas */

test('lo solicitado y lo rechazado no son entregas, y se dicen aparte', () => {
  const c = aQuien.cifrasDe(db, MIO, []);
  assert.equal(c.registradas, 12, 'las doce anotadas');
  assert.equal(c.entregas, 9);
  assert.equal(c.en_camino, 2, 'la aprobada de Berta y la solicitada de «Solo pidió»');
  assert.equal(c.rechazadas, 1);
  assert.equal(c.entregado, 101000, 'y la plata de lo no entregado no entra: no salió');
});

test('las personas se cuentan sobre lo ENTREGADO', () => {
  // A «Solo pidió» se le tramitó una ayuda y no se le ha entregado nada. Está
  // en el registro, tiene una ayuda a su nombre, y NO es una persona ayudada:
  // decir que sí sería contarle a la iglesia algo que todavía no hizo.
  assert.equal(aQuien.cifrasDe(db, MIO, []).personas, 4,
    'a esa señora todavía no se le ha ayudado: se le está tramitando');
  const conLoSuyo = aQuien.abiertoPor(db, 'tipo_ayuda', MIO, []);
  assert.equal(conLoSuyo.some((f) => f.clave === 'Otro'), false,
    'y su tipo de ayuda no aparece en el corte, porque no hubo entrega');
});

test('«repitieron» sale de la misma agrupación que «personas»', () => {
  const c = aQuien.cifrasDe(db, MIO, []);
  assert.equal(c.personas, 4);
  assert.equal(c.repitieron, 2, 'Ana con 2 y Rosa con 3');
});

/* ------------------------------------------------ abierto por columna */

test('el corte por tipo de ayuda cuenta sus propias personas', () => {
  const filas = aQuien.abiertoPor(db, 'tipo_ayuda', SOLO_LA_MIA, []);
  const merca = filas.find((f) => f.clave === 'Mercadería');
  assert.ok(merca);
  assert.equal(merca.entregas, 6, 'Ana, Berta y Rosa dos veces, más las dos de Juan Pérez');
  assert.equal(merca.personas, 3, 'Juan Pérez no tiene ficha y no cuenta como persona');
});

test('las personas de las filas no suman el total, y es correcto', () => {
  const filas = aQuien.abiertoPor(db, 'tipo_ayuda', SOLO_LA_MIA, []);
  const sumaDeFilas = filas.reduce((n, f) => n + f.personas, 0);
  const total = aQuien.cifrasDe(db, SOLO_LA_MIA, []).personas;
  assert.ok(sumaDeFilas > total,
    'la misma señora que recibió mercadería y medicamentos está en las dos filas y una vez abajo');
});

/* -- el mes a mes se comprueba más abajo, pidiéndoselo a la ruta: pedírselo
      acá al ayudante con el orden ya puesto solo comprobaría que SQLite ordena. */

/* ----------------------------------------------------- la ruta entera */

function informe(consulta, usuario) {
  let atender = null;
  ayudas.extraRoutes(
    { get(ruta, permiso, mano) { if (ruta === '/ayudas_sociales/informe') atender = mano; }, post() {} },
    {
      db,
      requirePerm: () => (req, res, next) => next(),
      can: () => true,
      scopeClause: (user, params) => require('../../server/alcance').condiciones(ayudas, user, params),
    }
  );
  assert.ok(atender, 'el módulo tiene que ofrecer /ayudas_sociales/informe');
  let salida = null;
  atender({ user: usuario, params: {}, query: consulta }, { json: (d) => { salida = d; }, status() { return this; } });
  return salida;
}

const YO = { id: 1, rol: 'admin', iglesias: [iglesia, otraIglesia], cuerpos: [] };
const SOLO_LA_VECINA = { id: 2, rol: 'secretario', iglesias: [otraIglesia], cuerpos: [] };

test('el informe contesta la pregunta, con su período', () => {
  const d = informe({ desde: '2026-01-01', hasta: '2026-12-31' }, YO);
  assert.equal(d.desde, '2026-01-01');
  assert.equal(d.resumen.personas, 4);
  assert.equal(d.resumen.repitieron, 2);
  assert.ok(d.porTipo.length, 'y lo abre por tipo de ayuda');
  assert.ok(d.porMes.length, 'y mes a mes');
  assert.ok(d.masAyudadas.length, 'y dice a quiénes se les entregó más de una vez');
});

test('el período acota de verdad', () => {
  const enero = informe({ desde: '2026-01-01', hasta: '2026-01-31' }, YO);
  assert.equal(enero.resumen.entregas, 3, 'Ana, Berta y Rosa en enero');
  assert.ok(enero.resumen.entregas < informe({}, YO).resumen.entregas);
});

test('el informe pide el mes a mes en orden de mes, no de plata', () => {
  // Se le pregunta a la RUTA y no al ayudante: el orden es una decisión del
  // informe —el ayudante ordena por plata, que es lo que quieren las otras
  // tablas—, así que comprobarlo pasándole el orden a mano no comprueba nada.
  const meses = informe({}, YO).porMes.map((f) => f.clave);
  assert.ok(meses.length > 1, 'hacen falta varios meses para que el orden se note');
  assert.deepEqual(meses, [...meses].sort(), 'un informe mes a mes desordenado no se puede leer');
  const porPlata = aQuien.abiertoPor(db, "substr(fecha, 1, 7)", MIO, []).map((f) => f.clave);
  assert.notDeepEqual(porPlata, [...porPlata].sort(),
    'y de fábrica no salen en orden de mes: si salieran, esta prueba no probaría nada');
});

test('el filtro por tipo de ayuda también', () => {
  const d = informe({ f_tipo_ayuda: 'Vestuario' }, YO);
  assert.equal(d.resumen.entregas, 1);
  assert.equal(d.resumen.personas, 1);
});

test('quien no ve una ayuda tampoco la cuenta en el informe', () => {
  const suyo = informe({}, SOLO_LA_VECINA);
  assert.equal(suyo.resumen.personas, 1, 'solo Sonia, la de su iglesia');
  assert.equal(suyo.resumen.entregado, 50000);
  const todo = informe({}, YO);
  assert.ok(todo.resumen.entregado > suyo.resumen.entregado);
});

test('cada iglesia sale con su nombre y no con su número', () => {
  const d = informe({}, YO);
  assert.ok(d.porIglesia.every((f) => f.nombre && !/^\d+$/.test(f.nombre)),
    'un informe que dice «iglesia 3» no se puede llevar a ninguna parte');
  assert.ok(d.porIglesia.some((f) => f.nombre === 'Cuenta de ayudas'));
});

/* ------------------------------------------------------ lo que se ve */

test('al listado de ayudas se le puede pedir su informe', () => {
  assert.match(app, /name === 'ayudas_sociales' \? '<button class="btn secondary" id="btnInformeAyudas">📊 Informe<\/button>' : ''/);
  assert.match(app, /location\.hash = `#\/ayudas_sociales\/informe\$\{cola \? '\?' \+ cola : ''\}`/,
    'y se abre con el período y los filtros que ya están puestos');
  assert.match(app, /parts\[0\] === 'ayudas_sociales' && parts\[1\] === 'informe'/, 'la dirección tiene que existir');
});

test('la pantalla dice las dos cosas que, calladas, confunden', () => {
  const pantalla = app.match(/async function viewInformeAyudas[\s\S]*?\n\}\n\nasync function viewInformeServicios/)[0];
  assert.match(pantalla, /Las personas de cada fila no suman\s*\n?\s*el total/,
    'sin decirlo, quien sume las columnas cree que el informe se contradice');
  // Y escrita entera, no armada con el nombre de la columna: así salían frases
  // como «de dos tipo de ayuda distintas» y «de dos mes distintas».
  assert.match(pantalla, /dos tipos de ayuda distintos/);
  assert.match(pantalla, /en dos meses distintos/);
  assert.doesNotMatch(pantalla, /\$\{esc\(columna\.toLowerCase\(\)\)\} distintas/);
  assert.match(pantalla, /escrito\s*\n?\s*a mano/,
    'y hay que decir por qué unas entregas no tienen persona detrás');
  assert.match(pantalla, /r\.sin_ficha/, 'la aclaración sale solo cuando hay alguna');
});

/* ---------------------------------------------------- la cifra del panel */

test('la cifra del panel es la de ESTE mes, y cuenta personas', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const otroAnio = `${new Date().getFullYear() - 2}-06-15`;
  const iglesiaPanel = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Panel de ayudas', 'IG-PAN', 'Activa')")
    .run().lastInsertRowid;
  const unaDeAca = (nombre) => db
    .prepare('INSERT INTO no_miembros (nombres, iglesia_id) VALUES (?, ?)')
    .run(nombre, iglesiaPanel).lastInsertRowid;
  const dora = unaDeAca('Dora');
  const eva = unaDeAca('Eva');
  const vieja = unaDeAca('De hace dos años');
  const meter = (quien, fecha, valor) => db
    .prepare(
      `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id,
                                    beneficiario, tipo_ayuda, valor_estimado, estado)
       VALUES (?, ?, 'No miembro', ?, 'x', 'Mercadería', ?, 'Entregada')`
    )
    .run(fecha, iglesiaPanel, quien, valor);
  meter(dora, hoy, 5000);
  meter(dora, hoy, 5000); // dos entregas, una sola persona
  meter(eva, hoy, 3000);
  meter(vieja, otroAnio, 999000); // de otro año: no es de este mes

  const SUYO = 'WHERE iglesia_id = ?';
  const d = aQuien.delMes(db, SUYO, [iglesiaPanel]);
  assert.equal(d.personas, 2, 'Dora y Eva: a Dora se le entregó dos veces y es una persona');
  assert.equal(d.entregas, 3, 'y tres entregas, que es la otra cifra');
  assert.equal(d.entregado, 13000, 'la de hace dos años no entra, ni su plata');
});

test('el panel cuenta personas, no entregas, y no lo pinta como una alarma', () => {
  assert.match(app, /'Personas ayudadas este mes', d\.counts\.ayudas_personas_mes/,
    'la cifra de afuera es personas: entregas ya se podían contar');
  assert.match(app, /\$\{nota \? `<div class="apunte">/,
    'las entregas van de apunte, no de alarma: no anda mal nada');
  // La tarjeta entera, para que la dirección que se comprueba sea la SUYA y no
  // la del botón del listado, que apunta al mismo lugar unas líneas más abajo.
  const tarjeta = app.match(/\['ayudas_sociales', '🤝'[\s\S]*?\],\n/);
  assert.ok(tarjeta, 'la tarjeta tiene que estar entre las del panel');
  assert.match(tarjeta[0], /'#\/ayudas_sociales\/informe'/,
    'y llevar al informe que explica la cifra: una cifra que no se puede abrir no se puede comprobar');
  // Y el servidor tiene que calcularla de verdad: el panel podría mostrar
  // siempre cero con todo lo de arriba en su sitio.
  const panel = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(panel, /counts\.ayudas_personas_mes = suyas\.personas;/);
  assert.match(panel, /require\('\.\/a-quien-se-ayudo'\)\.delMes\(db, sql, params\)/,
    'con la misma regla que se prueba acá arriba, no con una copia');
  assert.match(panel, /can\(req\.user, 'ayudas_sociales', 'view'\)/,
    'y solo para quien puede abrir el módulo que la explica');
});
