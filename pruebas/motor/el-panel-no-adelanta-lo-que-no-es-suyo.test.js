/**
 * El panel no adelanta nada que la persona no pueda abrir por su cuenta.
 *
 * El Panel de control es lo primero que ve todo el que entra al sistema, y era
 * la única pantalla que armaba su resumen antes de saber quién estaba mirando.
 * Seis de sus piezas preguntaban por el permiso de su módulo antes de
 * calcularse; tres no, y eran justo las que llevan nombres de personas.
 *
 * MEDIDO en la v1.436.0, con una cuenta con Miembros, Solicitudes y
 * Certificados cerrados —las tres puertas contestaban 403—:
 *
 *   counts ................  miembros 3 · solicitudes_pendientes 1 · certificados 0
 *   solicitudesRecientes ..  «Ayuda por la enfermedad de su hijo» — Rosa Díaz Fuentes
 *   cumpleanos ............  Rosa Díaz Fuentes · 15/1 · cumple 42, y los demás
 *
 * Lo primero es una cifra; lo segundo es el nombre de una persona junto al
 * motivo por el que pidió ayuda, y la pantalla además lo dibujaba, porque esa
 * tarjeta era la única del panel sin condición (hallazgos PC-01 y PC-03).
 *
 * Y con una cuenta que SÍ tiene Miembros pero no la llave del RUT y la fecha de
 * nacimiento: la ficha le llegaba sin `rut` y sin `fecha_nacimiento` —la llave
 * funcionaba en la ficha, en el listado y en la planilla— y el panel le
 * entregaba el día, el mes y la edad de cada miembro, que es esa misma fecha
 * dicha de otra manera (hallazgo PC-02). Es la forma del hallazgo RC-01: la
 * misma fuga por otra puerta.
 *
 * ── LO QUE SE VIGILA ACÁ ES LA REGLA ──
 *
 * Los tres hallazgos son el mismo: la pieza se calculaba y era la PANTALLA la
 * que decidía si dibujarla. Comprobar los tres casos a mano dejaría el mismo
 * agujero abierto para la novena pieza que alguien agregue. Así que se vigila
 * que TODA pieza del panel esté declarada en la tabla de server/panel.js, que
 * la tabla y lo que el panel devuelve digan lo mismo, y que una pieza sin
 * declarar quede fuera en vez de quedar abierta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { LO_QUE_PIDE_CADA_PIEZA, puedeVerLaPieza } = require('../../server/panel');
const { LLAVES } = require('../../server/permissions');
const { allModules } = require('../../server/registry');

const fuente = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
/** El trozo de index.js que arma el panel. */
const elPanel = fuente.slice(
  fuente.indexOf("app.get('/api/dashboard'"),
  fuente.indexOf("app.get('/api/pendientes'")
);

// ------------------------------------------- la regla ----------------------

test('todo lo que el panel devuelve está declarado en la tabla', () => {
  /*
   * Ésta es la que impide que el agujero vuelva a abrirse: si alguien agrega
   * una novena pieza a la respuesta y no la declara, esto se pone rojo antes de
   * que la pieza llegue a publicarse.
   */
  const respuesta = elPanel.slice(elPanel.lastIndexOf('res.json({'));
  const devuelve = (respuesta.slice(0, respuesta.indexOf('});')).match(/[a-zA-Z_]+/g) || [])
    .filter((x) => x !== 'res' && x !== 'json');
  assert.ok(devuelve.length >= 8, `solo se leyeron ${devuelve.length} piezas de la respuesta`);

  const declaradas = new Set(Object.keys(LO_QUE_PIDE_CADA_PIEZA).map((k) => k.split('.')[0]));
  const sinDeclarar = devuelve.filter((k) => !declaradas.has(k));
  assert.deepEqual(sinDeclarar, [],
    `estas piezas del panel no dicen qué permiso piden: ${sinDeclarar.join(', ')}`);
});

test('y cada contador que el panel arma también', () => {
  const bloque = elPanel.slice(elPanel.indexOf('const counts = {'), elPanel.indexOf('};', elPanel.indexOf('const counts = {')));
  const contadores = [...bloque.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(contadores.length >= 6, `solo se leyeron ${contadores.length} contadores`);
  for (const c of contadores) {
    assert.ok(LO_QUE_PIDE_CADA_PIEZA[`counts.${c}`],
      `el contador «${c}» no dice qué permiso pide`);
  }
});

test('el panel decide por la tabla y no por condiciones sueltas', () => {
  // Si alguien vuelve a escribir un `can(...)` a mano para una pieza, la tabla
  // deja de ser la lista entera y el próximo olvido no lo nota nadie.
  assert.match(elPanel, /require\('\.\/panel'\)\.puedeVerLaPieza/,
    'el panel dejó de consultar la tabla');
  const aMano = [...elPanel.matchAll(/can\(req\.user, '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(aMano, [], `estas piezas se decidieron a mano y no por la tabla: ${aMano.join(', ')}`);
});

test('y cada pieza está guardada por su propia entrada, sin nada delante', () => {
  /*
   * La comprobación anterior mira que no queden `can(...)` a mano; ésta mira lo
   * otro: que la consulta a la tabla sea lo ÚNICO que decide. Un `true ||`
   * delante deja la llamada escrita —y la prueba de arriba en verde— con la
   * pieza calculándose para todos, que es exactamente el hallazgo PC-01.
   *
   * Se comprueba acá, mirando el código, porque esta prueba corre sobre el
   * motor y el motor no monta la ruta del panel. La otra mitad —pedirle el
   * panel a un servidor de verdad con una cuenta acotada y ver qué contesta—
   * está en la sección 4i de pruebas/seguridad.js.
   */
  for (const pieza of ['cumpleanos', 'solicitudesRecientes', 'credencialesPorVencer',
    'credencialesSinTitular', 'cuerposSinDirectiva', 'documentosSinResponder']) {
    assert.match(elPanel, new RegExp(`const ${pieza} = puede\\('${pieza}'\\)`),
      `«${pieza}» no se decide directamente por su entrada de la tabla`);
  }
  assert.match(elPanel, /if \(puede\('finanzas'\)\) \{/, 'las finanzas tampoco');
  assert.match(elPanel, /if \(puede\('counts\.ayudas_mes'\)\) \{/, 'ni las ayudas del mes');
});

test('lo que pide cada pieza existe de verdad', () => {
  // Una pieza que pidiera un permiso mal escrito no se le mostraría a nadie, y
  // el síntoma sería una pantalla vacía sin explicación.
  const modulos = new Set(allModules().map((m) => m.name));
  const llaves = new Set(LLAVES.map((l) => l.name));
  for (const [pieza, regla] of Object.entries(LO_QUE_PIDE_CADA_PIEZA)) {
    for (const q of regla.pide || []) {
      assert.ok(modulos.has(q) || llaves.has(q),
        `«${pieza}» pide «${q}», que no es ni un módulo ni una llave del sistema`);
    }
  }
});

test('una pieza que nadie declaró queda FUERA, no abierta', () => {
  const todopoderoso = { id: 1, rol: 'admin' };
  assert.equal(puedeVerLaPieza(todopoderoso, 'una_pieza_que_nadie_declaro'), false,
    'olvidarse de declarar una pieza tiene que dejarla fuera, no dejarla abierta');
});

// ------------------------------------------- y los casos medidos -----------

/** Una cuenta con el rol de administrador menos los permisos que se le quiten. */
const sinEstos = (quitados) => ({
  id: 99, rol: 'admin',
  permisos: JSON.stringify(Object.fromEntries(quitados.map((q) => [q, []]))),
});
const admin = { id: 1, rol: 'admin' };

test('la cuenta con Miembros, Solicitudes y Certificados cerrados no recibe nada de eso', () => {
  const ella = sinEstos(['miembros', 'solicitudes', 'certificados']);
  for (const pieza of ['counts.miembros', 'counts.solicitudes_pendientes', 'counts.solicitudes_vencidas',
    'counts.certificados', 'solicitudesRecientes', 'cumpleanos']) {
    assert.equal(puedeVerLaPieza(ella, pieza), false, `todavía recibe «${pieza}»`);
  }
  // Y lo que sí es suyo lo sigue recibiendo
  for (const pieza of ['counts.iglesias', 'counts.cuerpos', 'counts.pastores', 'finanzas']) {
    assert.equal(puedeVerLaPieza(ella, pieza), true, `perdió «${pieza}», que sí es suyo`);
  }
});

test('la cuenta sin la llave del RUT y la fecha de nacimiento no recibe los cumpleaños', () => {
  const ella = sinEstos(['miembros_identidad']);
  assert.equal(puedeVerLaPieza(ella, 'cumpleanos'), false,
    'el día, el mes y la edad son la fecha de nacimiento dicha de otra manera');
  assert.equal(puedeVerLaPieza(ella, 'counts.miembros'), true,
    'pero sigue viendo Miembros: lo que se le cerró es la llave, no el módulo');
});

test('las finanzas siguen pidiendo las DOS llaves', () => {
  assert.equal(puedeVerLaPieza(admin, 'finanzas'), true);
  assert.equal(puedeVerLaPieza(sinEstos(['tesoreria_montos']), 'finanzas'), false,
    'ver Tesorería y ver sus montos son dos permisos distintos, y estaba bien resuelto');
  assert.equal(puedeVerLaPieza(sinEstos(['tesoreria']), 'finanzas'), false);
});

test('los cuatro avisos siguen pidiendo su módulo, como ya lo hacían', () => {
  for (const [pieza, modulo] of [['credencialesPorVencer', 'credenciales'],
    ['credencialesSinTitular', 'credenciales'], ['cuerposSinDirectiva', 'cuerpos'],
    ['documentosSinResponder', 'documentos']]) {
    assert.equal(puedeVerLaPieza(admin, pieza), true);
    assert.equal(puedeVerLaPieza(sinEstos([modulo]), pieza), false, `${pieza} dejó de pedir ${modulo}`);
  }
});

// ------------------------------------------- y la pantalla -----------------

test('la pantalla tampoco dibuja la tarjeta de una pieza que no es suya', () => {
  /*
   * La tarjeta de las solicitudes recientes era la única del panel sin
   * condición. Las dos mitades hacen falta: sin la del servidor el dato viaja,
   * y sin la de la pantalla se dibuja un hueco.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const cols = app.slice(app.indexOf('<div class="dash-cols">'), app.indexOf('<div id="dashPendientes">'));
  assert.match(cols, /MOD\['miembros'\] \? cumpleHtml/, 'la de cumpleaños ya estaba condicionada');
  assert.match(cols, /MOD\['solicitudes'\] \? `/, 'la de solicitudes recientes sigue sin condición');
});

test('y cuando no hay cumpleaños dice por qué, en vez de mentir', () => {
  /*
   * El servidor manda la lista vacía también a quien no tiene la llave, y ahí
   * «todavía no hay miembros con fecha de nacimiento registrada» sería falso.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /!tieneLlave\('miembros_identidad'\)/,
    'la tarjeta vacía no distingue «no hay nadie» de «esto no es suyo»');
  assert.match(app, /no alcanza la fecha de nacimiento de las fichas/);
});
