/**
 * La puerta de «¿Olvidó su contraseña?» tiene las mismas cerraduras que la de
 * entrar.
 *
 * La pantalla de acceso está cuidada con detalle: no dice si un RUT tiene
 * cuenta —contesta lo mismo en los dos casos, a propósito— y a los pocos
 * errores cierra la puerta un rato. Las dos cosas están probadas, y rotas, la
 * suite de aislamiento se pone roja.
 *
 * AL LADO HABÍA UNA SEGUNDA PUERTA SIN NADA DE ESO. Medido en la v1.316.0, sin
 * ninguna sesión:
 *
 *   · un RUT que existe recibía 400 «Esa cuenta no tiene pregunta de
 *     recuperación» y uno que no, 404 «No hay una cuenta activa con ese RUT».
 *     Los distinguía, que es justo lo que la puerta principal se niega a hacer.
 *   · cuarenta preguntas seguidas sin que la puerta se moviera. Ningún freno.
 *   · y seis respuestas erradas dejaban la recuperación BLOQUEADA para su
 *     dueño, hasta que un administrador la habilitara a mano. Quien supiera el
 *     RUT de la tesorera se la cerraba, y ella se enteraba el día que la
 *     necesitaba. En Chile un RUT no es un secreto.
 *
 * Las tres se arreglan con lo que el sistema ya tenía escrito para la puerta de
 * entrada: la misma respuesta exista o no la cuenta, el mismo portero contando
 * por dirección, y —lo que de verdad cierra el tercero— que el bloqueo se
 * levante solo pasado el rato, que es lo que ya hace el portero de la entrada y
 * por escrito la misma razón.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const claves = require('../../server/claves');
const intentos = require('../../server/intentos');
const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');

let siguiente = 0;
/** Un RUT propio de este proceso: los archivos del motor comparten una base. */
function unRutDePrueba() {
  const n = 21500000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/* --------------------------------------------------------------------- */
/* El portero, contando solo por dirección                                */
/* --------------------------------------------------------------------- */

test('el portero sabe contar SOLO por dirección, sin tocar ninguna cuenta', () => {
  /**
   * Es lo que hace posible frenar las preguntas sin que preguntar por una
   * cuenta ajena la deje cerrada a ella, que sería cambiar una maña por otra.
   */
  const desde = `1.2.3.${process.pid % 250}`;
  const rutAjeno = `9999${process.pid % 1000}-1`;

  assert.equal(intentos.esperaQueLeFalta(null, desde), 0, 'empieza abierta');
  for (let i = 0; i < 40; i++) intentos.fallo(null, desde);
  assert.ok(intentos.esperaQueLeFalta(null, desde) > 0, 'a las cuarenta tiene que estar cerrada');

  // Y la cuenta por la que se preguntaba NO quedó tocada
  assert.equal(intentos.esperaQueLeFalta(rutAjeno, `9.9.9.${process.pid % 250}`), 0,
    'preguntar por una cuenta ajena no puede dejarla cerrada a ella');
  intentos.acierto(null, desde);
});

test('y con RUT sigue contando por los dos lados, como siempre', () => {
  const desde = `1.2.4.${process.pid % 250}`;
  const rut = `8888${process.pid % 1000}-1`;
  for (let i = 0; i < 40; i++) intentos.fallo(rut, desde);
  assert.ok(intentos.esperaQueLeFalta(rut, '5.5.5.5') > 0, 'por RUT, desde donde sea');
  assert.ok(intentos.esperaQueLeFalta(null, desde) > 0, 'y por dirección');
  intentos.acierto(rut, desde);
});

test('un RUT en blanco no mete a todos en el mismo saco', () => {
  /**
   * Antes, `llaves('', ip)` devolvía la llave «rut:» para todo el mundo: los
   * fallos sin RUT de personas distintas se sumaban en un solo contador
   * compartido. Ahora sin RUT sencillamente no hay llave de RUT.
   */
  const a = `2.2.2.${process.pid % 250}`;
  const b = `3.3.3.${process.pid % 250}`;
  for (let i = 0; i < 40; i++) intentos.fallo(null, a);
  assert.ok(intentos.esperaQueLeFalta(null, a) > 0);
  assert.equal(intentos.esperaQueLeFalta(null, b), 0,
    'lo que hizo una dirección no puede cerrarle la puerta a otra');
  intentos.acierto(null, a);
});

/* --------------------------------------------------------------------- */
/* El bloqueo que se levanta solo                                         */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: el bloqueo de la recuperación se levanta solo', () => {
  /**
   * Es lo que convierte un encierro permanente —que solo deshacía un
   * administrador— en una molestia de un rato, que es exactamente el trato que
   * el sistema ya le daba a la puerta de entrada.
   */
  const recien = { recuperacion_intentos: 5, recuperacion_bloqueada_en: Date.now(), pregunta_secreta: '¿?' };
  const deAyer = {
    recuperacion_intentos: 5,
    recuperacion_bloqueada_en: Date.now() - (claves.minutosDeBloqueo() + 1) * 60000,
    pregunta_secreta: '¿?',
  };
  assert.equal(claves.estadoRecuperacion(recien).bloqueada, true, 'recién cerrada, cerrada');
  assert.equal(claves.estadoRecuperacion(deAyer).bloqueada, false, 'pasado el rato, se abre sola');
});

