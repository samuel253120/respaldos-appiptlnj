/**
 * Lo que el panel no decía: qué cuerpos no tienen hoy quién los dirija.
 *
 * Medido antes de esto, sobre la base de trabajo:
 *
 *   cuerpos y grupos ............................ 17
 *   con directiva en ejercicio .................. 0
 *   SIN directiva en ejercicio .................. 17
 *   bloques del panel que lo nombran ............ 0
 *   fichas que había que abrir para saberlo ..... 17
 *
 * El panel avisa de credenciales por vencer, de credenciales de quienes ya no
 * ejercen y de cuerpos que cobran cuota sin monto, y de las directivas no decía
 * nada. Y es el aviso que más se justifica de los cuatro, porque es el único
 * que EMPEORA SOLO: una cuota sin monto espera a que alguien la escriba, pero
 * una directiva se vence porque pasó un día, y el cuerpo amanece sin quién
 * responda por él sin que nadie haya tocado nada.
 *
 * Lo que se cuida acá es que la lista diga QUÉ le pasa a cada cuerpo —nunca
 * tuvo, la suya terminó tal día, hay una electa esperando— y que no reproche
 * lo que no corresponde: un grupo no elige directiva y un cuerpo inactivo dejó
 * de funcionar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { cerrarElSistema } = require('./andando');
const sinDirigir = require('../../server/cuerpo-sin-quien-lo-dirija');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const HOY = require('../../server/fechas').hoy();
const dia = (cuantos) =>
  new Date(Date.parse(`${HOY}T12:00:00Z`) + cuantos * 86400000).toISOString().slice(0, 10);

/**
 * Una iglesia con sus cuerpos, y el usuario que solo alcanza a esa iglesia.
 *
 * El alcance es lo que aísla esta prueba de las demás: la base es una sola y
 * los archivos corren en paralelo, así que preguntar «todos los cuerpos» leería
 * también los que otro archivo está sembrando. Acotando por iglesia, la lista
 * que se mide es exactamente la que se sembró.
 */
function unaIglesiaConSusCuerpos() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia sin dirigir ${m}`, `SDIR${m}`).lastInsertRowid;
  return { m, iglesia, usuario: { iglesias: JSON.stringify([iglesia]) } };
}

/** Un cuerpo de esa iglesia, con la gente que se le diga. */
function unCuerpo(c, nombre, { tipo = 'Cuerpo', estado = 'Activo', gente = 0 } = {}) {
  const id = db
    .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)')
    .run(`${nombre} ${c.m}`, tipo, c.iglesia, estado).lastInsertRowid;
  for (let i = 0; i < gente; i++) {
    const quien = db
      .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
      .run(`Sindir${i}`, `Deprueba ${c.m}`, c.iglesia).lastInsertRowid;
    db.prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado,
                                                fecha_ingreso, iglesia_id)
                VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?, ?)`)
      .run(id, quien, dia(-1000), c.iglesia);
  }
  return id;
}

/** Una directiva de ese cuerpo. Se escribe directo: acá se mide la lectura. */
function unaDirectiva(c, cuerpo, periodo, inicio, termino, estado = 'Vigente') {
  return db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(cuerpo, c.iglesia, periodo, inicio, termino, estado).lastInsertRowid;
}

const laLista = (c) => sinDirigir.losQueSeQuedanSinDirectiva(db, c.usuario);
const suyo = (lista, id) => lista.find((f) => f.id === Number(id));

// ------------------------------------------------- quién entra y quién no ----

test('un cuerpo con su directiva en ejercicio no aparece en el aviso', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Al día', { gente: 3 });
  unaDirectiva(c, cuerpo, '2026 – 2028', dia(-100), dia(500));

  assert.equal(laLista(c).length, 0, 'un aviso que sale para todos no avisa de nada');
});

test('uno que nunca tuvo directiva aparece, y lo dice con esas palabras', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Nunca tuvo', { gente: 4 });

  const f = suyo(laLista(c), cuerpo);
  assert.ok(f, 'un cuerpo sin una sola directiva anotada es el caso más grave de todos');
  assert.equal(f.nivel, 'sin');
  assert.match(f.situacion, /Nunca se le ha anotado una directiva/);
  assert.equal(f.integrantes, 4, 'y a cuánta gente alcanza, que es por dónde se decide');
});

