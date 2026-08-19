/**
 * Módulo: Miembros (membresía de cada iglesia).
 *
 * La edad se calcula sola a partir de la fecha de nacimiento: no se guarda,
 * se resuelve cada vez que se lee la ficha, así nunca queda desactualizada.
 *
 * Las fechas de matrimonio (civil y religioso) solo aparecen cuando el estado
 * civil es "Casado(a)". Si más adelante cambia el estado, el dato no se
 * pierde: queda guardado, solo deja de mostrarse.
 *
 * Los documentos del miembro (carnet, ficha de registro, ficha de
 * actualización, etc.) van en su propio módulo, para poder adjuntar todos los
 * que hagan falta a una misma persona.
 */

/** Años cumplidos a la fecha de hoy. */
function edadEnAnios(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(nace.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nace.getFullYear();
  const mes = hoy.getMonth() - nace.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nace.getDate())) anios--;
  return anios >= 0 && anios < 130 ? anios : null;
}

/** Meses cumplidos, para los menores de un año. */
function mesesDeVida(fechaNacimiento) {
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  const hoy = new Date();
  let meses = (hoy.getFullYear() - nace.getFullYear()) * 12 + (hoy.getMonth() - nace.getMonth());
  if (hoy.getDate() < nace.getDate()) meses--;
  return Math.max(0, meses);
}

module.exports = {
  name: 'miembros',
  label: 'Miembros',
  labelSingular: 'Miembro',
  icon: '🧍',
  group: 'Personas',
  order: 20,
  display: '{nombres} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email'],
  listFields: ['foto', 'rut', 'nombres', 'apellidos', 'edad', 'iglesia_id', 'telefono', 'estado'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  computed: [
    {
      name: 'edad', label: 'Edad', type: 'texto',
      calc: (r) => {
        const a = edadEnAnios(r.fecha_nacimiento);
        if (a == null) return '';
        if (a > 0) return `${a} año${a === 1 ? '' : 's'}`;
        const m = mesesDeVida(r.fecha_nacimiento); // los más pequeños, en meses
        return `${m} mes${m === 1 ? '' : 'es'}`;
      },
    },
  ],
  fields: [
    { name: 'nombres', label: 'Nombres', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true,
      help: 'Con o sin puntos. Se valida el dígito verificador y evita miembros repetidos.',
    },
    {
      name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date',
      mostrarEdad: true, help: 'La edad se calcula sola.',
    },
    {
      name: 'genero', label: 'Género', type: 'select',
      options: ['Femenino', 'Masculino'],
    },
    {
      name: 'estado_civil', label: 'Estado civil', type: 'select',
      options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Viudo(a)', 'Divorciado(a)'],
    },
    {
      name: 'fecha_matrimonio_civil', label: 'Fecha de matrimonio civil', type: 'date',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    {
      name: 'fecha_matrimonio_religioso', label: 'Fecha de matrimonio por la iglesia', type: 'date',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'ocupacion', label: 'Ocupación', type: 'text' },
    { name: 'documento_identidad', label: 'Otro documento (pasaporte / extranjero)', type: 'text' },
    { name: 'fecha_conversion', label: 'Fecha de conversión', type: 'date' },
    { name: 'fecha_bautismo', label: 'Fecha de bautismo', type: 'date' },
    { name: 'fecha_ingreso', label: 'Fecha de ingreso a la iglesia', type: 'date' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'En disciplina', 'Trasladado', 'Fallecido'],
    },
    {
      name: 'foto', label: 'Foto', type: 'file', accept: 'image/*',
      help: 'Se puede sacar con el teléfono: al subirla se ajusta sola de tamaño para que cargue rápido.',
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
