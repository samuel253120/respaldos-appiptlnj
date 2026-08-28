/**
 * Servidor principal del Sistema de Gestión de Iglesias.
 *
 * Arranque:  npm start   (o npm run dev para reinicio automático)
 * Variables: PORT (3000), DATA_DIR (./data), JWT_SECRET
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const apretados = require('./apretados');
const { sinLoQueNoDiceNada } = require('./meta-liviana');
const multer = require('multer');

const { db, DATA_DIR, UPLOADS_DIR } = require('./db');
const { router: authRouter, authRequired } = require('./auth');
const { buildRouter } = require('./crud');
const { allModules, getModule } = require('./registry');
const { can, ROLES, ACCIONES, MATRIX, LLAVES, SALUD, permisosDelRol, todoLoQueSePuedePermitir } = require('./permissions');
const { ensureSeed } = require('./seed');
const { ejecutarMigraciones } = require('./migraciones');
const { router: importarRouter } = require('./importar');
const { router: configuracionRouter } = require('./configuracion');
const ajustes = require('./ajustes');
// Se pide al arrancar para que su aviso —si falta la clave secreta de las
// credenciales— salga junto a los demás, y no la primera vez que alguien
// intente emitir una.
require('./credenciales/codigo');
const alcance = require('./alcance');
const archivos = require('./archivos');
const respaldo = require('./respaldo');
const tiposDeArchivo = require('./tiposdearchivo');
const respaldoAutomatico = require('./respaldo-automatico');
const pendientes = require('./pendientes');

const app = express();
app.set('trust proxy', 1); // detrás de un proxy inverso (Railway, Render, Nginx…)

// Cada dato de la dirección llega como UN texto, siempre: la misma clave
// repetida ya no entrega una lista donde el sistema espera un valor, que era un
// error 500 en todos los listados (ver server/consulta.js).
app.set('query parser', require('./consulta').leerLaConsulta);
// Todo viaja comprimido. La pantalla del sistema son unos 300 KB de programa y
// los listados vienen en texto: comprimidos pesan como la cuarta parte, que en
// un teléfono con datos móviles es la diferencia entre entrar y quedarse
// esperando. Al servidor le cuesta poco y lo hace una sola vez por respuesta.
app.use(compression());
app.use(express.json({ limit: '10mb' }));

/**
 * Las reglas que el propio navegador hace cumplir.
 *
 * Son cuatro líneas y cierran de golpe toda una familia de problemas, sin que
 * el sistema tenga que hacer nada más:
 *
 *   · **Content-Security-Policy** — de dónde puede salir lo que la página
 *     ejecuta y muestra. Solo de este mismo sitio. Aunque algún día alguien
 *     lograra colar un texto con instrucciones en una ficha, el navegador no
 *     las ejecutaría: la página no tiene permitido ejecutar nada escrito
 *     dentro de ella misma, solo su propio archivo de programa. Por eso los
 *     clics de las filas se escuchan desde un solo lugar y no dentro de cada
 *     etiqueta (ver public/app.js).
 *   · **X-Content-Type-Options** — que no adivine el tipo de un archivo por
 *     su contenido. Lo que el sistema dice que es una foto, se trata como
 *     foto y no se ejecuta.
 *   · **X-Frame-Options** — que otro sitio no pueda meter el sistema dentro
 *     de una ventana suya para engañar a quien lo usa haciéndole apretar
 *     cosas que no ve.
 *   · **Referrer-Policy** — que al salir a otro sitio (el enlace de WhatsApp,
 *     por ejemplo) no se le cuente la dirección desde donde se salió, que
 *     lleva escrito qué ficha se estaba mirando.
 *
 * `style-src` acepta estilos escritos en la etiqueta porque el sistema arma
 * pantallas así en varias partes; eso no ejecuta nada, solo pinta.
 * `img-src` acepta `data:` y `blob:` porque la foto que uno acaba de elegir
 * se muestra desde la memoria del navegador antes de subirse.
 */
const REGLAS_DEL_NAVEGADOR = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', REGLAS_DEL_NAVEGADOR);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Y que el navegador no vuelva a pedir esto por http: la primera vez que
  // alguien entra escribiendo la dirección a mano, sin https, ese viaje va en
  // claro. Con esto el navegador se acuerda durante un año y ya no lo hace.
  // Solo cuando la petición llegó cifrada: en el computador de casa, donde se
  // prueba con http, ponerlo dejaría el sistema inalcanzable.
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Verificación de salud para plataformas de despliegue.
// Incluye la versión para poder comprobar qué código está realmente en línea.
const VERSION = require('../package.json').version;
app.get('/health', (req, res) => {
  // Además de responder, revisa lo que más falla en un servidor: que la base
  // conteste y que al volumen le quede espacio. Siempre devuelve 200 mientras
  // el sistema pueda contestar —el estado va en el contenido—, para que la
  // plataforma no esconda la explicación detrás de un error en blanco.
  // La zona horaria va en la salud del sistema a propósito: es lo único que
  // deja comprobar desde fuera —abriendo /health— que el servidor está
  // anotando con la hora de la iglesia y no con la del centro de datos.
  let zona = null;
  try {
    zona = require('./zona-horaria').ahora();
  } catch (e) {
    zona = { zona: '?', texto: e.message };
  }
  const salud = { ok: true, version: VERSION, base: 'ok', disco: null, sesiones: null, zona: zona.zona, hora: zona.texto };

  // Si las sesiones se firman con la llave de reserva, cualquiera que haya
  // visto el código puede fabricarse una de administrador. Se dice acá para
  // que se pueda comprobar desde el navegador, sin entrar al servidor.
  if (require('./auth').conLlavePropia) {
    salud.sesiones = 'firmadas con su propia llave';
  } else {
    salud.ok = false;
    salud.sesiones = 'SIN LLAVE PROPIA: falta la variable JWT_SECRET en el servidor';
  }

  try {
    db.prepare('SELECT COUNT(*) AS c FROM usuarios').get();
  } catch (e) {
    salud.ok = false;
    salud.base = e.message;
  }
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    const disco = fs.statfsSync(DATA_DIR);
    const libres = disco.bavail * disco.bsize;
    salud.disco = `${Math.round(libres / 1048576)} MB libres`;
    if (libres < 20 * 1048576) {
      salud.ok = false;
      salud.aviso = 'Queda muy poco espacio en el volumen: haga sitio antes de que el sistema no pueda guardar.';
    }
  } catch (e) {
    salud.ok = false;
    salud.disco = e.message;
  }
  res.json(salud);
});

