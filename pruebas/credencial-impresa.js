/**
 * La credencial impresa, medida sobre el papel (y no sobre la promesa).
 *
 * El punto 18.3 de la especificación es explícito: ninguna prueba de impresión
 * se da por aprobada sin haberla ejecutado. Así que esto no mira el HTML: pide
 * el PDF al navegador, lo rasteriza y MIDE sobre la imagen.
 *
 * Lo que comprueba, todo sobre el PDF de verdad:
 *
 *   · que sea UNA sola página tamaño Carta;
 *   · que cada cara mida 54 × 86 mm, con regla;
 *   · que la pieza plegable mida 54 × 172 mm y el pliegue caiga al centro;
 *   · que el código QR se decodifique después de rasterizar el PDF a 300 puntos
 *     por pulgada, y que siga decodificándose con un desenfoque leve encima
 *     —lo que hace una impresora de inyección cuando la tinta sangra en el
 *     papel—;
 *   · que cada módulo del QR mida 0,25 mm o más, medido sobre la tinta;
 *   · que ningún texto se salga de su recuadro, ni con un nombre larguísimo ni
 *     con tildes y eñes (punto 15.4);
 *   · que la fila del Cargo no se imprima cuando va vacía (punto 15.5);
 *   · que la fotografía salga con el encuadre que se guardó, y cubriendo todo
 *     su recuadro (punto 6.4);
 *   · que el logo, el sello y la firma conserven su transparencia al subirlos.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   URL=http://localhost:3000 RUT=… CLAVE=… CRED=12 node pruebas/credencial-impresa.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const papel = require('./leer-qr');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';
const CRED = process.env.CRED || '';

/** Milímetros por punto PostScript: el PDF se mide en puntos de 1/72". */
const MM_POR_PUNTO = 25.4 / 72;

