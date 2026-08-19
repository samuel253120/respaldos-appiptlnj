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
