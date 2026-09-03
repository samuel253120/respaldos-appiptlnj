/**
 * Módulo: Formatos de Certificado.
 *
 * De qué clases de certificado emite la iglesia y cómo se ve cada uno. Antes
 * las dos cosas estaban escritas dentro del programa: los tipos, en una lista
 * fija de ocho; los textos, en el navegador, en una función. Cambiar una coma
 * del certificado de bautismo era tocar el código y publicar una versión.
 *
 * Cada formato manda sobre tres cosas, que son las tres secciones de su ficha:
 *
 *   El texto        Lo que dice el certificado, con los datos que se rellenan
 *                   solos —{titular}, {fecha_evento}, {iglesia}—.
 *   La hoja         Qué partes aparecen: el título, el rótulo del nombre, el
 *                   número, las dos firmas, el pie institucional.
 *   El diseño       Colores, tipografías, tamaños, márgenes, marco, fondo,
 *                   orientación y DISPOSICIÓN.
 *
 * LA DISPOSICIÓN NO ES UN COLOR. Es la forma de la hoja, y por eso está aparte
 * de todo lo demás: hay certificados que no son «un título, un nombre y un
 * párrafo». El de presentación de niños tiene el nombre del niño, la fecha en
 * que nació, quién lo presentó, sus padres y dos parejas de padrinos; el de
 * matrimonio nombra a los dos cónyuges en una sola frase. Se eligen de una
 * lista, y cada uno pide en la ficha del certificado los datos que le hacen
 * falta. La disposición «Clásica» es la de siempre, y es la que traen todos
 * los formatos que ya existían.
 *
 * QUÉ NO SE TOCA. El nombre de la institución, su lema y su logo salen de la
 * configuración, no de acá: son los mismos en todo lo que la iglesia imprime,
 * y tenerlos en cada formato sería tener cuatro versiones distintas del
 * membrete el día que cambie. Lo mismo el número del certificado, que lo lleva
 * su propia ficha.
 *
 * UN FORMATO QUE YA SE USÓ NO SE BORRA sin avisar: es el tipo con que quedaron
 * emitidos certificados que ya están firmados y entregados. Se puede sacar de
 * circulación con «En uso», y entonces deja de ofrecerse al emitir sin tocar
 * los que ya existen.
 *
 * Y TAMPOCO SE RENOMBRA SIN AVISAR, por lo mismo: lo que el certificado guarda
 * de su formato es el NOMBRE, y con ese nombre lo va a buscar cada vez que se
 * imprime. Renombrarlo se pregunta, diciendo a cuántos certificados afecta, y
 * al contestar que sí esos certificados se van con él.
 */

/**
 * Los datos que se pueden poner entre llaves dentro del texto y del título.
 *
 * ESTA LISTA ES LO QUE LA IGLESIA VE, así que tiene que nombrarlos TODOS. Y
 * durante un tiempo nombró catorce de veintitrés: faltaban las nueve fechas
 * partidas en día, mes y año, que son justamente las que usan las dos hojas que
 * la iglesia más cuida —la de presentación de niños las usa las nueve, la de
 * matrimonio seis—. Quien abría «Presentación de niños» para corregirle una
 * coma se encontraba con un texto lleno de llaves que la ayuda de ese mismo
 * campo no mencionaba, y la conclusión razonable —y equivocada— era que estaban
 * mal escritas.
 *
 * Van en dos grupos porque son dos cosas distintas y se usan en dos clases de
 * frase. Hay una prueba que comprueba que la lista y lo que el sistema rellena
 * digan lo mismo EN LAS DOS DIRECCIONES: ofrecer una que nadie rellena sería
 * prometer un dato que sale impreso tal cual, y rellenar una que no se ofrece
 * es lo que pasaba acá.
 */
