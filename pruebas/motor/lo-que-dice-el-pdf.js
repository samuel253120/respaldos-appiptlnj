/**
 * Lo que dice un PDF hecho con pdfkit, para poder comprobarlo en una prueba.
 *
 * Vivía dentro de la prueba de la hoja del acta. Cuando el mismo generador pasó
 * a hacer también las actas de asamblea hizo falta lo mismo en otra prueba, y de
 * las dos maneras de tenerlo —copiarlo o sacarlo afuera— vale la de siempre: una
 * copia hay que arreglarla dos veces.
 */

/*
 * Lo que un PDF de pdfkit DICE de verdad.
 *
 * Hace falta porque comprobar el código fuente no distingue una regla escrita
 * de una regla conectada: se probó rompiendo a propósito el `if` del sello
 * —dejándolo escrito pero apagado— y ninguna prueba de las de arriba se puso
 * roja. Es exactamente el defecto contra el que existe pruebas/motor/andando.js,
 * en el otro extremo del sistema.
 *
 * El texto va comprimido y escrito en hexadecimal, con la separación entre
 * letras metida como números entre los trozos: «APROBADA» se escribe
 * `<APR> 10 <OB> 10 <AD> 10 <A>`. Así que se inflan los flujos, se juntan SOLO
 * los trozos de cada arreglo —tirando los números y los espacios que los
 * separan, que no son del texto— y se decodifican. Los espacios de verdad
 * viajan dentro del hexadecimal y sobreviven.
 */
function loQueDiceElPdf(buf) {
  const zlib = require('zlib');
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m; let crudo = '';
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf('endstream', ini);
    if (fin < 0) continue;
    let d;
    try { d = zlib.inflateSync(buf.slice(ini, fin)).toString('latin1'); } catch (e) { continue; }
    if (/T[jJ]/.test(d)) crudo += d;
  }
  const hex = (x) => Buffer.from(x, 'hex').toString('latin1');
  const lineas = [];
  crudo.replace(/\[([^\]]*)\]\s*TJ|<([0-9A-Fa-f]*)>\s*Tj/g, (_, arreglo, suelto) => {
    lineas.push(arreglo !== undefined
      ? (arreglo.match(/<[0-9A-Fa-f]*>/g) || []).map((t) => hex(t.slice(1, -1))).join('')
      : hex(suelto));
    return '';
  });
  return lineas.join('\n');
}

module.exports = { loQueDiceElPdf };
