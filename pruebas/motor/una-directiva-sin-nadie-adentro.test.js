/**
 * Una directiva sin una sola persona adentro.
 *
 * Los seis cargos eran opcionales, así que esto entraba con 201 y sin una
 * palabra:
 *
 *   cuerpo ....... el cuerpo
 *   período ...... 2026 – 2027
 *   inicio ....... 01-01-2026
 *   cargos ....... ninguno
 *
 * Y con eso el cuerpo pasaba a cumplir su requisito de tener directiva
 * registrada. Un cuerpo con la directiva en blanco se veía en el listado igual
 * que uno con la suya completa y electa en asamblea, porque de ese cumplimiento
 * sale la etiqueta que el listado muestra.
 *
 * Que los cargos se puedan dejar en blanco NO se toca: el consejero «no siempre
 * se designa», el oficial supervisor lo nombra el cuerpo de oficiales desde
 * fuera, y una directiva se completa a medida que llega el acta. Lo que se cuida
 * acá es que alguien lo mire: que se pregunte cuando ESTE guardado la deja sin
 * quien la encabece, que NO se pregunte cuando ya estaba así —o el aviso saldría
 * en cada corrección y enseñaría a apretar «Está bien» sin leer—, y que el
 * cumplimiento del cuerpo lo diga todo el tiempo, sin que nadie conteste nada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const cargos = require('../../server/cargos-de-la-directiva');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 27500000 + (process.pid % 200000) * 2;
const otroRut = () => { const cuerpo = String(++rut); return `${cuerpo}-${digitoVerificador(cuerpo)}`; };

/** Un cuerpo con gente adentro, para poder ocupar sus cargos. */
function unCuerpoConGente(cuantos = 5) {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia cargos ${m}`, `CARG${m}`).lastInsertRowid;
  const id = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo cargos ${m}`, iglesia).lastInsertRowid;
  const gente = [];
  for (let i = 0; i < cuantos; i++) {
    const miembro = db
      .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
      .run(`Alguien${i}`, `Decargos ${m}`, otroRut(), iglesia).lastInsertRowid;
    db.prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado, iglesia_id)
                VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?)`).run(id, miembro, iglesia);
    gente.push(miembro);
  }
  return { id, iglesia, m, gente };
}

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

const requisito = async (api, cuerpoId, cual) =>
  (await api('GET', `/cuerpos/${cuerpoId}/cumplimiento`)).json.items.find((i) => i.texto === cual);

// ------------------------------------------------- se pregunta al guardar ----

test('una directiva sin nadie adentro se pregunta antes de entrar', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: '2026 – 2027', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente',
  });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_sin_jefe');
  assert.match(r.json.error, /no tiene ning[úu]n cargo anotado/,
    'el aviso tiene que distinguir la directiva vacía de la que solo perdió al jefe');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM directivas WHERE cuerpo_id = ?').get(c.id).n, 0);
});

test('y contestada la pregunta entra, porque el acta llega después', async () => {
  /*
   * Anotar el período antes que los nombres es corriente. Prohibirlo obligaría
   * a inventar un jefe para poder guardar, que es peor que dejar el hueco a la
   * vista.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: '2026 – 2027', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', igual_asi: true,
  });
  assert.equal(r.estado, 201);
});

test('quitarle el jefe a una que lo tenía también se pregunta', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const puesta = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'con jefe', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', primer_jefe_id: c.gente[0], secretario_id: c.gente[1],
  });
  assert.equal(puesta.estado, 201, 'con jefe no pregunta nada');

  const r = await api('PUT', `/directivas/${puesta.json.id}`, { primer_jefe_id: null });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'directiva_sin_jefe');
  assert.match(r.json.error, /tiene 1 de los otros cargos anotado/,
    'no es lo mismo una directiva entera sin jefe que una vacía, y quien contesta tiene que saber cuál es');
});

test('pero corregirle una nota a una que YA estaba sin jefe no vuelve a preguntar', async () => {
  /*
   * Es la diferencia entre avisar y molestar. Un aviso que sale en cada guardado
   * enseña a apretar «Está bien» sin leer, y entonces deja de avisar de lo que
   * importa. Lo permanente lo dice el cumplimiento del cuerpo, que está a la
   * vista en su ficha y en el listado sin que nadie conteste nada.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const sinJefe = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'sin jefe', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', igual_asi: true,
  });

  const r = await api('PUT', `/directivas/${sinJefe.json.id}`, { notas: 'una corrección cualquiera' });
  assert.equal(r.estado, 200, 'sigue sin jefe, pero este guardado no es el que la dejó así');
});

test('y ponerle el jefe tampoco: se pregunta lo que se pierde, no lo que se arregla', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const sinJefe = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'sin jefe', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', igual_asi: true,
  });
  const r = await api('PUT', `/directivas/${sinJefe.json.id}`, { primer_jefe_id: c.gente[0] });
  assert.equal(r.estado, 200);
});

test('la pregunta del traslape va PRIMERO, porque cuesta más de deshacer', async () => {
  /*
   * El «igual así» es uno solo para todo el guardado, así que se contesta la
   * primera que salga: quién dirige el cuerpo pesa más que un cargo que se
   * completa mañana.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  db.prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, 'la de antes', ?, ?, 'Vigente')`).run(c.id, c.iglesia, anios(-1), anios(2));

  const r = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'la que se pisa y no tiene jefe', fecha_inicio: anios(1),
    fecha_termino: anios(3), estado: 'Vigente',
  });
  assert.equal(r.json.confirmar, 'directiva_que_se_pisa',
    'las dos cosas están mal; la que se dice primero es la que cuesta más');
});

