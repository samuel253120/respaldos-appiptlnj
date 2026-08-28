/**
 * Que el sistema se vea bien en un teléfono. Todas las pantallas, una por una.
 *
 * Las otras suites miran si algo se rompe. Esta mira si algo se ve mal, que es
 * distinto y no lo atrapaba nada: una tarjeta cortada no tira ningún error, no
 * deja ninguna pantalla en blanco y ni siquiera hace que la página se salga de
 * lado —al contrario, muchas veces lo que la corta es justamente lo que impide
 * que se salga—. Se veía en el teléfono de alguien, y solo si alguien miraba.
 *
 * Se recorren las listas de los treinta y ocho módulos, sus formularios, sus
 * fichas con todas las pestañas, el panel, asistencia, los informes, la
 * configuración y el perfil, y de cada pantalla se miran siete cosas:
 *
 *   1. lo que se sale de la pantalla por la derecha sin que se pueda llegar
 *   2. lo que queda recortado dentro de una caja que no se puede deslizar
 *   3. el texto que no cabe en su propia caja y se corta
 *   4. dos cosas que se pisan una encima de la otra
 *   5. lo que hay que tocar y es más chico que un dedo
 *   6. el texto tan chico que no se lee
 *   7. lo que se corre de lado sin que nada avise de que sigue
 *
 * Cada una tiene su excepción legítima y está dicha en su comentario: una tabla
 * ancha que se arrastra ESTÁ BIEN si se ve que se puede arrastrar; una píldora
 * que solo dice algo no es un botón; un enlace dentro de un párrafo mide lo que
 * mide la línea. Sin esas excepciones la revisión gritaría por todo y no
 * serviría para nada.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run movil
 *   ANCHO=360 npm run movil
 *   URL=http://localhost:3000 CLAVE=… npm run movil
 *   SOLO=credenciales npm run movil     (una sola pantalla, al depurar)
 */
const { chromium } = require('playwright');
const B = process.env.URL || 'http://localhost:4314';
const ANCHO = Number(process.env.ANCHO || 390);
const CLAVE = process.env.CLAVE || 'admin123';
const RUT = process.env.RUT || '11.111.111-1';
const SOLO = process.env.SOLO || '';

