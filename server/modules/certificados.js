/**
 * Módulo: Certificados (bautismo, presentación, matrimonio, membresía…).
 * Imprimible.
 *
 * De qué clases hay, qué dice cada una y cómo se ve la hoja NO está acá: lo
 * mantiene la iglesia en «Formatos de Certificado». Acá queda cada certificado
 * emitido, con su número, su titular y sus fechas.
 *
 * ---------------------------------------------------------------------------
 * NO TODOS LOS CERTIFICADOS PIDEN LOS MISMOS DATOS
 *
 * Uno de membresía se resuelve con el nombre y la fecha. Uno de PRESENTACIÓN
 * DE NIÑOS no: dice cuándo nació el niño, quién lo presentó, quiénes son sus
 * padres y sus dos parejas de padrinos. Y uno de MATRIMONIO nombra a los dos
 * cónyuges en una sola frase.
 *
 * Cuál de las tres formas tiene la hoja lo dice la DISPOSICIÓN del formato
 * elegido, y de ahí sale también qué campos pide esta ficha. La disposición se
 * copia acá al guardar por dos razones, y las dos importan:
 *
 *   · La hoja se arma al imprimir. Sin la disposición escrita en el propio
 *     certificado, cambiarle la disposición al formato cambiaría la forma de
 *     todos los que ya están firmados y entregados.
 *   · Los campos que se muestran dependen de ella (showIf), y para eso tiene
 *     que ser un dato de esta ficha.
 *
 * Y NO SE EMITE A MEDIAS (punto 17.5): la comprobación de que están los datos
 * que la disposición necesita se hace en el servidor, no en la pantalla. Un
 * certificado de matrimonio a nombre de una sola persona es un papel que hay
 * que rehacer.
 */
