/**
 * LO QUE NO VA EN LA HOJA, Y LO QUE SÍ TIENE QUE ENCONTRARSE.
 *
 * Dos cosas chicas del mismo módulo, medidas antes de esto.
 *
 * ── LA HOJA IMPRESA LLEVABA DE MÁS ──
 *
 * La hoja de una ayuda imprime todos sus campos, uno debajo del otro. Entre
 * ellos salían:
 *
 *   Notas ................  «Se le ofreció visita del pastor. Está en
 *                            tratamiento oncológico.»
 *   Soporte / Evidencia ..  1788065198180-b616c941-boleta.txt
 *
 * Las notas son el cuaderno interno de quien atiende; en una hoja que se firma
 * y se entrega —a la directiva, a una fundación, a la propia persona— son otra
 * cosa. Y el nombre del archivo en el servidor es ruido técnico en un
 * documento formal: la revisión de Documentos ya lo dejó fuera de la hoja del
 * miembro por esa misma razón.
 *
 * ── Y EL BUSCADOR LLEVABA DE MENOS ──
 *
 *   buscar «Berta» ......  5 resultados
 *   buscar «Alimentos» ..  3
 *   buscar «45000» ......  0
 *   buscar «45.000» .....  0
 *
 * «¿Cuál era la ayuda de cuarenta y cinco mil?» es una pregunta de mostrador,
 * y había que bajar la planilla y buscarla en Excel. Es el mismo hallazgo que
 * tuvo Tesorería.
 *
 * Lo que cuida este archivo:
 *   · que las notas y el soporte no salgan en el papel, y sí en pantalla
 *   · que lo demás siga saliendo
 *   · que una ayuda se encuentre por su monto, con y sin separadores
 *   · y —lo que conviene no romper al arreglar lo anterior— que las notas
 *     sigan SIN entrar en el buscador
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const busqueda = require('../../server/busqueda');
const sensibles = require('../../server/sensibles');

const AYUDAS = getModule('ayudas_sociales');
const ADMIN = { id: 9701, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del papel','IG-PAP10','Activa')")
  .run().lastInsertRowid;
const BERTA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Berta','Del Papel')")
  .run().lastInsertRowid;

let n = 0;
function anotada(mas = {}) {
  n++;
  const data = {
    fecha: '2026-04-0' + ((n % 9) + 1), iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro',
    no_miembro_id: BERTA, beneficiario: 'Berta Del Papel', tipo_ayuda: 'Alimentos',
    valor_estimado: 45000, estado: 'Entregada',
    descripcion: 'Caja de mercadería', notas: 'Está en tratamiento oncológico.', ...mas,
  };
  const campos = Object.keys(data);
  return db
    .prepare(
      `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
}

/** Cuántas ayudas de esta iglesia encuentra quien teclea eso. */
function cuantasEncuentra(texto) {
  const params = [];
  const cond = busqueda.condicion(
    texto,
    sensibles.buscablesPara(AYUDAS, ADMIN),
    sensibles.buscaTambienPara(AYUDAS, ADMIN)
  );
  const sql = `SELECT COUNT(*) AS n FROM ayudas_sociales WHERE iglesia_id = ?`
    + (cond ? ` AND (${cond.sql})` : '');
  params.push(IGLESIA, ...(cond ? cond.params : []));
  return db.prepare(sql).get(...params).n;
}

/* ------------------------------- la hoja impresa */

test('las notas y el soporte se quedan fuera del papel', () => {
  const fuera = AYUDAS.fields.filter((f) => f.enElPapel === false).map((f) => f.name);
  assert.deepEqual(fuera.sort(), ['notas', 'soporte']);
});

test('pero siguen en el módulo: lo que cambia es qué se lleva el papel', () => {
  /*
   * `enElPapel: false` no esconde el campo en pantalla ni deja de guardarlo:
   * quien abre la ayuda ve sus notas y su archivo como siempre. Es distinto de
   * `oculto` y de `reservado`, que sí quitan el dato.
   */
  for (const cual of ['notas', 'soporte']) {
    const campo = AYUDAS.fields.find((f) => f.name === cual);
    assert.ok(campo, cual);
    assert.notEqual(campo.oculto, true, `${cual} se sigue viendo en la ficha`);
    assert.equal(campo.reservado, undefined, `${cual} no se le esconde a nadie`);
  }
});

test('y lo que sí corresponde imprimir sigue saliendo', () => {
  const enElPapel = AYUDAS.fields.filter((f) => f.enElPapel !== false).map((f) => f.name);
  for (const cual of ['fecha', 'beneficiario', 'tipo_ayuda', 'descripcion', 'valor_estimado', 'estado', 'aprobada_por']) {
    assert.ok(enElPapel.includes(cual), `${cual} tiene que ir en la hoja`);
  }
});

