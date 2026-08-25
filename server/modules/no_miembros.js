/**
 * Módulo: No Miembros (personas que no pertenecen a la iglesia).
 *
 * Existe por las ayudas sociales. La mayoría de las ayudas que se entregan no
 * son para miembros: son para gente del barrio que llegó a pedir. Hasta ahora
 * el beneficiario se escribía a mano en la ayuda, así que no había forma de
 * saber a cuántas personas distintas se ha ayudado, ni de ver que a la misma
 * señora se le entregó tres veces, ni de encontrar su teléfono el día que hay
 * que avisarle algo. Cada ayuda era un nombre suelto.
 *
 * Es un registro aparte del de Miembros, a propósito. No son miembros y no
 * tienen que aparecer en los listados de la membresía, ni en los informes de
 * asistencia, ni en las estadísticas de la congregación, ni contarse entre los
 * miembros. Son personas de las que la iglesia lleva una ficha porque las
 * atiende, y nada más.
 *
 * LO QUE ESTA FICHA NO EXIGE ES TAN IMPORTANTE COMO LO QUE GUARDA. En la
 * práctica casi nunca se obtienen todos los datos: se entrega una caja de
 * mercadería y la persona no anda con el carnet, o no quiere dar el teléfono.
 * Por eso lo único obligatorio es el nombre; el RUT, el apellido, el teléfono
 * y todo lo demás quedan opcionales, y la ficha se guarda igual con lo poco
 * que se haya obtenido. Una ficha a medias sirve; una ayuda sin registrar,
 * no.
 *
 * El RUT es opcional, pero cuando se escribe se valida y no puede repetirse:
 * es lo único que permite darse cuenta de que la persona que viene hoy ya
 * tiene ficha de la vez pasada.
 */

/** Años cumplidos a la fecha de hoy, o nada si la fecha no sirve. */
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

/** Cuánto se acerca esta persona a la iglesia, si es que se acerca. */
const CERCANIA = ['No asiste', 'Asiste ocasionalmente', 'Asiste con frecuencia'];

module.exports = {
  name: 'no_miembros',
  label: 'No Miembros',
  labelSingular: 'No Miembro',
  icon: '👤',
  group: 'Personas',
  order: 21, // justo debajo de Miembros, que es el 20
  display: '{nombres} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email', 'direccion'],
  listFields: ['nombres', 'apellidos', 'rut', 'telefono', 'asistencia', 'iglesia_id'],
  filterFields: ['asistencia', 'iglesia_id'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  computed: [
    {
      name: 'edad', label: 'Edad', type: 'texto',
      calc: (r) => {
        const a = edadEnAnios(r.fecha_nacimiento);
        return a == null ? '' : `${a} año${a === 1 ? '' : 's'}`;
      },
    },
  ],
  fields: [
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true,
      help: 'Cuál iglesia lleva esta ficha. Es lo que hace que cada iglesia vea las suyas.' },

    // ---------------- Identificación ----------------
    { name: 'nombres', label: 'Nombres', type: 'text', required: true, seccion: 'Identificación',
      help: 'Lo único obligatorio. Si solo se supo el nombre de pila, con eso basta para guardar la ficha.' },
    { name: 'apellidos', label: 'Apellidos', type: 'text',
      help: 'Opcional: muchas veces no se alcanzan a preguntar.' },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true, reservado: 'miembros_identidad',
      help: 'Opcional. Si se escribe, se valida el dígito verificador y no se admite repetido: ' +
        'es lo que permite darse cuenta de que esta persona ya tenía ficha.',
    },
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', mostrarEdad: true,
      help: 'Opcional. La edad se calcula sola.', reservado: 'miembros_identidad' },
    { name: 'genero', label: 'Sexo', type: 'select', options: ['Femenino', 'Masculino'] },

    // ---------------- Contacto ----------------
    { name: 'telefono', label: 'Teléfono', type: 'text', seccion: 'Contacto',
      help: 'Opcional. Si no se obtuvo, la ficha se guarda igual.' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },

    // ---------------- Vínculo con la iglesia ----------------
    {
      name: 'referido_por', label: 'Quién la refirió', type: 'persona', ref: 'miembros',
      seccion: 'Vínculo con la iglesia',
      help: 'Se busca entre los miembros, o se escribe el nombre a mano si quien la refirió no está registrado.',
    },
    { name: 'asistencia', label: 'Se acerca a la iglesia', type: 'select', options: CERCANIA,
      help: 'Para distinguir a quien solo vino a pedir de quien ya se está acercando.' },
    { name: 'conocido_desde', label: 'Se le conoce desde', type: 'date' },

    { name: 'notas', label: 'Notas', type: 'textarea', seccion: 'Notas' },
  ],
};
