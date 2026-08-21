/**
 * El traspaso, desde la propia aplicación.
 *
 * La importación se puede correr desde la consola del servidor, pero quien
 * tiene que decidir si los conteos están bien es la iglesia, no quien
 * administra el servidor. Estas rutas ponen lo mismo en pantalla:
 *
 *   GET  /api/importacion/estado    qué trae el archivo de origen y qué hay hoy
 *   POST /api/importacion/correr    el ensayo o la importación de verdad
 *   GET  /api/importacion/informe   la verificación final, en texto
 *   GET  /api/importacion/respaldo  la base completa, para guardarla antes
 *
 * Tres resguardos, porque esto se hace una sola vez y sobre datos de verdad:
 *
 *  - solo el administrador;
 *  - la importación de verdad exige el **modo mantenimiento activo**, para que
 *    nadie esté escribiendo mientras se importa;
 *  - y exige haber corrido antes el **ensayo**, que hace todo el trabajo y lo
 *    deshace: si algo no cuadra, se ve ahí y no en la base.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./../db');
const { authRequired } = require('../auth');
const ajustes = require('../ajustes');
const { correr, leerOrigen } = require('./correr');
const { informe } = require('./informe');

const router = express.Router();

/** Cuántas filas tiene una tabla, sin caerse si todavía no existe. */
function cuantas(tabla) {
  try {
    return db.prepare(`SELECT COUNT(*) n FROM "${tabla}"`).get().n;
  } catch (e) {
    return 0;
  }
}

/** Esto lo maneja el administrador y nadie más. */
function soloAdmin(req, res, siguiente) {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede manejar el traspaso de datos.' });
  }
  return siguiente();
}

router.use(authRequired, soloAdmin);

/**
 * Cuándo fue el último ensayo que terminó bien. Se recuerda mientras el
 * servidor esté en pie: si se reinicia, hay que volver a ensayar, que es
 * justamente lo que corresponde.
 */
let ultimoEnsayo = null;

/** Lo que la pantalla necesita saber antes de empezar. */
router.get('/estado', (req, res) => {
  let origen = null;
  try {
    const leido = leerOrigen(null);
    const d = leido.datos;
    origen = {
      archivo: leido.nombre,
      lote: leido.lote,
      trae: {
        miembros: (d.members || []).length,
        cuerpos: (d.groups || []).length,
        actividades: (d.activities || []).length,
        marcas: (d.attendance || []).length,
        servicios: (d.services || []).length,
        movimientos: (d.incomes || []).length + (d.expenses || []).length,
        anotaciones: (d.timeline || []).length + (d.memberLogs || []).length,
        usuarios: (d.users || []).length,
        documentos: (d.members || []).reduce((n, m) => n + (m.attachments || []).length, 0),
      },
    };
  } catch (e) {
    origen = null;
  }

  const yaImportado = cuantas('importacion_equivalencias');
  res.json({
    origen,
    mantenimiento: ajustes.activo('mantenimiento_activo'),
    ultimo_ensayo: ultimoEnsayo,
    ya_importado: yaImportado,
    hoy: {
      miembros: cuantas('miembros'),
      cuerpos: cuantas('cuerpos'),
      actividades: cuantas('asistencias'),
      marcas: cuantas('asistencia_detalle'),
      servicios: cuantas('servicios'),
      movimientos: cuantas('tesoreria'),
      anotaciones: cuantas('bitacora'),
      usuarios: cuantas('usuarios'),
      documentos: cuantas('documentos_miembros'),
    },
    respaldo_disponible: !!DB_PATH && fs.existsSync(DB_PATH),
  });
});

/**
 * Corre el ensayo o la importación de verdad. Devuelve las mismas líneas que
 * se verían en la consola, en orden.
 */