const DATOS = [
  ['titular', 'El nombre del titular, como quedó escrito en el certificado'],
  ['conyuge', 'El otro cónyuge, en el certificado de matrimonio'],
  ['padre', 'El padre, en el certificado de presentación de niños'],
  ['madre', 'La madre, en el certificado de presentación de niños'],
  ['fecha_nacimiento', 'La fecha de nacimiento del niño, en letras'],
  ['ciudad', 'La ciudad de la iglesia que emite'],
  ['tipo', 'El nombre de este formato'],
  ['numero', 'El número del certificado'],
  ['iglesia', 'La iglesia local que lo emite'],
  ['institucion', 'El nombre de la institución'],
  ['fecha_evento', 'La fecha del bautismo, la boda, lo que sea, en letras'],
  ['fecha_emision', 'La fecha en que se emite, en letras'],
  ['oficiante', 'Quien oficia o firma'],
  ['rut', 'El RUT del titular, si está registrado'],
];

/**
 * Las fechas partidas en día, mes y año.
 *
 * Existen para la frase con espacios en blanco —«con fecha __ de ______ del
 * año ____»—, que es como están hechas en papel las hojas de presentación de
 * niños y de matrimonio. Escribir ahí la fecha entera obligaría a la iglesia a
 * redactar dos textos distintos para la misma frase.
 *
 * El mes sale en MAYÚSCULAS y sin abreviar —«OCTUBRE»—, como en el formulario
 * impreso de siempre.
 */
const DATOS_EN_PARTES = [
  ['nac_dia', 'El día en que nació, en número'],
  ['nac_mes', 'El mes en que nació, en letras y mayúsculas'],
  ['nac_anio', 'El año en que nació'],
  ['ev_dia', 'El día del bautismo, la boda o la presentación, en número'],
  ['ev_mes', 'El mes de ese mismo día, en letras y mayúsculas'],
  ['ev_anio', 'El año de ese mismo día'],
  ['em_dia', 'El día en que se emite, en número'],
  ['em_mes', 'El mes en que se emite, en letras y mayúsculas'],
  ['em_anio', 'El año en que se emite'],
];

/** Todo lo que se puede poner entre llaves, que es lo que el sistema rellena. */
const TODAS_LAS_LLAVES = [...DATOS, ...DATOS_EN_PARTES];

const AYUDA_DATOS =
  'Entre llaves se pueden poner: ' + DATOS.map(([d]) => `{${d}}`).join(', ') +
  '. Y la fecha partida, para la frase con espacios en blanco: ' +
  DATOS_EN_PARTES.map(([d]) => `{${d}}`).join(', ') +
  '. Cada uno se reemplaza al imprimir; el que no tenga dato queda en blanco, y ' +
  'el que esté mal escrito sale impreso tal cual —entre llaves— para que se note.';

const TIPOGRAFIAS = ['Con serifa (Georgia)', 'Sin serifa', 'Manuscrita'];
const MARCOS = ['Doble línea', 'Línea simple', 'Sin marco'];

/**
 * La forma de la hoja. Cada una pide sus propios datos al emitir.
 *
 *   Clásica                 Título, nombre y párrafo. Sirve para casi todo y es
 *                           la que traían todos los formatos.
 *   Presentación de niños   Con la fecha de nacimiento, quién lo presentó, los
 *                           padres y dos parejas de padrinos.
 *   Matrimonio              Nombra a los dos cónyuges en una sola frase, con el
 *                           pastor que los unió.
 */
const DISPOSICIONES = ['Clásica', 'Presentación de niños', 'Matrimonio'];

/**
 * Las que van SIEMPRE apaisadas, porque así están hechas.
 *
 * No es una preferencia: la hoja de presentación reparte el nombre del niño,
 * la frase con los espacios, los padres y las dos parejas de padrinos a lo
 * ancho, y la de matrimonio nombra a los dos cónyuges en una sola línea. De
 * pie, esas mismas filas se parten en dos y la hoja deja de ser la que la
 * iglesia usa en papel. La orientación no se ofrece en esas dos, y si el dato
 * llega de otra manera se corrige al guardar.
 */
const SIEMPRE_APAISADAS = ['Presentación de niños', 'Matrimonio'];