const MIRAR = `
(() => {
  const V = window.innerWidth;
  const hallazgos = { salen: [], recortados: [], noCabe: [], sePisan: [], chicos: [], letraChica: [], deslizaCallado: [], tapados: [] };
  const nombre = (el) => {
    const c = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean)[0] : '';
    const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 22);
    return el.tagName.toLowerCase() + c + (t ? ' «' + t + '»' : '');
  };
  const DE_ESCRIBIR = ['INPUT', 'TEXTAREA', 'SELECT'];
  // Toda la página, no solo el contenido: la barra de arriba, el menú y el
  // panel de avisos también se ven mal si se salen, y mirando solo #content
  // esta revisión no los veía. Apareció así: en un teléfono de 320 px
  // «Cerrar sesión» se salía dieciocho píxeles y nada lo decía.
  const zona = document.body;

  /**
   * ¿Se está dibujando de verdad?
   *
   * Lo que queda fuera de una caja que desliza —los cuerpos de más abajo en la
   * lista de «Cuerpos que administra», que solo se ven al correrla— sigue
   * teniendo posición, y esa posición cae encima de los campos siguientes. No
   * está encima de nada: está recortado. Sin esto, la revisión los acusaba de
   * pisarse con el correo y con el teléfono.
   */
  const seDibuja = (el) => {
    const r = el.getBoundingClientRect();
    // Lo que está del todo fuera de la pantalla no se está viendo: el menú
    // lateral cuando está cerrado vive a la izquierda del borde, y el panel de
    // avisos arriba del techo. Nada de eso se pisa con nada ni hay que tocarlo.
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    if (r.bottom <= 0 && r.top <= 0) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const e2 = getComputedStyle(p);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(e2.overflowY)
          || ['hidden', 'clip', 'auto', 'scroll'].includes(e2.overflowX)) {
        const rp = p.getBoundingClientRect();
        if (r.bottom < rp.top + 1 || r.top > rp.bottom - 1
            || r.right < rp.left + 1 || r.left > rp.right - 1) return false;
      }
    }
    return true;
  };

  for (const el of zona.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const est = getComputedStyle(el);
    if (est.visibility === 'hidden' || est.opacity === '0') continue;

    // 1 · se sale de la pantalla SIN que se pueda llegar a ello.
    // Lo que va dentro de algo que desliza de lado —una tabla ancha, la barra
    // de pestañas— se sale a propósito y se alcanza corriendo: eso no cuenta.
    if (r.right > V + 1) {
      let desliza = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const e2 = getComputedStyle(p);
        if ((e2.overflowX === 'auto' || e2.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 2) { desliza = true; break; }
      }
      if (!desliza) hallazgos.salen.push(nombre(el) + ' hasta ' + Math.round(r.right));
    }

    // 2 · recortado dentro de una caja que no desliza
    if (!DE_ESCRIBIR.includes(el.tagName) && !el.isContentEditable
        && (est.overflowX === 'hidden' || est.overflowX === 'clip')
        && est.textOverflow !== 'ellipsis') {
      const sobra = el.scrollWidth - el.clientWidth;
      if (sobra > 4 && el.clientWidth) hallazgos.recortados.push(nombre(el) + ' esconde ' + sobra + ' px');
    }

    // 3 · el texto no cabe en su caja
    if (!el.children.length && (el.textContent || '').trim() && !DE_ESCRIBIR.includes(el.tagName)) {
      if (el.scrollWidth > el.clientWidth + 1 && est.textOverflow !== 'ellipsis' && est.overflow !== 'visible') {
        hallazgos.noCabe.push(nombre(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
      }
    }

    // 5 · lo que hay que tocar, más chico que un dedo
    // Un enlace dentro de un texto corrido no es un botón: mide lo que mide la
    // línea y agrandarlo sería romper el párrafo. Y una píldora que solo dice
    // algo —el cuerpo al que pertenece alguien, en su ficha— tampoco se toca:
    // solo cuenta la que ES un botón.
    const esEnlaceDeTexto = el.tagName === 'A' && est.display === 'inline';
    const esPildoraQuieta = el.classList.contains('chip') && !['BUTTON', 'A'].includes(el.tagName);
    const tocable = !esEnlaceDeTexto && !esPildoraQuieta
      && el.matches('button, a[href], [role=button], input[type=checkbox], input[type=radio], summary, .chip, [data-ir]');
    if (tocable && est.pointerEvents !== 'none' && !el.disabled && seDibuja(el)) {
      // Una casilla de marcar es chica por naturaleza y además se puede tocar
      // su etiqueta: se le pide menos que a un botón.
      const esCasilla = el.tagName === 'INPUT';
      const minAlto = esCasilla ? 20 : 28;
      const minAncho = esCasilla ? 20 : 22;
      const alto = r.height, ancho = r.width;
      if (alto < minAlto || ancho < minAncho) hallazgos.chicos.push(nombre(el) + ' ' + Math.round(ancho) + '×' + Math.round(alto));
    }

    // 6 · letra demasiado chica
    if (!el.children.length && (el.textContent || '').trim()) {
      const px = parseFloat(est.fontSize);
      if (px && px < 10.5) hallazgos.letraChica.push(nombre(el) + ' ' + px + 'px');
    }
  }

  // 8 · un dato TAPADO por los botones de la esquina de su tarjeta.
  // En el teléfono imprimir y borrar van pegados a la esquina —una fila entera
  // para dos botones chicos sería media pantalla desperdiciada— y eso obliga a
  // reservarles el sitio en el dato que quede debajo. Cuando la reserva se
  // queda corta, el dato no se puede leer y nada más lo delata.
  hallazgos.tapados = [];
  for (const fila of zona.querySelectorAll('table.grid-lista tbody tr')) {
    const botones = fila.querySelector('td.acciones');
    if (!botones || !botones.getClientRects().length) continue;
    const b = botones.getBoundingClientRect();
    if (!b.width) continue;
    for (const celda of fila.querySelectorAll('td:not(.acciones)')) {
      if (!celda.getClientRects().length) continue;
      const texto = celda.textContent.trim();
      if (!texto) continue;
      // Se mide el texto y no la celda: la celda ocupa todo el ancho de la
      // tarjeta aunque su dato esté a la izquierda, y eso no molesta.
      const rango = document.createRange();
      rango.selectNodeContents(celda);
      for (const rr of rango.getClientRects()) {
        if (!rr.width || !rr.height) continue;
        const dx = Math.min(rr.right, b.right) - Math.max(rr.left, b.left);
        const dy = Math.min(rr.bottom, b.bottom) - Math.max(rr.top, b.top);
        if (dx > 0 && dy > 0) {
          hallazgos.tapados.push('«' + texto.slice(0, 22) + '» (' + (celda.dataset.col || '?')
            + ') pisa ' + Math.round(dx) + '×' + Math.round(dy) + ' px');
          break;
        }
      }
    }
  }

  // 7 · algo que desliza de lado sin que nada avise de que sigue
  hallazgos.deslizaCallado = [];
  for (const el of zona.querySelectorAll('*')) {
    const est = getComputedStyle(el);
    if (est.overflowX !== 'auto' && est.overflowX !== 'scroll') continue;
    if (el.scrollWidth <= el.clientWidth + 2 || !el.clientWidth) continue;
    // Lo que ya avisa, avisa: la barra de pestañas con su velo y las tablas con
    // su sombra de borde. En los dos casos el aviso ES una imagen de fondo.
    if (el.classList.contains('pestanas')) continue;
    if (getComputedStyle(el).backgroundImage !== 'none') continue;
    hallazgos.deslizaCallado.push(nombre(el) + ' esconde ' + (el.scrollWidth - el.clientWidth) + ' px a la derecha');
  }

  // 4 · dos cosas interactivas que se pisan
  const tocables = [...zona.querySelectorAll('button, a[href], input, select, .chip')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; })
    .filter(seDibuja);
  for (let i = 0; i < tocables.length; i++) {
    for (let j = i + 1; j < tocables.length; j++) {
      const a = tocables[i], b = tocables[j];
      if (a.contains(b) || b.contains(a)) continue;
      // Un botón puesto ADENTRO de un campo, sobre el hueco que el propio
      // campo le reserva con su relleno, no tapa nada: es la crucecita que
      // vacía un selector con buscador, y así se usa en todas partes.
      const enElHueco = (x, y) => {
        if (getComputedStyle(y).position !== 'absolute') return false;
        if (!['INPUT', 'TEXTAREA'].includes(x.tagName)) return false;
        const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
        const relleno = parseFloat(getComputedStyle(x).paddingRight) || 0;
        return ry.left >= rx.right - relleno - 1;
      };
      if (enElHueco(a, b) || enElHueco(b, a)) continue;
      /**
       * Una barra pegada al borde con lo de abajo pasándole por debajo no es
       * un defecto: es para qué existe. La barra de «Guardar lista» se queda a
       * la vista mientras la lista corre detrás, con su fondo opaco tapando lo
       * que va pasando; el que queda debajo reaparece al seguir deslizando, y
       * la última fila nunca queda tapada porque la barra ocupa su lugar en el
       * texto igual que cualquier otra cosa.
       *
       * Lo que sí hay que mirar —y esta prueba lo mira— es que dos cosas de la
       * MISMA capa se pisen: ahí una tapa a la otra y no hay deslizar que lo
       * arregle.
       */
      const bajoUnaBarraPegada = (x, y) => {
        for (let e = y; e && e !== document.body; e = e.parentElement) {
          if (getComputedStyle(e).position !== 'sticky' || e.contains(x)) continue;
          /**
           * Pero solo si la barra está donde tiene que estar. Cuando la
           * tarjeta queda casi toda por debajo del borde, la barra no tiene
           * hasta dónde bajar y se apoya contra el TECHO de su tarjeta: ahí
           * deja de ser una barra pegada abajo y pasa a ser una cosa encima de
           * otra, tapando lo que haya en el encabezado. Eso sí es un defecto,
           * y es exactamente el que hubo que arreglar.
           */
          const dela = e.getBoundingClientRect();
          const suya = e.parentElement.getBoundingClientRect();
          if (Math.abs(dela.top - suya.top) <= 1) return false; // apoyada contra el techo
          return true;
        }
        return false;
      };
      if (bajoUnaBarraPegada(a, b) || bajoUnaBarraPegada(b, a)) continue;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const dx = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const dy = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (dx > 2 && dy > 2) hallazgos.sePisan.push(nombre(a) + ' ∩ ' + nombre(b));
    }
  }

  /**
   * 4b · una barra pegada abajo que puede terminar encima de un botón.
   *
   * Esto no se ve mirando la pantalla quieta: aparece solo mientras se
   * desliza, en una franja angosta, y por eso se calcula en vez de buscarlo.
   *
   * Una barra «pegada» al borde de abajo se queda a la vista mientras lo demás
   * le pasa por debajo —para eso está—, pero no puede salirse de su tarjeta:
   * cuando la tarjeta va quedando por debajo del borde de la pantalla, la
   * barra se queda sin lugar donde bajar y termina apoyada contra el TECHO de
   * su tarjeta. Ahí ya no es una barra de abajo: es una cosa encima de otra, y
   * tapa lo que haya en el encabezado. Un toque en el botón tapado se lo lleva
   * la barra. Fue exactamente lo que pasó con «Guardar lista» encima de «Todos
   * presentes»: uno creía marcar a todos y guardaba la lista en blanco.
   *
   * Se calcula dónde quedaría la barra apoyada contra el techo, y se mira si
   * ahí hay algo que se pueda tocar. No hace falta deslizar hasta verlo.
   */
  for (const barra of zona.querySelectorAll('*')) {
    const cs = getComputedStyle(barra);
    if (cs.position !== 'sticky' || cs.bottom === 'auto') continue;
    const suya = barra.parentElement;
    if (!suya) continue;
    const caja = suya.getBoundingClientRect();
    // Si la tarjeta cabe entera en la pantalla, la barra nunca se despega de
    // su lugar y no hay nada que calcular
    if (caja.height <= window.innerHeight) continue;
    /**
     * Se mide DENTRO de la tarjeta, no en la pantalla: la barra y lo que está
     * en la tarjeta se mueven juntos, así que la distancia entre ellos no
     * cambia con el deslizamiento. Apoyada contra el techo, la barra ocupa los
     * primeros píxeles de la tarjeta; lo que caiga ahí queda tapado.
     */
    const alto = barra.getBoundingClientRect().height;
    for (const el of suya.querySelectorAll('button, a[href], input, select, .chip')) {
      if (barra.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !seDibuja(el)) continue;
      const desde = r.top - caja.top, hasta = r.bottom - caja.top;
      if (Math.min(alto, hasta) - Math.max(0, desde) > 2) {
        hallazgos.sePisan.push(
          nombre(barra) + ' (pegada abajo) termina encima de ' + nombre(el) + ' al deslizar'
        );
      }
    }
  }

  for (const k of Object.keys(hallazgos)) hallazgos[k] = [...new Set(hallazgos[k])];
  return hallazgos;
})()`;

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await nav.newPage({ viewport: { width: ANCHO, height: 844 } });
  const errores = [];
  pg.on('pageerror', (e) => errores.push(e.message));
  await pg.goto(B + '/');
  await pg.fill('#loginRut', RUT);
  await pg.fill('#loginPass', CLAVE);
  await pg.click('button[type=submit]');
  await pg.waitForSelector('.topbar', { timeout: 40000 });

  const modulos = await pg.evaluate(() => MODULES.filter((m) => m.perms.view).map((m) => m.name));
  // Las pantallas propias de un módulo —el libro de la oficina de partes, la
  // bandeja de solicitudes— no cuelgan del listado de ninguno, así que sin
  // nombrarlas acá no las revisaría nadie
  const rutas = ['#/', '#/asistencia', '#/asistencia/informes', '#/documentos/libro',
    '#/solicitudes/bandeja', '#/mensajes', '#/mis-mensajes', '#/perfil', '#/config'];
  for (const m of modulos) {
    rutas.push(`#/m/${m}`, `#/m/${m}/new`);
  }

  const total = {};
  const sumar = (ruta, h) => {
    for (const [k, v] of Object.entries(h)) {
      if (!v.length) continue;
      (total[k] = total[k] || []).push({ ruta, que: v });
    }
  };

  for (const ruta of rutas) {
    if (SOLO && !ruta.includes(SOLO)) continue;
    await pg.goto(B + '/' + ruta);
    await pg.waitForTimeout(900);
    sumar(ruta, await pg.evaluate(MIRAR));
    // y la ficha del primer registro, con todas sus pestañas
    if (ruta.startsWith('#/m/') && !ruta.endsWith('/new')) {
      const id = await pg.evaluate(() => {
        const f = document.querySelector('table.grid-lista tbody tr[data-id]');
        return f ? f.dataset.id : null;
      });
      if (id) {
        const nombre = ruta.replace('#/m/', '');
        await pg.goto(`${B}/#/m/${nombre}/ficha/${id}`);
        await pg.waitForTimeout(900);
        sumar(`${ruta}/ficha`, await pg.evaluate(MIRAR));
        const pestanas = await pg.evaluate(() =>
          [...document.querySelectorAll('.pestanas [data-pestana]')].map((b) => b.dataset.pestana));
        for (const cual of pestanas) {
          await pg.click(`.pestanas [data-pestana="${cual}"]`).catch(() => {});
          await pg.waitForTimeout(650);
          sumar(`${ruta}/ficha:${cual}`, await pg.evaluate(MIRAR));
        }
        await pg.goto(`${B}/#/m/${nombre}/edit/${id}`);
        await pg.waitForTimeout(900);
        sumar(`${ruta}/edit`, await pg.evaluate(MIRAR));
      }
    }
  }

  const TITULOS = {
    salen: 'SE SALEN DE LA PANTALLA',
    recortados: 'RECORTADO SIN SALIDA',
    noCabe: 'EL TEXTO NO CABE EN SU CAJA',
    sePisan: 'DOS COSAS QUE SE PISAN',
    chicos: 'MÁS CHICO QUE UN DEDO',
    letraChica: 'LETRA DEMASIADO CHICA',
    deslizaCallado: 'DESLIZA DE LADO SIN AVISAR',
    tapados: 'UN DATO TAPADO POR LOS BOTONES',
  };
  let cuantos = 0;
  for (const [clave, titulo] of Object.entries(TITULOS)) {
    const lista = total[clave] || [];
    const n = lista.reduce((s, x) => s + x.que.length, 0);
    cuantos += n;
    console.log(`\n══ ${titulo} · ${n}`);
    for (const x of lista.slice(0, 14)) {
      console.log(`   ${x.ruta}`);
      for (const q of x.que.slice(0, 4)) console.log(`      ${q}`);
      if (x.que.length > 4) console.log(`      … y ${x.que.length - 4} más`);
    }
    if (lista.length > 14) console.log(`   … y ${lista.length - 14} pantalla(s) más`);
  }
  console.log(`\n  pantallas revisadas: ${rutas.length}+ · errores de consola: ${[...new Set(errores)].length}`);
  await nav.close();
  console.log(cuantos
    ? `\n❌ ${cuantos} cosa(s) que se ven mal en un teléfono. Están listadas arriba.`
    : `\n✅ Todas las pantallas se ven bien en un teléfono de ${ANCHO} px.`);
  process.exit(cuantos ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
