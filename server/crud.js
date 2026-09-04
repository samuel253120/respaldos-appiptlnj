/**
 * CRUD genérico dirigido por esquemas.
 *
 * Para cada módulo registrado publica automáticamente:
 *   GET    /api/:modulo            lista (búsqueda, filtros, orden, paginación)
 *   GET    /api/:modulo/options    opciones {id, label} para selectores de referencia
 *   GET    /api/:modulo/:id        detalle
 *   POST   /api/:modulo            crear
 *   PUT    /api/:modulo/:id        actualizar
 *   DELETE /api/:modulo/:id        eliminar
 *
 * Reglas transversales:
 * - Permisos según la matriz de roles (permissions.js).
 * - Alcance por iglesia: usuarios con iglesia asignada solo operan sobre sus
 *   registros (módulos con campo iglesia_id).
 * - Campos ref se devuelven acompañados de `<campo>_label` con el texto de
 *   presentación del registro referido.
 * - Campos multiref se almacenan como JSON (arreglo de ids) y se devuelven
 *   como arreglo, con `<campo>_labels`.
 * - Hooks por módulo: beforeSave(data, { user, isNew, id }) permite validar o
 *   transformar (p. ej. usuarios cifra la contraseña); afterSave(fila, { user,
 *   isNew, existing, db }) actúa con el registro ya guardado y con el que había
 *   antes (p. ej. un traspaso deja al día sus dos movimientos, y una solicitud
 *   anota en su historial qué cambió).
 */
const express = require('express');
const { db } = require('./db');
const { getModule, allModules, displayOf } = require('./registry');
const { authRequired, requirePerm } = require('./auth');
const rut = require('./rut');
const { can } = require('./permissions');
const planilla = require('./planilla');
const busqueda = require('./busqueda');
const archivos = require('./archivos');
const sensibles = require('./sensibles');
const tesorerias = require('./tesorerias');

/**
 * Tope de filas de una planilla. No es una limitación real —una iglesia con
 * más de veinte mil registros en un solo módulo no existe— sino un freno por
 * si alguien pide el listado entero de una tabla que creció sin que nadie
 * mirara: mejor una planilla grande que un servidor sin memoria.
 */
/**
 * Tope de filas de una planilla. Se lee en cada bajada, no al arrancar: es un
 * ajuste de la pantalla de configuración y tiene que valer en cuanto se cambia.
 */
const topeDePlanilla = () => require('./ajustes').numero('planilla_tope_filas', 100, 100000);
const bitacora = require('./bitacora');
const alcance = require('./alcance');
const dependencias = require('./dependencias');
const fechas = require('./fechas');
// Que un desplegable no admita lo que no ofrece (ver server/opciones.js)
const opciones = require('./opciones');

/**
 * Un dato que no cuadra, no una avería: lo que un módulo devuelve desde su
 * hook para negarse a guardar. Se lanza para que la transacción se deshaga
 * entera, y afuera se convierte en el aviso que ve la persona.
 */
class ErrorDeDatos extends Error {}

/** El nombre de quien guardó por última vez, para poder decírselo al otro. */
function nombreDeUsuario(id) {
  if (!id) return null;
  try {
    const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
    return (u && u.nombre) || null;
  } catch (e) {
    return null;
  }
}

function fieldMap(def) {
  const m = {};
  for (const f of def.fields) m[f.name] = f;
  return m;
}

function isChurchScoped(def) {
  return def.fields.some((f) => f.name === 'iglesia_id');
}

/**
 * Los ids de un campo de varios (multiref), o un error si lo que llegó no es
 * una lista.
 *
 * POR QUÉ ESTO SE NIEGA EN VEZ DE ARREGLARLO SOLO. Hasta la 1.96.1 acá decía
 * `Array.isArray(value) ? value : []`: cualquier cosa que no fuera una lista
 * se guardaba como lista VACÍA, con un 200 y sin una palabra. Y en el campo
 * «Iglesias que administra» de un usuario, vacío no significa «ninguna»:
 * significa TODAS, como dice la ayuda del propio campo.
 *
 * O sea que una restricción mal escrita no fallaba: abría. Comprobado
 * mandando `{"iglesias": "[1]"}` —el texto en vez de la lista, que es la
 * equivocación natural de cualquier programa que no sea esta pantalla—: se
 * guardó vacío, respondió 200, y la secretaria pasó de ver los 8 miembros de
 * su iglesia a ver los 12 de las dos.
 *
 * Un permiso que se equivoca tiene que equivocarse hacia el lado que cierra, y
 * sobre todo tiene que DECIRLO. Así que ahora:
 *
 *   · una lista de verdad se acepta —es lo que manda la pantalla—;
 *   · un texto que sea una lista bien escrita también, porque es exactamente
 *     la forma en que el propio sistema la guarda y la devuelve;
 *   · cualquier otra cosa se rechaza con un aviso que dice qué llegó.
 *
 * Vaciar a propósito sigue siendo posible y no pasa por acá: `coerce` atiende
 * antes el vacío, el nulo y el campo que no viene, y para esos guarda nulo.
 * Lo que no se puede es vaciar sin querer.
 *
 * También se rechaza la lista cuyos elementos no son ids. `["x","y"]` daba
 * una lista vacía por el mismo camino y con el mismo resultado: dejaba de
 * acotar. Si algo se pidió y no se entiende, se dice; no se guarda a medias.
 */
function comoListaDeIds(field, value) {
  const cual = field.label || field.name;
  let lista = value;

  if (typeof lista === 'string') {
    try {
      lista = JSON.parse(lista);
    } catch (e) {
      lista = null;
    }
  }

  if (!Array.isArray(lista)) {
    throw new ErrorDeDatos(
      `El campo "${cual}" espera una lista de registros y llegó otra cosa. ` +
        'No se guarda vacío para no dejar sin efecto lo que se quiso poner.'
    );
  }

  const ids = [];
  const noSirven = [];
  for (const suelto of lista) {
    const n = Number(suelto);
    if (Number.isInteger(n) && n > 0) ids.push(n);
    else noSirven.push(String(suelto));
  }

  if (noSirven.length) {
    throw new ErrorDeDatos(
      `El campo "${cual}" trae ${noSirven.length} valor(es) que no son un registro: ` +
        `${noSirven.slice(0, 5).join(', ')}. Corrija esos y vuelva a guardar.`
    );
  }

  return ids;
}

/**
 * Las referencias de este guardado que apuntan a un registro que no existe.
 *
 * POR QUÉ HACÍA FALTA. Un campo de referencia guarda el número de otro
 * registro: el cuerpo de un documento, el miembro de una anotación de
 * bitácora, la cuenta de un movimiento. Hasta la 1.97.2 nadie comprobaba que
 * ese número correspondiera a algo. Se podía guardar un documento del cuerpo
 * 88.888 y quedaba anotado tal cual; al abrirlo, donde va el nombre del cuerpo
 * salía «#88888».
 *
 * No es que la comprobación no existiera: existía DOS VECES, escrita a mano
 * para el cónyuge de un miembro y para el de un pastor. Dos excepciones en un
 * sistema con más de cien referencias declaradas. Lo que faltaba era hacerlo
 * donde se hace una sola vez y vale para todas.
 *
 * SOLO SE MIRA LO QUE ESTE GUARDADO ESTÁ CAMBIANDO, igual que con las fechas.
 * Una ficha que ya venía con una referencia rota —de una importación vieja, de
 * un borrado anterior a que el sistema los siguiera— se tiene que poder seguir
 * guardando para corregirle el teléfono. La comprobación frena el guardado que
 * empeora las cosas, no el que simplemente no arregla algo que ya estaba.
 *
 * Se pregunta UNA VEZ POR TABLA y no una vez por referencia: una ficha de
 * miembro puede apuntar tres veces a Miembros, y son tres números que se
 * buscan juntos.
 */
function referenciasRotas(def, data) {
  /** tabla → { ids que hay que comprobar, y de qué campo salió cada uno } */
  const porTabla = new Map();

  const anotar = (campo, ids) => {
    const destino = getModule(campo.ref);
    if (!destino) return; // un módulo que declara un destino que no existe: no es cosa del dato
    if (!porTabla.has(destino.name)) porTabla.set(destino.name, { destino, ids: new Map() });
    const bolsa = porTabla.get(destino.name).ids;
    for (const id of ids) if (!bolsa.has(id)) bolsa.set(id, campo);
  };

  for (const f of def.fields) {
    if ((f.type !== 'ref' && f.type !== 'multiref') || !f.ref) continue;
    const valor = data[f.name];
    if (valor === undefined || valor === null || valor === '') continue; // no se está tocando
    if (f.type === 'ref') anotar(f, [Number(valor)].filter((n) => Number.isInteger(n) && n > 0));
    else anotar(f, idsDe(valor));
  }

  const rotas = [];
  for (const { destino, ids } of porTabla.values()) {
    const cuales = [...ids.keys()];
    if (!cuales.length) continue;
    let existen;
    try {
      existen = new Set(
        db.prepare(`SELECT id FROM "${destino.name}" WHERE id IN (${cuales.map(() => '?').join(',')})`)
          .all(...cuales).map((r) => r.id)
      );
    } catch (e) {
      continue; // si la tabla todavía no está, no se inventa un error de dato
    }
    for (const id of cuales) {
      if (existen.has(id)) continue;
      const campo = ids.get(id);
      rotas.push(`${campo.label}: no existe ${destino.labelSingular ? destino.labelSingular.toLowerCase() : 'el registro'} n.º ${id}`);
    }
  }
  return rotas;
}

/**
 * Referencias que apuntan a algo que quien guarda NO alcanza.
 *
 * POR QUÉ HACE FALTA, ADEMÁS DE COMPROBAR QUE EXISTA. Al guardar se revisa que
 * la iglesia del registro sea una de las suyas, y eso deja fuera lo evidente.
 * Pero un registro no es solo su iglesia: es también aquello a lo que APUNTA.
 * Y hasta la 1.98.1 los campos de referencia no se miraban.
 *
 * Con eso pasaban dos cosas, comprobadas en vivo:
 *
 *   · el administrador de una iglesia podía crear una ficha de integrante que
 *     metiera a una persona de OTRA iglesia en un cuerpo de la suya; y
 *   · la secretaria de un cuerpo podía crear registros en OTRO cuerpo de su
 *     iglesia —uno que no tiene asignado— nombrándolo por su número.
 *
 * Lo segundo, además, se ampliaba solo: quien tiene un cuerpo asignado ve a la
 * gente de ESE cuerpo, así que metiendo a alguien en él pasaba a ver su ficha
 * completa, con su RUT. Una escritura descuidada terminaba siendo una llave
 * para leer. Se comprobó: antes de meterla, su ficha respondía 403; después,
 * 200.
 *
 * La regla es la que la pantalla ya aplicaba sin decirlo: NO SE PUEDE
 * REFERENCIAR LO QUE NO SE PUEDE VER. Los selectores del formulario ofrecen
 * únicamente lo que esa persona alcanza —a la secretaria del cuerpo le ofrecen
 * la gente de su cuerpo y nada más—, así que esto no cierra ningún camino que
 * hoy funcione: cierra el de escribir el número a mano.
 *
 * Como en la comprobación hermana, solo se miran los campos que este guardado
 * TOCA. Una ficha que ya venía apuntando a algo ajeno se puede seguir guardando
 * para corregirle el teléfono; lo que se frena es el guardado que lo empeora.
 */