/**
 * El papel en que se imprime, con sus medidas reales en milímetros.
 *
 * Son los dos tamaños que la iglesia tiene: la hoja CARTA de siempre y la
 * CIRCULAR, que es la larga —216 × 330 mm, 8,5 × 13 pulgadas— y que muchas
 * impresoras listan con ese nombre (en otras aparece como «Oficio» o
 * «Folio»: son la misma hoja).
 *
 * Las medidas están acá y también en el navegador (CERT_HOJAS, en
 * public/app.js), porque las necesitan los dos: el servidor para guardar y
 * comprobar, y la pantalla para armar la hoja y decirle a la impresora de qué
 * tamaño es la página. Tienen que ser el mismo número en los dos lados —si no,
 * lo que se ve no es lo que sale—, y hay una prueba que lo comprueba
 * (pruebas/motor/formatos-certificado.test.js).
 */
const HOJAS = {
  Carta: { ancho: 216, alto: 279 },
  Circular: { ancho: 216, alto: 330 },
};
const TAMANOS_HOJA = Object.keys(HOJAS);

/**
 * Los seis números del diseño, con lo que se puede pedir y con el de fábrica.
 *
 * Están acá y también en el navegador (CERT_NUMEROS, en public/app.js), por lo
 * mismo que las medidas del papel: el servidor los necesita para guardar y la
 * pantalla para dibujar la hoja y la vista previa. Tienen que decir lo mismo en
 * los dos lados, y hay una prueba que lo comprueba
 * (pruebas/motor/los-numeros-del-diseno.test.js).
 *
 * VACÍO ES «EL DE FÁBRICA», NO CERO, y esa es la parte que se olvida. En el
 * navegador una casilla de número vacía llega como texto vacío, y `Number('')`
 * da 0, que es un número finito: acotado sin más, cae al MÍNIMO del rango.
 * Medido en la v1.309.0, con las cinco casillas en blanco la vista previa
 * dibujaba título de 12 px, texto de 8 px, margen de 0 mm, marco de 1 px y
 * fondo al 5 %, mientras el servidor guardaba 34, 15, 18, 3 y 100. La muestra
 * que existe para revisar una hoja antes de imprimirla mostraba otra hoja.
 *
 * `orden` no es del diseño —es el lugar en la lista de tipos— pero se acota
 * igual y por el mismo camino, así que vive con los demás.
 */
const NUMEROS = {
  tamano_titulo: { min: 12, max: 96, deFabrica: 34 },
  tamano_texto: { min: 8, max: 40, deFabrica: 15 },
  margen: { min: 0, max: 40, deFabrica: 18 },
  fondo_opacidad: { min: 5, max: 100, deFabrica: 100 },
  orden: { min: 0, max: 9999, deFabrica: 100 },
  grosor_marco: { min: 1, max: 12, deFabrica: 3 },
};

/**
 * Un número del diseño, acotado a lo que se puede imprimir.
 *
 * La escriben los dos lados y tiene que decidir igual en los dos: el vacío al
 * de fábrica, lo que no es número también, y el resto acotado al rango.
 */
