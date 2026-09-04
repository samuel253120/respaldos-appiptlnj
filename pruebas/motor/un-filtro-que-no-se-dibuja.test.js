/**
 * Un filtro declarado que la pantalla no dibuja, y no lo dice.
 *
 * La barra del listado pinta cuatro clases de filtro: un desplegable con su
 * lista escrita, uno de sí o no, uno que apunta a otro módulo y uno cuya lista
 * sale de una ruta. Lo demás lo descartaba EN SILENCIO, y en silencio es la
 * palabra: la barra sale con un selector menos y nadie tiene por qué notar que
 * falta.
 *
 * Medido en la v1.370.0: seis módulos declaraban nueve filtros que nadie llegó
 * a ver nunca. El más caro era el «Módulo» del Registro de Cambios —el filtro
 * con que ese libro se lee, y el servidor ya sabía contestarlo— y después el
 * «En uso» de las cuatro listas que la iglesia mantiene, que es justamente cómo
 * se revisa cuáles quedaron apagadas.
 *
 * Lo que se vigila acá: que la barra sepa dibujar esas dos clases nuevas, que
 * el módulo del Registro saque su lista de una ruta y no de una lista escrita
 * al lado, y que el registro se NIEGUE A ARRANCAR con un filtro que no se
 * pueda pintar, que es lo que impide que esto vuelva a pasar sin ruido.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { getModule, allModules, revisarLosFiltrosParaPruebas } = require('../../server/registry');
const { consultaDeUnListado } = require('../../server/crud');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

/* --------------------------------------- el registro no deja declarar uno malo */

const conFiltro = (campo, nombre) => ({ name: 'inventado', filterFields: [nombre || campo.name], fields: [campo] });

test('un filtro de texto no pasa: la barra no sabe dibujarlo', () => {
  assert.throws(
    () => revisarLosFiltrosParaPruebas(conFiltro({ name: 'modulo', label: 'Módulo', type: 'text' })),
    /declara el filtro «modulo» \(text\)/
  );
});

test('ni uno oculto, ni uno que no es campo del módulo', () => {
  assert.throws(
    () => revisarLosFiltrosParaPruebas(conFiltro({ name: 'cuerpo_id', type: 'number', oculto: true })),
    /\(oculto\)/
  );
  assert.throws(
    () => revisarLosFiltrosParaPruebas(conFiltro({ name: 'otro', type: 'select', options: ['a'] }, 'no_existe')),
    /que no es un campo suyo/
  );
});

test('ni un desplegable sin ninguna lista de dónde sacar sus opciones', () => {
  assert.throws(
    () => revisarLosFiltrosParaPruebas(conFiltro({ name: 'clase', label: 'Clase', type: 'select' })),
    /declara el filtro «clase» \(select\)/,
    'salía dibujado y vacío, que es la otra manera de no servir'
  );
});

test('ni una ruta con un hueco en el camino, que quedaría rota', () => {
  assert.throws(
    () => revisarLosFiltrosParaPruebas(conFiltro({
      name: 'cargo', label: 'Cargo', type: 'select', optionsRoute: '/directivas/{cuerpo_id}/cargos',
    })),
    /hueco en el camino/
  );
});