module.exports = {
  name: 'certificados',
  label: 'Certificados',
  labelSingular: 'Certificado',
  icon: '📜',
  group: 'Documentación',
  ayudaPermiso:
    'Los certificados emitidos. Crear uno es emitir un documento que se firma y se entrega; su ' +
    'número lo propone el sistema y no se puede repetir dentro de la iglesia.',
  order: 63,
  display: '{tipo} — {numero}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['numero', 'nombre_titular', 'tipo'],
  listFields: ['numero', 'tipo', 'nombre_titular', 'fecha_emision', 'iglesia_id', 'estado'],
  defaultSort: { field: 'fecha_emision', dir: 'desc' },
  fields: [
    {
      name: 'numero', label: 'Número', type: 'text', required: true, unique: 'iglesia_id',
      help: 'Lo propone el sistema al elegir la iglesia, y se puede cambiar. No puede repetirse ' +
        'dentro de la misma iglesia. El prefijo se fija en Configuración.',
    },
    {
      name: 'tipo', label: 'Tipo de certificado', type: 'select', required: true,
      // Los mantiene la iglesia (módulo «Formatos de Certificado»): de ahí sale
      // también el texto y el diseño de la hoja al imprimir
      optionsRoute: '/formatos_certificado/opciones',
      help: 'Se administran en Formatos de Certificado, junto con su texto y su diseño.',
    },
    { name: 'iglesia_id', label: 'Iglesia que emite', type: 'ref', ref: 'iglesias', required: true },
    { name: 'miembro_id', label: 'Miembro (si está registrado)', type: 'ref', ref: 'miembros' },
    { name: 'nombre_titular', label: 'Nombre del titular', type: 'text', required: true, help: 'Nombre completo tal como aparecerá en el certificado' },
    { name: 'fecha_evento', label: 'Fecha del evento (bautismo, boda, etc.)', type: 'date' },
    { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', required: true },
    { name: 'oficiante_id', label: 'Oficiante / Firma', type: 'ref', ref: 'pastores' },

    /*
     * Qué forma tiene la hoja. La copia el sistema del formato elegido, y de
     * ella dependen los campos de más abajo. Va oculta: no es algo que se
     * elija acá, sino en el formato.
     */
    {
      name: 'disposicion', label: 'Forma de la hoja', type: 'text', readonly: true,
      help: 'La trae el tipo elegido, y de ella dependen los datos que pide esta ficha. '
        + 'Se cambia en la ficha del formato, no acá.',
    },

    /* ── Lo que pide la presentación de niños ───────────────────── */
    {
      name: 'fecha_nacimiento', label: 'Fecha de nacimiento del niño(a)', type: 'date',
      seccion: 'Los datos del niño(a)',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padre', label: 'Padre', type: 'text',
      seccion: 'Los datos del niño(a)',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
      help: 'Nombre completo, como va a salir impreso.',
    },
    {
      name: 'madre', label: 'Madre', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padrino_1', label: 'Padrino', type: 'text',
      seccion: 'Los padrinos',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
      help: 'Opcional. Se imprimen de a pares; el par que quede vacío no sale en la hoja.',
    },
    {
      name: 'madrina_1', label: 'Madrina', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'padrino_2', label: 'Segundo padrino', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },
    {
      name: 'madrina_2', label: 'Segunda madrina', type: 'text',
      showIf: { field: 'disposicion', equals: 'Presentación de niños' },
    },

    /* ── Lo que pide el matrimonio ──────────────────────────────── */
    {
      name: 'conyuge', label: 'El otro cónyuge', type: 'text',
      seccion: 'El matrimonio',
      showIf: { field: 'disposicion', equals: 'Matrimonio' },
      help: 'El certificado nombra a los dos: arriba va el titular y acá quien se casa con él o con ella.',
    },

    /*
     * La ciudad donde se entrega, congelada al emitir.
     *
     * Sale de la iglesia, pero se copia: si mañana la iglesia se muda, los
     * certificados que ya se entregaron siguen diciendo dónde se entregaron.
     */
    { name: 'ciudad', label: 'Ciudad', type: 'text', readonly: true },
    {
      name: 'texto', label: 'Texto del certificado', type: 'textarea',
      help: 'Solo si este certificado tiene que decir algo distinto. Vacío usa el texto del formato, ' +
        'que es lo habitual: así, corregir una redacción se hace una vez en el formato y no certificado por certificado.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Emitido',
      options: ['Emitido', 'Anulado'],
    },
    { name: 'notas', label: 'Notas internas', type: 'textarea' },
  ],

  hooks: {
    /**
     * Un certificado no se emite a medias (punto 17.5).
     *
     * Acá se resuelve la disposición —la forma de la hoja— a partir del
     * formato elegido, se congela la ciudad de la iglesia, y se comprueba que
     * estén los datos que esa disposición necesita. La pantalla ya los pide,
     * pero la comprobación vive en el servidor: un certificado de matrimonio a
     * nombre de una sola persona, o uno de presentación sin los padres, es un
     * papel firmado y entregado que hay que rehacer.
     *
     * Lo que sobra se suelta. Si alguien empieza un certificado de matrimonio,
     * escribe al cónyuge y después lo cambia a uno de membresía, ese nombre no
     * puede quedar guardado ahí: no significa nada en la hoja nueva y aparece
     * de vuelta el día que alguien vuelva a cambiarle el tipo.
     */
    beforeSave(data, { existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);

      const formato = db
        .prepare('SELECT disposicion FROM formatos_certificado WHERE nombre = ?')
        .get(dato('tipo'));
      const { DISPOSICIONES } = require('./formatos_certificado');
      const como = formato && DISPOSICIONES.includes(formato.disposicion)
        ? formato.disposicion
        : 'Clásica';
      data.disposicion = como;

      const DE_NINOS = ['fecha_nacimiento', 'padre', 'madre', 'padrino_1', 'madrina_1', 'padrino_2', 'madrina_2'];
      const DE_BODA = ['conyuge'];
      const sobran = como === 'Presentación de niños' ? DE_BODA
        : como === 'Matrimonio' ? DE_NINOS
          : [...DE_NINOS, ...DE_BODA];
      for (const campo of sobran) data[campo] = null;

      const limpio = (n) => String(dato(n) || '').trim();
      if (como === 'Presentación de niños') {
        if (!limpio('padre') && !limpio('madre')) {
          return 'Un certificado de presentación de niños nombra a sus padres. Escriba al menos uno.';
        }
        const nace = limpio('fecha_nacimiento');
        const evento = limpio('fecha_evento');
        if (nace && evento && nace > evento) {
          return 'La fecha de nacimiento no puede ser posterior a la de la presentación.';
        }
      }
      if (como === 'Matrimonio' && !limpio('conyuge')) {
        return 'Un certificado de matrimonio nombra a los dos cónyuges. Falta escribir el otro.';
      }

      // La ciudad se congela al emitir: si mañana la iglesia se muda, los
      // certificados entregados siguen diciendo dónde se entregaron
      if (!limpio('ciudad')) {
        const iglesia = db.prepare('SELECT ciudad FROM iglesias WHERE id = ?').get(dato('iglesia_id'));
        data.ciudad = (iglesia && iglesia.ciudad) || null;
      }
      return null;
    },
  },

  extraRoutes(router, { requirePerm }) {
    /**
     * Qué número le toca al próximo certificado de esta iglesia.
     *
     * ES UNA PROPUESTA. Se escribía entero a mano, y eso tiene los mismos dos
     * problemas que tenía en las actas: hay que ir a mirar cuál fue el último,
     * y basta una distracción para repetir uno. En un certificado pesa más:
     * se firma, se sella y se entrega, y dos con el mismo número son dos
     * papeles en circulación que dicen ser el mismo.
     *
     * El campo se deja escribir igual, siempre: hay certificados que vienen
     * numerados de antes, y libros que empiezan en otro número.
     */
    router.get('/certificados/proximo-numero', requirePerm('certificados', 'create'), (req, res) => {
      const iglesiaId = Number(req.query.iglesia_id) || 0;
      if (!iglesiaId) return res.json({ numero: null });
      if (!require('../alcance').alcanzaIglesia(req.user, iglesiaId)) {
        return res.status(403).json({ error: 'Esa iglesia no está entre las que tiene asignadas' });
      }
      res.json({
        numero: require('../numeracion').proximoNumero('certificados', iglesiaId, req.query.fecha_emision),
      });
    });
  },
};