function acotar(cual, crudo) {
  const { min, max, deFabrica } = NUMEROS[cual];
  if (crudo === null || crudo === undefined || crudo === '') return deFabrica;
  const v = Number(crudo);
  if (!Number.isFinite(v)) return deFabrica;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Cuántos certificados quedaron emitidos con un nombre de formato.
 *
 * Es la misma cuenta que mira `beforeDelete` para no dejar borrar un formato
 * en uso, y por el mismo motivo: el tipo del certificado es el NOMBRE del
 * formato, no su número, y es lo único que después los ata.
 */
function losQueYaSeEmitieron(db, nombre) {
  return db.prepare('SELECT COUNT(*) AS c FROM certificados WHERE tipo = ?').get(nombre).c;
}

/**
 * El aviso de renombrar un formato que ya tiene certificados emitidos.
 *
 * Dice las tres cosas que quien contesta necesita: cuántos son, qué les pasa
 * si sigue, y qué otra cosa podría hacer. Sin el número, «afecta a los
 * certificados emitidos» se contesta que sí sin saber si son dos o doscientos.
 */
function avisoDelFormatoQueSeRenombra(antes, despues, cuantos) {
  return (
    `«${antes}» es el tipo de ${cuantos.toLocaleString('es-CL')} certificado(s) ya emitido(s). ` +
    `Si le cambia el nombre a «${despues}», esos certificados pasan a llamarse igual y se siguen ` +
    'imprimiendo con este formato. Si prefiere que los que ya están sigan como están, deje este ' +
    'formato con su nombre, desmárquelo en «En uso» y cree uno nuevo con el nombre que quiere.'
  );
}

module.exports = {
  name: 'formatos_certificado',
  label: 'Formatos de Certificado',
  labelSingular: 'Formato de certificado',
  icon: '🎗️',
  group: 'Documentación',
  ayudaPermiso:
    'De qué clases de certificado se emite, qué dice cada uno y cómo se ve la hoja. Cambiar un ' +
    'formato altera cómo se imprimen TAMBIÉN los certificados ya emitidos, porque la hoja se ' +
    'arma al imprimir.',
  order: 64,
  display: '{nombre}',
  searchFields: ['nombre', 'texto', 'titulo', 'notas'],
  listFields: ['nombre', 'activo', 'disposicion', 'tamano_hoja', 'orientacion', 'color_titulo', 'notas'],
  filterFields: ['activo', 'disposicion', 'tamano_hoja', 'orientacion'],
  defaultSort: { field: 'orden', dir: 'asc' },

  fields: [
    /* ── El formato ─────────────────────────────────────────────── */
    {
      name: 'nombre', label: 'Nombre del formato', type: 'text', required: true, unique: true,
      seccion: 'El formato',
      help: 'Como se verá al elegir el tipo de certificado. Ej: «Bautismo», «Matrimonio».',
    },
    {
      name: 'activo', label: 'En uso', type: 'boolean', default: 1, seccion: 'El formato',
      help: 'Al desmarcarlo deja de ofrecerse al emitir. Los certificados que ya lo usan no se tocan.',
    },
    {
      name: 'orden', label: 'Orden en la lista', type: 'number', default: 100, seccion: 'El formato',
      help: 'Los más chicos salen primero. Con el mismo número se ordenan por nombre.',
    },
    { name: 'notas', label: 'Para qué es', type: 'text', seccion: 'El formato', help: 'Opcional: cuándo se usa este formato.' },

    /* ── El texto ───────────────────────────────────────────────── */
    {
      name: 'titulo', label: 'Título de la hoja', type: 'text', seccion: 'El texto',
      help: 'Vacío queda «Certificado de » y el nombre del formato. ' + AYUDA_DATOS,
    },
    {
      name: 'rotulo_titular', label: 'Rótulo sobre el nombre', type: 'text', seccion: 'El texto',
      help: 'Vacío queda «Otorgado a:».',
    },
    {
      name: 'texto', label: 'Texto del certificado', type: 'textarea', seccion: 'El texto',
      help: 'El cuerpo de la hoja. ' + AYUDA_DATOS,
    },
    {
      name: 'texto_fecha', label: 'Línea de la fecha', type: 'text', seccion: 'El texto',
      help: 'Vacío queda «Dado el » y la fecha de emisión. ' + AYUDA_DATOS,
    },
    {
      name: 'epigrafe', label: 'Versículo o epígrafe', type: 'textarea', seccion: 'El texto',
      help: 'Opcional: el versículo que va bajo el título, en cursiva y centrado. '
        + 'Ej: «Dejad a los niños venir a mí, y no se lo impidáis».',
    },
    {
      name: 'epigrafe_cita', label: 'Cita del versículo', type: 'text', seccion: 'El texto',
      help: 'De dónde es. Ej: «San Marcos 10:14». Solo aparece si hay versículo.',
      sugerencias: ['San Marcos 10:14', 'Génesis 2:24', 'Mateo 19:6', 'Hechos 2:38', 'Salmos 127:3'],
    },

    /* ── Qué se muestra en la hoja ──────────────────────────────── */
    { name: 'muestra_logo', label: 'Muestra el logo', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    { name: 'muestra_institucion', label: 'Muestra el nombre de la institución', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    { name: 'muestra_iglesia', label: 'Muestra la iglesia local', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    { name: 'muestra_numero', label: 'Muestra el número', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    { name: 'muestra_firmas', label: 'Muestra las firmas', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    {
      name: 'firma_izquierda', label: 'Firma de la izquierda', type: 'text', seccion: 'Qué se muestra en la hoja',
      help: 'Vacío pone el oficiante del certificado.',
    },
    {
      name: 'firma_derecha', label: 'Firma de la derecha', type: 'text', seccion: 'Qué se muestra en la hoja',
      help: 'Vacío queda «Secretaría».',
    },
    { name: 'muestra_fecha', label: 'Muestra la línea de la fecha', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },
    { name: 'muestra_pie', label: 'Muestra el pie institucional', type: 'boolean', default: 1, seccion: 'Qué se muestra en la hoja' },

    /* ── El diseño de la hoja ───────────────────────────────────── */
    {
      name: 'disposicion', label: 'Disposición de la hoja', type: 'select', default: 'Clásica',
      options: DISPOSICIONES, seccion: 'El diseño de la hoja',
      help: 'La FORMA de la hoja, no su color. Cada disposición pide en la ficha del certificado '
        + 'los datos que le hacen falta: la de presentación de niños pide los padres y los padrinos; '
        + 'la de matrimonio, el otro cónyuge. «Clásica» es la de siempre.',
    },
    {
      name: 'tamano_hoja', label: 'Tamaño de la hoja', type: 'select', default: 'Carta',
      options: TAMANOS_HOJA, seccion: 'El diseño de la hoja',
      help: 'CARTA: 21,6 × 27,9 cm, la de siempre. CIRCULAR: 21,6 × 33 cm, la hoja larga '
        + '(en algunas impresoras aparece como «Oficio» o «Folio»: es la misma). La hoja se '
        + 'ajusta sola al tamaño elegido, y las firmas bajan al pie del papel que sea.',
    },
    {
      name: 'orientacion', label: 'Orientación', type: 'select', default: 'Vertical',
      options: ['Vertical', 'Horizontal'], seccion: 'El diseño de la hoja',
      help: 'Horizontal es lo habitual en los certificados de reconocimiento. Las hojas de '
        + 'presentación de niños y de matrimonio van SIEMPRE horizontales —así están hechas—, '
        + 'y en ellas no se elige.',
    },
    {
      name: 'fondo', label: 'Imagen de fondo', type: 'file', accept: 'image/*', seccion: 'El diseño de la hoja',
      help: 'Opcional: una orla o marca de agua. Se ve detrás del texto, a página completa.',
    },
    {
      name: 'fondo_opacidad', label: 'Intensidad del fondo (%)', type: 'number', default: 100,
      seccion: 'El diseño de la hoja',
      help: 'Bájela para que el fondo no compita con el texto. 100 es la imagen tal cual.',
    },
    { name: 'color_titulo', label: 'Color del título', type: 'color', seccion: 'El diseño de la hoja', porDefecto: '#16265c' },
    { name: 'color_texto', label: 'Color del texto', type: 'color', seccion: 'El diseño de la hoja', porDefecto: '#44403c' },
    { name: 'color_marco', label: 'Color del marco', type: 'color', seccion: 'El diseño de la hoja', porDefecto: '#e8b52c' },
    {
      name: 'tipografia_titulo', label: 'Tipografía del título', type: 'select', default: 'Con serifa (Georgia)',
      options: TIPOGRAFIAS, seccion: 'El diseño de la hoja',
    },
    {
      name: 'tipografia_texto', label: 'Tipografía del texto', type: 'select', default: 'Sin serifa',
      options: TIPOGRAFIAS, seccion: 'El diseño de la hoja',
    },
    {
      name: 'tamano_titulo', label: 'Tamaño del título (px)', type: 'number', default: 34,
      seccion: 'El diseño de la hoja', help: 'Entre 12 y 96.',
    },
    {
      name: 'tamano_texto', label: 'Tamaño del texto (px)', type: 'number', default: 15,
      seccion: 'El diseño de la hoja', help: 'Entre 8 y 40.',
    },
    {
      name: 'margen', label: 'Margen de la hoja (mm)', type: 'number', default: 18,
      seccion: 'El diseño de la hoja', help: 'Entre 0 y 40. Es el aire entre el borde del papel y el marco.',
    },
    {
      name: 'marco', label: 'Marco', type: 'select', default: 'Doble línea',
      options: MARCOS, seccion: 'El diseño de la hoja',
    },
    {
      name: 'grosor_marco', label: 'Grosor del marco (px)', type: 'number', default: 3,
      seccion: 'El diseño de la hoja',
      help: 'Entre 1 y 12. Los certificados con orla llevan un marco grueso; los sobrios, uno fino.',
      showIf: { field: 'marco', in: ['Doble línea', 'Línea simple'] },
    },
  ],

  hooks: {
    beforeSave(data, { existing, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);

      /**
       * Los números se acotan al guardar, con la tabla de más arriba.
       *
       * Un tamaño de título de 4000 px no rompe nada, pero deja la hoja
       * ilegible y a quien la emitió sin entender qué pasó. Y el margen es
       * peor: uno de 300 mm no deja lugar para el texto en una hoja carta.
       * Se guarda lo que se puede imprimir.
       */
      for (const cual of Object.keys(NUMEROS)) data[cual] = acotar(cual, dato(cual));

      /**
       * El fondo tiene que ser un archivo de los que subió el sistema.
       *
       * El nombre se pega dentro de `src="/uploads/…"` en la hoja impresa. Lo
       * pone el propio control al subir la imagen, pero el que mande la
       * petición a mano puede escribir ahí lo que quiera, y una barra de más
       * apunta fuera de la carpeta de subidas.
       */
      const fondo = String(dato('fondo') || '').trim();
      if (fondo && !/^[\w.-]+\.(jpe?g|png|webp)$/i.test(fondo)) {
        return 'La imagen de fondo no es válida. Súbala con el botón del formulario.';
      }

      // Una disposición que no existe dejaría la hoja sin armar
      if (!DISPOSICIONES.includes(dato('disposicion'))) data.disposicion = 'Clásica';
      // Y un papel que no existe la dejaría sin medidas al imprimir
      if (!TAMANOS_HOJA.includes(dato('tamano_hoja'))) data.tamano_hoja = 'Carta';

      /*
       * Las dos hojas que están hechas a lo ancho van a lo ancho. La pantalla
       * ya no ofrece la otra, pero el dato puede llegar de cualquier manera y
       * de pie esas hojas no son las que la iglesia usa: las filas de padres y
       * de padrinos se parten en dos y la frase de los cónyuges deja de ser una.
       */
      const como = data.disposicion !== undefined ? data.disposicion : dato('disposicion');
      if (SIEMPRE_APAISADAS.includes(como)) data.orientacion = 'Horizontal';

      const nombre = String(dato('nombre') || '').trim();
      if (!nombre) return 'El formato necesita un nombre: es con el que se elige al emitir.';
      data.nombre = nombre;

      /**
       * RENOMBRAR UN FORMATO EN USO SE PREGUNTA, Y ARRASTRA LO YA EMITIDO.
       *
       * Un certificado no guarda de qué formato salió: guarda su NOMBRE, en
       * «tipo», y con ese nombre se va a buscar el formato cada vez que la hoja
       * se imprime. Renombrar el formato cortaba ese hilo en silencio —200, sin
       * preguntar nada— y los certificados que ya estaban firmados y entregados
       * quedaban apuntando a un nombre que ya no existe: la hoja salía con su
       * orla, su número, el nombre del titular y las dos firmas, y con un hueco
       * donde va lo que certifica. Medido en la v1.292.0.
       *
       * Se arregla de las dos maneras a la vez, que no se estorban:
       *
       *   · SE PREGUNTA, diciendo a cuántos afecta. Quien renombra «Bautismo»
       *     por corregir una tilde no está pidiendo lo mismo que quien lo
       *     renombra para reutilizar el formato en otra cosa, y el sistema no
       *     puede adivinar cuál de los dos es.
       *   · Y AL CONTESTAR QUE SÍ, LOS CERTIFICADOS SE VAN CON ÉL (en
       *     `afterSave`, dentro del mismo guardado). Es lo que el sistema ya
       *     promete en otras partes: «cambiar un formato altera cómo se
       *     imprimen TAMBIÉN los certificados ya emitidos, porque la hoja se
       *     arma al imprimir».
       *
       * Quien no quiera arrastrarlos tiene el otro camino escrito en el aviso, y
       * es el que el módulo ya recomendaba para dejar de usar un formato sin
       * tocar los emitidos: desmarcarlo en «En uso» y crear uno nuevo.
       */
      if (existing && nombre !== existing.nombre && !confirmado) {
        const cuantos = losQueYaSeEmitieron(db, existing.nombre);
        if (cuantos) {
          return {
            error: avisoDelFormatoQueSeRenombra(existing.nombre, nombre, cuantos),
            confirmar: 'formato_que_se_renombra',
          };
        }
      }
      return null;
    },

    /**
     * Los certificados emitidos se van con el formato que cambió de nombre.
     *
     * Va en `afterSave` y no en `beforeSave` porque acá el formato ya quedó
     * guardado con su nombre nuevo, y las dos escrituras están en la misma
     * transacción del motor: o se renombra el formato Y se mueven sus
     * certificados, o no pasa ninguna de las dos cosas. A medias sería
     * exactamente el problema que esto viene a arreglar.
     */
    afterSave(fila, { existing, db }) {
      if (!existing || fila.nombre === existing.nombre) return;
      db.prepare('UPDATE certificados SET tipo = ? WHERE tipo = ?').run(fila.nombre, existing.nombre);
    },

    beforeDelete(row, { db }) {
      const usos = losQueYaSeEmitieron(db, row.nombre);
      if (usos) {
        return (
          `«${row.nombre}» es el tipo de ${usos.toLocaleString('es-CL')} certificado(s) ya emitido(s), ` +
          'y borrarlo los dejaría sin decir de qué son. Desmárquelo en «En uso» y dejará de ofrecerse ' +
          'al emitir, sin tocar los que ya están.'
        );
      }
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Los formatos que se pueden elegir hoy al emitir un certificado.
     *
     * Pide permiso sobre CERTIFICADOS, no sobre los formatos: quien emite tiene
     * que poder elegir el tipo aunque no le toque administrar los formatos.
     */
    router.get('/formatos_certificado/opciones', requirePerm('certificados', 'view'), (req, res) => {
      /*
       * Va también la disposición: al elegir el tipo, la ficha del certificado
       * tiene que saber en el momento qué forma tendrá la hoja, porque de eso
       * dependen los campos que pide (los padres, los padrinos, el cónyuge).
       * Preguntarlo aparte sería un viaje más por cada tipo que se prueba.
       */
      res.json(
        db.prepare('SELECT nombre, disposicion FROM formatos_certificado WHERE activo = 1 ORDER BY orden, nombre')
          .all()
          .map((f) => ({ id: f.nombre, label: f.nombre, disposicion: f.disposicion || 'Clásica' }))
      );
    });

    /**
     * El formato completo con que hay que imprimir un certificado.
     *
     * Se busca por nombre y no por número porque es el tipo lo que quedó
     * guardado en el certificado: así, un certificado viejo se sigue imprimiendo
     * con el formato que le corresponde aunque entremedio se hayan creado otros.
     * Si su tipo ya no tiene formato —porque lo borraron—, se contesta nulo y la
     * hoja sale con lo de siempre, que es mejor que no salir.
     */
    router.get('/formatos_certificado/para', requirePerm('certificados', 'view'), (req, res) => {
      const nombre = String(req.query.tipo || '').trim();
      if (!nombre) return res.json(null);
      res.json(db.prepare('SELECT * FROM formatos_certificado WHERE nombre = ?').get(nombre) || null);
    });
  },
};

module.exports.DATOS = DATOS;
module.exports.DATOS_EN_PARTES = DATOS_EN_PARTES;
module.exports.TODAS_LAS_LLAVES = TODAS_LAS_LLAVES;

module.exports.DISPOSICIONES = DISPOSICIONES;
module.exports.SIEMPRE_APAISADAS = SIEMPRE_APAISADAS;
module.exports.HOJAS = HOJAS;
module.exports.NUMEROS = NUMEROS;
module.exports.acotar = acotar;
module.exports.TAMANOS_HOJA = TAMANOS_HOJA;
module.exports.TIPOGRAFIAS = TIPOGRAFIAS;
module.exports.MARCOS = MARCOS;
module.exports.avisoDelFormatoQueSeRenombra = avisoDelFormatoQueSeRenombra;