// ------------------------------- el cumplimiento lo dice todo el tiempo ----

test('el cuerpo deja de cumplir con una directiva en blanco', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'en blanco', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', igual_asi: true,
  });

  assert.equal((await requisito(api, c.id, 'Directiva en ejercicio')).ok, true,
    'directiva tiene, y eso sigue siendo cierto');
  const cargosPuestos = await requisito(api, c.id, 'Directiva con sus cargos');
  assert.equal(cargosPuestos.ok, false, 'pero no tiene quién la componga, que es otra cosa');
  assert.match(cargosPuestos.detalle, /primer jefe, segundo jefe, secretario y tesorero/,
    'y se dice cuáles faltan, para que se sepa qué hacer');
});

test('se va cumpliendo a medida que se completa', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const d = await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'a medias', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', primer_jefe_id: c.gente[0],
  });
  assert.match((await requisito(api, c.id, 'Directiva con sus cargos')).detalle,
    /Faltan: segundo jefe, secretario y tesorero/);

  await api('PUT', `/directivas/${d.json.id}`, {
    segundo_jefe_id: c.gente[1], secretario_id: c.gente[2], tesorero_id: c.gente[3],
  });
  const listo = await requisito(api, c.id, 'Directiva con sus cargos');
  assert.equal(listo.ok, true);
  assert.match(listo.detalle, /Los cuatro cargos del cuerpo est[áa]n designados/);
});

