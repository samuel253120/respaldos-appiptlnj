/**
 * El resumen de la contraseña nunca sale al navegador.
 *
 * De todo el sistema, esta es la línea más cara por carácter:
 *
 *     if (f.type === 'password') delete out[f.name];        (server/crud.js)
 *     const { password, respuesta_secreta, ...rest } = u;   (server/auth.js)
 *
 * Dos líneas, y son lo único que separa el resumen bcrypt de las contraseñas
 * de cualquiera que pueda mirar una respuesta del sistema. En la revisión de
 * la v1.316.0 se comprobó lo que faltaba: BORRANDO «password» DE LA SEGUNDA,
 * el motor, la suite de seguridad y la de aislamiento seguían las tres en
 * verde. Nada se habría enterado.
 *
 * Y el daño no sería el de un dato mal escrito. Un resumen bcrypt en manos de
 * cualquiera se prueba sin conexión, todo el tiempo que haga falta, contra un
 * diccionario: sin puerta que se cierre a los cinco intentos, sin registro que
 * lo anote y sin que nadie pueda saber que está pasando. Y la contraseña que
 * salga de ahí es la de una persona que probablemente use la misma en otras
 * partes.
 *
 * NO ES UNA PRUEBA DE UNA PUERTA, SINO DE TODAS. El motor tiene una sola línea
 * porque todas sus salidas pasan por el mismo sitio —`expandRow`—: el listado,
 * la ficha, la planilla que se baja a Excel, la respuesta del guardado y hasta
 * el aviso de «otra persona guardó mientras usted lo tenía abierto», que
 * devuelve la ficha entera. Acá se golpean las cinco, una por una, y también
 * la de la sesión, que es la otra línea.
 *
 * La contracara está al final, y hace falta: esto no se «arregla» borrándolo
 * todo. La ficha tiene que seguir trayendo el nombre, el RUT y el rol.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

/**
 * La puerta de entrada, andando aparte.
 *
 * El arnés del motor monta el router de los módulos y nada más, así que las
 * rutas de acceso —donde vive la otra línea que se está cuidando— contestarían
 * 404. Se levanta acá, con el mismo router que usa el servidor.
 */
const express = require('express');
const { router: rutasDeAcceso } = require('../../server/auth');
const LA_CLAVE = 'Trueno.Lluvia.9127';

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
      headers: {
        'Content-Type': 'application/json',
        ...(pase ? { Authorization: `Bearer ${pase}` } : {}),
      },
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

