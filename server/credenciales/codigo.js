/**
 * El código de autenticidad que sella el contenido del código QR.
 *
 * Son siete caracteres calculados sobre todos los datos de la credencial más
 * una clave secreta. Van impresos dentro del QR (`C:6Q5GG42`) y sirven para lo
 * mismo que el sello de un documento en papel: si alguien cambia un dato del
 * contenido, el código deja de calzar y la verificación lo rechaza.
 *
 * DÓNDE VIVE LA CLAVE, Y POR QUÉ IMPORTA TANTO
 *
 * El archivo de diseño aprobado calcula este código en el navegador, con la
 * clave escrita adentro. Ahí no había alternativa —era un archivo suelto, sin
 * servidor— y su propio comentario lo dice: «esto disuade y detecta
 * alteraciones, no sustituye a una firma emitida por un servidor».
 *
 * Acá sí hay servidor, así que la clave vive SOLO en el servidor y nunca se
 * manda al navegador. Si viajara, cualquiera que abriera la página podría
 * leerla, fabricarse el código de una credencial inventada y hacerla pasar por
 * buena. Por eso el QR se arma en el servidor y la página solo recibe el
 * resultado.
 *
 * Y se usa HMAC-SHA256 en vez del hash simplificado del archivo, que se podía
 * revertir con paciencia.
 */
const crypto = require('crypto');

/**
 * La clave, de las variables del servidor.
 *
 * Sin ella el sistema funciona igual —usa una de reserva— pero avisa, porque
 * una clave que está escrita en el código es pública: cualquiera con acceso al
 * repositorio puede firmar credenciales falsas. En un servidor publicado hay
 * que ponerla.
 */
const DE_RESERVA = 'IPT-LNJ::7217::credencial::cambiar-esta-clave-en-produccion';
const CLAVE = process.env.CREDENCIAL_SECRETO || process.env.JWT_SECRET || DE_RESERVA;
const propia = !!(process.env.CREDENCIAL_SECRETO || process.env.JWT_SECRET);

if (!propia) {
  console.error(
    '⚠️  ATENCIÓN: no está configurada la variable CREDENCIAL_SECRETO, así que los códigos de\n' +
      '   autenticidad de las credenciales se firman con una clave de reserva que está escrita en\n' +
      '   el código y es pública. Cualquiera podría fabricar el código de una credencial falsa.\n' +
      '   Póngala en las variables del servidor. Para generar una:\n' +
      '   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '   Al cambiarla, los códigos ya impresos dejan de validar: cámbiela una sola vez, al publicar.'
  );
}

/** Cuántos caracteres lleva el código impreso. */
const LARGO = 7;

/**
 * El código de una cadena de datos.
 *
 * HMAC-SHA256, el resultado leído como número en base 36 y en mayúsculas, y de
 * ahí los últimos siete caracteres: es la misma forma del archivo de diseño
 * —siete caracteres de letras y números— con un cálculo que no se puede
 * deshacer.
 */
function firmar(datos) {
  const mac = crypto.createHmac('sha256', CLAVE).update(String(datos), 'utf8').digest();
  // Doce bytes bastan y sobran para siete caracteres en base 36
  const n = BigInt('0x' + mac.subarray(0, 12).toString('hex'));
  return n.toString(36).toUpperCase().padStart(LARGO, '0').slice(-LARGO);
}

/**
 * ¿Este código corresponde a estos datos?
 *
 * Se comparan en tiempo constante: comparar con `===` tarda un poco más
 * cuando los primeros caracteres coinciden, y con suficientes intentos eso
 * deja adivinar el código carácter por carácter.
 */
function corresponde(datos, codigo) {
  const esperado = Buffer.from(firmar(datos));
  const recibido = Buffer.from(String(codigo || '').toUpperCase());
  if (esperado.length !== recibido.length) return false;
  return crypto.timingSafeEqual(esperado, recibido);
}

module.exports = { firmar, corresponde, LARGO, tieneClavePropia: () => propia };
