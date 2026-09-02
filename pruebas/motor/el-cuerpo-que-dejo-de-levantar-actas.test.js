/**
 * Los cuerpos que dejaron de levantar actas.
 *
 * Medido sobre la base de trabajo, antes de esto:
 *
 *   cuerpos formales ............................ 17
 *   con alguna acta anotada ..................... 2
 *   requisitos que el cumplimiento les mide ..... 6, ninguno de actas
 *   tarjetas del panel que lo nombran ........... 0, de 8
 *
 * El libro de actas era una bodega: se guardaba mucho y no lo miraba nadie, y
 * un cuerpo que llevaba dos años sin anotar una no aparecía en ninguna parte.
 *
 * LO QUE ESTO NO ES, y es lo que más importa de esta prueba: no es un requisito
 * de cumplimiento. La corporación decidió que el libro de actas no debe pesar
 * en si un cuerpo aparece «Al día» o «Pendiente» —levantar actas es una
 * práctica que se cuida, no un papel que se exige— así que el aviso avisa y no
 * reprocha, y el módulo del cumplimiento no sabe que este existe.
 *
 * El corte sale de una sola cifra que pone la organización: doce actas al año,
 * o sea una al mes. Se avisa al DOBLE de ese intervalo, para que una reunión
 * que se corrió o un mes de vacaciones no salten en el panel.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const ajustes = require('../../server/ajustes');
const sinActas = require('../../server/cuerpo-que-no-levanta-actas');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
const HOY = '2026-09-02';

/** Un cuerpo formal y activo, con las actas que se le indiquen. */
function unCuerpoCon(fechas, extra) {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `LIB${m}`).lastInsertRowid;
  const cuerpo = db.prepare(
    "INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)"
  ).run(`Damas ${m}`, (extra && extra.tipo) || 'Cuerpo', iglesia, (extra && extra.estado) || 'Activo').lastInsertRowid;
  fechas.forEach((f, i) => db.prepare(
    'INSERT INTO actas_reuniones (numero_acta, fecha, cuerpo_id, iglesia_id) VALUES (?, ?, ?, ?)'
  ).run(`${m}-${i}`, f, cuerpo, iglesia));
  return { m, iglesia, cuerpo };
}

/** Lo que el aviso dice de ESE cuerpo, mirando como el administrador general. */
const suLinea = (id) => sinActas.losQueNoLevantanActas(db, null, HOY).find((c) => c.id === id) || null;

/** Un día tantos días antes de hoy. */
const haceDias = (dias) => new Date(Date.parse(`${HOY}T12:00:00Z`) - dias * 86400000).toISOString().slice(0, 10);

// ------------------------------------------- esto NO es cumplimiento ----

test('el libro de actas no entra en el estado de cumplimiento del cuerpo', async () => {
  /*
   * Es la decisión que se tomó, y esta prueba existe para que no se deshaga por
   * descuido: agregar un séptimo requisito de actas cambiaría a «Pendiente» a
   * quince de los diecisiete cuerpos de la base de un día para otro.
   *
   * Se mira por donde se mira de verdad —la ficha del cuerpo, que es la que
   * publica su cumplimiento— y no llamando a una función por dentro: lo que
   * importa es que la persona no vea el reproche, no dónde se calcula.
   */
  const api = await elSistemaAndando();
  const e = unCuerpoCon([]);
  const ficha = (await api('GET', `/cuerpos/${e.cuerpo}`)).json;
  const items = (ficha.cumplimiento && ficha.cumplimiento.items) || [];

  assert.ok(items.length >= 5, `la ficha trae su cumplimiento (${items.length} requisitos)`);
  assert.ok(!items.some((i) => /acta/i.test(`${i.texto} ${i.detalle || ''}`)),
    'ningún requisito del cumplimiento habla de actas');
  assert.ok(suLinea(e.cuerpo), 'y sin embargo el aviso del panel sí lo nombra');
});

test('y el módulo del cumplimiento no sabe que este aviso existe', () => {
  const fs = require('fs');
  const path = require('path');
  const cuerpos = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  assert.ok(!/cuerpo-que-no-levanta-actas/.test(cuerpos),
    'si un día se le enchufa al cumplimiento, que sea a propósito y no de rebote');
});

// -------------------------------------------------- a quién se le avisa ----

test('un cuerpo sin ninguna acta sale, y se dice así', () => {
  const e = unCuerpoCon([]);
  const linea = suLinea(e.cuerpo);
  assert.ok(linea);
  assert.equal(linea.nivel, 'nunca');
  assert.match(linea.situacion, /No tiene ninguna acta anotada/i);
});