test('y mientras está cerrada dice cuánto falta, para no dejar a nadie a ciegas', () => {
  const recien = { recuperacion_intentos: 5, recuperacion_bloqueada_en: Date.now(), pregunta_secreta: '¿?' };
  const estado = claves.estadoRecuperacion(recien);
  assert.ok(estado.minutos_restantes > 0);
  assert.match(estado.aviso_bloqueo, /Vuelva a intentarlo en \d+ minuto/);
  assert.match(estado.aviso_bloqueo, /o pida al administrador/, 'y la salida rápida sigue estando');
});

test('LA QUE SE ME ESCAPÓ: los intentos se SUMAN, o la cuenta no se cierra nunca', async () => {
  /**
   * Escrita después de medirlo. Al hacer que el bloqueo se levantara solo, la
   * primera versión de este arreglo descontaba los intentos anteriores SIEMPRE
   * y no solo cuando un bloqueo previo había expirado: el contador se quedaba
   * en uno para siempre y la cuenta no llegaba a cerrarse nunca. Comprobado
   * contra el sistema andando: doce respuestas erradas seguidas, y las doce
   * contestaban «Le quedan 4 intento(s)».
   *
   * O sea que arreglar el encierro había abierto algo peor: la respuesta
   * secreta se podía probar sin límite. Las dos cosas tienen que valer a la
   * vez —que se sume, y que un bloqueo ya levantado no arrastre—.
   */
  const id = Number(db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(unRutDePrueba(), 'Ana Para Los Intentos').lastInsertRowid);
  await claves.guardarPregunta(id, '¿Su mascota?', 'firulais');

  const comoEsta = () => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  for (let i = 1; i <= claves.INTENTOS_MAXIMOS; i++) {
    const antes = comoEsta();
    assert.equal(claves.estadoRecuperacion(antes).bloqueada, false, `al intento ${i} todavía no`);
    await claves.respuestaCorrecta(antes, 'no es');
    assert.equal(comoEsta().recuperacion_intentos, i, `al intento ${i} tiene que llevar ${i}`);
  }
  assert.equal(claves.estadoRecuperacion(comoEsta()).bloqueada, true,
    `a los ${claves.INTENTOS_MAXIMOS} tiene que cerrarse`);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
});

test('y el «le quedan N intentos» dice el número de verdad', async () => {
  /**
   * También escrita después de medirlo: al hacer que el estado no arrastrara
   * los intentos viejos, el aviso pasó a decir «le quedan 4» SIEMPRE, las cinco
   * veces. Es el número que le dice a quien está recuperando su contraseña que
   * pare antes de quedarse fuera, así que tiene que bajar de verdad.
   */
  const id = Number(db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(unRutDePrueba(), 'Ana Que Cuenta').lastInsertRowid);
  await claves.guardarPregunta(id, '¿Su mascota?', 'firulais');
  const traer = () => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

  const vistos = [];
  for (let i = 0; i < claves.INTENTOS_MAXIMOS; i++) {
    const u = traer();
    const e = claves.estadoRecuperacion(u);
    vistos.push(e.maximo - e.intentos);
    await claves.respuestaCorrecta(u, 'no es');
  }
  assert.deepEqual(vistos, [5, 4, 3, 2, 1], `el aviso tiene que ir bajando, y fue ${vistos.join(', ')}`);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
});

