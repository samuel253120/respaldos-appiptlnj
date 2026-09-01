/**
 * Qué directiva dirige un cuerpo hoy, y por qué eso no puede ser un campo.
 *
 * El estado de una directiva era una casilla con dos opciones que alguien
 * elegía a mano, y las fechas del período eran otros dos campos al lado, sin
 * nada que los relacionara. Medido sobre un mismo cuerpo, en el mismo momento:
 *
 *   período 2018 – 2019, terminó el 31-12-2019 ..... decía «Vigente»
 *   período 2027 – 2028, asume el 01-03-2027 ....... decía «Vigente», y era LA vigente
 *   período 2026 – 2027, el que corre hoy .......... decía «Finalizada»
 *
 * Y lo peor no era la vencida: al registrar la directiva ELECTA para asumir el
 * año siguiente, la regla de «una sola vigente por cuerpo» finalizaba en
 * silencio a la que estaba gobernando. La organización quedaba, en el sistema,
 * sin directiva en ejercicio por haber anotado bien su próxima elección.
 *
 * Lo que se cuida acá: que la situación salga de las fechas por los DOS lados
 * —la vencida no manda, la electa todavía no manda—, que registrar la electa no
 * destituya a nadie, que la fecha de término se siga pudiendo correr en las dos
 * direcciones porque así es como se acorta o se extiende un período, y que las
 * cuatro pantallas que preguntan «¿quién dirige?» contesten lo mismo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const enEjercicio = require('../../server/directiva-en-ejercicio');

test.after(cerrarElSistema);

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

/** Un cuerpo suelto en su propia iglesia, para no pisar a nadie. */
function unCuerpo() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia dir ${m}`, `DIRE${m}`).lastInsertRowid;
  const id = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo dir ${m}`, iglesia).lastInsertRowid;
  return { id, iglesia, m };
}

