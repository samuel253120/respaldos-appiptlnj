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
    // La hora que tiene el sistema AHORA, para poder comprobar de un vistazo
    // que la zona quedó bien. Un desplegable que dice «Chile» no prueba nada;
    // una fecha y hora que coinciden con el reloj de la pared, sí.
    hora: require('./zona-horaria').ahora(),
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
  const anotados = [];
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!POR_CLAVE[clave]) continue;
    const opcion = POR_CLAVE[clave];
    const comoEstaba = obtener(clave);
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
    if (String(comoEstaba == null ? '' : comoEstaba) !== String(v)) {
      anotados.push({ opcion, antes: comoEstaba, ahora: v });
    }
  }

  anotarLosCambios(anotados, req.user);

  /*
   * La zona horaria se aplica al momento, no al próximo reinicio. Si no, la
   * pantalla diría «Chile» mientras el sistema sigue anotando en hora
   * universal, que es peor que no tener el ajuste: se cree arreglado y no lo
   * está.
   */
  const zonaHoraria = require('./zona-horaria');
  zonaHoraria.aplicar();

  res.json({ ok: true, valores: todas(), ajustados, hora: zonaHoraria.ahora() });
});

/**
 * Lo que se cambió en la configuración, en el Registro de Cambios.
 *
 * El punto 15.7 de la especificación de credenciales pide que quede anotado el
 * cambio de los recursos institucionales —el logo, el sello y la firma—, con
 * quién, cuándo y qué había antes. Se anota TODA la configuración y no solo
 * esos tres, por dos razones: hacer una excepción para tres claves obliga a
 * acordarse de agregar la cuarta el día que exista, y lo demás que se cambia
 * acá pesa igual o más —el modo mantenimiento, el largo de las contraseñas, el
 * modo del código QR—.
 *
 * De las imágenes se anota el nombre del archivo, no la imagen. Y de la
 * contraseña inicial no se anota el valor: quedaría escrita en claro en un
 * registro que puede leer más gente de la que debería saberla.
 */
const NO_SE_ANOTA_EL_VALOR = ['password_inicial'];

function anotarLosCambios(anotados, usuario) {
  if (!anotados.length) return;
  const bitacora = require('./bitacora');
  const comoSeLee = (opcion, valor) => {
    if (NO_SE_ANOTA_EL_VALOR.includes(opcion.clave)) return '(no se anota)';
    if (valor === null || valor === undefined || valor === '') return '(vacío)';
    if (opcion.tipo === 'boolean') return valor === '1' ? 'sí' : 'no';
    if (opcion.tipo === 'select') {
      const cual = (opcion.opciones || []).find((x) => x.valor === String(valor));
      return cual ? cual.label : String(valor);
    }
    return String(valor).slice(0, 80);
  };

  // La configuración no es un módulo, así que se le arma la ficha mínima que
  // el registro necesita para nombrarla
  const comoModulo = { name: 'configuracion', label: 'Configuración del sistema', display: '{que}' };
  for (const { opcion, antes, ahora } of anotados) {
    bitacora.anotarCambio({
      def: comoModulo,
      accion: 'Cambio',
      fila: { id: null, iglesia_id: null, que: opcion.label },
      usuario,
      detalle: `${opcion.label}: ${comoSeLee(opcion, antes)} → ${comoSeLee(opcion, ahora)}`,
    });
  }
}

/**
 * El historial de versiones (fase 6 de la especificación de credenciales).
 *
 * Devuelve qué versión está corriendo AHORA MISMO en este servidor y la lista
 * de lo que trajo cada una. Lo primero es lo que más se usa: después de
 * publicar, la pregunta es siempre «¿ya se actualizó?», y la respuesta tiene
 * que salir del servidor que está atendiendo, no de lo que diga un archivo.
 *
 * No pide permiso de configuración: saber qué versión está corriendo no le
 * hace daño a nadie y le sirve a cualquiera que llame por teléfono a avisar
 * de algo raro.
 */
router.get('/versiones', authRequired, (req, res) => {
  const { VERSIONES } = require('./versiones');
  const corriendo = require('../package.json').version;
  res.json({
    corriendo,
    anotada: VERSIONES.some((v) => v.version === corriendo),
    versiones: VERSIONES,
  });
});

module.exports = { router };
