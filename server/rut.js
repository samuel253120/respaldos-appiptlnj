/**
 * Utilidades de RUT (Rol Único Tributario).
 *
 * El RUT es el identificador de acceso de los usuarios del sistema: a
 * diferencia del correo electrónico, no cambia y es único por persona.
 *
 * Formato canónico usado para almacenar: cuerpo sin puntos + guion + dígito
 * verificador en mayúscula. Ejemplo: "12345678-9", "7654321-K".
 */

/** Deja solo dígitos y la letra K (en mayúscula). */
function limpiar(valor) {
  return String(valor == null ? '' : valor).replace(/[^0-9kK]/g, '').toUpperCase();
}

/** Calcula el dígito verificador de un cuerpo de RUT (módulo 11). */
function digitoVerificador(cuerpo) {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/** ¿El RUT es válido (estructura y dígito verificador)? */
function validar(valor) {
  const limpio = limpiar(valor);
  if (limpio.length < 6 || limpio.length > 9) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return digitoVerificador(cuerpo) === dv;
}

/** Forma en que se guarda en la base de datos: "12345678-9". */
function canonico(valor) {
  const limpio = limpiar(valor);
  if (limpio.length < 2) return limpio;
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/** Forma en que se muestra en pantalla: "12.345.678-9". */
function formatear(valor) {
  const limpio = limpiar(valor);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

module.exports = { limpiar, digitoVerificador, validar, canonico, formatear };
