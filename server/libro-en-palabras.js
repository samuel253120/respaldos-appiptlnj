/**
 * CÓMO SE DICE LO QUE EL LIBRO DE PARTES CIERRA.
 *
 * El cierre —«En este libro constan 4 documento(s): 3 recibido(s) y 1
 * emitido(s)»— y la declaración de lo que falta en el correlativo son la parte
 * del libro que AFIRMA algo. Van debajo de la tabla, encima de las dos líneas
 * de firma, y es lo que alguien firma.
 *
 * POR QUÉ ESTÁN ACÁ Y NO EN CADA HOJA. Hay dos maneras de sacar el libro del
 * sistema: la vista de impresión del navegador y, desde la v1.291.0, el PDF que
 * arma el servidor. Las dos tienen que decir EXACTAMENTE lo mismo: si una
 * dijera «constan 4» y la otra «constan 5», el libro dejaría de servir para lo
 * único que sirve. Escritas dos veces, tarde o temprano dicen cosas distintas
 * —este sistema ya tuvo que arreglar tres veces una regla copiada—, así que las
 * palabras se escriben una sola vez, acá, y viajan en la misma respuesta que
 * arma el libro.
 *
 * LO QUE CADA HOJA SÍ DECIDE ES CÓMO SE VE. Los trozos que van resaltados
 * vienen marcados entre ⟦ y ⟧: la pantalla los pone en negrita y el PDF, que ya
 * los separa con su tipografía, se los saca. Se comparten las palabras, no la
 * pinta.
 */

/** Un número como se lee en Chile: 1869969 → «1.869.969». */
function comoSeLee(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Resalta un trozo, para que cada hoja decida qué hacer con eso. */
const destacado = (x) => `⟦${x}⟧`;

/**
 * EL CIERRE, que cuenta lo que la hoja MUESTRA.
 *
 * Con un filtro puesto se contradecía: pidiendo solo el archivo interno decía
 * «constan 2 documento(s): 0 recibido(s) y 0 emitido(s)» —las dos cosas en la
 * misma línea, en un papel que se firma—, y pidiendo solo lo recibido decía «y
 * 0 emitido(s)», que nadie preguntó. Una frase por cada filtro, y la de los dos
 * números solo cuando la hoja muestra el libro entero.
 */
function cierreDelLibro(libro) {
  const r = libro.resumen || {};
  const folios = r.folios ? `, con un total de ${destacado(comoSeLee(r.folios))} folio(s)` : '';
  const cuantos = `${destacado(comoSeLee(r.total || 0))} documento(s)`;

  if (libro.flujo === 'Recibido') return `En este libro constan ${cuantos} recibido(s)${folios}.`;
  if (libro.flujo === 'Emitido') return `En este libro constan ${cuantos} emitido(s)${folios}.`;
  if (libro.flujo === 'Interno o de archivo') {
    return `En este archivo constan ${cuantos} de archivo interno${folios}.`;
  }
  return `En este libro constan ${cuantos}: ${destacado(comoSeLee(r.recibidos || 0))} recibido(s) y `
    + `${destacado(comoSeLee(r.emitidos || 0))} emitido(s)${folios}.`;
}

/**
 * Y LO QUE FALTA: los huecos del correlativo y las anotaciones sin número.
 *
 * Es lo único que un libro de partes tiene para demostrar que no falta nada. No
 * se impiden los huecos —un libro que viene de papel empieza en el 47, y anular
 * un número es una operación real de oficina—: se declaran, que es lo que hace
 * que un hueco explicado deje de parecerse a uno escondido.
 */
function loQueFalta(libro) {
  const h = (libro.resumen && libro.resumen.huecos) || { faltan: [], sinNumero: 0 };
  if (!h.faltan.length && !h.sinNumero) return null;

  const lineas = h.faltan.map((s) => {
    const mas = s.cuantos > s.numeros.length
      ? ` y ${comoSeLee(s.cuantos - s.numeros.length)} más`
      : '';
    return `Entre ${s.desde} y ${s.hasta} falta${s.cuantos === 1 ? '' : 'n'} `
      + `${destacado(comoSeLee(s.cuantos))}: ${s.numeros.join(', ')}${mas}.`;
  });
  if (h.sinNumero) {
    lineas.push(`${destacado(comoSeLee(h.sinNumero))} anotación(es) sin número de oficina de partes.`);
  }

  return {
    titulo: 'Lo que falta en el correlativo',
    lineas,
    nota: 'Un hueco puede tener explicación —un número anulado, un libro que viene de antes—, '
      + 'pero la hoja tiene que decirlo.',
  };
}

/** Sin las marcas de resaltado: para donde no se puede o no hace falta. */
const sinMarcas = (texto) => String(texto == null ? '' : texto).replace(/[⟦⟧]/g, '');

/** Todo lo que el cierre dice, listo para viajar con el libro. */
function enPalabras(libro) {
  return { cierre: cierreDelLibro(libro), falta: loQueFalta(libro) };
}

module.exports = { cierreDelLibro, loQueFalta, enPalabras, sinMarcas, comoSeLee };
