/**
 * Los documentos que salen impresos, revisados sobre la hoja y no sobre el HTML.
 *
 * De este sistema salen papeles que se entregan y se firman: la ficha de un
 * miembro, un acta de reunión, un informe de asistencia que se le manda al
 * pastor supervisor. Todos tienen que identificar a la institución, decir
 * cuándo se emitieron y quién los emitió, y no llevar encima nada que sea de
 * la pantalla y no del papel.
 *
 * POR QUÉ EXISTE ESTA SUITE. El membrete estaba escrito tres veces a mano, una
 * por cada clase de hoja, y con el tiempo divergieron: las fichas y las actas
 * llevaban el RUT y el contacto de la institución, y los informes —los que más
 * salen de la iglesia— no. Nada falla cuando eso pasa: el papel sale, se ve
 * bien, y solo alguien que compare dos documentos lado a lado lo nota. Por eso
 * se revisa a máquina.
 *
 * Y se revisa CON LA IMPRESIÓN EMULADA, que es lo que decide qué se ve: media
 * print esconde cosas y muestra otras, así que mirar la pantalla normal diría
 * algo distinto de lo que sale por la impresora.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   URL=http://localhost:4314 npm run impresos
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';

let bien = 0;
const mal = [];
function revisar(loQueSeEspera, condicion, detalle) {
  if (condicion) {
    bien++;
    console.log(`   ✅ ${loQueSeEspera}`);
  } else {
    mal.push(loQueSeEspera);
    console.log(`   ❌ ${loQueSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

/**
 * Lo que lleva la hoja, leído del documento ya compuesto para imprimir.
 *
 * Se mira el texto que de verdad quedó y no el código que lo generó: es la
 * única forma de que la prueba siga valiendo si mañana el membrete se arma de
 * otra manera.
 */
const RADIOGRAFIA = `(() => {
  const hoja = document.querySelector('.print-sheet, .informe-hoja');
  if (!hoja) return { hay: false };
  const texto = hoja.innerText;
  const seVe = (sel) => {
    const e = hoja.querySelector(sel);
    if (!e) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  return {
    hay: true,
    logo: !!hoja.querySelector('.membrete img, .cert-logo'),
    texto,
    // Los emoji viven en un rango propio de Unicode: así se los reconoce sin
    // tener que enumerarlos uno por uno.
    emojis: (texto.match(/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/gu) || []),
    // Nada de lo que se guarda en la base debería salir impreso en crudo
    etiquetasHtml: /<\\/?(p|div|br|strong|em|ul|ol|li|span)\\b[^>]*>/i.test(texto),
    // Las fechas de máquina (2026-08-25) no van en un documento que se firma
    fechasSinFormato: (texto.match(/\\b\\d{4}-\\d{2}-\\d{2}\\b/g) || []),
    conSombra: [...hoja.querySelectorAll('.card, .stat')].filter((e) => {
      const s = getComputedStyle(e).boxShadow;
      return s && s !== 'none';
    }).length,
  };
})()`;

const DOCUMENTOS = [
  { nombre: 'la ficha de un miembro', ruta: '#/print/miembros/1' },
  { nombre: 'un acta de reunión', ruta: '#/print/actas_reuniones/1' },
  { nombre: 'el informe de asistencia', ruta: '#/asistencia/informes' },
  { nombre: 'la planilla mensual', ruta: '#/asistencia/informes?tipo=planilla' },
];

(async () => {
  console.log(`🖨️  Revisando los documentos impresos contra ${URL}\n`);
  const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 1600 } });

  await pagina.goto(URL + '/');
  await pagina.fill('#loginRut', RUT);
  await pagina.fill('#loginPass', CLAVE);
  await pagina.click('button[type=submit]');
  await pagina.waitForSelector('.topbar', { timeout: 15000 });

  // La identidad institucional completa, que es la que tiene que salir en todo
  await pagina.evaluate(async () => {
    await api('PUT', '/configuracion', {
      iglesia_rut: '65.123.456-7',
      iglesia_direccion: 'Av. Los Carrera 1234, Concepción',
      iglesia_telefono: '+56 41 222 3344',
      documento_pie_texto: 'Personalidad Jurídica N.º 1.234 del Ministerio de Justicia',
    });
  });
  await pagina.reload();
  await pagina.waitForSelector('.topbar', { timeout: 15000 });

  // Desde acá se mira como lo ve la impresora, no como lo ve la pantalla
  await pagina.emulateMedia({ media: 'print' });

  for (const doc of DOCUMENTOS) {
    console.log(`\n── ${doc.nombre} ──`);
    await pagina.goto(URL + '/' + doc.ruta);
    await pagina.waitForTimeout(2200);
    const r = await pagina.evaluate(RADIOGRAFIA);
    if (!r.hay) {
      revisar(`${doc.nombre}: se encuentra la hoja`, false, 'no hay ninguna hoja imprimible en esa dirección');
      continue;
    }

    revisar('lleva el logo de la institución', r.logo);
    revisar('lleva su nombre', /Iglesia Pentecostal Triunfante/i.test(r.texto));
    revisar('lleva su RUT y su contacto', /65\.123\.456-7/.test(r.texto) && /Los Carrera/.test(r.texto),
      'sin esto, una hoja con cifras que sale de la iglesia no identifica a nadie');
    revisar('lleva la leyenda legal', /Personalidad Jur/i.test(r.texto));
    revisar('dice cuándo se emitió y quién lo emitió',
      /Emitido el \d+ de \w+ de \d{4} por \S/i.test(r.texto),
      'si alguien discute una cifra, tiene que haber a quién preguntarle');
    revisar('no imprime etiquetas HTML en crudo', !r.etiquetasHtml,
      'el texto con formato ya viene limpio del servidor: escaparlo otra vez deja las etiquetas a la vista');
    revisar('no lleva fechas en formato de máquina', r.fechasSinFormato.length === 0,
      r.fechasSinFormato.length ? `salieron: ${r.fechasSinFormato.slice(0, 4).join(', ')}` : '');
    revisar('no lleva emojis', r.emojis.length === 0,
      r.emojis.length ? `salieron: ${[...new Set(r.emojis)].join(' ')} — cada impresora los dibuja distinto, o los deja en blanco` : '');
    revisar('no lleva sombras de pantalla', r.conSombra === 0,
      r.conSombra ? `${r.conSombra} recuadro(s) con sombra` : '');
  }

  await navegador.close();
  console.log(`\n──────────────────────────────────────────────`);
  if (mal.length) {
    console.log(`   ${bien} comprobación(es) pasaron · ${mal.length} fallaron\n`);
    mal.forEach((m) => console.log(`   ❌ ${m}`));
    process.exit(1);
  }
  console.log(`   ${bien} comprobaciones pasaron\n`);
  console.log('✅ Lo que sale impreso identifica a la institución y se puede rastrear.');
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
