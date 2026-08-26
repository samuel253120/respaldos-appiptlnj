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
 *   El diseño       Colores, tipografías, tamaños, márgenes, marco, fondo y
 *                   orientación.
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
 */

/** Los datos que se pueden poner entre llaves dentro del texto y del título. */
const DATOS = [
  ['titular', 'El nombre del titular, como quedó escrito en el certificado'],
  ['tipo', 'El nombre de este formato'],
  ['numero', 'El número del certificado'],
  ['iglesia', 'La iglesia local que lo emite'],
  ['institucion', 'El nombre de la institución'],
  ['fecha_evento', 'La fecha del bautismo, la boda, lo que sea, en letras'],
  ['fecha_emision', 'La fecha en que se emite, en letras'],
  ['oficiante', 'Quien oficia o firma'],
  ['rut', 'El RUT del titular, si está registrado'],
];

const AYUDA_DATOS =
  'Entre llaves se pueden poner: ' + DATOS.map(([d]) => `{${d}}`).join(', ') +
  '. Cada uno se reemplaza al imprimir; el que no tenga dato queda en blanco.';

const TIPOGRAFIAS = ['Con serifa (Georgia)', 'Sin serifa', 'Manuscrita'];
const MARCOS = ['Doble línea', 'Línea simple', 'Sin marco'];

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
  listFields: ['nombre', 'activo', 'orientacion', 'color_titulo', 'notas'],
  filterFields: ['activo', 'orientacion'],
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
      name: 'orientacion', label: 'Orientación', type: 'select', default: 'Vertical',
      options: ['Vertical', 'Horizontal'], seccion: 'El diseño de la hoja',
      help: 'Horizontal es lo habitual en los certificados de reconocimiento.',
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
  ],

  hooks: {
    beforeSave(data, { existing }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);

      /**
       * Los números se acotan acá y no en la pantalla.
       *
       * Un tamaño de título de 4000 px no rompe nada, pero deja la hoja
       * ilegible y a quien la emitió sin entender qué pasó. Y el margen es
       * peor: uno de 300 mm no deja lugar para el texto en una hoja carta.
       * Se guarda lo que se puede imprimir.
       */
      const entre = (n, min, max, porDefecto) => {
        const crudo = dato(n);
        // Vacío es «el de fábrica», no cero: `Number(null)` da 0, y un margen
        // de 0 mm es un valor legítimo que nadie eligió
        if (crudo === null || crudo === undefined || crudo === '') return porDefecto;
        const v = Number(crudo);
        if (!Number.isFinite(v)) return porDefecto;
        return Math.min(max, Math.max(min, Math.round(v)));
      };
      data.tamano_titulo = entre('tamano_titulo', 12, 96, 34);
      data.tamano_texto = entre('tamano_texto', 8, 40, 15);
      data.margen = entre('margen', 0, 40, 18);
      data.fondo_opacidad = entre('fondo_opacidad', 5, 100, 100);
      data.orden = entre('orden', 0, 9999, 100);

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

      const nombre = String(dato('nombre') || '').trim();
      if (!nombre) return 'El formato necesita un nombre: es con el que se elige al emitir.';
      data.nombre = nombre;
      return null;
    },

    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM certificados WHERE tipo = ?').get(row.nombre).c;
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
      res.json(
        db.prepare('SELECT nombre FROM formatos_certificado WHERE activo = 1 ORDER BY orden, nombre')
          .all()
          .map((f) => ({ id: f.nombre, label: f.nombre }))
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
