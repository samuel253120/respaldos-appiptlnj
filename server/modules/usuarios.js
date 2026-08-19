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
 * - Si el usuario tiene iglesia asignada, solo opera sobre esa iglesia.
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
  listFields: ['rut', 'nombre', 'rol', 'iglesia_id', 'activo'],
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
    { name: 'iglesia_id', label: 'Iglesia asignada (vacío = acceso a todas)', type: 'ref', ref: 'iglesias' },
    { name: 'email', label: 'Correo electrónico (contacto, opcional)', type: 'email' },
    { name: 'telefono', label: 'Teléfono (opcional)', type: 'tel' },
    { name: 'activo', label: 'Activo', type: 'boolean', default: 1 },
    {
      name: 'permisos', label: 'Permisos personalizados', type: 'permisos',
      help: 'Opcional. Ajusta módulo por módulo lo que este usuario puede hacer; donde no se ajuste nada, manda su rol.',
    },
  ],
  hooks: {
    beforeSave(data, { isNew, id, db }) {
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
