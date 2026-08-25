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
  const usuario = db.prepare('SELECT id, rol, avisos FROM usuarios WHERE id = ?').get(req.user.id);
  res.json({
    tipos: Object.entries(avisos.TIPOS)
      .filter(([, def]) => !def.soloAdmin || usuario.rol === 'admin')
      .map(([clave, def]) => ({ clave, label: def.label, ayuda: def.ayuda, urgente: !!def.urgente })),
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
  const usuario = db.prepare('SELECT id, rol, avisos FROM usuarios WHERE id = ?').get(req.user.id);
  res.json({ ok: true, preferencias: avisos.preferenciasDe(usuario) });
});

/** El navegador de esta persona queda enganchado. */
router.post('/avisos/aparato', authRequired, (req, res) => {
  const guardada = navegador.suscribir(req.user.id, req.body && req.body.suscripcion, req.headers['user-agent']);
  if (!guardada) return res.status(400).json({ error: 'La suscripción que mandó el navegador no viene completa.' });
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

/**
 * Un aviso de prueba, para comprobar que de verdad llega.
 *
 * Encender los avisos del navegador tiene cuatro pasos que pueden fallar por
 * separado —el permiso, el service worker, la suscripción, el envío— y sin
 * esto la persona no sabría cuál de los cuatro le falló.
 */
router.post('/avisos/probar', authRequired, async (req, res) => {
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

module.exports = router;
