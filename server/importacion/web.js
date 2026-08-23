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
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, DB_PATH, DATA_DIR } = require('./../db');
const { authRequired } = require('../auth');
const ajustes = require('../ajustes');
const { correr, leerOrigen, rutaDelOrigen, ORIGEN_SUBIDO } = require('./correr');
const { informe } = require('./informe');

const router = express.Router();

/** El informe final se guarda junto a la base: es el acta del traspaso. */
const INFORME_GUARDADO = path.join(DATA_DIR, 'informe-importacion.txt');

/** Deja el informe guardado, para poder mostrarlo cuando ya no esté el origen. */
function guardarInforme(texto) {
  try {
    fs.writeFileSync(INFORME_GUARDADO, texto + '\n');
  } catch (e) {
    console.error(`⚠️  No se pudo guardar el informe del traspaso: ${e.message}`);
  }
}

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
  if (!require('../permissions').can(req.user, 'sistema_importacion', 'create')) {
    return res.status(403).json({ error: 'No tiene permiso para manejar el traspaso de datos del sistema anterior.' });
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
    hay_informe_guardado: fs.existsSync(INFORME_GUARDADO),
    origen_subido: rutaDelOrigen() === ORIGEN_SUBIDO,
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

  // Terminada la importación, el informe queda guardado en el servidor: es el
  // acta de lo que se trajo, y tiene que sobrevivir aunque después se saque el
  // archivo de origen.
  if (!prueba && !salida.error) {
    try {
      const leido = leerOrigen(null);
      guardarInforme(informe({ ...leido.datos, __archivo: leido.nombre }, leido.descartadas).texto);
    } catch (e) {
      /* si no se pudo, el informe se puede pedir aparte */
    }
  }

  res.json({
    prueba,
    lineas: salida.lineas,
    error: salida.error,
    modulos: salida.resultados.length,
    segundos: Math.round((Date.now() - empezo) / 100) / 10,
  });
});

/**
 * El informe final: la verificación obligatoria, en texto.
 *
 * Con el archivo de origen a mano se calcula de nuevo, comparando las dos
 * bases; si ya no está —porque el traspaso terminó y se sacó—, se entrega el
 * que quedó guardado el día que se importó.
 */
router.get('/informe', (req, res) => {
  let texto = null;
  let todoCuadra = null;
  let guardado = false;

  try {
    const leido = leerOrigen(null);
    const hecho = informe({ ...leido.datos, __archivo: leido.nombre }, leido.descartadas);
    texto = hecho.texto;
    todoCuadra = hecho.todoCuadra;
    guardarInforme(texto);
  } catch (e) {
    if (fs.existsSync(INFORME_GUARDADO)) {
      texto = fs.readFileSync(INFORME_GUARDADO, 'utf8');
      guardado = true;
    } else {
      return res.status(400).json({ error: e.message });
    }
  }

  if (req.query.descargar) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-importacion-${new Date().toISOString().slice(0, 10)}.txt"`);
    return res.send(texto);
  }
  res.json({ texto, todo_cuadra: todoCuadra, guardado });
});

/**
 * Recibe el volcado del sistema anterior. Queda junto a la base, no dentro
 * del programa: los datos de la iglesia son de la iglesia, y no tienen por
 * qué viajar en cada versión que se publica.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
});

router.post('/origen', subida.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });

  let crudo;
  try {
    crudo = JSON.parse(req.file.buffer.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Ese archivo no es un volcado en formato JSON.' });
  }
  const datos = crudo.data || crudo;
  if (!datos || !Array.isArray(datos.members)) {
    return res.status(400).json({
      error: 'El archivo no trae la lista de miembros del sistema anterior: revise que sea el volcado correcto.',
    });
  }

  try {
    fs.mkdirSync(path.dirname(ORIGEN_SUBIDO), { recursive: true });
    fs.writeFileSync(ORIGEN_SUBIDO, JSON.stringify(crudo));
  } catch (e) {
    return res.status(500).json({ error: `No se pudo guardar el archivo: ${e.message}` });
  }

  ultimoEnsayo = null; // el origen cambió: hay que ensayar de nuevo
  res.json({
    ok: true,
    nombre: req.file.originalname,
    miembros: datos.members.length,
  });
});

/** Saca el volcado subido: terminado el traspaso, no tiene para qué quedarse. */
router.delete('/origen', (req, res) => {
  if (!fs.existsSync(ORIGEN_SUBIDO)) return res.json({ ok: true, ya_no_estaba: true });
  try {
    fs.unlinkSync(ORIGEN_SUBIDO);
  } catch (e) {
    return res.status(500).json({ error: `No se pudo sacar el archivo: ${e.message}` });
  }
  ultimoEnsayo = null;
  res.json({ ok: true });
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