/** Una directiva escrita derecho en la base, para armar situaciones. */
const laDirectiva = (cuerpo, periodo, inicio, termino, estado = 'Vigente') => db
  .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
            VALUES (?, ?, ?, ?, ?, ?)`)
  .run(cuerpo.id, cuerpo.iglesia, periodo, inicio, termino, estado).lastInsertRowid;

const fila = (id) => db.prepare('SELECT * FROM directivas WHERE id = ?').get(id);
const situacion = (id) => enEjercicio.situacionDe(fila(id), { db });

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

// ----------------------------------------- la situación sale de las fechas ----

test('una directiva que venció sigue guardada «Vigente» y está TERMINADA', () => {
  /*
   * El caso medido: período 2018 – 2019, la casilla decía «Vigente», y el
   * cuerpo la mostraba en verde como su directiva siete años después.
   */
  const c = unCuerpo();
  const vieja = laDirectiva(c, '2018 – 2019', '2018-01-01', '2019-12-31', 'Vigente');
  assert.equal(fila(vieja).estado, 'Vigente', 'lo guardado no se toca');
  assert.equal(situacion(vieja), 'Terminada');
  assert.equal(enEjercicio.laQueEjerce(db, c.id), null, 'y el cuerpo no tiene directiva dirigiendo');
});

test('una electa para el año que viene todavía no dirige', () => {
  const c = unCuerpo();
  const electa = laDirectiva(c, 'la que viene', anios(1), anios(3), 'Vigente');
  assert.equal(situacion(electa), 'Electa');
  assert.equal(enEjercicio.laQueEjerce(db, c.id), null);
});

test('la que está entre sus dos fechas es la que dirige', () => {
  const c = unCuerpo();
  const ahora = laDirectiva(c, 'la de ahora', anios(-1), anios(1), 'Vigente');
  assert.equal(situacion(ahora), 'En ejercicio');
  assert.equal(enEjercicio.laQueEjerce(db, c.id).id, ahora);
});

test('sin fecha de término no vence, y sigue dirigiendo', () => {
  const c = unCuerpo();
  const abierta = laDirectiva(c, 'sin término', anios(-4), null, 'Vigente');
  assert.equal(situacion(abierta), 'En ejercicio');
});

test('«Finalizada» cierra aunque su período siga corriendo', () => {
  /*
   * Es la única cosa que las fechas no pueden decir —una elección anulada, una
   * directiva disuelta sin que nadie anote el día— y por eso el campo se
   * conserva. Cierra; lo que ya no hace es abrir.
   */
  const c = unCuerpo();
  const cerrada = laDirectiva(c, 'disuelta', anios(-1), anios(1), 'Finalizada');
  assert.equal(situacion(cerrada), 'Finalizada');
  assert.equal(enEjercicio.laQueEjerce(db, c.id), null);
});

test('y «Vigente» NO abre: esa es la mitad que faltaba', () => {
  const c = unCuerpo();
  const vencida = laDirectiva(c, 'vencida', anios(-6), anios(-4), 'Vigente');
  assert.notEqual(situacion(vencida), 'En ejercicio');
  assert.equal(situacion(vencida), 'Terminada');
});

test('con dos períodos abiertos manda la que empezó último, y la otra lo dice', () => {
  /*
   * Es como las deja la importación del sistema anterior: sin fecha de término,
   * con la nota «complétela cuando se defina el período». Sin desempate, un
   * cuerpo con dos así tendría DOS directivas en ejercicio, que es justamente
   * lo que esto viene a impedir. La que quedó atrás no se calla: sale
   * «Reemplazada», que es un aviso de que le falta su fecha.
   */
  const c = unCuerpo();
  const primera = laDirectiva(c, 'la vieja', anios(-6), null, 'Vigente');
  const segunda = laDirectiva(c, 'la nueva', anios(-2), null, 'Vigente');
  assert.equal(situacion(segunda), 'En ejercicio');
  assert.equal(situacion(primera), 'Reemplazada');
  assert.equal(enEjercicio.laQueEjerce(db, c.id).id, segunda);
});

// ------------------------------------- registrar la electa no destituye ----

test('registrar la directiva ELECTA no deja al cuerpo sin la que gobierna', async () => {
  /*
   * El defecto que dio origen a todo esto. Antes, guardar la electa marcaba
   * «Finalizada» a la de hoy en un UPDATE silencioso, y el cuerpo quedaba sin
   * directiva en ejercicio —fallando su propio estado de cumplimiento— por
   * haber anotado bien su próxima elección.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const gobierna = laDirectiva(c, 'la de hoy', anios(-1), anios(1), 'Vigente');

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la electa', fecha_inicio: anios(2), fecha_termino: anios(4),
    estado: 'Vigente', igual_asi: true,
  });
  assert.equal(r.estado, 201);
  assert.equal(fila(gobierna).estado, 'Vigente', 'a la que gobierna no se le tocó el campo');
  assert.equal(situacion(gobierna), 'En ejercicio', 'y sigue siendo la que dirige');
  assert.equal(situacion(r.json.id), 'Electa');
  assert.equal(enEjercicio.laQueEjerce(db, c.id).id, gobierna);
});

test('y si los períodos se pisan, se pregunta y se dice qué fecha poner', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  laDirectiva(c, '2026 – 2027', anios(-1), anios(2), 'Vigente');

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la que se pisa', fecha_inicio: anios(1), fecha_termino: anios(3),
    estado: 'Vigente',
  });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa');
  assert.match(r.json.error, /se pisa/);
  assert.match(r.json.error, /póngale de fecha de término el/,
    'el aviso tiene que decir QUÉ hacer, no solo que algo está mal');
  assert.match(r.json.error, /p[óo]ngale de fecha de t[ée]rmino el \d{2}-\d{2}-\d{4}/,
    'el aviso tiene que nombrar una fecha concreta, no decir «corrija las fechas»');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM directivas WHERE cuerpo_id = ?').get(c.id).n, 1,
    'y no se guardó nada mientras tanto');
});

test('la fecha que propone es el día antes de que la nueva asuma', async () => {
  /*
   * Con fechas escritas a mano y no calculadas con la misma función que arma el
   * aviso: la primera versión de esta comprobación pedía la fecha
   * llamando a `elDiaAntes`, así que romper `elDiaAntes` rompía las dos mitades
   * a la vez y la comprobación seguía en verde. El 1 de marzo se comprueba a
   * propósito, que es donde un mes de 28 días puede salir mal.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  laDirectiva(c, 'la de antes', '2010-01-01', '2015-12-31', 'Vigente');

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la que asume', fecha_inicio: '2013-03-01', fecha_termino: '2016-12-31',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 400);
  assert.ok(r.json.error.includes('28-02-2013'),
    `esperaba que propusiera el 28-02-2013 y dijo: ${r.json.error}`);
  assert.ok(r.json.error.includes('01-01-2010') && r.json.error.includes('31-12-2015'),
    'y que nombrara el período con el que se pisa, para saber de cuál habla');
});

test('también se pisa con una que no tiene fecha de término', async () => {
  /*
   * Es como las deja la importación del sistema anterior, así que es el caso
   * más común de todos en una base recién traída: una directiva abierta desde
   * 2015 y una elección nueva encima. Sin esto, una directiva sin término no se
   * pisaba con nada —una rotura a propósito de esa línea no hacía fallar
   * ninguna comprobación, que es como se encontró este hueco—.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  laDirectiva(c, 'la importada', '2015-01-01', null, 'Vigente');

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la nueva', fecha_inicio: '2019-06-01', fecha_termino: '2021-12-31',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 400, 'una abierta se pisa con todo lo que venga después');
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa');
  assert.match(r.json.error, /sin fecha de t[ée]rmino/,
    'y el aviso dice que la anterior no tiene término, que es lo que hay que arreglar');
  assert.ok(r.json.error.includes('31-05-2019'), 'proponiéndole el día antes');
});

test('nadie le corre la fecha a la anterior por su cuenta', async () => {
  /*
   * El aviso PROPONE la fecha; escribirla es del que guarda. Desde esa fecha la
   * anterior deja de ser la directiva del cuerpo, y puede que las dos convivan
   * a propósito mientras se hace la entrega.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const antes = laDirectiva(c, 'la anterior', anios(-1), anios(2), 'Vigente');
  const termino = fila(antes).fecha_termino;

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la que se pisa', fecha_inicio: anios(1), fecha_termino: anios(3),
    estado: 'Vigente', igual_asi: true,
  });
  /*
   * Que el «igual así» ENTRE es la mitad de esta comprobación, y faltaba: sin
   * esta línea, quitarle el guardia a la pregunta —dejarla saliendo siempre,
   * incluso al confirmar— no hacía fallar nada, porque una directiva que no se
   * guarda tampoco le toca la fecha a nadie.
   */
  assert.equal(r.estado, 201, 'contestada la pregunta, la directiva se guarda');
  assert.equal(fila(antes).fecha_termino, termino, 'y la fecha de la anterior quedó como estaba');
  assert.equal(fila(antes).estado, 'Vigente', 'y su campo tampoco');
  assert.equal(enEjercicio.laQueEjerce(db, c.id).id, antes,
    'la que gobierna sigue gobernando: eso es lo que antes se perdía');
});

// ------------------------------- la fecha de término es la herramienta ----

test('acortar el período cierra la directiva, y no pregunta nada', async () => {
  /*
   * Es como se cierra una directiva de verdad: poniéndole el día en que
   * terminó. Acortar nunca crea un traslape, así que no hay nada que preguntar.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const cual = laDirectiva(c, 'la larga', anios(-2), anios(3), 'Vigente');
  assert.equal(situacion(cual), 'En ejercicio');

  const r = await api('PUT', `/directivas/${cual}`, { fecha_termino: anios(-1) });
  assert.equal(r.estado, 200);
  assert.equal(situacion(cual), 'Terminada');
});

test('y extenderlo también, mientras no se pise con otra', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const cual = laDirectiva(c, 'la corta', anios(-2), anios(-1), 'Vigente');
  assert.equal(situacion(cual), 'Terminada');

  const r = await api('PUT', `/directivas/${cual}`, { fecha_termino: anios(2) });
  assert.equal(r.estado, 200, 'una elección se atrasa y el período se extiende: es corriente');
  assert.equal(situacion(cual), 'En ejercicio');
});

test('extenderlo ENCIMA de otra sí pregunta', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const vieja = laDirectiva(c, 'la vieja', anios(-4), anios(-2), 'Vigente');
  laDirectiva(c, 'la de ahora', anios(-1), anios(1), 'Vigente');

  const r = await api('PUT', `/directivas/${vieja}`, { fecha_termino: anios(1) });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa');
});

test('una cerrada a mano SÍ se pisa: el histórico también se contradice', () => {
  /*
   * Acá la 1.257.0 decía lo contrario, y estaba a medias. Su pregunta miraba una
   * sola cosa —quién dirige hoy— y para eso una directiva cerrada está fuera de
   * carrera. Pero dos períodos que se pisan son un problema aunque los dos estén
   * cerrados: el histórico queda diciendo que el cuerpo tuvo dos directivas a la
   * vez, y eso es lo que se lee años después. Medido en la 1.262.0: dos
   * finalizadas que se pisaban dos años entraban las dos sin una palabra.
   */
  const c = unCuerpo();
  laDirectiva(c, 'la de ahora', anios(-1), anios(1), 'Vigente');
  const cerrada = { cuerpo_id: c.id, estado: 'Finalizada', fecha_inicio: anios(-1), fecha_termino: anios(1) };
  assert.equal(enEjercicio.lasQueSePisan(db, cerrada, 0).length, 1);
});

// ------------------------ las pantallas contestan todas lo mismo ----

test('el cumplimiento del cuerpo lee la misma definición', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  laDirectiva(c, 'la vencida', anios(-6), anios(-4), 'Vigente');

  const antes = (await api('GET', `/cuerpos/${c.id}/cumplimiento`)).json;
  const item = antes.items.find((i) => i.texto === 'Directiva en ejercicio');
  assert.ok(item, 'el requisito cambió de nombre: pide una que DIRIJA, no una casilla marcada');
  assert.equal(item.ok, false, 'una vencida en 2019 no puede seguir cumpliendo el requisito');

  laDirectiva(c, 'la de ahora', anios(-1), anios(1), 'Vigente');
  const ahora = (await api('GET', `/cuerpos/${c.id}/cumplimiento`)).json;
  assert.equal(ahora.items.find((i) => i.texto === 'Directiva en ejercicio').ok, true);
});

test('el segundo requisito dejó de ser una pregunta que no puede fallar', async () => {
  /*
   * Decía «Directiva dentro de su período» y comprobaba que su término no
   * hubiera pasado. Desde que la que se trae es la que YA está dentro de su
   * período, eso no puede fallar nunca: un requisito que no puede fallar no
   * comprueba nada. Pasó a pedir lo que de verdad falta —la fecha de término—,
   * que es lo único que hace que una directiva venza alguna vez.
   */
  const api = await elSistemaAndando();
  const c = unCuerpo();
  const abierta = laDirectiva(c, 'sin término', anios(-1), null, 'Vigente');

  const r = (await api('GET', `/cuerpos/${c.id}/cumplimiento`)).json;
  assert.ok(!r.items.some((i) => i.texto === 'Directiva dentro de su período'),
    'el requisito tautológico no puede seguir ahí');
  const item = r.items.find((i) => i.texto === 'Período con fecha de término');
  assert.ok(item);
  assert.equal(item.ok, false);
  assert.match(item.detalle, /no vence nunca/);

  db.prepare('UPDATE directivas SET fecha_termino = ? WHERE id = ?').run(anios(1), abierta);
  const luego = (await api('GET', `/cuerpos/${c.id}/cumplimiento`)).json;
  assert.equal(luego.items.find((i) => i.texto === 'Período con fecha de término').ok, true);
});

test('el resumen de la ficha del cuerpo también', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpo();
  laDirectiva(c, 'la vencida', anios(-6), anios(-4), 'Vigente');
  laDirectiva(c, 'la electa', anios(2), anios(4), 'Vigente');
  const vacio = (await api('GET', `/cuerpos/${c.id}/resumen`)).json;
  assert.equal(vacio.directiva.periodo, null, 'ni la vencida ni la que todavía no asume');
  assert.equal(vacio.directiva.total, 2, 'pero las dos están en su historial');

  laDirectiva(c, 'la de ahora', anios(-1), anios(1), 'Vigente');
  const lleno = (await api('GET', `/cuerpos/${c.id}/resumen`)).json;
  assert.equal(lleno.directiva.periodo, 'la de ahora');
});

test('y el listado muestra la situación, no la casilla guardada', () => {
  const m = getModule('directivas');
  assert.ok(m.listFields.includes('situacion'));
  assert.ok(!m.listFields.includes('estado'),
    'mostrar lo guardado es lo que hacía que una vencida se leyera «Vigente» de un vistazo');
  assert.ok((m.fields || []).some((f) => f.name === 'estado'),
    'pero el campo sigue existiendo: cierra a mano y sirve de filtro');
});

test('en el papel sale la situación y no la casilla', () => {
  /*
   * La hoja imprimía «Estado: Vigente» en la de una directiva terminada en
   * 2019: el mismo defecto de la pantalla, en algo que se firma y se archiva.
   * La hoja dice al pie el día en que se emitió, que es contra el que vale.
   */
  const m = getModule('directivas');
  assert.equal((m.fields || []).find((f) => f.name === 'estado').enElPapel, false);
  const sit = (m.computed || []).find((c) => c.name === 'situacion');
  assert.notEqual(sit.enElPapel, false);
});

test('el panel de directivas de la ficha resalta a la que dirige', () => {
  const desde = app.indexOf('async function renderDirectivasCuerpo(');
  assert.ok(desde > 0);
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /situacionDeDirectiva\(d\)\.texto === 'En ejercicio' \? 'vigente' : ''/,
    'antes resaltaba la que tuviera la casilla en «Vigente»');
  assert.match(trozo, /nivelClase\(situacionDeDirectiva\(d\)\.nivel\)/,
    'y la insignia se pinta del color de la situación');
});

test('la importación cuenta y comprueba con la misma regla', () => {
  const informe = fs.readFileSync(path.join(__dirname, '../../server/importacion/informe.js'), 'utf8');
  assert.doesNotMatch(informe, /directivas WHERE cuerpo_id = \? AND estado = 'Vigente'/,
    'el informe no puede tener su propia definición de quién dirige');
  assert.match(informe, /directiva-en-ejercicio/);
});

test('nadie más se quedó preguntando por el campo guardado', () => {
  /*
   * La cuenta de lectores: si mañana alguien agrega una pantalla que pregunte
   * `estado = 'Vigente'` sobre directivas, esta prueba lo dice. Es la misma
   * forma con que se cerraron las otras definiciones repartidas del sistema.
   */
  const raiz = path.join(__dirname, '../..');
  const mirar = ['server/modules/cuerpos.js', 'server/modules/directivas.js',
                 'server/importacion/informe.js', 'server/importacion/m03-cuerpos.js',
                 'public/app.js'];
  for (const cual of mirar) {
    const texto = fs.readFileSync(path.join(raiz, cual), 'utf8');
    assert.doesNotMatch(texto, /FROM directivas[^;]*estado = 'Vigente'/,
      `${cual} vuelve a decidir por su cuenta quién dirige`);
  }
});
