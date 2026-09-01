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
  const enc = hoja.querySelector('h1');
  const sub = hoja.querySelector('.sub');
  return {
    hay: true,
    logo: !!hoja.querySelector('.membrete img, .cert-logo'),
    texto,
    // El encabezado, aparte: es lo primero que se lee y lo que distingue una
    // hoja de la de al lado en una carpeta
    encabezado: ((enc ? enc.innerText : '') + ' ' + (sub ? sub.innerText : '')).trim(),
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
  /*
   * La hoja de una DEUDA con su plan de cuotas. La corporación la pidió así
   * —«con su plan de cuotas y lo que va pagado»— y hasta la 1.269.0 salía la
   * ficha a secas: catorce datos y ni una palabra de las seis cuotas.
   *
   * Es la única que se SIEMBRA: la base de trabajo no trae deudas anotadas
   * —lo dijo la propia corporación— así que sin sembrar una no habría hoja que
   * revisar y la comprobación pasaría por no encontrar nada, que es la peor
   * manera de pasar. Se borra al final.
   */
  { nombre: 'la hoja de una deuda', modulo: 'deudas', sembrar: true },
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

/**
 * Una deuda con su plan a medio pagar, para poder revisar su hoja. Devuelve su
 * id, o null si no se pudo (y entonces la revisión lo dice, no lo calla).
 */
async function sembrarUnaDeuda(pagina) {
  return pagina.evaluate(async () => {
    const cuentas = await api('GET', '/cuentas_tesoreria?page=1&pageSize=50');
    const caja = (cuentas.items || cuentas.rows || []).find((c) => c.estado !== 'Cerrada');
    if (!caja) return null;
    const d = await api('POST', '/deudas', {
      cuenta_id: caja.id, direccion: 'Por pagar', clase: 'Compra a crédito',
      concepto: 'Sillas para el templo (prueba de impresos)', monto: 500000,
      fecha: '2026-06-10', cuotas: 6, primera_cuota: '2026-07-10',
      contraparte_tipo: 'Una institución', institucion: 'Muebles del Sur Ltda.',
      estado: 'Vigente', igual_asi: true,
    }).catch(() => null);
    if (!d || !d.id) return null;
    const plan = await api('GET', `/deudas/${d.id}/plan`).catch(() => null);
    const cuota = plan && plan.cuotas && plan.cuotas[0];
    if (cuota) {
      await api('POST', `/deudas/${d.id}/pagos`, {
        cuota_id: cuota.id, fecha: cuota.vence, monto: cuota.monto,
        metodo: 'Transferencia', igual_asi: true,
      }).catch(() => null);
    }
    return d.id;
  });
}

/**
 * El primer registro que exista en ese módulo: su id y cómo se llama.
 *
 * El nombre se arma ACÁ, con los datos crudos de la fila, y no con la función
 * que el sistema usa para titular: si la prueba llamara a esa función estaría
 * comparando el sistema consigo mismo y pasaría diga lo que diga.
 */
async function primerRegistro(pagina, modulo) {
  return pagina.evaluate(async (m) => {
    const r = await api('GET', `/${m}?page=1&pageSize=1`);
    const fila = (r.items || r.data || r.rows || [])[0];
    if (!fila) return null;
    const nombre = fila.nombre
      || `${fila.nombres || ''} ${fila.apellidos || ''}`.trim()
      || fila.numero_acta || '';
    return { id: fila.id, nombre };
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

  let sembrado = null;
  for (const doc of DOCUMENTOS) {
    console.log(`\n── ${doc.nombre} ──`);
    let cual = null;
    if (doc.sembrar) {
      sembrado = await sembrarUnaDeuda(pagina);
      if (!sembrado) {
        revisar(`${doc.nombre}: se pudo preparar una para revisar`, false,
          'no se pudo anotar una deuda de prueba');
        continue;
      }
    }
    if (doc.modulo) {
      cual = await primerRegistro(pagina, doc.modulo);
      if (!cual) {
        revisar(`${doc.nombre}: hay alguno para imprimir`, false,
          `no hay ningún registro en ${doc.modulo}`);
        continue;
      }
      doc.ruta = doc.rutaCon ? doc.rutaCon(cual.id) : `#/print/${doc.modulo}/${cual.id}`;
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
     * EL ENCABEZADO DICE DE QUÉ REGISTRO ES LA HOJA.
     *
     * Las diecinueve hojas genéricas se encabezaban «<Tipo>» y debajo
     * «Registro N.º <id>»: el número que ese registro tiene en la base de
     * datos, que no significa nada fuera del sistema. El nombre estaba en la
     * hoja, pero más abajo, dentro de la tabla de datos. Dos hojas de dos
     * cuerpos distintos se distinguían entre sí solo por ese número, en un
     * papel que se firma y se archiva.
     *
     * Se comprueba con el dato crudo de la fila —su nombre, o el número que
     * ella misma lleva escrito— y no con la función que arma el título.
     */
    if (cual && cual.nombre && !doc.rutaCon) {
      /*
       * Comparado sin distinguir mayúsculas: el encabezado de un acta lo pone
       * en versales la hoja de estilos (`.acta-sheet h1`), así que el texto
       * pintado dice «ACTA N.º ABC-001» donde la ficha guarda «abc-001». Se
       * cayó con un acta numerada en minúsculas, y el número era el correcto:
       * la comprobación estaba mirando el estilo, no el dato.
       */
      const enElPapel = r.encabezado.toLocaleUpperCase('es');
      revisar('el encabezado dice de qué registro es, y no solo qué número tiene',
        enElPapel.includes(cual.nombre.toLocaleUpperCase('es')),
        `el encabezado decía «${r.encabezado}» y el registro se llama «${cual.nombre}»`);
    }

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
    /*
     * La hoja de una deuda lleva su PLAN DE PAGOS: la pregunta que trae a
     * alguien a esta hoja es cuánto falta y cuándo vence lo próximo, y eso son
     * seis compromisos con su fecha, no un número. Sale del mismo lugar que la
     * planilla de la ficha, así que el papel y la pantalla no pueden discrepar.
     */
    if (doc.modulo === 'deudas') {
      revisar('la hoja de una deuda trae su plan de pagos',
        /Plan de pagos/.test(r.texto) && /1 de 6/.test(r.texto) && /6 de 6/.test(r.texto),
        'sin las cuotas es la ficha a secas, y la pregunta es cuándo vence la próxima');
      revisar('y dice lo que va pagado y lo que falta',
        /pagada\(s\)/.test(r.texto) && /falta/.test(r.texto) && /Pagada/.test(r.texto),
        'una deuda a medio pagar tiene que decir por dónde va');
      revisar('y los pagos anotados, uno por uno',
        /Pagos anotados/.test(r.texto),
        'cada pago dejó un movimiento en la caja: en el papel tienen que poder cotejarse');
    }

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

  /*
   * Y se retira la deuda de prueba. Un papel de prueba que se queda en la base
   * es una deuda que la organización no contrajo, y aparecería en su balance.
   */
  /*
   * ── UN BORRADOR IMPRESO NO PUEDE PARECER EL DOCUMENTO DEFINITIVO ──
   *
   * Un acta en «Borrador» salía impresa idéntica a una firmada: el mismo
   * membrete de la institución, los mismos datos y las mismas dos líneas de
   * firma al pie, sin una palabra que dijera que todavía no está aprobada. El
   * PDF sí decía el estado, así que de los dos caminos para sacar la misma
   * acta del sistema uno lo decía y el otro no.
   *
   * Va acá y no en el motor porque esto solo se puede comprobar en un navegador
   * de verdad, con la hoja pintada: mirar el código no distingue una regla
   * escrita de una regla conectada —se probó, y el sello se podía dejar armado
   * sin insertarlo en la hoja y ninguna prueba del motor se ponía roja—.
   *
   * Se siembran las dos actas porque el estado de la que haya en la base no se
   * puede elegir, y una comprobación que depende de eso pasa por casualidad.
   */
  const actasSembradas = await pagina.evaluate(async () => {
    const cu = await api('GET', '/cuerpos?page=1&pageSize=3');
    const cuerpo = ((cu && (cu.items || cu.rows)) || [])[0];
    if (!cuerpo) return null;
    const una = async (estado) => {
      const r = await api('POST', '/actas_reuniones', {
        numero_acta: `IMPR-${estado}-${Date.now()}`, fecha: '2026-03-15', cuerpo_id: cuerpo.id,
        estado, presidida_por: 'Juan Pérez', secretario: 'Ana Soto',
        acuerdos: '<p>Se aprueba comprar sillas.</p>',
      }).catch(() => null);
      return r && r.id;
    };
    return { borrador: await una('Borrador'), firmada: await una('Firmada') };
  });

  if (!actasSembradas || !actasSembradas.borrador || !actasSembradas.firmada) {
    revisar('el acta impresa: se pudieron preparar dos para revisar', false,
      'no se pudo anotar un acta de prueba');
  } else {
    console.log('\n── el acta impresa dice si está firmada ──');

    await pagina.goto(`${URL}/#/print/actas_reuniones/${actasSembradas.borrador}`);
    await pagina.waitForTimeout(2200);
    const borrador = await pagina.evaluate(RADIOGRAFIA);
    revisar('un borrador impreso lo dice, y con el sello a la vista',
      /BORRADOR/.test(borrador.texto) && /no ha sido aprobado ni firmado/i.test(borrador.texto),
      'una vez en papel era indistinguible del acta definitiva, y un papel así circula');
    revisar('y sus dos líneas de firma dicen que la firma falta',
      (borrador.texto.match(/Pendiente de firma/g) || []).length >= 2,
      'dos rayas a secas con los nombres puestos es lo que lo hacía parecer firmado');
    revisar('el sello se ve aunque la impresora no pinte los fondos',
      await pagina.evaluate(() => {
        const el = document.querySelector('.acta-sin-firmar');
        if (!el) return false;
        const e = getComputedStyle(el);
        return parseFloat(e.borderTopWidth) >= 1
          && /rgba\(0, 0, 0, 0\)|transparent/.test(e.backgroundColor);
      }),
      'con fondo de color no saldría: los navegadores no lo imprimen salvo que se les marque a mano');

    await pagina.goto(`${URL}/#/print/actas_reuniones/${actasSembradas.firmada}`);
    await pagina.waitForTimeout(2200);
    const firmada = await pagina.evaluate(RADIOGRAFIA);
    revisar('un acta firmada no lleva el sello', !/BORRADOR/.test(firmada.texto),
      'la advertencia es para las que no lo están; ponerla siempre la vuelve invisible');
    revisar('ni firmas pendientes', !/Pendiente de firma/.test(firmada.texto));
    revisar('y dice quién la firmó y qué día',
      /Firmada por/.test(firmada.texto) && /\d{1,2} de \w+ de \d{4}/.test(firmada.texto),
      'firmar es un acto con fecha y con responsable');

    await pagina.evaluate(async (ids) => {
      for (const id of Object.values(ids)) await api('DELETE', `/actas_reuniones/${id}?igual_asi=1`).catch(() => null);
    }, actasSembradas);
  }

  if (sembrado) {
    await pagina.evaluate(async (id) => {
      const movs = await api('GET', `/tesoreria?page=1&pageSize=50&f_deuda_id=${id}`).catch(() => null);
      for (const mv of ((movs && (movs.items || movs.rows)) || [])) {
        if (mv.desembolso === 0) await api('DELETE', `/deudas/${id}/pagos/${mv.id}`).catch(() => null);
      }
      await api('DELETE', `/deudas/${id}?igual_asi=1`).catch(() => null);
    }, sembrado);
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
