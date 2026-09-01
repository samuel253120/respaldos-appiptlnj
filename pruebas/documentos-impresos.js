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

/*
 * Qué se manda a imprimir.
 *
 * Los dos primeros necesitan un registro de verdad, y hasta la 1.97.5 iban
 * con el número 1 escrito a mano. Eso aguanta mientras nadie borre la primera
 * ficha; el día que alguien la borra —o que la base se armó de otra manera—
 * la prueba falla diciendo «no se encuentra la hoja», que suena a que la
 * impresión se rompió cuando lo único que pasó es que ese número ya no existe.
 * Un número inventado no prueba nada: acá se pregunta cuál hay.
 */
const DOCUMENTOS = [
  { nombre: 'la ficha de un miembro', modulo: 'miembros' },
  /*
   * Las dos hojas que la 1.235.0 destapó: su código estaba escrito y completo
   * desde la 1.202.0 y no salía ninguna, porque los módulos no estaban marcados
   * como imprimibles y el botón no aparecía nunca. Entran acá por lo mismo que
   * las demás —el membrete, la fecha, quién la emitió— y además con lo suyo,
   * más abajo.
   */
  { nombre: 'la hoja de una iglesia', modulo: 'iglesias' },
  { nombre: 'la hoja de un pastor', modulo: 'pastores' },
  /*
   * Y la tercera, que la 1.255.0 destapó por lo mismo: dieciocho módulos se
   * imprimían y Cuerpos / Grupos no, teniendo impresos tres de sus propios
   * hijos —su directiva, sus actas y las evaluaciones de su gente—.
   */
  { nombre: 'la hoja de un cuerpo', modulo: 'cuerpos' },
  { nombre: 'un acta de reunión', modulo: 'actas_reuniones' },
  { nombre: 'el informe de asistencia', ruta: '#/asistencia/informes' },
  /*
   * La planilla mensual es de UN cuerpo: sin decir cuál, la pantalla contesta
   * «Elija un cuerpo» y no hay hoja que revisar. Antes esto pasaba igual y la
   * prueba lo daba por bueno porque la dirección se perdía por el camino y
   * salía el informe general —o sea, se revisaba otra hoja, no esta—. Desde
   * que la dirección llega de verdad (1.129.0), hay que decirle el cuerpo, y
   * se pregunta cuál hay en vez de escribir un número.
   */
  { nombre: 'la planilla mensual', modulo: 'cuerpos', rutaCon: (id) => `#/asistencia/informes?tipo=planilla&cuerpo_id=${id}` },
];

/** El primer registro que exista en ese módulo, o nada si no hay ninguno. */
async function primerRegistro(pagina, modulo) {
  return pagina.evaluate(async (m) => {
    const r = await api('GET', `/${m}?page=1&pageSize=1`);
    const fila = (r.items || r.data || r.rows || [])[0];
    return fila ? fila.id : null;
  }, modulo);
}

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
    if (doc.modulo) {
      const id = await primerRegistro(pagina, doc.modulo);
      if (!id) {
        revisar(`${doc.nombre}: hay alguno para imprimir`, false,
          `no hay ningún registro en ${doc.modulo}`);
        continue;
      }
      doc.ruta = doc.rutaCon ? doc.rutaCon(id) : `#/print/${doc.modulo}/${id}`;
    }
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

    /*
     * NINGUNA HOJA IMPRIME EL NOMBRE CON QUE EL SISTEMA ARCHIVA UN ARCHIVO.
     *
     * Se destapó al imprimir por primera vez la hoja de una iglesia: la primera
     * línea de sus datos, arriba del nombre de la congregación, decía
     * «Fotografía del templo · 1756…-a3f9c2-templo.jpg». Eso es ruido interno
     * en un papel que se entrega y se firma, y le pasaba a las seis hojas
     * genéricas que llevan un campo de archivo. Ahora una fotografía se imprime
     * como fotografía y un documento adjunto se nombra como se llama de verdad.
     */
    const guardados = (r.texto.match(/\b\d{13}-[0-9a-f]{6,}-\S+/g) || []);
    revisar('no imprime el nombre interno de ningún archivo', guardados.length === 0,
      guardados.length ? `salió: ${guardados.slice(0, 2).join(', ')}` : '');

    /*
     * Y la hoja de una iglesia dice lo que la congregación TIENE, que es lo que
     * hace que sirva para lo que se pide en papel: entregarla, presentarla en
     * una visita, acompañar un trámite. Sin eso es la ficha a secas —cinco
     * datos que ya se sabían—.
     */
    if (doc.modulo === 'iglesias') {
      revisar('la hoja de una iglesia dice lo que tiene hoy',
        /Lo que tiene hoy/.test(r.texto) && /Miembros/.test(r.texto) && /Cuerpos y grupos/.test(r.texto),
        'una hoja de entrega que no dice cuánta gente ni cuántos cuerpos hay no sirve para entregar nada');
      revisar('y avisa que esas cifras no son datos escritos en la ficha',
        /es lo que hay anotado en el sistema en el momento de imprimir/.test(r.texto),
        'quien la firme tiene que saber que son de hoy y no de cuando se llenó la ficha');
      revisar('y no suma la plata de sus cuerpos a la suya',
        !/Cajas de sus cuerpos/.test(r.texto) || /otro dueño/.test(r.texto),
        'son dos dueños distintos, como en el inventario');
    }

    /*
     * Y la de un CUERPO dice QUIÉNES LO COMPONEN, que es la pregunta con la
     * que se pide en papel: para entregarlo, para llevarlo a una reunión o
     * para presentarlo. Sin eso es la ficha a secas, igual que la de la
     * iglesia antes de la 1.235.0.
     */
    /*
     * `!doc.rutaCon` distingue la HOJA del cuerpo de la planilla mensual, que
     * también dice `modulo: 'cuerpos'` —lo usa solo para elegir de cuál— y es
     * otra pantalla. Sin esa mitad, estas tres comprobaciones se le hacían
     * también a la planilla y salían en rojo por pedirle algo que no le toca.
     */
    if (doc.modulo === 'cuerpos' && !doc.rutaCon) {
      revisar('la hoja de un cuerpo dice quiénes lo componen',
        /Quiénes lo componen/.test(r.texto),
        'una hoja de entrega que no dice quiénes son no sirve para entregar nada');
      revisar('y cuánta gente tiene hoy, con su cuota',
        /Lo que tiene hoy/.test(r.texto) && /Integrantes/.test(r.texto) && /Cuota mensual/.test(r.texto));
      revisar('y no imprime el RUT de su gente',
        !/\b\d{7,8}-[\dkK]\b/.test(r.texto.replace(/RUT[^\n]*/g, '')),
        'el RUT tiene su propia llave, y una hoja impresa es por donde se escapa');
    }
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
