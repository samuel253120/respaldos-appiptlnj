/**
 * El certificado sale en el papel que se eligió, y en UNA hoja.
 *
 * POR QUÉ EXISTE ESTA SUITE. Un certificado se firma, se sella y se entrega.
 * Si sale en el papel equivocado no se puede corregir: hay que rehacerlo. Y
 * son dos papeles distintos, con dos maneras de fallar que no se ven en la
 * pantalla:
 *
 *   CARTA      21,6 × 27,9 cm
 *   CIRCULAR   21,6 × 33 cm — la hoja larga. En algunas impresoras aparece
 *              como «Oficio» o «Folio»: es la misma.
 *
 *   · EL TAMAÑO. Si la página que se le declara a la impresora no es la del
 *     formato, la impresora achica la hoja para que entre: el marco queda
 *     corrido, los márgenes cambiados y el certificado más chico de lo que se
 *     diseñó. Se ve recién en el papel.
 *   · LA SEGUNDA HOJA EN BLANCO. Una caja de «279mm» se redondea a un pelo más
 *     que la página de 279 mm, y ese pelo manda todo a una segunda hoja vacía.
 *     Salía en los cuatro tamaños: cuatro hojas gastadas por certificado.
 *
 * Se revisa sobre el PDF de verdad —el que produce el mismo motor de impresión
 * del navegador— y no sobre el HTML: es lo único que dice de qué tamaño quedó
 * la página.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   URL=http://localhost:4314 npm run papel
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';

/** Las medidas que manda el servidor, para no escribirlas dos veces acá. */
const { HOJAS, SIEMPRE_APAISADAS } = require('../server/modules/formatos_certificado');

