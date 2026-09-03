/**
 * Las tres guardias de la cuenta que nadie estaba cuidando.
 *
 * Son tres promesas que el sistema hace por escrito, las tres bien resueltas,
 * y en la revisión de la v1.316.0 las tres se borraron una por una sin que la
 * suite entera —motor, seguridad y aislamiento— se pusiera roja:
 *
 *   1. UNA CONTRASEÑA QUE OTRO CONOCE NO ES SUYA. La que pone el administrador
 *      —escrita a mano o la inicial del sistema— obliga a cambiarla al entrar,
 *      y hasta entonces la cuenta no sirve para nada más.
 *   2. QUIEN YA NO ENTRA, NO SIGUE ADENTRO. Desactivar una cuenta no espera a
 *      que su dueño cierre la sesión: el pase que ya tenía en la mano deja de
 *      servir en la petición siguiente.
 *   3. LA RESPUESTA DE RECUPERACIÓN VA CIFRADA. Con ella se restablece la
 *      contraseña desde la pantalla de acceso, sin sesión: es una segunda
 *      llave de la casa y no puede quedar escrita en claro en la base.
 *
 * Las tres se parecen en lo mismo: NO SE VEN. Un permiso mal dado se nota
 * porque alguien hace algo que no debía; esto, no. La cuenta de quien se fue
 * sigue funcionando en silencio, la contraseña que el administrador conoce
 * sigue siendo la de la persona, y la respuesta secreta queda a la vista de
 * quien pueda mirar la base. Nada se rompe, nada avisa.
 *
 * Cada una va con su contracara, que es lo que impide «arreglarlas» cerrándolo
 * todo: quien cambió su contraseña entra normal, la cuenta reactivada vuelve a
 * servir, y la respuesta cifrada se puede seguir comprobando.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const claves = require('../../server/claves');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `guardias-${process.pid}`;
const LA_QUE_PONE_EL_ADMINISTRADOR = 'Trueno.Lluvia.9127';
const LA_SUYA_PROPIA = 'Camino.Angosto.4483';

let siguiente = 0;
function unRut() {
  const n = 21800000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/**
 * La puerta de entrada, andando aparte: el arnés del motor monta el router de
 * los módulos y nada más, y estas tres guardias viven en el de acceso.
 */
const express = require('express');
const { router: rutasDeAcceso } = require('../../server/auth');

