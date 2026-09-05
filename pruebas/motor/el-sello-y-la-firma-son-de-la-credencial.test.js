/**
 * El sello de la corporación y la firma del Pastor Presidente no son de todos.
 *
 * El logo, el sello y la firma viven los tres en la configuración y no cuelgan
 * de ninguna ficha, así que se entregaban los tres igual: a cualquiera con
 * sesión abierta. Pero no son la misma cosa.
 *
 * El logo se ve en todas partes —la pantalla de acceso, el menú, el encabezado
 * de todo lo que se imprime— y tiene que seguir así. El sello y la firma solo
 * salen en la credencial pastoral, y son justamente las dos piezas que hacen
 * difícil fabricar una falsa: la especificación usa el sello DOS veces, y una
 * de ellas cruzando la fotografía como marca de seguridad.
 *
 * Medido en la v1.423.0 con una cuenta de tesorera, sin permisos propios:
 *
 *   GET /api/credenciales ......................  403 · ni el listado ve
 *   GET /api/configuracion/recurso/sello .......  200 · y la imagen entera
 *   GET /api/configuracion/recurso/firma .......  200 · y la imagen entera
 *
 * Quien no puede ver una credencial no tiene por qué recibir las piezas con que
 * se arma, y no hace falta entrar al sistema para usarlas después (CO-03).
 *
 * Se cierran las DOS puertas: la de la configuración y la de /uploads, que
 * entrega cualquier archivo subido y también los daba por buenos. Cerrar una y
 * dejar la otra es no haber cerrado nada.
 *
 * Sobre cómo se mira: el sello y la firma son UNO SOLO para todo el sistema, así
 * que acá no se afirma nunca cuánto valen —ver la explicación larga en
 * «una-imagen-de-la-institucion-tiene-que-ser-una-imagen»—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const ajustes = require('../../server/ajustes');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

const UN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Deja un archivo en la carpeta de subidas y devuelve su nombre. */
function unaImagen(nombre) {
  const suyo = `co03-${marca}-${nombre}.png`;
  fs.writeFileSync(path.join(UPLOADS_DIR, suyo), UN_PNG);
  return suyo;
}
const elSello = unaImagen('sello');
const laFirma = unaImagen('firma');
const elLogo = unaImagen('logo');

/** Una cuenta con exactamente las llaves que se le den. */
let cuantas = 0;
function unaCuenta(permisos, nombre) {
  const numero = `${15000000 + (marca * 11 + cuantas++) % 900000}`;
  return db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, permisos) VALUES (?,?,?,1,?)')
    .run(`${numero}-${digitoVerificador(numero)}`, `${nombre} CO3 ${marca}`, 'tesorero',
      JSON.stringify(permisos))
    .lastInsertRowid;
}

// La tesorera del caso medido: no alcanza el módulo de credenciales
const laTesorera = unaCuenta({ tesoreria: ['view'] }, 'Tesorera');
// Y quien sí lo alcanza, aunque solo para mirar
const laQueLasVe = unaCuenta({ credenciales: ['view'] }, 'Encargada de credenciales');

/**
 * Deja puesto un ajuste compartido, pide algo, y contesta solo si al terminar
 * seguía siendo el nuestro. Los tres son de todo el sistema y otros archivos
 * los cambian con toda razón.
 */
async function conElAjustePuesto(clave, valor, pedir) {
  for (let intento = 0; intento < 25; intento++) {
    ajustes.guardar(clave, valor);
    const salida = await pedir();
    if (ajustes.obtener(clave) === valor) return salida;
  }
  return null;
}

// ------------------------------------------- lo que el ajuste declara -------

test('el sello y la firma dicen en su declaración qué permiso piden', () => {
  assert.equal(ajustes.POR_CLAVE.credencial_sello.soloConPermiso, 'credenciales');
  assert.equal(ajustes.POR_CLAVE.credencial_firma.soloConPermiso, 'credenciales');
  // Y el logo NO: se ve en la pantalla de acceso, antes de que haya nadie
  assert.equal(ajustes.POR_CLAVE.iglesia_logo.soloConPermiso, undefined);
});

test('y las dos puertas se lo preguntan al mismo', async () => {
  await elSistemaAndando();
  const cual = await conElAjustePuesto('credencial_sello', elSello,
    async () => ajustes.elArchivoDeLaInstitucion(elSello));
  assert.deepEqual(cual, { clave: 'credencial_sello', permiso: 'credenciales' });

  const delLogo = await conElAjustePuesto('iglesia_logo', elLogo,
    async () => ajustes.elArchivoDeLaInstitucion(elLogo));
  assert.deepEqual(delLogo, { clave: 'iglesia_logo', permiso: null }, 'el logo basta con tener sesión');

  // Un archivo que no es de la institución no lo es por preguntar
  assert.equal(ajustes.elArchivoDeLaInstitucion(`no-esta-en-ninguna-parte-${marca}.png`), null);
});

