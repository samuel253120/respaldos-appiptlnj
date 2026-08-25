/**
 * Conexión a la base de datos (SQLite) y auto-migración.
 *
 * Al iniciar, por cada módulo registrado se crea su tabla si no existe y se
 * agregan las columnas que falten (ALTER TABLE). Esto hace el sistema
 * MODIFICABLE: agregar un campo a un módulo solo requiere declararlo en su
 * archivo de server/modules/ y reiniciar; la columna se crea sola sin perder
 * datos existentes.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { allModules } = require('./registry');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

let db;

/**
 * Cómo se comporta la base cuando hay varias personas trabajando a la vez.
 *
 * WAL es lo que permite que unos lean mientras otro escribe: sin él, cada
 * guardado dejaría esperando a todos los demás. Lo otro son medidas para que
 * nadie quede esperando de más:
 *
 *   busy_timeout   si justo dos guardados coinciden, el segundo espera su
 *                  turno hasta 8 segundos en vez de fallar al instante.
 *   synchronous    con WAL, NORMAL es lo recomendado: la base nunca se daña,
 *                  y a cambio de esperar menos en cada guardado, un corte de
 *                  luz en el peor momento podría llevarse los últimos
 *                  segundos de trabajo.
 *   cache_size     20 MB de páginas en memoria: los listados que se abren una
 *                  y otra vez ya no vuelven al disco.
 *   mmap_size      leer la base como si fuera memoria, que es más rápido.
 *   temp_store     los ordenamientos temporales se hacen en memoria.
 *
 * Y una que no es un pragma pero va acá porque es la otra mitad de lo mismo:
 * TODA transacción que escribe se abre con `.immediate()`, no suelta.
 *
 * El busy_timeout de arriba no alcanza solo. Una transacción suelta —la que
 * abre `db.transaction(...)()` por omisión— parte leyendo y recién pide el
 * permiso de escribir cuando llega al primer INSERT. Si para entonces otro
 * proceso ya escribió, lo que esta transacción leyó quedó viejo, y SQLite no
 * puede hacer otra cosa que rechazarla en el acto: esperar no arreglaría nada,
 * porque lo leído seguiría estando viejo. El busy_timeout ni se consulta, y
 * sale «database is locked» aunque haya ocho segundos de paciencia
 * configurados. Abriéndola con `.immediate()` el permiso de escribir se pide
 * al empezar, que es cuando el busy_timeout sí sirve: el segundo espera su
 * turno y después escribe.
 *
 * Medido con cuatro procesos guardando a la vez sobre la misma base: sueltas,
 * 120 fallas de 160 intentos; inmediatas, ninguna. Con un solo proceso —que es
 * como corre hoy en Railway— no se nota, porque no hay con quién chocar; se
 * nota apenas hay un segundo, y hay varios que aparecen sin avisar: el
 * respaldo, una migración corrida a mano con el sistema andando, o el día que
 * se levante una segunda instancia.
 *
 * Que no quede ninguna suelta lo vigila pruebas/motor/transacciones.test.js.
 */
function afinar() {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');
  try {
    db.pragma('mmap_size = 268435456');
  } catch (e) {
    /* algunos sistemas de archivos no lo permiten; se sigue igual */
  }
}

try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'iglesias.db'));
  afinar();
  console.log(`💾 Datos en: ${DATA_DIR}${espacioLibre()}`);
} catch (e) {
  const sitio = espacioLibre().trim();
  const explicacion =
    `No se pudo abrir la base de datos en "${DATA_DIR}"${sitio ? ` ${sitio}` : ''}. ` +
    'Revise que la variable DATA_DIR apunte exactamente a la ruta (Mount Path) del volumen ' +
    'del servicio, que el volumen esté conectado y que quede espacio libre en él.';
  console.error(`\n❌ ${explicacion}\n   Detalle técnico: ${e.message}\n`);
  avisarEnPantalla(explicacion, e.message);
  // Sin base de datos no hay sistema que levantar, pero el proceso queda vivo
  // sirviendo la explicación: así, en vez de un error en blanco de la
  // plataforma, se ve en el navegador qué hay que arreglar.
  process.on('uncaughtException', () => {});
  throw e;
}

