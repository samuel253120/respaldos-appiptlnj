/**
 * Lo que no puede ser una contraseña.
 *
 * Lo único que se exigía era el largo, y con eso pasaban «123456», «password»
 * y —lo que más importa— **el propio RUT de la persona**, que es lo primero
 * que probaría cualquiera que tenga la lista de usuarios delante. Se comprobó
 * con un usuario cuyo RUT era 22.222.222-2: su RUT le servía de contraseña.
 *
 * Lo que rodea a la contraseña ya estaba bien —bcrypt, nunca viaja en las
 * respuestas, cambiarla cierra las sesiones abiertas, el intento fallido tiene
 * freno progresivo—. Lo que faltaba era esto.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const claves = require('../../server/claves');

const MARGARITA = { rut: '15847293-7', nombre: 'Margarita Fuenzalida' };

// ------------------------------------------------------------- el largo ----

test('el mínimo son ocho caracteres, no seis', () => {
  assert.match(claves.revisarClave('Clave12', MARGARITA), /al menos 8/);
  assert.equal(claves.revisarClave('Clave123', MARGARITA), null);
});

test('una contraseña de puros espacios no es una contraseña', () => {
  assert.ok(claves.revisarClave('          ', MARGARITA));
});

// ---------------------------------------------------- las de siempre ----

test('las que se escriben para salir del paso no entran', () => {
  for (const mala of ['12345678', 'password', 'contraseña', 'qwertyui', 'iglesia123', 'administrador']) {
    assert.ok(claves.revisarClave(mala, MARGARITA), `«${mala}» tendría que rechazarse`);
  }
});

test('da lo mismo cómo se escriban: tildes, mayúsculas y signos no las disfrazan', () => {
  assert.ok(claves.revisarClave('CONTRASEÑA', MARGARITA));
  assert.ok(claves.revisarClave('contrasena', MARGARITA));
  assert.ok(claves.revisarClave('Pass-word', MARGARITA));
});

test('un solo carácter repetido no protege nada', () => {
  assert.ok(claves.revisarClave('aaaaaaaa', MARGARITA));
  assert.ok(claves.revisarClave('00000000', MARGARITA));
});

// --------------------------------------------- lo que tiene a la mano ----

test('su propio RUT no puede ser su contraseña', () => {
  const problema = claves.revisarClave('15847293', MARGARITA);
  assert.match(problema, /su RUT/);
});

test('ni con el guion y el dígito verificador', () => {
  assert.ok(claves.revisarClave('15847293-7', MARGARITA));
});

test('ni su nombre, ni su apellido, ni con el año pegado', () => {
  assert.match(claves.revisarClave('Margarita', MARGARITA), /su nombre/);
  assert.match(claves.revisarClave('Fuenzalida', MARGARITA), /su nombre/);
  assert.match(claves.revisarClave('margarita2026', MARGARITA), /su nombre/);
});

test('sin saber de quién es, esas reglas no se pueden aplicar y no estorban', () => {
  // Es el caso de un cambio hecho desde un sitio que no sabe a quién pertenece
  // la cuenta: se exige lo que sí se puede exigir, y nada más.
  assert.equal(claves.revisarClave('Cordillera47'), null);
  assert.equal(claves.revisarClave('15847293'), null);
});

// -------------------------------------------- el nombre de la iglesia ----

test('un pedazo del nombre de la iglesia tampoco sirve', () => {
  const ajustes = require('../../server/ajustes');
  ajustes.guardar('iglesia_nombre', 'Iglesia Pentecostal Triunfante La Nueva Jerusalén');
  assert.match(claves.revisarClave('IglesiaPentecostal', MARGARITA), /iglesia/i);
  assert.match(claves.revisarClave('Jerusalen2026', MARGARITA), /iglesia/i);
  assert.match(claves.revisarClave('triunfante', MARGARITA), /iglesia/i);
});

test('pero una palabra corriente del nombre no arrastra a media lengua', () => {
  // «La» y «Nueva» están en el nombre de la iglesia y son palabras de todos
  // los días: rechazar cualquier contraseña que las contenga sería pasarse.
  assert.equal(claves.revisarClave('LaNuevaCasa9', MARGARITA), null);
});

// ------------------------------------------------ las que sí sirven ----

test('una contraseña de verdad entra sin problemas', () => {
  for (const buena of ['Cordillera47', 'Valpo-2026!', 'el perro de mi tia', 'Zapallar#88']) {
    assert.equal(claves.revisarClave(buena, MARGARITA), null, `«${buena}» tendría que aceptarse`);
  }
});
