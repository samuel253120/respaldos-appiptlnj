/**
 * Módulo: Documentos de Miembros.
 *
 * Cada miembro puede tener todos los documentos que hagan falta: su carnet de
 * identidad, la ficha de registro, la ficha de actualización, certificados y
 * cualquier otro. Cada uno guarda el archivo y su nombre, para poder
 * distinguirlos sin abrirlos.
 *
 * Se ven y se agregan desde la propia ficha del miembro, al pie.
 */
module.exports = {
  name: 'documentos_miembros',
  label: 'Documentos de Miembros',
  labelSingular: 'Documento del miembro',
  icon: '🗂️',
  group: 'Personas',
  order: 23,
  display: '{nombre}',
  dateField: 'fecha',
  /*
   * La carpeta de una persona se ve donde se ve la persona.
   *
   * Cada documento guarda a qué iglesia pertenece, y era esa columna la que
   * decidía quién podía abrirlo. Pero esa columna se rellena con la del miembro
   * EL DÍA EN QUE SE SUBE el papel, y no se vuelve a mirar: dice dónde se
   * subió, no de quién es hoy la ficha.
   *
   * Medido sobre una miembro con tres documentos, trasladada de la Central a la
   * Norte, con dos secretarias de verdad acotadas cada una a la suya:
   *
   *                                    su ficha   su carpeta   abrir el archivo
   *   la secretaria de la que YA NO       403       3 de 3           200
   *   la secretaria de la que SÍ          200       0 de 3           403
   *
   * Léase la primera fila entera: el sistema le cierra la ficha de la persona
   * —correcto— y en la misma respiración le entrega su carnet de identidad. Y
   * la segunda es el reverso: quien de verdad trabaja con ella no ve ni uno de
   * sus papeles. Con documentos de identidad de por medio, esto no es una
   * incomodidad.
   *
   * Ahora la carpeta se alcanza como su miembro, y la columna de iglesia se
   * queda como lo que siempre fue: el dato de dónde se subió, con el que se
   * filtra. Vale para las dos puertas, porque las dos preguntan por acá: la
   * consulta del listado (`condiciones`) y la que decide si se entrega el
   * archivo (`alcanza`, desde server/archivos.js).
   */
  alcance: { comoSuPadre: { modulo: 'miembros', campo: 'miembro_id' } },
  searchFields: ['nombre', 'observaciones'],
  listFields: ['miembro_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Carnet de identidad',
      options: [
        'Carnet de identidad',
        'Ficha de registro de miembro',
        'Ficha de actualización de registro',
        'Certificado de bautismo',
        'Certificado de matrimonio',
        'Certificado de nacimiento',
        'Carta de traslado',
        'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Carnet vigente hasta 2030»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, existing, db }) {
      // La iglesia se hereda del miembro
      const miembroId = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      if (miembroId && !data.iglesia_id) {
        const miembro = db.prepare('SELECT iglesia_id FROM miembros WHERE id = ?').get(miembroId);
        if (miembro && miembro.iglesia_id) data.iglesia_id = miembro.iglesia_id;
      }
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      return null;
    },
  },
};
