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
 *   isNew, db }) actúa con el registro ya guardado (p. ej. un traspaso deja al
 *   día sus dos movimientos).
 */
const express = require('express');
const { db } = require('./db');
const { getModule, allModules, displayOf } = require('./registry');
const { authRequired, requirePerm } = require('./auth');
const rut = require('./rut');
const { can } = require('./permissions');
const bitacora = require('./bitacora');
const alcance = require('./alcance');

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
    case 'multiref': {
      const arr = Array.isArray(value) ? value : [];
      return JSON.stringify(arr.map(Number).filter((n) => Number.isFinite(n) && n > 0));
    }
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
function expandRows(def, filas) {
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
  return filas.map((row) => {
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
        out[c.name] = null;
      }
    }
    return out;
  });
}

/** Expande una fila suelta. */
function expandRow(def, row) {
  return expandRows(def, [row])[0];
}

/** WHERE de alcance por iglesia para el usuario actual. */
/**
 * Acota las consultas a lo que el usuario puede ver: sus iglesias y, si se le
 * asignaron, sus cuerpos (ver server/alcance.js).
 */
function scopeClause(def, user, params) {
  return alcance.condiciones(def, user, params);
}

function buildRouter() {
  const router = express.Router();
  router.use(authRequired);

  for (const def of allModules()) {
    const base = `/${def.name}`;
    const fields = fieldMap(def);

    // ---- opciones para selectores (requiere solo poder ver el módulo que referencia,
    //      por eso basta 'view' sobre este módulo o sobre cualquiera que lo use) ----
    router.get(`${base}/options`, (req, res) => {
      // Cualquier usuario autenticado puede listar opciones básicas (id + texto),
      // necesario para llenar selectores de referencia en formularios.
      const params = [];
      let where = scopeClause(def, req.user, params);
      // Solo se traen las columnas que se usan acá —el texto que se muestra y
      // aquello por lo que se puede buscar—: un selector de miembros pedía la
      // ficha entera de cada uno, y esto se abre en cada formulario.
      const buscables = (def.searchFields || []).filter((n) => n !== 'password');
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

    // ---- listar ----
    router.get(base, requirePerm(def.name, 'view'), (req, res) => {
      const params = [];
      const where = [];
      const scope = scopeClause(def, req.user, params);
      if (scope) where.push(scope);

      const q = (req.query.q || '').trim();
      if (q && def.searchFields.length) {
        const like = def.searchFields.map((f) => `"${f}" LIKE ?`).join(' OR ');
        where.push(`(${like})`);
        def.searchFields.forEach(() => params.push(`%${q}%`));
      }

      // Filtros exactos: ?f_campo=valor (solo campos declarados)
      for (const [key, val] of Object.entries(req.query)) {
        if (!key.startsWith('f_') || val === '') continue;
        const fname = key.slice(2);
        if (!fields[fname] && fname !== 'id') continue;
        where.push(`"${fname}" = ?`);
        params.push(val);
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

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) AS c FROM "${def.name}" ${whereSql}`).get(...params).c;
      // Se desempata por id para que el orden sea estable y cronológico
      // cuando varios registros comparten el mismo valor (p. ej. la misma fecha).
      const rows = db
        .prepare(
          `SELECT * FROM "${def.name}" ${whereSql}
           ORDER BY "${sortField}" ${sortDir}${sortField === 'id' ? '' : `, id ${sortDir}`}
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      res.json({ rows: expandRows(def, rows), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    });

    // ---- detalle ----
    router.get(`${base}/:id(\\d+)`, requirePerm(def.name, 'view'), (req, res) => {
      const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
      if (!alcance.alcanza(def, row, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      res.json(expandRow(def, row));
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
          // ¿Alguien más guardó esta ficha mientras esta persona la tenía
          // abierta? Se avisa en vez de pisarle el trabajo al otro. Quien no
          // manda la marca de versión (la importación, un programa externo)
          // sigue guardando como antes.
          const versionQueTraia = req.body.updated_at;
          if (versionQueTraia && existing.updated_at && String(versionQueTraia) !== String(existing.updated_at)) {
            const quien = nombreDeUsuario(existing.updated_by);
            return res.status(409).json({
              error:
                `Otra persona guardó cambios en este ${def.labelSingular.toLowerCase()} mientras usted lo tenía abierto` +
                `${quien ? ` (${quien})` : ''}. Para no borrar su trabajo, revise cómo quedó y vuelva a hacer los suyos.`,
              conflicto: true,
              actual: expandRow(def, existing),
            });
          }
        }

        const data = {};
        for (const f of def.fields) {
          if (f.readonly) continue;
          const v = coerce(f, req.body[f.name]);
          if (v !== undefined) data[f.name] = v;
        }
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

        // Validación de RUT (dígito verificador) y de campos únicos
        for (const f of def.fields) {
          const val = data[f.name];
          if (val === undefined || val === null || val === '') continue;
          if (f.type === 'rut' && !rut.validar(val)) {
            return res.status(400).json({ error: `El ${f.label} ingresado no es válido: revise el número y su dígito verificador` });
          }
          if (f.unique) {
            const dup = db
              .prepare(`SELECT id FROM "${def.name}" WHERE lower("${f.name}") = lower(?) AND id != ?`)
              .get(String(val), id || 0);
            if (dup) {
              return res.status(400).json({ error: `Ya existe otro ${def.labelSingular.toLowerCase()} con ese ${f.label}` });
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
            const err = def.hooks.beforeSave(data, { user: req.user, isNew, id, existing, db });
            if (err) throw new ErrorDeDatos(err);
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
              const sql = `UPDATE "${def.name}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')},
                             updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?`;
              db.prepare(sql).run(...keys.map((k) => data[k]), req.user.id, id);
            }
            row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(id);
          }

          if (def.hooks && def.hooks.afterSave) {
            def.hooks.afterSave(row, { user: req.user, isNew, db });
            row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(row.id);
          }
          bitacora.registrarGuardado(def, { isNew, antes: isNew ? {} : existing, despues: row, datos: data, user: req.user });
          return row;
        });

        const row = escribir();
        return res.status(isNew ? 201 : 200).json(expandRow(def, row));
      } catch (e) {
        if (e instanceof ErrorDeDatos) return res.status(400).json({ error: e.message });
        console.error(`Error guardando en ${def.name}:`, e);
        return res.status(500).json({ error: 'Error interno al guardar: ' + e.message });
      }
    };

    router.post(base, requirePerm(def.name, 'create'), save(true));
    router.put(`${base}/:id(\\d+)`, requirePerm(def.name, 'edit'), save(false));

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
          // Se anota antes de borrar: después ya no hay de dónde sacar qué era
          bitacora.registrarEliminado(def, row, req.user);
          db.prepare(`DELETE FROM "${def.name}" WHERE id = ?`).run(req.params.id);
        })();
      } catch (e) {
        if (e instanceof ErrorDeDatos) return res.status(400).json({ error: e.message });
        console.error(`Error eliminando en ${def.name}:`, e);
        return res.status(500).json({ error: 'Error interno al eliminar: ' + e.message });
      }
      res.json({ ok: true });
    });

    // ---- rutas extra propias del módulo ----
    if (def.extraRoutes) {
      def.extraRoutes(router, { db, base, requirePerm, can, expandRow: (row) => expandRow(def, row), scopeClause: (user, params) => scopeClause(def, user, params) });
    }
  }

  return router;
}

module.exports = { buildRouter, coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos };
