/**
 * En «Pastor principal» de una iglesia, el matrimonio pastoral sale UNA vez.
 *
 * El pastor y la pastora de una congregación se registran los dos en Pastores
 * / Guías —así corresponde tenerlos— y se casan entre sí. El desplegable armaba
 * una opción por ficha, y las dos nombran a la misma pareja en distinto orden.
 * MEDIDO en la Iglesia Matriz, contra un servidor levantado limpio:
 *
 *   Pastora Marcela Contreras Saldias y Pastor Samuel Rodriguez Mora
 *   Pastor Samuel Rodriguez Mora y Pastora Marcela Contreras Saldias
 *
 * Quien abre esa lista elige entre dos renglones que dicen lo mismo, y lo que
 * los diferencia —cuál de las dos fichas queda anotada— no está a la vista.
 *
 * ── LO QUE HAY QUE CUIDAR AL JUNTARLOS ──
 *
 * 1. QUE NO SE JUNTEN EN LAS OTRAS LISTAS. Una credencial, una carpeta, una
 *    línea de historial y la firma de un certificado son de UNA persona. Si
 *    esto se hubiera hecho en la ruta que comparten todos los campos que
 *    apuntan a un pastor, la pastora se habría quedado sin poder recibir su
 *    credencial. Es la comprobación más importante de este archivo.
 * 2. QUE NO MUEVA LO QUE YA ESTABA ESCRITO. Si la iglesia tiene anotada a la
 *    pastora, abrir la ficha y guardarla sin tocar nada tiene que dejarla
 *    igual. Por eso quien la iglesia ya tiene manda sobre el cargo.
 * 3. QUE NO SE LLEVE POR DELANTE A NADIE MÁS: quien no tiene cónyuge, y dos
 *    pastores que no están casados entre sí, siguen saliendo los dos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const pastoresMod = require('../../server/modules/pastores');
const iglesiasMod = require('../../server/modules/iglesias');

/* ------------------------------------------------------------ el mundo */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Matriz de la pareja', 'IG-PJ', 'Activa')")
  .run().lastInsertRowid;

const unMiembro = (nombres, apellidos, genero) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, genero, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
  .run(nombres, apellidos, genero, iglesia).lastInsertRowid;

const unPastor = (nombres, apellidos, genero, cargo, miembroId) => db
  .prepare(
    `INSERT INTO pastores (nombres, apellidos, genero, cargo, iglesia_id, estado, miembro_id)
     VALUES (?, ?, ?, ?, ?, 'Activo', ?)`
  )
  .run(nombres, apellidos, genero, cargo, iglesia, miembroId).lastInsertRowid;

const mSamuel = unMiembro('Samuel', 'Rodriguez de la Pareja', 'Masculino');
const mMarcela = unMiembro('Marcela', 'Contreras de la Pareja', 'Femenino');
const mElias = unMiembro('Elias', 'Vera de la Pareja', 'Masculino');

const samuel = unPastor('Samuel', 'Rodriguez de la Pareja', 'Masculino', 'Pastor Presidente', mSamuel);
const marcela = unPastor('Marcela', 'Contreras de la Pareja', 'Femenino', 'Pastora', mMarcela);
const elias = unPastor('Elias', 'Vera de la Pareja', 'Masculino', 'Pastor Presbítero', mElias);

// El vínculo, en las dos fichas, que es como lo escribe el sistema.
db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(mMarcela, samuel);
db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(mSamuel, marcela);

/** Ve todo: lo que se está midiendo no es el alcance. */
const quienMira = { id: 70, rol: 'admin' };

/** Corre una ruta del módulo sin levantar el servidor. */
function ruta(cual) {
  let handler = null;
  // El módulo declara además rutas de escritura; el router de mentira las
  // recibe y las deja pasar, que acá no se están midiendo.
  const nada = () => {};
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; }, post: nada, put: nada, delete: nada, patch: nada };
  pastoresMod.extraRoutes(router, { db, requirePerm: () => (req, res, next) => next() });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (query) => {
    let cuerpo = null;
    handler({ user: quienMira, query: query || {} }, { json: (d) => { cuerpo = d; } });
    return cuerpo;
  };
}

const laPareja = ruta('/pastores/pareja-a-cargo');
const cadaUno = ruta('/pastores/con-conyuge');

/** Solo los de este archivo: los demás corren en paralelo sobre la misma base. */
const mios = (opciones) => opciones.filter((o) => [samuel, marcela, elias].includes(Number(o.id)));

// --------------------------------------- la pareja, una sola vez -----------