// ------------------------------------------- la puerta de la configuración --

test('a quien no alcanza las credenciales no se le entregan el sello ni la firma', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(laTesorera);

  assert.equal((await suya('GET', '/credenciales')).estado, 403, 'ni el listado ve');

  const sello = await conElAjustePuesto('credencial_sello', elSello,
    () => suya('GET', '/configuracion/recurso/sello'));
  assert.ok(sello, 'no se alcanzó a pedir el sello sin que otra prueba lo cambiara');
  assert.equal(sello.estado, 403, sello.texto.slice(0, 200));
  assert.match(sello.json.error, /credencial pastoral/);

  const firma = await conElAjustePuesto('credencial_firma', laFirma,
    () => suya('GET', '/configuracion/recurso/firma'));
  assert.ok(firma, 'no se alcanzó a pedir la firma sin que otra prueba la cambiara');
  assert.equal(firma.estado, 403, firma.texto.slice(0, 200));
});

test('y a quien sí las alcanza, sí', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(laQueLasVe);
  const sello = await conElAjustePuesto('credencial_sello', elSello,
    () => suya('GET', '/configuracion/recurso/sello'));
  assert.ok(sello, 'no se alcanzó a pedir el sello sin que otra prueba lo cambiara');
  assert.equal(sello.estado, 200, sello.texto.slice(0, 200));
});

// ------------------------------------------- la puerta de /uploads ----------

test('la otra puerta, la de los archivos subidos, contesta lo mismo', () => {
  const archivos = require('../../server/archivos');
  const laDeLaTesorera = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laTesorera);
  const laDeCredenciales = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laQueLasVe);

  ajustes.guardar('credencial_sello', elSello);
  const paraLaTesorera = archivos.puedeVer(elSello, laDeLaTesorera);
  assert.equal(paraLaTesorera.ok, false, 'por /uploads tampoco: cerrar una sola puerta no cierra nada');
  assert.match(paraLaTesorera.motivo, /credencial pastoral/);

  assert.equal(archivos.puedeVer(elSello, laDeCredenciales).ok, true);
});

test('pero el logo se sigue entregando a quien tenga sesión, como siempre', () => {
  const archivos = require('../../server/archivos');
  const laDeLaTesorera = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(laTesorera);
  ajustes.guardar('iglesia_logo', elLogo);
  assert.equal(archivos.puedeVer(elLogo, laDeLaTesorera).ok, true,
    'sale en el menú y en el encabezado de todo lo que se imprime');
});

// ------------------------------------------- lo que no se tocó --------------

test('y las dos preguntas sobre estos archivos siguen fallando cada una a su lado', () => {
  /*
   * Hay DOS preguntas parecidas sobre un archivo de la institución y no se
   * pueden juntar, aunque lo parezcan:
   *
   *   · ¿lo usa alguien?  la hace la barrida nocturna antes de borrar, y ante
   *     un problema al consultar la base contesta que SÍ, para no borrar el
   *     logo por error;
   *   · ¿se puede entregar?  la hace quien va a mandar el archivo, y ante el
   *     mismo problema tiene que contestar que NO.
   *
   * Compartir una sola función dejaría que un problema en la base abriera todos
   * los archivos a cualquiera, o borrara el logo. Esta prueba está para que no
   * se junten sin darse cuenta.
   */
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/archivos.js'), 'utf8');
  const laDeLaBarrida = fuente.slice(fuente.indexOf('function loUsaLaConfiguracion('));
  assert.match(laDeLaBarrida.slice(0, 400), /return true;\s*\/\/ si no se puede preguntar, no se borra/,
    'la de la barrida, ante la duda, no borra');

  const deAjustes = fs.readFileSync(path.join(__dirname, '../../server/ajustes.js'), 'utf8');
  const laDeEntregar = deAjustes.slice(deAjustes.indexOf('function elArchivoDeLaInstitucion('));
  assert.match(laDeEntregar.slice(0, 900), /catch \(e\) \{[\s\S]*?return null;/,
    'la de entregar, ante la duda, no entrega');

  // Y la barrida sigue preguntando por la configuración antes de borrar
  assert.match(fuente, /function loUsaAlguien\(archivo, salvo\) \{\s*if \(loUsaLaConfiguracion\(archivo\)\) return true;/,
    'sin esto, la barrida se llevaría el logo, el sello y la firma a los siete días');
});
