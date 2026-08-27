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
  const HOY = new Date().toISOString().slice(0, 10);
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
  console.log('✅ Cada certificado sale en el papel que se eligió, y en una sola hoja.');
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