router.post('/correr', (req, res) => {
  const prueba = req.body.prueba !== false;
  const ruts = ['detener', 'conservar', 'vaciar'].includes(req.body.ruts) ? req.body.ruts : 'conservar';

  if (!prueba) {
    if (!ajustes.activo('mantenimiento_activo')) {
      return res.status(400).json({
        error: 'Antes de importar de verdad, active el modo mantenimiento: así nadie está escribiendo mientras se importa.',
      });
    }
    if (!ultimoEnsayo) {
      return res.status(400).json({
        error: 'Corra primero el ensayo. Hace todo el trabajo y lo deshace al final, para ver los conteos sin tocar nada.',
      });
    }
  }

  let salida;
  const empezo = Date.now();
  try {
    salida = correr({ prueba, ruts });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (prueba && !salida.error) ultimoEnsayo = new Date().toISOString();

  res.json({
    prueba,
    lineas: salida.lineas,
    error: salida.error,
    modulos: salida.resultados.length,
    segundos: Math.round((Date.now() - empezo) / 100) / 10,
  });
});

/** El informe final: la verificación obligatoria, en texto. */
router.get('/informe', (req, res) => {
  let leido;
  try {
    leido = leerOrigen(null);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { texto, todoCuadra } = informe({ ...leido.datos, __archivo: leido.nombre }, leido.descartadas);

  if (req.query.descargar) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-importacion-${new Date().toISOString().slice(0, 10)}.txt"`);
    return res.send(texto);
  }
  res.json({ texto, todo_cuadra: todoCuadra });
});

/* ---------------------------------------------------------------------
 * Dejar la base como nueva
 *
 * Antes de traer los datos de verdad hay que sacar lo que se haya cargado
 * probando el sistema. Se muestra primero qué hay —con nombres, no solo con
 * números— para poder mirarlo y reconocerlo, y recién después se vacía.
 * ------------------------------------------------------------------- */

/** Las tablas que se vacían: todos los módulos, salvo los que sostienen el sistema. */
function tablasAVaciar() {
  const { allModules } = require('../registry');
  const intocables = ['usuarios', 'iglesias'];
  return allModules()
    .map((m) => m.name)
    .filter((n) => !intocables.includes(n))
    .concat(['importacion_equivalencias', 'importacion_archivos']);
}

/** Qué hay hoy en la base, para mirarlo antes de vaciarla. */
router.get('/limpieza', (req, res) => {
  const { getModule } = require('../registry');
  const tablas = tablasAVaciar()
    .map((tabla) => {
      const def = getModule(tabla);
      return { tabla, etiqueta: def ? def.label : tabla, filas: cuantas(tabla) };
    })
    .filter((t) => t.filas > 0)
    .sort((a, b) => b.filas - a.filas);

  let miembros = [];
  try {
    miembros = db
      .prepare('SELECT id, nombres, apellidos, rut, created_at FROM miembros ORDER BY id LIMIT 60')
      .all();
  } catch (e) {
    miembros = [];
  }

  let usuarios = [];
  try {
    usuarios = db
      .prepare('SELECT id, rut, nombre, rol FROM usuarios ORDER BY id')
      .all()
      .map((u) => ({ ...u, es_usted: u.id === req.user.id }));
  } catch (e) {
    usuarios = [];
  }

  res.json({
    tablas,
    total: tablas.reduce((n, t) => n + t.filas, 0),
    miembros,
    miembros_total: cuantas('miembros'),
    usuarios,
    mantenimiento: ajustes.activo('mantenimiento_activo'),
  });
});

/**
 * Vacía la base y la deja como recién instalada: queda la iglesia, sus cuentas
 * de tesorería y la cuenta de quien está haciendo esto. Nada más.
 *
 * Pide el modo mantenimiento y que se escriba la palabra completa: es lo único
 * de todo el sistema que no se puede deshacer. Por eso, arriba está el
 * respaldo: sacarlo antes es parte del procedimiento, no un consejo.
 */
router.post('/limpieza', (req, res) => {
  if (!ajustes.activo('mantenimiento_activo')) {
    return res.status(400).json({ error: 'Active primero el modo mantenimiento.' });
  }
  if (String(req.body.confirmacion || '').trim().toUpperCase() !== 'BORRAR') {
    return res.status(400).json({ error: 'Para confirmar, escriba la palabra BORRAR.' });
  }

  const vaciadas = {};
  try {
    db.transaction(() => {
      for (const tabla of tablasAVaciar()) {
        const antes = cuantas(tabla);
        if (!antes) continue;
        try {
          db.prepare(`DELETE FROM "${tabla}"`).run();
          vaciadas[tabla] = antes;
        } catch (e) {
          /* una tabla que todavía no existe no estorba */
        }
      }
      // Las demás cuentas de acceso también salen; la de quien está haciendo
      // esto se queda, porque si no, nadie podría seguir.
      const otras = db.prepare('SELECT COUNT(*) n FROM usuarios WHERE id != ?').get(req.user.id).n;
      if (otras) {
        db.prepare('DELETE FROM usuarios WHERE id != ?').run(req.user.id);
        vaciadas.usuarios = otras;
      }
    })();
  } catch (e) {
    return res.status(500).json({ error: `No se pudo vaciar: ${e.message}` });
  }

  // Y se deja lo mínimo para que el sistema funcione: la iglesia y sus cuentas
  require('../seed').ensureSeed();

  ultimoEnsayo = null; // lo ensayado antes ya no vale: la base es otra
  res.json({
    ok: true,
    vaciadas,
    total: Object.values(vaciadas).reduce((n, v) => n + v, 0),
  });
});

/**
 * La base completa, para guardarla antes de importar. Se copia con el propio
 * motor de la base (no se lee el archivo en caliente), así el respaldo queda
 * íntegro aunque alguien esté usando el sistema en ese momento.
 */
router.get('/respaldo', async (req, res) => {
  if (!DB_PATH) return res.status(400).json({ error: 'No hay archivo de base que respaldar.' });
  const destino = path.join(path.dirname(DB_PATH), `respaldo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.db`);
  try {
    await db.backup(destino);
  } catch (e) {
    return res.status(500).json({ error: `No se pudo preparar el respaldo: ${e.message}` });
  }
  res.download(destino, path.basename(destino), (e) => {
    // El respaldo viaja al computador de quien lo pidió; en el servidor no se
    // guarda una copia que después nadie borra.
    fs.unlink(destino, () => {});
    if (e) console.error(`⚠️  Respaldo interrumpido: ${e.message}`);
  });
});

module.exports = { router };
