/**
 * Rutas web de la configuración del sistema (solo administradores, salvo
 * las opciones públicas que necesita la pantalla de acceso).
 *
 *   GET  /api/configuracion/publica   sin autenticación: aviso de mantenimiento e identidad
 *   GET  /api/configuracion           definiciones + valores actuales
 *   PUT  /api/configuracion           guardar cambios
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { authRequired } = require('./auth');
const { can } = require('./permissions');
const { UPLOADS_DIR } = require('./db');
const { OPCIONES, POR_CLAVE, obtener, todas, guardar } = require('./ajustes');

const PLANOS = OPCIONES.flatMap((g) => g.items);

const router = express.Router();


// Lo mínimo que necesita la pantalla de acceso, sin sesión iniciada
router.get('/publica', (req, res) => {
  const publicas = {};
  for (const o of PLANOS) if (o.publica) publicas[o.clave] = obtener(o.clave);
  res.json(publicas);
});

/**
 * El logo de la institución, sin pedir sesión.
 *
 * Tiene que salir en la pantalla de acceso, o sea antes de que haya nadie
 * identificado, así que no puede ir por /uploads —que sí pide sesión—. Se
 * entrega desde acá, y mientras no se haya subido ninguno se responde con el
 * que trae el sistema, para que la pantalla nunca quede con un hueco.
 *
 * El nombre del archivo lleva un trozo al azar y cambia con cada logo nuevo,
 * así que se puede dejar que el navegador lo guarde un buen rato: la dirección
 * que se pide es la misma, pero se le cuelga la versión (?v=) para que un
 * cambio se vea en el momento.
 */
router.get('/logo', (req, res) => {
  const suyo = obtener('iglesia_logo');
  const ruta = suyo ? path.join(UPLOADS_DIR, path.basename(suyo)) : null;
  if (ruta && fs.existsSync(ruta)) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(ruta);
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, '..', 'public', 'img', 'logo.png'));
});

/**
 * El sello y la firma, para la vista de impresión de la credencial.
 *
 * No van por /uploads porque ahí el archivo se busca por la ficha a la que
 * pertenece, y estos no pertenecen a ninguna: son del sistema entero. Piden
 * sesión —a diferencia del logo, que tiene que verse en la pantalla de acceso—
 * y solo entregan lo que está configurado, nunca un archivo cualquiera.
 */
const RECURSOS = { sello: 'credencial_sello', firma: 'credencial_firma' };

router.get('/recurso/:cual', authRequired, (req, res) => {
  const clave = RECURSOS[req.params.cual];
  if (!clave) return res.status(404).json({ error: 'Ese recurso no existe' });
  const archivo = obtener(clave);
  if (!archivo) return res.status(404).json({ error: `Falta cargar el ${req.params.cual} en Configuración del Sistema` });
  const ruta = path.join(UPLOADS_DIR, path.basename(archivo));
  if (!fs.existsSync(ruta)) {
    return res.status(404).json({ error: `El archivo del ${req.params.cual} ya no está en el disco` });
  }
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(ruta);
});

router.get('/', authRequired, (req, res) => {
  if (!can(req.user, 'sistema_configuracion', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para ver la configuración del sistema' });
  }
  res.json({
    grupos: OPCIONES.map((g) => ({
      grupo: g.grupo,
      items: g.items.map((o) => ({
        clave: o.clave, label: o.label, tipo: o.tipo, ayuda: o.ayuda || null,
        // Los límites viajan para que el formulario los muestre y avise antes
        // de mandar; el que manda igual se topa con la misma comprobación acá
        min: o.min === undefined ? null : o.min,
        max: o.max === undefined ? null : o.max,
        opciones: o.opciones || null,
        valor: obtener(o.clave),
      })),
    })),
  });
});

router.put('/', authRequired, (req, res) => {
  if (!can(req.user, 'sistema_configuracion', 'edit')) {
    return res.status(403).json({ error: 'No tiene permiso para cambiar la configuración del sistema' });
  }
  const cambios = req.body || {};
  /**
   * Lo que se guarda es lo que se usa.
   *
   * Cada número se lee después con sus límites —`ajustes.numero(clave, min,
   * max)`—, así que escribir 9999 en «cuántas copias se guardan» nunca guardó
   * 9999: el sistema usaba 60. Pero la pantalla mostraba el 9999, y entonces
   * decía una cosa mientras pasaba otra. Ahora se ajusta al guardar y se avisa
   * de lo que quedó distinto, que es la única manera de que lo que se ve sea
   * lo que hay.
   */
  const ajustados = [];
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!POR_CLAVE[clave]) continue;
    const opcion = POR_CLAVE[clave];
    let v = valor;
    // Ojo: "0" es una cadena, y toda cadena es verdadera en JavaScript; hay que
    // mirar el valor, si no un "0" enviado por la API dejaría la opción activa.
    if (opcion.tipo === 'boolean') {
      v = valor === true || valor === 1 || valor === '1' || valor === 'true' ? '1' : '0';
    }
    // Una opción de lista solo admite lo que declara: un valor inventado
    // dejaría el sistema en un modo que no existe
    if (opcion.tipo === 'select') {
      if (!(opcion.opciones || []).some((x) => x.valor === String(valor))) continue;
    }
    if (opcion.tipo === 'number') {
      const n = Number(valor);
      if (!Number.isFinite(n)) continue;
      const dentro = Math.min(
        opcion.max === undefined ? n : opcion.max,
        Math.max(opcion.min === undefined ? n : opcion.min, Math.round(n))
      );
      if (dentro !== n) ajustados.push({ clave, label: opcion.label, pedido: n, quedo: dentro });
      v = String(dentro);
    }
    guardar(clave, v, req.user.id);
  }
  res.json({ ok: true, valores: todas(), ajustados });
});

module.exports = { router };
