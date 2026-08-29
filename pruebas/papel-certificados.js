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