let fallas = 0;
function revisar(loQueSeEspera, condicion, detalle) {
  if (condicion) {
    console.log(`   ✅ ${loQueSeEspera}${detalle ? `  (${detalle})` : ''}`);
  } else {
    fallas++;
    console.log(`   ❌ ${loQueSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

/** Con qué medida se compara: se admite un pelo de diferencia por redondeo. */
const casi = (a, b, tolerancia = 0.6) => Math.abs(a - b) <= tolerancia;

(async () => {
  console.log(`📐 Midiendo la credencial impresa contra ${URL}\n`);
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'credencial-'));
  const navegador = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
  );
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await ctx.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 140)); });

  await pagina.goto(`${URL}/`);
  await pagina.fill('#loginRut', RUT);
  await pagina.fill('#loginPass', CLAVE);
  await pagina.click('button[type=submit]');
  await pagina.waitForTimeout(1500);
  if (await pagina.$('#psLuego')) { await pagina.click('#psLuego'); await pagina.waitForTimeout(700); }

  // Cuál credencial se mide: la que se indique, o la primera que haya
  let id = CRED;
  if (!id) {
    id = await pagina.evaluate(async () => {
      const r = await api('GET', '/credenciales?limit=1&sort=id&dir=desc');
      return r.rows.length ? r.rows[0].id : null;
    });
  }
  if (!id) {
    console.error('❌ No hay ninguna credencial emitida con la que probar.');
    process.exit(1);
  }
  console.log(`   Credencial #${id}\n`);

  await pagina.goto(`${URL}/#/print/credenciales/${id}`);
  await pagina.waitForSelector('.plegable .card.frente', { timeout: 15000 });
  await pagina.waitForTimeout(1200);

  /* 1 · Las medidas, en modo impresión ------------------------------------ */
  console.log('1 · Las medidas de la pieza (medidas en modo impresión)');
  /**
   * Se mide con el navegador puesto en «impresión», no en pantalla.
   *
   * El diseño amplía la tarjeta 1,9 veces EN PANTALLA para que se pueda leer,
   * y esa ampliación no se aplica al imprimir. Medir en pantalla daría 102 mm
   * de ancho y sería una medida que no existe en ningún papel: la primera vez
   * que se corrió esta prueba dijo exactamente eso.
   */
  await pagina.emulateMedia({ media: 'print' });
  await pagina.evaluate(() => document.body.classList.add('imprimiendo-credencial'));
  await pagina.waitForTimeout(400);
  const medidas = await pagina.evaluate(() => {
    // Un milímetro de verdad, medido por el propio navegador
    const regla = document.createElement('div');
    regla.style.cssText = 'position:absolute;width:100mm;height:0;visibility:hidden';
    document.body.appendChild(regla);
    const pxPorMm = regla.getBoundingClientRect().width / 100;
    regla.remove();
    const caja = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { ancho: r.width / pxPorMm, alto: r.height / pxPorMm, top: r.top / pxPorMm, left: r.left / pxPorMm };
    };
    return {
      pxPorMm,
      frente: caja('.pieza-frente .card'),
      reverso: caja('.pieza-reverso .card'),
      pieza: caja('.plegable'),
      qr: caja('.qr-holder'),
      barra: caja('.barra'),
      barraTxt: caja('.barra-txt'),
      logoFrente: caja('.pieza-frente .logoc'),
      logoReverso: caja('.pieza-reverso .logoc'),
      /**
       * La firma se mide con `offsetTop`, no con el rectángulo en pantalla.
       *
       * El reverso se imprime girado 180°, así que en coordenadas de pantalla
       * su borde inferior es el de arriba y una resta hecha con
       * getBoundingClientRect da el hueco al revés. `offsetTop` y
       * `offsetHeight` son medidas de maquetación: no las toca la rotación.
       */
      firmaApoyo: (() => {
        const bloque = document.querySelector('.pieza-reverso .firma');
        const img = document.querySelector('.pieza-reverso .firma-img');
        if (!bloque || !img) return null;
        return (bloque.offsetHeight - (img.offsetTop + img.offsetHeight)) / pxPorMm;
      })(),
      firmaAncho: (() => {
        const img = document.querySelector('.pieza-reverso .firma-img');
        return img ? img.offsetWidth / pxPorMm : null;
      })(),
      foto: caja('.foto'),
    };
  });

  revisar('el anverso mide 54 mm de ancho', casi(medidas.frente.ancho, 54), `${medidas.frente.ancho.toFixed(2)} mm`);
  revisar('el anverso mide 86 mm de alto', casi(medidas.frente.alto, 86), `${medidas.frente.alto.toFixed(2)} mm`);
  revisar('el reverso mide 54 mm de ancho', casi(medidas.reverso.ancho, 54), `${medidas.reverso.ancho.toFixed(2)} mm`);
  revisar('el reverso mide 86 mm de alto', casi(medidas.reverso.alto, 86), `${medidas.reverso.alto.toFixed(2)} mm`);
  // El QR de 20 mm es el cambio principal del documento de modificaciones
  // (punto 1.2), y la tolerancia de 0,3 mm la fija el punto 7.1
  revisar('el recuadro del QR mide 20 mm de ancho', casi(medidas.qr.ancho, 20, 0.3), `${medidas.qr.ancho.toFixed(2)} mm`);
  revisar('el recuadro del QR mide 20 mm de alto', casi(medidas.qr.alto, 20, 0.3), `${medidas.qr.alto.toFixed(2)} mm`);
  revisar('la barra inferior mide 21,6 mm de alto', casi(medidas.barra.alto, 21.6, 0.3), `${medidas.barra.alto.toFixed(2)} mm`);

  /**
   * Las proporciones del reverso (punto 2 de las modificaciones).
   *
   * No son adorno: son el sitio que se le quitó al logo y a la firma para que
   * la barra de 21,6 mm quepa en los mismos 86 mm de tarjeta. Si alguien las
   * devuelve a lo de antes, el QR vuelve a salirse por el borde y deja de
   * leerse, que es lo que esta prueba midió cuando el cambio 1 iba solo.
   */
  revisar('el logo del anverso sigue en 22,5 mm (punto 2.5)',
    casi(medidas.logoFrente.ancho, 22.5, 0.3), `${medidas.logoFrente.ancho.toFixed(2)} mm`);
  revisar('el logo del reverso mide 11 mm',
    casi(medidas.logoReverso.ancho, 11, 0.3), `${medidas.logoReverso.ancho.toFixed(2)} mm`);
  revisar('la firma mide 24 mm de ancho',
    casi(medidas.firmaAncho, 24, 0.3), `${medidas.firmaAncho.toFixed(2)} mm`);
  revisar('y se apoya a 3,4 mm del borde de su bloque',
    casi(medidas.firmaApoyo, 3.4, 0.3), `${medidas.firmaApoyo.toFixed(2)} mm`);
  revisar('la columna de texto de la barra no pasa de 26,5 mm',
    medidas.barraTxt.ancho <= 26.5 + 0.3, `${medidas.barraTxt.ancho.toFixed(2)} mm`);

  /**
   * Y el QR, entero dentro de la tarjeta.
   *
   * Es la comprobación que de verdad importa del punto 1.6: no basta con que
   * el recuadro mida 20 mm si un trozo queda fuera del papel. Un código al que
   * le falta un pedazo no se lee, y en pantalla no se nota.
   */
  const qrDentro = Math.min(
    medidas.qr.top - medidas.reverso.top,
    (medidas.reverso.top + medidas.reverso.alto) - (medidas.qr.top + medidas.qr.alto)
  );
  revisar('el QR queda entero dentro de la tarjeta', qrDentro >= -0.1,
    qrDentro >= 0 ? `${qrDentro.toFixed(2)} mm de margen` : `se sale ${Math.abs(qrDentro).toFixed(2)} mm`);

  // La pieza entera: dos caras de 86 mm, una encima de la otra
  revisar('la pieza plegable mide 54 mm de ancho', casi(medidas.pieza.ancho, 54, 1.5), `${medidas.pieza.ancho.toFixed(2)} mm`);
  revisar('y 172 mm de alto: dos caras de 86', casi(medidas.pieza.alto, 172, 1.5), `${medidas.pieza.alto.toFixed(2)} mm`);
  // Y el pliegue cae justo en el medio: es lo que hace que al doblar calcen
  const pliegue = medidas.frente.top - medidas.pieza.top;
  revisar('el pliegue cae al centro de la pieza', casi(pliegue, 86, 1.5), `a ${pliegue.toFixed(2)} mm del borde`);
  // El reverso va arriba y el anverso abajo (punto 11.3)
  revisar('el reverso va arriba y el anverso abajo', medidas.reverso.top < medidas.frente.top,
    `reverso a ${medidas.reverso.top.toFixed(1)} mm, anverso a ${medidas.frente.top.toFixed(1)} mm`);

  const girado = await pagina.evaluate(() => {
    const el = document.querySelector('.pieza-reverso .card');
    return el ? getComputedStyle(el).transform : '';
  });
  // Una rotación de 180° es la matriz (-1, 0, 0, -1)
  revisar('el reverso sale girado 180°, para que al doblar quede derecho',
    /matrix\(-1,\s*0,\s*0,\s*-1/.test(girado.replace(/\s/g, ' ')), girado || '(sin transformación)');

  /* 2 · El código QR ------------------------------------------------------ */
  console.log('\n2 · El código QR');
  const impresion = await pagina.evaluate(async (cred) => {
    const r = await api('GET', `/credenciales/${cred}/impresion`);
    return { qr: r.qr, serie: (r.credencial || {}).serie_completa || '' };
  }, id);
  const qr = impresion.qr;
  const serieEsperada = impresion.serie;
  revisar('se genera', qr.hay === true, qr.hay ? `${qr.modulos} módulos` : `falta ${(qr.falta || []).join(', ')}`);
  revisar('cada módulo mide 0,25 mm o más', qr.mm_por_modulo >= 0.25, `${qr.mm_por_modulo} mm por módulo`);
  revisar('no pasa de 57 módulos', qr.modulos <= 57, `${qr.modulos} módulos`);
  // Punto 1.4 y 7.4: con 20 mm de recuadro el contenido viaja completo
  revisar('el contenido va sin abreviar', qr.nivel === 0, `nivel de acortado ${qr.nivel}`);

  /* 3 · Ningún texto se sale de su recuadro ------------------------------- */
  console.log('\n3 · Los textos, dentro de su recuadro');
  const salidos = await pagina.evaluate(() =>
    [...document.querySelectorAll('.valor, .rval, .titulo, .cat-iglesia')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('dos-lineas'))
      .map((el) => `${el.className}: «${el.textContent.trim()}» (${el.scrollWidth} > ${el.clientWidth})`)
  );
  revisar('ninguno se sale', salidos.length === 0, salidos.join(' · '));

  const desborde = await pagina.evaluate(() => {
    const salidas = [];
    for (const cara of document.querySelectorAll('.card')) {
      const c = cara.getBoundingClientRect();
      for (const el of cara.querySelectorAll('.valor, .rval, .titulo, .datos, .rdatos, .barra')) {
        // Lo que no se dibuja no se sale de ninguna parte. Un campo opcional
        // que va vacío se esconde al imprimir, y entonces su rectángulo son
        // cuatro ceros: no está fuera de la tarjeta, no está en ningún lado.
        // Sin esta línea la prueba lo acusaba de salirse por la izquierda.
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        /**
         * Los CUATRO bordes, y el de arriba no es adorno.
         *
         * Esta comprobación miraba la derecha, la izquierda y abajo, pero no
         * arriba. Y el reverso se imprime GIRADO 180°: lo que en el diseño se
         * sale por abajo aparece en pantalla saliéndose por arriba. Medido: la
         * barra del QR se salía 1,77 mm de la tarjeta —casi un milímetro del
         * código quedaba cortado— y esta prueba la daba por buena.
         */
        if (r.right > c.right + 1 || r.left < c.left - 1
            || r.bottom > c.bottom + 1 || r.top < c.top - 1) {
          salidas.push(el.className + ': «' + el.textContent.trim().slice(0, 24) + '»');
        }
      }
    }
    return salidas;
  });
  revisar('ninguno se sale de la tarjeta', desborde.length === 0, desborde.join(' · '));

  /* 4 · La fotografía, encuadrada como se guardó ------------------------- */
  /**
   * El punto 6.4 pide que el encuadre se guarde «para que al reimprimir salga
   * idéntica». Eso solo vale si la pantalla de impresión pinta la foto con los
   * mismos cinco números con que se encuadró, y del mismo modo.
   *
   * Lo segundo es lo que se escapa: la primera versión de esta pantalla ponía
   * la foto al 100 % del ancho del recuadro, sin tener en cuenta la proporción
   * de la imagen. Una foto apaisada quedaba con dos franjas blancas dentro del
   * marco dorado, y el encuadre elegido no era el que salía impreso.
   */
  console.log('\n4 · La fotografía, con el encuadre guardado (punto 6.4)');
  const foto = await pagina.evaluate(async (cred) => {
    const guardada = await api('GET', `/credenciales/${cred}`);
    if (!guardada.snap_foto) return { sinFoto: true };
    const caja = document.getElementById('credFoto');
    const capa = document.getElementById('credFotoCapa');
    const marco = caja.getBoundingClientRect();
    const puesto = getComputedStyle(capa);
    // El tamaño natural de la imagen, para saber cuánto ocupa ya pintada
    const natural = await new Promise((listo) => {
      const im = new Image();
      im.onload = () => listo({ ancho: im.naturalWidth, alto: im.naturalHeight });
      im.onerror = () => listo({ ancho: 0, alto: 0 });
      im.src = capa.style.backgroundImage.replace(/^url\("?|"?\)$/g, '');
    });
    const porcentaje = parseFloat(puesto.backgroundSize) || 0;
    const anchoPintado = (porcentaje / 100) * marco.width;
    return {
      guardada,
      posicion: puesto.backgroundPosition,
      filtro: puesto.filter,
      anchoPintado,
      altoPintado: natural.ancho ? anchoPintado * (natural.alto / natural.ancho) : 0,
      marco: { ancho: marco.width, alto: marco.height },
      hayFantasma: !!(document.getElementById('credFotoGhost') || {}).style?.backgroundImage,
    };
  }, id);

  if (foto.sinFoto) {
    console.log('   — esta credencial no tiene fotografía; no hay encuadre que comprobar');
  } else {
    const g = foto.guardada;
    revisar('la posición es la que se guardó',
      foto.posicion === `${g.foto_x}% ${g.foto_y}%`,
      `${foto.posicion} · guardado ${g.foto_x}% ${g.foto_y}%`);
    /**
     * El navegador devuelve el filtro ya normalizado —`brightness(1.3)` y no
     * `brightness(130%)`—, así que se comparan los números y no el texto.
     */
    const [brilloPuesto, contrastePuesto] = (foto.filtro.match(/[\d.]+/g) || []).map(Number);
    revisar('el brillo y el contraste son los que se guardaron',
      Math.abs(brilloPuesto * 100 - g.foto_brillo) < 0.5 && Math.abs(contrastePuesto * 100 - g.foto_contraste) < 0.5,
      `${foto.filtro} · guardado brillo ${g.foto_brillo} %, contraste ${g.foto_contraste} %`);
    // Y lo que se rompía sin darse cuenta: que no quede papel a la vista
    revisar('la foto cubre todo el recuadro, sin blancos',
      foto.anchoPintado >= foto.marco.ancho - 0.5 && foto.altoPintado >= foto.marco.alto - 0.5,
      `pintada ${foto.anchoPintado.toFixed(1)} × ${foto.altoPintado.toFixed(1)} px en un recuadro de ${foto.marco.ancho.toFixed(1)} × ${foto.marco.alto.toFixed(1)}`);
    revisar('el reverso lleva la foto fantasma (punto 6.5)', foto.hayFantasma === true);
  }

  /* 4 bis · El logo, el sello y la firma conservan su transparencia -------- */
  /**
   * Los tres recursos institucionales se suben por Configuración, y ahí el
   * sistema achica las imágenes antes de mandarlas. Esa reducción pasaba TODO
   * a JPEG, y el JPEG no sabe de transparencia: rellenaba lo transparente con
   * blanco.
   *
   * En una foto de un miembro da igual. Acá no: el sello va cruzado sobre la
   * fotografía del titular y la firma sobre la línea de firma. Con el fondo
   * relleno, el sello tapaba media cara con un cuadrado blanco.
   *
   * Se comprueba sobre la misma función que corre al subir, con una imagen que
   * tiene un agujero en el medio.
   */
  console.log('\n4 bis · La transparencia del logo, el sello y la firma');
  const transparencia = await pagina.evaluate(async () => {
    /** Un cuadrado de color con un agujero transparente en el medio. */
    const conAgujero = async () => {
      const cv = document.createElement('canvas');
      cv.width = 2000; cv.height = 2000;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#14204C';
      ctx.fillRect(0, 0, 2000, 2000);
      ctx.clearRect(500, 500, 1000, 1000);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      return new File([blob], 'sello.png', { type: 'image/png' });
    };

    const sale = await reducirImagen(await conAgujero());
    const bitmap = await createImageBitmap(sale.file);
    const cv = document.createElement('canvas');
    cv.width = bitmap.width; cv.height = bitmap.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // El píxel del centro, que era el agujero
    const medio = ((Math.floor(cv.height / 2) * cv.width) + Math.floor(cv.width / 2)) * 4;
    return { tipo: sale.file.type, nombre: sale.file.name, alfaDelAgujero: px[medio + 3] };
  });
  revisar('una imagen con transparencia no se pasa a JPEG',
    transparencia.tipo === 'image/png', `salió como ${transparencia.tipo} (${transparencia.nombre})`);
  revisar('y el agujero sigue siendo transparente después de subirla',
    transparencia.alfaDelAgujero < 16,
    `el centro quedó con opacidad ${transparencia.alfaDelAgujero} de 255`);

  /* 5 · El PDF de verdad -------------------------------------------------- */
  console.log('\n5 · El PDF, tamaño Carta');
  const pdf = path.join(carpeta, 'credencial.pdf');
  await pagina.pdf({
    path: pdf, format: 'Letter', printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });
  const bytes = fs.readFileSync(pdf);
  revisar('se generó', bytes.length > 1000, `${(bytes.length / 1024).toFixed(0)} KB`);

  // Cuántas páginas trae, leídas del propio PDF
  const paginas = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  revisar('tiene UNA sola página', paginas === 1, `${paginas} página(s)`);

  // Y de qué tamaño es esa página
  const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(bytes.toString('latin1'));
  if (mediaBox) {
    const ancho = (mediaBox[3] - mediaBox[1]) * MM_POR_PUNTO;
    const alto = (mediaBox[4] - mediaBox[2]) * MM_POR_PUNTO;
    revisar('la página es tamaño Carta', casi(ancho, 215.9, 1) && casi(alto, 279.4, 1),
      `${ancho.toFixed(1)} × ${alto.toFixed(1)} mm`);
  } else {
    revisar('se pudo leer el tamaño de la página', false, 'sin MediaBox');
  }

  /* 6 · El QR, leído del papel ------------------------------------------- */
  /**
   * Hasta aquí el QR se dio por bueno porque el servidor decía que lo había
   * generado. Eso no es leerlo. Acá el PDF se convierte en píxeles a 300
   * puntos por pulgada —la resolución de una impresora de oficina— y se le
   * pasa un lector de QR por encima, como haría un teléfono (punto 18.3).
   */
  console.log('\n6 · El QR, rasterizado a 300 ppp y leído');
  const hoja = await papel.rasterizar(pdf, 300);
  revisar('la hoja se rasterizó a 300 ppp', hoja.ancho > 2000 && hoja.alto > 2000,
    `${hoja.ancho} × ${hoja.alto} píxeles`);

  const leidoNitido = papel.leer(hoja);
  revisar('el código se lee', !!leidoNitido, leidoNitido ? leidoNitido.texto : 'no se pudo decodificar');

  if (leidoNitido) {
    // Lo que se leyó tiene que ser lo mismo que el servidor dijo que iba a imprimir
    revisar('dice exactamente lo que tenía que decir', leidoNitido.texto === qr.texto,
      leidoNitido.texto === qr.texto ? leidoNitido.texto : `leído «${leidoNitido.texto}» ≠ esperado «${qr.texto}»`);
    revisar('trae el número de serie de esta credencial', leidoNitido.texto.includes(serieEsperada),
      `busca «${serieEsperada}»`);

    // El tamaño del módulo, medido sobre la tinta y no sobre la hoja de estilos
    revisar('cada módulo mide 0,25 mm o más SOBRE EL PAPEL', leidoNitido.mm_por_modulo >= 0.25,
      `${leidoNitido.mm_por_modulo.toFixed(4)} mm por módulo · ${leidoNitido.modulos} módulos en ${leidoNitido.ancho_mm.toFixed(2)} mm`);
    /**
     * Y lo medido tiene que coincidir con lo que el servidor anuncia.
     *
     * Si no coinciden es que la hoja de estilos y el servidor dejaron de decir
     * lo mismo del recuadro del QR —su ancho o su relleno—, y entonces el
     * número con que se decide si un código pasa el mínimo es un número
     * inventado. Ya pasó una vez: el servidor repartía los milímetros completos
     * ignorando el relleno de cada lado, y anunciaba un módulo más grande del
     * que salía impreso.
     */
    const desvio = Math.abs(leidoNitido.mm_por_modulo - qr.mm_por_modulo) / qr.mm_por_modulo;
    revisar('el tamaño que anuncia el servidor es el que sale impreso', desvio < 0.03,
      `impreso ${leidoNitido.mm_por_modulo.toFixed(4)} mm · anunciado ${qr.mm_por_modulo} mm · ${(desvio * 100).toFixed(1)} % de diferencia`);
    revisar('el lector cuenta los mismos módulos que el servidor', leidoNitido.modulos === qr.modulos,
      `${leidoNitido.modulos} leídos, ${qr.modulos} anunciados`);
  }

  /**
   * Y ahora con la tinta corrida.
   *
   * Una impresora de inyección sobre papel común no deja el punto donde lo
   * puso: el papel absorbe la tinta y la mancha se expande. En un QR eso es lo
   * que mata la lectura, porque los módulos negros se comen el blanco que los
   * separa. Se le pasa un desenfoque de 0,12 mm —alrededor de un tercio de
   * módulo— y tiene que seguir leyéndose lo mismo (punto 15.6).
   */
  const corrida = papel.desenfocar(hoja, 0.12);
  const leidoBorroso = papel.leer(corrida);
  revisar('sigue leyéndose con la tinta corrida 0,12 mm', !!leidoBorroso,
    leidoBorroso ? `${corrida.radio_px} píxel(es) de desenfoque` : 'no se pudo decodificar');
  if (leidoBorroso && leidoNitido) {
    revisar('y dice lo mismo que en limpio', leidoBorroso.texto === leidoNitido.texto,
      leidoBorroso.texto);
  }

  /* 7 · Los casos difíciles de la prueba 15.4 ----------------------------- */
  /**
   * El nombre largo y el nombre con tildes.
   *
   * Se escriben sobre la tarjeta ya dibujada y se vuelve a correr el mismo
   * ajuste que corre el sistema, que es exactamente lo que va a pasar el día
   * que se emita una credencial a alguien que se llame así. Después se mide.
   *
   * Va al final a propósito: esto ensucia la tarjeta, y el PDF ya está tomado.
   */
  console.log('\n7 · Nombres largos y con tildes (punto 15.4)');
  const CASOS = [
    { como: 'un nombre larguísimo', nombres: 'Jose Miguel Alejandro', apellidos: 'Fernandez de la Torre Etchegoyen' },
    { como: 'tildes y eñes', nombres: 'José Ramón', apellidos: 'Muñoz Peña' },
    { como: 'las dos cosas juntas', nombres: 'José Miguel Alejandro Ramón', apellidos: 'Fernández de la Torre Etchegoyen Muñoz' },
  ];
  for (const caso of CASOS) {
    const salidas = await pagina.evaluate((c) => {
      const campos = document.querySelectorAll('.frente .campo-destacado .valor');
      if (campos.length < 2) return { error: 'no se encontraron los campos de nombre' };
      campos[0].textContent = c.nombres;
      campos[1].textContent = c.apellidos;
      // El mismo ajuste que corre el sistema al pintar la credencial
      document.querySelectorAll('.valor, .rval, .titulo').forEach((el) => ajustarAlAncho(el));

      const fuera = [];
      for (const cara of document.querySelectorAll('.card')) {
        const caja = cara.getBoundingClientRect();
        for (const el of cara.querySelectorAll('.valor, .rval, .titulo, .cat-iglesia')) {
          if (!el.getClientRects().length) continue; // escondido: no se dibuja
          const r = el.getBoundingClientRect();
          if (r.right > caja.right + 1 || r.left < caja.left - 1 || r.bottom > caja.bottom + 1) {
            fuera.push(`se sale de la tarjeta: ${el.className} «${el.textContent.trim().slice(0, 30)}»`);
          }
          if (el.scrollWidth > el.clientWidth + 1) {
            fuera.push(`no cabe en su recuadro: ${el.className} «${el.textContent.trim().slice(0, 30)}» (${el.scrollWidth} > ${el.clientWidth})`);
          }
        }
      }

      /**
       * Y que no pise nada, que es la otra mitad del punto 15.4.
       *
       * Un apellido larguísimo puede caber a lo ancho porque se partió en dos
       * líneas y aun así montarse sobre la fila de abajo: se sale de su lugar
       * sin salirse de la tarjeta, y mirando solo el ancho no se nota.
       */
      const filas = [...document.querySelectorAll('.frente .campo, .frente .foto, .frente .barra')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((f) => f.r.height > 0.5);
      for (let i = 0; i < filas.length; i++) {
        for (let j = i + 1; j < filas.length; j++) {
          const a = filas[i];
          const b = filas[j];
          // Se ignoran los que uno contiene al otro: ahí no hay pisada
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const seTocan = a.r.left < b.r.right - 0.5 && b.r.left < a.r.right - 0.5
            && a.r.top < b.r.bottom - 0.5 && b.r.top < a.r.bottom - 0.5;
          if (seTocan) {
            fuera.push(`se pisan: «${a.el.textContent.trim().slice(0, 20)}» y «${b.el.textContent.trim().slice(0, 20)}»`);
          }
        }
      }
      // Y que no se haya perdido ninguna letra por el camino
      const puestos = { nombres: campos[0].textContent, apellidos: campos[1].textContent };
      return { fuera, puestos };
    }, caso);

    if (salidas.error) { revisar(caso.como, false, salidas.error); continue; }
    revisar(`${caso.como}: no se sale ni se pisa nada`, salidas.fuera.length === 0, salidas.fuera.join(' · '));
    revisar(`${caso.como}: no se cortó ninguna letra`,
      salidas.puestos.nombres === caso.nombres && salidas.puestos.apellidos === caso.apellidos,
      `«${salidas.puestos.nombres} ${salidas.puestos.apellidos}»`);
  }

  /**
   * Y el Cargo vacío (punto 15.5): su fila no se imprime y las demás se
   * reparten el espacio que dejó.
   */
  console.log('\n8 · El Cargo vacío (punto 15.5)');
  const sinCargo = await pagina.evaluate(() => {
    const fila = document.querySelector('.frente .campo-opcional');
    const datos = document.querySelector('.frente .datos');
    if (!fila || !datos) return { error: 'no está la fila del Cargo' };
    const antes = datos.getBoundingClientRect().height;
    fila.classList.add('vacio');
    datos.classList.add('sin-cargo');
    const r = fila.getBoundingClientRect();
    return {
      alto: r.height,
      visible: getComputedStyle(fila).display !== 'none' && r.height > 0.5,
      altoDatos: datos.getBoundingClientRect().height,
      antes,
    };
  });
  if (sinCargo.error) revisar('la fila del Cargo desaparece', false, sinCargo.error);
  else {
    revisar('la fila del Cargo no se imprime cuando va vacía', !sinCargo.visible,
      `${sinCargo.alto.toFixed(1)} px de alto`);
    revisar('los demás campos se reparten el espacio', Math.abs(sinCargo.altoDatos - sinCargo.antes) < 2,
      `el bloque de datos sigue midiendo ${sinCargo.altoDatos.toFixed(0)} px`);
  }

  console.log(`\n   El PDF quedó en ${pdf}`);
  console.log(`   errores de consola: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
  if (errores.length) fallas++;

  await navegador.close();

  console.log('');
  if (fallas) {
    console.error(`❌ ${fallas} comprobación(es) fallaron.`);
    process.exit(1);
  }
  console.log('✅ La credencial sale del tamaño que tiene que salir.');
})();
