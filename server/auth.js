/**
 * Autenticación (JWT) y autorización.
 *
 * - POST /api/auth/login  { email, password } -> { token, user }
 * - GET  /api/auth/me     -> usuario actual
 *
 * El middleware `authRequired` valida el token y carga el usuario en
 * req.user. `requirePerm(module, action)` verifica la matriz de permisos.
 *
 * Alcance por iglesia: si el usuario tiene iglesia_id asignada, solo ve y
 * modifica registros de esa iglesia (los administradores sin iglesia
 * asignada ven todas).
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const intentos = require('./intentos');
const { db } = require('./db');
const { can } = require('./permissions');
const rutUtil = require('./rut');
const ajustes = require('./ajustes');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';

/** Duración de la sesión, configurable desde la pantalla de configuración. */
function duracionSesion() {
  return `${ajustes.numero('sesion_horas', 1, 720)}h`;
}

/**
 * Con el sistema en mantenimiento solo entran los administradores.
 * Devuelve el aviso a mostrar, o null si el paso está permitido.
 */
function bloqueoPorMantenimiento(usuario) {
  if (!ajustes.activo('mantenimiento_activo')) return null;
  if (usuario && usuario.rol === 'admin') return null;
  return ajustes.obtener('mantenimiento_mensaje') || 'El sistema está en mantenimiento.';
}

function publicUser(u) {
  if (!u) return null;
  const { password, respuesta_secreta, ...rest } = u;
  return {
    ...rest,
    debe_cambiar_password: !!u.debe_cambiar_password,
    tiene_pregunta_secreta: !!u.pregunta_secreta,
  };
}

/** Lo único que se permite mientras la contraseña siga siendo la entregada. */
function rutaDeCambio(req) {
  const camino = req.baseUrl + req.path;
  return ['/api/auth/me', '/api/auth/cambiar-password', '/api/auth/pregunta-secreta'].includes(camino);
}

/**
 * La sesión, en una galleta, para lo que el navegador pide solo.
 *
 * El sistema se identifica con un pase que viaja en la cabecera de cada
 * petición, y eso sirve mientras las pide el programa. Pero una foto la pide
 * el navegador por su cuenta —`<img src="/uploads/…">`— y ahí no hay manera de
 * poner esa cabecera. Así que al entrar se deja el mismo pase en una galleta,
 * que el navegador sí adjunta solo, y con ella se atienden los archivos.
 *
 * Va marcada para que no la pueda leer ningún programa de la página, para que
 * no se mande a otros sitios, y —cuando se sirve por HTTPS— para que no viaje
 * nunca en claro.
 */
