/**
 * El respaldo que se hace solo, todas las noches.
 *
 * El respaldo que se baja a mano sirve mientras alguien se acuerde de bajarlo.
 * Nadie se acuerda todas las semanas, y el día que hace falta —una tabla que
 * se borró por error, una tesorería que quedó al revés— lo último que hay es
 * de hace tres meses. Esto lo hace el sistema por su cuenta: una copia diaria
 * de la base, comprimida, guardada junto a los datos, y solo se conservan las
 * últimas.
 *
 * QUÉ PROTEGE Y QUÉ NO. Hay que decirlo derecho, porque la diferencia importa:
 *
 *   · Protege de los errores: alguien borró algo que no debía, un mes de
 *     tesorería quedó mal cargado, una migración salió torcida. Se vuelve a
 *     la copia de anoche y se recupera todo menos lo del día.
 *   · NO protege del disco. La copia vive en el mismo volumen que los datos.
 *     Si ese disco se pierde, se pierden los dos. Para eso está el respaldo
 *     que se baja y se guarda en otra parte, y por eso el panel sigue
 *     insistiendo en que se baje.
 *
 * Se copia la base y no los documentos subidos, a propósito: la base cambia
 * todos los días y es la que se puede echar a perder de golpe, mientras que
 * un documento, una vez subido, no lo toca nadie más. Duplicar cada noche
 * todas las fotos llenaría el disco sin proteger de nada nuevo.
 *
 * La copia se hace con la copia en caliente de SQLite, igual que la que se
 * baja: entrega la base entera y coherente aunque alguien esté guardando
 * justo en ese momento.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { db, DATA_DIR } = require('./db');
const ajustes = require('./ajustes');

const CARPETA = path.join(DATA_DIR, 'respaldos');
const CADA_CUANTO_MIRA = 30 * 60 * 1000; // se asoma cada media hora
const ESPACIO_MINIMO = 3; // veces el tamaño de la base que deben quedar libres

/** El día de hoy como 2026-08-23, en la hora de acá. */
function hoy(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function nombreDelDia(fecha = new Date()) {
  return `iglesias-${hoy(fecha)}.db.gz`;
}

/** Las copias que hay guardadas, de la más nueva a la más vieja. */
function guardadas() {
  let nombres;
  try {
    nombres = fs.readdirSync(CARPETA);
  } catch (e) {
    return [];
  }
  return nombres
    .filter((n) => /^iglesias-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(n))
    .map((nombre) => {
      let peso = 0;
      let cuando = null;
      try {
        const datos = fs.statSync(path.join(CARPETA, nombre));
        peso = datos.size;
        cuando = datos.mtime.toISOString();
      } catch (e) {
        /* si desapareció mientras mirábamos, va en cero */
      }
      return { nombre, dia: nombre.slice(9, 19), peso, cuando };
    })
    .sort((a, b) => b.dia.localeCompare(a.dia));
}

/** Borra las más viejas y deja solo las que se pidió conservar. */
function podar(cuantasQuedan) {
  const sobran = guardadas().slice(cuantasQuedan);
  for (const copia of sobran) {
    try {
      fs.unlinkSync(path.join(CARPETA, copia.nombre));
    } catch (e) {
      console.error(`⚠️  No se pudo borrar el respaldo viejo ${copia.nombre}: ${e.message}`);
    }
  }
  return sobran.length;
}

/** ¿Cabe otra copia? Se pregunta antes, no después de llenar el disco. */
function hayEspacio(pesoDeLaBase) {
  try {
    const disco = fs.statfsSync(DATA_DIR);
    const libre = disco.bavail * disco.bsize;
    return libre > pesoDeLaBase * ESPACIO_MINIMO;
  } catch (e) {
    return true; // si no se puede preguntar, se intenta igual
  }
}

/**
 * Hace la copia de hoy. Devuelve lo que pasó, para poder decirlo.
 *
 * Primero se poda y después se escribe: así el espacio que liberan las viejas
 * queda disponible para la nueva, que es justo cuando hace falta.
 */
async function hacerCopia({ conservar, forzada = false } = {}) {
  const cuantas = conservar || ajustes.numero('respaldo_conservar', 2, 60);
  const destino = path.join(CARPETA, nombreDelDia());

  const yaEstabaLaDeHoy = fs.existsSync(destino);
  if (!forzada && yaEstabaLaDeHoy) return { hecho: false, motivo: 'ya estaba la de hoy' };

  fs.mkdirSync(CARPETA, { recursive: true });
  // Se poda antes de escribir, para que el sitio que liberan las viejas esté
  // disponible para la nueva. Cuánto se deja depende de si la de hoy ya
  // estaba: si estaba, la nueva la reemplaza y no suma; si no, sí suma.
  podar(Math.max(1, yaEstabaLaDeHoy ? cuantas : cuantas - 1));

  const pesoBase = (() => {
    try {
      return fs.statSync(path.join(DATA_DIR, 'iglesias.db')).size;
    } catch (e) {
      return 0;
    }
  })();
  if (!hayEspacio(pesoBase)) {
    console.error('⚠️  No se hizo el respaldo automático: queda poco espacio en el disco de datos.');
    return { hecho: false, motivo: 'sin espacio' };
  }

  // Se copia a un nombre provisorio y recién al final se le pone el definitivo:
  // si el proceso se corta a medio camino, no queda una copia a medias con
  // nombre de copia buena.
  const enCurso = `${destino}.parcial`;
  const cruda = `${destino}.db`;
  try {
    await db.backup(cruda); // copia en caliente, coherente aunque se esté usando
    await pipeline(fs.createReadStream(cruda), zlib.createGzip({ level: 6 }), fs.createWriteStream(enCurso));
    fs.renameSync(enCurso, destino);
    const peso = fs.statSync(destino).size;
    return { hecho: true, nombre: path.basename(destino), peso };
  } catch (e) {
    console.error(`⚠️  No se pudo hacer el respaldo automático: ${e.message}`);
    return { hecho: false, motivo: e.message };
  } finally {
    for (const suelto of [cruda, enCurso]) {
      try {
        fs.unlinkSync(suelto);
      } catch (e) {
        /* si no quedó, mejor */
      }
    }
  }
}

/**
 * ¿Toca hacerla ahora?
 *
 * La regla es a propósito la más simple que funciona: si no está la copia de
 * hoy y ya pasó la hora fijada, se hace. Así, un sistema que estuvo apagado a
 * las tres de la mañana no se queda sin respaldo: lo hace en cuanto vuelve.
 */
function toca() {
  if (!ajustes.activo('respaldo_automatico')) return false;
  const hora = ajustes.numero('respaldo_hora', 0, 23);
  if (new Date().getHours() < hora) return false;
  return !fs.existsSync(path.join(CARPETA, nombreDelDia()));
}

/**
 * Cuántos días pasaron desde un día hasta hoy.
 *
 * Se cuentan días del calendario, no horas: a las cuatro de la mañana, la
 * copia de hoy es de hoy, y restando marcas de tiempo salía «hace -1 días».
 */
function diasDesde(dia) {
  const [a, m, d] = String(dia).split('-').map(Number);
  const ahora = new Date();
  const hoyCero = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Math.round((hoyCero - new Date(a, m - 1, d)) / 86400000);
}

/** Cómo va el respaldo automático, para mostrarlo en pantalla. */
function estado() {
  const copias = guardadas();
  const ultima = copias[0] || null;
  const dias = ultima ? diasDesde(ultima.dia) : null;
  return {
    activo: ajustes.activo('respaldo_automatico'),
    hora: ajustes.numero('respaldo_hora', 0, 23),
    conservar: ajustes.numero('respaldo_conservar', 2, 60),
    copias,
    ultima,
    dias,
    alDia: !!ultima && dias !== null && dias <= 1,
  };
}

/** El archivo de una copia, comprobando que el nombre sea uno de los nuestros. */
function rutaDe(nombre) {
  if (!/^iglesias-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(String(nombre))) return null;
  const ruta = path.join(CARPETA, path.basename(String(nombre)));
  return fs.existsSync(ruta) ? ruta : null;
}

/** Deja el reloj andando. Se llama una vez, al arrancar. */
function programar() {
  const revisar = () => {
    if (!toca()) return;
    hacerCopia().then((r) => {
      if (r.hecho) {
        console.log(`💾 Respaldo automático: ${r.nombre} (${(r.peso / 1024 / 1024).toFixed(1)} MB).`);
      }
    });
  };

  // La primera mirada no es de inmediato: al arrancar hay cosas más urgentes
  // que hacer, y una copia compite por el mismo disco.
  setTimeout(revisar, 60 * 1000).unref();
  setInterval(revisar, CADA_CUANTO_MIRA).unref();
}

module.exports = { programar, hacerCopia, estado, guardadas, rutaDe, podar, CARPETA };
