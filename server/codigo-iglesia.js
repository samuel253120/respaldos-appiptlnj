/**
 * El código corto con que se nombra a cada iglesia.
 *
 * Era un campo suelto, opcional y libre: servía para buscar y para verse en el
 * listado, y nada más. Ahora además IDENTIFICA a la iglesia dentro de un
 * número correlativo —`SOL-CENTRAL-0001-2026`—, y eso le pide tres cosas que
 * antes no le hacían falta:
 *
 *   · QUE ESTÉ. Un número que no dice de qué iglesia es no sirve para nombrar
 *     nada: «la 0001 de este año» pregunta «¿de cuál?».
 *   · QUE NO SE REPITA. Dos iglesias con el mismo código darían dos series de
 *     números idénticas, y el correlativo dejaría de nombrar una sola cosa.
 *   · QUE SE PUEDA ESCRIBIR EN CUALQUIER PARTE. Va en un número que se dicta
 *     por teléfono, se escribe en un acta y se busca en el sistema: letras,
 *     dígitos y guiones, sin tildes ni espacios.
 *
 * NO SE INVENTA NADA AL VUELO. El código se guarda en la ficha de la iglesia y
 * se lee de ahí. Un número ya emitido conserva el código que tenía el día en
 * que se emitió: cambiarle el código a una iglesia no reescribe su papelería,
 * igual que cambiar un prefijo empieza una serie nueva y no toca la anterior.
 */

/**
 * Hasta dónde llega un código: dentro de un número, uno largo deja de leerse.
 *
 * Es un tope, no un recorte silencioso. Al escribirlo en la ficha, un código
 * más largo se RECHAZA diciendo por qué: recortarlo cambiaría lo que la persona
 * quiso decir, y —peor— dos códigos distintos que empiezan igual quedarían
 * convertidos en el mismo sin que nadie lo note. Se comprobó: «ZZ-PRUEBA-N» y
 * «ZZ-PRUEBA-S», recortados, eran el mismo código y la segunda iglesia no se
 * podía guardar por un choque que nadie había provocado.
 *
 * Donde sí se recorta es cuando el código lo PROPONE el sistema —al sacarlo de
 * un nombre, o al poner uno a las iglesias que no tenían—: ahí no hay nada que
 * respetar, y lo que salga se ve y se corrige en la ficha.
 */
const LARGO_MAXIMO = 16;

/** Palabras con que empiezan casi todas: no distinguen a ninguna. */
const NO_DISTINGUE = ['iglesia', 'templo', 'congregacion', 'sede', 'anexo', 'local', 'de', 'del', 'la', 'el', 'los', 'las'];

/**
 * Deja un código como se puede usar: MAYÚSCULAS, sin tildes, solo letras,
 * dígitos y guiones, y sin guiones sueltos en las puntas.
 */
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Lo mismo, pero cortado al largo máximo. Solo para los que propone el sistema.
 *
 * Nunca para lo que escribe una persona: ahí el largo se comprueba y se avisa
 * (ver server/modules/iglesias.js). Cortar en silencio lo que alguien escribió
 * puede juntar dos códigos distintos en uno.
 */
function recortar(texto) {
  return normalizar(texto).slice(0, LARGO_MAXIMO).replace(/-$/, '');
}

/**
 * Un código propuesto a partir del nombre, para las iglesias que no tenían.
 *
 * Se queda con la primera palabra que de verdad distingue: de «Iglesia
 * Central» sale CENTRAL, no ICENTRAL ni IC. Si el nombre entero es genérico,
 * cae en el número de la ficha, que al menos es único.
 */
function deSuNombre(nombre, id) {
  const palabras = String(nombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const propia = palabras.find((p) => !NO_DISTINGUE.includes(p.toLowerCase()));
  return recortar(propia || '') || `IG${id}`;
}

/**
 * El mismo código, o el primero libre a partir de él.
 *
 * Al chocar se le suma un número —CENTRAL, CENTRAL2, CENTRAL3—: es la manera
 * de que la migración no deje dos iglesias con el mismo, sin tener que
 * inventarle un nombre a ninguna. Después se edita en su ficha.
 */
function libre(db, candidato, exceptoId) {
  const base = recortar(candidato) || `IG${exceptoId || ''}` || 'IG';
  const tomado = db.prepare('SELECT 1 FROM iglesias WHERE UPPER(codigo) = ? AND id != ?');
  let cual = base;
  let n = 1;
  while (tomado.get(cual, exceptoId || 0)) {
    n += 1;
    const sufijo = String(n);
    cual = base.slice(0, LARGO_MAXIMO - sufijo.length) + sufijo;
  }
  return cual;
}

/**
 * El código de una iglesia, para meterlo en un número.
 *
 * Si no lo tiene —una ficha de antes de que esto existiera, o una que se creó
 * saltándose la validación— se usa `IG` y su número de ficha. Un número con un
 * código raro se sigue pudiendo leer; uno sin nada que identifique la iglesia,
 * no.
 */
function deLaIglesia(db, iglesiaId) {
  const id = Number(iglesiaId) || 0;
  if (!id) return '';
  let fila = null;
  try {
    fila = db.prepare('SELECT codigo FROM iglesias WHERE id = ?').get(id);
  } catch (e) {
    fila = null;
  }
  return normalizar(fila && fila.codigo) || `IG${id}`;
}

module.exports = { normalizar, recortar, deSuNombre, libre, deLaIglesia, LARGO_MAXIMO };