function ponerGalleta(req, res, token) {
  res.cookie('sesion', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

/**
 * El pase que traiga la petición: por cabecera o en la galleta.
 *
 * Ya no se acepta escrito en la dirección (`?token=…`). Se aceptaba por un
 * solo motivo —el enlace para bajar el respaldo, que es una navegación del
 * navegador y no lleva cabeceras—, pero se aceptaba en TODAS las rutas, y un
 * pase escrito en la dirección queda anotado en los registros del servidor,
 * en el historial del navegador y en cualquier dirección que se comparta.
 * Para ese enlace basta la galleta de sesión, que el navegador manda sola en
 * una navegación del propio sitio.
 */
function paseDe(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7), deGalleta: false };
  const galletas = String(req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  for (const g of galletas) {
    const corte = g.indexOf('=');
    if (corte > 0 && g.slice(0, corte) === 'sesion') {
      return { token: decodeURIComponent(g.slice(corte + 1)), deGalleta: true };
    }
  }
  return { token: null, deGalleta: false };
}

function authRequired(req, res, next) {
  const { token, deGalleta } = paseDe(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(payload.id);
    if (!user || user.activo === 0) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });

    const aviso = bloqueoPorMantenimiento(user);
    if (aviso) return res.status(503).json({ error: aviso, mantenimiento: true });

    // Con la contraseña que le entregó el administrador solo puede hacer una
    // cosa: cambiarla. El resto del sistema queda cerrado hasta entonces, y
    // se comprueba aquí, no en la pantalla.
    if (user.debe_cambiar_password && !rutaDeCambio(req)) {
      return res.status(403).json({
        error: 'Antes de seguir, cambie su contraseña por una suya.',
        cambiar_password: true,
      });
    }

    req.user = publicUser(user);
    // Quien ya estaba trabajando cuando esto se publicó no tiene la galleta:
    // se le deja acá, sin que tenga que volver a entrar.
    if (!deGalleta) ponerGalleta(req, res, token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function requirePerm(moduleName, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!can(req.user, moduleName, action)) {
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    next();
  };
}

const router = express.Router();

/**
 * Envuelve un manejador asíncrono para que un tropiezo no deje la petición
 * colgada esperando: el error va al manejador de errores como cualquier otro.
 */
const atender = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Entrar al sistema.
 *
 * La comprobación de la contraseña se hace de forma asíncrona a propósito.
 * Verificar una clave cifrada cuesta cerca de una décima de segundo de puro
 * cálculo, y el servidor atiende de a una cosa: si se hiciera de corrido, un
 * domingo con veinte personas entrando a la vez, el sistema quedaría trabado
 * casi dos segundos para todos, incluidos los que ya estaban trabajando
 * adentro. Así, ese cálculo se hace por partes y los demás siguen atendidos.
 *
 * Y antes de mirar nada se consulta al portero (server/intentos.js): a los
 * pocos errores seguidos la puerta se cierra un rato, para que no se puedan
 * probar contraseñas a máquina.
 */
router.post('/login', atender(async (req, res) => {
  const body = req.body || {};
  // El identificador de acceso es el RUT. Se acepta también `usuario` o
  // `email` por compatibilidad con clientes anteriores.
  const identificador = String(body.rut || body.usuario || body.email || '').trim();
  const password = body.password;
  if (!identificador || !password) {
    return res.status(400).json({ error: 'RUT y contraseña son requeridos' });
  }

  // Antes de mirar la clave: ¿viene errando demasiado seguido?
  const desde = req.ip;
  const espera = intentos.esperaQueLeFalta(identificador, desde);
  if (espera) {
    return res.status(429).json({
      error:
        `Demasiados intentos fallidos. Espere ${espera} minuto${espera === 1 ? '' : 's'} antes de volver a ` +
        'intentarlo. Si no recuerda su contraseña, use «¿Olvidó su contraseña?».',
    });
  }

  // Búsqueda por RUT normalizado (acepta con o sin puntos y guion).
  let user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(identificador));

  // Respaldo: cuentas creadas antes de usar el RUT todavía pueden entrar con
  // su correo hasta que se les asigne uno.
  if (!user && identificador.includes('@')) {
    user = db.prepare('SELECT * FROM usuarios WHERE lower(email) = lower(?)').get(identificador);
  }

  if (!user || !user.password || !(await bcrypt.compare(String(password), user.password))) {
    intentos.fallo(identificador, desde);
    // No se dice si el RUT existe o no: se responde igual en los dos casos.
    // Lo que sí se dice es cómo va con los intentos, para que quien de verdad
    // se equivocó no se encuentre con la puerta cerrada sin haber sido avisado.
    const cerrada = intentos.esperaQueLeFalta(identificador, desde);
    if (cerrada) {
      return res.status(429).json({
        error:
          `Credenciales incorrectas. Por los intentos seguidos, la entrada queda cerrada ${cerrada} ` +
          `minuto${cerrada === 1 ? '' : 's'}. Si no recuerda su contraseña, use «¿Olvidó su contraseña?».`,
      });
    }
    const quedan = intentos.intentosQueLeQuedan(identificador, desde);
    return res.status(401).json({
      error:
        'Credenciales incorrectas' +
        (quedan && quedan <= 2 ? `. Le queda${quedan === 1 ? '' : 'n'} ${quedan} intento${quedan === 1 ? '' : 's'} antes de que la entrada se cierre un rato` : ''),
    });
  }
  intentos.acierto(identificador, desde);
  if (user.activo === 0) return res.status(403).json({ error: 'El usuario está inactivo' });

  const aviso = bloqueoPorMantenimiento(user);
  if (aviso) return res.status(503).json({ error: aviso, mantenimiento: true });

  const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: duracionSesion() });
  ponerGalleta(req, res, token);
  res.json({ token, user: publicUser(user) });
}));

