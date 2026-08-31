/**
 * El inventario de un cuerpo, de una iglesia y de la corporación.
 *
 * Los datos estaban bien guardados; el problema era llegar a ellos. Medido
 * antes: la ficha de un cuerpo tenía pestañas de Integrantes, Cuotas,
 * Tesorería, Directivas y Actas —el inventario era lo único suyo que se
 * quedaba fuera—, la de la iglesia tenía Documentos e Historial, y el listado
 * solo se dejaba filtrar por categoría y por estado. Para ver «el inventario
 * de este cuerpo» había que ir al listado general y buscarlo a ojo.
 *
 * Y ninguna pantalla sumaba nada. Eso importa más desde la 1.230.0, porque
 * ahora hay algo que sumar mal: un inventario que junta en un mismo total la
 * batería que un hermano dejó en depósito y las bancas que la iglesia compró
 * no contesta ninguna de las dos preguntas —ni cuánto tiene la iglesia, ni
 * cuánto está cuidando de otros—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const inventarios = require('../../server/modules/inventarios');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Recuento','IG-REC','Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES ('Coro del Recuento', ?, 'Cuerpo', 'Activo')")
  .run(iglesia).lastInsertRowid;

let n = 0;
const anotar = ({ ambito = 'Iglesia local', cuerpoId = null, regimen = 'Propio',
                  cantidad = 1, valor = 0, devuelto = null, dueno = null }) => db
  .prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cuerpo_id, cantidad, regimen,
                                     valor_estimado, dueno, fecha_devuelto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(`Cosa ${++n} del Recuento`, ambito, ambito === 'Corporación' ? null : iglesia,
       cuerpoId, cantidad, regimen, valor, dueno, devuelto).lastInsertRowid;

/*
 * La ruta se corre a través de un router de mentira: lo que se quiere probar
 * es la consulta y el recuento, no Express. Es lo mismo que hace el motor —le
 * pasa un router y unas piezas— y así la prueba no necesita servidor.
 */
const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };
const deNivel = (query, usuario = admin) => {
  let manejar = null;
  inventarios.extraRoutes(
    { get: (ruta, _perm, fn) => { if (ruta === '/inventarios/de-nivel') manejar = fn; } },
    { db, requirePerm: () => (req, res, next) => next(), scopeClause: () => null }
  );
  assert.ok(manejar, 'no está la ruta /inventarios/de-nivel');
  let salida = null;
  manejar(
    { query, user: usuario },
    { json: (d) => { salida = { code: 200, d }; }, status: (c) => ({ json: (d) => { salida = { code: c, d }; } }) }
  );
  return salida;
};

// ------------------------------------------------- se puede pedir por nivel ----

test('el inventario de un cuerpo se puede pedir, y trae solo lo suyo', () => {
  /*
   * Se siembra un SEGUNDO cuerpo de la misma iglesia con lo suyo. Sin él, la
   * prueba pasaba aunque la consulta no filtrara por cuerpo —acotar por nivel
   * bastaba, porque en ese momento no había otro artículo de cuerpo en la
   * base—, y eso depende de lo que estén sembrando los otros archivos de
   * pruebas, que corren a la vez sobre la misma base. Comprobado: quitarle el
   * filtro de cuerpo no ponía roja ninguna prueba.
   */
  const otroCuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES ('Jóvenes del Recuento', ?, 'Cuerpo', 'Activo')")
    .run(iglesia).lastInsertRowid;
  const suyo = anotar({ ambito: 'Cuerpo / Grupo', cuerpoId: cuerpo, valor: 550000 });
  const delOtro = anotar({ ambito: 'Cuerpo / Grupo', cuerpoId: otroCuerpo, valor: 111000 });
  anotar({ ambito: 'Iglesia local', valor: 45000 });   // de la iglesia, no de un cuerpo

  const r = deNivel({ ambito: 'Cuerpo / Grupo', cuerpo_id: cuerpo });
  assert.equal(r.code, 200);
  const ids = r.d.filas.map((f) => f.id);
  assert.ok(ids.includes(suyo));
  assert.ok(!ids.includes(delOtro), 'el cuerpo de al lado tiene lo suyo, no lo de éste');
  assert.equal(r.d.totales.propio.valor, 550000);
});