// ---------- Autenticación ----------
app.use('/api/auth', authRouter);

// ---------- Configuración del sistema ----------
app.use('/api/configuracion', configuracionRouter);

// ---------- Metadatos: módulos visibles para el usuario y sus esquemas ----------
/** Porcentaje configurado de un campo que se calcula solo, para mostrarlo en vivo. */
function porcentajeVigente(calcula) {
  if (calcula.tipo !== 'porcentaje') return undefined;
  if (calcula.opcion) {
    const n = Number(ajustes.obtener(calcula.opcion));
    if (Number.isFinite(n)) return n;
  }
  return Number(calcula.porcentaje) || 0;
}

app.get('/api/meta', authRequired, (req, res) => {
  const mods = allModules()
    .filter((m) => can(req.user, m.name, 'view'))
    .map((m) => ({
      name: m.name,
      label: m.label,
      labelSingular: m.labelSingular,
      genero: m.genero || null,
      icon: m.icon,
      group: m.group,
      order: m.order,
      menu: m.menu !== false, // los que se ven dentro de otra ficha no ocupan lugar en el menú
      display: m.display,
      printable: !!m.printable,
      // Una pantalla propia del módulo, además de su listado y su ficha: hoy
      // el libro de la oficina de partes. La barra del listado ofrece el
      // enlace, así que se llega desde donde uno está mirando los documentos
      pantallaExtra: m.pantallaExtra || null,
      dateField: m.dateField || null,
      searchFields: m.searchFields,
      listFields: m.listFields,
      filterFields: m.filterFields,
      /**
       * Los filtros propios del módulo, para que la barra los ofrezca. Va solo
       * lo que hace falta para pintarlos: la condición SQL se queda en el
       * servidor, que es donde tiene que estar.
       */
      filtrosPropios: (m.filtrosPropios || []).map(({ nombre, label, tipo, ref }) => ({
        nombre, label, tipo: tipo || 'texto', ref: ref || null,
      })),
      // Si el módulo tiene fecha de nacimiento, se puede acotar por edad
      rangoDeEdad: (m.fields || []).some((f) => f.mostrarEdad),
      defaultSort: m.defaultSort,
      fields: [
        ...m.fields
          .filter((f) => !f.oculto)
          .map(({ name, label, type, required, options, sugerencias, ref, help, default: def, accept, showIf, optionsRoute, readonly, calcula, mostrarEdad, seccion, destacado, buscador, ancho, recorte, recorta, min, max, sensible, reservado, futuro }) => ({
            name, label, type, required: !!required, options: options || null,
            // Los límites viajan para que el formulario avise antes de mandar.
            // Quien manda igual —o escribe la dirección a mano— se topa con la
            // misma comprobación en el servidor, que es la que manda.
            min: min === undefined ? null : min, max: max === undefined ? null : max,
            // Si el campo admite fecha adelante, el calendario no le pone tope de hoy
            futuro: !!futuro,
            // Para que la pantalla sepa cuáles esconder cuando el servidor no
            // se los mandó a esta persona (ver server/sensibles.js). `sensible`
            // es la forma antigua de decir «reservado a los datos de salud».
            sensible: !!sensible,
            reservado: reservado || (sensible ? SALUD : null),
            sugerencias: sugerencias || null, ref: ref || null,
            help: help || null, default: def ?? null, accept: accept || null, showIf: showIf || null,
            optionsRoute: optionsRoute || null, readonly: !!readonly, mostrarEdad: !!mostrarEdad,
            seccion: seccion || null, destacado: !!destacado, ancho: ancho || null, recorte: recorte || null,
            recorta: recorta || null,
            buscador: buscador === undefined ? null : !!buscador,
            calcula: calcula ? { ...calcula, porcentaje: porcentajeVigente(calcula) } : null,
            computed: false,
          })).map(sinLoQueNoDiceNada),
        ...(m.computed || []).map(({ name, label, type, help, ordenarPor }) => sinLoQueNoDiceNada({
          name, label, type, help: help || null, computed: true, readonly: true,
          // Un calculado no se puede ordenar… salvo que diga por qué columna
          // se ordena en su lugar. La edad lo hace: por la fecha de nacimiento.
          ordenable: !!ordenarPor,
        })),
      ],
      perms: {
        view: can(req.user, m.name, 'view'),
        create: can(req.user, m.name, 'create'),
        edit: can(req.user, m.name, 'edit'),
        delete: can(req.user, m.name, 'delete'),
      },
    }));
  // Iglesia local en la que trabaja el usuario. Si no tiene una asignada pero
  // el sistema administra una sola, se muestra esa; con varias, "Todas".
  let iglesiaNombre = null;
  const suyas = alcance.iglesiasDe(req.user);
  // Entre cuáles puede elegir para trabajar, y con cuáles está trabajando
  const asignadas = alcance.iglesiasAsignadas(req.user);
  const puedeElegir = asignadas.length
    ? db.prepare(`SELECT id, nombre FROM iglesias WHERE id IN (${asignadas.map(() => '?').join(',')}) ORDER BY nombre`).all(...asignadas)
    : db.prepare('SELECT id, nombre FROM iglesias ORDER BY nombre').all();
  const trabajando = alcance.lista(req.user.iglesias_trabajando).filter((id) => puedeElegir.some((i) => i.id === id));
  const nombreDe = (id) => (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id) || {}).nombre;
  if (suyas.length === 1) {
    iglesiaNombre = nombreDe(suyas[0]) || null;
  } else if (suyas.length > 1) {
    const principal = alcance.iglesiaPrincipal(req.user);
    iglesiaNombre = principal
      ? `${nombreDe(principal)} y ${suyas.length - 1} más`
      : `${suyas.length} iglesias asignadas`;
  } else {
    const iglesias = db.prepare('SELECT id, nombre FROM iglesias LIMIT 2').all();
    if (iglesias.length === 1) iglesiaNombre = iglesias[0].nombre;
  }

  // Cuerpos asignados: lo que ve el usuario queda acotado a ellos
  const susCuerpos = alcance.cuerposDe(req.user).map((id) =>
    (db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(id) || {}).nombre
  ).filter(Boolean);

  /**
   * Las llaves del sistema que tiene esta persona, ya resueltas.
   *
   * La pantalla las necesita para saber qué mostrarle. Hasta la 1.67 preguntaba
   * «¿es administrador?», y por eso conceder los respaldos a una tesorera
   * funcionaba en el servidor —la dirección escrita a mano respondía— pero a
   * ella no le aparecía nada en el menú: un permiso concedido que no se veía.
   * Ahora viaja lo que de verdad puede, llave por llave.
   */
  const llaves = Object.fromEntries(
    LLAVES.map((l) => [l.name, l.acciones.filter((a) => can(req.user, l.name, a))])
  );

  /**
   * Catálogo para el editor de permisos personalizados.
   *
   * Lo necesita quien pueda tocar los permisos de otro: la ficha de un usuario
   * o la de un perfil. Antes se mandaba solo a los administradores, así que un
   * secretario con permiso de editar usuarios abría la ficha y el editor de
   * permisos le salía vacío.
   */
  let permisosCatalogo = null;
  if (can(req.user, 'usuarios', 'edit') || can(req.user, 'perfiles_permisos', 'view')) {
    // Los perfiles, para que el editor sepa de dónde sale lo que no se ajusta
    const perfiles = {};
    try {
      for (const p of db.prepare('SELECT id, nombre, permisos FROM perfiles_permisos').all()) {
        let tabla = {};
        try { tabla = JSON.parse(p.permisos || '{}') || {}; } catch (e) { tabla = {}; }
        perfiles[p.id] = { nombre: p.nombre, permisos: tabla };
      }
    } catch (e) { /* la tabla se crea al arrancar; si aún no está, van vacíos */ }

    permisosCatalogo = {
      acciones: ACCIONES,
      // Los módulos Y las llaves del sistema, para que en el editor se vea
      // exactamente lo que el sistema comprueba y no quede nada escondido
      modulos: todoLoQueSePuedePermitir(),
      porRol: Object.fromEntries(
        ROLES.map((r) => [
          r.value,
          Object.fromEntries(todoLoQueSePuedePermitir().map((m) => [m.name, permisosDelRol(r.value, m.name)])),
        ])
      ),
      perfiles,
    };
  }

  /**
   * Esta respuesta se vuelve a pedir en cada entrada y en cada recarga, y son
   * unos 180 KB de definiciones —32 módulos, 380 campos— que solo cambian
   * cuando cambia el sistema o los permisos de esa persona. Con una firma de
   * su contenido, el navegador que ya la tiene recibe «lo mismo de antes» y
   * no se baja nada: 17 KB menos por recarga, y sin arriesgar quedarse con
   * una versión vieja, porque si algo cambió la firma cambia.
   */
  const cuerpo = {
    modules: mods,
    roles: ROLES,
    permisosCatalogo,
    // En qué orden van los grupos del menú. Se manda desde acá y no se deduce
    // en la pantalla: ver server/grupos-del-menu.js.
    gruposDelMenu: require('./grupos-del-menu').GRUPOS_DEL_MENU,
    // La identidad de la institución: el nombre y el lema que se configuran
    institucion: {
      nombre: ajustes.obtener('iglesia_nombre') || '',
      lema: ajustes.obtener('iglesia_lema') || '',
      // El nombre del archivo del logo no se usa para pedirlo —eso va por
      // /api/configuracion/logo— sino para saber cuándo cambió y no quedarse
      // con el anterior guardado en el navegador
      logo: ajustes.obtener('iglesia_logo') || '',
      rut: ajustes.obtener('iglesia_rut') || '',
      direccion: ajustes.obtener('iglesia_direccion') || '',
      telefono: ajustes.obtener('iglesia_telefono') || '',
      email: ajustes.obtener('iglesia_email') || '',
      web: ajustes.obtener('iglesia_web') || '',
      pie_texto: ajustes.obtener('documento_pie_texto') || '',
    },
    // Ajustes que la interfaz necesita para trabajar (no son públicos)
    ajustes: {
      imagen_lado_maximo: Math.min(4000, Math.max(600, Number(ajustes.obtener('imagen_lado_maximo')) || 1600)),
      imagen_calidad: Math.min(100, Math.max(40, Number(ajustes.obtener('imagen_calidad')) || 88)),
      // Para proponer el vencimiento al escribir la fecha de entrega de una credencial
      credencial_vigencia_anios: ajustes.numero('credencial_vigencia_anios', 1, 20),
      asistencia_marca_inicial: ajustes.obtener('asistencia_marca_inicial') || 'Sin marcar',
    },
    user: {
      ...req.user,
      iglesia_nombre: iglesiaNombre,
      iglesias_asignadas: suyas.length,
      iglesias_disponibles: puedeElegir,
      iglesias_trabajando: trabajando,
      cuerpos_asignados: susCuerpos,
      llaves,
    },
  };

  const texto = JSON.stringify(cuerpo);
  const firma = `W/"${crypto.createHash('sha1').update(texto).digest('base64').slice(0, 22)}"`;
  res.setHeader('ETag', firma);
  res.setHeader('Cache-Control', 'private, no-cache'); // se revalida siempre, nunca se sirve a ciegas
  if (req.headers['if-none-match'] === firma) return res.status(304).end();
  res.type('application/json').send(texto);
});