test('uno cuya directiva terminó dice cuándo y de qué período era', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Vencida', { gente: 2 });
  unaDirectiva(c, cuerpo, '2019 – 2020', dia(-2000), dia(-1600));

  const f = suyo(laLista(c), cuerpo);
  assert.equal(f.nivel, 'sin');
  assert.match(f.situacion, /terminó hace 1600 días/, 'de hace seis años o de la semana pasada no es lo mismo');
  assert.ok(f.situacion.includes('período 2019 – 2020'), 'y cuál fue la última que dirigió');
});

test('y si hay una electa esperando, lo dice: no es el mismo problema', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Con electa', { gente: 2 });
  unaDirectiva(c, cuerpo, '2019 – 2020', dia(-2000), dia(-40));
  unaDirectiva(c, cuerpo, '2026 – 2027', dia(20), dia(400));

  const f = suyo(laLista(c), cuerpo);
  assert.equal(f.nivel, 'sin', 'hoy sigue sin quien lo dirija, y eso no se disimula');
  assert.match(f.situacion, /Hay una electa que asume el/,
    'un cuerpo que ya eligió y espera al lunes no está donde uno que no tiene nada');
});

test('uno cuya única directiva todavía no asume no se cuenta como abandonado', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Solo electa', { gente: 2 });
  unaDirectiva(c, cuerpo, '2027 – 2028', dia(120), dia(500));

  const f = suyo(laLista(c), cuerpo);
  assert.equal(f.nivel, 'sin');
  assert.match(f.situacion, /Todavía no asume ninguna/);
  assert.doesNotMatch(f.situacion, /Nunca se le ha anotado/, 'anotó la suya: lo que falta es que empiece');
});

test('una directiva cerrada a mano no cuenta como que dirige', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Finalizada', { gente: 2 });
  unaDirectiva(c, cuerpo, '2026 – 2028', dia(-100), dia(500), 'Finalizada');

  const f = suyo(laLista(c), cuerpo);
  assert.ok(f, 'sus fechas dicen que sí y alguien la cerró: manda quien la cerró');
  assert.equal(f.nivel, 'sin');
});

// ------------------------------------------------------- la que va a vencer ----

test('la que está por terminar sale aparte, no mezclada con las vencidas', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Por vencer', { gente: 2 });
  unaDirectiva(c, cuerpo, '2025 – 2026', dia(-300), dia(30));

  const f = suyo(laLista(c), cuerpo);
  assert.equal(f.nivel, 'por vencer', 'todavía tiene quién la dirija: lo que pasa es que se le acaba');
  assert.match(f.situacion, /termina en 30 días/);
});

test('y una que vence mucho después no molesta a nadie', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Lejana', { gente: 2 });
  unaDirectiva(c, cuerpo, '2026 – 2029', dia(-100), dia(400));

  assert.equal(suyo(laLista(c), cuerpo), undefined,
    'avisar con un año de anticipación es enseñar a no mirar el aviso');
});

test('el plazo de anticipación lo fija Configuración, no una cifra del código', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'A noventa días', { gente: 2 });
  unaDirectiva(c, cuerpo, '2026 – 2027', dia(-100), dia(90));

  assert.equal(suyo(laLista(c), cuerpo), undefined, 'con los 60 de fábrica, a noventa días todavía no');
  /*
   * Se cambia el ajuste DE VERDAD y se vuelve a preguntar. Pasarle el plazo a
   * mano a la función comprobaba que respetara su parámetro —que es cierto— y
   * dejaba sin comprobar lo que dice el nombre de esta prueba: que ese
   * parámetro salga de Configuración. Reemplazar la lectura del ajuste por un
   * 60 escrito en el código no hacía fallar nada.
   *
   * Se devuelve a como estaba: la tabla de configuración es una sola para toda
   * la base de pruebas.
   */
  const ajustes = require('../../server/ajustes');
  const antes = ajustes.obtener('directiva_aviso_dias');
  try {
    ajustes.guardar('directiva_aviso_dias', 120);
    assert.equal(ajustes.numero('directiva_aviso_dias', 7, 365), 120);
    const f = suyo(laLista(c), cuerpo);
    assert.ok(f, 'con 120 días de anticipación, el mismo cuerpo sí sale');
    assert.equal(f.nivel, 'por vencer');
  } finally {
    if (antes === null || antes === undefined) {
      db.prepare("DELETE FROM configuracion WHERE clave = 'directiva_aviso_dias'").run();
    } else {
      ajustes.guardar('directiva_aviso_dias', antes);
    }
  }
  assert.equal(suyo(laLista(c), cuerpo), undefined, 'y devuelto el ajuste, vuelve a no salir');
});