test('y acertar limpia la cuenta, como siempre', async () => {
  const id = Number(db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(unRutDePrueba(), 'Ana Que Acierta').lastInsertRowid);
  await claves.guardarPregunta(id, '¿Su mascota?', 'firulais');
  const traer = () => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  await claves.respuestaCorrecta(traer(), 'no es');
  await claves.respuestaCorrecta(traer(), 'tampoco');
  assert.equal(traer().recuperacion_intentos, 2);
  assert.equal(await claves.respuestaCorrecta(traer(), 'Firulais'), true, 'sin distinguir mayúsculas');
  assert.equal(traer().recuperacion_intentos, 0);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
});

test('los intentos viejos no se arrastran: pasado el rato, se empieza de cero', () => {
  /**
   * Sin esto, la cuenta que se desbloqueó sola volvería a cerrarse al primer
   * error del mes siguiente, porque el contador seguiría en cinco.
   */
  const deAyer = {
    recuperacion_intentos: 5,
    recuperacion_bloqueada_en: Date.now() - (claves.minutosDeBloqueo() + 1) * 60000,
  };
  assert.equal(claves.estadoRecuperacion(deAyer).intentos, 0,
    'los intentos de un bloqueo ya levantado no cuentan');
});

test('el bloqueo dura lo que diga la configuración, no un número escrito a mano', () => {
  const minutos = claves.minutosDeBloqueo();
  assert.ok(minutos >= 4 && minutos <= 480, `dura ${minutos} minutos, que no es un rato razonable`);
});

test('sin bloqueo, la recuperación está abierta y no dice nada de esperas', () => {
  const limpia = { recuperacion_intentos: 0, pregunta_secreta: '¿El nombre de su mascota?' };
  const estado = claves.estadoRecuperacion(limpia);
  assert.equal(estado.bloqueada, false);
  assert.equal(estado.aviso_bloqueo, null);
  assert.equal(estado.pregunta, '¿El nombre de su mascota?');
});

/* --------------------------------------------------------------------- */
/* La misma respuesta exista o no la cuenta                               */
/* --------------------------------------------------------------------- */

test('LA OTRA QUE IMPORTA: las dos puertas contestan lo mismo exista o no la cuenta', () => {
  /**
   * Se mira el archivo porque lo que se comprueba es que el TEXTO sea uno solo
   * y se use en los dos casos: el que no existe y el que existe sin pregunta.
   * Que de verdad se conteste igual lo prueba la suite de aislamiento, que
   * corre las dos rutas contra el sistema andando.
   */
  const fs = require('fs');
  const path = require('path');
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'auth.js'), 'utf8');

  assert.match(auth, /const PORACANOSEPUEDE = '[^']+'/, 'el aviso tiene que estar escrito una sola vez');
  const cuantas = (auth.match(/PORACANOSEPUEDE/g) || []).length;
  assert.ok(cuantas >= 3, `se esperaba el mismo aviso en las dos rutas, y aparece ${cuantas} vez/veces`);

  // Y los dos textos que lo delataban ya no están
  assert.ok(!auth.includes('No hay una cuenta activa con ese RUT'),
    'ese aviso decía que el RUT no tiene cuenta');
  assert.ok(!auth.includes('Esa cuenta no tiene pregunta de recuperación. Pida'),
    'y este, que sí la tiene');
});

test('las dos rutas de recuperación pasan por el portero antes de mirar nada', () => {
  const fs = require('fs');
  const path = require('path');
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'auth.js'), 'utf8');
  for (const ruta of ["router.post('/recuperar/pregunta'", "router.post('/recuperar'"]) {
    const desde = auth.indexOf(ruta);
    assert.ok(desde > 0, `no está la ruta ${ruta}`);
    const cuerpo = auth.slice(desde, desde + 1600);
    assert.match(cuerpo, /elPorteroDeLaRecuperacion\(req, res\)/, `${ruta} tiene que pasar por el portero`);
  }
  // Y preguntar cuenta, que si no el portero no frenaría nada
  const preguntar = auth.slice(auth.indexOf("router.post('/recuperar/pregunta'"));
  assert.match(preguntar.slice(0, 1600), /intentos\.fallo\(null, req\.ip\)/,
    'cada pregunta tiene que contar, contra la dirección y no contra la cuenta');
});