// ---------- Panel de control ----------
app.get('/api/dashboard', authRequired, (req, res) => {
  const susIglesias = alcance.iglesiasDe(req.user);
  const susCuerpos = alcance.cuerposDe(req.user);
  const iglesiaId = alcance.iglesiaPrincipal(req.user);

  /** `WHERE` que deja solo lo que el usuario tiene asignado. */
  const filtro = (tabla, campoIglesia = 'iglesia_id') => {
    const cond = [];
    const params = [];
    if (susIglesias.length && campoIglesia) {
      cond.push(`${campoIglesia} IN (${susIglesias.map(() => '?').join(',')})`);
      params.push(...susIglesias);
    }
    if (susCuerpos.length && tabla === 'cuerpos') {
      cond.push(`id IN (${susCuerpos.map(() => '?').join(',')})`);
      params.push(...susCuerpos);
    }
    if (susCuerpos.length && tabla === 'miembros') {
      const ids = alcance.miembrosDeCuerpos(susCuerpos);
      cond.push(ids.length ? `id IN (${ids.map(() => '?').join(',')})` : '1 = 0');
      params.push(...ids);
    }
    return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
  };

  const scoped = (table, hasIglesia = true) => {
    const { sql, params } = filtro(table, hasIglesia ? 'iglesia_id' : null);
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}" ${sql}`).get(...params).c;
  };

  const counts = {
    iglesias: susIglesias.length || scoped('iglesias', false),
    miembros: scoped('miembros'),
    cuerpos: scoped('cuerpos'),
    pastores: scoped('pastores'),
    /*
     * TODO LO QUE SIGUE ABIERTO, no solo lo pendiente y lo en revisión.
     *
     * El contador nombraba dos estados a mano y dejaba fuera el tercero: una
     * solicitud parada esperando un papel desaparecía del panel aunque siguiera
     * abierta y fuera justamente la que había que destrabar. La lista sale del
     * propio módulo (CERRADOS), así que no puede volver a quedar corta cuando
     * se agregue o se cambie un estado.
     */
    solicitudes_pendientes: (() => {
      const { sql, params } = filtro('solicitudes');
      const donde = sql ? `${sql} AND` : 'WHERE';
      const cerrados = require('./modules/solicitudes').CERRADOS;
      const huecos = cerrados.map(() => '?').join(',');
      return db.prepare(`SELECT COUNT(*) AS c FROM solicitudes ${donde} estado NOT IN (${huecos})`)
        .get(...params, ...cerrados).c;
    })(),
    /*
     * Y cuántas de esas ya debían estar contestadas. Es la misma regla del
     * recordatorio y de la bandeja (ver server/avisos/vigia.js): el plazo que
     * se comprometió, o —sin él— el general de Configuración.
     */
    solicitudes_vencidas: (() => {
      const { sql, params } = filtro('solicitudes');
      const donde = sql ? `${sql} AND` : 'WHERE';
      const cerrados = require('./modules/solicitudes').CERRADOS;
      const huecos = cerrados.map(() => '?').join(',');
      const dias = require('./ajustes').numero('avisos_solicitud_dias', 1, 120);
      return db.prepare(
        `SELECT COUNT(*) AS c FROM solicitudes ${donde} estado NOT IN (${huecos})
           AND CASE WHEN COALESCE(fecha_compromiso, '') <> ''
                      THEN fecha_compromiso < date('now','localtime')
                    ELSE fecha <= date('now','localtime', ?) END`
      ).get(...params, ...cerrados, `-${dias} days`).c;
    })(),
    certificados: scoped('certificados'),
  };

  let finanzas = null;
  if (can(req.user, 'tesoreria', 'view')) {
    const mes = new Date().toISOString().slice(0, 7); // YYYY-MM
    const marcas = susIglesias.map(() => '?').join(',');
    // El resumen no puede sumar plata que esa persona no puede ver: quien no
    // alcanza la tesorería de los cuerpos vería su total sin poder abrir un
    // solo movimiento que lo explique (ver server/tesorerias.js).
    const porNivel = require('./tesorerias').condicion(getModule('tesoreria'), req.user);
    const w = `${susIglesias.length ? `AND iglesia_id IN (${marcas})` : ''}${porNivel ? ` AND ${porNivel}` : ''}`;
    const p = susIglesias;
    /**
     * Las cuatro sumas salen de una sola pasada por la tabla.
     *
     * Eran cuatro consultas, y cada una recorría los movimientos enteros: el
     * mismo trabajo hecho cuatro veces para responder cuatro preguntas sobre
     * las mismas filas. Preguntándolas todas juntas, la base pasa una vez.
     *
     * Ojo con los totales «de siempre»: no tienen tope y crecen con cada
     * movimiento que se registre, así que esta consulta se irá poniendo más
     * lenta con los años aunque nadie toque el código.
     */
    const sumas = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' AND substr(fecha,1,7) = ? THEN monto END), 0) AS ingresos_mes,
                COALESCE(SUM(CASE WHEN tipo = 'Egreso'  AND substr(fecha,1,7) = ? THEN monto END), 0) AS egresos_mes,
                COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto END), 0) AS ingresos_total,
                COALESCE(SUM(CASE WHEN tipo = 'Egreso'  THEN monto END), 0) AS egresos_total
           FROM tesoreria WHERE 1 = 1 ${w}`
      )
      .get(mes, mes, ...p);
    finanzas = { mes, ...sumas };
    finanzas.balance_total = finanzas.ingresos_total - finanzas.egresos_total;
  }

  // Próximos cumpleaños: se calculan desde el mes y el día de nacimiento,
  // tomando el próximo que venga (hoy cuenta como cumpleaños de hoy).
  const cumpleanos = require('./cumpleanos').proximosCumpleanos(
    susIglesias, susCuerpos, ajustes.numero('cumpleanos_cantidad', 1, 20));

  // Solo las iglesias que alcanza quien está mirando
  const marcas2 = susIglesias.map(() => '?').join(',');
  const w2 = susIglesias.length ? `WHERE iglesia_id IN (${marcas2})` : '';
  const p2 = susIglesias;
  const solicitudesRecientes = db
    .prepare(`SELECT id, fecha, solicitante, asunto, estado FROM solicitudes ${w2} ORDER BY fecha DESC LIMIT 5`)
    .all(...p2);

  /**
   * Las credenciales que hay que renovar (punto 10.4).
   *
   * Una credencial vencida no avisa sola: el papel sigue en el bolsillo del
   * pastor y se ve igual de bien el día antes y el día después. Por eso el
   * aviso va en el panel, que es lo primero que se abre, y con sesenta días de
   * anticipación: alcanza a emitirse la nueva antes de que la vieja deje de
   * servir.
   *
   * Solo lo ve quien puede ver credenciales, y solo las de las iglesias que
   * tiene asignadas: el filtro es el mismo de la pantalla de credenciales.
   */
  const credencialesPorVencer = can(req.user, 'credenciales', 'view')
    ? getModule('credenciales').porVencer(req.user)
    : [];

  res.json({ counts, finanzas, cumpleanos, solicitudesRecientes, credencialesPorVencer });
});


/**
 * Lo que falta por llenar en las fichas de miembros.
 *
 * Pide poder ver Miembros y se acota a lo que esa persona alcanza, igual que
 * el listado: el secretario de un cuerpo ve lo que falta en su cuerpo.
 */
app.get('/api/pendientes', authRequired, (req, res) => {
  if (!can(req.user, 'miembros', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para ver Miembros' });
  }
  res.json(pendientes.resumen(req.user));
});

/**
 * Lo que quedó colgando de borrados anteriores.
 *
 * Hasta la versión 1.59 nada impedía que borrar un cuerpo dejara en pie sus
 * fichas de integrante, ni que borrar un miembro dejara sus marcas de
 * asistencia sumando en los porcentajes. Desde ahora no vuelve a pasar, pero
 * lo que ya quedó de antes sigue ahí, y esto lo pone a la vista para poder
 * decidir qué hacer con ello. Solo cuenta: no toca nada.
 */
/**
 * El buscador general: una sola caja para encontrar cualquier cosa.
 *
 * Responde con lo mismo que esta persona podría abrir por su cuenta: solo los
 * módulos que puede ver, solo dentro de su alcance y sin datos reservados
 * (ver server/buscador.js).
 */
app.get('/api/buscar', authRequired, (req, res) => {
  res.json(require('./buscador').buscar(req.query.q, req.user));
});

app.get('/api/huerfanos', authRequired, (req, res) => {
  if (!can(req.user, 'sistema_configuracion', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para revisar la configuración del sistema' });
  }
  res.json(require('./dependencias').huerfanas(db));
});

// ---------- Carga de archivos ----------
/**
 * Lo que puede pesar un archivo que se sube.
 *
 * Se lee en cada subida y no una sola vez al arrancar: es un ajuste de la
 * pantalla de configuración, y si se guardara al inicio habría que reiniciar
 * el servidor para que un cambio surtiera efecto.
 */
const topeDeArchivo = () => ajustes.numero('archivo_tope_mb', 1, 50) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  },
});

/**
 * El formato se revisa antes de escribir nada en el disco.
 *
 * Un archivo que no corresponde ni siquiera llega a guardarse: multer corta
 * la subida acá mismo. El contenido se revisa después, ya en el disco, donde
 * están los bytes que hay que mirar.
 */
const elPortero = () => multer({
  storage,
  limits: { fileSize: topeDeArchivo() },
  fileFilter: (req, file, cb) => {
    const veredicto = tiposDeArchivo.seAcepta(file.originalname, null);
    if (!veredicto.ok) return cb(Object.assign(new Error(veredicto.motivo), { deFormato: true }));
    cb(null, true);
  },
});

/** Los primeros bytes de un archivo recién guardado, para revisar qué es. */
function primerosBytes(ruta, cuantos = 16) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const buffer = Buffer.alloc(cuantos);
    const leidos = fs.readSync(fd, buffer, 0, cuantos, 0);
    return buffer.slice(0, leidos);
  } catch (e) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * ¿Esta persona tiene algo donde adjuntar un archivo?
 *
 * La subida pedía sesión y nada más, así que un usuario de «solo consulta»
 * —que no puede crear ni un registro— podía escribir en el volumen: se
 * comprobó, y respondía 200. El daño era acotado (son usuarios de la casa, y
 * hay una barrida que borra a los siete días lo que no quedó enganchado a
 * ninguna ficha), pero quien solo puede mirar no tiene por qué poder escribir.
 *
 * La pregunta que se hace es la que importa: ¿hay algún módulo con campos de
 * archivo donde esta persona pueda crear o editar? Si no lo hay, no tiene
 * dónde poner lo que suba.
 */
function puedeAdjuntarAlgo(usuario) {
  // Quien puede cambiar la configuración tiene dónde: el logo de la institución
  if (can(usuario, 'sistema_configuracion', 'edit')) return true;
  return allModules().some(
    (m) => m.fields.some((f) => f.type === 'file') && (can(usuario, m.name, 'create') || can(usuario, m.name, 'edit'))
  );
}

app.post('/api/upload', authRequired, (req, res) => {
  if (!puedeAdjuntarAlgo(req.user)) {
    return res.status(403).json({ error: 'No tiene dónde adjuntar un archivo: su cuenta es de solo consulta.' });
  }
  elPortero().single('archivo')(req, res, (err) => {
    if (err) {
      if (err.deFormato) return res.status(400).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `El archivo pesa más de ${topeDeArchivo() / 1024 / 1024} MB. Redúzcalo o guárdelo con menos calidad.`,
        });
      }
      return res.status(400).json({ error: `No se pudo subir el archivo: ${err.message}` });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    // Una foto tiene que ser una foto: llamarle «foto.jpg» a otra cosa no basta
    const veredicto = tiposDeArchivo.seAcepta(req.file.originalname, primerosBytes(req.file.path));
    if (!veredicto.ok) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* si ya no está, mejor */ }
      return res.status(400).json({ error: veredicto.motivo });
    }

    res.json({ filename: req.file.filename, original: req.file.originalname, url: `/uploads/${req.file.filename}` });
  });
});

/**
 * Los archivos subidos: fotos, carnets, certificados, actas escaneadas.
 *
 * Antes se entregaban a quien los pidiera. Ahora hay que tener sesión abierta
 * y que el archivo pertenezca a algo que esa persona pueda ver (ver
 * server/archivos.js). Se sirven con caché privada: el navegador de cada uno
 * guarda los suyos —una foto no cambia—, pero ningún intermediario los
 * comparte con otro.
 */
app.get('/uploads/:archivo', authRequired, (req, res) => {
  const nombre = path.basename(String(req.params.archivo)); // nunca salir de la carpeta
  const permiso = archivos.puedeVer(nombre, req.user);
  if (!permiso.ok) return res.status(403).json({ error: permiso.motivo });
  // El tipo lo pone el sistema desde su propia lista, nunca el nombre del
  // archivo, y solo las fotos y los PDF se abren en pantalla (ver
  // server/tiposdearchivo.js)
  const cabeceras = { 'Cache-Control': 'private, max-age=86400', ...tiposDeArchivo.comoSeEntrega(nombre) };
  res.sendFile(path.join(UPLOADS_DIR, nombre), { headers: cabeceras }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Archivo no encontrado' });
  });
});

// ---------- Verificación pública de una credencial (sección 9) ----------
/**
 * `/v/<serie>?c=<codigo>`: la página que se abre al escanear el QR.
 *
 * Es la única parte del sistema que atiende SIN SESIÓN y muestra datos de una
 * persona, así que va contada aparte y con sus propias reglas:
 *
 *   · el código de autenticidad decide. Sin él —o con uno cambiado— no sale
 *     ningún dato, ni siquiera si esa serie existe (punto 9.2);
 *   · el RUT no sale entero (punto 9.4);
 *   · hay tope de consultas por minuto desde una misma dirección, para que
 *     probar números al azar no lleve a ninguna parte (punto 9.6);
 *   · y no la indexa ningún buscador: la página lleva `noindex` y acá va la
 *     cabecera que dice lo mismo, por si alguien se salta el HTML.
 *
 * Va antes de la carpeta pública y del comodín final: `/v/...` no es una
 * pantalla del programa, es una página aparte que se arma en el servidor.
 *
 * Y sigue atendiendo con el sistema en mantenimiento, a propósito: el
 * mantenimiento frena a quien entra a trabajar, no a quien está parado en la
 * puerta de una iglesia con una credencial en la mano. Si se cortara, una
 * credencial buena aparecería como no verificable mientras dure el arreglo,
 * que es peor que cualquier cosa que el mantenimiento vaya a resolver.
 */
const credencialesDef = getModule('credenciales');
const verificacion = require('./credenciales/verificacion');
const paginaDeVerificacion = require('./credenciales/pagina');
const limiteDeVerificacion = require('./credenciales/limite');

/** La credencial de un número de serie, sin mirar de quién es ni de qué iglesia. */
const credencialPorSerie = (numero) =>
  db.prepare('SELECT * FROM credenciales WHERE serie = ?').get(String(numero));

/**
 * Lo mismo que hace la página, para poder usarlo también en la foto.
 *
 * Devuelve `null` cuando hay que cortar —y ya dejó contestado el porqué en la
 * respuesta— o el resultado de la verificación cuando se puede seguir.
 *
 * El orden importa: primero se mira si la dirección está frenada, y recién
 * después se busca en la base. A quien está probando números no se le hace ni
 * una consulta.
 */
function verificarLaDeLaUrl(req, res, comoContestar) {
  const espera = limiteDeVerificacion.cuantoLeFalta(req.ip);
  if (espera) {
    res.status(429).setHeader('Retry-After', String(espera));
    comoContestar.demasiadas(espera);
    return null;
  }
  const resultado = verificacion.verificar(req.params.serie, req.query.c, {
    buscar: credencialPorSerie,
    situacionDe: credencialesDef.situacionDe,
  });
  if (!resultado.valida) {
    // Solo se cobran los errores: verificar credenciales de verdad no gasta
    limiteDeVerificacion.anotarFallo(req.ip);
    comoContestar.noValida();
    return null;
  }
  return resultado;
}

/** Cabeceras comunes: no se guarda en ningún lado y no la indexa nadie. */
function sinRastro(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

app.get('/v/:serie', (req, res) => {
  sinRastro(res);
  const institucion = ajustes.obtener('iglesia_nombre') || '';
  const paginaNoValida = () => res.status(404).type('html').send(paginaDeVerificacion.noValida(institucion));

  const resultado = verificarLaDeLaUrl(req, res, {
    noValida: paginaNoValida,
    demasiadas: (segundos) => res.type('html').send(paginaDeVerificacion.demasiadas(segundos, institucion)),
  });
  if (!resultado) return;

  // La foto se pide aparte y con el mismo código: no viaja dentro de la página
  const direccionDeLaFoto =
    `/v/${encodeURIComponent(req.params.serie)}/foto?c=${encodeURIComponent(String(req.query.c || ''))}`;
  res.type('html').send(paginaDeVerificacion.valida(resultado, { institucion, direccionDeLaFoto }));
});

/**
 * La fotografía del titular, para la página de verificación.
 *
 * No puede ir por `/uploads`, que pide sesión y con razón. Va por acá, y acá
 * el permiso lo da el mismo código de autenticidad que abrió la página: quien
 * no lo tiene no ve la foto, y quien lo tiene ya vio la credencial entera.
 *
 * Se entrega SOLO el archivo que esa credencial tiene anotado como suyo. No se
 * acepta un nombre de archivo por la dirección, así que no hay forma de pedir
 * por acá ningún otro documento del sistema.
 */
app.get('/v/:serie/foto', (req, res) => {
  sinRastro(res);
  const cortar = (estado) => res.status(estado).type('txt').send('');
  const resultado = verificarLaDeLaUrl(req, res, {
    noValida: () => cortar(404),
    demasiadas: () => cortar(429),
  });
  if (!resultado) return;
  if (!resultado.foto) return cortar(404);

  const nombre = path.basename(String(resultado.foto));
  const cabeceras = { 'Cache-Control': 'no-store', ...tiposDeArchivo.comoSeEntrega(nombre) };
  res.sendFile(path.join(UPLOADS_DIR, nombre), { headers: cabeceras }, (err) => {
    if (err && !res.headersSent) cortar(404);
  });
});

// ---------- Respaldo: bajarse todo el sistema en un archivo ----------
/**
 * El respaldo lleva absolutamente todo, así que hace falta la llave.
 *
 * Antes decía «solo si el rol es admin», y eso obligaba a hacer administrador
 * general a quien solo tenía que bajarse la copia una vez al mes. Ahora es un
 * permiso que se concede en la ficha de la persona; por defecto sigue siendo
 * solo del administrador (ver LLAVES en server/permissions.js).
 */
function conLlaveDeRespaldo(accion) {
  return (req, res, next) => {
    if (!can(req.user, 'sistema_respaldo', accion)) {
      return res.status(403).json({ error: 'No tiene permiso sobre los respaldos del sistema' });
    }
    next();
  };
}
const soloAdministrador = conLlaveDeRespaldo('view');

/**
 * A dónde se está yendo el espacio del volumen.
 *
 * El «MB libres» de /health dice que queda poco pero no dice de qué. Esto lo
 * reparte: la base, los documentos, los respaldos y lo libre, más cuánto pesa
 * un documento en promedio y cuántos más caben (ver server/disco.js).
 */
app.get('/api/disco', authRequired, (req, res, next) => {
  if (!can(req.user, 'sistema_configuracion', 'view')) {
    return res.status(403).json({ error: 'No tiene permiso para revisar la configuración del sistema' });
  }
  next();
}, (req, res) => {
  res.json(require('./disco').estado());
});

app.get('/api/respaldo/info', authRequired, soloAdministrador, (req, res) => {
  res.json({ ...respaldo.tamano(), nombre: respaldo.nombreDelPaquete(), bajada: respaldo.estadoDeLaBajada() });
});

app.get('/api/respaldo', authRequired, soloAdministrador, async (req, res) => {
  try {
    res.locals.usuarioId = req.user.id; // para anotar quién lo bajó
    await respaldo.enviar(res);
  } catch (e) {
    console.error('⚠️  No se pudo armar el respaldo:', e);
    if (!res.headersSent) res.status(500).json({ error: `No se pudo armar el respaldo: ${e.message}` });
  }
});

/**
 * El respaldo que se hace solo: cómo va y qué copias hay guardadas.
 *
 * Existe para que no haya que creerle al sistema: se ve la fecha de la última
 * copia, cuántas se conservan y lo que pesa cada una, y se puede bajar
 * cualquiera de ellas.
 */
app.get('/api/respaldo/automatico', authRequired, soloAdministrador, (req, res) => {
  // Va junto el estado de la copia que se baja a mano: es la única que sale
  // del servidor, y el panel las muestra en el mismo lugar porque la pregunta
  // que responden es la misma —¿estamos respaldados?—.
  res.json({ ...respaldoAutomatico.estado(), bajada: respaldo.estadoDeLaBajada() });
});

/** Hacer la copia ahora mismo, sin esperar a la noche. */
app.post('/api/respaldo/automatico', authRequired, conLlaveDeRespaldo('create'), async (req, res) => {
  const hecho = await respaldoAutomatico.hacerCopia({ forzada: true });
  if (!hecho.hecho) return res.status(500).json({ error: `No se pudo hacer la copia: ${hecho.motivo}` });
  res.json({ ...hecho, estado: respaldoAutomatico.estado() });
});

/** Bajarse una de las copias guardadas. */
app.get('/api/respaldo/automatico/:archivo', authRequired, soloAdministrador, (req, res) => {
  const ruta = respaldoAutomatico.rutaDe(req.params.archivo);
  if (!ruta) return res.status(404).json({ error: 'Esa copia ya no está' });
  res.download(ruta, path.basename(ruta));
});

// ---------- Importación masiva desde archivos ----------
app.use('/api/importar', importarRouter);

// ---------- Traspaso desde el sistema anterior ----------
app.use('/api/importacion', require('./importacion/web').router);

// ---------- Avisos: la campanita, las preferencias y los aparatos ----------
// Va ANTES del CRUD genérico: si no, «/api/avisos» lo tomaría el motor como si
// fuera un módulo llamado «avisos» y respondería que no existe.
app.use('/api', require('./avisos/rutas'));

// ---------- CRUD genérico de todos los módulos ----------
app.use('/api', buildRouter());

// ---------- Frontend ----------
/**
 * Los archivos del programa (el guion, los estilos, los iconos) no cambian
 * hasta que se publica una versión nueva, así que el navegador los guarda por
 * una semana y deja de pedirlos en cada visita: quien entra dos veces al día
 * solo descarga los datos. Se llaman con el número de versión detrás
 * (app.js?v=1.43.1), que es lo que hace que al publicar una versión nueva
 * todos reciban la nueva y no la guardada.
 *
 * La página que los llama —index.html— no se guarda nunca, para que ese
 * número de versión siempre llegue fresco.
 */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UNA_SEMANA = 7 * 24 * 60 * 60 * 1000;
const PAGINA = fs
  .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replace(/__VERSION__/g, encodeURIComponent(VERSION));
/** La página del sistema, con el número de versión ya puesto. */
const paginaPrincipal = (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(PAGINA);
};
app.get('/index.html', paginaPrincipal);

/**
 * Cuánto puede guardar el navegador cada archivo.
 *
 * Se dice UNA sola vez y la usan los dos repartos —el de las copias ya
 * apretadas y el de siempre—, para que no puedan terminar diciendo cosas
 * distintas sobre el mismo archivo.
 */
const cabecerasDelArchivo = (res, ruta) => {
  if (ruta.endsWith('.html') || ruta.endsWith('.webmanifest')) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  // El ayudante de los avisos se pide SIN número de versión detrás —el
  // navegador lo busca siempre en la misma dirección—, así que si se
  // guardara una semana, un arreglo suyo no llegaría hasta la otra semana.
  if (ruta.endsWith('avisos-sw.js')) {
    res.setHeader('Cache-Control', 'no-cache');
    // Que pueda controlar todo el sitio y no solo su carpeta
    res.setHeader('Service-Worker-Allowed', '/');
    return;
  }
  // El programa y los estilos se piden con la versión en la dirección
  // (?v=1.53.0), así que al publicar una versión nueva la dirección cambia
  // y el navegador se la baja igual. Como la dirección de una versión ya
  // nunca cambia de contenido, se marca «immutable»: el navegador deja de
  // preguntar si sigue vigente y se ahorra ese viaje en cada visita.
  res.setHeader('Cache-Control', `public, max-age=${UNA_SEMANA / 1000}, immutable`);
};

// Las copias bien apretadas van primero: ver server/apretados.js
app.use(apretados.servidorApretado(PUBLIC_DIR, cabecerasDelArchivo));
app.use(
  express.static(PUBLIC_DIR, {
    index: false, // la página la arma paginaPrincipal, con la versión puesta
    maxAge: UNA_SEMANA,
    setHeaders: cabecerasDelArchivo,
  })
);
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  paginaPrincipal(req, res);
});

/**
 * Lo que se responde cuando algo falla de forma inesperada.
 *
 * Antes se devolvía `err.message` tal cual, que en un error de base de datos
 * nombra tablas y columnas. Eso no le sirve de nada a quien está usando el
 * sistema y sí le sirve a quien esté mirando dónde meter mano. El detalle
 * completo va al registro del servidor, que es donde hay que ir a buscarlo, y
 * con una marca para poder aparearlos: si alguien avisa que le salió el error
 * «a las 11:20, número 8f3a», se encuentra en el registro sin adivinar.
 */
app.use((err, req, res, next) => {
  const marca = crypto.randomBytes(2).toString('hex');
  console.error(`[${marca}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({
    error: `Hubo un problema al procesar esto (n.º ${marca}). Vuelva a intentarlo; si sigue pasando, dele ese número a quien administra el sistema.`,
  });
});