/**
 * Servidor mínimo de avería: cuando no hay base de datos, responde a todo con
 * la explicación, para que quien entre sepa qué pasa sin mirar los registros
 * del servidor.
 */
function avisarEnPantalla(explicacion, detalle) {
  try {
    const http = require('http');
    const puerto = process.env.PORT || 3000;
    http
      .createServer((req, res) => {
        if (req.url === '/health') {
          // 200 a propósito: el proceso está vivo y puede explicar qué pasa.
          // Si respondiera con error, la plataforma escondería la explicación.
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, base: detalle, detalle: explicacion }));
        }
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
           <title>Sistema fuera de servicio</title>
           <div style="font-family:system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 22px;color:#0f172a">
             <h1 style="font-size:22px">⚠️ El sistema no pudo abrir su base de datos</h1>
             <p style="line-height:1.6;font-size:15px">${explicacion}</p>
             <p style="line-height:1.6;font-size:13px;color:#64748b">Detalle técnico: ${detalle}</p>
             <p style="line-height:1.6;font-size:13px;color:#64748b">
               Los datos no se han perdido: están en el volumen. En cuanto el volumen vuelva a estar
               disponible y con espacio, el sistema arranca solo.</p>
           </div>`
        );
      })
      .listen(puerto, () => console.error(`   Aviso publicado en el puerto ${puerto}.`));
  } catch (err) {
    /* si ni eso se puede, queda el mensaje en el registro */
  }
}

/**
 * Cuánto espacio le queda al volumen. Se dice en el arranque porque un disco
 * lleno es la causa más común de que un sistema que venía funcionando deje de
 * responder: SQLite no puede ni abrir la base cuando no queda sitio.
 */
function espacioLibre() {
  try {
    const disco = fs.statfsSync(DATA_DIR);
    const libres = Math.round((disco.bavail * disco.bsize) / 1048576);
    return libres < 50 ? ` — ⚠️ solo ${libres} MB libres, haga sitio` : ` (${libres} MB libres)`;
  } catch (e) {
    return '';
  }
}

/** Tipo de columna SQL para cada tipo de campo del sistema. */
function sqlType(field) {
  switch (field.type) {
    case 'number':
    case 'money':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'ref':
      return 'INTEGER';
    default:
      // text, textarea, richtext (HTML acotado), date, time, select,
      // multiref (JSON), file, email, tel, password, rut, permisos (JSON)
      return 'TEXT';
  }
}

function migrate() {
  for (const def of allModules()) {
    const cols = def.fields.map((f) => `"${f.name}" ${sqlType(f)}`).join(', ');
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${def.name}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${cols}${cols ? ',' : ''}
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        created_by INTEGER,
        updated_by INTEGER,
        -- Sube en uno con cada guardado. Es lo que permite darse cuenta de que
        -- alguien más tocó la ficha desde que uno la abrió. Antes eso se
        -- deducía de updated_at, que se escribe con precisión de un segundo:
        -- dos personas guardando dentro del mismo segundo dejaban la misma
        -- marca y el sistema no notaba la diferencia (ver server/crud.js).
        version INTEGER DEFAULT 1
      )`
    );
    // Agregar columnas nuevas declaradas después de creada la tabla.
    const existing = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    for (const f of def.fields) {
      if (!existing.has(f.name)) {
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${f.name}" ${sqlType(f)}`);
      }
    }
    for (const extra of ['created_at', 'updated_at', 'created_by', 'updated_by', 'version']) {
      if (!existing.has(extra) && existing.size) {
        // El valor por omisión va también acá, no solo en el CREATE TABLE: sin
        // él, las tablas que ya existían aceptaban la columna pero las fichas
        // nuevas nacían sin versión, y sin versión el aviso de «alguien más
        // guardó esto» no tenía con qué compararse.
        const tipo = extra === 'created_at' || extra === 'updated_at' ? 'TEXT' : 'INTEGER';
        const porOmision = extra === 'version' ? ' DEFAULT 1' : '';
        db.exec(`ALTER TABLE "${def.name}" ADD COLUMN "${extra}" ${tipo}${porOmision}`);
        // Y lo que ya estaba parte en la versión 1: desde ahí en adelante sube
        if (extra === 'version') db.exec(`UPDATE "${def.name}" SET version = 1 WHERE version IS NULL`);
      }
    }
  }
}

