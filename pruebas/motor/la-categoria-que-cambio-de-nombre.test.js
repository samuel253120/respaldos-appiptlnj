/**
 * La categoría «CENTRAL» pasa a llamarse «MATRIZ», y lo que NO se renombra.
 *
 * La categoría reservada al Pastor Presidente es la IGLESIA MATRIZ. El
 * registro de Iglesias siempre la llamó así; era la credencial la que la
 * rebautizaba «CENTRAL» al imprimir. Al corregir esa correspondencia, las
 * credenciales ya guardadas conservan la palabra vieja en su copia congelada y
 * hay que ponerlas al día.
 *
 * LA MITAD QUE IMPORTA DE ESTAS PRUEBAS ES LA SEGUNDA: una iglesia que se
 * LLAME «Iglesia Central», o que use «CENTRAL» como código corto, no se toca.
 * Es un nombre propio que alguien escribió, no una categoría. Medido sobre la
 * base de prueba antes de escribir la migración, los 69 valores que contenían
 * la palabra «central» eran TODOS de esa clase y ninguno era la categoría: una
 * migración escrita a la ligera —un LIKE '%central%'— habría renombrado la
 * congregación, sus cuentas de tesorería y su historial.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { laCategoriaCentralAhoraEsMatriz } = require('../../server/migraciones');
const datos = require('../../server/credenciales/datos');

/** Una credencial cualquiera, con la categoría que se le diga. */
let siguiente = 900000;
function unaCredencial(categoria, { estado = 'Vigente', conSerie = true } = {}) {
  const serie = conSerie ? String(siguiente++) : null;
  const r = db
    .prepare(
      `INSERT INTO credenciales
         (serie, serie_dv, estado, snap_nombres, snap_apellidos, snap_rut, snap_grado,
          snap_categoria, snap_iglesia, fecha_emision, fecha_vencimiento)
       VALUES (?, '1', ?, 'Juan', 'Soto', '12345678-5', 'Pastor Presbítero', ?, 'La Nueva Jerusalén',
               '2026-03-01', '2028-03-01')`
    )
    .run(serie, estado, categoria);
  return r.lastInsertRowid;
}

/** La migración se marca como aplicada: para poder repetirla se desmarca. */
function dejarlaCorrerDeNuevo() {
  db.prepare('DELETE FROM migraciones WHERE nombre = ?')
    .run('la categoría central de las credenciales ahora es matriz');
}

test('la correspondencia dice MATRIZ, no CENTRAL', () => {
  assert.equal(datos.categoriaDe('Iglesia Matriz'), 'MATRIZ');
  assert.equal(datos.CATEGORIA_ANTERIOR, 'CENTRAL');
  const todas = Object.values(datos.CATEGORIAS).sort();
  assert.deepEqual(todas, ['ANEXO', 'FILIAL', 'MATRIZ', 'SEDE'],
    'la lista cerrada es MATRIZ, SEDE, FILIAL y ANEXO (punto 5.2)');
  assert.ok(!todas.includes('CENTRAL'), 'CENTRAL ya no es una categoría');
});

test('las credenciales guardadas con CENTRAL quedan en MATRIZ', () => {
  const vieja = unaCredencial('CENTRAL');
  const otra = unaCredencial('SEDE');
  dejarlaCorrerDeNuevo();

  const resultado = laCategoriaCentralAhoraEsMatriz(db);
  assert.ok(resultado.migradas >= 1, `se esperaba al menos una migrada, hubo ${resultado.migradas}`);

  const comoQuedo = (id) => db.prepare('SELECT snap_categoria FROM credenciales WHERE id = ?').get(id).snap_categoria;
  assert.equal(comoQuedo(vieja), 'MATRIZ');
  assert.equal(comoQuedo(otra), 'SEDE', 'las otras categorías no se tocan');
});

test('y avisa, una por una, de las que ya estaban emitidas (punto 5.6)', () => {
  const emitida = unaCredencial('CENTRAL', { estado: 'Vigente' });
  const borrador = unaCredencial('CENTRAL', { estado: 'Borrador', conSerie: false });
  dejarlaCorrerDeNuevo();

  const resultado = laCategoriaCentralAhoraEsMatriz(db);
  const nombradas = resultado.emitidas.map((c) => c.id);
  assert.ok(nombradas.includes(emitida), 'la emitida tiene que quedar nombrada');
  assert.ok(!nombradas.includes(borrador), 'un borrador no salió en papel: no hay nada que reemplazar');

  // Y queda constancia en el Registro de Cambios, con su número de serie
  const linea = db
    .prepare("SELECT * FROM registro_cambios WHERE modulo = 'Credenciales' AND accion = 'Migración' AND registro_id = ?")
    .get(emitida);
  assert.ok(linea, 'la migración tiene que dejar constancia');
  assert.match(linea.detalle, /CENTRAL».*«MATRIZ/);
  assert.match(linea.detalle, /YA ESTABA EMITIDA/);
  const laDelBorrador = db
    .prepare("SELECT * FROM registro_cambios WHERE modulo = 'Credenciales' AND accion = 'Migración' AND registro_id = ?")
    .get(borrador);
  assert.match(laDelBorrador.detalle, /no hay ninguna tarjeta impresa afectada/);
});

test('una iglesia que SE LLAMA «Iglesia Central» no se toca (punto 17.7)', () => {
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, tipo, estado) VALUES ('Iglesia Central', 'CENTRALX', 'Iglesia Local', 'Activa')")
    .run().lastInsertRowid;
  // Y una credencial cuya IGLESIA se llama así, pero cuya categoría es otra
  const suya = db
    .prepare(
      `INSERT INTO credenciales
         (serie, serie_dv, estado, snap_nombres, snap_apellidos, snap_rut, snap_grado,
          snap_categoria, snap_iglesia, fecha_emision, fecha_vencimiento)
       VALUES (?, '1', 'Vigente', 'Ana', 'Díaz', '11111111-1', 'Pastor Probando',
               'FILIAL', 'Iglesia Central', '2026-03-01', '2028-03-01')`
    )
    .run(String(siguiente++)).lastInsertRowid;
  dejarlaCorrerDeNuevo();

  laCategoriaCentralAhoraEsMatriz(db);

  const i = db.prepare('SELECT nombre, codigo, tipo FROM iglesias WHERE id = ?').get(iglesia);
  assert.equal(i.nombre, 'Iglesia Central', 'el nombre propio de la congregación no se renombra');
  assert.equal(i.codigo, 'CENTRALX', 'ni su código corto');
  assert.equal(i.tipo, 'Iglesia Local', 'ni su tipo');
  const c = db.prepare('SELECT snap_categoria, snap_iglesia FROM credenciales WHERE id = ?').get(suya);
  assert.equal(c.snap_categoria, 'FILIAL');
  assert.equal(c.snap_iglesia, 'Iglesia Central', 'el nombre de la iglesia sigue igual');
});

test('correrla dos veces no hace nada la segunda', () => {
  unaCredencial('CENTRAL');
  dejarlaCorrerDeNuevo();
  const primera = laCategoriaCentralAhoraEsMatriz(db);
  assert.ok(primera.migradas >= 1);
  const segunda = laCategoriaCentralAhoraEsMatriz(db);
  assert.equal(segunda.migradas, 0, 'queda marcada como aplicada');
});
