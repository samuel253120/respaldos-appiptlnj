/**
 * Módulo: Bitácora de miembros (historial de cada persona).
 *
 * Reúne todo lo que ocurre con un miembro: cambios de sus datos, entradas y
 * salidas de cuerpos, solicitudes, ayudas sociales, certificados y las
 * anotaciones que el equipo escriba a mano.
 *
 * Los registros automáticos los genera server/bitacora.js; los manuales se
 * crean desde la ficha del miembro o desde este mismo listado.
 */
module.exports = {
  name: 'bitacora',
  label: 'Bitácora de Miembros',
  labelSingular: 'Registro de bitácora',
  icon: '🗒️',
  group: 'Personas',
  order: 22,
  display: '{tipo} — {descripcion}',
  dateField: 'fecha',
  /*
   * El historial de una persona se ve donde se ve la persona.
   *
   * Cada anotación guarda a qué iglesia pertenece, y hasta la 1.180.0 era esa
   * columna la que decidía quién podía leerla. Pero esa columna dice DÓNDE
   * PASÓ la cosa, no de quién es hoy la ficha. Medido sobre una miembro creada
   * en la Iglesia Central y pasada a la Norte: juntó 4 anotaciones y quedó con
   * 6; la secretaria de su nueva iglesia abría su ficha sin problema y su
   * pestaña de Historial le mostraba 2 de 6. Entre las que no veía estaba el
   * reconocimiento por veinte años de servicio en el coro.
   *
   * La persona se mudaba y su historia no se mudaba con ella. Ahora la
   * bitácora se alcanza como su miembro, y la columna de iglesia se queda
   * como lo que siempre fue: el dato de dónde ocurrió, con el que se filtra.
   */
  alcance: { comoSuPadre: { modulo: 'miembros', campo: 'miembro_id' } },
  searchFields: ['descripcion', 'tipo'],
  /*
   * Y también por el nombre de la persona, que no es una columna de acá.
   *
   * El listado muestra «Rosa Cárcamo Vidal» en su columna «Miembro» —resuelta
   * de la otra tabla al leer—, así que ninguna fila contiene ese texto y
   * buscarlo daba CERO. Medido: «Rosa Elena» → 0, «Cárcamo» → 0, mientras que
   * «Mercadería» —que sí está en la descripción— daba 3.
   *
   * Cero resultados no se lee como «busque de otra forma»: se lee como «no hay
   * nada anotado de esa persona», que es lo contrario de lo que pasa. Y la
   * pantalla acababa de mostrar ese nombre.
   *
   * Se arma en la propia consulta, del mismo modo en que se resuelve la
   * etiqueta, que es como el módulo de Servicios encontró la cita bíblica.
   *
   * Va el nombre COMPLETO y no el que se muestra: la etiqueta usa solo el
   * primer nombre —«Rosa», no «Rosa Elena»—, y con el completo sirven las dos
   * formas, porque lo tecleado se parte en palabras y todas tienen que estar.
   *
   * El RUT no entra, a propósito: es un campo reservado de la ficha de miembro
   * y quien no lo alcanza tampoco puede dar con alguien buscándolo. El nombre
   * no lo es, y además es lo que esta misma pantalla ya muestra.
   *
   * La tabla va nombrada —`bitacora.miembro_id`— aunque hoy no haga falta: sin
   * el nombre, SQLite busca `miembro_id` en la subconsulta, no lo encuentra
   * en `miembros` y sale a buscarlo afuera, que es lo que se quiere. Se
   * escribe igual porque el día en que `miembros` tuviera una columna con ese
   * nombre, la subconsulta pasaría a mirar la suya y la búsqueda empezaría a
   * devolver cualquier cosa sin que nada avise.
   */
  buscaTambien: [
    "(SELECT coalesce(m.nombres,'') || ' ' || coalesce(m.apellidos,'')"
    + ' FROM miembros m WHERE m.id = bitacora.miembro_id)',
  ],
  /*
   * «Registrado por» va en el listado, junto a «Origen».
   *
   * Las dos columnas contestan cosas distintas y hacen falta las dos: «Origen»
   * dice si la línea la escribió el equipo o el sistema, y «Registrado por»
   * dice quién. Sin la segunda, el listado del módulo —que es donde se mira
   * quién ha estado moviendo las fichas— contestaba «Automático» y ahí
   * terminaba, teniendo el nombre guardado en la misma fila.
   *
   * No agrega huecos: se midió y está llena en el 100% de las filas, porque el
   * módulo la escribe en cada anotación, sea del equipo o del sistema.
   */
  /*
   * Y el clip, para mirar por encima cuáles están respaldadas.
   *
   * El listado no decía cuáles anotaciones traen un documento, así que la
   * única forma de saberlo era abrirlas una por una. La columna se dibuja
   * angosta —el motor le pone su ancho mínimo a un campo de archivo— y
   * desaparece sola cuando ninguna fila trae nada, que es como se comporta
   * cualquier otra columna de archivo del sistema.
   */
  listFields: ['fecha', 'miembro_id', 'tipo', 'descripcion', 'origen', 'registrado_por', 'adjunto'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    /*
     * NO va marcada como obligatoria, por lo mismo que en los otros tres
     * historiales: el gancho la pone sola si viene en blanco, y la comprobación
     * de obligatorios del motor corre ANTES del gancho (server/crud.js), así
     * que el relleno no llegaba a ejecutarse nunca.
     *
     * Salió con el hallazgo SA-01 de la revisión de los satélites, que era de
     * los otros dos historiales; éste no estaba en el informe y apareció al
     * escribir la regla general en vez de arreglar los dos casos a mano.
     */
    { name: 'fecha', label: 'Fecha', type: 'date' },
    {
      name: 'tipo', label: 'Tipo de registro', type: 'select', required: true, default: 'Anotación',
      options: [
        'Anotación', 'Cambio de datos', 'Ingreso a cuerpo', 'Salida de cuerpo',
        'Solicitud', 'Ayuda social', 'Certificado', 'Credencial', 'Documento', 'Bautismo',
        'Cambio de estado', 'Visita', 'Disciplina', 'Reconocimiento', 'Otro',
      ],
    },
    {
      name: 'descripcion', label: 'Descripción', type: 'textarea', required: true,
      /*
       * La descripción de un cambio de datos COPIA lo que decía la ficha
       * —«RUT: 15111222-6 → 17555444-0 · Teléfono: (vacío) → +56 9 8877 6655»—
       * y ahí van los datos que la ficha reserva. Se recorta al leer con las
       * llaves de Miembros, que son las que deciden en su propia pantalla
       * (ver server/sensibles.js).
       */
      copiaDe: 'miembros',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Los registros automáticos los genera el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    ...require('../lo-que-decia-el-sistema').CAMPOS,
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
  ],
  hooks: {
    beforeSave(data, { user, isNew, existing }) {
      if (isNew) {
        data.origen = data.origen || 'Manual';
        data.registrado_por = user.nombre;
        // El día de la iglesia, no el universal: una anotación escrita el
        // domingo por la noche quedaba con fecha del lunes (ver fechas.hoy)
        if (!data.fecha) data.fecha = require('../fechas').hoy();
      }
      // Corregir a mano lo que anotó el sistema deja constancia de lo que decía
      require('../lo-que-decia-el-sistema').guardarLoQueDecia(data, { existing, user });
      return null;
    },
  },
};
