/**
 * El texto con formato del sistema, dibujado dentro de un PDF.
 *
 * POR QUÉ SE ESCRIBE ESTO Y NO SE USA UNA BIBLIOTECA. Convertir HTML a PDF en
 * general es un problema enorme —hay que traer un navegador entero, que pesa
 * cientos de megas— y acá no hace falta, porque el HTML que hay que dibujar no
 * es «HTML en general»: es exactamente lo que deja pasar server/textorico.js,
 * que es una lista blanca corta y SIN NINGÚN ATRIBUTO. Trece etiquetas, ni
 * estilos, ni tablas, ni imágenes, ni enlaces. Eso sí se puede dibujar a mano.
 *
 * Lo que se entiende:
 *
 *   · bloques      p, div, h3, h4, blockquote, li (dentro de ul u ol)
 *   · en la línea  b, strong, i, em, u, s, strike, br
 *
 * Cualquier otra cosa se ignora sin quejarse: el texto se dibuja igual, sin su
 * formato, que es lo correcto para un documento que se firma. Perder una
 * negrita es un detalle; perder un párrafo del acta no.
 */

/** Lo que el navegador escribe por nosotros y hay que devolver a su letra. */
const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ', iquest: '¿', iexcl: '¡', deg: '°', ordm: 'º', ordf: 'ª',
  laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', middot: '·',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', euro: '€', pound: '£', sect: '§',
};

function texto(bruto) {
  return String(bruto || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, cual) => {
    if (cual[0] === '#') {
      const n = cual[1] === 'x' || cual[1] === 'X'
        ? parseInt(cual.slice(2), 16)
        : parseInt(cual.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[cual] !== undefined ? ENTIDADES[cual] : todo;
  });
}

const DE_BLOQUE = new Set(['p', 'div', 'h3', 'h4', 'blockquote', 'li', 'ul', 'ol']);
const NEGRITA = new Set(['b', 'strong']);
const CURSIVA = new Set(['i', 'em']);
const SUBRAYA = new Set(['u']);
const TACHADO = new Set(['s', 'strike']);

/**
 * Parte el HTML en bloques, y cada bloque en trozos con su formato.
 *
 * Devuelve una lista de `{ tipo, nivel, marca, trozos }`, donde cada trozo es
 * `{ texto, negrita, cursiva, subrayado, tachado }`. Un `br` aparece como un
 * trozo con `salto: true`.
 */
function enBloques(html) {
  const bloques = [];
  let actual = null;
  const pila = []; // el formato que está abierto ahora mismo
  const listas = []; // ul/ol anidadas, con su cuenta para numerar

  const abrirBloque = (tipo) => {
    cerrarBloque();
    actual = { tipo, trozos: [], nivel: listas.length, marca: null };
    if (tipo === 'li' && listas.length) {
      const lista = listas[listas.length - 1];
      lista.cuantos++;
      actual.marca = lista.ordenada ? `${lista.cuantos}.` : '•';
    }
  };
  const cerrarBloque = () => {
    if (actual && actual.trozos.some((t) => t.salto || t.texto.trim())) bloques.push(actual);
    actual = null;
  };
  const agregar = (t) => {
    if (!actual) actual = { tipo: 'p', trozos: [], nivel: 0, marca: null };
    actual.trozos.push(t);
  };

  const RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)/g;
  let m;
  while ((m = RE.exec(String(html || ''))) !== null) {
    const [, cierre, nombre, suelto] = m;

    if (suelto !== undefined) {
      const t = texto(suelto).replace(/\s+/g, ' ');
      if (t) {
        agregar({
          texto: t,
          negrita: pila.some((e) => NEGRITA.has(e)),
          cursiva: pila.some((e) => CURSIVA.has(e)),
          subrayado: pila.some((e) => SUBRAYA.has(e)),
          tachado: pila.some((e) => TACHADO.has(e)),
        });
      }
      continue;
    }

    const etiqueta = nombre.toLowerCase();
    if (etiqueta === 'br') { agregar({ texto: '', salto: true }); continue; }

    if (!cierre) {
      if (etiqueta === 'ul' || etiqueta === 'ol') {
        cerrarBloque();
        listas.push({ ordenada: etiqueta === 'ol', cuantos: 0 });
      } else if (DE_BLOQUE.has(etiqueta)) {
        abrirBloque(etiqueta);
      } else {
        pila.push(etiqueta);
      }
    } else {
      if (etiqueta === 'ul' || etiqueta === 'ol') {
        cerrarBloque();
        listas.pop();
      } else if (DE_BLOQUE.has(etiqueta)) {
        cerrarBloque();
      } else {
        const donde = pila.lastIndexOf(etiqueta);
        if (donde >= 0) pila.splice(donde, 1);
      }
    }
  }
  cerrarBloque();
  return bloques;
}

