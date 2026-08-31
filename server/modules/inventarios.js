/**
 * Módulo: Inventarios (los bienes de la organización).
 *
 * Qué hay, cuánto, en qué estado, dónde está y quién lo tiene a cargo. La
 * organización tiene TRES niveles y los bienes también: hay cosas de la
 * corporación entera —lo que se usa en las asambleas, un vehículo—, cosas de
 * una iglesia local y cosas de un cuerpo o grupo, compradas con su propia
 * tesorería.
 *
 * EL NIVEL SE ELIGE, NO SE DEDUCE. Antes no había campo de nivel: se sacaba de
 * si «Cuerpo / Grupo» venía vacío o lleno, y el propio rótulo del campo tenía
 * que explicarlo —«Cuerpo / Grupo (vacío = inventario general de la
 * iglesia)»—. Eso alcanzaba para dos niveles y dejaba fuera el tercero, porque
 * «Iglesia» era obligatorio: medido, guardar un artículo de la corporación
 * contestaba 400 «El campo "Iglesia" es obligatorio». Un bien de la
 * organización había que colgárselo a alguna congregación, y ahí quedaba
 * contado como suyo.
 *
 * Es el mismo campo «Nivel» de una cuenta de tesorería, con las mismas tres
 * opciones y el mismo mecanismo de mostrar solo lo que ese nivel necesita (ver
 * server/modules/cuentas_tesoreria.js). Dos maneras distintas de decir lo
 * mismo en dos pantallas vecinas no le sirven a nadie.
 *
 * Y LA IGLESIA DE UN BIEN DE CUERPO LA PONE EL CUERPO. Nadie comprobaba que el
 * cuerpo elegido fuera de la iglesia elegida: medido, un artículo con «Iglesia
 * Central» y un cuerpo de la Iglesia Norte entró con un 201, y quedaba contado
 * en las dos partes de la organización a la vez —quien administra ese cuerpo
 * lo veía en su lista mientras la ficha decía que era de la otra—. Se copia,
 * como se copia en las cuentas: no hay nada que elegir, la iglesia de un
 * cuerpo es la de su cuerpo.
 */

/** Los tres niveles, en el orden en que se piensan. */
const NIVELES = ['Corporación', 'Iglesia local', 'Cuerpo / Grupo'];

/**
 * Deja el nivel y sus columnas de acuerdo, o devuelve el aviso de lo que falta.
 *
 * Cada nivel llena exactamente sus columnas y limpia las de los otros: un bien
 * de la corporación no es de ninguna iglesia, y uno de una iglesia no es de
 * ningún cuerpo. Sin esta limpieza, cambiarle el nivel a un artículo ya
 * anotado le dejaba pegada la iglesia o el cuerpo de antes, y el registro
 * decía dos cosas a la vez.
 */
function acomodarElNivel(db, data, dato) {
  const ambito = dato('ambito');
  if (!NIVELES.includes(ambito)) {
    return `El nivel del artículo tiene que ser uno de estos tres: ${NIVELES.join(', ')}`;
  }

  if (ambito === 'Corporación') {
    data.iglesia_id = null;
    data.cuerpo_id = null;
    return null;
  }

  if (ambito === 'Cuerpo / Grupo') {
    const cuerpoId = dato('cuerpo_id');
    if (!cuerpoId) return 'Indique de qué cuerpo o grupo es el artículo';
    const cuerpo = db.prepare('SELECT id, nombre, iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
    if (!cuerpo) return 'El cuerpo o grupo indicado no existe';
    // La iglesia se copia del cuerpo: es la suya y no hay otra que elegir
    data.iglesia_id = cuerpo.iglesia_id || null;
    return null;
  }

  // Iglesia local
  data.cuerpo_id = null;
  if (!dato('iglesia_id')) return 'Indique de qué iglesia es el artículo';
  return null;
}

module.exports = {
  name: 'inventarios',
  label: 'Inventarios',
  labelSingular: 'Artículo de inventario',
  icon: '📦',
  group: 'Finanzas',
  order: 43,
  display: '{articulo}',
  searchFields: ['articulo', 'categoria', 'ubicacion', 'notas'],
  listFields: ['articulo', 'categoria', 'cantidad', 'estado', 'ambito', 'iglesia_id', 'cuerpo_id'],
  filterFields: ['ambito', 'categoria', 'estado'],
  defaultSort: { field: 'articulo', dir: 'asc' },
  fields: [
    { name: 'articulo', label: 'Artículo', type: 'text', required: true },
    {
      name: 'categoria', label: 'Categoría', type: 'select', default: 'Mobiliario',
      options: ['Mobiliario', 'Equipo de sonido', 'Instrumentos musicales', 'Equipo audiovisual', 'Electrodomésticos', 'Cocina', 'Vehículos', 'Inmuebles', 'Material didáctico', 'Otro'],
    },
    {
      name: 'ambito', label: 'Nivel', type: 'select', required: true, default: 'Iglesia local',
      options: NIVELES,
      help: 'De la corporación (toda la organización), de una iglesia local, o de un cuerpo o grupo, que tiene sus propias cosas.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias',
      showIf: { field: 'ambito', in: ['Iglesia local', 'Cuerpo / Grupo'] },
      help: 'De qué iglesia local es el artículo. En un bien de cuerpo o grupo se toma del cuerpo.',
    },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos',
      showIf: { field: 'ambito', equals: 'Cuerpo / Grupo' },
      help: 'De qué cuerpo o grupo es el artículo.',
    },
    { name: 'cantidad', label: 'Cantidad', type: 'number', required: true, default: 1, min: 0, },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Bueno',
      options: ['Bueno', 'Regular', 'Malo', 'En reparación', 'De baja'],
    },
    { name: 'valor_estimado', label: 'Valor estimado (unitario)', type: 'money', min: 0, },
    { name: 'fecha_adquisicion', label: 'Fecha de adquisición', type: 'date' },
    { name: 'ubicacion', label: 'Ubicación física', type: 'text' },
    { name: 'responsable_id', label: 'Responsable', type: 'ref', ref: 'miembros' },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      return acomodarElNivel(db, data, dato);
    },
  },

  // La lista la necesita también la puesta al día de server/migraciones.js, y
  // escribirla dos veces es tener dos listas que un día van a decir cosas
  // distintas
  NIVELES,
};