test('uno que anota al día no sale', () => {
  const e = unCuerpoCon([haceDias(10), haceDias(40), haceDias(70)]);
  assert.equal(suLinea(e.cuerpo), null, 'una al mes es justo lo que se espera');
});

test('uno que anotó hace un mes tampoco: el corte es generoso a propósito', () => {
  /*
   * Con doce al año se espera una cada treinta días, y se avisa a los sesenta.
   * Una reunión que se corrió o un mes de vacaciones no tienen por qué salir en
   * el panel: un aviso que salta por nada es un aviso que se deja de leer.
   */
  const e = unCuerpoCon([haceDias(35)]);
  assert.equal(suLinea(e.cuerpo), null);
});

test('uno que lleva cinco meses callado sí sale, y dice desde cuándo', () => {
  const e = unCuerpoCon([haceDias(150)]);
  const linea = suLinea(e.cuerpo);
  assert.ok(linea);
  assert.equal(linea.nivel, 'atrasado');
  assert.match(linea.situacion, /hace 5 meses/);
  assert.match(linea.situacion, /de 12 esperadas/, 'y contra qué se está midiendo');
});

test('la línea dice cuántas lleva en el año, no solo cuándo fue la última', () => {
  /*
   * El número solo no alcanza para decidir: no es lo mismo un cuerpo que nunca
   * anotó nada que uno que anotó once y paró, y quien mira el panel tiene que
   * poder distinguirlos sin abrir las fichas.
   */
  const e = unCuerpoCon([haceDias(300), haceDias(280), haceDias(260), haceDias(100)]);
  const linea = suLinea(e.cuerpo);
  assert.ok(linea);
  assert.equal(linea.enUnAnio, 4);
  assert.match(linea.situacion, /Lleva 4 en el último año/);
});

test('un grupo no lleva libro de actas, y no se le pide', () => {
  const e = unCuerpoCon([], { tipo: 'Grupo' });
  assert.equal(suLinea(e.cuerpo), null,
    'un grupo es una agrupación de servicio, sin obligaciones formales');
});

test('a un cuerpo cerrado no se le reprocha nada', () => {
  const e = unCuerpoCon([], { estado: 'Inactivo' });
  assert.equal(suLinea(e.cuerpo), null, 'dejó de funcionar, que es lo que ese estado significa');
});

// ------------------------------------------------ la cifra que la manda ----

test('el corte sale del ajuste, no de un número escrito en el código', () => {
  /*
   * Con doce al año se avisa a los sesenta días; subiendo la expectativa a
   * cincuenta y dos —una por semana— el mismo cuerpo pasa a estar atrasado con
   * mucho menos silencio.
   */
  const e = unCuerpoCon([haceDias(20)]);
  assert.equal(suLinea(e.cuerpo), null, 'con doce al año, veinte días no es nada');

  const antes = ajustes.obtener('actas_esperadas_al_anio');
  try {
    ajustes.guardar('actas_esperadas_al_anio', 52);
    const linea = suLinea(e.cuerpo);
    assert.ok(linea, 'esperando una por semana, veinte días de silencio sí es un aviso');
    assert.match(linea.situacion, /de 52 esperadas/);
  } finally {
    ajustes.guardar('actas_esperadas_al_anio', antes === null || antes === undefined ? 12 : antes);
  }
});

test('cada cuánto se espera una sale de esa misma cifra', () => {
  assert.equal(sinActas.cadaCuantosDias(12), 30);
  assert.equal(sinActas.cadaCuantosDias(52), 7);
  assert.equal(sinActas.cadaCuantosDias(4), 91);
});

test('el silencio se dice como lo diría alguien', () => {
  assert.equal(sinActas.haceCuanto(40), 'hace 40 días');
  assert.equal(sinActas.haceCuanto(150), 'hace 5 meses');
  assert.equal(sinActas.haceCuanto(800), 'hace 2 años');
});

// -------------------------------------------------------------- el orden ----

test('primero los que nunca anotaron, después el silencio más largo', () => {
  /*
   * Lo que lleva más tiempo parado es lo que más conviene preguntar.
   */
  const jamas = unCuerpoCon([]);
  const viejo = unCuerpoCon([haceDias(400)]);
  const menos = unCuerpoCon([haceDias(90)]);
  const lista = sinActas.losQueNoLevantanActas(db, null, HOY)
    .filter((c) => [jamas.cuerpo, viejo.cuerpo, menos.cuerpo].includes(c.id));
  assert.deepEqual(lista.map((c) => c.id), [jamas.cuerpo, viejo.cuerpo, menos.cuerpo]);
});
