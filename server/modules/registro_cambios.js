/**
 * Módulo: Registro de Cambios.
 *
 * Quién tocó qué, en lo que no admite dudas: el dinero y las llaves.
 *
 * Los miembros, las iglesias y los pastores ya tenían su historial, donde se
 * cuenta su vida en la iglesia. Esto es otra cosa y se lee de otra manera: es
 * el libro donde queda anotado cada movimiento de tesorería que se creó, se
 * cambió o se borró, y cada vez que alguien tocó los usuarios o sus permisos.
 * No está para contar una historia, está para poder responder «¿quién cambió
 * este monto?» sin que quede en la palabra de nadie.
 *
 * Se escribe solo. No se puede agregar, editar ni borrar a mano —el sistema
 * lo impide, incluso al administrador—: un registro que se puede maquillar no
 * sirve para lo que existe.
 */
module.exports = {
  name: 'registro_cambios',
  label: 'Registro de Cambios',
  labelSingular: 'Cambio registrado',
  icon: '🧾',
  group: 'Finanzas',
  order: 45,
  display: '{modulo} · {registro}',
  dateField: 'fecha',
  searchFields: ['registro', 'detalle', 'usuario', 'modulo'],
  listFields: ['fecha', 'hora', 'modulo', 'accion', 'registro', 'usuario'],
  filterFields: ['modulo', 'accion'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', readonly: true },
    { name: 'hora', label: 'Hora', type: 'time', readonly: true },
    { name: 'modulo', label: 'Módulo', type: 'text', readonly: true },
    {
      name: 'accion', label: 'Qué pasó', type: 'select', readonly: true,
      options: ['Creación', 'Cambio', 'Eliminación'],
    },
    { name: 'registro', label: 'Registro', type: 'text', readonly: true },
    { name: 'registro_id', label: 'Número del registro', type: 'number', readonly: true },
    { name: 'detalle', label: 'Detalle', type: 'textarea', readonly: true, ancho: 'completo' },
    { name: 'usuario', label: 'Quién', type: 'text', readonly: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true },
  ],
  hooks: {
    // El registro lo escribe el sistema y nadie más. Si se pudiera corregir a
    // mano, dejaría de valer como registro.
    beforeSave() {
      return 'El registro de cambios lo escribe el sistema solo: no se agrega ni se corrige a mano.';
    },
    beforeDelete() {
      return 'El registro de cambios no se borra: para eso está.';
    },
  },
};
