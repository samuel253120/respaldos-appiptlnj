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
  listFields: ['fecha', 'miembro_id', 'tipo', 'descripcion', 'origen'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    {
      name: 'tipo', label: 'Tipo de registro', type: 'select', required: true, default: 'Anotación',
      options: [
        'Anotación', 'Cambio de datos', 'Ingreso a cuerpo', 'Salida de cuerpo',
        'Solicitud', 'Ayuda social', 'Certificado', 'Credencial', 'Documento', 'Bautismo',
        'Cambio de estado', 'Visita', 'Disciplina', 'Reconocimiento', 'Otro',
      ],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'origen', label: 'Origen', type: 'select', default: 'Manual', readonly: true,
      options: ['Manual', 'Automático'],
      help: 'Los registros automáticos los genera el sistema al ocurrir el hecho.',
    },
    { name: 'registrado_por', label: 'Registrado por', type: 'text', readonly: true },
    { name: 'adjunto', label: 'Documento adjunto', type: 'file' },
  ],
  hooks: {
    beforeSave(data, { user, isNew }) {
      if (isNew) {
        data.origen = data.origen || 'Manual';
        data.registrado_por = user.nombre;
        if (!data.fecha) data.fecha = new Date().toISOString().slice(0, 10);
      }
      return null;
    },
  },
};