test('«enElPapel: false» viaja al navegador, que es quien arma la hoja', () => {
  /*
   * Declararlo en el módulo no basta: la hoja la arma la pantalla, y la
   * pantalla solo sabe lo que /api/meta le manda. Esta prueba mira la CADENA
   * COMPLETA porque la primera versión miraba solo el primer eslabón y daba
   * verde con las notas privadas saliendo impresas.
   *
   * Lo que pasaba: /api/meta arma cada campo con una lista cerrada de
   * propiedades, y `enElPapel` estaba solo en la de los campos CALCULADOS, que
   * es donde se estrenó. Un campo corriente que lo declaraba se imprimía
   * igual. Se vio mandando a imprimir una ayuda de verdad y encontrando en la
   * hoja «Está en tratamiento oncológico».
   */
  const fs = require('fs');
  const path = require('path');
  const lee = (r) => fs.readFileSync(path.join(__dirname, '../..', r), 'utf8');

  // 1. el módulo lo declara — 2. /api/meta lo deja pasar, para los campos
  // corrientes y no solo para los calculados — 3. la hoja lo respeta
  assert.equal(AYUDAS.fields.find((f) => f.name === 'notas').enElPapel, false);
  assert.match(lee('server/index.js'), /futuro, placeholder, enElPapel \}\) => \(\{/,
    'la lista de propiedades de un campo corriente tiene que incluirlo');
  assert.match(lee('server/index.js'), /enElPapel: enElPapel === undefined \? null : !!enElPapel,[\s\S]{0,400}buscador:/,
    'y mandarlo, no solo recibirlo');
  assert.match(lee('public/app.js'), /\.filter\(\(f\) => f\.type !== 'password' && f\.enElPapel !== false\)/);

  // Y el falso no se pierde por el camino: la lista que aligera /api/meta
  // borra los «no» que no dicen nada, y este dice algo
  const { EL_NO_DICE_ALGO, sinLoQueNoDiceNada } = require('../../server/meta-liviana');
  assert.ok(EL_NO_DICE_ALGO.has('enElPapel'));
  assert.equal(sinLoQueNoDiceNada({ name: 'notas', enElPapel: false }).enElPapel, false);
});

/* ------------------------------- el buscador */

test('una ayuda se encuentra por su monto, con y sin separadores', () => {
  anotada({ valor_estimado: 45000 });
  anotada({ valor_estimado: 45000 });
  anotada({ valor_estimado: 78000, tipo_ayuda: 'Ropa' });

  assert.equal(cuantasEncuentra('45000'), 2);
  assert.equal(cuantasEncuentra('45.000'), 2, 'como se escriben los montos acá');
  assert.equal(cuantasEncuentra('78000'), 1);
  assert.equal(cuantasEncuentra('99999'), 0, 'lo que no está, no aparece');
});

test('y no se encuentra DE MÁS: cuatrocientos cincuenta mil no es cuarenta y cinco mil', () => {
  /*
   * Esta es la que faltaba, y sin ella el arreglo era medio arreglo.
   *
   * El monto se guarda en una columna REAL, así que pegado como texto sale
   * «45000.0», y el buscador compara además sin separadores: sin el punto
   * queda «450000». Buscando cuatrocientos cincuenta mil aparecía una ayuda de
   * cuarenta y cinco mil. El CAST a entero es lo que lo evita, y no —como
   * decía el comentario antes— el decimal que nadie teclea: «45000» calza
   * igual dentro de «45000.0».
   *
   * Se vio al romper el CAST a propósito y ver que no se caía nada: la prueba
   * de arriba solo mira que lo que está se encuentre.
   */
  assert.equal(cuantasEncuentra('450000'), 0, 'el punto del decimal no puede correr las cifras');

  /*
   * Lo que sí es normal y no se toca: «4500» encuentra la de $45.000, porque
   * el buscador de todo el sistema busca por trozos —«Ber» encuentra a Berta—.
   * Lo pedí como cero en la primera versión de esta prueba y estaba mal: eso
   * no es encontrar de más, es cómo busca este sistema.
   */
  assert.equal(cuantasEncuentra('4500'), 2, 'un trozo del monto sí, como un trozo de un nombre');
});

test('y lo que ya se encontraba, se sigue encontrando', () => {
  assert.equal(cuantasEncuentra('Berta'), 3);
  assert.equal(cuantasEncuentra('mercadería'), 3);
  assert.equal(cuantasEncuentra('Alimentos'), 2);
});

test('las notas siguen SIN entrar en el buscador', () => {
  /*
   * Esto es lo que había que no romper. Las notas son el cuaderno interno de
   * quien atiende, no un índice: buscar «oncológico» daba cero antes de tocar
   * nada y tiene que seguir dando cero. Al agregar el monto se agregó el monto
   * y nada más.
   */
  assert.equal(cuantasEncuentra('oncológico'), 0);
  assert.ok(!AYUDAS.searchFields.includes('notas'));
  assert.equal(AYUDAS.buscaTambien.length, 1, 'un solo trozo, y es el del monto');
  assert.match(AYUDAS.buscaTambien[0].sql, /valor_estimado/);
});