test('el matrimonio pastoral sale una vez, con los dos nombres', () => {
  const ofrece = mios(laPareja({}));
  const deLaPareja = ofrece.filter((o) => [samuel, marcela].includes(Number(o.id)));

  assert.equal(deLaPareja.length, 1, `salieron ${deLaPareja.length}: ${JSON.stringify(deLaPareja)}`);
  assert.match(deLaPareja[0].label, /Samuel/, 'la opción nombra a los dos');
  assert.match(deLaPareja[0].label, /Marcela/);
});

test('la representa el cargo más alto de la escala del ministerio', () => {
  const [uno] = mios(laPareja({})).filter((o) => [samuel, marcela].includes(Number(o.id)));
  assert.equal(Number(uno.id), samuel,
    'Pastor Presidente está más arriba que Pastora en la escala de server/tratamiento.js');
});

test('pero lo que la iglesia ya tiene anotado manda sobre el cargo', () => {
  /*
   * Ésta es la que impide que juntar los renglones mueva una relación ya
   * escrita. Sin ella, una iglesia con la pastora anotada se abriría ofreciendo
   * al pastor, y guardar sin tocar nada le cambiaría el dato.
   */
  const [uno] = mios(laPareja({ ademas: String(marcela) }))
    .filter((o) => [samuel, marcela].includes(Number(o.id)));
  assert.equal(Number(uno.id), marcela, 'la que ya estaba no se cambia por la del cargo más alto');
  assert.match(uno.label, /Samuel/, 'y sigue nombrando a los dos');
});

test('quien no tiene cónyuge no se ve afectado', () => {
  assert.ok(mios(laPareja({})).some((o) => Number(o.id) === elias),
    'un pastor sin cónyuge tiene que seguir ofreciéndose');
});

// ------------- lo que NO se junta: las listas de una sola persona ----------

test('la lista que comparten credencial, carpeta e historial sigue ofreciendo a los dos', () => {
  /*
   * La comprobación más importante del archivo. Una credencial es de UNA
   * persona: si esto se hubiera hecho en la ruta compartida, la pastora se
   * quedaría sin poder recibir la suya, sin que nada lo dijera.
   */
  const ofrece = mios(cadaUno({})).map((o) => Number(o.id));
  assert.ok(ofrece.includes(samuel), 'el pastor');
  assert.ok(ofrece.includes(marcela), 'y la pastora, cada uno por su cuenta');
  assert.ok(ofrece.includes(elias));
});

test('cada campo pide la lista que le corresponde', () => {
  const pastorPrincipal = iglesiasMod.fields.find((f) => f.name === 'pastor_id');
  assert.match(pastorPrincipal.optionsRoute, /^\/pastores\/pareja-a-cargo\?/,
    'la ficha de la iglesia elige una pareja, no una persona');

  assert.match(pastoresMod.opcionesPorDefecto, /^\/pastores\/con-conyuge\?/,
    'los demás campos que apuntan a un pastor eligen una persona');

  // Las dos arrastran el «además», que es lo que evita que abrir una ficha y
  // guardarla le borre un pastor que ya no ejerce (v1.232.0).
  assert.match(pastorPrincipal.optionsRoute, /ademas=\{pastor_id\}/);
  assert.match(pastoresMod.opcionesPorDefecto, /ademas=\{pastor_id\}/);
});

// ------------------------------- y la regla, por su cuenta -----------------

test('dos pastores que no están casados entre sí salen los dos', () => {
  const { unaSolaVezPorPareja } = require('../../server/el-conyuge-del-pastor');
  const filas = db
    .prepare('SELECT * FROM pastores WHERE id IN (?, ?)')
    .all(samuel, elias);
  assert.equal(unaSolaVezPorPareja(db, filas, 0).length, 2,
    'el cónyuge de Samuel no está en esta lista: no hay pareja que juntar');
});

test('media mitad del vínculo también junta el renglón', () => {
  /*
   * El sistema escribe el vínculo en las dos fichas, pero una base traída de
   * antes puede tener solo una mitad puesta, y con media mitad el renglón
   * repetido aparece igual. Se mira un lado a propósito.
   */
  const { unaSolaVezPorPareja } = require('../../server/el-conyuge-del-pastor');
  const filas = db.prepare('SELECT * FROM pastores WHERE id IN (?, ?)').all(samuel, marcela);
  const soloUnLado = filas.map((p) => (Number(p.id) === marcela ? { ...p, conyuge_id: null } : p));
  assert.equal(unaSolaVezPorPareja(db, soloUnLado, 0).length, 1);
});
