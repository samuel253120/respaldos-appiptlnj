/**
 * Cómo se nombra a una persona en pantalla.
 *
 * En la ficha se guarda todo lo que la persona tiene: «Juan Carlos Alberto» y
 * «Pérez Soto». Pero en un listado, en un selector o al pasar lista, ese
 * nombre entero ocupa una línea completa y no ayuda a reconocer a nadie más
 * rápido. Acá se arma la forma corta con la que se la nombra en el día a día:
 *
 *   el primer nombre y los dos apellidos → «Juan Pérez Soto»
 *
 * El nombre completo no se pierde ni se toca: sigue guardado tal cual y se ve
 * entero al abrir la ficha para editarla, que es donde importa.
 */

/** El primer nombre de pila: «Juan Carlos Alberto» → «Juan». */
function primerNombre(nombres) {
  const partes = String(nombres || '').trim().split(/\s+/).filter(Boolean);
  return partes[0] || '';
}

/** «Juan Carlos Alberto» + «Pérez Soto» → «Juan Pérez Soto». */
function paraMostrar(nombres, apellidos) {
  return `${primerNombre(nombres)} ${String(apellidos || '').trim()}`.trim();
}

/**
 * Lo mismo, cuando el nombre viene todo junto en un solo campo —como en la
 * cuenta de usuario—: se queda con el primero y con los dos últimos, que en
 * Chile son los apellidos.
 *
 * Con tres palabras o menos no se toca: «Ana María Soto» ya es corto, y
 * recortarlo sería inventar cuál de esas palabras es apellido.
 */
function acortar(nombreCompleto) {
  const partes = String(nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 3) return partes.join(' ');
  return [partes[0], partes[partes.length - 2], partes[partes.length - 1]].join(' ');
}

module.exports = { primerNombre, paraMostrar, acortar };
