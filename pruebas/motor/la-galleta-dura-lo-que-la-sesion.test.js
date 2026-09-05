/**
 * LA GALLETA DURABA DOCE HORAS FIJAS AUNQUE LA SESIÓN DURARA TREINTA DÍAS.
 *
 * La duración de la sesión se configura desde la pantalla de Configuración,
 * entre 1 y 720 horas, y el pase la respeta. La galleta que lo acompaña llevaba
 * `12 * 60 * 60 * 1000` escrito a mano y no miraba ese ajuste. De fábrica los
 * dos valen doce horas y coincidían por casualidad.
 *
 * MEDIDO en la v1.416.0, mirando el `Set-Cookie` y el propio pase:
 *
 *   sesion_horas = 12 · de fábrica ..  el pase 12 h   la galleta 12 h
 *   sesion_horas = 720 · el máximo ..  el pase 720 h  la galleta 12 h
 *   sesion_horas = 2 ...............  el pase 2 h    la galleta 12 h
 *
 * Y la galleta no es un detalle: es la ÚNICA credencial de lo que el navegador
 * pide por su cuenta, porque en un `<img src>` no hay dónde poner la cabecera.
 * Comprobado en la misma revisión: `/uploads/…` contesta 401 sin ella y pasa
 * con ella, y `/api/respaldo` igual.
 *
 * Así que con la sesión configurada por encima de doce horas, a las doce horas
 * la persona seguía adentro trabajando y de pronto ninguna foto cargaba, ningún
 * adjunto abría y el respaldo no bajaba, sin un aviso que lo explicara. Es el
 * peor tipo de falla: parece que se rompió el sistema.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const claves = require('../../server/claves');
const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema, elPuerto } = require('./andando');

test.after(() => {
  ajustes.guardar('sesion_horas', '12', null);
  return cerrarElSistema();
});

const CLAVE = 'SuClaveLarga.2026';
let suRut = null;

/** Una cuenta con contraseña de verdad: acá hay que ENTRAR por la puerta. */
async function suCuenta() {
  if (suRut) return suRut;
  const n = `${25900000 + (process.pid % 900000)}`;
  suRut = `${n}-${digitoVerificador(n)}`;
  const quien = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(suRut, `Quien Entra ${process.pid}`).lastInsertRowid;
  await claves.establecer(quien, CLAVE, 'usuario');
  return suRut;
}

/**
 * Lo que entrega la entrada: cuánto dura el pase y cuánto la galleta.
 *
 * Se pide a mano y no con el ayudante del arnés, porque lo que se mira vive en
 * las CABECERAS y el ayudante devuelve solo el cuerpo.
 */
async function loQueEntregaLaEntrada(rut) {
  const r = await fetch(`http://127.0.0.1:${elPuerto()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, password: CLAVE }),
  });
  const cuerpo = await r.json();
  assert.equal(r.status, 200, JSON.stringify(cuerpo));
  const galleta = String(r.headers.get('set-cookie') || '');
  const carga = JSON.parse(Buffer.from(cuerpo.token.split('.')[1], 'base64').toString());
  const maxAge = /Max-Age=(\d+)/i.exec(galleta);
  return {
    pase: (carga.exp - carga.iat) / 3600,
    galleta: maxAge ? Number(maxAge[1]) / 3600 : null,
    cabecera: galleta,
  };
}

test('el pase y la galleta duran lo mismo, valga lo que valga el ajuste', async () => {
  await elSistemaAndando();
  const rut = await suCuenta();
  for (const horas of [12, 720, 2, 48]) {
    ajustes.guardar('sesion_horas', String(horas), null);
    const d = await loQueEntregaLaEntrada(rut);
    assert.equal(d.pase, horas, `con sesion_horas=${horas} el pase tiene que durar ${horas} h`);
    assert.equal(d.galleta, horas,
      `con sesion_horas=${horas} el pase dura ${d.pase} h y la galleta ${d.galleta} h: antes la galleta era siempre 12`);
  }
});

test('y la galleta sigue teniendo sus resguardos', async () => {
  await elSistemaAndando();
  const rut = await suCuenta();
  ajustes.guardar('sesion_horas', '12', null);
  const d = await loQueEntregaLaEntrada(rut);
  assert.match(d.cabecera, /HttpOnly/i, 'ningún programa de la página puede leerla');
  assert.match(d.cabecera, /SameSite=Lax/i, 'no se manda a otros sitios');
  assert.match(d.cabecera, /Path=\//, 'sirve para todo el sitio: los archivos no cuelgan de /api');
});

test('la duración se lee en UN solo sitio', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../../server/auth.js'), 'utf8');
  assert.match(auth, /function horasDeSesion\(\)/, 'hay un solo lugar que lee el ajuste');
  assert.match(auth, /maxAge: horasDeSesion\(\) \* 60 \* 60 \* 1000/, 'y la galleta lo usa');
  assert.match(auth, /return `\$\{horasDeSesion\(\)\}h`;/, 'y el pase también');
  assert.ok(!/maxAge: 12 \* 60 \* 60 \* 1000/.test(auth),
    'ya no hay doce horas escritas a mano');
  assert.equal((auth.match(/ajustes\.numero\('sesion_horas'/g) || []).length, 1,
    'el ajuste se lee una vez: dos lecturas es como se llega a que digan cosas distintas');
});
