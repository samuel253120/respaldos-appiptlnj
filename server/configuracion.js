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

/**
 * Cómo quedaría guardado un valor que llega, o `DESCARTADO` si no entra.
 *
 * Existe para que haya UNA sola manera de contestar esa pregunta. La hacen dos
 * partes del guardado —la comprobación del permiso del mantenimiento, que
 * necesita saber si la opción de verdad CAMBIA, y el bucle que escribe— y
 * cuando cada una la contestaba por su cuenta no contestaban lo mismo: la
 * primera miraba si la clave venía, sin mirar su valor (hallazgo CO-01).
 *
 * Se devuelve siempre el texto tal como se guarda, porque así es como está en
 * la base y así se puede comparar con lo que ya hay.
 */
const DESCARTADO = Symbol('no entra');

function comoQuedaria(opcion, valor) {
  // Ojo: "0" es una cadena, y toda cadena es verdadera en JavaScript; hay que
  // mirar el valor, si no un "0" enviado por la API dejaría la opción activa.
  if (opcion.tipo === 'boolean') {
    return valor === true || valor === 1 || valor === '1' || valor === 'true' ? '1' : '0';
  }
  // Una opción de lista solo admite lo que declara: un valor inventado
  // dejaría el sistema en un modo que no existe
  if (opcion.tipo === 'select') {
    return (opcion.opciones || []).some((x) => x.valor === String(valor)) ? String(valor) : DESCARTADO;
  }
  if (opcion.tipo === 'number') {
    const n = Number(valor);
    if (!Number.isFinite(n)) return DESCARTADO;
    const dentro = Math.min(
      opcion.max === undefined ? n : opcion.max,
      Math.max(opcion.min === undefined ? n : opcion.min, Math.round(n))
    );
    return String(dentro);
  }
  return String(valor == null ? '' : valor);
}

/**
 * ¿El nombre que se le quiere poner a un ajuste de imagen es una imagen?
 *
 * Un ajuste declarado `tipo: 'imagen'` guarda el NOMBRE de un archivo, y era un
 * texto libre: nada comprobaba que apuntara a una imagen, ni siquiera que el
 * archivo existiera. Medido en la v1.423.0, apuntando «iglesia_logo» al nombre
 * de un documento subido a una ficha:
 *
 *   GET /uploads/…reservado.txt ............  401 · pide sesión
 *   GET /api/configuracion/logo ............  200 · y su contenido entero
 *
 * La segunda no pide sesión a propósito —el logo tiene que verse en la pantalla
 * de acceso, antes de que haya nadie identificado—, así que apuntarla a
 * cualquier archivo subido lo publicaba a internet abierta. Hace falta la llave
 * de la configuración para dejarlo puesto, pero es justo la clase de cosa que
 * un permiso administrativo no debería alcanzar, y el único síntoma visible era
 * que el logo se veía roto (hallazgo CO-02).
 *
 * Se pregunta con la MISMA cuenta que usa el sistema al subir un archivo
 * (server/tiposdearchivo.js): la extensión y los primeros bytes. Dos maneras de
 * decidir qué es una imagen habrían sido dos verdades.
 *
 * Devuelve el problema escrito, o null si se puede guardar. Vacío se puede
 * siempre: es como se quita el sello, o como se vuelve al logo de fábrica.
 */
function problemaDeLaImagen(archivo) {
  const nombre = String(archivo == null ? '' : archivo).trim();
  if (!nombre) return null;
  const ruta = path.join(UPLOADS_DIR, path.basename(nombre));
  let primeros;
  try {
    const f = fs.openSync(ruta, 'r');
    primeros = Buffer.alloc(16);
    fs.readSync(f, primeros, 0, 16, 0);
    fs.closeSync(f);
  } catch (e) {
    return 'ese archivo ya no está. Vuelva a cargar la imagen.';
  }
  if (!require('./tiposdearchivo').esUnaImagen(nombre, primeros)) {
    return 'ese archivo no es una imagen. Cargue un PNG o un JPG.';
  }
  return null;
}

/** Lo mismo, al entregar: lo guardado pudo quedar puesto antes de esta versión. */
function laImagenQueSePuedeEntregar(clave) {
  const nombre = obtener(clave);
  if (!nombre) return null;
  return problemaDeLaImagen(nombre) ? null : path.join(UPLOADS_DIR, path.basename(nombre));
}