test('y recuperar bien le perdona a esa cuenta lo suyo', () => {
  /*
   * ESTO CAMBIÓ EN LA v1.418.0, a propósito.
   *
   * Esta prueba decía «perdona las preguntas que costó llegar hasta ahí», y era
   * cierto: `acierto` borraba la llave de la cuenta Y la de la dirección. Pero
   * borrar la de la dirección resultó ser el hallazgo AU-04 —una entrada
   * legítima le limpiaba los errores a todos los demás intentos hechos desde
   * ese mismo lugar, y con una cuenta propia cualquiera se apagaba el conteo
   * por dirección a voluntad—.
   *
   * Ahora se perdona lo de ESA cuenta. Las preguntas se cuentan solo por
   * dirección —a propósito: contarlas contra el RUT preguntado dejaría cerrada
   * una cuenta ajena—, así que no hay a quién atribuírselas y se quedan
   * contadas. Son una o dos, y el tope por dirección es ancho.
   */
  const fs = require('fs');
  const path = require('path');
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'auth.js'), 'utf8');
  // La ruta de recuperar, no la de cambiar-password: las dos ponen una clave
  // nueva con la misma línea, y solo una de ellas le habla al portero.
  const laRuta = auth.slice(auth.indexOf("router.post('/recuperar',"));
  assert.ok(laRuta.length > 400, 'se encontró la ruta de recuperación');
  assert.match(laRuta, /intentos\.acierto\(rut, req\.ip\)/,
    'al recuperar bien se le perdona a esa cuenta lo que erró');

  // Y la conducta, que es lo que de verdad importa
  const desde2 = `7.3.2.${process.pid % 250}`;
  const suyo = unRutDePrueba();
  for (let i = 0; i < 3; i++) intentos.fallo(suyo, desde2);   // erró su clave tres veces
  intentos.fallo(null, desde2);                                // y preguntó una vez
  intentos.acierto(suyo, desde2);
  assert.equal(intentos.esperaQueLeFalta(suyo, desde2), 0, 'su cuenta queda limpia');
  const base = require('../../server/ajustes').numero('acceso_intentos', 3, 20) * 4;
  assert.equal(intentos.intentosQueLeQuedan(null, desde2), base - 1,
    'y de la dirección se van sus tres errores; la pregunta anónima se queda contada');
});

test('y el aviso de «se agotaron» dice que la puerta se abre sola', () => {
  /**
   * Decía solo «pida al administrador que le restablezca la contraseña», que
   * era cierto cuando el bloqueo era para siempre. Ahora se levanta solo, y
   * mandar a molestar a alguien por algo que se arregla esperando es peor que
   * no decir nada.
   */
  const fs = require('fs');
  const path = require('path');
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'auth.js'), 'utf8');
  const desde = auth.indexOf('se agotaron los intentos');
  assert.ok(desde > 0);
  const trozo = auth.slice(desde - 400, desde + 400);
  assert.match(trozo, /minutosDeBloqueo\(\)/, 'tiene que decir cuántos minutos, no un número escrito a mano');
  assert.match(trozo, /puede volver a intentarlo/);
  assert.match(trozo, /o pedirle al/, 'y la salida rápida del administrador sigue ofreciéndose');
});

/* --------------------------------------------------------------------- */
/* Lo que no cambia                                                       */
/* --------------------------------------------------------------------- */

test('el desbloqueo a mano del administrador sigue estando, y limpia las dos cosas', () => {
  /**
   * Sirve para quien no quiere esperar. Si limpiara solo el contador y no la
   * marca del momento, la cuenta seguiría cerrada hasta que pasara el rato.
   */
  const fs = require('fs');
  const path = require('path');
  const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'claves.js'), 'utf8');
  const desde = fuente.indexOf('function desbloquearRecuperacion');
  const cuerpo = fuente.slice(desde, fuente.indexOf('\n}', desde));
  assert.match(cuerpo, /recuperacion_intentos = 0/);
  assert.match(cuerpo, /recuperacion_bloqueada_en = NULL/);
});

test('la cuenta guarda cuándo se cerró, que es de donde sale el rato', () => {
  const def = require('../../server/modules/usuarios');
  const campo = def.fields.find((f) => f.name === 'recuperacion_bloqueada_en');
  assert.ok(campo, 'falta el campo donde se anota cuándo se cerró');
  assert.equal(campo.oculto, true, 'no se escribe a mano: lo pone el sistema');
});