/** Cerrar sesión: se retira la galleta, para que el navegador deje de mandarla. */
router.post('/salir', (req, res) => {
  res.clearCookie('sesion', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * Cambiar la propia contraseña. Se pide la actual —salvo cuando todavía es la
 * que entregó el administrador y por eso está obligado a cambiarla—, y la
 * nueva tiene que ser distinta: si no, no habría cambiado nada.
 */
router.post('/cambiar-password', authRequired, atender(async (req, res) => {
  const claves = require('./claves');
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  const { actual, nueva } = req.body || {};

  if (!user.debe_cambiar_password) {
    if (!actual || !(await bcrypt.compare(String(actual), user.password))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
  }
  const problema = claves.revisarLargo(nueva);
  if (problema) return res.status(400).json({ error: problema });
  if (await bcrypt.compare(String(nueva), user.password)) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que ser distinta de la actual' });
  }

  claves.establecer(user.id, nueva, 'usuario');
  const actualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
  res.json({ ok: true, user: publicUser(actualizado) });
}));

/**
 * Con qué iglesia o iglesias está trabajando ahora.
 *
 * Lo elige cada persona desde la barra de arriba y lo puede cambiar cuando
 * quiera. Nunca amplía lo que tiene asignado: si manda una que no le
 * corresponde, se descarta sin decir que sí. En blanco vuelve a ver todas las
 * suyas.
 */
router.put('/iglesias-de-trabajo', authRequired, (req, res) => {
  const alcance = require('./alcance');
  const pedidas = alcance.lista(req.body && req.body.iglesias);
  const asignadas = alcance.iglesiasAsignadas(req.user);
  const validas = asignadas.length ? pedidas.filter((id) => asignadas.includes(id)) : pedidas;

  db.prepare("UPDATE usuarios SET iglesias_trabajando = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(JSON.stringify(validas), req.user.id);

  const actualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  res.json({ ok: true, iglesias: validas, user: publicUser(actualizado) });
});

/** Los datos propios que cada persona puede mantener al día. */
router.get('/perfil', authRequired, (req, res) => {
  const perfil = require('./perfil').leer(req.user.id);
  if (!perfil) return res.status(404).json({ error: 'No se encontró su cuenta' });
  res.json(perfil);
});

router.put('/perfil', authRequired, (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  const resultado = require('./perfil').guardar(usuario, req.body || {});
  if (resultado.error) return res.status(400).json({ error: resultado.error });
  res.json({ ...resultado, perfil: require('./perfil').leer(req.user.id) });
});

/** La pregunta secreta de la propia cuenta, y cómo está la recuperación. */
router.get('/pregunta-secreta', authRequired, (req, res) => {
  const claves = require('./claves');
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  res.json({ ...claves.estadoRecuperacion(user), estado_clave: claves.estado(user) });
});

/** Definir (o quitar) la pregunta secreta de la propia cuenta. */
router.post('/pregunta-secreta', authRequired, (req, res) => {
  const claves = require('./claves');
  const { pregunta, respuesta, quitar } = req.body || {};
  if (quitar) {
    claves.quitarPregunta(req.user.id);
    return res.json({ ok: true, tiene_pregunta: false });
  }
  const problema = claves.guardarPregunta(req.user.id, pregunta, respuesta);
  if (problema) return res.status(400).json({ error: problema });
  res.json({ ok: true, tiene_pregunta: true });
});

/**
 * Recuperar la contraseña olvidada, desde la pantalla de acceso: primero se
 * pide la pregunta de esa cuenta y después se responde eligiendo una nueva.
 */
router.post('/recuperar/pregunta', (req, res) => {
  const claves = require('./claves');
  const ajustes = require('./ajustes');
  if (!ajustes.activo('recuperacion_activa')) {
    return res.status(400).json({ error: 'La recuperación por pregunta está desactivada. Pida al administrador que le restablezca la contraseña.' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(String((req.body || {}).rut || '')));
  if (!user || !user.activo) {
    return res.status(404).json({ error: 'No hay una cuenta activa con ese RUT.' });
  }
  const estado = claves.estadoRecuperacion(user);
  if (!estado.tiene_pregunta) {
    return res.status(400).json({ error: 'Esa cuenta no tiene pregunta de recuperación. Pida al administrador que le restablezca la contraseña.' });
  }
  if (estado.bloqueada) {
    return res.status(423).json({ error: 'La recuperación quedó bloqueada por demasiados intentos. Pida al administrador que la habilite.' });
  }
  res.json({ pregunta: estado.pregunta, intentos_restantes: estado.maximo - estado.intentos });
});

router.post('/recuperar', (req, res) => {
  const claves = require('./claves');
  const ajustes = require('./ajustes');
  if (!ajustes.activo('recuperacion_activa')) {
    return res.status(400).json({ error: 'La recuperación por pregunta está desactivada.' });
  }
  const { rut, respuesta, nueva } = req.body || {};
  const user = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutUtil.canonico(String(rut || '')));
  if (!user || !user.activo) return res.status(404).json({ error: 'No hay una cuenta activa con ese RUT.' });

  const estado = claves.estadoRecuperacion(user);
  if (!estado.tiene_pregunta) return res.status(400).json({ error: 'Esa cuenta no tiene pregunta de recuperación.' });
  if (estado.bloqueada) {
    return res.status(423).json({ error: 'La recuperación quedó bloqueada por demasiados intentos. Pida al administrador que la habilite.' });
  }
  const problema = claves.revisarLargo(nueva);
  if (problema) return res.status(400).json({ error: problema });

  if (!claves.respuestaCorrecta(user, respuesta)) {
    const quedan = estado.maximo - (estado.intentos + 1);
    return res.status(401).json({
      error: quedan > 0
        ? `La respuesta no coincide. Le quedan ${quedan} intento(s).`
        : 'La respuesta no coincide y se agotaron los intentos. Pida al administrador que le restablezca la contraseña.',
    });
  }

  // La eligió su dueño: no hay nada que cambiar en el primer ingreso
  claves.establecer(user.id, nueva, 'usuario');
  res.json({ ok: true });
});

module.exports = { router, authRequired, requirePerm, JWT_SECRET, bloqueoPorMantenimiento };
