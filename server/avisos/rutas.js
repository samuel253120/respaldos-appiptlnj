/**
 * Las rutas de los avisos: la campanita, las preferencias y los aparatos.
 *
 * Todo lo de acá es de UNO MISMO. No hay permiso que consultar ni alcance que
 * comprobar, porque nadie ve ni toca los avisos de otro: cada consulta va
 * atada al usuario de la sesión y no admite que se le pase un id ajeno.
 */
const express = require('express');
const { authRequired } = require('../auth');
const avisos = require('./avisos');
const navegador = require('./navegador');
const { db } = require('../db');

const router = express.Router();

/** Lo que va en la campanita. */
router.get('/avisos', authRequired, (req, res) => {
  res.json(avisos.paraLaCampanita(req.user.id, Math.min(Number(req.query.limit) || 20, 100)));
});

/**
 * Los mensajes que le escribieron a uno.
 *
 * No pide llave, al revés que las de más abajo: acá no se está escribiendo a
 * nadie, se está leyendo lo propio. Va atada al usuario de la sesión, como todo
 * lo de este archivo.
 */
router.get('/avisos/recibidos', authRequired, (req, res) => {
  res.json(avisos.recibidos(req.user.id, { limit: req.query.limit, offset: req.query.offset }));
});

/** Solo el número, para refrescar sin traerse la lista entera. */
router.get('/avisos/cuantos', authRequired, (req, res) => {
  const c = db
    .prepare('SELECT COUNT(*) c FROM notificaciones WHERE usuario_id = ? AND leida = 0')
    .get(req.user.id).c;
  res.json({ sinLeer: c });
});

