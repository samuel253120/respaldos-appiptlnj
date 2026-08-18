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
 *   transformar (p. ej. usuarios cifra la contraseña).
 */
const express = require('express');
const { db } = require('./db');
const { getModule, allModules, displayOf } = require('./registry');
const { authRequired, requirePerm } = require('./auth');
const { can } = require('./permissions');

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
    default:
      return String(value);
  }
}

/** Expande refs/multirefs de una fila con sus etiquetas de presentación. */
function expandRow(def, row) {
  const out = { ...row };
  for (const f of def.fields) {
    if (f.type === 'multiref') {
      let ids = [];
      try {
        ids = JSON.parse(row[f.name] || '[]');
      } catch (e) {
        ids = [];
      }
      out[f.name] = ids;
      const refDef = getModule(f.ref);
      if (refDef && ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM "${refDef.name}" WHERE id IN (${placeholders})`).all(...ids);
        const byId = new Map(rows.map((r) => [r.id, displayOf(refDef, r)]));
        out[f.name + '_labels'] = ids.map((id) => byId.get(id) || `#${id}`);
      } else {
        out[f.name + '_labels'] = [];
      }
    } else if (f.type === 'ref' && row[f.name] != null) {
      const refDef = getModule(f.ref);
      if (refDef) {
        const r = db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(row[f.name]);
        out[f.name + '_label'] = r ? displayOf(refDef, r) : `#${row[f.name]}`;
      }
    }
    if (f.type === 'password') delete out[f.name];
  }
  return out;
}

/** WHERE de alcance por iglesia para el usuario actual. */
function scopeClause(def, user, params) {
  if (isChurchScoped(def) && user.iglesia_id) {
    params.push(user.iglesia_id);
    return def.name === 'iglesias' ? 'id = ?' : 'iglesia_id = ?';
  }
  if (def.name === 'iglesias' && user.iglesia_id) {
    params.push(user.iglesia_id);
    return 'id = ?';
  }
  return null;
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
      const sql = `SELECT * FROM "${def.name}" ${where ? 'WHERE ' + where : ''} ORDER BY id DESC LIMIT 1000`;
      const rows = db.prepare(sql).all(...params);
      res.json(rows.map((r) => ({ id: r.id, label: displayOf(def, r) })));
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
      const rows = db
        .prepare(`SELECT * FROM "${def.name}" ${whereSql} ORDER BY "${sortField}" ${sortDir} LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);

      res.json({ rows: rows.map((r) => expandRow(def, r)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    });

    // ---- detalle ----
    router.get(`${base}/:id(\\d+)`, requirePerm(def.name, 'view'), (req, res) => {
      const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
      if (isChurchScoped(def) && req.user.iglesia_id && row.iglesia_id !== req.user.iglesia_id) {
        return res.status(403).json({ error: 'Registro fuera de su iglesia asignada' });
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
          if (isChurchScoped(def) && req.user.iglesia_id && existing.iglesia_id !== req.user.iglesia_id) {
            return res.status(403).json({ error: 'Registro fuera de su iglesia asignada' });
          }
        }

        const data = {};
        for (const f of def.fields) {
          if (f.readonly) continue;
          const v = coerce(f, req.body[f.name]);
          if (v !== undefined) data[f.name] = v;
        }
        // Alcance: forzar la iglesia del usuario
        if (isChurchScoped(def) && req.user.iglesia_id) data.iglesia_id = req.user.iglesia_id;

        // Validación de requeridos
        for (const f of def.fields) {
          if (!f.required) continue;
          const val = isNew ? data[f.name] : data[f.name] !== undefined ? data[f.name] : existing[f.name];
          if (val === null || val === undefined || val === '') {
            if (f.type === 'password' && !isNew) continue; // contraseña solo obligatoria al crear
            return res.status(400).json({ error: `El campo "${f.label}" es obligatorio` });
          }
        }

        if (def.hooks && def.hooks.beforeSave) {
          const err = def.hooks.beforeSave(data, { user: req.user, isNew, id, existing, db });
          if (err) return res.status(400).json({ error: err });
        }

        if (isNew) {
          const keys = Object.keys(data);
          const sql = `INSERT INTO "${def.name}" (${keys.map((k) => `"${k}"`).join(',')}${keys.length ? ',' : ''} created_by)
                       VALUES (${keys.map(() => '?').join(',')}${keys.length ? ',' : ''} ?)`;
          const info = db.prepare(sql).run(...keys.map((k) => data[k]), req.user.id);
          const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(info.lastInsertRowid);
          return res.status(201).json(expandRow(def, row));
        } else {
          const keys = Object.keys(data);
          if (keys.length) {
            const sql = `UPDATE "${def.name}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`;
            db.prepare(sql).run(...keys.map((k) => data[k]), id);
          }
          const row = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(id);
          return res.json(expandRow(def, row));
        }
      } catch (e) {
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
      if (isChurchScoped(def) && req.user.iglesia_id && row.iglesia_id !== req.user.iglesia_id) {
        return res.status(403).json({ error: 'Registro fuera de su iglesia asignada' });
      }
      if (def.hooks && def.hooks.beforeDelete) {
        const err = def.hooks.beforeDelete(row, { user: req.user, db });
        if (err) return res.status(400).json({ error: err });
      }
      db.prepare(`DELETE FROM "${def.name}" WHERE id = ?`).run(req.params.id);
      res.json({ ok: true });
    });

    // ---- rutas extra propias del módulo ----
    if (def.extraRoutes) {
      def.extraRoutes(router, { db, base, requirePerm, can, expandRow: (row) => expandRow(def, row), scopeClause: (user, params) => scopeClause(def, user, params) });
    }
  }

  return router;
}

module.exports = { buildRouter };
