/**
 * LOS DOS TIPOS QUE SE OFRECÍAN Y NADIE ESCRIBÍA.
 *
 * El desplegable de la bitácora ofrece quince tipos de registro y el sistema
 * escribía solo nueve. Cuatro de los seis restantes están bien así —«Visita»,
 * «Disciplina», «Reconocimiento» y «Otro» son precisamente lo que el equipo
 * escribe a mano, y para eso están—. Los otros dos, no:
 *
 *   «Bautismo» ....  es un hecho que el sistema CONOCE —la ficha tiene su campo
 *                    de fecha de bautismo— y quedaba anotado como un cambio de
 *                    datos cualquiera, perdido entre los teléfonos y las
 *                    direcciones, y fechado el día del tecleo.
 *
 *   «Credencial» ..  prometía algo que el módulo no daba: las credenciales se
 *                    emiten a los PASTORES. Medido: 0 anotaciones de ese tipo.
 *
 * Lo que cuida este archivo:
 *   · que anotar el bautismo por primera vez escriba su propia anotación, con
 *     su tipo y EN SU FECHA
 *   · que no quede dicho dos veces, en su anotación y en la de cambios
 *   · que corregir una fecha mal escrita NO sea un segundo bautismo: eso es un
 *     cambio de datos, y ahí se queda
 *   · que emitirle o revocarle la credencial a un pastor con ficha de miembro
 *     enlazada quede en la bitácora de esa ficha
 *   · que sin ficha enlazada no se anote nada, y que los otros dos actos de la
 *     credencial —el reemplazo y la impresión— sigan solo donde estaban
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const registry = require('../../server/registry');
const fechas = require('../../server/fechas');

const HOY = fechas.hoy();
const MIEMBROS = registry.getModule('miembros');
const BITACORA = registry.getModule('bitacora');
const USUARIO = { id: 1, nombre: 'Quien Guarda' };

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los tipos', 'IG-TNE', 'Activa')")
  .run().lastInsertRowid;
const unMiembro = (nombres) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, 'De los Tipos', ?, 'Activo')")
  .run(nombres, iglesia).lastInsertRowid;

/** Guardar un cambio de la ficha, y devolver lo que quedó anotado. */
function alGuardar(miembro, datos, antes) {
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.registrarGuardado(MIEMBROS, {
    isNew: false, antes, despues: { id: miembro, iglesia_id: iglesia, ...antes, ...datos },
    datos, user: USUARIO,
  });
  // Acotado a la iglesia de este archivo, que corre en paralelo con las demás
  return db.prepare('SELECT * FROM bitacora WHERE id > ? AND iglesia_id = ? ORDER BY id').all(desde, iglesia);
}

/* ------------------------------- el bautismo es un hecho de su vida */

test('anotarle el bautismo escribe su propia anotación, con su tipo', () => {
  const marta = unMiembro('Marta');
  const [fila] = alGuardar(marta, { fecha_bautismo: '2005-11-06' }, { fecha_bautismo: null });
  assert.equal(fila.tipo, 'Bautismo', 'antes quedaba como «Cambio de datos»');
  assert.equal(fila.descripcion, 'Queda anotado su bautismo.');
});

test('y en la fecha del bautismo, no en la de hoy', () => {
  const rosa = unMiembro('Rosa');
  const [fila] = alGuardar(rosa, { fecha_bautismo: '2005-11-06' }, { fecha_bautismo: null });
  assert.equal(fila.fecha, '2005-11-06',
    'así se lee en su historial donde le pasó, y no arriba del todo');
  assert.notEqual(fila.fecha, HOY);
});

test('el mismo hecho no queda dicho dos veces', () => {
  const elba = unMiembro('Elba');
  const filas = alGuardar(elba,
    { fecha_bautismo: '2005-11-06', telefono: '+56 9 4000 1000' },
    { fecha_bautismo: null, telefono: null });
  assert.equal(filas.length, 2, 'el bautismo por su lado y el resto de los cambios por el suyo');
  const bautismo = filas.find((f) => f.tipo === 'Bautismo');
  const cambios = filas.find((f) => f.tipo === 'Cambio de datos');
  assert.ok(bautismo && cambios);
  assert.match(cambios.descripcion, /Teléfono/);
  assert.doesNotMatch(cambios.descripcion, /Fecha de bautismo/,
    'la línea de cambios ya no repite lo que la anotación de bautismo dice mejor');
});

test('si lo único que cambió fue el bautismo, no queda una línea de cambios vacía', () => {
  const nora = unMiembro('Nora');
  const filas = alGuardar(nora, { fecha_bautismo: '2005-11-06' }, { fecha_bautismo: null });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].tipo, 'Bautismo');
});

test('corregir una fecha mal escrita no es un segundo bautismo', () => {
  const delia = unMiembro('Delia');
  alGuardar(delia, { fecha_bautismo: '2005-11-06' }, { fecha_bautismo: null });
  const [correccion] = alGuardar(delia, { fecha_bautismo: '2005-11-16' }, { fecha_bautismo: '2005-11-06' });
  assert.equal(correccion.tipo, 'Cambio de datos',
    'corregir un año mal tecleado es un cambio de datos, y ahí se queda');
  assert.match(correccion.descripcion, /Fecha de bautismo: 06-11-2005 → 16-11-2005/);

  const cuantos = db
    .prepare("SELECT COUNT(*) c FROM bitacora WHERE miembro_id = ? AND tipo = 'Bautismo'").get(delia).c;
  assert.equal(cuantos, 1, 'uno se bautiza una vez');
});

test('borrarle la fecha tampoco es un bautismo', () => {
  const berta = unMiembro('Berta');
  const [fila] = alGuardar(berta, { fecha_bautismo: null }, { fecha_bautismo: '2005-11-06' });
  assert.equal(fila.tipo, 'Cambio de datos');
});

test('una fecha que no es una fecha no escribe un bautismo', () => {
  const sofia = unMiembro('Sofía');
  const filas = alGuardar(sofia, { fecha_bautismo: '2026-02-30' }, { fecha_bautismo: null });
  assert.equal(filas.filter((f) => f.tipo === 'Bautismo').length, 0);
  assert.equal(filas[0].tipo, 'Cambio de datos');
});

/* ------------------------------- la credencial, escrita de verdad */

const pastorCon = (miembroId) => db
  .prepare("INSERT INTO pastores (nombres, apellidos, iglesia_id, miembro_id, estado) VALUES ('Carlos','Del Tipo',?,?,'Activo')")
  .run(iglesia, miembroId).lastInsertRowid;

test('emitirle la credencial a un pastor con ficha de miembro se le anota', () => {
  const miembro = unMiembro('Carlos');
  const pastor = pastorCon(miembro);
  const desde = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM bitacora').get().n;
  bitacora.anotarCredencial({
    pastorId: pastor, usuario: USUARIO, fecha: '2026-08-20',
    texto: 'Se le emitió la credencial N.º 0022026-9.',
  });
  const [fila] = db.prepare('SELECT * FROM bitacora WHERE id > ? ORDER BY id').all(desde);
  assert.ok(fila, 'no quedó anotado nada');
  assert.equal(fila.tipo, 'Credencial', 'el tipo que se ofrecía y nadie escribía');
  assert.equal(fila.miembro_id, miembro);
  assert.equal(fila.fecha, '2026-08-20', 'en la fecha en que se le entregó');
  assert.equal(fila.iglesia_id, iglesia, 'y con la iglesia del pastor');
});

test('sin ficha de miembro enlazada no se le anota nada', () => {
  const suelto = db
    .prepare("INSERT INTO pastores (nombres, apellidos, iglesia_id, estado) VALUES ('Sin','Ficha',?,'Activo')")
    .run(iglesia).lastInsertRowid;
  // Se cuentan las de ESTA iglesia y no las de la tabla entera: en paralelo,
  // la tabla entera crece por lo que anotan las demás pruebas
  const cuantas = () => db.prepare('SELECT COUNT(*) c FROM bitacora WHERE iglesia_id = ?').get(iglesia).c;
  const antes = cuantas();
  bitacora.anotarCredencial({ pastorId: suelto, usuario: USUARIO, texto: 'Se le emitió una credencial.' });
  bitacora.anotarCredencial({ pastorId: null, usuario: USUARIO, texto: 'Sin pastor siquiera.' });
  bitacora.anotarCredencial({ pastorId: 999999, usuario: USUARIO, texto: 'Un pastor que no existe.' });
  assert.equal(cuantas(), antes,
    'es lo mismo que hace el resto del sistema con quien no está en la membresía');
});

