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
 *
 * Trato: cada miembro muestra cómo se le dice —Hermano, Hermana, Oficial,
 * Pastor o Pastora—, calculado según su género, si pertenece al cuerpo de
 * oficiales y si está registrado en Pastores / Guías (ver server/tratamiento.js).
 * Se puede fijar a mano cuando corresponda otro trato.
 *
 * Matrimonio: al vincular a dos miembros como cónyuges, el vínculo se
 * devuelve solo en la ficha del otro, y las fechas de matrimonio se copian a
 * quien las tenga en blanco, para no registrarlas dos veces.
 */
const { TRATAMIENTOS, tratamientoDe } = require('../tratamiento');

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
  listFields: ['foto', 'tratamiento', 'nombres', 'apellidos', 'rut', 'edad', 'iglesia_id', 'estado'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  computed: [
    {
      name: 'tratamiento', label: 'Trato', type: 'texto',
      calc: (r, { db }) => tratamientoDe(r, db),
    },
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
    {
      name: 'conyuge_id', label: 'Cónyuge (miembro)', type: 'ref', ref: 'miembros',
      showIf: { field: 'estado_civil', in: ['Casado(a)', 'Unión libre', 'Viudo(a)'] },
      help: 'Si su cónyuge también está registrado, elíjalo aquí: el vínculo queda en las dos fichas.',
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
    {
      name: 'tratamiento_personalizado', label: 'Trato (fijado a mano)', type: 'select',
      options: TRATAMIENTOS,
      help: 'Solo si le corresponde un trato distinto del que calcula el sistema. En blanco, se calcula solo.',
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { id, existing, db }) {
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && id && Number(conyuge) === Number(id)) {
        return 'Un miembro no puede figurar como su propio cónyuge';
      }

      // Si esta persona tiene además ficha de pastor, su RUT tiene que ser el
      // mismo en las dos: es la misma persona en los dos registros.
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      if (id && rut) {
        const pastor = db.prepare('SELECT nombres, apellidos, rut FROM pastores WHERE miembro_id = ?').get(id);
        if (pastor && pastor.rut && pastor.rut !== rut) {
          return `El RUT no coincide con el de su ficha en Pastores / Guías (${pastor.nombres} ${pastor.apellidos}: ${pastor.rut}). ` +
            'Corrija el que esté equivocado.';
        }
      }
      return null;
    },

    /**
     * El matrimonio se ve desde los dos lados: al vincular a alguien, su
     * cónyuge queda apuntando de vuelta, se sueltan los vínculos anteriores
     * que quedaran colgando y se copian las fechas de matrimonio a quien las
     * tenga en blanco.
     */
    afterSave(fila, { db }) {
      const conyugeId = fila.conyuge_id || null;

      // Quien estuviera vinculado a esta persona y ya no corresponda, se suelta
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(fila.id, conyugeId || 0);
      if (!conyugeId) return;

      const conyuge = db.prepare('SELECT * FROM miembros WHERE id = ?').get(conyugeId);
      if (!conyuge) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(fila.id);
        return;
      }

      // Si la otra persona venía vinculada a alguien más, ese vínculo se suelta
      if (conyuge.conyuge_id && Number(conyuge.conyuge_id) !== Number(fila.id)) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(conyuge.conyuge_id);
      }

      const campos = ['conyuge_id = ?'];
      const valores = [fila.id];
      for (const f of ['fecha_matrimonio_civil', 'fecha_matrimonio_religioso']) {
        if (fila[f] && !conyuge[f]) {
          campos.push(`"${f}" = ?`);
          valores.push(fila[f]);
        }
      }
      db.prepare(`UPDATE miembros SET ${campos.join(', ')} WHERE id = ?`).run(...valores, conyuge.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
