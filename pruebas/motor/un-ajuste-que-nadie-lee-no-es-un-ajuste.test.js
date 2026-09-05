/**
 * Una perilla que gira y no mueve nada enseña a desconfiar de las demás.
 *
 * Se recorrieron las setenta claves de Configuración buscando quién las consume
 * en todo el servidor y toda la pantalla. Tres no las leía nadie: se guardaban,
 * la pantalla mostraba el valor nuevo, y no pasaba absolutamente nada. Las tres
 * tenían además su texto de ayuda explicando en detalle un comportamiento que no
 * ocurría (hallazgo CO-04).
 *
 *   · «Registros por página» prometía «cantidad de filas que muestran los
 *     listados (entre 10 y 200)». La pantalla nunca manda `limit`, así que el
 *     motor se quedaba con su 25 escrito a mano. Medido en la v1.423.0 con
 *     cuarenta miembros: puesto en 10, en 100 y en 200, el listado devolvió 25
 *     filas y 2 páginas las tres veces.
 *
 *   · «Símbolo de moneda» prometía usarse «al mostrar montos en tesorería,
 *     ayudas sociales e inventarios». El signo de peso estaba escrito a mano en
 *     siete lugares del servidor y en el formateador de la pantalla. Puesto en
 *     «UF», quedaba guardado y no movía una sola cifra.
 *
 *   · «Cuántas actas al año se esperan de un cuerpo» describía una tarjeta del
 *     panel que la corporación mandó sacar en la v1.393.0. El aviso se fue y el
 *     ajuste se quedó. Ése no se conectó: se sacó.
 *
 * Esta prueba vigila las dos mitades: que los dos que se conectaron sigan
 * conectados, y que no vuelva a aparecer un ajuste que no lea nadie.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const ajustes = require('../../server/ajustes');
const formato = require('../../server/formato');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

// ------------------------------------------- registros por página ----------

/** Una iglesia propia con la gente que se le pida: el listado se acota a ella. */
const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Por página ${marca}`, `PP-${marca}`).lastInsertRowid;

let cuantos = 0;
for (let i = 0; i < 12; i++) {
  const numero = `${14000000 + (marca * 13 + cuantos++) % 900000}`;
  db.prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run(`Persona${i}`, `PP ${marca}`, `${numero}-${digitoVerificador(numero)}`, iglesia);
}

/** Cuántas filas trae el listado de ESA iglesia, con el ajuste que se le ponga. */
async function cuantasTrae(api, cuantasPorPagina) {
  ajustes.guardar('registros_por_pagina', String(cuantasPorPagina));
  const r = await api('GET', `/miembros?f_iglesia_id=${iglesia}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  return r.json.rows.length;
}

test('el listado trae las filas que dice Configuración, no un número escrito en el código', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('registros_por_pagina');
  try {
    assert.equal(await cuantasTrae(api, 10), 10, 'con 10 trae 10');
    assert.equal(await cuantasTrae(api, 12), 12);
    assert.equal(await cuantasTrae(api, 200), 12, 'y con 200 trae las doce que hay');
  } finally {
    ajustes.guardar('registros_por_pagina', habia);
  }
});

test('pero lo que pida quien llama sigue mandando, con su tope', async () => {
  const api = await elSistemaAndando();
  const habia = ajustes.obtener('registros_por_pagina');
  try {
    ajustes.guardar('registros_por_pagina', '10');
    const r = await api('GET', `/miembros?f_iglesia_id=${iglesia}&limit=3`);
    assert.equal(r.json.rows.length, 3, 'quien pide tres, recibe tres');
  } finally {
    ajustes.guardar('registros_por_pagina', habia);
  }
});

// ------------------------------------------- símbolo de moneda -------------

