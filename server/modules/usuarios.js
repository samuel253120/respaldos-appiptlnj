/**
 * Módulo: Usuarios del sistema.
 *
 * El identificador de acceso es el RUT: no cambia y es único por persona
 * (el correo electrónico sí puede cambiar, por eso es solo un dato de
 * contacto). El RUT se valida con su dígito verificador y se guarda
 * normalizado como "12345678-9".
 *
 * - La contraseña se cifra con bcrypt antes de guardar (hook beforeSave).
 * - Al editar, dejar la contraseña vacía la mantiene sin cambios.
 * - No se puede eliminar el propio usuario ni el último administrador.
 *
 * Alcance: a cada usuario se le puede asignar **una o varias iglesias** y,
 * dentro de ellas, **uno o varios cuerpos**. Solo ve y administra los datos de
 * lo que tenga asignado; sin iglesias asignadas ve todas, y sin cuerpos
 * asignados ve todos los de sus iglesias (ver server/alcance.js).
 */
const bcrypt = require('bcryptjs');
const { ROLES } = require('../permissions');

module.exports = {
  name: 'usuarios',
  label: 'Usuarios',
  labelSingular: 'Usuario',
  icon: '🔐',
  group: 'Administración',
  order: 90,
  display: '{nombre}',
  searchFields: ['nombre', 'rut', 'email'],
  listFields: ['rut', 'nombre', 'rol', 'iglesias', 'cuerpos', 'activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'rut', label: 'RUT (usuario de acceso)', type: 'rut', required: true, unique: true,
      help: 'Con o sin puntos, con guion y dígito verificador. Ej: 12.345.678-5',
    },
    { name: 'nombre', label: 'Nombre completo', type: 'text', required: true },
    { name: 'password', label: 'Contraseña', type: 'password', required: true, help: 'Al editar, dejar vacío para no cambiarla' },
    {
      name: 'rol', label: 'Rol', type: 'select', required: true, default: 'consulta',
      options: ROLES.map((r) => ({ value: r.value, label: r.label })),
    },
    {
      name: 'iglesias', label: 'Iglesias que administra', type: 'multiref', ref: 'iglesias',
      help: 'Solo verá los datos de estas iglesias. Sin ninguna marcada, ve todas.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia principal', type: 'ref', ref: 'iglesias',
      help: 'Con cuál trabaja por omisión (la que se propone al crear registros). Tiene que estar entre las de arriba.',
    },
    {
      name: 'cuerpos', label: 'Cuerpos que administra', type: 'multiref', ref: 'cuerpos',
      help: 'Opcional. Marcando alguno, dentro de sus iglesias solo verá lo de esos cuerpos: sus integrantes, actividades, actas, inventario y directivas. Sin ninguno, ve todos los de sus iglesias.',
    },
    { name: 'email', label: 'Correo electrónico (contacto, opcional)', type: 'email' },
    { name: 'telefono', label: 'Teléfono (opcional)', type: 'tel' },
    { name: 'activo', label: 'Activo', type: 'boolean', default: 1 },
    {
      name: 'permisos', label: 'Permisos personalizados', type: 'permisos',
      help: 'Opcional. Ajusta módulo por módulo lo que este usuario puede hacer; donde no se ajuste nada, manda su rol.',
    },
  ],
  hooks: {
    beforeSave(data, { isNew, id, existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const lista = (v) => {
        if (Array.isArray(v)) return v.map(Number).filter(Boolean);
        try {
          return JSON.parse(v || '[]').map(Number).filter(Boolean);
        } catch (e) {
          return [];
        }
      };

      const iglesias = lista(dato('iglesias'));
      const principal = dato('iglesia_id') ? Number(dato('iglesia_id')) : null;

      // La iglesia principal tiene que ser una de las asignadas
      if (principal && iglesias.length && !iglesias.includes(principal)) {
        const ig = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(principal);
        return `La iglesia principal (${ig ? ig.nombre : '#' + principal}) tiene que estar entre las iglesias que administra`;
      }
      // Con una sola iglesia asignada, esa queda de principal sin tener que repetirla
      if (!principal && iglesias.length === 1) data.iglesia_id = iglesias[0];

      // Los cuerpos asignados tienen que ser de sus iglesias
      const cuerpos = lista(dato('cuerpos'));
      if (cuerpos.length && iglesias.length) {
        for (const cuerpoId of cuerpos) {
          const c = db.prepare('SELECT nombre, iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
          if (c && c.iglesia_id && !iglesias.includes(Number(c.iglesia_id))) {
            return `El cuerpo "${c.nombre}" no pertenece a las iglesias que administra este usuario`;
          }
        }
      }

      if (data.email) {
        data.email = String(data.email).trim().toLowerCase();
        const dup = db
          .prepare('SELECT id FROM usuarios WHERE lower(email) = ? AND id != ?')
          .get(data.email, id || 0);
        if (dup) return 'Ya existe un usuario con ese correo electrónico';
      }
      if (data.password) {
        if (String(data.password).length < 6) return 'La contraseña debe tener al menos 6 caracteres';
        data.password = bcrypt.hashSync(String(data.password), 10);
      } else if (!isNew) {
        delete data.password; // conservar la contraseña actual
      }
      return null;
    },
    beforeDelete(row, { user, db }) {
      if (row.id === user.id) return 'No puede eliminar su propio usuario';
      if (row.rol === 'admin') {
        const admins = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin' AND activo = 1").get().c;
        if (admins <= 1) return 'No se puede eliminar el último administrador del sistema';
      }
      return null;
    },
  },
};
