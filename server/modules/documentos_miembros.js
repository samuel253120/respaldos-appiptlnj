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
  /*
   * También por el tipo, que es la columna de al lado.
   *
   * El listado muestra «Tipo de documento» y el buscador no lo miraba: escribir
   * «Carnet» encontraba 4 —porque esa palabra está en el nombre que alguien le
   * puso al documento— y escribir «Carnet de identidad», que es el tipo tal
   * como se lee en su propia columna, encontraba 0. Hay un filtro por tipo en
   * la barra, pero quien teclea el tipo en el buscador —que es lo natural—
   * recibía un cero.
   */
  searchFields: ['nombre', 'observaciones', 'tipo'],
  /*
   * Y por el nombre de la persona, que no es una columna de acá.
   *
   * El listado muestra «Rosa Elena Del Traslado» en su columna «Miembro»
   * —resuelta de la otra tabla al leer—, así que ninguna fila contiene ese
   * texto y buscarlo daba CERO. Medido: «Rosa Elena» → 0, sus apellidos → 0, el
   * nombre completo → 0, mientras que «Carnet» —que sí está en el nombre del
   * documento— daba 4.
   *
   * Cero resultados no se lee como «busque de otra forma»: se lee como «esta
   * persona no tiene papeles en carpeta», que es lo contrario de lo que pasa. Y
   * la pantalla acababa de mostrar ese nombre.
   *
   * Se arma en la propia consulta, igual que en la bitácora de miembros
   * (1.184.0). Va el nombre COMPLETO y no el que se muestra: la etiqueta usa
   * solo el primer nombre, y con el completo sirven las dos formas, porque lo
   * tecleado se parte en palabras y todas tienen que estar.
   *
   * El RUT no entra, a propósito: es un campo reservado de la ficha de miembro
   * y quien no lo alcanza tampoco puede dar con alguien buscándolo. El nombre
   * no lo es, y además es lo que esta misma pantalla ya muestra.
   */
  buscaTambien: [
    "(SELECT coalesce(m.nombres,'') || ' ' || coalesce(m.apellidos,'')"
    + ' FROM miembros m WHERE m.id = documentos_miembros.miembro_id)',
  ],
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