test('la plata del servidor lleva el símbolo que puso la institución', () => {
  const habia = ajustes.obtener('moneda_simbolo');
  try {
    ajustes.guardar('moneda_simbolo', '$');
    assert.equal(formato.enPlata(150000), '$ 150.000');
    ajustes.guardar('moneda_simbolo', 'UF');
    assert.equal(formato.enPlata(150000), 'UF 150.000', 'cambiarlo mueve las cifras de verdad');
    // Al peso, sin centavos: en pesos no existen
    assert.equal(formato.enPlata(765432.1), 'UF 765.432');
    // Y donde la cifra va en una tabla angosta, con el espacio que no se corta
    assert.equal(formato.enPlata(150000, { pegado: true }), 'UF\u00a0150.000');
    ajustes.guardar('moneda_simbolo', '');
    assert.equal(formato.enPlata(1000), '$ 1.000', 'en blanco vuelve el peso, no un hueco');
  } finally {
    ajustes.guardar('moneda_simbolo', habia);
  }
});

test('y ya no queda ningún signo de peso escrito a mano en el servidor', () => {
  /*
   * Estaba en siete lugares. Uno solo que se quede fuera hace que la iglesia
   * que cambie el símbolo vea las dos cosas mezcladas, que es peor que no tener
   * el ajuste.
   */
  let salida = '';
  try {
    salida = execFileSync('grep', [
      '-rn', '--include=*.js', '-e', '`\\$ \\${', '-e', "'\\$ '", '-e', '\\$\\\\u00a0',
      path.join(__dirname, '../../server'),
    ]).toString();
  } catch (e) {
    salida = '';   // grep sin resultados: sale con 1
  }
  const sueltos = salida.split('\n').filter((l) => l && !l.includes('server/formato.js'));
  assert.deepEqual(sueltos, [], `quedan signos de peso escritos a mano:\n${sueltos.join('\n')}`);
});

test('la pantalla también lo pide, y el servidor se lo manda', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const trozo = app.slice(app.indexOf('function fmtMoney('), app.indexOf('function fmtMoney(') + 900);
  assert.match(trozo, /AJUSTES\.moneda_simbolo/, 'la pantalla no lo lleva escrito adentro');
  assert.ok(!/return '\$ ' \+/.test(trozo), 'y ya no lo lleva escrito adentro');

  const index = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(index, /moneda_simbolo: ajustes\.obtener\('moneda_simbolo'\)/,
    'la descripción del sistema tiene que llevarlo, o la pantalla nunca lo sabe');
});

// ------------------------------------------- el que se sacó ----------------

test('el ajuste de las actas al año ya no está, porque su aviso tampoco', () => {
  assert.equal(ajustes.POR_CLAVE.actas_esperadas_al_anio, undefined);
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/ajustes.js'), 'utf8');
  assert.match(fuente, /Acá vivía «Cuántas actas al año/,
    'y queda dicho por qué se fue, donde alguien lo iría a buscar');
});

// ------------------------------------------- la regla, para adelante -------

test('no queda ninguna otra opción que no lea nadie', () => {
  /*
   * La misma cuenta que destapó los tres: por cada clave declarada, se busca
   * quién la nombra fuera de los dos archivos del propio módulo. `versiones.js`
   * no cuenta: ahí solo se cuenta lo que pasó, no se usa nada.
   *
   * Si esta prueba se pone roja al agregar un ajuste, es que se declaró antes de
   * conectarlo. Conectarlo o no agregarlo: las dos cosas están bien, dejarlo a
   * medias no.
   */
  const raiz = path.join(__dirname, '../..');
  const huerfanas = [];
  for (const opcion of ajustes.OPCIONES.flatMap((g) => g.items)) {
    let salida = '';
    try {
      salida = execFileSync('grep', [
        '-rn', '--include=*.js', `'${opcion.clave}'`,
        path.join(raiz, 'server'), path.join(raiz, 'public'),
      ]).toString();
    } catch (e) {
      salida = '';
    }
    const quienLaUsa = salida.split('\n').filter((l) => l
      && !l.includes('server/ajustes.js')
      && !l.includes('server/configuracion.js')
      && !l.includes('server/versiones.js'));
    if (!quienLaUsa.length) huerfanas.push(opcion.clave);
  }
  assert.deepEqual(huerfanas, [],
    `estas opciones se pueden cambiar y no le pasa nada al sistema:\n  ${huerfanas.join('\n  ')}`);
});