/**
 * Índices: lo que hace que un listado no tenga que revisar la tabla entera.
 *
 * Sin ellos, buscar las asistencias de una iglesia obliga a la base a mirar
 * las treinta mil marcas una por una, y como el servidor atiende de a una
 * petición, ese rato lo esperan todos los que están conectados. Con ellos, va
 * derecho a las que corresponden.
 *
 * Se deducen del propio esquema, así que un módulo nuevo o un campo nuevo
 * quedan cubiertos sin que nadie se acuerde de agregarlos:
 *
 *   · cada campo de referencia (la iglesia, el cuerpo, el miembro, la
 *     cuenta…), que es por donde se acota y se enlaza todo;
 *   · el campo de fecha del módulo y el campo por el que ordena su listado;
 *   · la pareja iglesia + fecha, que es como se pide casi siempre;
 *   · los campos únicos (el RUT, el correo), para que comprobar que no se
 *     repiten sea instantáneo;
 *   · las columnas de archivo, por las que se averigua de qué ficha es una
 *     foto o un documento cuando alguien pide abrirlo.
 *
 * Los campos únicos se intentan como restricción de verdad, y si no se puede
 * queda el índice a secas. La diferencia importa: con la restricción puesta,
 * la base misma impide el repetido aunque llegue por un camino que no pasó por
 * la comprobación del programa. Sin ella, la comprobación es lo único que hay.
 *
 * Por qué se intenta en vez de exigirse: si los datos que vinieron de antes ya
 * traen un repetido, crear la restricción falla, y negarse a arrancar por eso
 * dejaría el sistema inalcanzable justo cuando hay que entrar a arreglarlo. Se
 * intenta, se anota qué pasó y se sigue.
 */
