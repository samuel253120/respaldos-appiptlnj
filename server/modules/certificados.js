/**
 * Módulo: Certificados (bautismo, presentación, matrimonio, membresía…).
 * Imprimible.
 *
 * De qué clases hay, qué dice cada una y cómo se ve la hoja NO está acá: lo
 * mantiene la iglesia en «Formatos de Certificado». Acá queda cada certificado
 * emitido, con su número, su titular y sus fechas.
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