test('el de una iglesia trae lo suyo y NO lo de sus cuerpos', () => {
  /*
   * Cada cuerpo tiene lo suyo en su propia ficha. Mezclarlos haría que un mismo
   * artículo se contara dos veces al sumar la organización.
   */
  const otra = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Otra del Recuento','IG-RE2','Activa')")
    .run().lastInsertRowid;
  const suCuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, iglesia_id, tipo, estado) VALUES ('Damas del Recuento', ?, 'Cuerpo', 'Activo')")
    .run(otra).lastInsertRowid;
  const deLaIglesia = db
    .prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cantidad, regimen, valor_estimado)
              VALUES ('Bancas del Recuento', 'Iglesia local', ?, 24, 'Propio', 45000)`)
    .run(otra).lastInsertRowid;
  db.prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cuerpo_id, cantidad, regimen, valor_estimado)
              VALUES ('Teclado del Recuento', 'Cuerpo / Grupo', ?, ?, 1, 'Propio', 550000)`)
    .run(otra, suCuerpo);

  const r = deNivel({ ambito: 'Iglesia local', iglesia_id: otra });
  assert.deepEqual(r.d.filas.map((f) => f.id), [deLaIglesia]);
  assert.equal(r.d.totales.propio.unidades, 24, 'y cuenta unidades, no fichas');
  assert.equal(r.d.totales.propio.valor, 24 * 45000, 'el valor es cantidad × valor unitario');
});

test('el de la corporación no necesita iglesia ni cuerpo', () => {
  const camioneta = anotar({ ambito: 'Corporación', valor: 8000000 });
  const r = deNivel({ ambito: 'Corporación' });
  assert.equal(r.code, 200);
  assert.ok(r.d.filas.some((f) => f.id === camioneta));
});

test('un nivel que no existe, o sin decir de cuál, se rechaza', () => {
  assert.equal(deNivel({ ambito: 'Zona' }).code, 400);
  assert.equal(deNivel({ ambito: 'Cuerpo / Grupo' }).code, 400, 'falta el cuerpo');
  assert.equal(deNivel({ ambito: 'Iglesia local' }).code, 400, 'falta la iglesia');
});

// ------------------------------------ lo propio y lo ajeno, por separado ----

test('los totales separan lo de la iglesia de lo que no es suyo', () => {
  const tercera = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Tercera del Recuento','IG-RE3','Activa')")
    .run().lastInsertRowid;
  const poner = (regimen, cantidad, valor, devuelto = null) => db
    .prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cantidad, regimen, valor_estimado,
                                       dueno, fecha_devuelto)
              VALUES (?, 'Iglesia local', ?, ?, ?, ?, ?, ?)`)
    .run(`Cosa ${++n} del Recuento`, tercera, cantidad, regimen, valor,
         regimen === 'Propio' ? null : 'Un hermano', devuelto);

  poner('Propio', 24, 45000);          // 1.080.000
  poner('Propio', 1, 380000);          //   380.000
  poner('Prestado', 1, 400000);        //   400.000
  poner('En depósito', 1, 900000);     //   900.000
  poner('Prestado', 1, 999999, '2026-02-01');  // ya devuelto: no cuenta

  const t = deNivel({ ambito: 'Iglesia local', iglesia_id: tercera }).d.totales;
  assert.equal(t.propio.articulos, 2);
  assert.equal(t.propio.valor, 1460000);
  assert.equal(t.prestado.valor, 400000);
  assert.equal(t.deposito.valor, 900000);
  assert.equal(t.ajeno.valor, 1300000, 'lo prestado y lo depositado, juntos');
  assert.equal(t.ajeno.articulos, 2);
  assert.equal(t.devueltos.articulos, 1, 'lo devuelto se cuenta aparte, no en lo que hay');
});

test('lo ya devuelto no entra en lo que hay, pero sigue en la hoja', () => {
  const cuarta = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Cuarta del Recuento','IG-RE4','Activa')")
    .run().lastInsertRowid;
  const ido = db
    .prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cantidad, regimen, valor_estimado,
                                       dueno, fecha_devuelto)
              VALUES ('Amplificador devuelto', 'Iglesia local', ?, 1, 'Prestado', 400000, 'Juan', '2026-02-01')`)
    .run(cuarta).lastInsertRowid;

  const r = deNivel({ ambito: 'Iglesia local', iglesia_id: cuarta });
  assert.ok(r.d.filas.some((f) => f.id === ido), 'la hoja lo sigue mostrando: estuvo y se devolvió');
  assert.equal(r.d.totales.ajeno.valor, 0, 'pero no se cuenta como algo que la iglesia tenga hoy');
  assert.equal(r.d.totales.devueltos.articulos, 1);
});

// ------------------------------------------------------- cada uno ve lo suyo ----

test('quien administra otra iglesia no ve este inventario', () => {
  const quinta = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Quinta del Recuento','IG-RE5','Activa')")
    .run().lastInsertRowid;
  db.prepare(`INSERT INTO inventarios (articulo, ambito, iglesia_id, cantidad, regimen)
              VALUES ('Reservado del Recuento', 'Iglesia local', ?, 1, 'Propio')`).run(quinta);

  const ajena = { id: 2, rol: 'secretaria', iglesias: JSON.stringify([iglesia]), cuerpos: '[]' };
  const r = deNivel({ ambito: 'Iglesia local', iglesia_id: quinta }, ajena);
  assert.equal(r.d.filas.length, 0, 'el alcance es el mismo del listado, no uno escrito aparte');
});