/**
 * El arranque no se detiene por un tropiezo al preparar los datos.
 *
 * Antes, si una migración o la carga inicial fallaban, el proceso moría antes
 * de escuchar y la plataforma respondía "Application failed to respond": nadie
 * podía entrar y no se veía por qué. Ahora se anota el problema y el sistema
 * levanta igual, para poder entrar a revisarlo.
 */
function prepararDatos() {
  /*
   * La zona horaria va PRIMERO, antes que nada que escriba una fecha.
   *
   * Las migraciones, los datos iniciales y el respaldo automático estampan
   * horas apenas corren; si la zona se pusiera después, esas primeras filas
   * quedarían con la hora del servidor y no con la de la iglesia. Se anota
   * cuál quedó puesta: si un día vuelve a estar mal, se ve en el arranque en
   * vez de descubrirse meses después mirando fechas torcidas.
   */
  try {
    const zonaHoraria = require('./zona-horaria');
    zonaHoraria.aplicar();
    const { texto } = zonaHoraria.ahora();
    console.log(`🕒 Hora del sistema: ${texto} (${zonaHoraria.cual()})`);
  } catch (e) {
    console.error(`⚠️  No se pudo fijar la zona horaria: ${e.message}`);
  }

  try {
    ejecutarMigraciones();
  } catch (e) {
    console.error(`⚠️  Las migraciones no se pudieron completar: ${e.message}`);
  }
  try {
    ensureSeed();
  } catch (e) {
    console.error(`⚠️  Los datos iniciales no se pudieron crear: ${e.message}`);
  }
  try {
    respaldoAutomatico.programar();
  } catch (e) {
    console.error(`⚠️  El respaldo automático no quedó programado: ${e.message}`);
  }

  try {
    require('./avisos/vigia').empezar();
  } catch (e) {
    // El sistema tiene que levantar aunque los avisos no anden: sin ellos se
    // trabaja igual, y quien entra ve todo lo de siempre en el panel.
    console.error(`⚠️  Los avisos del día no quedaron programados: ${e.message}`);
  }
}

prepararDatos();

// Un error no atrapado no debe tumbar el servidor: se anota y se sigue
process.on('uncaughtException', (e) => console.error('⚠️  Error no atrapado:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('⚠️  Promesa rechazada sin atender:', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sistema de Gestión de Iglesias v${VERSION} escuchando en el puerto ${PORT}`);
  console.log('   (al publicar en internet, este puerto debe coincidir con el "Target port" del dominio)');
  // Recién ahora, con el servidor ya atendiendo, se aprietan bien los archivos
  // grandes. Mientras eso ocurre se sigue repartiendo como siempre, así que el
  // arranque no se retrasa ni un instante: ver server/apretados.js
  apretados
    .prepararApretados(PUBLIC_DIR)
    .then(() => {
      const cuantos = apretados.GUARDADOS.size;
      if (cuantos) console.log(`   ${cuantos} archivo(s) listos para mandarse bien apretados`);
    })
    .catch((e) => console.error('No se pudieron apretar los archivos:', e.message));
});
