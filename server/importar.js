/**
 * Importación masiva de datos.
 *
 * POST /api/importar/:modulo   { filas: [ {campo: valor, ...} ], prueba: true|false }
 *
 * - `prueba: true` valida todo y NO guarda nada (revisión previa).
 * - Devuelve cuántas filas quedarían bien y el detalle de los errores por fila.
 *
 * Comodidades pensadas para archivos exportados de otros sistemas:
 * - Los campos de relación (iglesia, cuerpo, miembro…) aceptan el NOMBRE en
 *   vez del número interno: "Iglesia Central" en lugar de 3.
 * - Los campos de varias relaciones aceptan valores separados por | o ;
 * - Los campos Sí/No aceptan sí, si, no, 1, 0, true, false, x.
 * - Las fechas aceptan dd/mm/aaaa además de aaaa-mm-dd.
 * - El RUT se valida y normaliza igual que en los formularios.
 */
const express = require('express');
const { db } = require('./db');
const { getModule, displayOf } = require('./registry');
const { authRequired, requirePerm } = require('./auth');
const { coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos } = require('./crud');
const rut = require('./rut');

const MAX_FILAS = 5000;

/** Convierte fechas dd/mm/aaaa (o dd-mm-aaaa) al formato aaaa-mm-dd. */
function normalizarFecha(valor) {
  const v = String(valor).trim();
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return v.slice(0, 10);
  const [, d, mes, a] = m;
  return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Lee un número escrito como se acostumbra en Chile o en inglés:
 * "1.250.500" → 1250500 · "45.990,50" → 45990.5 · "1234.56" → 1234.56
 * Devuelve null si no es un número.
 */
function normalizarNumero(valor) {
  let s = String(valor).replace(/[\s$]/g, '');
  if (!s) return null;
  const punto = s.lastIndexOf('.');
  const coma = s.lastIndexOf(',');

  if (punto !== -1 && coma !== -1) {
    // El separador que aparece más a la derecha es el decimal
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma !== -1) {
    s = s.replace(',', '.'); // coma decimal (uso chileno)
  } else if (punto !== -1) {
    const partes = s.split('.');
    // Varios puntos, o grupo final de 3 dígitos → separador de miles
    if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Busca un registro del módulo referido por su texto de presentación. */
function buscarPorTexto(refDef, texto) {
  const buscado = String(texto).trim().toLowerCase();
  const filas = db.prepare(`SELECT * FROM "${refDef.name}" LIMIT 5000`).all();
  return filas.find((r) => displayOf(refDef, r).trim().toLowerCase() === buscado) || null;
}

/** Prepara y valida una fila; devuelve { datos, errores }. */
function prepararFila(def, fila, user) {
  const datos = {};
  const errores = [];

  for (const f of def.fields) {
    let valor = fila[f.name];
    if (valor === undefined || valor === null) continue;
    if (typeof valor === 'string') valor = valor.trim();
    if (valor === '') continue;

    if (f.type === 'ref') {
      const refDef = getModule(f.ref);
      if (!refDef) continue;
      if (/^\d+$/.test(String(valor))) {
        const existe = db.prepare(`SELECT id FROM "${refDef.name}" WHERE id = ?`).get(Number(valor));
        if (!existe) {
          errores.push(`${f.label}: no existe el registro #${valor} en ${refDef.label}`);
          continue;
        }
        valor = Number(valor);
      } else {
        const encontrado = buscarPorTexto(refDef, valor);
        if (!encontrado) {
          errores.push(`${f.label}: no se encontró "${valor}" en ${refDef.label}`);
          continue;
        }
        valor = encontrado.id;
      }
    } else if (f.type === 'multiref') {
      const refDef = getModule(f.ref);
      const partes = String(valor).split(/[|;]/).map((p) => p.trim()).filter(Boolean);
      const ids = [];
      for (const parte of partes) {
        if (/^\d+$/.test(parte)) {
          ids.push(Number(parte));
          continue;
        }
        const encontrado = refDef && buscarPorTexto(refDef, parte);
        if (!encontrado) {
          errores.push(`${f.label}: no se encontró "${parte}"`);
          continue;
        }
        ids.push(encontrado.id);
      }
      valor = ids;
    } else if (f.type === 'boolean') {
      valor = /^(s[ií]|1|true|verdadero|x|activo)$/i.test(String(valor)) ? 1 : 0;
    } else if (f.type === 'date') {
      valor = normalizarFecha(valor);
    } else if (f.type === 'money' || f.type === 'number') {
      valor = normalizarNumero(valor);
      if (valor === null) {
        errores.push(`${f.label}: "${fila[f.name]}" no es un número válido`);
        continue;
      }
    }

    const convertido = coerce(f, valor);
    if (convertido !== undefined) datos[f.name] = convertido;
  }

  // Alcance por iglesia: se fuerza la del usuario si tiene una asignada
  if (user.iglesia_id && def.fields.some((f) => f.name === 'iglesia_id')) {
    datos.iglesia_id = user.iglesia_id;
  }

  for (const f of def.fields) {
    const valor = datos[f.name];
    if (f.required && (valor === undefined || valor === null || valor === '')) {
      errores.push(`Falta ${f.label}`);
    }
    if (valor == null || valor === '') continue;
    if (f.type === 'rut' && !rut.validar(valor)) {
      errores.push(`${f.label}: "${valor}" no es válido (dígito verificador)`);
    }
    if (f.unique) {
      const dup = db
        .prepare(`SELECT id FROM "${def.name}" WHERE lower("${f.name}") = lower(?)`)
        .get(String(valor));
      if (dup) errores.push(`${f.label}: "${valor}" ya existe (registro #${dup.id})`);
    }
  }

  aplicarDefectos(def, datos);
  sincronizarPersonas(def, datos, null);
  aplicarCalculos(def, datos, null);

  if (!errores.length && def.hooks && def.hooks.beforeSave) {
    const err = def.hooks.beforeSave(datos, { user, isNew: true, id: null, existing: null, db });
    if (err) errores.push(err);
  }

  return { datos, errores };
}

const router = express.Router();
router.use(authRequired);

router.post('/:modulo', (req, res) => {
  const def = getModule(req.params.modulo);
  if (!def) return res.status(404).json({ error: 'Módulo no encontrado' });

  requirePerm(def.name, 'create')(req, res, () => {
    const filas = Array.isArray(req.body && req.body.filas) ? req.body.filas : null;
    if (!filas || !filas.length) return res.status(400).json({ error: 'No se recibió ninguna fila' });
    if (filas.length > MAX_FILAS) {
      return res.status(400).json({ error: `Máximo ${MAX_FILAS} filas por importación; divida el archivo` });
    }
    const prueba = req.body.prueba !== false; // por seguridad, revisión previa salvo que se pida guardar

    const errores = [];
    let listas = 0;

    const ejecutar = db.transaction(() => {
      filas.forEach((fila, i) => {
        const { datos, errores: errFila } = prepararFila(def, fila, req.user);
        if (errFila.length) {
          errores.push({ fila: i + 1, errores: errFila });
          return;
        }
        const claves = Object.keys(datos);
        if (!claves.length) {
          errores.push({ fila: i + 1, errores: ['La fila está vacía'] });
          return;
        }
        db.prepare(
          `INSERT INTO "${def.name}" (${claves.map((k) => `"${k}"`).join(',')}, created_by)
           VALUES (${claves.map(() => '?').join(',')}, ?)`
        ).run(...claves.map((k) => datos[k]), req.user.id);
        listas++;
      });
      if (prueba) throw new Error('__revision__'); // deshace todo: solo era una revisión
    });

    try {
      ejecutar();
    } catch (e) {
      if (e.message !== '__revision__') {
        console.error('Error importando:', e);
        return res.status(500).json({ error: 'Error al importar: ' + e.message });
      }
    }

    res.json({
      prueba,
      total: filas.length,
      correctas: listas,
      conError: errores.length,
      errores: errores.slice(0, 100),
    });
  });
});

module.exports = { router };
