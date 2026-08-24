/**
 * Lo que se guarda en Configuración es lo que el sistema usa.
 *
 * La pantalla de configuración tenía veintidós opciones y varias cosas que en
 * la práctica también son decisiones de la iglesia estaban escritas en el
 * código: cuánto puede pesar un archivo, a los cuántos errores de contraseña
 * se cierra la puerta, cada cuánto se recuerda bajar el respaldo, con cuánto
 * espacio libre hay que avisar. Cambiar cualquiera de esas exigía tocar el
 * programa y volver a publicarlo.
 *
 * Y había una trampa vieja: los números se leían con límites —`numero(clave,
 * min, max)`— pero se guardaban sin ninguno. Escribir 9999 en «cuántas copias
 * se guardan» guardaba 9999 y el sistema usaba 60, así que la pantalla decía
 * una cosa mientras pasaba otra. Eso es lo que estas pruebas fijan.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');

// ------------------------------------------------- el catálogo está sano ----

test('cada opción se puede leer y trae un valor de fábrica', () => {
  for (const grupo of ajustes.OPCIONES) {
    assert.ok(grupo.grupo, 'un grupo sin nombre no se puede mostrar');
    for (const o of grupo.items) {
      assert.ok(o.clave, 'una opción sin clave no se puede guardar');
      assert.ok(o.label, `${o.clave} sin etiqueta`);
      assert.ok(['text', 'textarea', 'number', 'boolean', 'imagen', 'select'].includes(o.tipo), `${o.clave}: tipo «${o.tipo}»`);
      assert.notEqual(ajustes.obtener(o.clave), undefined, `${o.clave} no devuelve nada`);
    }
  }
});

test('no hay dos opciones con la misma clave', () => {
  // Dos iguales se pisarían al guardar, y la de más abajo ganaría en silencio
  const vistas = new Set();
  for (const grupo of ajustes.OPCIONES) {
    for (const o of grupo.items) {
      assert.ok(!vistas.has(o.clave), `«${o.clave}» está declarada dos veces`);
      vistas.add(o.clave);
    }
  }
});

test('toda opción de lista declara entre qué elegir', () => {
  // Una lista sin opciones sería una caja vacía; y un valor de fábrica que no
  // esté entre ellas dejaría el sistema arrancando en un modo que no existe.
  for (const grupo of ajustes.OPCIONES) {
    for (const o of grupo.items) {
      if (o.tipo !== 'select') continue;
      assert.ok(Array.isArray(o.opciones) && o.opciones.length >= 2, `${o.clave} sin opciones`);
      for (const x of o.opciones) {
        assert.ok(x.valor, `${o.clave}: una opción sin valor`);
        assert.ok(x.label, `${o.clave}: la opción «${x.valor}» sin etiqueta`);
      }
      assert.ok(o.opciones.some((x) => x.valor === o.defecto),
        `${o.clave}: su valor de fábrica «${o.defecto}» no está entre sus opciones`);
    }
  }
});

test('todo número dice entre qué y qué se mueve', () => {
  // Sin límites declarados no se puede ajustar al guardar, y volvería la
  // trampa de guardar una cosa y usar otra.
  for (const grupo of ajustes.OPCIONES) {
    for (const o of grupo.items) {
      if (o.tipo !== 'number') continue;
      assert.equal(typeof o.min, 'number', `${o.clave} sin mínimo`);
      assert.equal(typeof o.max, 'number', `${o.clave} sin máximo`);
      assert.ok(o.min < o.max, `${o.clave}: el mínimo no es menor que el máximo`);
      const defecto = Number(o.defecto);
      assert.ok(defecto >= o.min && defecto <= o.max,
        `${o.clave}: su valor de fábrica (${defecto}) queda fuera de sus propios límites`);
    }
  }
});

// -------------------------------------------- guardar y volver a leer ----

test('lo guardado se lee de vuelta, y lo no guardado da su valor de fábrica', () => {
  assert.equal(ajustes.obtener('moneda_simbolo'), '$');
  ajustes.guardar('moneda_simbolo', 'CLP$', null);
  assert.equal(ajustes.obtener('moneda_simbolo'), 'CLP$');
  ajustes.guardar('moneda_simbolo', '$', null);
});

test('una clave que no existe no se guarda', () => {
  // Si se guardara, quedaría basura en la tabla que nadie lee ni limpia
  ajustes.guardar('inventada_por_alguien', 'x', null);
  assert.equal(ajustes.obtener('inventada_por_alguien'), null);
});

test('numero() nunca devuelve algo fuera de sus límites', () => {
  ajustes.guardar('respaldo_conservar', '9999', null);
  assert.equal(ajustes.numero('respaldo_conservar', 2, 60), 60);
  ajustes.guardar('respaldo_conservar', '-4', null);
  assert.equal(ajustes.numero('respaldo_conservar', 2, 60), 2);
  ajustes.guardar('respaldo_conservar', 'lo que sea', null);
  assert.equal(ajustes.numero('respaldo_conservar', 2, 60), 7, 'lo que no es número cae en el de fábrica');
  ajustes.guardar('respaldo_conservar', '7', null);
});

test('activo() mira el valor y no la verdad de la cadena', () => {
  // "0" es una cadena, y toda cadena es verdadera en JavaScript: es el error
  // clásico, y dejaría una opción encendida al querer apagarla.
  ajustes.guardar('bitacora_automatica', '0', null);
  assert.equal(ajustes.activo('bitacora_automatica'), false);
  ajustes.guardar('bitacora_automatica', '1', null);
  assert.equal(ajustes.activo('bitacora_automatica'), true);
});

// ------------------------------------- lo que antes estaba en el código ----

test('los ajustes nuevos existen y traen lo que había escrito en el código', () => {
  // Los valores de fábrica son exactamente los que estaban antes fijos: al
  // publicar esta versión nadie tiene que notar ningún cambio.
  const comoEstaba = {
    credencial_qr_modo: 'linea',  // el punto 8.2 dice que (a) es el valor por defecto
    archivo_tope_mb: '15',        // TOPE_ARCHIVO = 15 * 1024 * 1024
    planilla_tope_filas: '20000', // TOPE_PLANILLA
    disco_aviso_mb: '100',        // el aviso de disco apretado
    acceso_intentos: '5',         // el primer peldaño de la escala por RUT
    respaldo_recordar_dias: '30', // CADA_CUANTOS_DIAS
  };
  for (const [clave, valor] of Object.entries(comoEstaba)) {
    assert.ok(ajustes.POR_CLAVE[clave], `falta la opción ${clave}`);
    assert.equal(ajustes.obtener(clave), valor, `${clave} cambió de valor de fábrica`);
  }
});

test('la escala de intentos sale del ajuste, y de fábrica es la de siempre', () => {
  const intentos = require('../../server/intentos');
  // La escala no se expone: se comprueba por su efecto, que es lo que importa.
  // Con el valor de fábrica, cinco errores sobre un RUT cierran la puerta.
  const rut = '11111111-1';
  const ip = '1.2.3.4';
  assert.equal(intentos.intentosQueLeQuedan(rut, ip), 5, 'de fábrica avisa que le quedan cinco');
  for (let i = 0; i < 4; i++) intentos.fallo(rut, ip);
  assert.equal(intentos.esperaQueLeFalta(rut, ip), 0, 'a los cuatro todavía deja pasar');
  intentos.fallo(rut, ip);
  assert.ok(intentos.esperaQueLeFalta(rut, ip) > 0, 'al quinto tendría que cerrarse');
  intentos.acierto(rut, ip);
});

test('y bajando el ajuste se cierra antes', () => {
  const intentos = require('../../server/intentos');
  ajustes.guardar('acceso_intentos', '3', null);
  const rut = '22222222-2';
  const ip = '5.6.7.8';
  assert.equal(intentos.intentosQueLeQuedan(rut, ip), 3);
  for (let i = 0; i < 2; i++) intentos.fallo(rut, ip);
  assert.equal(intentos.esperaQueLeFalta(rut, ip), 0);
  intentos.fallo(rut, ip);
  assert.ok(intentos.esperaQueLeFalta(rut, ip) > 0, 'con 3 tendría que cerrarse al tercero');
  intentos.acierto(rut, ip);
  ajustes.guardar('acceso_intentos', '5', null);
});

test('la identidad de la institución lleva todo lo que se imprime', () => {
  for (const clave of ['iglesia_nombre', 'iglesia_lema', 'iglesia_logo', 'iglesia_rut',
    'iglesia_direccion', 'iglesia_telefono', 'iglesia_email', 'iglesia_web']) {
    assert.ok(ajustes.POR_CLAVE[clave], `falta ${clave}`);
  }
  // El logo es el único de tipo imagen, y arranca en blanco: mientras no se
  // suba ninguno se usa el que trae el sistema
  assert.equal(ajustes.POR_CLAVE.iglesia_logo.tipo, 'imagen');
  assert.equal(ajustes.obtener('iglesia_logo'), '');
});

test('las opciones públicas son las justas', () => {
  // Lo público se entrega SIN sesión iniciada, a cualquiera que pida la
  // dirección. Ahí no puede colarse nada que no tenga que estar a la vista.
  const publicas = ajustes.OPCIONES.flatMap((g) => g.items).filter((o) => o.publica).map((o) => o.clave).sort();
  assert.deepEqual(publicas, [
    'iglesia_lema', 'iglesia_logo', 'iglesia_nombre',
    'mantenimiento_activo', 'mantenimiento_mensaje', 'recuperacion_activa',
  ], 'cambió lo que se entrega sin sesión: revíselo con cuidado');
});