test('el consejero y el oficial supervisor no se le reprochan al cuerpo', async () => {
  /*
   * El consejero es «cargo adicional, no siempre se designa» —lo dice el propio
   * módulo— y el oficial supervisor lo nombra el cuerpo de oficiales desde
   * fuera: reprocharle a un cuerpo un nombramiento que no está en sus manos
   * sería un reproche que no puede resolver.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  await api('POST', '/directivas', {
    cuerpo_id: c.id, periodo: 'los cuatro', fecha_inicio: anios(-1), fecha_termino: anios(1),
    estado: 'Vigente', primer_jefe_id: c.gente[0], segundo_jefe_id: c.gente[1],
    secretario_id: c.gente[2], tesorero_id: c.gente[3],
  });
  assert.equal((await requisito(api, c.id, 'Directiva con sus cargos')).ok, true,
    'sin consejero y sin supervisor, y cumple');
  assert.deepEqual(cargos.losQueFaltan({ primer_jefe_id: 1, segundo_jefe_id: 2, secretario_id: 3, tesorero_id: 4 }), []);
});

test('sin directiva en ejercicio, el requisito de los cargos tampoco se cumple', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  const r = await requisito(api, c.id, 'Directiva con sus cargos');
  assert.equal(r.ok, false);
  assert.match(r.detalle, /Sin directiva en ejercicio/, 'y no se le reprocha un cargo que no tiene dónde estar');
});

test('el requisito mira la que DIRIGE, no la última que se anotó', async () => {
  /*
   * Es la misma definición de la 1.257.0, y acá hace falta que sea la misma: una
   * directiva ELECTA para el año que viene, ya completa, no puede tapar que la
   * que dirige HOY está en blanco. Con la vieja y la de hoy no se distinguía
   * nada —las dos reglas eligen la misma fila— y por eso una rotura a propósito
   * de esta línea no hacía fallar nada; con la electa sí se distinguen, porque
   * es la última anotada y no es la que manda.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConGente();
  db.prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, 'la de hoy, vacía', ?, ?, 'Vigente')`).run(c.id, c.iglesia, anios(-1), anios(1));
  db.prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado,
                                      primer_jefe_id, segundo_jefe_id, secretario_id, tesorero_id)
              VALUES (?, ?, 'la electa, completa', ?, ?, 'Vigente', ?, ?, ?, ?)`)
    .run(c.id, c.iglesia, anios(2), anios(4), c.gente[0], c.gente[1], c.gente[2], c.gente[3]);

  const r = await requisito(api, c.id, 'Directiva con sus cargos');
  assert.equal(r.ok, false, 'la electa está completa, pero todavía no dirige');
  assert.match(r.detalle, /primer jefe/);
});

// ------------------------------------------ una sola lista de cargos ----

test('los seis cargos están escritos en un solo lugar', () => {
  /*
   * Estaban en tres —el módulo, la bitácora y el panel de la ficha— y encima el
   * panel los rotulaba distinto: «Primer jefe/a» donde el resto del sistema dice
   * «Primer jefe / Primera jefa». Tres copias es el cargo que se agregue mañana
   * quedando fuera de dos de ellas.
   */
  const raiz = path.join(__dirname, '../..');
  const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');
  for (const cual of ['server/modules/directivas.js', 'server/bitacora.js']) {
    const texto = leer(cual);
    assert.match(texto, /cargos-de-la-directiva/, `${cual} tiene que leer la lista, no escribirla`);
    assert.doesNotMatch(texto, /\['segundo_jefe_id', 'Segundo jefe \/ Segunda jefa'\]/,
      `${cual} volvió a tener su propia copia de la lista`);
  }
  const app = leer('public/app.js');
  assert.doesNotMatch(app, /cargo\(d, 'primer_jefe_id'/,
    'el panel de la ficha tiene que armar los cargos desde la definición del módulo');
  assert.match(app, /f\.type === 'ref' && f\.ref === 'miembros'/);
});

test('la lista dice de cada cargo lo que hace falta saber de él', () => {
  assert.equal(cargos.CARGOS.length, 6);
  assert.equal(cargos.QUIEN_ENCABEZA.campo, 'primer_jefe_id');
  assert.deepEqual(cargos.LOS_DEL_CUERPO.map((c) => c.campo),
    ['primer_jefe_id', 'segundo_jefe_id', 'secretario_id', 'tesorero_id', 'consejero_id'],
    'el oficial supervisor no sale del cuerpo: viene del de oficiales');
  const delModulo = (getModule('directivas').fields || [])
    .filter((f) => f.type === 'ref' && f.ref === 'miembros').map((f) => f.name);
  assert.deepEqual(cargos.CARGOS.map((c) => c.campo).sort(), delModulo.sort(),
    'la lista y los campos del módulo tienen que nombrar los mismos seis cargos');
});

test('un cargo en blanco, en cero o en nulo cuenta como vacío', () => {
  assert.equal(cargos.tieneQuienLaEncabece({ primer_jefe_id: 7 }), true);
  for (const nada of [null, undefined, '', 0]) {
    assert.equal(cargos.tieneQuienLaEncabece({ primer_jefe_id: nada }), false, `${nada} no es nadie`);
  }
});
