/**
 * El número de serie de una credencial, y su dígito verificador.
 *
 * Formato, ya definido y vigente: tres dígitos correlativos + año de emisión +
 * guion + dígito verificador. Por ejemplo `1232026-3`.
 *
 * Hay cuatro reglas que parecen detalles y no lo son. Las cuatro vienen de que
 * este número va impreso en un documento de identidad ministerial: una vez que
 * salió en papel, ya no se puede corregir.
 *
 *   · LO ASIGNA EL SISTEMA, SIEMPRE. En ninguna pantalla se escribe, se elige
 *     ni se corrige a mano. Ni siquiera el administrador general.
 *
 *   · NO SE REINICIA CON EL AÑO. El correlativo corre de corrido desde la
 *     primera credencial, así que el último número dice cuántas ha emitido la
 *     iglesia en total. Después de 0122026 viene 0132027, no 0012027.
 *
 *   · NO SE REUTILIZA NUNCA. Si una credencial se anula, se revoca, se
 *     reemplaza o su borrador se elimina, su número queda consumido. Por eso el
 *     correlativo NO se calcula contando filas ni buscando el máximo: eso
 *     volvería a entregar el número de una credencial borrada, y dos papeles
 *     distintos llevarían la misma serie. Se lleva en un contador propio que
 *     solo sube.
 *
 *   · DOS PERSONAS A LA VEZ NO PUEDEN RECIBIR EL MISMO. El contador se
 *     incrementa y se lee en un solo paso de la base, dentro de una
 *     transacción, y además la columna lleva una restricción de unicidad: si
 *     por lo que fuera se intentara repetir uno, la base lo rechaza.
 *
 * Es normal y esperado que queden saltos en la numeración.
 */
/** Con cuántos dígitos se escribe el correlativo, como mínimo. */
const MINIMO_DIGITOS = 3;

/**
 * La base, pedida en el momento y no al cargar el archivo.
 *
 * Este archivo lo usa una migración, y las migraciones corren desde dentro de
 * db.js: pedir la base arriba del todo la encontraría a medio construir.
 */
let listo = false;
function base() {
  const { db } = require('../db');
  if (!listo) {
    // El contador vive en su propia tabla, con una sola fila. No se borra al
    // borrar credenciales: de eso se trata que el número no se reutilice.
    db.exec(`CREATE TABLE IF NOT EXISTS credencial_contador (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ultimo INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare('INSERT OR IGNORE INTO credencial_contador (id, ultimo) VALUES (1, 0)').run();
    listo = true;
  }
  return db;
}

/**
 * El dígito verificador, con el algoritmo de Luhn.
 *
 * Copiado tal cual del archivo de diseño credencial-pastor.html, para que el
 * número que calcula el sistema y el que calcula ese archivo coincidan
 * siempre. No se reescribe «mejorado»: si los dos cálculos se separaran, una
 * credencial impresa desde un lado no validaría desde el otro.
 */
function digitoVerificador(num) {
  const s = (num || '').replace(/\D/g, '');
  if (!s) return '';
  let sum = 0;
  let alt = true;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = +s[i];
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return String((10 - (sum % 10)) % 10);
}

/** El correlativo escrito como va: tres dígitos como mínimo, más si hace falta. */
const comoSeEscribe = (n) => String(n).padStart(MINIMO_DIGITOS, '0');

/** La serie completa a partir del correlativo y el año: «1232026». */
const serieDe = (correlativo, anio) => `${comoSeEscribe(correlativo)}${anio}`;

/**
 * Toma el número que sigue. Sube el contador y lo devuelve en un solo paso.
 *
 * Que sea un solo paso es lo que hace imposible que dos emisiones simultáneas
 * reciban el mismo: SQLite serializa la escritura, así que la segunda ve el
 * contador ya subido. Calcularlo como «cuántas hay + 1» fallaría justo acá.
 */
function siguienteCorrelativo() {
  const fila = base().prepare('UPDATE credencial_contador SET ultimo = ultimo + 1 WHERE id = 1 RETURNING ultimo').get();
  if (!fila) throw new Error('No se pudo tomar el número de la credencial: falta el contador');
  return fila.ultimo;
}

/** Cuántas credenciales se han generado en total desde el comienzo. */
function cuantasSeHanGenerado() {
  const fila = base().prepare('SELECT ultimo FROM credencial_contador WHERE id = 1').get();
  return fila ? fila.ultimo : 0;
}

/**
 * Deja el contador en un valor dado. Solo para poner al día lo que ya existía
 * y para la limpieza del punto 13.1 de la especificación; nunca para retroceder
 * por gusto: bajarlo haría que un número vuelva a entregarse.
 */
function fijarContador(valor) {
  base().prepare('UPDATE credencial_contador SET ultimo = ? WHERE id = 1').run(Math.max(0, Number(valor) || 0));
}

/**
 * El número de la próxima credencial, ya con su dígito.
 *
 * Se usa dentro de la transacción que guarda la fila. Si esa transacción se
 * deshace, el número igual queda consumido —el contador ya subió—: es
 * exactamente lo que pide la regla de no reutilizar.
 */
function tomarSerie(anio) {
  const correlativo = siguienteCorrelativo();
  const serie = serieDe(correlativo, anio || new Date().getFullYear());
  return { correlativo, serie, dv: digitoVerificador(serie) };
}

/** La serie como se lee e imprime: «1232026-3». */
const conDigito = (serie, dv) => (serie ? `${serie}-${dv || digitoVerificador(serie)}` : '');

module.exports = {
  digitoVerificador, serieDe, comoSeEscribe, tomarSerie, siguienteCorrelativo,
  cuantasSeHanGenerado, fijarContador, conDigito, MINIMO_DIGITOS,
};