function referenciasFueraDeAlcance(def, data, usuario) {
  const alcance = require('./alcance');
  if (!alcance.iglesiasDe(usuario).length && !alcance.cuerposDe(usuario).length) return [];

  const fuera = [];
  for (const f of def.fields) {
    if ((f.type !== 'ref' && f.type !== 'multiref') || !f.ref) continue;
    /*
     * Salvo que el módulo diga que ESA referencia la juzga él.
     *
     * Hay una y está bien acotada: la cuenta de DESTINO de un traspaso, donde
     * la plata se entrega hacia arriba —de un cuerpo a su iglesia, de una
     * iglesia a la corporación— y por eso el destino es, a propósito, algo que
     * quien lo anota no administra. La regla completa, con lo que se midió,
     * está en server/entregar-hacia-arriba.js, y el módulo la aplica en su
     * `beforeSave`: no es que ahí no se compruebe nada, es que se comprueba
     * otra cosa. El registro exige que quien lo declare escriba dónde.
     */
    if (f.alcanceLoDecideElModulo) continue;
    const valor = data[f.name];
    if (valor === undefined || valor === null || valor === '') continue; // no se está tocando
    const destino = getModule(f.ref);
    if (!destino) continue;

    const ids = f.type === 'ref'
      ? [Number(valor)].filter((n) => Number.isInteger(n) && n > 0)
      : idsDe(valor);
    if (!ids.length) continue;

    let filas;
    try {
      filas = db
        .prepare(`SELECT * FROM "${destino.name}" WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids);
    } catch (e) {
      continue; // si la tabla todavía no está, no se inventa un error de dato
    }
    for (const fila of filas) {
      if (alcance.alcanza(destino, fila, usuario)) continue;
      const queEs = destino.labelSingular ? destino.labelSingular.toLowerCase() : 'el registro';
      fuera.push(`${f.label}: ${queEs} n.º ${fila.id} está fuera de lo que tiene asignado`);
    }
  }
  return fuera;
}

/** Convierte el valor recibido al tipo de almacenamiento del campo. */
function coerce(field, value) {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  /*
   * Y unos espacios tampoco son un número.
   *
   * `Number('   ')` es CERO —no es un error, es cero—, así que una casilla
   * numérica con espacios entraba a la base como un 0 escrito por alguien: 0
   * folios, 0 asistentes, un monto de 0. Se encontró en la v1.290.0 probando
   * el otro lado de esta misma revisión: pedirle al servidor que vaciara los
   * folios con «   » contestaba «tiene que ser mayor que cero», que para una
   * casilla que se ve vacía no quiere decir nada.
   *
   * Es la misma regla que el motor ya aplica a los campos de texto
   * obligatorios desde la v1.230.0: puros espacios no es un campo lleno.
   */
  if ((field.type === 'number' || field.type === 'money')
      && typeof value === 'string' && value.trim() === '') return null;
  switch (field.type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    /**
     * El dinero se guarda al peso.
     *
     * En pesos no hay centavos, y sin embargo un movimiento de $1.000,55 se
     * aceptaba tal cual. Los decimales no se ven en pantalla pero ensucian
     * todas las sumas: el balance no cuadra nunca con la caja al peso, y la
     * diferencia aparece más tarde, repartida en cifras que no se explican.
     *
     * Se redondea al guardar, no al mostrar: un dato guardado mal no se
     * arregla con maquillaje. Un campo puede pedir decimales declarando
     * `decimales: true` —una tasa, un tipo de cambio—; es una opción, no un
     * descuido.
     */
    case 'money': {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return field.decimales ? n : Math.round(n);
    }
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    case 'ref': {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case 'multiref':
      return JSON.stringify(comoListaDeIds(field, value));
    case 'richtext':
      // Se guarda solo el formato: lo demás se bota (ver server/textorico.js)
      return require('./textorico').limpiar(value);
    case 'rut':
      return rut.canonico(value);
    case 'color': {
      /**
       * Un color y nada más. Llega del navegador, así que no se guarda tal
       * cual: lo que se escriba acá va a parar a un atributo `style` de la
       * hoja impresa, y ahí cualquier cosa que no sea un color es una puerta.
       * Lo que no calce se descarta, que equivale a «el color del sistema».
       */
      const v = String(value).trim().toLowerCase();
      return /^#[0-9a-f]{6}$/.test(v) ? v : null;
    }
    case 'persona':
      return String(value).trim() || null;
    case 'permisos': {
      // Se guarda como JSON { modulo: ['view','create',...] }
      if (typeof value === 'string') return value.trim() ? value : null;
      if (value && typeof value === 'object' && Object.keys(value).length) return JSON.stringify(value);
      return null;
    }
    default:
      return String(value);
  }
}

/**
 * Deja coherentes los campos de tipo "persona": el nombre visible y el enlace
 * al registro (miembro) cuando esa persona sí está en el sistema.
 *
 * - Si se eligió un registro, el nombre pasa a ser el de ese registro.
 * - Si solo se escribió un nombre y coincide exactamente con un registro (y
 *   con uno solo), se enlaza igual; si no, queda como nombre suelto.
 */
function sincronizarPersonas(def, data, existing) {
  for (const f of def.fields) {
    if (f.type !== 'persona') continue;
    const enlace = `${f.name}_id`;
    const refDef = getModule(f.ref || 'miembros');
    if (!refDef) continue;

    const tocaNombre = data[f.name] !== undefined;
    const tocaEnlace = data[enlace] !== undefined;
    const enlaceGuardado = existing ? existing[enlace] : null;
    if (!tocaNombre && !tocaEnlace && !enlaceGuardado) continue;

    const id = tocaEnlace ? data[enlace] : enlaceGuardado;
    const nombre = tocaNombre ? data[f.name] : existing ? existing[f.name] : null;

    if (id) {
      const fila = db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(id);
      if (fila) {
        data[enlace] = fila.id;
        data[f.name] = displayOf(refDef, fila);
        continue;
      }
    }
    data[enlace] = null;
    data[f.name] = nombre || null;
    if (!nombre) continue;

    // ¿Ese nombre corresponde, sin lugar a dudas, a un registro existente?
    const candidatos = db
      .prepare(`SELECT * FROM "${refDef.name}"`)
      .all()
      .filter((r) => displayOf(refDef, r).toLowerCase() === String(nombre).toLowerCase());
    if (candidatos.length === 1) {
      data[enlace] = candidatos[0].id;
      data[f.name] = displayOf(refDef, candidatos[0]);
    }
  }
}

/**
 * Al crear, los campos que no vengan toman el valor por defecto declarado en
 * el módulo. Así la interfaz, la importación y la API se comportan igual.
 */
function aplicarDefectos(def, data) {
  for (const f of def.fields) {
    if (f.default === undefined || f.default === null) continue;
    const v = data[f.name];
    if (v === undefined || v === null || v === '') data[f.name] = coerce(f, f.default);
  }
}

/**
 * Resuelve los campos que se calculan solos a partir de otros (`calcula`).
 * El valor se guarda en la base, para poder filtrarlo, ordenarlo y sumarlo
 * como cualquier otro campo.
 */
function porcentajeDe(calcula, crudo) {
  /*
   * El porcentaje puede venir de un campo de la propia ficha, y ese manda sobre
   * el de Configuración.
   *
   * Existe por lo que pasaba con la ofrenda de un servicio: el aporte a la
   * corporación se recalculaba en CADA guardado con el porcentaje que rigiera
   * ese día, así que corregir la hora de un servicio de marzo le cambiaba
   * cuánto había aportado —y con él, los movimientos de tesorería de un mes
   * cerrado—. Lo que se aportó entonces es un hecho: se guarda con la ficha y
   * deja de moverse cuando cambia el ajuste.
   *
   * En blanco —una ficha nueva, o una de antes de que esto existiera— manda el
   * ajuste, que es lo que corresponde: el porcentaje que rige hoy.
   */
  if (calcula.porcentajeCampo && crudo) {
    const suyo = crudo(calcula.porcentajeCampo);
    // Sirve el cero: un servicio que no aportó nada aportó cero, y eso no es lo
    // mismo que no tener porcentaje anotado
    if (suyo !== null && suyo !== undefined && suyo !== '') {
      const n = Number(suyo);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  if (calcula.opcion) {
    const ajustes = require('./ajustes'); // tardío: ajustes usa la base
    const n = Number(ajustes.obtener(calcula.opcion));
    if (Number.isFinite(n)) return n;
  }
  return Number(calcula.porcentaje) || 0;
}

function aplicarCalculos(def, data, existing) {
  const crudo = (nombre) => (data[nombre] !== undefined ? data[nombre] : existing ? existing[nombre] : null);
  const numero = (nombre) => {
    const n = Number(crudo(nombre));
    return Number.isFinite(n) ? n : 0;
  };
  const redondear = (n) => Math.round(n * 100) / 100;

  for (const f of def.fields) {
    const c = f.calcula;
    if (!c) continue;
    if (c.tipo === 'suma') {
      data[f.name] = redondear(c.campos.reduce((acc, n) => acc + numero(n), 0));
    } else if (c.tipo === 'resta') {
      data[f.name] = redondear(c.campos.reduce((acc, n, i) => (i === 0 ? numero(n) : acc - numero(n)), 0));
    } else if (c.tipo === 'porcentaje') {
      data[f.name] = redondear((numero(c.campo) * porcentajeDe(c, crudo)) / 100);
    }
  }
}

/**
 * Las columnas que necesita la plantilla de presentación de un módulo.
 *
 * Sirve para traer de la base solo lo que hace falta para armar la etiqueta
 * («Juan Pérez») en vez de la fila entera. Si la plantilla menciona algo que
 * no es una columna, se trae todo y no se arriesga nada.
 */
const columnasEnCache = new Map();
function columnasPara(def, extras = []) {
  const llave = `${def.name}|${extras.join(',')}`;
  if (columnasEnCache.has(llave)) return columnasEnCache.get(llave);
  // La plantilla puede pedir un recorte detrás de dos puntos —{nombres:primero}—:
  // la columna que hace falta traer es igual «nombres».
  const claves = [...[...def.display.matchAll(/\{(\w+)(?::\w+)?\}/g)].map((m) => m[1]), ...extras];
  const propias = new Set(def.fields.map((f) => f.name));
  const sql = claves.every((k) => propias.has(k))
    ? ['id', ...new Set(claves)].map((c) => `"${c}"`).join(', ')
    : '*';
  columnasEnCache.set(llave, sql);
  return sql;
}

/** Las columnas que hacen falta para armar la etiqueta de presentación. */
const columnasDeDisplay = (def) => columnasPara(def);

/**
 * Las etiquetas de presentación de varios registros de un módulo, de una vez.
 *
 * Antes se consultaba una por una: un listado de 25 fichas con ocho campos de
 * referencia disparaba doscientas consultas, y mientras tanto nadie más era
 * atendido. Ahora es una consulta por módulo referenciado, sea cual sea el
 * largo del listado.
 */
function etiquetasDe(refDef, ids) {
  const mapa = new Map();
  const unicos = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const columnas = columnasDeDisplay(refDef);
  // SQLite admite un número acotado de parámetros: se pide por tandas
  for (let i = 0; i < unicos.length; i += 400) {
    const tanda = unicos.slice(i, i + 400);
    const filas = db
      .prepare(`SELECT ${columnas} FROM "${refDef.name}" WHERE id IN (${tanda.map(() => '?').join(',')})`)
      .all(...tanda);
    for (const f of filas) mapa.set(f.id, displayOf(refDef, f));
  }
  return mapa;
}

/** Los ids que guarda un campo multiref, sin reventar si viene mal escrito. */
function idsDe(valor) {
  try {
    const arr = JSON.parse(valor || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Expande varias filas de una vez: refs y multirefs con su etiqueta, campos
 * de contraseña fuera, permisos como objeto y campos calculados resueltos.
 */
function expandRows(def, filas, usuario) {
  if (!filas.length) return [];

  // 1) Se junta todo lo que hay que resolver, agrupado por módulo referenciado
  const pedidos = new Map(); // nombre del módulo → { def, ids: Set }
  const anotar = (refDef, id) => {
    if (!refDef || !id) return;
    let p = pedidos.get(refDef.name);
    if (!p) pedidos.set(refDef.name, (p = { def: refDef, ids: new Set() }));
    p.ids.add(Number(id));
  };
  for (const fila of filas) {
    for (const f of def.fields) {
      if (f.type === 'multiref') idsDe(fila[f.name]).forEach((id) => anotar(getModule(f.ref), id));
      else if (f.type === 'ref' && fila[f.name] != null) anotar(getModule(f.ref), fila[f.name]);
    }
  }

  // 2) Una sola consulta por módulo referenciado
  const etiquetas = new Map();
  for (const { def: refDef, ids } of pedidos.values()) {
    etiquetas.set(refDef.name, etiquetasDe(refDef, [...ids]));
  }
  const etiqueta = (refName, id) => {
    const mapa = etiquetas.get(refName);
    const texto = mapa && mapa.get(Number(id));
    return texto === undefined ? `#${id}` : texto;
  };

  /*
   * Memoria que dura lo que dura esta respuesta, para los campos calculados.
   *
   * Un cálculo que necesita algo caro y siempre igual —los integrantes de un
   * cuerpo, por ejemplo— lo guarda acá con una clave suya y no lo vuelve a
   * buscar en las demás filas del listado. No se guarda entre respuestas: al
   * terminar esta, se olvida, y así no puede quedar mostrando algo viejo.
   */
  const recuerdo = new Map();

  // 3) Se arman las filas ya resueltas
  const resueltas = filas.map((row) => {
    const out = { ...row };
    for (const f of def.fields) {
      if (f.type === 'multiref') {
        const ids = idsDe(row[f.name]);
        const refDef = getModule(f.ref);
        out[f.name] = ids;
        out[f.name + '_labels'] = refDef ? ids.map((id) => etiqueta(refDef.name, id)) : [];
      } else if (f.type === 'ref' && row[f.name] != null) {
        const refDef = getModule(f.ref);
        if (refDef) out[f.name + '_label'] = etiqueta(refDef.name, row[f.name]);
      }
      if (f.type === 'password') delete out[f.name];
      if (f.type === 'permisos') {
        try {
          out[f.name] = row[f.name] ? JSON.parse(row[f.name]) : null;
        } catch (e) {
          out[f.name] = null;
        }
      }
    }

    // Campos de persona: si están enlazados a una ficha, se muestra el nombre
    // que esa ficha tiene hoy (la etiqueta ya se resolvió con el campo de enlace).
    for (const f of def.fields) {
      if (f.type !== 'persona') continue;
      const texto = out[`${f.name}_id_label`];
      if (texto && !String(texto).startsWith('#')) out[f.name] = texto;
    }

    // Campos calculados: no se guardan, se resuelven al leer
    for (const c of def.computed || []) {
      try {
        out[c.name] = c.calc(row, { db, usuario, recuerdo });
      } catch (e) {
        // El valor queda en blanco —una pantalla no se rompe por un campo—
        // pero se anota. Antes se callaba, y un cálculo roto podía llevar
        // meses dejando columnas vacías sin que nadie supiera por qué. Se
        // anota una vez por cada cálculo, no una por fila: un listado de mil
        // filas sepultaría el registro repitiendo lo mismo mil veces.
        avisarDelCalculoRoto(def, c, e);
        out[c.name] = null;
      }
    }
    return out;
  });

  // Y por último se quitan los datos de salud a quien no los alcanza. Va acá,
  // al final y en un solo lugar, porque por acá pasan todas las respuestas que
  // llevan una ficha: el listado, el detalle, lo que se devuelve al guardar y
  // la planilla que se baja (ver server/sensibles.js).
  const limpias = sensibles.limpiarVarias(def, resueltas, usuario);

  /*
   * Y los campos que COPIAN lo que decía la ficha de otro módulo: la bitácora
   * de un miembro, el historial de un pastor. El texto se recorta con los
   * campos reservados del módulo del que copia, porque para este módulo es
   * texto y el recorte de arriba no lo mira (ver server/sensibles.js).
   */
  for (const campo of def.fields) {
    const origen = sensibles.elOrigenDe(campo);
    if (!origen) continue;
    for (const fila of limpias) {
      if (fila[campo.name]) fila[campo.name] = sensibles.sinLoReservado(origen, fila[campo.name], usuario);
    }
  }

  /*
   * Y lo que el propio módulo quiera recortar al leer.
   *
   * `alLeer(fila, { usuario, db })` devuelve la fila que se entrega. Es el
   * único gancho de LECTURA del motor y va acá, en el mismo sitio y por la
   * misma razón que el recorte de arriba: por esta función pasan las cuatro
   * puertas por las que sale una ficha —el listado, el detalle, la respuesta
   * de guardar y la planilla—, así que lo que se recorte acá no se escapa por
   * ninguna. Uno que se llamara desde la ruta del listado dejaría la planilla
   * abierta, que es exactamente lo que hay que evitar.
   *
   * Lo trajo el detalle del Registro de Cambios, que es texto copiado de otro
   * módulo y puede traer un monto o un RUT reservados (ver server/bitacora.js).
   */
  if (!def.hooks || !def.hooks.alLeer) return limpias;
  return limpias.map((fila) => def.hooks.alLeer(fila, { usuario, db }) || fila);
}

/** Expande una fila suelta. */
function expandRow(def, row, usuario) {
  return expandRows(def, [row], usuario)[0];
}

/** WHERE de alcance por iglesia para el usuario actual. */
/**
 * Acota las consultas a lo que el usuario puede ver: sus iglesias y, si se le
 * asignaron, sus cuerpos (ver server/alcance.js).
 */
/**
 * Techo de cualquier cantidad que se guarde.
 *
 * No es una limitación real: son diez mil millones, más que el presupuesto de
 * cualquier iglesia. Está para que un número absurdo no entre a la base y
 * eche a perder todas las sumas que dependen de él. Se comprobó que sin este
 * tope se podía guardar un ingreso de 1e308 y el balance de la iglesia pasaba
 * a decir «1e+308»: no es que quedara grande, es que dejaba de ser un número
 * con el que se pueda trabajar.
 */
const TECHO = 9_999_999_999;

/**
 * Un número como se lee acá, para poder decirlo en el aviso.
 *
 * Si es tan grande que escribirlo llenaría la pantalla —y los hay: 1e308 son
 * trescientos nueve dígitos— no se escribe. El aviso tiene que caber en una
 * línea y decirle algo a quien lo lee.
 */
const enPesos = (n) => (Math.abs(Number(n)) >= 1e15 ? 'un número enorme' : Number(n).toLocaleString('es-CL'));

/**
 * ¿El número que llega cabe donde va?
 *
 * Cada campo puede declarar su `min` y su `max`; si no los declara, igual se
 * revisa que sea un número de verdad y que no pase del techo. Devuelve el
 * aviso escrito para quien lo lea, o null si está bien.
 *
 * El aviso dice el límite y no solo que se pasó: quien está anotando una
 * ofrenda necesita saber qué se espera de él, no que «el valor es inválido».
 */
function revisarLimites(campo, valor) {
  const n = Number(valor);
  const esDinero = campo.type === 'money';

  if (!Number.isFinite(n)) {
    return `El campo "${campo.label}" tiene que ser un número.`;
  }

  const minimo = campo.min !== undefined ? campo.min : null;
  const maximo = campo.max !== undefined ? campo.max : TECHO;

  if (minimo !== null && n < minimo) {
    if (minimo === 0) return `El campo "${campo.label}" no puede ser negativo.`;
    if (minimo > 0 && n <= 0) {
      // El consejo va donde sirve: en un movimiento de dinero, lo que quería
      // hacer quien escribió un número negativo casi siempre es un egreso.
      return esDinero
        ? `El campo "${campo.label}" tiene que ser mayor que cero. Si lo que quiere es restar, anótelo como egreso.`
        : `El campo "${campo.label}" tiene que ser mayor que cero.`;
    }
    return `El campo "${campo.label}" no puede ser menor que ${enPesos(minimo)}.`;
  }

  if (n > maximo) {
    return maximo === TECHO
      ? `El campo "${campo.label}" tiene un valor imposible (${enPesos(n)}). Revise si se le fue un dígito.`
      : `El campo "${campo.label}" no puede pasar de ${enPesos(maximo)}.`;
  }

  /*
   * Y que sea entero, donde contar en mitades no quiere decir nada.
   *
   * Un campo puede declarar `entero: true`: las hojas de un documento, el
   * número de una cuota, la gente que asistió. Antes esto lo arreglaba cada
   * módulo por su cuenta —la oficina de partes redondeaba los folios en su
   * gancho de guardado— y redondear en silencio es lo que este sistema viene
   * corrigiendo desde hace veinte revisiones: 2,7 folios se guardaban como 3
   * sin que nadie lo supiera, y ese 3 después lo suma el cierre del libro.
   *
   * Va al final a propósito: si además está fuera de rango, lo que hay que
   * decir primero es el rango.
   */
  if (campo.entero && !Number.isInteger(n)) {
    return `El campo "${campo.label}" tiene que ser un número entero, sin decimales.`;
  }

  return null;
}


/**
 * Qué módulos referencian a cada uno, calculado una sola vez.
 *
 * Sirve para saber si a alguien le hace falta la lista de un módulo para
 * llenar un selector de otro que sí puede usar.
 */
let quienesLoReferencian = null;
function referenciadoresDe(nombre) {
  if (!quienesLoReferencian) {
    quienesLoReferencian = new Map();
    for (const m of allModules()) {
      for (const f of m.fields) {
        if ((f.type !== 'ref' && f.type !== 'multiref') || !f.ref) continue;
        if (!quienesLoReferencian.has(f.ref)) quienesLoReferencian.set(f.ref, new Set());
        quienesLoReferencian.get(f.ref).add(m.name);
      }
    }
  }
  return quienesLoReferencian.get(nombre) || new Set();
}

/**
 * ¿Puede esta persona pedir las opciones de este módulo?
 *
 * Sí cuando puede ver el módulo, y también cuando puede ver alguno de los que
 * lo referencian: para llenar el selector de «Cuenta» de un movimiento hace
 * falta la lista de cuentas, aunque Cuentas no se abra directamente.
 */
function puedeVerOpcionesDe(def, usuario) {
  if (can(usuario, def.name, 'view')) return true;
  for (const otro of referenciadoresDe(def.name)) {
    if (can(usuario, otro, 'view')) return true;
  }
  return false;
}


/**
 * ¿Hay ya otro registro con este mismo valor en un campo marcado como único?
 *
 * `unique: true` es único en todo el sistema —un RUT lo es—. Pero hay números
 * que solo tienen que ser únicos **dentro de su iglesia**: el número de un
 * certificado o de una credencial los pone cada congregación en su propia
 * serie, y dos iglesias distintas pueden emitir las dos su «CERT-001» sin que
 * eso sea un error. Para esos se declara `unique: 'iglesia_id'`.
 *
 * Hasta ahora ninguno de los dos números estaba marcado de ninguna manera, así
 * que se podían emitir dos certificados con el mismo número, para dos personas
 * distintas, y nada lo decía.
 */
function buscarDuplicado(def, campo, valor, id, datos, existing) {
  if (!campo.unique) return null;
  const params = [String(valor), id || 0];
  let dentroDe = '';

  if (typeof campo.unique === 'string') {
    const columna = campo.unique;
    const suyo = datos[columna] !== undefined ? datos[columna] : existing ? existing[columna] : null;
    // Sin valor en la columna que acota, se compara contra los que tampoco lo
    // tienen: si no, un certificado sin iglesia chocaría con los de todas.
    if (suyo === null || suyo === undefined || suyo === '') {
      dentroDe = ` AND "${columna}" IS NULL`;
    } else {
      dentroDe = ` AND "${columna}" = ?`;
      params.push(suyo);
    }
  }

  return db
    .prepare(`SELECT id FROM "${def.name}" WHERE lower("${campo.name}") = lower(?) AND id != ?${dentroDe} LIMIT 1`)
    .get(...params);
}

/**
 * ¿«otro» u «otra»? El módulo lo dice con `genero` cuando la terminación no
 * lo acierta —«credencial» es femenina y no acaba en a—; si no, se deduce de
 * la primera palabra, igual que en la pantalla (ver nuevoDe en public/app.js).
 */
function otroUOtra(def) {
  if (def.genero) return def.genero === 'f' ? 'otra' : 'otro';
  const cabeza = String(def.labelSingular || '').toLowerCase().split(/[\s/]+/)[0];
  return /(a|ción|sión|dad|tad|ud|umbre|triz)$/.test(cabeza) ? 'otra' : 'otro';
}

/**
 * DENTRO DE QUÉ es único este valor, dicho con el nombre de la cosa.
 *
 * Un número acotado no está tomado «en el sistema»: está tomado en un cuerpo o
 * en una congregación en particular, y decir cuál es la diferencia entre un
 * aviso que se entiende y uno que confunde. Antes solo se nombraba el caso de
 * la iglesia —«en esta iglesia»— y para los demás no se decía nada, así que el
 * aviso de un acta de reunión se leía como si el número estuviera tomado en
 * todo el sistema cuando solo lo estaba en ese cuerpo.
 *
 * Se nombra la cosa CONCRETA y no su clase: «en «Coro de jóvenes»» dice más que
 * «en este cuerpo», y de paso esquiva el género del sustantivo, que en español
 * obligaría a escribir un artículo distinto por módulo.
 */
function dondeEsUnico(def, campo, datos, existing) {
  if (typeof campo.unique !== 'string') return '';
  const columna = campo.unique;
  const valor = datos[columna] !== undefined ? datos[columna] : (existing ? existing[columna] : null);
  if (!valor) return '';

  // De qué módulo es esa columna, para poder leerle el nombre a la fila
  const suyo = (def.fields || []).find((f) => f.name === columna);
  if (!suyo || !suyo.ref) return '';
  try {
    const fila = db.prepare(`SELECT * FROM "${suyo.ref}" WHERE id = ?`).get(valor);
    if (!fila) return '';
    const como = fila.nombre || fila.titulo || fila.numero || '';
    return como ? ` en «${como}»` : '';
  } catch (e) {
    return ''; // un aviso sin el nombre sigue sirviendo; uno que revienta, no
  }
}

/**
 * ¿Está bloqueado este campo por el estado en que quedó la ficha?
 *
 * Hay datos que se escriben mientras algo se está preparando y dejan de poder
 * escribirse en cuanto ese algo se consuma. La fecha de entrega de una
 * credencial es el caso: se elige mientras es un borrador, y una vez emitida
 * queda impresa en una tarjeta que anda en el bolsillo de alguien, así que la
 * fila y el papel tienen que seguir diciendo lo mismo.
 *
 *     { name: 'fecha_vencimiento', bloqueadoSi: { field: 'estado', salvo: 'Borrador' } }
 *
 * Es la hermana de `readonly`, con dos diferencias que importan. `readonly` es
 * para lo que NUNCA lo escribe una persona —el número de serie, lo que se
 * calcula solo—; esto es para lo que sí se escribe, hasta que deja de poder.
 * Y `readonly` se descarta en silencio, que ahí está bien porque el formulario
 * ni siquiera lo ofrece; esto, en cambio, CONTESTA por qué, porque si alguien
 * lo mandó es que quiso cambiarlo.
 *
 * POR QUÉ HACÍA FALTA. Esto se resolvía dentro del gancho del módulo borrando
 * el campo del guardado y siguiendo adelante. Medido sobre una credencial
 * emitida: cambiar su fecha de vencimiento a 2031 respondía HTTP 200, sin
 * ningún mensaje, el dato seguía en 2028 y la versión subía igual —así que a
 * otra persona con esa ficha abierta le saltaba el aviso de «alguien la
 * modificó» por un cambio que no ocurrió—. Quien corregía una fecha mal escrita
 * se iba convencido de haberla corregido.
 *
 * Dos formas, las mismas que `showIf` al revés:
 *   { field, salvo }   bloqueado salvo mientras ese campo valga eso
 *   { field, equals }  bloqueado justamente cuando valga eso
 */
function estaBloqueado(campo, existing) {
  if (!campo.bloqueadoSi || !existing) return false;
  const actual = existing[campo.bloqueadoSi.field];
  if (campo.bloqueadoSi.salvo !== undefined) {
    return String(actual == null ? '' : actual) !== String(campo.bloqueadoSi.salvo);
  }
  if (Array.isArray(campo.bloqueadoSi.salvoEn)) {
    return !campo.bloqueadoSi.salvoEn.map(String).includes(String(actual == null ? '' : actual));
  }
  return String(actual == null ? '' : actual) === String(campo.bloqueadoSi.equals);
}

/**
 * ¿Aplica este campo, según la condición con que se declaró?
 *
 * Un campo puede declarar `showIf: { field, equals | in }` para existir solo en
 * algunos casos: «Miembro» solo cuando el beneficiario es un miembro, el
 * número de la oficina de partes solo en los dos flujos que numeran. Un campo
 * que no aplica NO SE EXIGE aunque sea obligatorio —pedirlo sería pedir algo
 * que la pantalla ni siquiera muestra—.
 *
 * Vive acá, y no dentro de la ruta que guarda, porque la planilla tiene que
 * decidirlo igual que el formulario. Estaba escrito solo en la ruta, y la
 * importación exigía todos los obligatorios a secas: medido en la v1.283.0,
 * una fila de Ayudas Sociales a nombre de un no miembro contestaba «Falta
 * Miembro» Y «Falta No Miembro» a la vez —los dos campos de un par
 * excluyente—, así que ninguna planilla de ese módulo podía entrar, fuera cual
 * fuera el beneficiario. Son catorce campos así en siete módulos.
 *
 * No entiende la forma `menorDe` —la que mira la edad que da una fecha—, que
 * solo se usa en la pantalla; hoy ningún campo la combina con `required`, así
 * que no hay nada que decidir mal, pero si algún día lo hace hay que enseñarle
 * a contar años antes.
 */
function seAplica(campo, datos, existing, campos, hondura = 0) {
  if (!campo.showIf) return true;
  const actual = datos[campo.showIf.field] !== undefined
    ? datos[campo.showIf.field]
    : existing
      ? existing[campo.showIf.field]
      : undefined;
  const coincide = Array.isArray(campo.showIf.in)
    ? campo.showIf.in.includes(actual)
    : actual === campo.showIf.equals;
  if (!coincide) return false;

  /*
   * Y UN CAMPO QUE NO APLICA NO DECIDE POR OTRO.
   *
   * Una condición puede colgar de un campo que a su vez tiene condición:
   * «Detalle del motivo» depende del motivo de la ausencia, y el motivo solo
   * existe cuando la asistencia está «Justificada». Mirar solo el valor del de
   * arriba no basta, porque ese valor puede estar ahí de antes o venir puesto
   * por la pantalla.
   *
   * Medido en la v1.283.0: una asistencia marcada «Presente», con el motivo en
   * null en la base, contestaba 400 «El campo "Detalle del motivo" es
   * obligatorio» al guardarla desde la pantalla —el desplegable escondido del
   * motivo se dibuja con su primera opción puesta y viaja con el formulario—.
   * Ese registro no se podía guardar por ningún camino.
   *
   * Hoy hay UNA sola cadena así en todo el sistema, y es esa. La hondura corta
   * en diez por si alguien escribe un círculo: más vale exigir de menos que
   * quedarse dando vueltas.
   */
  if (!campos || hondura > 10) return true;
  const manda = campos.find((f) => f.name === campo.showIf.field);
  if (!manda || !manda.showIf) return true;
  return seAplica(manda, datos, existing, campos, hondura + 1);
}

/** Cómo se le dice a alguien que ese valor ya está usado. */
function avisoDeDuplicado(def, campo, donde = '') {
  return `Ya existe ${otroUOtra(def)} ${def.labelSingular.toLowerCase()} con ese ${campo.label}${donde}`;
}


/**
 * Lo que se responde cuando algo falla de forma inesperada.
 *
 * El detalle técnico —que en un error de base de datos nombra tablas y
 * columnas— va al registro del servidor y no a la pantalla. Lo que sí viaja es
 * una marca corta, para poder aparear lo que la persona vio con lo que quedó
 * anotado: «me salió el error 8f3a» se encuentra sin adivinar.
 */
function averiaInterna(res, contexto, error) {
  const marca = require('crypto').randomBytes(2).toString('hex');
  console.error(`[${marca}] ${contexto}`, error);
  return res.status(500).json({
    error: `Hubo un problema al ${contexto} (n.º ${marca}). Vuelva a intentarlo; si sigue pasando, dele ese número a quien administra el sistema.`,
  });
}


/**
 * Un cálculo que se rompe deja de ser invisible.
 *
 * Se recuerda cuál ya se avisó para no repetirlo en cada fila; se olvida al
 * reiniciar, que es cuando conviene volver a saberlo.
 */
const calculosRotos = new Set();
function avisarDelCalculoRoto(def, campo, error) {
  const cual = `${def.name}.${campo.name}`;
  if (calculosRotos.has(cual)) return;
  calculosRotos.add(cual);
  console.error(
    `⚠️  El campo calculado «${campo.label || campo.name}» de ${def.label} está fallando y se está ` +
      `mostrando en blanco: ${error && error.message ? error.message : error}`
  );
}


function scopeClause(def, user, params) {
  return alcance.condiciones(def, user, params);
}

  /**
   * La consulta del listado: alcance, búsqueda, filtros, rango de fechas y
   * orden. Se arma en un solo lugar porque la usan dos rutas —la que pinta
   * la pantalla y la que baja la planilla—, y tienen que mirar exactamente
   * lo mismo: si la planilla se armara aparte, un día traería filas que la
   * pantalla no muestra, o de una iglesia que no le toca a quien la pide.
   */
function consultaDeUnListado(def, req) {
  const fields = fieldMap(def);

  const params = [];
  const where = [];
  const scope = scopeClause(def, req.user, params);
  if (scope) where.push(scope);

  // Solo por los campos que esta persona alcanza: un teléfono que no se le
  // muestra tampoco sirve para encontrar a su dueño, porque si sirviera
  // bastaría con probar números para averiguar de quién es cada uno.
  //
  // Cómo se compara —por palabras y sin tildes— está en server/busqueda.js,
  // con lo que costaba antes escrito ahí.
  const buscada = busqueda.condicion(req.query.q, sensibles.buscablesPara(def, req.user), sensibles.buscaTambienPara(def, req.user));
  if (buscada) {
    where.push(`(${buscada.sql})`);
    params.push(...buscada.params);
  }

  /*
   * Filtros exactos: ?f_campo=valor (solo campos declarados)
   *
   * Y solo por los campos que esta persona alcanza, por lo mismo que la
   * búsqueda de arriba: `?f_rut=15111222-6` devolvía la ficha de su dueña a
   * quien tiene cerrada la llave del RUT, y `?f_monto=990000` el movimiento a
   * quien no puede ver los montos. Probar valores hasta que uno devuelva una
   * fila es la misma fuga por otra puerta —la búsqueda ya estaba cerrada y el
   * rango de montos también—, y esta era la que quedaba abierta.
   *
   * El filtro que no le toca se IGNORA en vez de rechazarse, igual que el
   * rango de montos: la pantalla no ofrece esos filtros, así que quien llega
   * acá está probando a mano, y no hay por qué contestarle si acertó o no.
   */
  for (const [key, val] of Object.entries(req.query)) {
    if (!key.startsWith('f_') || val === '') continue;
    const fname = key.slice(2);
    if (!fields[fname] && fname !== 'id') continue;
    if (fields[fname] && !sensibles.alcanzaElCampo(def, fields[fname], req.user)) continue;
    where.push(`"${fname}" = ?`);
    params.push(val);
  }
  // Lo que falta por llenar: ?sin=email trae los que no tienen correo.
  // Sirve para que un conteo de «datos por completar» se pueda abrir como
  // lista y llenarse, en vez de quedar en un número que nadie sabe a
  // quiénes corresponde.
  for (const nombre of String(req.query.sin || '').split(',').map((n) => n.trim()).filter(Boolean)) {
    if (!fields[nombre]) continue;
    // Por lo mismo que el filtro exacto: quién tiene y quién no tiene un dato
    // reservado tampoco se cuenta desde afuera.
    if (!sensibles.alcanzaElCampo(def, fields[nombre], req.user)) continue;
    where.push(`("${nombre}" IS NULL OR TRIM("${nombre}") = '')`);
  }

  /**
   * Rango de montos: ?monto_desde=500000&monto_hasta=900000
   *
   * «Los egresos sobre quinientos mil de este año» es la pregunta con que
   * empieza cualquier revisión, y se contestaba bajando la planilla entera y
   * filtrando en Excel. El campo lo dice el propio módulo: el primero de tipo
   * `money` que además esté en el listado.
   *
   * Un monto reservado no se acota: quien no puede ver los montos tampoco
   * puede ir tanteando rangos hasta dar con una cifra, que sería la misma
   * fuga por otra puerta (es la regla de server/sensibles.js).
   */
  const campoDeMonto = require('./registry').tieneRangoDeMonto(def)
    ? def.fields.find((f) => f.type === 'money' && fields[f.name] && (def.listFields || []).includes(f.name))
    : null;
  if (campoDeMonto && !sensibles.vedados(def, req.user, null).includes(sensibles.grupoDe(campoDeMonto))) {
    /*
     * Solo un número, y con o sin los puntos con que se escribe la plata acá:
     * «500.000» y «500000» son lo mismo. Lo que no sea un número no acota nada
     * y el listado se ve entero, igual que con la edad: adivinar lo que alguien
     * quiso decir es peor que no hacerle caso.
     */
    const enPesos = (valor) => {
      const limpio = String(valor == null ? '' : valor).trim().split('.').join('').replace(/^\$\s*/, '');
      if (!/^\d{1,12}$/.test(limpio)) return null;
      return Number(limpio);
    };
    const col = `"${campoDeMonto.name}"`;
    const montoDesde = enPesos(req.query.monto_desde);
    const montoHasta = enPesos(req.query.monto_hasta);
    if (montoDesde !== null) {
      where.push(`${col} >= ?`);
      params.push(montoDesde);
    }
    if (montoHasta !== null) {
      where.push(`${col} <= ?`);
      params.push(montoHasta);
    }
  }

  /**
   * Rango de edad: ?edad_desde=18&edad_hasta=30
   *
   * La edad no es una columna —se calcula al leer la ficha, así nunca
   * queda vieja— y por eso no se podía filtrar por ella. Pero preguntarla
   * es de todos los días: «los menores de 18 para el cuerpo de
   * Infantiles», «los mayores de 60 para la visita». Se armaba bajando la
   * planilla entera y filtrando en Excel.
   *
   * Se resuelve al revés: en vez de calcular la edad de cada fila, se
   * convierte la edad pedida en la fecha de nacimiento que le corresponde,
   * que SÍ es una columna. «18 o más» es haber nacido hace dieciocho años
   * o antes; «30 o menos» es haber nacido DESPUÉS de hace treinta y un
   * años, porque quien nació justo hace treinta y uno ya tiene treinta y
   * uno. SQLite hace la resta, así que los años bisiestos salen bien
   * solos.
   *
   * El campo lo dice el propio módulo: el que declara `mostrarEdad`.
   */
  const campoDeNacimiento = def.fields.find((f) => f.mostrarEdad && fields[f.name]);
  if (campoDeNacimiento) {
    const col = `"${campoDeNacimiento.name}"`;
    /*
     * Solo un número entero, y entero de verdad: `parseInt` leía «18 años» y
     * «18; lo que sea» como 18. No es un agujero —el valor viaja como
     * parámetro, nunca pegado al SQL— pero adivinar lo que alguien quiso decir
     * es peor que no hacerle caso: si lo escrito no es un número, no se acota
     * y el listado se ve entero.
     */
    const anios = (valor) => {
      if (!/^\d{1,3}$/.test(String(valor || '').trim())) return null;
      const n = Number(valor);
      return n >= 0 && n <= 130 ? n : null;
    };
    const desdeEdad = anios(req.query.edad_desde);
    const hastaEdad = anios(req.query.edad_hasta);
    /*
     * A quien no tiene fecha no hace falta dejarlo fuera a mano: `date()`
     * devuelve nulo con lo que no sea una fecha —vacío, espacios, texto—, y
     * comparar contra nulo no es cierto. Comprobado. Se dice acá porque la
     * tentación es agregar la comprobación «por si acaso», y una condición que
     * parece que cuida algo y no cuida nada es peor que no tenerla.
     */
    if (desdeEdad !== null) {
      where.push(`date(${col}) <= date('now','localtime',?)`);
      params.push(`-${desdeEdad} years`);
    }
    if (hastaEdad !== null) {
      where.push(`date(${col}) > date('now','localtime',?)`);
      params.push(`-${hastaEdad + 1} years`);
    }
  }

  /**
   * Los filtros que solo tienen sentido en un módulo.
   *
   * «De qué cuerpo es esta persona» no se contesta mirando una columna de
   * su ficha: está en otra tabla. El módulo escribe la condición —sabe
   * dónde mirar— y el motor la pega donde corresponde, con sus parámetros
   * separados del SQL. Ver `filtrosPropios` en server/modules/miembros.js.
   */
  for (const filtro of def.filtrosPropios || []) {
    const valor = req.query[filtro.nombre];
    if (valor === undefined || valor === '') continue;
    const trozo = filtro.donde(valor, { db, usuario: req.user });
    if (!trozo || !trozo.sql) continue;
    where.push(`(${trozo.sql})`);
    params.push(...(trozo.params || []));
  }

  // Rango de fechas: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD sobre dateField del módulo
  const dateField = def.dateField || (fields['fecha'] ? 'fecha' : null);
  if (dateField && req.query.desde) {
    where.push(`"${dateField}" >= ?`);
    params.push(req.query.desde);
  }
  if (dateField && req.query.hasta) {
    where.push(`"${dateField}" <= ?`);
    params.push(req.query.hasta);
  }

  let sortField = req.query.sort && (fields[req.query.sort] || req.query.sort === 'id') ? req.query.sort : def.defaultSort.field;
  let alReves = false;

  /**
   * Ordenar por un dato que se calcula.
   *
   * La edad no es una columna, así que pedir `sort=edad` no ordenaba nada:
   * el listado salía en el orden de siempre y nadie avisaba. Un campo
   * calculado puede decir por qué columna se ordena en su lugar
   * —`ordenarPor`—, y si va al revés: de más viejo a más joven es de fecha
   * de nacimiento MÁS ANTIGUA a más nueva.
   */
  const calculado = (def.computed || []).find((c) => c.name === req.query.sort);
  let vaciosAlFinal = null;
  if (calculado && calculado.ordenarPor && fields[calculado.ordenarPor.campo]) {
    sortField = calculado.ordenarPor.campo;
    alReves = !!calculado.ordenarPor.invertido;
    /*
     * Quien no tiene el dato va al final, se pida como se pida.
     *
     * Sin esto, «de mayor a menor» encabezaba el listado con las fichas sin
     * fecha de nacimiento, que no tienen edad: SQLite pone los vacíos
     * primero al ordenar hacia arriba, y ordenar por edad hacia abajo es
     * ordenar por fecha hacia arriba. Quien pide los más viejos no espera
     * abrir con tres fichas en blanco.
     */
    vaciosAlFinal = `("${sortField}" IS NULL OR TRIM("${sortField}") = '') ASC`;
  }

  if (!fields[sortField] && sortField !== 'id') sortField = 'id';
  let sortDir = (req.query.dir || def.defaultSort.dir) === 'asc' ? 'ASC' : 'DESC';
  if (alReves) sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';

  // Se desempata por id para que el orden sea estable y cronológico
  // cuando varios registros comparten el mismo valor (p. ej. la misma fecha).
  return {
    params,
    whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '',
    ordenSql: `ORDER BY ${vaciosAlFinal ? `${vaciosAlFinal}, ` : ''}"${sortField}" ${sortDir}`
      + `${sortField === 'id' ? '' : `, id ${sortDir}`}`,
  };
}

function buildRouter() {
  const router = express.Router();
  router.use(authRequired);

  for (const def of allModules()) {
    const base = `/${def.name}`;
    const fields = fieldMap(def);

    /**
     * Opciones para llenar un selector: id y texto, nada más.
     *
     * Quién puede pedirlas: quien puede ver ESTE módulo, o quien puede ver
     * alguno de los que lo referencian —porque para llenar el selector de
     * «Cuenta» dentro de un movimiento de tesorería hace falta la lista de
     * cuentas, aunque el módulo de Cuentas no se abra directamente—.
     *
     * Eso es lo que este comentario decía desde el principio, pero no era lo
     * que el código hacía: la ruta estaba abierta a cualquiera con sesión. Se
     * comprobó lo que eso significaba: un usuario de «solo consulta» —el rol
     * más restringido— alcanzaba los nombres de los OCHO módulos que tiene
     * explícitamente cerrados. Entre ellos la lista completa de usuarios del
     * sistema, los nombres de las 59 cuentas de tesorería y 883 entradas del
     * Registro de Cambios, cuyo texto dice qué se cambió y dónde.
     *
     * No era acceso al dinero —solo viajan el id y el texto— pero sí era leer
     * de módulos que el sistema le decía que no podía ver, y esa diferencia
     * entre lo que dice y lo que hace es justamente lo que no puede quedar.
     */
    router.get(`${base}/options`, (req, res) => {
      if (!puedeVerOpcionesDe(def, req.user)) {
        return res.status(403).json({ error: 'No tiene permiso para ver esta lista' });
      }
      const params = [];
      let where = scopeClause(def, req.user, params);
      // Solo se traen las columnas que se usan acá —el texto que se muestra y
      // aquello por lo que se puede buscar—: un selector de miembros pedía la
      // ficha entera de cada uno, y esto se abre en cada formulario.
      // Ni acá se busca por un dato reservado que esta persona no alcanza:
      // si no, el selector lo devolvería en `buscar` y quedaría a la vista en
      // el navegador de quien no tiene que verlo (ver server/sensibles.js).
      const buscables = sensibles.buscablesPara(def, req.user);
      const columnas = columnasPara(def, buscables);
      const sql = `SELECT ${columnas} FROM "${def.name}" ${where ? 'WHERE ' + where : ''} ORDER BY id DESC LIMIT 1000`;
      const rows = db.prepare(sql).all(...params);
      // Además del texto que se muestra, se envía con qué más se puede buscar
      // (RUT, teléfono, correo…) para que el buscador del selector encuentre
      // por cualquiera de esos datos sin volver a consultar al servidor.
      const opciones = rows.map((r) => {
        const label = displayOf(def, r);
        const enElTexto = label.toLowerCase();
        const extra = buscables
          .map((n) => r[n])
          .filter((v) => v != null && v !== '' && !enElTexto.includes(String(v).toLowerCase()))
          .join(' ');
        return { id: r.id, label, buscar: `${label} ${extra}`.trim() };
      });
      /*
       * Y un módulo puede retocar cómo se OFRECE lo suyo, mirando la lista
       * entera y no una fila por vez.
       *
       * Hace falta donde una fila sola no alcanza para saber cómo nombrarla:
       * dos iglesias que se llaman igual salen indistinguibles en el
       * desplegable, y para decidir si hay que ponerles el código al lado hay
       * que ver a las dos. `display` no sirve: se llama fila por fila y no sabe
       * qué más hay en la lista.
       *
       * Recibe las opciones ya armadas y las filas en el mismo orden, por si
       * necesita una columna que no viaja en la opción —el código, ahí—.
       */
      res.json(def.comoSeOfrecen ? def.comoSeOfrecen(opciones, rows) : opciones);
    });

    /**
     * La consulta del listado: alcance, búsqueda, filtros, rango de fechas y
     * orden. Se arma en un solo lugar porque la usan dos rutas —la que pinta
     * la pantalla y la que baja la planilla—, y tienen que mirar exactamente
     * lo mismo: si la planilla se armara aparte, un día traería filas que la
     * pantalla no muestra, o de una iglesia que no le toca a quien la pide.
     */
    const consultaDelListado = (req) => consultaDeUnListado(def, req);

    // ---- listar ----
    router.get(base, requirePerm(def.name, 'view'), (req, res) => {
      const { params, whereSql, ordenSql } = consultaDelListado(req);

      /*
       * El número de página tiene tope, y no es un capricho.
       *
       * `?page=9999999999999999999` daba un desplazamiento tan grande que
       * dejaba de ser un número entero de los que JavaScript sabe representar
       * exactos, y SQLite se negaba a recibirlo: «datatype mismatch», o sea un
       * error 500 en todos los listados del sistema. Lo encontró el barrido de
       * la 1.96.3; el primero, con la clave repetida, era otro camino al mismo
       * sitio.
       *
       * Un millón de páginas por doscientos registros son doscientos millones
       * de fichas. Ninguna iglesia va a llegar ahí, y pedir más allá del final
       * devuelve una página vacía, que es lo que corresponde: quien escribe un
       * número absurdo en la dirección no rompe nada, simplemente no ve nada.
       */
      const TOPE_DE_PAGINA = 1000000;
      const page = Math.min(TOPE_DE_PAGINA, Math.max(1, parseInt(req.query.page, 10) || 1));
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;

      const total = db.prepare(`SELECT COUNT(*) AS c FROM "${def.name}" ${whereSql}`).get(...params).c;
      const rows = db
        .prepare(`SELECT * FROM "${def.name}" ${whereSql} ${ordenSql} LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);

      res.json({ rows: expandRows(def, rows, req.user), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    });

    /**
     * El listado como planilla, para abrirlo en Excel.
     *
     * Baja **todo lo que el listado está mostrando**, no la página que se ve:
     * quien pide una nómina la quiere entera. Respeta la búsqueda, los
     * filtros, el rango de fechas y el orden que tenga puestos, y por sobre
     * todo el alcance de quien la pide, porque usa la misma consulta que la
     * pantalla.
     *
     * Va todo el contenido de la ficha y no solo las columnas que caben en
     * pantalla: en una planilla no hay ancho que cuidar, y lo que se necesita
     * para mandar una nómina o cuadrar el año son los datos completos. Se
     * dejan fuera los archivos —un nombre de archivo no dice nada en una
     * planilla— y las contraseñas.
     */
    router.get(`${base}/planilla`, requirePerm(def.name, 'view'), (req, res, next) => {
      // Ver una ficha en pantalla y bajarse el listado entero a un archivo no
      // son lo mismo: lo segundo saca los datos del sistema. Por eso tiene su
      // propia llave, que de fábrica tienen todos y se le puede quitar a quien
      // solo deba consultar (ver LLAVES en server/permissions.js).
      if (!can(req.user, 'datos_planilla', 'view')) {
        return res.status(403).json({ error: 'No tiene permiso para bajar listados a planilla' });
      }
      next();
    }, (req, res) => {
      const { params, whereSql, ordenSql } = consultaDelListado(req);
      const filas = db.prepare(`SELECT * FROM "${def.name}" ${whereSql} ${ordenSql} LIMIT ${topeDePlanilla()}`).all(...params);
      planilla.enviar(res, def, expandRows(def, filas, req.user), req.user);
    });

    // ---- detalle ----
    router.get(`${base}/:id(\\d+)`, requirePerm(def.name, 'view'), (req, res) => {
      const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
      if (!alcance.alcanza(def, row, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      res.json(expandRow(def, row, req.user));
    });

    // ---- crear / actualizar ----
    const save = (isNew) => (req, res) => {
      try {
        const id = isNew ? null : Number(req.params.id);
        let existing = null;
        if (!isNew) {
          existing = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(id);
          if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });
          if (!alcance.alcanza(def, existing, req.user)) {
            return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
          }
          /**
           * ¿Alguien más guardó esta ficha mientras esta persona la tenía
           * abierta? Se avisa en vez de pisarle el trabajo al otro. Quien no
           * manda ninguna marca de versión (la importación, un programa
           * externo) sigue guardando como antes.
           *
           * La marca es `version`, un número que sube con cada guardado.
           * Antes se usaba `updated_at`, que se escribe con precisión de un
           * segundo, y ahí estaba el problema: dos personas que guardaran
           * dentro del mismo segundo dejaban exactamente la misma marca, así
           * que el sistema no notaba nada y la segunda le borraba el trabajo
           * a la primera sin decir una palabra. Y ese —dos personas apretando
           * Guardar casi a la vez— es justo el caso para el que existe todo
           * esto. Se comprobó: con un segundo de diferencia avisaba; dentro
           * del mismo segundo, no.
           *
           * `updated_at` se sigue aceptando de quien no mande `version`, para
           * no dejar afuera a una pantalla que todavía no se haya recargado.
           */
          const traeVersion = req.body.version !== undefined && req.body.version !== null;
          const versionQueTraia = traeVersion ? req.body.version : req.body.updated_at;
          const versionQueHay = traeVersion ? (existing.version === null ? 1 : existing.version) : existing.updated_at;
          if (versionQueTraia !== undefined && versionQueTraia !== null && versionQueHay !== null &&
              String(versionQueTraia) !== String(versionQueHay)) {
            const quien = nombreDeUsuario(existing.updated_by);
            return res.status(409).json({
              error:
                `Otra persona guardó cambios en este ${def.labelSingular.toLowerCase()} mientras usted lo tenía abierto` +
                `${quien ? ` (${quien})` : ''}. Para no borrar su trabajo, revise cómo quedó y vuelva a hacer los suyos.`,
              conflicto: true,
              actual: expandRow(def, existing, req.user),
            });
          }
        }

        /**
         * Lo que está bloqueado por el estado de la ficha no se descarta
         * callado: se contesta. Ver estaBloqueado(), más arriba.
         *
         * Solo se protesta cuando el valor que llega es DISTINTO del guardado.
         * El formulario manda la ficha entera en cada guardado, así que quien
         * corrige las notas de una credencial emitida vuelve a mandar su fecha
         * de vencimiento tal como está; eso no es un intento de cambiarla y no
         * tiene por qué frenar el guardado.
         */
        const trabados = [];
        for (const f of def.fields) {
          if (!estaBloqueado(f, existing)) continue;
          const v = coerce(f, req.body[f.name]);
          if (v === undefined) continue;
          const antes = existing[f.name];
          const igual = String(v == null ? '' : v) === String(antes == null ? '' : antes);
          if (!igual) trabados.push(f);
        }
        if (trabados.length) {
          const cuales = trabados.map((f) => `«${f.label}»`).join(', ');
          const razon = def.razonDelBloqueo
            ? ` ${def.razonDelBloqueo(existing)}`
            : '';
          return res.status(400).json({
            error:
              `${trabados.length === 1 ? 'El campo' : 'Los campos'} ${cuales} ya no se ${trabados.length === 1 ? 'puede' : 'pueden'} cambiar.${razon}`,
          });
        }

        const data = {};
        for (const f of def.fields) {
          if (estaBloqueado(f, existing)) continue;
          /*
           * Un campo de SOLO LECTURA no se toma de lo que llegó: lo escribe el
           * sistema, y aceptarlo del formulario sería dejar que cualquiera se
           * invente el número de serie de una credencial.
           *
           * `soloAlCrear` es la única excepción, y dice exactamente lo que
           * hace: se acepta al CREAR la ficha y nunca más. Es para el dato que
           * cuenta de dónde salió algo —de qué solicitud nació este
           * certificado—: se sabe en el momento en que se crea, no se elige a
           * mano, y cambiarlo después sería reescribir su origen.
           */
          if (f.readonly && !(f.soloAlCrear && isNew)) continue;
          const v = coerce(f, req.body[f.name]);
          if (v !== undefined) data[f.name] = v;
        }
        // Quien no alcanza los datos de salud tampoco los escribe: si no, le
        // bastaría con abrir la ficha y guardar para dejar en blanco un dato
        // que ni siquiera vio (ver server/sensibles.js).
        sensibles.protegerAlGuardar(def, data, req.user, existing);
        if (isNew) aplicarDefectos(def, data);
        sincronizarPersonas(def, data, existing);
        // Alcance: la iglesia tiene que ser una de las suyas. Si no se indica y
        // trabaja en una sola, se pone esa; si indica otra, se rechaza.
        if (isChurchScoped(def)) {
          const suyas = alcance.iglesiasDe(req.user);
          if (suyas.length) {
            const elegida = data.iglesia_id !== undefined && data.iglesia_id !== null
              ? Number(data.iglesia_id)
              : (existing && existing.iglesia_id) || alcance.iglesiaPrincipal(req.user);
            if (!alcance.alcanzaIglesia(req.user, elegida)) {
              return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
            }
            data.iglesia_id = elegida;
          }
        }

        // Alcance: y aquello a lo que el registro APUNTA. La iglesia de arriba
        // no basta: el cuerpo, la persona y la cuenta que se nombran tienen que
        // ser de los suyos (ver referenciasFueraDeAlcance).
        const ajenas = referenciasFueraDeAlcance(def, data, req.user);
        if (ajenas.length) {
          return res.status(403).json({ error: ajenas.join('. ') });
        }

        // Alcance: y el nivel de tesorería. Sin esto, quien no ve la plata de
        // los cuerpos podría registrarle un movimiento escribiendo la cuenta a
        // mano, y después no vería lo que acaba de anotar
        // (ver server/tesorerias.js).
        const avisoDeNivel = tesorerias.alGuardar(def, { ...(existing || {}), ...data }, req.user, db);
        if (avisoDeNivel) return res.status(403).json({ error: avisoDeNivel });

        const aplica = (f) => seAplica(f, data, existing, def.fields);

        // Validación de requeridos (los campos que no aplican no se exigen)
        for (const f of def.fields) {
          if (!f.required || !aplica(f)) continue;
          const val = isNew ? data[f.name] : data[f.name] !== undefined ? data[f.name] : existing[f.name];
          /*
           * Puros espacios NO es un campo lleno. Se comprobaba `val === ''`, así
           * que un «   » pasaba: medido sobre el período de una directiva, que
           * entraba en blanco y dejaba el histórico con una fila sin nombre. No
           * es de ese módulo —vale para todos los campos obligatorios de texto
           * del sistema— y por eso se arregla acá y no allá.
           */
          const enBlanco = val === null || val === undefined
            || (typeof val === 'string' && val.trim() === '');
          if (enBlanco) {
            if (f.type === 'password' && !isNew) continue; // contraseña solo obligatoria al crear
            return res.status(400).json({ error: `El campo "${f.label}" es obligatorio` });
          }
        }

        /*
         * Validación de los límites de los números y del dinero.
         *
         * SE MIRA LO QUE LLEGÓ, NO LO QUE QUEDÓ. `coerce` convierte un campo
         * numérico con `Number(...)`, y lo que no es un número lo deja en
         * nulo; mirando el valor ya convertido, esta revisión no llegaba a ver
         * nunca un valor no numérico —su propio aviso, «tiene que ser un
         * número», era inalcanzable para los campos de tipo número— y el dato
         * se borraba con un 200 y sin una palabra.
         *
         * Medido en la v1.289.0 sobre los folios de un documento: mandando
         * «ocho» y «2,7» el servidor contestaba 201 y el campo quedaba vacío.
         * Vale para los 39 módulos, no solo para ése.
         *
         * La otra puerta de este sistema ya lo hacía bien: la importación por
         * planilla contesta «"ocho" no es un número válido» y nombra la fila
         * (ver server/importar.js). Era el formulario el que callaba.
         *
         * Vaciar a propósito sigue siendo vaciar: lo que llega en blanco —«»,
         * nulo, o el campo que no viene— no se revisa ni se reclama.
         */
        for (const f of def.fields) {
          if (f.type !== 'money' && f.type !== 'number') continue;
          if (!(f.name in data)) continue; // no se está tocando (o es de solo lectura)
          const crudo = req.body[f.name];
          const llegoAlgo = crudo !== undefined && crudo !== null && String(crudo).trim() !== '';
          const val = data[f.name] === null && llegoAlgo ? crudo : data[f.name];
          if (val === undefined || val === null || val === '') continue;
          const problema = revisarLimites(f, val);
          if (problema) return res.status(400).json({ error: problema });
        }

        /*
         * Y que lo que se referencia exista de verdad: no se guarda un
         * documento del cuerpo 88.888 (ver referenciasRotas, más arriba).
         */
        const rotas = referenciasRotas(def, data);
        if (rotas.length) {
          return res.status(400).json({
            error: rotas.length === 1
              ? rotas[0]
              : `Hay ${rotas.length} referencias a registros que no existen. ${rotas.join('. ')}`,
          });
        }

        /**
         * Y de las fechas: que sean fechas, que estén en un rango con sentido
         * y que se lleven bien entre ellas (ver server/fechas.js).
         *
         * Solo se revisa lo que este guardado ESTÁ CAMBIANDO. Una ficha que ya
         * traía una fecha imposible de antes —de una importación vieja, o de
         * un descuido anterior a esta comprobación— se sigue pudiendo guardar
         * para corregirle el teléfono: la comprobación frena el guardado que
         * empeora las cosas, no el que simplemente no arregla algo que ya
         * estaba. Lo que ya estaba se corrige cuando alguien toque esa fecha,
         * que es cuando puede hacer algo al respecto.
         */
        const cambia = (nombre) => {
          const val = data[nombre];
          if (val === undefined) return false;
          if (!existing) return true;
          const antes = existing[nombre];
          return String(antes == null ? '' : antes) !== String(val == null ? '' : val);
        };

        /*
         * Y que un desplegable no admita lo que no ofrece.
         *
         * La pantalla ofrecía las opciones escritas y por la API entraba
         * cualquier otra cosa: un tipo de ayuda «Lo que sea», el estado de un
         * miembro «Cualquier cosa». Por qué se mira solo lo que este guardado
         * está cambiando —y no la ficha entera— está en server/opciones.js: hay
         * fichas que ya traen un valor fuera de su lista y no pueden quedar
         * imposibles de guardar por algo que su dueño no eligió.
         */
        const fueraDeLista = opciones.loQueNoEstaEnLaLista(def, data, cambia);
        if (fueraDeLista) return res.status(400).json({ error: fueraDeLista });

        /*
         * Y lo mismo para los campos cuya lista NO está escrita en el módulo
         * sino guardada en una tabla que mantiene la iglesia.
         *
         * Ésos quedaban fuera de la comprobación de arriba con un argumento que
         * vale para una copia y no para una tabla: comparar contra la tabla no
         * inventa ninguna segunda verdad, porque la tabla ES la verdad. Medido
         * antes de esto: la categoría de un movimiento admitía «Categoría Que
         * No Existe» con un 201. El detalle está en server/opciones.js.
         */
        const fueraDeSuTabla = opciones.loQueNoEstaEnSuTabla(db, def, data, cambia);
        if (fueraDeSuTabla) return res.status(400).json({ error: fueraDeSuTabla });

        /*
         * Y que el archivo que se adjunta esté de verdad en el disco.
         *
         * Un campo de archivo obligatorio se cumplía con cualquier texto: la
         * comprobación miraba que viniera algo, no que ese algo existiera.
         * Medido: se guarda un documento de un miembro con el nombre de un
         * archivo inventado y contesta 201; queda en su carpeta, con su tipo y
         * su fecha, prometiendo un carnet que no está, y su botón «Ver» da 404.
         *
         * Por la pantalla no se llega —el archivo sube al elegirlo y el campo
         * queda con el nombre que devolvió el servidor—, pero cualquier cosa
         * que hable con la API sí, y el resultado es el peor de los dos
         * posibles: una carpeta que dice tener el papel.
         *
         * Se revisa con la misma regla que las fechas: solo lo que este
         * guardado ESTÁ CAMBIANDO. Una ficha vieja que ya apunta a un archivo
         * perdido se sigue pudiendo guardar para corregirle el nombre; lo que
         * se frena es adjuntar hoy algo que no está.
         */
        for (const f of def.fields) {
          if (f.type !== 'file' || !cambia(f.name)) continue;
          const val = data[f.name];
          if (val === null || val === '') continue;
          if (!archivos.existe(val)) {
            return res.status(400).json({
              error: `El archivo de "${f.label}" no está en el servidor. Vuelva a elegirlo y guarde de nuevo.`,
            });
          }
        }

        for (const f of def.fields) {
          if (f.type !== 'date' || !cambia(f.name)) continue;
          const val = data[f.name];
          if (val === null || val === '') continue;
          const problema = fechas.revisar(f, val);
          if (problema) return res.status(400).json({ error: problema });
        }
        // La coherencia se mira solo si alguna de las dos fechas del par se
        // está tocando; si no, es una contradicción que ya venía.
        const tocaAlgunaFecha = def.fields.some((f) => f.type === 'date' && cambia(f.name));
        if (tocaAlgunaFecha) {
          const seContradicen = fechas.revisarCoherencia(def, data, existing);
          if (seContradicen) return res.status(400).json({ error: seContradicen });
        }

        /*
         * Validación de RUT (dígito verificador) y de campos únicos.
         *
         * El RUT se mira SOLO SI VIENE, porque lo que no viene no cambia. Lo
         * único NO se puede mirar así, y ahí estaba el error: un número puede
         * ser único «dentro de» algo —el de un acta lo es dentro de su iglesia,
         * el de un acta de reunión dentro de su cuerpo— y entonces lo que se
         * mueve puede ser ESE ALGO, con el número quieto.
         *
         * Medido en la v1.282.0: mover un acta a una iglesia donde su número ya
         * estaba usado, SIN mandar el número en la petición, contestaba 500 con
         * un número de incidencia —lo frenaba el índice de la base— en vez del
         * aviso que el sistema ya tenía escrito. Mandando el número, el mismo
         * caso contestaba 400 y lo explicaba bien.
         *
         * Así que para un campo único se mira CÓMO VA A QUEDAR el registro: lo
         * que llega si llega, y lo que ya tenía si no. Alcanza a los cuatro
         * módulos con número acotado —Actas de Asambleas y Certificados por
         * iglesia, Actas de Reuniones por cuerpo, y la Oficina de Partes por
         * iglesia y flujo—. Cuesta una consulta por campo único y por guardado,
         * contra un índice que ya existe.
         */
        for (const f of def.fields) {
          const val = data[f.name];
          const llega = val !== undefined && val !== null && val !== '';

          if (f.type === 'rut' && llega && !rut.validar(val)) {
            return res.status(400).json({ error: `El ${f.label} ingresado no es válido: revise el número y su dígito verificador` });
          }

          if (f.unique) {
            const queda = llega ? val : (existing ? existing[f.name] : undefined);
            if (queda === undefined || queda === null || queda === '') continue;
            const dup = buscarDuplicado(def, f, queda, id, data, existing);
            if (dup) {
              return res.status(400).json({ error: avisoDeDuplicado(def, f, dondeEsUnico(def, f, data, existing)) });
            }
          }
        }

        aplicarCalculos(def, data, existing);

        // Todo el guardado ocurre de una sola vez: la ficha, lo que su módulo
        // haga después (los movimientos de una ofrenda, las cuotas de un
        // integrante) y el historial. Si algo falla a mitad de camino, no
        // queda nada a medias: se deshace entero y los datos siguen como
        // estaban. También es lo que mantiene coherente la base cuando dos
        // personas guardan en el mismo momento.
        const escribir = db.transaction(() => {
          if (def.hooks && def.hooks.beforeSave) {
            // `confirmado` dice que la persona ya vio un aviso de los que se pueden
            // confirmar y respondió que sí. No es un dato de la ficha —no se
            // guarda en ninguna columna—, es una instrucción de esta petición.
            const confirmado = req.body.igual_asi === true || req.body.igual_asi === 'true';
            const err = def.hooks.beforeSave(data, { user: req.user, isNew, id, existing, db, confirmado });
            /**
             * Un hook puede devolver dos cosas distintas, y la diferencia
             * importa: un texto es un rechazo —el dato no entra— y un objeto
             * con `confirmar` es una pregunta —el dato puede entrar, pero
             * alguien tiene que decir que sí—. La pantalla convierte lo
             * segundo en dos botones en vez de en un aviso rojo.
             *
             * Y puede traer un tercero: `ir`, adónde llevar a quien contesta.
             * «Abra la que ya existe» sin decir dónde está obliga a salir,
             * buscarla a mano y volver, que es justo lo que nadie hace: la
             * pregunta se contesta «seguir» porque es el único botón que hace
             * algo. Con `ir` hay un botón que lleva.
             */
            if (err) {
              const problema = new ErrorDeDatos(typeof err === 'string' ? err : err.error);
              if (err && err.confirmar) problema.confirmar = err.confirmar;
              if (err && err.ir) problema.ir = err.ir;
              throw problema;
            }
          }

          /*
           * Una iglesia inactiva no recibe nada nuevo (ver
           * server/iglesia-inactiva.js).
           *
           * Va DESPUÉS del gancho del módulo y no arriba, con las otras
           * comprobaciones generales, porque hay módulos que no reciben la
           * iglesia y la deducen ahí: un traspaso la toma de su cuenta de
           * origen, una cuenta de cuerpo la toma de su cuerpo, un artículo de
           * inventario también. Preguntando antes, esos entrarían igual.
           */
          const iglesiaCerrada = require('./iglesia-inactiva')
            .avisoSiLaIglesiaEstaInactiva(db, def, { data, existing, isNew });
          if (iglesiaCerrada) throw new ErrorDeDatos(iglesiaCerrada);

          /*
           * Y a un pastor que ya no ejerce no se le designa de nuevo (ver
           * server/pastor-que-ejerce.js). Acá y no en cada módulo porque son
           * varios los campos que apuntan a Pastores / Guías —el pastor
           * principal de una iglesia, el titular de una credencial— y la regla
           * es una sola: escrita módulo por módulo, se olvidaría en el que
           * venga después.
           */
          const yaNoEjerce = require('./pastor-que-ejerce')
            .avisoSiElPastorYaNoEjerce(db, def, { data, existing, isNew });
          if (yaNoEjerce) throw new ErrorDeDatos(yaNoEjerce);

          /*
           * Y a un cuerpo inactivo no se le cuelga nada nuevo (ver
           * server/cuerpo-inactivo.js). Tercera regla de la misma forma y por
           * el mismo motivo que las dos de arriba: un estado que no hace
           * cumplir nada promete una protección que no existe.
           */
          const cuerpoCerrado = require('./cuerpo-inactivo')
            .avisoSiElCuerpoEstaInactivo(db, def, { data, existing, isNew });
          if (cuerpoCerrado) throw new ErrorDeDatos(cuerpoCerrado);

          const keys = Object.keys(data);
          let row;
          if (isNew) {
            const sql = `INSERT INTO "${def.name}" (${keys.map((k) => `"${k}"`).join(',')}${keys.length ? ',' : ''} created_by)
                         VALUES (${keys.map(() => '?').join(',')}${keys.length ? ',' : ''} ?)`;
            const info = db.prepare(sql).run(...keys.map((k) => data[k]), req.user.id);
            row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(info.lastInsertRowid);
          } else {
            if (keys.length) {
              // La versión sube en el mismo UPDATE: así no hay manera de que
              // un guardado quede escrito sin que la marca avance.
              const sql = `UPDATE "${def.name}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')},
                             updated_at = datetime('now','localtime'), updated_by = ?,
                             version = COALESCE(version, 1) + 1 WHERE id = ?`;
              db.prepare(sql).run(...keys.map((k) => data[k]), req.user.id, id);
            }
            row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(id);
          }

          if (def.hooks && def.hooks.afterSave) {
            // `existing` va también: hay módulos que necesitan saber no solo
            // cómo quedó la ficha, sino qué cambió. Una solicitud anota en su
            // historial que el estado pasó de uno a otro, y eso no se puede
            // deducir mirando únicamente cómo quedó.
            def.hooks.afterSave(row, { user: req.user, isNew, existing, db });
            row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(row.id);
          }
          bitacora.registrarGuardado(def, { isNew, antes: isNew ? {} : existing, despues: row, datos: data, user: req.user });
          return row;
        });

        const row = escribir.immediate();
        return res.status(isNew ? 201 : 200).json(expandRow(def, row, req.user));
      } catch (e) {
        if (e instanceof ErrorDeDatos) {
          return res.status(400).json(
            e.confirmar
              ? { error: e.message, confirmar: e.confirmar, ...(e.ir ? { ir: e.ir } : {}) }
              : { error: e.message }
          );
        }
        return averiaInterna(res, `guardar en ${def.label}`, e);
      }
    };

    /**
     * Lo que hay que hacer ANTES de abrir la transacción.
     *
     * El guardado entero corre de corrido: la base es síncrona y una
     * transacción no se puede interrumpir para esperar nada. Eso está bien
     * para lo que hace —escribir unas filas cuesta milésimas—, pero deja sin
     * lugar a lo que cuesta de verdad y no es base de datos.
     *
     * El caso concreto es cifrar una contraseña: cerca de una décima de
     * segundo de puro cálculo, a propósito. Hecho de corrido, guardar un
     * usuario medía 93 ms y durante esos 93 ms el servidor no atendía a nadie
     * más. Acá se le da un lugar afuera de la transacción, donde sí se puede
     * esperar sin frenar al resto.
     *
     * El gancho recibe el cuerpo de la petición y puede cambiarlo o devolver
     * un motivo para rechazarla, igual que `beforeSave`.
     */
    const conLoQueVaAntes = (isNew, seguir) => async (req, res, next) => {
      const gancho = def.hooks && def.hooks.antesDeGuardar;
      if (!gancho) return seguir(req, res);
      try {
        const id = isNew ? null : Number(req.params.id);
        const existing = id ? db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(id) : null;
        const problema = await gancho(req.body || {}, { isNew, id, existing, user: req.user, db });
        if (problema) return res.status(400).json({ error: problema });
      } catch (e) {
        return next(e);
      }
      return seguir(req, res);
    };

    router.post(base, requirePerm(def.name, 'create'), conLoQueVaAntes(true, save(true)));
    router.put(`${base}/:id(\\d+)`, requirePerm(def.name, 'edit'), conLoQueVaAntes(false, save(false)));

    // ---- eliminar ----
    /*
     * Además del permiso de eliminar de este módulo, la llave de eliminar.
     *
     * Va POR ENCIMA y no en lugar del permiso del módulo: son dos preguntas
     * distintas. «Puede borrar miembros» dice en qué módulo; «Eliminar
     * registros» dice si esta persona hace desaparecer cosas, en general.
     * Separarlas permite lo que hasta ahora no se podía: dejar a alguien
     * corregir un dato mal escrito —que es lo de todos los días— sin dejarlo
     * borrar la ficha entera, que casi nunca corresponde y no se deshace.
     *
     * De fábrica la tienen todos, así que nada cambia mientras nadie la quite.
     */
    const conLlaveDeBorrar = (req, res, siguiente) => {
      if (!can(req.user, 'datos_borrar', 'view')) {
        return res.status(403).json({
          error: 'No tiene permiso para eliminar registros. Puede seguir corrigiendo lo que haya que corregir.',
        });
      }
      return siguiente();
    };

    router.delete(`${base}/:id(\\d+)`, requirePerm(def.name, 'delete'), conLlaveDeBorrar, (req, res) => {
      const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
      if (!alcance.alcanza(def, row, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      try {
        db.transaction(() => {
          if (def.hooks && def.hooks.beforeDelete) {
            /*
             * Un gancho de borrado puede devolver dos cosas, igual que el de
             * guardar: un texto es una negativa —el registro no se borra— y un
             * objeto con `confirmar` es una PREGUNTA, que la pantalla convierte
             * en dos botones.
             *
             * Antes solo podía negarse, y eso obligaba a elegir entre dejar
             * pasar algo que merecía una advertencia o prohibir algo legítimo.
             * Se notó borrando un traspaso: se llevaba $ 400.000 de una cuenta
             * cerrada sin decir una palabra, mientras las otras tres puertas del
             * sistema se negaban a mover un peso de esa misma cuenta. Prohibirlo
             * habría sido peor —un traspaso mal anotado hay que poder borrarlo—.
             */
            const confirmado = req.query.igual_asi === 'true' || req.query.igual_asi === '1';
            const err = def.hooks.beforeDelete(row, { user: req.user, db, confirmado });
            if (err) {
              const problema = new ErrorDeDatos(typeof err === 'string' ? err : err.error);
              if (err && err.confirmar) problema.confirmar = err.confirmar;
              throw problema;
            }
          }

          /**
           * Lo que colgaba de esta ficha, resuelto antes de borrarla.
           *
           * Va primero porque puede frenar el borrado —una cuenta con
           * movimientos, un miembro con certificados emitidos— y entonces no
           * tiene que haber quedado nada anotado ni ningún archivo borrado.
           * Lo que arrastra se lleva también sus archivos, por la misma razón
           * por la que se lleva los de esta (ver server/dependencias.js).
           */
          const arrastre = dependencias.resolver(db, def, row, {
            alBorrarFila: (hijaDef, hijaFila) => archivos.borrarLosDe(hijaDef, hijaFila),
          });

          // Se anota antes de borrar: después ya no hay de dónde sacar qué era.
          // Y se anota junto con lo que se llevó consigo, que es lo que después
          // explica por qué desaparecieron cosas que nadie borró a mano.
          bitacora.registrarEliminado(def, row, req.user, arrastre);
          // Y se llevan sus archivos, que si no quedarían en el disco para
          // siempre sin ficha desde donde llegar a ellos (ver server/archivos.js)
          archivos.borrarLosDe(def, row);
          db.prepare(`DELETE FROM "${def.name}" WHERE id = ?`).run(req.params.id);
        }).immediate();
      } catch (e) {
        if (e instanceof ErrorDeDatos || e.esDeDatos) {
          return res.status(400).json({ error: e.message, ...(e.confirmar ? { confirmar: e.confirmar } : {}) });
        }
        return averiaInterna(res, `eliminar en ${def.label}`, e);
      }
      res.json({ ok: true });
    });

    // ---- rutas extra propias del módulo ----
    if (def.extraRoutes) {
      def.extraRoutes(router, {
        db, base, requirePerm, can,
        // Lleva el usuario para que las rutas propias del módulo tapen los
        // datos de salud igual que las del motor
        expandRow: (row, usuario) => expandRow(def, row, usuario),
        scopeClause: (user, params) => scopeClause(def, user, params),
        /*
         * Cómo se arma el listado que la persona está mirando: alcance,
         * búsqueda, filtros y rango de fechas, tal cual.
         *
         * Se lo presta el motor a las rutas del módulo para que un total o un
         * informe sumen EXACTAMENTE las filas que la pantalla muestra. Armado
         * aparte, un día empiezan a discrepar —un filtro nuevo que la pantalla
         * conoce y el total no— y nadie se entera, porque las dos cifras se
         * ven razonables por separado.
         */
        comoSeArmaElListado: (req) => consultaDeUnListado(def, req),
      });
    }
  }

  return router;
}

module.exports = {
  consultaDeUnListado,
  // Por acá salen las cuatro puertas de una ficha —el listado, el detalle, la
  // respuesta de guardar y la planilla—, así que es donde se puede comprobar de
  // una vez que un dato reservado no sale por ninguna.
  expandRows,
  buildRouter, coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos, columnasPara,
  revisarLimites, buscarDuplicado, avisoDeDuplicado, dondeEsUnico, seAplica, estaBloqueado, TECHO,
  referenciasRotas, referenciasFueraDeAlcance,
  // Se exporta para que las pruebas puedan exigir que un dato mal escrito se
  // le explique a la persona (400) en vez de salir como avería del sistema.
  ErrorDeDatos,
};
