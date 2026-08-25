/**
 * La fecha de hoy, la misma que va a entender el servidor.
 *
 * POR QUÉ NO SIRVE `toISOString()`. Es lo que usaban las suites, y devuelve
 * SIEMPRE la fecha en hora universal, sin importar dónde corra. Mientras el
 * servidor también andaba en hora universal las dos coincidían y nadie lo
 * notó; en cuanto el servidor pasó a hora de Chile, las suites empezaron a
 * mandar la fecha de mañana y el sistema las rechazaba con toda la razón:
 * «esa fecha todavía no llega».
 *
 * Así que se pregunta al servidor en qué zona trabaja y se arma la fecha ahí.
 * Preguntarle es mejor que escribirlo acá: si un día la iglesia cambia su
 * zona, las pruebas la siguen solas.
 */

/** Pone el proceso en la misma zona que el servidor, preguntándosela. */
async function alinearConElServidor(url) {
  try {
    const r = await fetch(`${url}/health`);
    const salud = await r.json();
    if (salud && salud.zona && salud.zona !== '?') process.env.TZ = salud.zona;
    return salud && salud.zona;
  } catch (e) {
    // Si no contesta, las pruebas van a fallar igual y con mejor mensaje.
    return null;
  }
}

/** Hoy, en la zona del proceso —ya alineada—, como 2026-08-24. */
function hoy(cuando = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${cuando.getFullYear()}-${dos(cuando.getMonth() + 1)}-${dos(cuando.getDate())}`;
}

module.exports = { hoy, alinearConElServidor };
