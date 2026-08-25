/**
 * Importación masiva de datos.
 *
 * POST /api/importar/:modulo   { filas: [ {campo: valor, ...} ], prueba: true|false }
 *
 * - `prueba: true` valida todo y NO guarda nada (revisión previa).
 * - Devuelve cuántas filas quedarían bien y el detalle de los errores por fila.
 *
 * Lo que entra por acá pasa por lo mismo que lo que se escribe a mano: los
 * campos obligatorios, el RUT, los duplicados, los rangos de las fechas, los
 * topes de los montos, las reglas propias del módulo, lo que el módulo hace
 * después de guardar —las cuentas de un cuerpo, la ofrenda de un servicio— y
 * el rastro en el historial. Durante un tiempo no fue así, y por acá entraban
 * cosas que el formulario ya no dejaba entrar.
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
const {
  coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos, revisarLimites,
  buscarDuplicado, avisoDeDuplicado,
} = require('./crud');
const rut = require('./rut');
const bitacora = require('./bitacora');
const sensibles = require('./sensibles');

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
  const alcance = require('./alcance');
  const principal = alcance.iglesiaPrincipal(user);
  if (principal && def.fields.some((f) => f.name === 'iglesia_id') && !datos.iglesia_id) {
    datos.iglesia_id = principal;
  }
  if (datos.iglesia_id && !alcance.alcanzaIglesia(user, datos.iglesia_id)) {
    errores.push('Esa iglesia no está entre las que tiene asignadas');
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
    // Las mismas reglas de fecha que el formulario: que sea una fecha, que
    // esté en un rango con sentido y que no llegue del futuro cuando el campo
    // anota algo que ya pasó (ver server/fechas.js). Sin esto, la planilla
    // metía por la puerta de atrás lo que el formulario ya no deja entrar.
    if (f.type === 'date') {
      const problema = require('./fechas').revisar(f, valor);
      if (problema) errores.push(problema);
    }
    // Y los mismos topes de los montos. Se comprobó que sin esto entraba por
    // planilla un movimiento de 1e308 y el saldo de la iglesia pasaba a decir
    // «1e+308»: no es que quedara grande, es que dejaba de ser un número con
    // el que se pueda trabajar.
    if (f.type === 'money' || f.type === 'number') {
      const problema = revisarLimites(f, valor);
      if (problema) errores.push(problema);
    }
    if (f.unique) {
      // La misma regla que el formulario, incluida la unicidad acotada a la
      // iglesia (ver buscarDuplicado en server/crud.js).
      const dup = buscarDuplicado(def, f, valor, null, datos, null);
      if (dup) errores.push(`${avisoDeDuplicado(def, f)}: "${valor}" (registro #${dup.id})`);
    }
  }

  const seContradicen = require('./fechas').revisarCoherencia(def, datos, null);
  if (seContradicen) errores.push(seContradicen);

  // Quien no alcanza los datos de salud tampoco los escribe por planilla:
  // si no, bastaba con importar para dejar anotado en una ficha algo que esa
  // persona no puede ni leer (ver server/sensibles.js).
  sensibles.protegerAlGuardar(def, datos, user, null);

  aplicarDefectos(def, datos);
  sincronizarPersonas(def, datos, null);
  aplicarCalculos(def, datos, null);

  if (!errores.length && def.hooks && def.hooks.beforeSave) {
    /**
     * El hook puede devolver un texto —rechaza— o un objeto con `confirmar`
     * —pregunta—. En un formulario la pregunta se contesta; en una planilla de
     * quinientas filas no hay a quién preguntarle quinientas veces, así que se
     * marca la fila y quien importa la revisa en la vista previa. Es lo
     * correcto: un egreso que deja una cuenta en rojo puede ser cierto, pero
     * no es algo que deba pasar sin que nadie lo mire.
     */
    const err = def.hooks.beforeSave(datos, { user, isNew: true, id: null, existing: null, db, confirmado: false });
    if (err) errores.push(typeof err === 'string' ? err : err.error);
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
        const info = db
          .prepare(
            `INSERT INTO "${def.name}" (${claves.map((k) => `"${k}"`).join(',')}, created_by)
             VALUES (${claves.map(() => '?').join(',')}, ?)`
          )
          .run(...claves.map((k) => datos[k]), req.user.id);

        /**
         * Y lo que el módulo hace DESPUÉS de guardar, que antes no se hacía.
         *
         * No es un detalle: `afterSave` es donde una iglesia y un cuerpo crean
         * sus cuentas de tesorería, donde la ofrenda de un servicio se anota
         * en los libros y donde un traspaso genera sus dos movimientos. Se
         * comprobó que sin esto un cuerpo importado nacía sin ninguna cuenta y
         * un servicio con cien mil pesos de ofrenda no ponía un peso en la
         * tesorería. La fila quedaba guardada y a medias.
         */
        const guardada = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(info.lastInsertRowid);
        if (guardada && def.hooks && def.hooks.afterSave) {
          def.hooks.afterSave(guardada, { user: req.user, isNew: true, db });
        }

        // El rastro, igual que cualquier otra alta. El Registro de Cambios
        // existe para responder quién tocó el dinero y los permisos, y por
        // planilla se puede tocar tanto o más que a mano: sin esto, podían
        // entrar movimientos a los libros sin que quedara quién los puso.
        if (guardada) {
          bitacora.registrarGuardado(def, {
            isNew: true, antes: {}, despues: guardada, datos, user: req.user,
          });
        }
        listas++;
      });
      if (prueba) throw new Error('__revision__'); // deshace todo: solo era una revisión
    });

    try {
      ejecutar.immediate();
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