const M = `clave-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 21700000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/**
 * Cómo se reconoce un resumen bcrypt: empieza por $2a$, $2b$ o $2y$ y sigue el
 * costo. No se busca «la clave de esta cuenta» sino CUALQUIERA, así que la
 * prueba también atrapa el resumen de otra persona que se colara de rebote.
 */
const HUELLA_DE_BCRYPT = /\$2[aby]\$\d\d\$/;

/** Una cuenta con su contraseña puesta a mano, y el resumen que quedó guardado. */
async function unaCuentaConClave(api, comoSeLlama) {
  const rut = unRut();
  const r = await api('POST', '/usuarios', {
    rut, nombre: `${comoSeLlama} ${M}`, rol: 'consulta', password: LA_CLAVE,
  });
  assert.equal(r.estado, 201, `guardia: la cuenta tiene que entrar: ${r.texto.slice(0, 300)}`);
  const guardado = db.prepare('SELECT password FROM usuarios WHERE id = ?').get(r.json.id).password;
  assert.match(guardado, HUELLA_DE_BCRYPT,
    'guardia: sin un resumen guardado de verdad, esta prueba no estaría probando nada');
  return { ...r.json, resumen: guardado, respuesta: r };
}

/* --------------------------------------------------------------------- */
/* Las cinco salidas del motor                                            */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: al guardar la cuenta, la respuesta no trae el resumen', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Recién guardada');

  assert.equal(cuenta.password, undefined, 'el campo no viene');
  assert.doesNotMatch(cuenta.respuesta.texto, HUELLA_DE_BCRYPT, 'y no viene escondido en ningún otro');
  assert.ok(!cuenta.respuesta.texto.includes(cuenta.resumen));
});

test('ni la ficha que se abre para mirarla', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Ficha mirada');

  const r = await api('GET', `/usuarios/${cuenta.id}`);
  assert.equal(r.estado, 200);
  assert.equal(r.json.password, undefined);
  assert.doesNotMatch(r.texto, HUELLA_DE_BCRYPT);
});

test('ni el listado, que trae muchas de una vez', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Listada');

  const r = await api('GET', `/usuarios?q=${encodeURIComponent(cuenta.rut)}`);
  assert.equal(r.estado, 200);
  assert.ok(r.json.rows.some((u) => Number(u.id) === Number(cuenta.id)), 'guardia: la cuenta sale en el listado');
  assert.doesNotMatch(r.texto, HUELLA_DE_BCRYPT);
});

test('ni la planilla que se baja a Excel', async () => {
  /**
   * Esta es la salida que más se olvida: no se ve en pantalla, se abre después
   * en otro programa y queda en la carpeta de descargas de quien la bajó.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Planillada');

  const r = await api('GET', `/usuarios/planilla?q=${encodeURIComponent(cuenta.rut)}`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.ok(r.texto.includes(cuenta.rut), 'guardia: la cuenta tiene que estar en la planilla');
  assert.doesNotMatch(r.texto, HUELLA_DE_BCRYPT);
  assert.ok(!r.texto.includes(cuenta.resumen));
});

test('ni el aviso de «otra persona guardó mientras usted lo tenía abierto»', async () => {
  /**
   * Este devuelve LA FICHA ENTERA —«revise cómo quedó»— y por eso es una
   * salida como cualquier otra. Se provoca de verdad: se guarda una vez, y se
   * vuelve a guardar con la versión vieja.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'En conflicto');

  const abierta = (await api('GET', `/usuarios/${cuenta.id}`)).json;
  assert.equal((await api('PUT', `/usuarios/${cuenta.id}`, { ...abierta, telefono: '+56911110000' })).estado, 200);

  const r = await api('PUT', `/usuarios/${cuenta.id}`, { ...abierta, telefono: '+56922220000' });
  assert.equal(r.estado, 409, `guardia: tenía que chocar y llegó ${r.estado}`);
  assert.equal(r.json.conflicto, true);
  assert.ok(r.json.actual, 'guardia: el aviso trae la ficha entera');
  assert.equal(r.json.actual.password, undefined);
  assert.doesNotMatch(r.texto, HUELLA_DE_BCRYPT);
});

/* --------------------------------------------------------------------- */
/* La otra línea: la sesión, entrando de verdad                           */
/* --------------------------------------------------------------------- */

/**
 * `publicUser` arma el usuario que viaja al entrar, el que contesta «/auth/me»
 * y el que queda en `req.user` durante toda la petición. Es la línea que se
 * borró en la prueba de la revisión sin que nada se pusiera rojo.
 *
 * Acá no se la llama a mano: se levanta la PUERTA DE ENTRADA de verdad —el
 * router de acceso del sistema, que el arnés del motor no monta— y se entra
 * con un RUT y una contraseña, como entra cualquiera. Lo que se mira es lo que
 * le llega al navegador.
 */
test('LA QUE SE ESCAPABA: entrando de verdad, la sesión que llega no lleva el resumen', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Quien entra');
  const puerta = await laPuertaDeEntrada();

  const entrada = await puerta('POST', '/login', { rut: cuenta.rut, password: LA_CLAVE });
  assert.equal(entrada.estado, 200, `guardia: tenía que poder entrar: ${entrada.texto.slice(0, 200)}`);
  assert.ok(entrada.json.token, 'guardia: y recibir su pase');

  assert.equal(entrada.json.user.password, undefined, 'el resumen de la contraseña no viaja');
  assert.doesNotMatch(entrada.texto, HUELLA_DE_BCRYPT, 'ni escondido en ningún otro campo');
  assert.ok(!entrada.texto.includes(cuenta.resumen));
});

test('ni la trae «quién soy», que la pantalla pide en cada recarga', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Quien recarga');
  const puerta = await laPuertaDeEntrada();
  const pase = (await puerta('POST', '/login', { rut: cuenta.rut, password: LA_CLAVE })).json.token;

  const yo = await puerta('GET', '/me', undefined, pase);
  assert.equal(yo.estado, 200, yo.texto.slice(0, 200));
  assert.equal(yo.json.user.id, cuenta.id, 'guardia: es esta cuenta');
  assert.equal(yo.json.user.password, undefined);
  assert.doesNotMatch(yo.texto, HUELLA_DE_BCRYPT);
});

test('y lo que sí lleva es lo que la pantalla necesita', async () => {
  /**
   * La contracara. Esto no se «arregla» devolviendo un objeto vacío: la
   * pantalla necesita saber quién entró, si tiene que cambiar la contraseña
   * antes de seguir, y si tiene puesta una pregunta de recuperación —el sí o
   * el no, nunca la respuesta—.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Contracara de la sesión');
  await require('../../server/claves').guardarPregunta(cuenta.id, '¿Su primera profesora?', 'Marta Elena');
  const puerta = await laPuertaDeEntrada();

  const { json, texto } = await puerta('POST', '/login', { rut: cuenta.rut, password: LA_CLAVE });
  assert.equal(json.user.nombre, `Contracara de la sesión ${M}`);
  assert.equal(json.user.rut, cuenta.rut);
  assert.equal(json.user.rol, 'consulta');
  assert.equal(json.user.debe_cambiar_password, true, 'y como sí o no, no como 1');
  assert.equal(json.user.tiene_pregunta_secreta, true, 'se dice que la tiene…');
  assert.equal(json.user.respuesta_secreta, undefined, '…sin decir cuál es la respuesta');
  assert.ok(!texto.includes('Marta Elena'));
});

/* --------------------------------------------------------------------- */
/* La respuesta de recuperación, que es el otro secreto de la cuenta      */
/* --------------------------------------------------------------------- */

/**
 * No es la contraseña, pero abre la misma puerta: con ella se restablece la
 * clave desde la pantalla de acceso, sin sesión. Va guardada cifrada y sale
 * por la misma línea del motor, así que se comprueba en el mismo sitio.
 */
test('la respuesta de recuperación tampoco sale por ninguna de las salidas', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Con recuperación');
  const claves = require('../../server/claves');
  await claves.guardarPregunta(cuenta.id, '¿Cómo se llamaba su primera profesora?', 'Marta Elena');

  const guardada = db.prepare('SELECT respuesta_secreta FROM usuarios WHERE id = ?').get(cuenta.id).respuesta_secreta;
  assert.ok(guardada, 'guardia: quedó guardada');
  assert.ok(!String(guardada).includes('Marta Elena'), 'guardia: y no en claro');

  for (const puerta of [`/usuarios/${cuenta.id}`, `/usuarios?q=${encodeURIComponent(cuenta.rut)}`,
    `/usuarios/planilla?q=${encodeURIComponent(cuenta.rut)}`]) {
    const r = await api('GET', puerta);
    assert.equal(r.estado, 200, `${puerta}: ${r.texto.slice(0, 150)}`);
    assert.ok(!r.texto.includes(guardada), `la respuesta cifrada sale por ${puerta}`);
    assert.ok(!r.texto.includes('Marta Elena'), `la respuesta en claro sale por ${puerta}`);
  }
});

test('y la pantalla que informa del estado de la clave informa, no entrega', async () => {
  /**
   * `/usuarios/:id/clave` existe para que quien administra vea cómo está el
   * acceso de una cuenta: si la contraseña sigue siendo la entregada, cuándo
   * se cambió, si la recuperación está cerrada. Todo eso ES lo que tiene que
   * decir; lo que no puede es traer el resumen de paso.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Estado de clave');

  const r = await api('GET', `/usuarios/${cuenta.id}/clave`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.ok(r.json.clave, 'guardia: sí informa del estado');
  assert.doesNotMatch(r.texto, HUELLA_DE_BCRYPT);
  assert.ok(!r.texto.includes(cuenta.resumen));
});

/* --------------------------------------------------------------------- */
/* La contracara del motor                                                */
/* --------------------------------------------------------------------- */

test('la ficha sigue trayendo lo que hay que ver: nombre, RUT y rol', async () => {
  const api = await elSistemaAndando();
  const cuenta = await unaCuentaConClave(api, 'Contracara');
  const r = await api('GET', `/usuarios/${cuenta.id}`);
  assert.equal(r.json.nombre, `Contracara ${M}`);
  assert.equal(r.json.rut, cuenta.rut);
  assert.equal(r.json.rol, 'consulta');
});