/** ¿Este guardado deja la opción distinta de como está? */
function quedaDistinta(clave, valor) {
  const opcion = POR_CLAVE[clave];
  if (!opcion) return false;
  const quedaria = comoQuedaria(opcion, valor);
  if (quedaria === DESCARTADO) return false;   // no entra: no cambia nada
  const ahora = obtener(clave);
  return String(ahora == null ? '' : ahora) !== quedaria;
}


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
 *
 * Por eso el tiempo que se deja guardar depende de si vino esa versión: cuando
 * viene, el navegador puede quedarse con la imagen un año entero, porque un
 * logo nuevo pide otra dirección; cuando no viene —la primera pintada de la
 * pantalla de acceso, antes de saber el nombre del archivo— se guarda solo un
 * rato corto, para que un cambio no quede pegado ahí.
 */
const GUARDAR_LOGO = (req) => (req.query.v
  ? 'public, max-age=31536000, immutable'
  : 'public, max-age=300');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img');

router.get('/logo', (req, res) => {
  res.setHeader('Cache-Control', GUARDAR_LOGO(req));
  res.setHeader('Vary', 'Accept');
  /*
   * Se comprueba OTRA VEZ acá, y no solo al guardar.
   *
   * El valor pudo quedar puesto antes de que el guardado lo revisara, o el
   * archivo pudo cambiar en el disco. Esta ruta no pide sesión, así que es la
   * que tiene que estar segura de lo que entrega: si lo guardado no es una
   * imagen que se pueda leer, se responde el logo de fábrica y no se entrega
   * nada. Un logo de fábrica en la pantalla de acceso no le hace daño a nadie;
   * publicar el carnet escaneado de alguien, sí.
   */
  const ruta = laImagenQueSePuedeEntregar('iglesia_logo');
  if (ruta) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(ruta);
  }
  /**
   * El de fábrica va en dos formatos.
   *
   * El dibujo tiene degradados y sombras, y en PNG eso pesa 180 KB: más que
   * todo el programa de la pantalla junto. En WebP —que entienden todos los
   * navegadores desde hace años— el mismo dibujo pesa 89 KB y se ve igual.
   *
   * El PNG se queda igual y se sigue entregando a quien no pida WebP, porque
   * no es solo el navegador quien lo usa: el acta en PDF también lleva el logo,
   * y ahí solo entran PNG y JPEG.
   */
  const quiereWebp = /image\/webp/i.test(String(req.headers.accept || ''));
  const webp = path.join(IMG_DIR, 'logo.webp');
  if (quiereWebp && fs.existsSync(webp)) return res.sendFile(webp);
  res.sendFile(path.join(IMG_DIR, 'logo.png'));
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
  // Y por lo mismo que el logo: lo guardado pudo quedar puesto antes de que el
  // guardado lo revisara
  const ruta = laImagenQueSePuedeEntregar(clave);
  if (!ruta) {
    return res.status(404).json({
      error: `El archivo del ${req.params.cual} ya no está en el disco, o no es una imagen. `
        + 'Vuelva a cargarlo en Configuración del Sistema.',
    });
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

  /*
   * El mantenimiento tiene su propia llave.
   *
   * Deja a TODA la iglesia fuera del sistema hasta que alguien lo apague, y
   * vivía dentro del mismo permiso que corregir el teléfono de la iglesia. No
   * es lo mismo: se puede querer delegar la configuración sin entregar la
   * llave que cierra la puerta. Se comprueba acá y no en la pantalla porque
   * quien manda una petición a mano no pasa por ninguna pantalla.
   *
   * SE PREGUNTA POR EL CAMBIO, NO POR LA PRESENCIA (hallazgo CO-01).
   *
   * Acá decía `c in cambios`: bastaba con que la clave VINIERA. Y la pantalla
   * no manda lo que uno tocó, manda los setenta campos en cada guardado, así
   * que `mantenimiento_activo` viene siempre. Medido en la v1.423.0, con una
   * cuenta que tenía la llave de la configuración y no la del mantenimiento:
   *
   *   PUT con una sola clave, a mano ......  200 · entra
   *   PUT con los 70 campos, o sea el
   *   botón Guardar de la pantalla .......  403 · «No tiene permiso para
   *                                          dejar el sistema en mantenimiento»
   *
   * Y el interruptor iba en `false`, igual que como estaba guardado: ni
   * siquiera lo había tocado. O sea que el permiso que se creó para poder
   * DELEGAR la configuración dejaba la pantalla inservible para quien lo
   * recibía, con un mensaje que además le decía «Puede cambiar el resto de la
   * configuración», que era justo lo que no podía.
   *
   * Ahora se compara con lo que hay guardado, con la misma cuenta que usa el
   * bucle de más abajo para escribir: dos maneras de normalizar habrían sido
   * dos verdades, y ese fue exactamente el defecto.
   */
  const DEL_MANTENIMIENTO = ['mantenimiento_activo', 'mantenimiento_mensaje'];
  const loMueve = DEL_MANTENIMIENTO.some((c) => c in cambios && quedaDistinta(c, cambios[c]));
  if (loMueve && !can(req.user, 'sistema_mantenimiento', 'view')) {
    return res.status(403).json({
      error: 'No tiene permiso para dejar el sistema en mantenimiento. Puede cambiar el resto de la configuración.',
    });
  }
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
  /*
   * UNA CONTRASEÑA QUE EL SISTEMA VA A REPARTIR PASA POR LA MISMA REGLA QUE
   * CUALQUIER OTRA (hallazgo AU-03).
   *
   * La contraseña inicial era un ajuste de texto corriente y no se revisaba
   * nada. Medido en la v1.416.0, la misma clave por las dos puertas:
   *
   *                  como contraseña propia          como inicial del sistema
   *   "123456" ....  400 · al menos 8 caracteres     200 · guardada
   *   "clave" .....  400 · al menos 8 caracteres     200 · guardada
   *   "aaaaaaaa" ..  400 · un solo carácter repetido 200 · guardada
   *   "a" .........  400 · al menos 8 caracteres     200 · guardada
   *
   * Y no es un ajuste cualquiera: es el único lugar donde nacen casi todas las
   * contraseñas del sistema, y adivinarla no es entrar a mirar sino apoderarse
   * de la cuenta, porque en el primer ingreso cambiarla no pide la actual.
   *
   * Se RECHAZA el guardado entero en vez de saltarse la opción en silencio, que
   * es lo que se hace con una lista que trae un valor inventado: ahí el
   * administrador escribió cualquier cosa por error, y acá creería que dejó
   * puesta una clave que el sistema nunca guardó.
   */
  for (const [clave, valor] of Object.entries(cambios)) {
    const opcion = POR_CLAVE[clave];
    if (!opcion || !opcion.revisaComoClave) continue;
    // Sin `quien`: no es la contraseña de una persona, así que su RUT y su
    // nombre no vienen al caso. Lo demás —el largo, las de siempre, el nombre
    // de la iglesia— vale igual o más acá que en cualquier otro sitio.
    const problema = require('./claves').revisarClave(valor, null);
    if (problema) {
      return res.status(400).json({ error: `${opcion.label}: ${problema}` });
    }
  }

  /*
   * Y UNA IMAGEN TIENE QUE SER UNA IMAGEN (hallazgo CO-02).
   *
   * Se rechaza el guardado ENTERO, por la misma razón que la contraseña
   * inicial: quien se equivocó de archivo tiene que enterarse, no quedarse
   * creyendo que dejó puesto un logo que el sistema nunca guardó.
   *
   * SOLO LO QUE CAMBIA, que es la misma lección del hallazgo CO-01 unas líneas
   * más arriba. La pantalla manda los setenta campos en cada guardado, así que
   * el nombre del logo que ya está puesto viaja SIEMPRE. Si lo guardado es un
   * archivo que se borró del disco —o un valor que quedó puesto antes de esta
   * versión, cuando nada se comprobaba— revisarlo acá dejaría a la persona sin
   * poder guardar NADA, y por algo que ella no hizo. Se probó al correr la
   * batería, y era exactamente el defecto que se acababa de arreglar.
   *
   * Lo que ya está puesto y está malo lo ataja la otra puerta, la de entregar,
   * que es la que importa: no se publica igual. Y en cuanto alguien cargue una
   * imagen nueva, esta comprobación se le hace.
   */
  for (const [clave, valor] of Object.entries(cambios)) {
    const opcion = POR_CLAVE[clave];
    if (!opcion || opcion.tipo !== 'imagen') continue;
    if (!quedaDistinta(clave, valor)) continue;
    const problema = problemaDeLaImagen(valor);
    if (problema) {
      return res.status(400).json({ error: `${opcion.label}: ${problema}` });
    }
  }

  const ajustados = [];
  const anotados = [];
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!POR_CLAVE[clave]) continue;
    const opcion = POR_CLAVE[clave];
    const comoEstaba = obtener(clave);
    const v = comoQuedaria(opcion, valor);
    if (v === DESCARTADO) continue;
    // Un número que no cabía se ajusta al límite, y se dice en cuánto quedó
    if (opcion.tipo === 'number' && Number(valor) !== Number(v)) {
      ajustados.push({ clave, label: opcion.label, pedido: Number(valor), quedo: Number(v) });
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

/*
 * `problemaDeLaImagen` sale afuera para poder mirarlo desde una prueba.
 *
 * El caso «en blanco se puede siempre» —así se vuelve al logo de fábrica y así
 * se quita el sello— no se puede comprobar pidiendo la ruta: el logo es uno
 * solo para todo el sistema, y dejarlo en blanco el rato que dura una petición
 * les rompe la prueba a los archivos que necesitan poder emitir una credencial.
 * Se mira acá, que es donde vive la regla.
 */
module.exports = { router, problemaDeLaImagen };
