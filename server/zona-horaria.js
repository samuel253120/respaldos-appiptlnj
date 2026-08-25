/**
 * La zona horaria del sistema.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El sistema estampa fechas y horas en 46 lugares
 * con `datetime('now','localtime')` de SQLite, y ese «localtime» es la hora
 * DEL SERVIDOR, no la de la iglesia. Un servidor en la nube corre en UTC salvo
 * que se le diga otra cosa, y en Chile eso son tres o cuatro horas de más:
 *
 *     Hora real en Chile   lunes    24 de agosto, 22:03
 *     Lo que se grababa    martes   25 de agosto, 02:03   ← otro día
 *
 * Todo lo que pasara entre las 20:00 y la medianoche quedaba con la fecha del
 * día siguiente. Para una iglesia eso pega justo donde duele: un culto de
 * domingo por la noche quedaba anotado el lunes. Y de paso corría el corte de
 * los cumpleaños «de hoy», el nombre de los respaldos, el resumen diario de
 * los avisos y todos los `created_at` del registro de cambios.
 *
 * SE PUEDE CAMBIAR SIN REINICIAR. Comprobado: al asignar `process.env.TZ`,
 * Node llama a `tzset()` y la biblioteca del sistema —la misma que usa SQLite
 * para su «localtime»— toma la zona nueva en la consulta siguiente. Por eso
 * esto se aplica al arrancar Y al guardarlo, y no hace falta reiniciar nada.
 *
 * ES UNA LISTA CERRADA, NO UN CAMPO LIBRE. Una zona mal escrita no da error:
 * Node se queda callado y vuelve a UTC, o sea, exactamente el problema que
 * esto viene a arreglar, pero ahora escondido detrás de un ajuste que dice
 * otra cosa. Con una lista, un valor inventado no puede entrar.
 */
const ajustes = require('./ajustes');

const CLAVE = 'zona_horaria';

/** Las zonas de Chile, más UTC. La lista vive aparte: ver zonas.js. */
const { LAS_ZONAS } = require('./zonas');

/** ¿Es una zona que este sistema conoce Y que el sistema operativo entiende? */
function sirve(zona) {
  if (!LAS_ZONAS.some((z) => z.valor === zona)) return false;
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: zona }).format(new Date());
    return true;
  } catch (e) {
    // El contenedor puede venir sin la base de zonas horarias instalada.
    return false;
  }
}

/** La que está configurada, o la de Chile continental si la guardada no sirve. */
function cual() {
  const guardada = ajustes.obtener(CLAVE);
  return sirve(guardada) ? guardada : LAS_ZONAS[0].valor;
}

/**
 * Deja al proceso —y con él a SQLite— trabajando en esa zona.
 *
 * Devuelve la que quedó puesta, para poder anotarla al arrancar: si un día
 * vuelve a estar mal, que se vea en la primera línea del registro y no haya
 * que descubrirlo mirando fechas torcidas.
 */
function aplicar() {
  const zona = cual();
  process.env.TZ = zona;
  return zona;
}

/** La hora del sistema ahora mismo, para mostrarla y poder comprobarla de un vistazo. */
function ahora() {
  const zona = cual();
  const f = new Intl.DateTimeFormat('es-CL', {
    timeZone: zona, dateStyle: 'full', timeStyle: 'short',
  });
  return { zona, texto: f.format(new Date()) };
}

module.exports = { CLAVE, LAS_ZONAS, sirve, cual, aplicar, ahora };