/**
 * Dibuja ese texto en el documento, desde donde vaya el cursor.
 *
 * `estilo` trae los tamaños y las fuentes, para que el acta y cualquier otro
 * documento que use esto se vean iguales sin repetir los números.
 */
function dibujar(doc, html, estilo) {
  const bloques = enBloques(html);
  if (!bloques.length) return false;

  const E = {
    cuerpo: 10.5,
    titulo3: 12.5,
    titulo4: 11,
    fuente: 'Helvetica',
    fuenteNegrita: 'Helvetica-Bold',
    fuenteCursiva: 'Helvetica-Oblique',
    fuenteAmbas: 'Helvetica-BoldOblique',
    color: '#111827',
    ...(estilo || {}),
  };
  const laFuente = (t) => (t.negrita && t.cursiva ? E.fuenteAmbas
    : t.negrita ? E.fuenteNegrita
      : t.cursiva ? E.fuenteCursiva : E.fuente);

  const izquierda = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const bloque of bloques) {
    const esTitulo = bloque.tipo === 'h3' || bloque.tipo === 'h4';
    // La cita se corre bastante más que una viñeta: con poca sangría quedaba
    // pegada a la lista de arriba y se leía como un punto más de ella.
    const sangria = (bloque.nivel ? 16 * bloque.nivel : 0) + (bloque.tipo === 'blockquote' ? 34 : 0);
    const tamano = bloque.tipo === 'h3' ? E.titulo3 : bloque.tipo === 'h4' ? E.titulo4 : E.cuerpo;

    doc.moveDown(esTitulo ? 0.6 : 0.35);
    let x = izquierda + sangria;
    let ancho = anchoUtil - sangria;

    // La viñeta o el número van aparte, para que el texto de la línea siguiente
    // quede alineado con el de la primera y no debajo de la marca.
    if (bloque.marca) {
      doc.font(E.fuente).fontSize(tamano).fillColor(E.color)
        .text(bloque.marca, x, doc.y, { width: 14, continued: false, lineBreak: false });
      doc.moveUp();
      x += 18;
      ancho -= 18;
    }

    const trozos = bloque.trozos.filter((t) => t.salto || t.texto);
    if (!trozos.length) continue;

    // De dónde a dónde va la cita, para poder marcarla con una raya al costado
    const yAntes = doc.y;
    const paginaAntes = doc.bufferedPageRange ? doc.bufferedPageRange().count : 0;

    trozos.forEach((t, i) => {
      const ultimo = i === trozos.length - 1;
      // El subrayado y el tachado se piden ANTES de dibujar, en las opciones de
      // este trozo: pedirlos después no hace nada, porque la línea ya se pintó.
      const opciones = {
        width: ancho,
        continued: !ultimo,
        underline: !!t.subrayado,
        strike: !!t.tachado,
      };
      // Y va en cursiva y más apagada, que es como se lee una cita
      const enCita = bloque.tipo === 'blockquote';
      doc.font(esTitulo ? E.fuenteNegrita
        : enCita ? (t.negrita ? E.fuenteAmbas : E.fuenteCursiva)
          : laFuente(t))
        .fontSize(enCita ? tamano - 0.5 : tamano)
        .fillColor(enCita ? '#4b5563' : E.color);
      const contenido = t.salto ? '\n' : t.texto;
      if (i === 0) doc.text(contenido, x, doc.y, opciones);
      else doc.text(contenido, opciones);
    });

    /*
     * La raya de la cita.
     *
     * Sin ella, una cita que viene detrás de una lista queda a la misma altura
     * que las viñetas y se lee como un punto más: en un acta, «se dejó
     * constancia de…» pasaría por ser otro acuerdo. Se dibuja al final, cuando
     * ya se sabe cuánto ocupó, y solo si la cita no se partió en dos páginas
     * —ahí la raya quedaría cruzando el pie—.
     */
    if (bloque.tipo === 'blockquote') {
      const mismaPagina = !doc.bufferedPageRange || doc.bufferedPageRange().count === paginaAntes;
      if (mismaPagina && doc.y > yAntes) {
        doc.moveTo(izquierda + 20, yAntes).lineTo(izquierda + 20, doc.y)
          .lineWidth(2).strokeColor('#cbd5e1').stroke();
      }
    }
    doc.fillColor(E.color);
  }
  return true;
}

module.exports = { dibujar, enBloques, texto };