test('y no revienta cuando el pastor no existe', () => {
  // Es lo único que la guardia de `anotarCredencial` decide por su cuenta: sin
  // fila no hay `miembro_id` que leer. Lo demás lo ataja `anotar`.
  assert.doesNotThrow(() => bitacora.anotarCredencial({
    pastorId: 999999, usuario: USUARIO, texto: 'Un pastor que no existe.',
  }));
});

test('se anotan la emisión y la revocación, no los cuatro actos', () => {
  /*
   * Reemplazarla ya lo cuenta la emisión de la nueva, y haberla mandado a la
   * impresora es un acto de oficina que no dice nada de la persona: los dos
   * siguen quedando donde corresponde, en el Registro de Cambios.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/modules/credenciales.js'), 'utf8');
  const cuantas = (src.match(/anotarCredencial\(/g) || []).length;
  assert.equal(cuantas, 2, `se llama ${cuantas} veces, y tienen que ser dos`);

  /*
   * Cada acto se mira desde su propia marca hasta la SIGUIENTE que aparezca en
   * el archivo, sea cual sea. Antes se recortaba nombrando la que venía
   * después —de «Emisión» a «Reemplazo», de «Impresión» al final— y eso
   * amarraba la prueba al ORDEN en que están escritas: mover una función de
   * sitio la hacía caer sin que nada hubiera cambiado de comportamiento, que
   * es justo lo que pasó al sacar la revocación de su ruta a una función
   * propia.
   */
  const marcas = [...src.matchAll(/accion: '([^']+)'/g)];
  const loQueAnota = (acto) => {
    const i = marcas.findIndex((m) => m[1] === acto);
    assert.notEqual(i, -1, `tendría que existir el acto «${acto}»`);
    const desde = marcas[i].index;
    const hasta = i + 1 < marcas.length ? marcas[i + 1].index : src.length;
    return src.slice(desde, hasta);
  };

  assert.match(loQueAnota('Emisión'), /anotarCredencial\(/, 'la emisión sí');
  assert.match(loQueAnota('Revocación'), /anotarCredencial\(/, 'y la revocación también');
  assert.doesNotMatch(loQueAnota('Reemplazo'), /anotarCredencial\(/, 'el reemplazo no');
  assert.doesNotMatch(loQueAnota('Impresión'), /anotarCredencial\(/, 'la impresión tampoco');
});

/* ------------------------------- el vocabulario, al día */

test('los quince tipos siguen ofreciéndose, y ahora once los escribe el sistema', () => {
  const tipos = BITACORA.fields.find((f) => f.name === 'tipo').options;
  assert.equal(tipos.length, 15);
  for (const t of ['Bautismo', 'Credencial']) {
    assert.ok(tipos.includes(t), `falta «${t}» en el desplegable`);
  }

  // Los que el sistema escribe solo, buscados en el código que los escribe
  const src = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const escritos = new Set((src.match(/tipo: '([^']+)'/g) || []).map((t) => t.slice(7, -1)));
  escritos.add('Solicitud'); escritos.add('Ayuda social'); escritos.add('Certificado'); escritos.add('Documento');
  for (const t of ['Bautismo', 'Credencial']) {
    assert.ok(escritos.has(t), `«${t}» sigue sin escribirse desde ninguna parte`);
  }
  // Y los cuatro que son de la mano siguen siendo de la mano, a propósito
  for (const t of ['Visita', 'Disciplina', 'Reconocimiento', 'Otro']) {
    assert.ok(!escritos.has(t), `«${t}» es de los que escribe el equipo, no el sistema`);
  }
});