test('y sí pasan las cuatro que la barra dibuja', () => {
  const buenos = [
    { name: 'estado', label: 'Estado', type: 'select', options: ['Activo'] },
    { name: 'modulo', label: 'Módulo', type: 'select', optionsRoute: '/registro_cambios/modulos' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    { name: 'activo', label: 'En uso', type: 'boolean' },
    /*
     * Y una con un hueco en la PREGUNTA: la barra suelta ese trozo entero y la
     * ruta contesta con su lista completa, que es lo que un filtro necesita.
     * Es el caso de la clase de una deuda.
     */
    { name: 'clase', label: 'Clase', type: 'select', optionsRoute: '/deudas/clases?direccion={direccion}' },
  ];
  for (const campo of buenos) revisarLosFiltrosParaPruebas(conFiltro(campo));
});

test('y la comprobación está enganchada al arranque, no solo escrita', () => {
  /*
   * El registro normaliza cada módulo al montarlo: si la revisión no cuelga de
   * ahí, un filtro malo entra igual y todo lo demás de este archivo seguiría en
   * verde comprobando una función que nadie llama.
   */
  const { normalizarParaPruebas } = require('../../server/registry');
  assert.throws(
    () => normalizarParaPruebas({
      name: 'inventado', filterFields: ['modulo'],
      fields: [{ name: 'modulo', label: 'Módulo', type: 'text' }],
    }),
    /declara el filtro «modulo»/,
    'el sistema no tiene que poder arrancar con un filtro que no se dibuja'
  );
});

test('LA DE FONDO: ningún módulo del sistema declara un filtro que no se dibuje', () => {
  // Los cuarenta y tantos módulos, tal como los monta el registro: si alguno
  // volviera a declarar uno de texto, esto lo dice acá y no en silencio.
  for (const def of allModules()) revisarLosFiltrosParaPruebas(def);
});

/* ------------------------------------------------ lo que quedó declarado */

test('el «Módulo» del Registro de Cambios saca su lista de una ruta', () => {
  const campo = getModule('registro_cambios').fields.find((f) => f.name === 'modulo');
  assert.equal(campo.type, 'select');
  assert.equal(campo.optionsRoute, '/registro_cambios/modulos',
    'los módulos que de verdad tienen líneas, no una lista escrita al lado');
  assert.ok(getModule('registro_cambios').filterFields.includes('modulo'));
});

test('y las cuotas de un cuerpo dejan de declarar los dos que nunca se dibujaron', () => {
  const suyos = getModule('cuotas_cuerpo').filterFields;
  assert.deepEqual(suyos, ['mes']);
  assert.ok(!suyos.includes('cuerpo_id'), 'es un campo oculto: se acota desde la ficha del cuerpo');
});

/* ------------------------------------------------------- que acoten de verdad */

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Filtro FD','FD-FIL','Activa')")
  .run().lastInsertRowid;
db.prepare(
  `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id)
   VALUES ('2026-08-03','12:00','Tesorería','Cambio','De la prueba FD',1,'Monto: $ 1',' Tesorero FD',?),
          ('2026-08-03','12:01','Usuarios','Creación','De la prueba FD',1,'Rol: tesorero','Tesorero FD',?)`
).run(iglesia, iglesia);

test('el filtro por módulo acota de verdad: es lo que el servidor ya sabía hacer', () => {
  const cuantas = (query) => {
    const { whereSql, params } = consultaDeUnListado(
      getModule('registro_cambios'), { query, user: { id: 1, rol: 'admin' } }
    );
    return db
      .prepare(`SELECT COUNT(*) c FROM registro_cambios ${whereSql}${whereSql ? ' AND' : ' WHERE'} iglesia_id = ?`)
      .get(...params, iglesia).c;
  };
  assert.equal(cuantas({}), 2);
  assert.equal(cuantas({ f_modulo: 'Tesorería' }), 1);
  assert.equal(cuantas({ f_modulo: 'Usuarios' }), 1);
});

test('y el de sí o no también, que es como se revisa qué quedó apagado', () => {
  const tipos = getModule('tipos_actividad');
  const cuantos = (query) => {
    const { whereSql, params } = consultaDeUnListado(tipos, { query, user: { id: 1, rol: 'admin' } });
    return db.prepare(`SELECT COUNT(*) c FROM tipos_actividad ${whereSql}`).get(...params).c;
  };
  const todos = cuantos({});
  assert.ok(todos > 0);
  assert.equal(cuantos({ f_activo: '1' }) + cuantos({ f_activo: '0' }), todos,
    'la casilla se guarda como 1 y 0, y el filtro manda el mismo 1 y 0');
});

/* ------------------------------------------------------------ lo que pinta */

test('la barra dibuja las cuatro clases, y ninguna más', () => {
  const desde = app.indexOf('const filterFields = (m.filterFields || [])');
  assert.ok(desde > 0);
  const trozo = app.slice(desde, desde + 260);
  assert.match(trozo, /f\.type === 'select' \|\| f\.type === 'ref' \|\| f\.type === 'boolean'/);
});

test('un sí o no se ofrece como sí o no, y no como 1 y 0', () => {
  const desde = app.indexOf('const opcionesDelFiltro =');
  assert.ok(desde > 0, 'la barra no sabe qué ofrecer en un filtro de casilla');
  const trozo = app.slice(desde, desde + 320);
  assert.match(trozo, /value: '1', label: 'Sí'/);
  assert.match(trozo, /value: '0', label: 'No'/);
});

test('y el filtro que saca su lista de una ruta la pide', () => {
  assert.match(app, /filterFields\.filter\(\(f\) => f\.type === 'ref' \|\| f\.optionsRoute\)/);
});

test('al filtrar, el trozo de la ruta que depende del formulario se suelta', () => {
  const desde = app.indexOf('function rutaOpciones');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /if \(filtrando\) \{/);
  assert.match(trozo, /!\/\\\{\\w\+\\\}\/\.test\(par\)/,
    'se sueltan los pares de la pregunta que llevan un hueco');
});