let servidorDeLaPuerta = null;
let laPuerta = null;
async function laPuertaDeEntrada() {
  if (laPuerta) return laPuerta;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', rutasDeAcceso);
  servidorDeLaPuerta = app.listen(0, '127.0.0.1');
  await new Promise((listo) => servidorDeLaPuerta.once('listening', listo));
  const puerto = servidorDeLaPuerta.address().port;
  laPuerta = async (metodo, ruta, cuerpo, pase) => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/auth${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(pase ? { Authorization: `Bearer ${pase}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    return { estado: r.status, texto, json };
  };
  return laPuerta;
}
test.after(() => { if (servidorDeLaPuerta) servidorDeLaPuerta.close(); });

async function unaCuenta(api, comoSeLlama, extras = {}) {
  const rut = unRut();
  const r = await api('POST', '/usuarios', { rut, nombre: `${comoSeLlama} ${M}`, rol: 'consulta', ...extras });
  assert.equal(r.estado, 201, `guardia: la cuenta tiene que entrar: ${r.texto.slice(0, 300)}`);
  return r.json;
}

const comoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

/* --------------------------------------------------------------------- */
/* 1 · Una contraseña que otro conoce no es suya                          */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: con la contraseña del administrador, la cuenta no sirve para nada más', async () => {
  /**
   * Es la guardia que hace que las otras dos tengan sentido. Mientras la
   * contraseña sea la que otro escribió, esa persona puede entrar como su
   * dueño: la cuenta queda abierta para pedir una sola cosa —cambiarla— y
   * cerrada para todo el resto. Y se comprueba en el servidor, no en la
   * pantalla: quien escriba la dirección a mano se encuentra lo mismo.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Recién creada', { password: LA_QUE_PONE_EL_ADMINISTRADOR });
  assert.equal(comoQuedo(ella.id).debe_cambiar_password, 1, 'guardia: queda marcada');

  /*
   * Se golpea una puerta que a esta cuenta LE TOCA —el rol «consulta» ve los
   * miembros y no ve Usuarios—, para que el 403 sea el de la contraseña y no
   * el de los permisos, que dirían lo mismo por razones distintas.
   */
  const suya = comoOtroUsuario(ella.id);
  const r = await suya('GET', '/miembros');
  assert.equal(r.estado, 403, `se esperaba la puerta cerrada y llegó ${r.estado}`);
  assert.equal(r.json.cambiar_password, true, 'y se dice por qué, para que la pantalla lo resuelva');
  assert.match(r.json.error, /cambie su contraseña/i);
});

test('y la inicial del sistema obliga igual: no es de quien la recibe', async () => {
  /**
   * Al crear una cuenta sin escribir contraseña se entrega la inicial, que es
   * la misma para todos y está escrita en la Configuración. Si esa no obligara
   * a cambiarla, cualquiera que conozca la inicial entra en cualquier cuenta
   * recién creada.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Sin contraseña escrita');
  const fila = comoQuedo(ella.id);
  assert.equal(fila.debe_cambiar_password, 1);
  assert.equal(fila.password_origen, 'inicial', 'y queda dicho de dónde salió');
});

test('la escrita a mano queda anotada como tal, que no es lo mismo', async () => {
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Con contraseña escrita', { password: LA_QUE_PONE_EL_ADMINISTRADOR });
  assert.equal(comoQuedo(ella.id).password_origen, 'definida');
});

test('LA CONTRACARA: cambiándola por una suya, el sistema se abre', async () => {
  /**
   * Sin esto la guardia sería una cuenta inservible. Y hay un detalle que se
   * comprueba acá: para cambiarla NO se le pide la actual, porque la actual la
   * sabe el administrador y pedírsela no protege nada.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Quien la cambia', { password: LA_QUE_PONE_EL_ADMINISTRADOR });
  const puerta = await laPuertaDeEntrada();

  const entrada = await puerta('POST', '/login', { rut: ella.rut, password: LA_QUE_PONE_EL_ADMINISTRADOR });
  assert.equal(entrada.estado, 200, `guardia: con la que le dieron sí entra: ${entrada.texto.slice(0, 200)}`);
  assert.equal(entrada.json.user.debe_cambiar_password, true, 'y la pantalla se entera');

  const cambio = await puerta('POST', '/cambiar-password', { nueva: LA_SUYA_PROPIA }, entrada.json.token);
  assert.equal(cambio.estado, 200, `tenía que poder cambiarla: ${cambio.texto.slice(0, 200)}`);
  assert.equal(cambio.json.user.debe_cambiar_password, false);

  const fila = comoQuedo(ella.id);
  assert.equal(fila.debe_cambiar_password, 0);
  assert.equal(fila.password_origen, 'usuario', 'y ahora la contraseña es suya');

  const abierto = await comoOtroUsuario(ella.id)('GET', '/miembros');
  assert.equal(abierto.estado, 200, `el sistema tenía que abrirse: ${abierto.texto.slice(0, 200)}`);
});

test('y la nueva no puede ser la misma que le dieron', async () => {
  /**
   * La otra mitad de la promesa: cambiarla por la misma no la cambia, y la
   * seguiría sabiendo quien se la entregó.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Quien no la cambia', { password: LA_QUE_PONE_EL_ADMINISTRADOR });
  const puerta = await laPuertaDeEntrada();
  const pase = (await puerta('POST', '/login', { rut: ella.rut, password: LA_QUE_PONE_EL_ADMINISTRADOR })).json.token;

  const r = await puerta('POST', '/cambiar-password', { nueva: LA_QUE_PONE_EL_ADMINISTRADOR }, pase);
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /distinta de la actual/);
  assert.equal(comoQuedo(ella.id).debe_cambiar_password, 1, 'y la cuenta sigue obligada');
});

/* --------------------------------------------------------------------- */
/* 2 · Quien ya no entra, no sigue adentro                                */
/* --------------------------------------------------------------------- */

test('LA QUE SE ESCAPABA: desactivar una cuenta deja fuera al pase que ya estaba en la mano', async () => {
  /**
   * Esta es la que de verdad importa de las tres. Cerrarle la entrada a quien
   * se fue no sirve de nada si quien ya entró sigue trabajando hasta que se le
   * ocurra cerrar la sesión: un pase dura horas, y el motivo de desactivar una
   * cuenta suele ser justamente que esa persona no debe seguir mirando.
   *
   * Por eso el pase no se cree a sí mismo: en CADA petición se va a buscar la
   * cuenta a la base y se mira cómo está ahora.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Quien se va');
  // Con la marca de «cambie su contraseña» puesta, la cuenta contestaría 403
  // por la otra guardia y esta prueba no probaría nada
  db.prepare('UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?').run(ella.id);
  const suya = comoOtroUsuario(ella.id);

  assert.equal((await suya('GET', '/miembros')).estado, 200, 'guardia: estando activa, trabaja');

  const baja = await api('PUT', `/usuarios/${ella.id}`,
    { ...ella, debe_cambiar_password: 0, activo: 0, igual_asi: true });
  assert.equal(baja.estado, 200, `guardia: la baja tiene que guardarse: ${baja.texto.slice(0, 200)}`);

  const despues = await suya('GET', '/miembros');
  assert.equal(despues.estado, 401, `el mismo pase tenía que dejar de servir y llegó ${despues.estado}`);
  assert.match(despues.json.error, /inactivo/i);
});

test('ni entra de nuevo por la puerta', async () => {
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Quien vuelve a tocar', { password: LA_QUE_PONE_EL_ADMINISTRADOR });
  await api('PUT', `/usuarios/${ella.id}`, { ...ella, activo: 0, igual_asi: true });
  const puerta = await laPuertaDeEntrada();

  const r = await puerta('POST', '/login', { rut: ella.rut, password: LA_QUE_PONE_EL_ADMINISTRADOR });
  assert.equal(r.estado, 403, `se esperaba la puerta cerrada y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /inactivo/i);
});

test('LA CONTRACARA: reactivada, la misma cuenta vuelve a servir', async () => {
  /**
   * Desactivar es una medida reversible a propósito —una licencia, un permiso,
   * una persona que vuelve— y por eso no se borra la cuenta. Si reactivar no
   * devolviera el acceso, la baja sería un borrado disfrazado.
   */
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Quien vuelve');
  const suya = comoOtroUsuario(ella.id);
  /*
   * `debe_cambiar_password: 0` va en cada guardado a propósito: la cuenta nace
   * marcada, y lo que se está mirando acá es el activo. Sin esto, el guardado
   * le devuelve la marca y la cuenta contesta 403 por la OTRA guardia, que ya
   * tiene sus pruebas más arriba.
   */
  const yaLaCambio = { debe_cambiar_password: 0 };
  await api('PUT', `/usuarios/${ella.id}`, { ...ella, ...yaLaCambio, activo: 0, igual_asi: true });
  assert.equal((await suya('GET', '/miembros')).estado, 401, 'guardia: quedó fuera');

  // Se vuelve a leer la ficha: la baja le cambió la versión, y guardar la que
  // se tenía en la mano chocaría con el aviso de «otra persona guardó»
  const dadaDeBaja = (await api('GET', `/usuarios/${ella.id}`)).json;
  const alta = await api('PUT', `/usuarios/${ella.id}`, { ...dadaDeBaja, ...yaLaCambio, activo: 1 });
  assert.equal(alta.estado, 200, alta.texto.slice(0, 200));
  assert.equal((await suya('GET', '/miembros')).estado, 200, 'el mismo pase tiene que volver a servir');
});

/* --------------------------------------------------------------------- */
/* 3 · La respuesta de recuperación va cifrada                            */
/* --------------------------------------------------------------------- */

test('LA TERCERA: la respuesta de recuperación no queda escrita en claro', async () => {
  /**
   * Con esta respuesta se restablece la contraseña desde la pantalla de
   * acceso, SIN SESIÓN: es una segunda llave de la misma casa. Guardada en
   * claro, cualquiera con acceso a la base —o a un respaldo, que se baja
   * entero desde el sistema— entra en cualquier cuenta que tenga pregunta
   * puesta, sin dejar rastro de nada.
   */
  await elSistemaAndando();
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Con recuperación');

  const problema = await claves.guardarPregunta(ella.id, '¿Cómo se llamaba su primera profesora?', 'Marta Elena');
  assert.equal(problema, null, `guardia: tenía que guardarse: ${problema}`);

  const guardada = comoQuedo(ella.id).respuesta_secreta;
  assert.ok(guardada, 'guardia: algo quedó guardado');
  assert.ok(!guardada.includes('Marta Elena'), 'no está tal como se escribió');
  assert.ok(!guardada.toLowerCase().includes('marta'), 'ni en minúsculas, que es como se compara');
  assert.match(guardada, /^\$2[aby]\$\d\d\$/, 'está cifrada, y con el mismo cuidado que una contraseña');
});

test('y aun así se puede comprobar: cifrar no sirve si después no se reconoce', async () => {
  /**
   * La contracara. Una respuesta cifrada que no se pueda comprobar deja a su
   * dueño sin la puerta de recuperación, que es justo lo contrario de lo que
   * se quería.
   */
  await elSistemaAndando();
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Que se comprueba');
  await claves.guardarPregunta(ella.id, '¿Su primera profesora?', 'Marta Elena');

  assert.equal(await claves.respuestaCorrecta(comoQuedo(ella.id), 'Marta Elena'), true);
  assert.equal(await claves.respuestaCorrecta(comoQuedo(ella.id), '  MARTA   elena '), true,
    'sin distinguir mayúsculas ni espacios de más: nadie recuerda cómo la escribió hace un año');
  assert.equal(await claves.respuestaCorrecta(comoQuedo(ella.id), 'Marta Elena Rojas'), false,
    'pero parecida no es la misma');
  assert.equal(await claves.respuestaCorrecta(comoQuedo(ella.id), 'otra cosa'), false);
});

test('dos personas con la misma respuesta la guardan distinta', async () => {
  /**
   * Es lo que se gana cifrándola con sal y no resumiéndola a secas: quien mire
   * la base no puede ni siquiera darse cuenta de que dos cuentas contestan lo
   * mismo, que es por donde se empieza a adivinar.
   */
  const api = await elSistemaAndando();
  const una = await unaCuenta(api, 'Una que contesta');
  const otra = await unaCuenta(api, 'Otra que contesta igual');
  await claves.guardarPregunta(una.id, '¿Su ciudad?', 'Puerto Montt');
  await claves.guardarPregunta(otra.id, '¿Su ciudad?', 'Puerto Montt');

  assert.notEqual(comoQuedo(una.id).respuesta_secreta, comoQuedo(otra.id).respuesta_secreta);
  assert.equal(await claves.respuestaCorrecta(comoQuedo(una.id), 'Puerto Montt'), true, 'y las dos siguen sirviendo');
  assert.equal(await claves.respuestaCorrecta(comoQuedo(otra.id), 'Puerto Montt'), true);
});

test('quitarla la borra de verdad, y no deja el rastro cifrado', async () => {
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, 'Que se arrepiente');
  await claves.guardarPregunta(ella.id, '¿Su ciudad?', 'Puerto Montt');
  assert.ok(comoQuedo(ella.id).respuesta_secreta, 'guardia: estaba puesta');

  claves.quitarPregunta(ella.id);
  const fila = comoQuedo(ella.id);
  assert.equal(fila.respuesta_secreta, null);
  assert.equal(fila.pregunta_secreta, null);
  assert.equal(await claves.respuestaCorrecta(fila, 'Puerto Montt'), false, 'y ya no abre nada');
});