test('una directiva sin fecha de término no entra acá', () => {
  const c = unaIglesiaConSusCuerpos();
  const cuerpo = unCuerpo(c, 'Sin término', { gente: 2 });
  unaDirectiva(c, cuerpo, 'Sin período', dia(-50), null);

  assert.equal(suyo(laLista(c), cuerpo), undefined,
    'no hay día del que avisar; eso lo dice el requisito de cumplimiento del cuerpo');
});

// -------------------------------------------- a quién no se le reprocha nada ----

test('a un grupo no se le pide directiva', () => {
  const c = unaIglesiaConSusCuerpos();
  const grupo = unCuerpo(c, 'Un grupo', { tipo: 'Grupo', gente: 5 });

  assert.equal(suyo(laLista(c), grupo), undefined,
    'un grupo no tiene reglamento ni obligaciones formales, y su cumplimiento ya dice «No aplica»');
});

test('a un cuerpo inactivo tampoco: dejó de funcionar', () => {
  const c = unaIglesiaConSusCuerpos();
  const cerrado = unCuerpo(c, 'Cerrado', { estado: 'Inactivo', gente: 5 });

  assert.equal(suyo(laLista(c), cerrado), undefined,
    'reprocharle algo a quien no puede resolverlo es la manera de que deje de leer los avisos');
});

test('pero uno sin estado escrito sí entra: en blanco significa activo', () => {
  const c = unaIglesiaConSusCuerpos();
  const enBlanco = unCuerpo(c, 'Sin estado', { estado: null, gente: 3 });

  assert.ok(suyo(laLista(c), enBlanco),
    'la mayoría de los cuerpos que ya existían tienen el estado vacío; dejarlos fuera vaciaría el aviso');
});

// --------------------------------------------------------- orden y alcance ----

test('primero los que ya no tienen, y de ésos los que alcanzan a más gente', () => {
  const c = unaIglesiaConSusCuerpos();
  const chico = unCuerpo(c, 'Chico', { gente: 2 });
  const grande = unCuerpo(c, 'Grande', { gente: 9 });
  const seVence = unCuerpo(c, 'Se vence', { gente: 30 });
  unaDirectiva(c, seVence, '2025 – 2026', dia(-300), dia(10));

  const lista = laLista(c);
  assert.deepEqual(lista.map((f) => f.id), [grande, chico, seVence].map(Number),
    'lo que ya pasó pesa más que lo que va a pasar, aunque alcance a menos gente');
});

test('cada quien ve los suyos y no los del resto de la organización', () => {
  const a = unaIglesiaConSusCuerpos();
  const b = unaIglesiaConSusCuerpos();
  const mio = unCuerpo(a, 'El mío', { gente: 2 });
  const ajeno = unCuerpo(b, 'El ajeno', { gente: 2 });

  const lista = laLista(a);
  assert.ok(suyo(lista, mio));
  assert.equal(suyo(lista, ajeno), undefined, 'el aviso se acota como todo lo demás del sistema');
});

test('y quien tiene un cuerpo asignado ve ese cuerpo', () => {
  const c = unaIglesiaConSusCuerpos();
  const uno = unCuerpo(c, 'El asignado', { gente: 2 });
  unCuerpo(c, 'El otro de la misma iglesia', { gente: 2 });

  const lista = sinDirigir.losQueSeQuedanSinDirectiva(
    db, { iglesias: JSON.stringify([c.iglesia]), cuerpos: JSON.stringify([uno]) });
  assert.deepEqual(lista.map((f) => f.id), [Number(uno)],
    'quien tiene asignado un cuerpo no responde por los otros de su iglesia');
});

// ------------------------------------------------------------ las palabras ----

test('el tiempo se dice en palabras y no en un número pelado', () => {
  assert.equal(sinDirigir.cuantoFalta(0), 'hoy mismo');
  assert.equal(sinDirigir.cuantoFalta(1), 'mañana');
  assert.equal(sinDirigir.cuantoFalta(-1), 'ayer');
  assert.equal(sinDirigir.cuantoFalta(12), 'en 12 días');
  assert.equal(sinDirigir.cuantoFalta(-12), 'hace 12 días');
});

test('los días se cuentan bien aunque el mes cambie', () => {
  assert.equal(sinDirigir.diasEntre('2026-01-31', '2026-02-01'), 1);
  assert.equal(sinDirigir.diasEntre('2026-03-01', '2026-01-01'), -59, '2026 no es bisiesto');
  assert.equal(sinDirigir.diasEntre('2026-01-01', 'no es fecha'), null);
});
