/**
 * Respaldo: bajarse todo el sistema en un archivo.
 *
 * Los datos viven en un solo disco. Si ese disco se pierde —y los discos se
 * pierden—, se pierde la iglesia entera: los miembros, la tesorería, las
 * actas y los documentos escaneados. Esto permite al administrador bajarse
 * una copia cuando quiera y guardarla donde le parezca: su computador, un
 * pendrive, su nube.
 *
 * El paquete lleva las dos cosas que hacen falta para volver a levantar el
 * sistema tal como estaba:
 *
 *   iglesias.db   todos los registros
 *   uploads/      las fotos y los documentos que están enlazados a ellos
 *
 * La copia de la base no se hace copiando el archivo por debajo —mientras
 * alguien guarda, esa copia saldría a medias—, sino con la copia en caliente
 * que trae SQLite, que entrega la base entera y coherente aunque el sistema
 * esté siendo usado en ese momento.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { db, DATA_DIR, UPLOADS_DIR } = require('./db');

/** Lo que pesa el respaldo, para poder decírselo antes de que lo pida. */
function tamano() {
  const dela = (ruta) => {
    try {
      return fs.statSync(ruta).size;
    } catch (e) {
      return 0;
    }
  };
  let archivos = 0;
  let cuantos = 0;
  try {
    for (const nombre of fs.readdirSync(UPLOADS_DIR)) {
      archivos += dela(path.join(UPLOADS_DIR, nombre));
      cuantos++;
    }
  } catch (e) {
    /* si la carpeta no existe todavía, van en cero */
  }
  const base = dela(path.join(DATA_DIR, 'iglesias.db')) + dela(path.join(DATA_DIR, 'iglesias.db-wal'));
  return { base, archivos, cuantos, total: base + archivos };
}

/** El nombre con el que se baja: se reconoce de qué día es sin abrirlo. */
function nombreDelPaquete() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `respaldo-iglesias-${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}.tar.gz`;
}

/**
 * Arma el paquete y lo va mandando a medida que se comprime, sin juntarlo
 * entero en memoria ni dejarlo en el disco: en un servidor con poco espacio,
 * un respaldo que primero hay que guardar sería justo lo que no cabe.
 */
async function enviar(res) {
  // La copia se deja en una carpeta propia y con el nombre de verdad, para que
  // adentro del paquete se llame "iglesias.db" y no haya que renombrar nada al
  // restaurarlo.
  const carpeta = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'respaldo-'));
  const copia = path.join(carpeta, 'iglesias.db');
  await db.backup(copia); // copia en caliente: coherente aunque se esté usando

  const limpiar = () => fs.promises.rm(carpeta, { recursive: true, force: true }).catch(() => {});

  // Dos raíces: la copia de la base y la carpeta de archivos, cada una desde
  // su lugar, para que adentro del paquete queden las dos a la vista.
  const tar = spawn('tar', [
    '-czf', '-',
    '-C', carpeta, 'iglesias.db',
    '-C', DATA_DIR, 'uploads',
  ]);

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDelPaquete()}"`);
  res.setHeader('Cache-Control', 'no-store');

  let problema = '';
  tar.stderr.on('data', (d) => { problema += String(d); });
  tar.stdout.pipe(res);

  /**
   * Anotar que se bajó exige que hayan pasado las dos cosas: que tar terminara
   * bien y que la respuesta saliera entera. Y pueden pasar en cualquier orden
   * —depende de cuándo el sistema vacíe el último trozo—, así que se espera a
   * las dos en vez de colgarse de una. Se probó al revés y no anotaba nunca.
   */
  let comoTerminoTar = null;
  let salioEntera = false;
  const anotarSiLlegoEntero = () => {
    if (comoTerminoTar === 0 && salioEntera) anotarQueSeBajo(res.locals && res.locals.usuarioId);
  };
  res.on('finish', () => { salioEntera = true; anotarSiLlegoEntero(); });

  tar.on('error', (e) => {
    limpiar();
    if (!res.headersSent) res.status(500).json({ error: `No se pudo armar el respaldo: ${e.message}` });
    else res.end();
  });
  tar.on('close', (codigo) => {
    limpiar();
    comoTerminoTar = codigo;
    anotarSiLlegoEntero();
    // tar avisa con 1 cuando un archivo cambió mientras lo leía: el respaldo
    // sirve igual, así que solo se anota.
    if (codigo !== 0) {
      console.error(`⚠️  El respaldo terminó con código ${codigo}: ${problema.slice(0, 300)}`);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo armar el respaldo' });
      else res.end();
    }
  });
  res.on('close', () => {
    // Si quien lo pidió corta la descarga, no se sigue comprimiendo al vacío
    if (!tar.killed) tar.kill();
    limpiar();
  });
}

/**
 * Cuándo se bajó por última vez el respaldo completo, a mano.
 *
 * El respaldo automático se guarda en el mismo volumen que protege: sirve para
 * un error humano —alguien borró algo que no debía— y no sirve para lo único
 * contra lo que existen los respaldos, que es que el disco se pierda. El
 * único que sale del servidor es este, y para que salga hay que acordarse.
 *
 * Por eso se anota cuándo fue la última vez. No es un ajuste que alguien
 * elija, es un hecho que el sistema recuerda, así que se guarda directo en la
 * tabla y no pasa por la pantalla de Configuración.
 */
const CLAVE_BAJADA = 'respaldo_bajado_en';

function anotarQueSeBajo(usuarioId) {
  try {
    db.prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_por) VALUES (?, datetime('now','localtime'), ?)
       ON CONFLICT(clave) DO UPDATE SET valor = datetime('now','localtime'),
         actualizado_en = datetime('now','localtime'), actualizado_por = excluded.actualizado_por`
    ).run(CLAVE_BAJADA, usuarioId || null);
  } catch (e) {
    console.error('No se pudo anotar la bajada del respaldo:', e.message);
  }
}

/** Cuántos días de calendario van desde una marca de tiempo. */
function diasDesde(cuando) {
  const d = new Date(String(cuando).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const soloDia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((soloDia(new Date()) - soloDia(d)) / 86400000);
}

/**
 * Cada cuántos días conviene bajarlo. Un mes es el plazo con el que, si el
 * disco se pierde, lo que falta es a lo más un mes de trabajo. Se fija en la
 * pantalla de configuración: una iglesia que carga todos los días querrá el
 * recordatorio más seguido que una que carga una vez al mes.
 */
const cadaCuantosDias = () => require('./ajustes').numero('respaldo_recordar_dias', 7, 180);

/** Qué contar en el panel sobre la última copia bajada a mano. */
function estadoDeLaBajada() {
  let fila = null;
  try {
    fila = db.prepare('SELECT valor, actualizado_por FROM configuracion WHERE clave = ?').get(CLAVE_BAJADA);
  } catch (e) {
    /* si no se puede preguntar, se responde que no consta */
  }
  const cuando = fila && fila.valor ? fila.valor : null;
  const dias = cuando ? diasDesde(cuando) : null;
  let quien = null;
  if (fila && fila.actualizado_por) {
    try {
      const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(fila.actualizado_por);
      quien = (u && u.nombre) || null;
    } catch (e) { /* da igual quién si no se puede saber */ }
  }
  return {
    cuando,
    dias,
    quien,
    cada: cadaCuantosDias(),
    alDia: dias !== null && dias <= cadaCuantosDias(),
  };
}

module.exports = { enviar, tamano, nombreDelPaquete, anotarQueSeBajo, estadoDeLaBajada, cadaCuantosDias };