// -------------------------------------------------- dónde se mira, en pantalla ----

test('la ficha del cuerpo y la de la iglesia tienen su pestaña de inventario', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function pestanasDeLaFicha(');
  assert.ok(desde > 0);
  const trozo = app.slice(desde, app.indexOf('\n  return suyas;', desde));

  assert.match(trozo, /sumar\('inventario', 'Inventario'[\s\S]{0,220}ambito: 'Cuerpo \/ Grupo'/,
    'era lo único del cuerpo que no se veía desde su ficha');

  /*
   * Y en la de la iglesia, colgada de que el módulo esté a la vista. Se busca
   * el guardia y el nivel por separado y no la línea entera: cuando la 1.234.0
   * le agregó a la iglesia sus pestañas de Miembros, Cuerpos, Pastores y
   * Tesorería, esta prueba se cayó por el sangrado —la condición pasó a estar
   * anidada— sin que nada del inventario hubiera cambiado. Una prueba que se
   * rompe cuando se mueve una llave no está cuidando lo que dice cuidar.
   */
  const deLaIglesia = trozo.slice(trozo.indexOf("if (name === 'iglesias')"));
  assert.match(deLaIglesia, /MOD\['inventarios'\]/, 'sin el módulo a la vista, no hay pestaña');
  assert.match(deLaIglesia, /sumar\('inventario', 'Inventario'[\s\S]{0,260}ambito: 'Iglesia local'/);
});

test('y el listado se puede filtrar por cuerpo', () => {
  const def = getModule('inventarios');
  assert.ok(def.filterFields.includes('cuerpo_id'),
    'sin esto hay que buscar a ojo en el listado general');
  assert.ok(def.filterFields.includes('regimen'));
  assert.ok(def.filterFields.includes('ambito'));
});

test('la hoja del inventario es su propia pantalla, y se puede imprimir', () => {
  /*
   * Su propia pantalla y no una pestaña, por la misma razón que la cartola:
   * imprimir una pestaña de la ficha imprimiría la ficha entera.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /function viewHojaDeInventario\(tipo, id\)/);
  assert.match(app, /parts\[0\] === 'inventarios' && parts\[1\] === 'hoja'/, 'y tiene su dirección');

  const desde = app.indexOf('async function viewHojaDeInventario(');
  const hoja = app.slice(desde, app.indexOf('\n/* ===', desde));
  assert.match(hoja, /data-imprimir/);
  assert.match(hoja, /membreteDelDocumento\(\)/, 'lo que se imprime lleva membrete');
  assert.match(hoja, /pieDelDocumento\(\)/);
  assert.match(hoja, /`Lo propio, \$\{suyoEs\}`/, 'los títulos nombran el nivel, como los totales');
  assert.match(hoja, /`<span class="mut">Propio, \$\{esc\(suyoEs\)\}<\/span>`/,
    'y la columna «de quién es» de cada fila, también');
  assert.doesNotMatch(hoja, /De la iglesia</,
    'ni un solo «de la iglesia» fijo: la hoja de la corporación decía eso de su camioneta');
  assert.match(hoja, /`Lo que no es \$\{suyoEs\}`/);
  assert.match(hoja, /'Ya devuelto a su dueño'/);
});

test('los totales nombran el nivel: de la corporación, de la iglesia, del cuerpo', () => {
  /*
   * Se vio en la hoja de verdad: la de la corporación decía «De la iglesia»
   * sobre la camioneta de la organización, y la de un cuerpo lo mismo sobre su
   * teclado. Es de las cosas que hacen dudar de si la cifra está bien contada.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const DUENO_DEL_NIVEL = {');
  assert.ok(desde > 0, 'no está el nombre de cada nivel');
  const trozo = app.slice(desde, app.indexOf('\n}', app.indexOf('function totalesDelInventario(')));

  assert.match(trozo, /'Corporación': 'de la corporación'/);
  assert.match(trozo, /'Iglesia local': 'de la iglesia'/);
  assert.match(trozo, /'Cuerpo \/ Grupo': 'del cuerpo o grupo'/);
  assert.match(trozo, /`Propio, \$\{suyo\}`/, 'la línea de lo propio nombra al dueño del nivel');
  assert.match(trozo, /`No es \$\{suyo\}, en total`/, 'y la de lo ajeno, también');
});

test('los totales se dibujan una sola vez, y sirven a la pestaña y a la hoja', () => {
  /*
   * Es la misma pregunta en los dos lugares y tiene que dar la misma respuesta.
   * Dibujarla dos veces es tener dos respuestas que un día van a discrepar.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.equal((app.match(/function totalesDelInventario\(/g) || []).length, 1);
  assert.equal((app.match(/totalesDelInventario\(d\.totales, d\.ambito\)/g) || []).length, 2,
    'la pestaña y la hoja, las dos');
});