let bien = 0;
const mal = [];
const revisar = (queSeEspera, condicion, detalle) => {
  if (condicion) { bien++; console.log(`   ✅ ${queSeEspera}`); return; }
  mal.push(queSeEspera);
  console.log(`   ❌ ${queSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
};

let TOKEN = '';
/** El día de hoy en la zona horaria que tiene configurada el servidor. */
async function hoyDelServidor() {
  try {
    const config = await api('GET', '/configuracion');
    const buscar = (o) => {
      if (Array.isArray(o)) return o.map(buscar).find(Boolean);
      if (o && typeof o === 'object') {
        if (o.clave === 'zona_horaria') return o.valor;
        return Object.values(o).map(buscar).find(Boolean);
      }
      return null;
    };
    const zona = buscar(config);
    if (zona) return new Intl.DateTimeFormat('sv-SE', { timeZone: zona }).format(new Date());
  } catch (e) {
    // sin poder preguntarla, la del computador es mejor que nada
  }
  return new Intl.DateTimeFormat('sv-SE').format(new Date());
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`${URL}/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let dato; try { dato = JSON.parse(texto); } catch (e) { dato = texto; }
  if (!r.ok) throw new Error((dato && dato.error) || texto.slice(0, 300));
  return dato;
}

/** De qué tamaño quedó la página del PDF, en milímetros, y cuántas hay. */
function medirElPdf(archivo) {
  let salida;
  try {
    salida = execFileSync('python3', ['-c', `
import pypdfium2 as p
d = p.PdfDocument(${JSON.stringify(archivo)})
print(round(d[0].get_width() * 25.4 / 72), round(d[0].get_height() * 25.4 / 72), len(d))
`]).toString().trim().split(/\s+/);
  } catch (e) {
    throw new Error(
      'para medir la página del PDF hace falta pypdfium2:  pip install pypdfium2\n' +
      `   (${String(e.message).split('\n')[0]})`
    );
  }
  return { ancho: Number(salida[0]), alto: Number(salida[1]), hojas: Number(salida[2]) };
}

/**
 * Cuánto del alto de la página ocupa el texto, de 0 a 1.
 *
 * La hoja del certificado se estira al alto del papel y baja las firmas al pie.
 * Si esa cadena de alturas se corta, el diseño no revienta ni gana una página:
 * se apelotona a media hoja y las firmas suben. Medido sobre el mismo
 * certificado: con la cadena puesta el texto va del 9 % al 81 % del alto; sin
 * ella, del 46 % al 80 %, y abajo quedan diez centímetros en blanco. El PDF
 * seguía midiendo lo mismo y saliendo en una hoja, así que ni el tamaño ni el
 * número de hojas lo delataban. Por eso se mide también dónde cae el texto.
 */
function cuantoDelAltoOcupaElTexto(archivo) {
  const salida = execFileSync('python3', ['-c', `
import pypdfium2 as p
d = p.PdfDocument(${JSON.stringify(archivo)})
pg = d[0]; tp = pg.get_textpage()
cajas = [tp.get_charbox(i) for i in range(tp.count_chars())]
alto = pg.get_height()
print(round((max(c[3] for c in cajas) - min(c[1] for c in cajas)) / alto, 3) if cajas else 0)
`]).toString().trim();
  return Number(salida);
}

/** Todo el texto del PDF, para saber si algo se quedó fuera del papel. */
function loQueDiceElPdf(archivo) {
  return execFileSync('python3', ['-c', `
import pypdfium2 as p
d = p.PdfDocument(${JSON.stringify(archivo)})
print(chr(10).join(x.get_textpage().get_text_range() for x in d))
`]).toString();
}

(async () => {
  console.log('\n📄 El papel de los certificados\n');
  TOKEN = (await api('POST', '/auth/login', { usuario: RUT, password: CLAVE })).token;

  const iglesia = (await api('GET', '/iglesias?limit=1')).rows[0];
  if (!iglesia) throw new Error('no hay ninguna iglesia registrada');

  /*
   * Cada disposición con un certificado que la llene de verdad. Uno a medias
   * cabría en cualquier hoja y la prueba no diría nada: lo que se revisa es
   * que la hoja completa entre.
   */
  /*
   * El día de hoy EN LA ZONA DEL SERVIDOR, no en la del computador que corre
   * la prueba.
   *
   * `toISOString()` da siempre la fecha en UTC. El servidor anota con la zona
   * que la institución tenga configurada, y valida que una fecha de emisión no
   * venga del futuro. Con una zona al oeste de Greenwich —America/Santiago,
   * que es la de fábrica— las dos no coinciden entre la medianoche UTC y la
   * medianoche de allá: la prueba mandaba el día siguiente y el servidor lo
   * rechazaba con razón. Fallaba todos los días durante esas horas y ninguna
   * de las dos partes estaba mala.
   */
  const HOY = await hoyDelServidor();
  const CASOS = [
    ['Membresía', { nombre_titular: 'Nombre Completo De Prueba Apellido' }],
    ['Presentación de niños', {
      nombre_titular: 'Erick Kalem Aaron Solar Alfaro',
      fecha_nacimiento: '2018-10-06', fecha_evento: HOY,
      padre: 'José Luis Aaron Solar Vergara', madre: 'Camila Francisca Alfaro Aguayo',
      padrino_1: 'Dangelo Alejandro Reyes Quilodrán', madrina_1: 'Alondra Denisse Solar Vergara',
      padrino_2: 'Gustavo Esteban Alfaro Vergara', madrina_2: 'Nicole Andrea Alfaro Aguayo',
    }],
    ['Matrimonio', {
      nombre_titular: 'Juan Andrés Pérez Muñoz', conyuge: 'María Fernanda Rojas Silva',
      fecha_evento: HOY,
    }],
  ];

  const marca = Date.now().toString().slice(-6);
  const suyos = [];
  for (const [tipo, datos] of CASOS) {
    const formato = (await api(`GET`, `/formatos_certificado?limit=100`))
      .rows.find((f) => f.nombre === tipo);
    if (!formato) { console.log(`   (no hay formato «${tipo}»: se salta)`); continue; }
    const cert = await api('POST', '/certificados', {
      numero: `PAPEL-${marca}-${suyos.length + 1}`, tipo, iglesia_id: iglesia.id,
      fecha_emision: HOY, ...datos,
    });
    suyos.push({ tipo, cert, formatoId: formato.id });
  }

  const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const pagina = await navegador.newPage({ viewport: { width: 1500, height: 1100 } });
  const reventones = [];
  pagina.on('pageerror', (e) => reventones.push(e.message));

  await pagina.goto(URL);
  await pagina.fill('#loginRut', RUT);
  await pagina.fill('#loginPass', CLAVE);
  await pagina.click('#loginForm button[type=submit], #loginForm .btn');
  await pagina.waitForSelector('.topbar', { timeout: 30000 });

  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'papel-'));
  const ir = async (h) => {
    await pagina.evaluate((x) => { location.hash = x; }, h);
    await pagina.waitForTimeout(350);
  };

  for (const { tipo, cert, formatoId } of suyos) {
    console.log(`\n── ${tipo}`);
    for (const papel of Object.keys(HOJAS)) {
      for (const pedida of ['Vertical', 'Horizontal']) {
        // Se relee antes de guardar: el sistema avisa si otro tocó la ficha
        const antes = await api('GET', `/formatos_certificado/${formatoId}`);
        await api('PUT', `/formatos_certificado/${formatoId}`, { ...antes, tamano_hoja: papel, orientacion: pedida });

        /*
         * Lo que se imprime es lo que el servidor GUARDÓ, no lo que se le
         * pidió. La presentación de niños y el matrimonio van siempre a lo
         * ancho —están hechas así—, y si se les pide de pie el servidor las
         * corrige. La prueba lee lo que quedó y comprueba el papel contra eso;
         * y de paso deja anotado que la corrección ocurrió.
         */
        const quedo = (await api('GET', `/formatos_certificado/${formatoId}`)).orientacion;
        if (SIEMPRE_APAISADAS.includes(antes.disposicion) && pedida === 'Vertical') {
          revisar(`${tipo} no se puede poner de pie: está hecho a lo ancho`, quedo === 'Horizontal',
            `quedó «${quedo}»`);
        }

        await ir('#/m/certificados');
        await ir(`#/print/certificados/${cert.id}`);
        await pagina.waitForSelector('.cert-sheet', { timeout: 25000 });
        await pagina.waitForTimeout(250);

        const archivo = path.join(carpeta, `${tipo}-${papel}-${pedida}.pdf`);
        fs.writeFileSync(archivo, await pagina.pdf({ preferCSSPageSize: true, printBackground: true }));
        const hoja = medirElPdf(archivo);

        const deLado = quedo === 'Horizontal';
        const ancho = deLado ? HOJAS[papel].alto : HOJAS[papel].ancho;
        const alto = deLado ? HOJAS[papel].ancho : HOJAS[papel].alto;
        revisar(
          `${papel} ${quedo.toLowerCase()}: la página mide ${ancho} × ${alto} mm`,
          hoja.ancho === ancho && hoja.alto === alto,
          `salió de ${hoja.ancho} × ${hoja.alto} mm`
        );
        revisar(
          `${papel} ${quedo.toLowerCase()}: cabe en una sola hoja`,
          hoja.hojas === 1,
          hoja.hojas > 1 ? `salieron ${hoja.hojas} hojas: la de más va en blanco y se gasta igual` : ''
        );
        const ocupa = cuantoDelAltoOcupaElTexto(archivo);
        revisar(
          `${papel} ${quedo.toLowerCase()}: el certificado usa la hoja entera`,
          ocupa >= 0.6,
          `el texto ocupa el ${Math.round(ocupa * 100)} % del alto: se apelotonó en vez de bajar las firmas al pie`
        );
      }
    }
    // Se deja el formato como estaba: esta suite no cambia lo que la iglesia eligió
    const actual = await api('GET', `/formatos_certificado/${formatoId}`);
    const original = suyos.find((s) => s.formatoId === formatoId);
    await api('PUT', `/formatos_certificado/${formatoId}`, {
      ...actual,
      tamano_hoja: original.tamanoOriginal || 'Carta',
      orientacion: original.orientacionOriginal || (tipo === 'Membresía' ? 'Vertical' : 'Horizontal'),
    });
  }

  /* ------------------------------------------------------------------
   * EL SELLO DE LO ANULADO, EN EL PAPEL.
   *
   * Un certificado anulado salía impreso exactamente igual que uno válido
   * —medido en la v1.291.0—, y en la pantalla sí se marcaba: el problema
   * empezaba justo donde termina la pantalla. Por eso esta comprobación va
   * acá, sobre el PDF de verdad y no sobre el HTML: lo que importa es lo que
   * queda en el papel que alguien se lleva.
   *
   * Se prueba sobre las tres disposiciones, que son tres trozos de código
   * distintos, y con el mismo certificado antes y después de anularlo: sin el
   * «antes», una hoja que dijera «ANULADO» siempre pasaría esta prueba.
   * ------------------------------------------------------------------ */
  console.log('\n── El sello de un certificado anulado');
  /*
   * EL SELLO SE BUSCA LETRA POR LETRA, y no es capricho: va escrito con las
   * letras separadas —`letter-spacing: 3px`, para que se lea como un sello— y
   * el texto que se saca de un PDF conserva esa separación. En el papel dice
   * «ANULADO»; leído del archivo, «A N U L A D O».
   */
  const DICE_ANULADO = /A\s*N\s*U\s*L\s*A\s*D\s*O/;
  for (const { tipo, cert } of suyos) {
    await ir('#/m/certificados');
    await ir(`#/print/certificados/${cert.id}`);
    await pagina.waitForSelector('.cert-sheet', { timeout: 25000 });
    await pagina.waitForTimeout(250);
    const valido = path.join(carpeta, `anulado-${tipo}-antes.pdf`);
    fs.writeFileSync(valido, await pagina.pdf({ preferCSSPageSize: true, printBackground: true }));
    revisar(`${tipo}: mientras vale, la hoja no dice nada de anulación`,
      !DICE_ANULADO.test(loQueDiceElPdf(valido).replace(/\s+/g, ' ')));

    const antes = await api('GET', `/certificados/${cert.id}`);
    // Con `igual_asi`: desde la v1.295.0 anular PREGUNTA, y esta suite mira lo
    // que sale en el papel, no la pregunta
    await api('PUT', `/certificados/${cert.id}`, { ...antes, estado: 'Anulado', igual_asi: true });
    await ir('#/m/certificados');
    await ir(`#/print/certificados/${cert.id}`);
    await pagina.waitForSelector('.cert-sheet', { timeout: 25000 });
    await pagina.waitForTimeout(250);
    const archivo = path.join(carpeta, `anulado-${tipo}.pdf`);
    fs.writeFileSync(archivo, await pagina.pdf({ preferCSSPageSize: true, printBackground: true }));
    const dice = loQueDiceElPdf(archivo).replace(/\s+/g, ' ');

    revisar(`${tipo}: anulado, la hoja lo dice`, DICE_ANULADO.test(dice),
      'el papel salía idéntico al de uno válido');
    revisar(`${tipo}: y dice cuándo se anuló`, /fue anulado el .* y no tiene validez/.test(dice),
      dice.slice(0, 160));
    revisar(`${tipo}: las líneas de firma también lo dicen`,
      (dice.match(/Certificado anulado/g) || []).length >= 2,
      'dos rayas a secas hacen que un papel anulado parezca válido');
    revisar(`${tipo}: y sigue cabiendo en una hoja`, medirElPdf(archivo).hojas === 1);
  }

  /* ------------------------------------------------------------------
   * EL NÚMERO, SIN NADA ENCIMA.
   *
   * En un documento que se entrega, el número es lo único que lo identifica:
   * es lo que se cita cuando alguien pide una copia y lo que se busca en el
   * libro cuando hay que comprobar que se emitió. En la hoja de presentación
   * de niños iba FLOTANDO sobre la hoja —`position: absolute`—, de modo que el
   * resto de la hoja no sabía que estaba ahí y le pasaba por debajo: medido en
   * la v1.297.0, el número ocupaba de 1155 a 1294 px y el subrayado del año de
   * la fecha de emisión terminaba en 1179, así que la raya cruzaba los dígitos
   * y el número parecía tachado.
   *
   * SE MIDE LA TINTA, NO LA CAJA. Un bloque puede ocupar todo el ancho y tener
   * su texto en una esquina; comparando cajas, media hoja «se cruzaría» con la
   * otra media sin que nada se vea encima de nada. Con un Range sobre el nodo
   * de texto se obtiene lo que de verdad se pinta.
   *
   * Va sobre las TRES hojas, no solo sobre la que falló: son tres maquetas
   * distintas y el número tiene que quedar limpio en las tres.
   * ------------------------------------------------------------------ */
  console.log('\n── El número, sin nada encima');
  for (const { tipo, cert } of suyos) {
    await ir('#/m/certificados');
    await ir(`#/print/certificados/${cert.id}`);
    await pagina.waitForSelector('.cert-sheet', { timeout: 25000 });
    await pagina.waitForTimeout(250);

    const choque = await pagina.evaluate(() => {
      /** Lo que de verdad se pinta de un elemento: la tinta, no su caja. */
      const tinta = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const caja = r.getBoundingClientRect();
        r.detach && r.detach();
        return caja.width && caja.height ? caja : null;
      };
      const numero = document.querySelector('.cert-sheet .cert-no');
      if (!numero) return { sinNumero: true };
      const suya = tinta(numero);
      if (!suya) return { sinNumero: true };

      /* Contra cada hoja del árbol: los que no tienen hijos con texto propio */
      const encima = [];
      for (const el of document.querySelectorAll('.cert-sheet *')) {
        if (el === numero || numero.contains(el) || el.contains(numero)) continue;
        if (!el.textContent.trim()) continue;
        if ([...el.children].some((h) => h.textContent.trim())) continue;
        const otra = tinta(el);
        if (!otra) continue;
        const cruzan = suya.left < otra.right && otra.left < suya.right
          && suya.top < otra.bottom && otra.top < suya.bottom;
        if (cruzan) encima.push(`${el.className || el.tagName}: «${el.textContent.trim().slice(0, 40)}»`);
      }
      return { numero: numero.textContent.trim(), encima };
    });

    revisar(`${tipo}: la hoja lleva su número`, !choque.sinNumero);
    if (!choque.sinNumero) {
      revisar(`${tipo}: y nada se le viene encima`, choque.encima.length === 0,
        `se cruza con ${choque.encima.join(' · ')}`);
    }
  }

  /* ------------------------------------------------------------------
   * LA HOJA A LA QUE LE FALTA LO QUE CERTIFICA.
   *
   * El cuerpo del certificado sale de su formato, y el formato se busca por el
   * NOMBRE que el certificado guardó en «tipo». Cuando ese nombre no encuentra
   * su formato —lo renombraron—, la hoja salía con su orla, su número, el
   * nombre del titular y las dos rayas de firma, y un hueco en el medio.
   * Medido en la v1.292.0. Firmada y entregada, esa hoja parece un
   * certificado y no certifica nada.
   *
   * Se mira acá, sobre el PDF, y no en el HTML, por lo mismo que el sello de
   * anulado: lo que importa es lo que queda en el papel que alguien se lleva.
   *
   * Las dos maneras de quedarse sin texto se prueban por separado, porque la
   * hoja dice una cosa distinta en cada una:
   *
   *   · SIN FORMATO. Va sobre un certificado de mentira que se borra al
   *     terminar, y sale en la hoja clásica: sin formato no hay disposición
   *     que valga, así que esa es la única forma posible.
   *   · CON EL FORMATO EN BLANCO. Va sobre los tres de arriba, que sí tienen
   *     su disposición, y cubre las tres hojas —son tres trozos de código
   *     distintos—. El texto se devuelve al terminar.
   * ------------------------------------------------------------------ */
  console.log('\n── La hoja sin lo que certifica');
  const DICE_QUE_FALTA = /FALTA\s*EL\s*TEXTO\s*DE\s*ESTE\s*CERTIFICADO/;
  const comoSaleEnPapel = async (certId, nombre) => {
    await ir('#/m/certificados');
    await ir(`#/print/certificados/${certId}`);
    await pagina.waitForSelector('.cert-sheet', { timeout: 25000 });
    await pagina.waitForTimeout(250);
    const archivo = path.join(carpeta, `${nombre}.pdf`);
    fs.writeFileSync(archivo, await pagina.pdf({ preferCSSPageSize: true, printBackground: true }));
    return { texto: loQueDiceElPdf(archivo).replace(/\s+/g, ' '), hojas: medirElPdf(archivo).hojas };
  };

  let elHuerfano = null;
  try {
    elHuerfano = await api('POST', '/certificados', {
      numero: `PAPEL-${marca}-SIN`, tipo: 'Membresía', iglesia_id: iglesia.id,
      nombre_titular: 'Sin Formato Prueba', fecha_emision: HOY,
    });
    const conFormato = await comoSaleEnPapel(elHuerfano.id, 'falta-antes');
    revisar('con su formato, la hoja no dice que falte nada',
      !DICE_QUE_FALTA.test(conFormato.texto));
    revisar('y sí trae lo que certifica', /[Cc]ertific/.test(conFormato.texto),
      conFormato.texto.slice(0, 160));

    /*
     * Se le cambia el tipo a un nombre que ningún formato tiene: es como queda
     * un certificado cuando su formato se renombra por fuera del sistema, o el
     * día que alguien escriba ese dato a mano. Antes salía el hueco.
     */
    await api('PUT', `/certificados/${elHuerfano.id}`, { tipo: `Tipo sin formato ${marca}` });
    const huerfano = await comoSaleEnPapel(elHuerfano.id, 'falta-sin-formato');
    revisar('sin formato, la hoja DICE que le falta el texto', DICE_QUE_FALTA.test(huerfano.texto),
      'salía la orla, el número y las firmas, con un hueco donde va lo que certifica');
    revisar('y dice por qué', /No se encontró el formato/.test(huerfano.texto),
      huerfano.texto.slice(0, 200));
    revisar('y qué hacer', /Revíselo en Formatos de Certificado/.test(huerfano.texto),
      huerfano.texto.slice(0, 200));
    revisar('y sigue cabiendo en una hoja', huerfano.hojas === 1);
  } finally {
    /*
     * Con `igual_asi`, que desde la v1.294.0 borrar un certificado PREGUNTA
     * —dice qué se lleva y que el número vuelve a ofrecerse—. Sin eso, este
     * borrado contestaba 400, el `catch` se lo tragaba y la suite dejaba un
     * certificado de mentira en la iglesia cada vez que se corría.
     */
    if (elHuerfano) await api('DELETE', `/certificados/${elHuerfano.id}?igual_asi=1`).catch(() => {});
  }

  for (const { tipo, cert, formatoId } of suyos) {
    const antes = await api('GET', `/formatos_certificado/${formatoId}`);
    try {
      await api('PUT', `/formatos_certificado/${formatoId}`, { ...antes, texto: '' });
      const sinTexto = await comoSaleEnPapel(cert.id, `falta-${tipo}`);
      revisar(`${tipo}: con el formato en blanco, la hoja lo dice`, DICE_QUE_FALTA.test(sinTexto.texto),
        sinTexto.texto.slice(0, 200));
      revisar(`${tipo}: y dice que es el formato el que no tiene texto`,
        /no tiene texto escrito/.test(sinTexto.texto), sinTexto.texto.slice(0, 200));
    } finally {
      await api('PUT', `/formatos_certificado/${formatoId}`, {
        ...(await api('GET', `/formatos_certificado/${formatoId}`)), texto: antes.texto,
      });
    }
  }

  /* ------------------------------------------------------------------
   * LOS DATOS ENTRE LLAVES, EN EL PAPEL.
   *
   * El texto del formato se escribe una vez con los datos entre llaves —«el día
   * {fecha_evento}, en {iglesia}»— y cada hoja sale con lo suyo. Es la promesa
   * central de «Formatos de Certificado», y el módulo dice qué pasa si falla:
   * «un certificado entregado que diga «{fecha_evento}» hay que rehacerlo».
   *
   * NADIE LO COMPROBABA EN EL PAPEL. Apagado el relleno de la pantalla, en la
   * v1.309.0, las 3.503 pruebas del motor y las 76 comprobaciones de esta misma
   * suite seguían verdes: un certificado de membresía salía impreso diciendo
   * «Certifica que es miembro en plena comunión de {iglesia}», con su número,
   * su orla y las dos líneas de firma, listo para firmar y entregar.
   *
   * Se revisa sobre el PDF y en las TRES disposiciones, que son tres trozos de
   * código distintos: la clásica rellena de una manera y las otras dos de otra,
   * la que deja el dato subrayado como el formulario en papel.
   * ------------------------------------------------------------------ */
  console.log('\n── Los datos entre llaves, en el papel');
  for (const { tipo, cert, formatoId } of suyos) {
    const antes = await api('GET', `/formatos_certificado/${formatoId}`);
    try {
      /*
       * Un texto que usa las llaves de las tres clases: un nombre, una fecha
       * entera, la iglesia, la ciudad y una fecha partida en día, mes y año,
       * que son las que usan las hojas de presentación y de matrimonio.
       */
      await api('PUT', `/formatos_certificado/${formatoId}`, {
        ...antes,
        texto: 'Certifica que {titular}, en {iglesia}, con fecha {ev_dia} de {ev_mes} del año '
          + '{ev_anio}, y por el presente {tipo} N.º {numero} dado en {ciudad} el {fecha_emision}.',
      });
      const hoja = await comoSaleEnPapel(cert.id, `llaves-${tipo}`);

      const quedaron = hoja.texto.match(/\{\w+\}/g) || [];
      revisar(`${tipo}: no queda ninguna llave sin reemplazar en el papel`,
        quedaron.length === 0,
        quedaron.length ? `salieron impresas: ${quedaron.join(' ')}` : '');

      /*
       * Y los datos SALEN. Sin esto, un relleno que se tragara las llaves en
       * vez de reemplazarlas pasaría la comprobación de arriba con una hoja que
       * dice «Certifica que , en , con fecha  de  del año …».
       */
      const debeSalir = [
        [cert.nombre_titular, 'el nombre del titular'],
        [iglesia.nombre, 'la iglesia'],
        [cert.numero, 'el número'],
      ];
      for (const [dato, cual] of debeSalir) {
        if (!dato) continue;
        revisar(`${tipo}: sale ${cual}`, hoja.texto.includes(dato),
          `no se encontró «${dato}» en: ${hoja.texto.slice(0, 200)}`);
      }
      /*
       * El mes en letras, SOLO donde hay fecha del evento. Un certificado de
       * membresía no la lleva —dice «es miembro en plena comunión de tal
       * iglesia» y no nombra ningún día—, así que ahí {ev_mes} queda en blanco
       * con razón, que es justamente lo que la ayuda del campo promete.
       */
      if (cert.fecha_evento) {
        revisar(`${tipo}: y el mes de la fecha partida, en letras`,
          /ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE/
            .test(hoja.texto),
          hoja.texto.slice(0, 220));
      } else {
        revisar(`${tipo}: sin fecha del evento, la llave queda en blanco y no a la vista`,
          !/\{ev_/.test(hoja.texto), hoja.texto.slice(0, 220));
      }

      /*
       * LA CONTRACARA: una llave mal escrita SÍ tiene que salir a la vista.
       * Borrarla dejaría la frase coja sin decir por qué, y sin esta
       * comprobación un relleno que borrara toda llave pasaría la primera.
       */
      await api('PUT', `/formatos_certificado/${formatoId}`, {
        ...(await api('GET', `/formatos_certificado/${formatoId}`)),
        texto: 'Certifica que {titular} y algo de {loquesea}.',
      });
      const conLlaveMala = await comoSaleEnPapel(cert.id, `llave-mala-${tipo}`);
      revisar(`${tipo}: una llave que nadie conoce se imprime a la vista, para que se note`,
        /\{loquesea\}/.test(conLlaveMala.texto),
        conLlaveMala.texto.slice(0, 200));
    } finally {
      await api('PUT', `/formatos_certificado/${formatoId}`, {
        ...(await api('GET', `/formatos_certificado/${formatoId}`)), texto: antes.texto,
      });
    }
  }

  /* ------------------------------------------------------------------
   * LA CONTRACARA: que la hoja de una página no le pase a las demás.
   *
   * Lo que hace que un certificado quepa en una hoja es una regla que aprieta
   * la página al alto del papel y recorta lo que sobre. Escrita sin acotar,
   * esa regla valía para TODO lo que el sistema imprime —y como está al final
   * de la hoja de estilos, le ganaba a las demás—. La ficha de una persona con
   * su historial y su carpeta es larga por naturaleza: se imprimía la primera
   * página y el resto se perdía sin que la hoja dijera nada.
   *
   * Se revisa con una ficha llena a propósito, porque una corta cabría en una
   * página y esta comprobación no diría nada.
   * ------------------------------------------------------------------ */
  console.log('\n── La ficha larga de una persona');
  let deLaFicha = null;
  try {
    const marca = String(Date.now()).slice(-6);
    const suya = await api('POST', '/miembros', {
      nombres: 'Prueba de Papel', apellidos: `Ficha Larga ${marca}`,
      iglesia_id: iglesia.id, estado: 'Activo',
    });
    deLaFicha = suya.id;
    for (let i = 1; i <= 40; i += 1) {
      await api('POST', '/bitacora', {
        miembro_id: suya.id, tipo: 'Anotación', fecha: '2020-04-12',
        descripcion: `Anotación N.º ${i} de la ficha larga, puesta para ver hasta dónde llega el papel.`,
      });
    }
    await ir(`#/print/miembros/${suya.id}`);
    await pagina.waitForSelector('.print-generic', { timeout: 25000 });
    await pagina.waitForTimeout(400);
    const enPantalla = await pagina.evaluate(
      () => document.querySelectorAll('.print-generic table.tramite tbody tr').length
    );
    const archivo = path.join(carpeta, 'ficha-larga.pdf');
    fs.writeFileSync(archivo, await pagina.pdf({ format: 'Letter', printBackground: true }));
    const hoja = medirElPdf(archivo);
    const texto = loQueDiceElPdf(archivo);
    const enElPapel = (texto.match(/Anotación N\.º \d+ de la ficha larga/g) || []).length;

    revisar('una ficha larga se reparte en varias hojas', hoja.hojas > 1,
      `salió en ${hoja.hojas} hoja(s) para ${enPantalla} línea(s) en pantalla`);
    revisar('y no se pierde ninguna línea en el camino', enElPapel === 40,
      `en el papel salieron ${enElPapel} de 40`);
  } finally {
    if (deLaFicha) await api('DELETE', `/miembros/${deLaFicha}`).catch(() => {});
  }

  revisar('la pantalla de impresión no revienta en ningún tamaño', reventones.length === 0,
    reventones.slice(0, 2).join(' · '));

  await navegador.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
  // Y los certificados de prueba no quedan en el libro de la iglesia
  for (const { cert } of suyos) await api('DELETE', `/certificados/${cert.id}`).catch(() => {});

  console.log('\n──────────────────────────────────────────────');
  if (mal.length) {
    console.log(`   ${bien} comprobación(es) pasaron · ${mal.length} fallaron\n`);
    mal.forEach((m) => console.log(`   ❌ ${m}`));
    process.exit(1);
  }
  console.log(`   ${bien} comprobaciones pasaron\n`);
  console.log('✅ Cada certificado sale en el papel que se eligió y en una sola hoja, y la ficha larga\n   se reparte en las que haga falta sin perder nada.');
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