router.post('/avisos/:id(\\d+)/leido', authRequired, (req, res) => {
  avisos.marcarLeida(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

router.post('/avisos/leidos', authRequired, (req, res) => {
  res.json({ ok: true, cuantos: avisos.marcarTodasLeidas(req.user.id) });
});

/**
 * Qué avisos quiere recibir esta persona y por dónde, con lo que hace falta
 * para encender los del navegador.
 */
router.get('/avisos/preferencias', authRequired, (req, res) => {
  /*
   * Se traen también los permisos propios y el perfil.
   *
   * Con «id, rol, avisos» a secas, `can()` se quedaba sin las dos capas que van
   * ENCIMA del rol y decidía solo por el rol: a quien se le había concedido a
   * mano la llave del respaldo, el aviso de que la copia está atrasada no se le
   * ofrecía. No se notaba antes porque este filtro miraba el rol y nada más.
   */
  const usuario = db
    .prepare('SELECT id, rol, avisos, permisos, perfil_id FROM usuarios WHERE id = ?')
    .get(req.user.id);
  res.json({
    tipos: Object.entries(avisos.TIPOS)
      .filter(([, def]) => !def.llave || require('../permissions').can(usuario, def.llave, 'view'))
      // `siempre` marca los que no se pueden apagar en la campanita: la pantalla
      // los muestra fijos en vez de ofrecer una casilla que no obedece
      .map(([clave, def]) => ({
        clave, label: def.label, ayuda: def.ayuda, urgente: !!def.urgente, siempre: !!def.siempre,
      })),
    canales: avisos.CANALES,
    preferencias: avisos.preferenciasDe(usuario),
    llavePublica: navegador.llavePublica(),
    aparatos: navegador.cuantosAparatos(req.user.id),
  });
});

router.put('/avisos/preferencias', authRequired, (req, res) => {
  const entrada = (req.body && req.body.preferencias) || {};
  // Se guarda solo lo que el sistema conoce: si mañana se quita un tipo de
  // aviso, no queda basura arrastrándose en la ficha de cada usuario.
  const limpias = {};
  for (const tipo of Object.keys(avisos.TIPOS)) {
    const suyo = entrada[tipo];
    if (!suyo) continue;
    limpias[tipo] = { sistema: !!suyo.sistema, navegador: !!suyo.navegador };
  }
  db.prepare("UPDATE usuarios SET avisos = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(JSON.stringify(limpias), req.user.id);
  const usuario = db
    .prepare('SELECT id, rol, avisos, permisos, perfil_id FROM usuarios WHERE id = ?')
    .get(req.user.id);
  res.json({ ok: true, preferencias: avisos.preferenciasDe(usuario) });
});

/**
 * El navegador de esta persona queda enganchado.
 *
 * Los dos motivos por los que puede no guardarse se dicen distinto, porque se
 * arreglan distinto: una suscripción a medias es cosa del navegador y hay que
 * volver a activarla; una dirección que no sirve significa que lo que llegó no
 * es de un servicio de avisos, y ahí no hay nada que reintentar.
 */
router.post('/avisos/aparato', authRequired, (req, res) => {
  const suscripcion = (req.body && req.body.suscripcion) || null;
  const guardada = navegador.suscribir(req.user.id, suscripcion, req.headers['user-agent']);
  if (!guardada) {
    const direccion = suscripcion && suscripcion.endpoint;
    const incompleta = !direccion || !suscripcion.keys || !suscripcion.keys.p256dh || !suscripcion.keys.auth;
    return res.status(400).json({
      error: incompleta
        ? 'La suscripción que mandó el navegador no viene completa.'
        : 'Esa dirección no es la de un servicio de avisos: tiene que ser https y no puede apuntar a la red interna.',
    });
  }
  res.json({ ok: true, aparatos: navegador.cuantosAparatos(req.user.id) });
});

/**
 * Desenganchar un aparato. Se atiende por POST y también por DELETE.
 *
 * POR QUÉ HAY DOS. Lo natural sería solo DELETE, y así estaba. Pero la
 * dirección del aparato es larga y hay que mandarla en el cuerpo, y un DELETE
 * CON CUERPO no tiene significado definido en la norma (RFC 9110 §9.3.5): a
 * quien esté en el camino —un proxy, la red del teléfono, un cortafuegos— se
 * le permite vaciarlo o rechazar la petición entera, y varios lo hacen. Cuando
 * eso pasa, al navegador le llega un «Failed to fetch» pelado: ni siquiera se
 * sabe que hubo un servidor al otro lado. Justamente lo que ocurrió al publicar
 * el sistema en su propio dominio.
 *
 * Así que el sistema pide por POST, que nadie discute, y se deja el DELETE
 * atendido por si algún navegador quedó con la página vieja cargada.
 */
function desenganchar(req, res) {
  const cuerpo = req.body || {};
  const cuantos = cuerpo.todos
    ? navegador.desuscribirTodos(req.user.id)
    : navegador.desuscribir(req.user.id, cuerpo.endpoint || '');
  res.json({ ok: true, apagados: cuantos, aparatos: navegador.cuantosAparatos(req.user.id) });
}

router.post('/avisos/aparato/apagar', authRequired, desenganchar);
router.delete('/avisos/aparato', authRequired, desenganchar);

/*
 * El aviso de prueba tiene tope por hora.
 *
 * Es el único sitio del sistema donde una persona provoca, apretando un botón,
 * que el servidor salga a hablar con afuera. Sin tope se midieron cuarenta
 * pedidos atendidos en dos décimas de segundo, y cada uno le manda a TODOS los
 * aparatos de esa cuenta a la vez.
 *
 * Se cuenta en memoria, igual que el tope de los mensajes (ver ritmo.js): un
 * reinicio lo olvida, y está bien —no es algo que nadie pueda provocar—.
 *
 * Seis por hora: quien está tratando de encender los avisos y no le llegan
 * aprieta el botón tres o cuatro veces, mira la configuración del navegador y
 * vuelve a probar. Seis alcanza para eso de sobra y no alcanza para nada más.
 */
const PRUEBAS_POR_HORA = 6;
const VENTANA_MS = 60 * 60 * 1000;
const CUANTAS_CABEN = 2000;
const pruebas = new Map();

function cuantoLeFaltaParaProbar(usuarioId, ahora = Date.now()) {
  const suyas = (pruebas.get(usuarioId) || []).filter((t) => ahora - t < VENTANA_MS);
  pruebas.set(usuarioId, suyas);
  if (suyas.length < PRUEBAS_POR_HORA) return 0;
  return Math.max(1, Math.ceil((VENTANA_MS - (ahora - Math.min(...suyas))) / 1000));
}

function anotarPrueba(usuarioId, ahora = Date.now()) {
  pruebas.set(usuarioId, [...(pruebas.get(usuarioId) || []).filter((t) => ahora - t < VENTANA_MS), ahora]);
  // Sin esto, un sistema con muchas cuentas guarda una entrada por cada una
  // para siempre. Misma limpieza que en ritmo.js.
  if (pruebas.size > CUANTAS_CABEN) {
    for (const [quien, horas] of pruebas) {
      if (!horas.some((t) => ahora - t < VENTANA_MS)) pruebas.delete(quien);
    }
  }
}

/**
 * Un aviso de prueba, para comprobar que de verdad llega.
 *
 * Encender los avisos del navegador tiene cuatro pasos que pueden fallar por
 * separado —el permiso, el service worker, la suscripción, el envío— y sin
 * esto la persona no sabría cuál de los cuatro le falló.
 */
router.post('/avisos/probar', authRequired, async (req, res) => {
  const falta = cuantoLeFaltaParaProbar(req.user.id);
  if (falta) {
    const minutos = Math.ceil(falta / 60);
    return res.status(429).json({
      error: `Ya pidió ${PRUEBAS_POR_HORA} avisos de prueba en la última hora. `
        + `Puede pedir otro en ${minutos <= 1 ? 'un minuto' : `${minutos} minutos`}.`,
      segundos: falta,
    });
  }
  anotarPrueba(req.user.id);
  const r = await navegador.empujar(req.user.id, {
    titulo: 'Los avisos están funcionando',
    cuerpo: 'Así se van a ver los avisos del sistema en este aparato.',
    enlace: '#/',
    etiqueta: 'prueba',
  });
  if (!r.mandados) {
    // Los tres motivos son distintos y se arreglan distinto: por eso no se
    // responde lo mismo. Decir «no hay aparato» cuando sí lo hay manda a la
    // persona a activar de nuevo algo que ya estaba bien.
    let error = 'No hay ningún aparato enganchado a su cuenta todavía.';
    if (r.fallados) {
      error = `El aparato está enganchado, pero el aviso no pudo salir: ${r.porque}`;
    } else if (r.borrados) {
      error = 'Este aparato ya no estaba enganchado. Vuelva a activar los avisos.';
    }
    return res.status(400).json({ error });
  }
  res.json({ ok: true, ...r });
});

/* ------------------------------------------------- mensajes escritos a mano --
 *
 * Estas tres SÍ piden llave, al revés que todo lo de arriba: acá no se está
 * mirando lo propio, se está escribiendo a otros.
 */
const mensajes = require('./mensajes');

/** Solo quien puede enviar mensajes pasa de acá. */
function puedeEnviar(req, res, siguiente) {
  if (!require('../permissions').can(req.user, 'avisos_enviar', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para enviar mensajes a los usuarios.' });
  }
  siguiente();
}

/** A quiénes puede escribirle esta persona, y de qué maneras elegirlos. */
router.get('/avisos/mensajes/destinatarios', authRequired, puedeEnviar, (req, res) => {
  res.json(mensajes.aQuienPuedeEscribir(req.user));
});

/** Lo que se ha mandado, con cuántos lo leyeron. */
router.get('/avisos/mensajes', authRequired, puedeEnviar, (req, res) => {
  res.json({ mensajes: mensajes.loQueSeHaMandado(req.user, req.query.limit) });
});

/**
 * Mandar uno.
 *
 * El tope por hora se mira ACÁ y no dentro de `enviar`: un tope por tiempo es
 * cosa de la puerta —cuida de que a esa puerta no la golpeen a máquina— y
 * adentro está lo que hace al mensaje, que tiene que valer venga por donde
 * venga. Ver server/avisos/ritmo.js.
 */
const ritmo = require('./ritmo');

router.post('/avisos/mensajes', authRequired, puedeEnviar, (req, res) => {
  const falta = ritmo.cuantoLeFalta(req.user.id);
  if (falta) return res.status(429).json({ error: ritmo.comoSeExplica(falta), segundos: falta });

  const salida = mensajes.enviar(req.user, req.body || {});
  // Si viene `confirmar`, no es un error sino una pregunta: la pantalla la
  // muestra con sus dos botones y reintenta con `igual_asi`, igual que en el
  // resto del sistema (ver `preguntarSiIgualVa` en public/app.js).
  if (salida.error) return res.status(400).json(salida);

  // Solo se anota lo que salió: una pregunta o un rechazo no gastan el tope
  ritmo.anotarEnvio(req.user.id);
  res.status(201).json({ ok: true, ...salida });
});

/** Abrir uno: lo que decía y a quiénes fue. */
router.get('/avisos/mensajes/:id(\\d+)', authRequired, puedeEnviar, (req, res) => {
  const suyo = mensajes.unEnvio(req.user, Number(req.params.id));
  if (!suyo) return res.status(404).json({ error: 'Ese mensaje no está entre los que usted puede ver.' });
  res.json(suyo);
});

/**
 * Retirar uno.
 *
 * Va por POST y no por DELETE porque no se borra el mensaje: se le saca el
 * aviso a quien todavía no lo abrió y la constancia queda, marcada como
 * retirada. Es lo mismo que hace `/usuarios/:id/restablecer-clave`, que tampoco
 * borra la cuenta.
 */
router.post('/avisos/mensajes/:id(\\d+)/retirar', authRequired, puedeEnviar, (req, res) => {
  const salida = mensajes.retirar(req.user, Number(req.params.id));
  if (salida.error) return res.status(400).json({ error: salida.error });
  res.json({ ok: true, ...salida });
});

module.exports = router;
