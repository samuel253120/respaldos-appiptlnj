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
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
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
function porcentajeDe(calcula) {
  if (calcula.opcion) {
    const ajustes = require('./ajustes'); // tardío: ajustes usa la base
    const n = Number(ajustes.obtener(calcula.opcion));
    if (Number.isFinite(n)) return n;
  }
  return Number(calcula.porcentaje) || 0;
}

function aplicarCalculos(def, data, existing) {
  const numero = (nombre) => {
    const v = data[nombre] !== undefined ? data[nombre] : existing ? existing[nombre] : null;
    const n = Number(v);
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
      data[f.name] = redondear((numero(c.campo) * porcentajeDe(c)) / 100);
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
        out[c.name] = c.calc(row, { db });
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
  return sensibles.limpiarVarias(def, resueltas, usuario);
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

/** Cómo se le dice a alguien que ese valor ya está usado. */
function avisoDeDuplicado(def, campo) {
  const donde = campo.unique === 'iglesia_id' ? ' en esta iglesia' : '';
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
      res.json(
        rows.map((r) => {
          const label = displayOf(def, r);
          const enElTexto = label.toLowerCase();
          const extra = buscables
            .map((n) => r[n])
            .filter((v) => v != null && v !== '' && !enElTexto.includes(String(v).toLowerCase()))
            .join(' ');
          return { id: r.id, label, buscar: `${label} ${extra}`.trim() };
        })
      );
    });

    /**
     * La consulta del listado: alcance, búsqueda, filtros, rango de fechas y
     * orden. Se arma en un solo lugar porque la usan dos rutas —la que pinta
     * la pantalla y la que baja la planilla—, y tienen que mirar exactamente
     * lo mismo: si la planilla se armara aparte, un día traería filas que la
     * pantalla no muestra, o de una iglesia que no le toca a quien la pide.
     */
    const consultaDelListado = (req) => {
      const params = [];
      const where = [];
      const scope = scopeClause(def, req.user, params);
      if (scope) where.push(scope);

      const q = (req.query.q || '').trim();
      // Solo por los campos que esta persona alcanza: un teléfono que no se le
      // muestra tampoco sirve para encontrar a su dueño, porque si sirviera
      // bastaría con probar números para averiguar de quién es cada uno.
      const buscables = sensibles.buscablesPara(def, req.user);
      if (q && buscables.length) {
        const like = buscables.map((f) => `"${f}" LIKE ?`).join(' OR ');
        where.push(`(${like})`);
        buscables.forEach(() => params.push(`%${q}%`));
      }

      // Filtros exactos: ?f_campo=valor (solo campos declarados)
      for (const [key, val] of Object.entries(req.query)) {
        if (!key.startsWith('f_') || val === '') continue;
        const fname = key.slice(2);
        if (!fields[fname] && fname !== 'id') continue;
        where.push(`"${fname}" = ?`);
        params.push(val);
      }
      // Lo que falta por llenar: ?sin=email trae los que no tienen correo.
      // Sirve para que un conteo de «datos por completar» se pueda abrir como
      // lista y llenarse, en vez de quedar en un número que nadie sabe a
      // quiénes corresponde.
      for (const nombre of String(req.query.sin || '').split(',').map((n) => n.trim()).filter(Boolean)) {
        if (!fields[nombre]) continue;
        where.push(`("${nombre}" IS NULL OR TRIM("${nombre}") = '')`);
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
      if (!fields[sortField] && sortField !== 'id') sortField = 'id';
      const sortDir = (req.query.dir || def.defaultSort.dir) === 'asc' ? 'ASC' : 'DESC';

      // Se desempata por id para que el orden sea estable y cronológico
      // cuando varios registros comparten el mismo valor (p. ej. la misma fecha).
      return {
        params,
        whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '',
        ordenSql: `ORDER BY "${sortField}" ${sortDir}${sortField === 'id' ? '' : `, id ${sortDir}`}`,
      };
    };

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

        const data = {};
        for (const f of def.fields) {
          if (f.readonly) continue;
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

        /** ¿Aplica este campo, según su condición showIf? */
        const aplica = (f) => {
          if (!f.showIf) return true;
          const actual = data[f.showIf.field] !== undefined
            ? data[f.showIf.field]
            : existing
              ? existing[f.showIf.field]
              : undefined;
          if (Array.isArray(f.showIf.in)) return f.showIf.in.includes(actual);
          return actual === f.showIf.equals;
        };

        // Validación de requeridos (los campos que no aplican no se exigen)
        for (const f of def.fields) {
          if (!f.required || !aplica(f)) continue;
          const val = isNew ? data[f.name] : data[f.name] !== undefined ? data[f.name] : existing[f.name];
          if (val === null || val === undefined || val === '') {
            if (f.type === 'password' && !isNew) continue; // contraseña solo obligatoria al crear
            return res.status(400).json({ error: `El campo "${f.label}" es obligatorio` });
          }
        }

        // Validación de los límites de los números y del dinero
        for (const f of def.fields) {
          if (f.type !== 'money' && f.type !== 'number') continue;
          const val = data[f.name];
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

        // Validación de RUT (dígito verificador) y de campos únicos
        for (const f of def.fields) {
          const val = data[f.name];
          if (val === undefined || val === null || val === '') continue;
          if (f.type === 'rut' && !rut.validar(val)) {
            return res.status(400).json({ error: `El ${f.label} ingresado no es válido: revise el número y su dígito verificador` });
          }
          if (f.unique) {
            const dup = buscarDuplicado(def, f, val, id, data, existing);
            if (dup) return res.status(400).json({ error: avisoDeDuplicado(def, f) });
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
             */
            if (err) {
              const problema = new ErrorDeDatos(typeof err === 'string' ? err : err.error);
              if (err && err.confirmar) problema.confirmar = err.confirmar;
              throw problema;
            }
          }

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
          return res.status(400).json(e.confirmar ? { error: e.message, confirmar: e.confirmar } : { error: e.message });
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
    router.delete(`${base}/:id(\\d+)`, requirePerm(def.name, 'delete'), (req, res) => {
      const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
      if (!alcance.alcanza(def, row, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      try {
        db.transaction(() => {
          if (def.hooks && def.hooks.beforeDelete) {
            const err = def.hooks.beforeDelete(row, { user: req.user, db });
            if (err) throw new ErrorDeDatos(err);
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
        if (e instanceof ErrorDeDatos || e.esDeDatos) return res.status(400).json({ error: e.message });
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
      });
    }
  }

  return router;
}

module.exports = {
  buildRouter, coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos, columnasPara,
  revisarLimites, buscarDuplicado, avisoDeDuplicado, TECHO,
  referenciasRotas, referenciasFueraDeAlcance,
  // Se exporta para que las pruebas puedan exigir que un dato mal escrito se
  // le explique a la persona (400) en vez de salir como avería del sistema.
  ErrorDeDatos,
};