function indexar() {
  let creados = 0;
  const yaEsta = (nombre) =>
    db.prepare('SELECT COUNT(*) AS c FROM sqlite_master WHERE type = ? AND name = ?').get('index', nombre).c > 0;

  const crear = (tabla, nombre, expresion) => {
    try {
      const antes = yaEsta(nombre);
      db.exec(`CREATE INDEX IF NOT EXISTS "${nombre}" ON "${tabla}" (${expresion})`);
      if (!antes) creados++;
    } catch (e) {
      console.error(`⚠️  No se pudo crear el índice ${nombre}: ${e.message}`);
    }
  };

  /**
   * Un campo único, como restricción de la base.
   *
   * Si ya hay repetidos en la tabla, SQLite se niega y ahí se dice cuáles son:
   * es lo que hay que arreglar para que la restricción entre, y sin nombrarlos
   * no hay por dónde empezar. Mientras tanto queda el índice a secas y la
   * comprobación del programa, que sigue funcionando.
   */
  const crearUnico = (tabla, campo, acotadoPor) => {
    const nombre = `ux_${tabla}_${campo}`;
    if (yaEsta(nombre)) return;
    // Se compara en minúsculas, igual que la comprobación del programa: si no,
    // «CERT-001» y «cert-001» pasarían por dos números distintos.
    const expresion = acotadoPor ? `"${acotadoPor}", lower("${campo}")` : `lower("${campo}")`;
    try {
      db.exec(`CREATE UNIQUE INDEX "${nombre}" ON "${tabla}" (${expresion})`);
      creados++;
    } catch (e) {
      let repetidos = [];
      try {
        const grupo = acotadoPor ? `"${acotadoPor}", lower("${campo}")` : `lower("${campo}")`;
        repetidos = db
          .prepare(
            `SELECT "${campo}" AS valor, COUNT(*) AS veces FROM "${tabla}"
              WHERE "${campo}" IS NOT NULL AND TRIM("${campo}") <> ''
              GROUP BY ${grupo} HAVING COUNT(*) > 1 ORDER BY veces DESC LIMIT 5`
          )
          .all();
      } catch (e2) {
        /* si tampoco se puede preguntar, se dice lo que se sabe */
      }
      const cuales = repetidos.length
        ? repetidos.map((r) => `«${r.valor}» ×${r.veces}`).join(', ')
        : e.message;
      console.error(
        `⚠️  ${tabla}.${campo} tendría que ser único y en los datos hay repetidos: ${cuales}. ` +
          'Arréglelos y al próximo arranque la base misma lo impedirá. Mientras tanto lo comprueba el sistema al guardar.'
      );
    }
  };

  for (const def of allModules()) {
    const columnas = new Set(db.prepare(`PRAGMA table_info("${def.name}")`).all().map((c) => c.name));
    const hay = (n) => n && columnas.has(n);

    for (const f of def.fields) {
      if (f.type === 'ref' && hay(f.name)) crear(def.name, `ix_${def.name}_${f.name}`, `"${f.name}"`);
      if ((f.unique || f.type === 'rut') && hay(f.name)) {
        crear(def.name, `ix_${def.name}_${f.name}_unico`, `lower("${f.name}")`);
        // Y además la restricción, cuando el módulo dice que es único de
        // verdad. `unique: 'iglesia_id'` es único dentro de su iglesia —cada
        // congregación lleva su propia serie de certificados—; `unique: true`
        // lo es en todo el sistema, como el RUT.
        if (f.unique) {
          const acotadoPor = typeof f.unique === 'string' && hay(f.unique) ? f.unique : null;
          crearUnico(def.name, f.name, acotadoPor);
        }
      }
      // Las columnas de archivo: por ellas se averigua de qué ficha es una
      // foto o un documento, para saber quién puede abrirlo (ver archivos.js)
      if (f.type === 'file' && hay(f.name)) crear(def.name, `ix_${def.name}_${f.name}`, `"${f.name}"`);
    }

    const fecha = def.dateField && hay(def.dateField) ? def.dateField : null;
    if (fecha) crear(def.name, `ix_${def.name}_${fecha}`, `"${fecha}"`);
    if (fecha && hay('iglesia_id')) crear(def.name, `ix_${def.name}_iglesia_${fecha}`, `"iglesia_id", "${fecha}"`);

    const orden = def.defaultSort && def.defaultSort.field;
    if (orden && orden !== 'id' && orden !== fecha && hay(orden)) crear(def.name, `ix_${def.name}_${orden}`, `"${orden}"`);
  }

  if (creados) {
    console.log(`⚡ ${creados} índice(s) nuevos: los listados y las búsquedas van directo a lo que buscan.`);
    try {
      db.exec('ANALYZE'); // para que la base sepa cuál índice le conviene
    } catch (e) {
      /* si no se puede, funciona igual, solo elige peor */
    }
  }
}

// Crear y actualizar las tablas no puede tumbar el arranque: si el volumen
// está lleno o de solo lectura, se anota el problema y el sistema levanta
// igual, aunque sea para poder entrar a ver qué pasa.
try {
  migrate();
  indexar();
} catch (e) {
  console.error(
    `⚠️  No se pudieron crear o actualizar las tablas: ${e.message}\n` +
      '   Suele ser falta de espacio en el volumen. El sistema arranca igual, pero no podrá guardar\n' +
      '   hasta que se libere sitio. Revise /health para verlo.'
  );
}

// Cada seis horas la base repasa sus propias estadísticas y se queda con el
// mejor camino para cada consulta, según cómo hayan crecido los datos. Es
// barato y no molesta a nadie: si el sistema se apaga antes, tampoco importa.
try {
  setInterval(() => {
    try {
      db.pragma('optimize');
    } catch (e) {
      /* no es indispensable */
    }
  }, 6 * 60 * 60 * 1000).unref();
} catch (e) {
  /* en un script suelto puede no haber temporizadores; da igual */
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, DB_PATH: path.join(DATA_DIR, 'iglesias.db') };
