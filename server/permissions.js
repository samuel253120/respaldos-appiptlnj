/**
 * Roles y matriz de permisos.
 *
 * Acciones posibles por módulo: view, create, edit, delete.
 * '*' como nombre de módulo aplica a todos los módulos.
 *
 * ADMINISTRABLE: para ajustar qué puede hacer cada rol, editar esta matriz.
 * Para agregar un rol nuevo, añadirlo a ROLES y darle sus permisos aquí;
 * aparecerá automáticamente en el formulario de usuarios.
 */

const ROLES = [
  { value: 'admin', label: 'Administrador' },
  { value: 'pastor', label: 'Pastor / Guía' },
  { value: 'secretario', label: 'Secretario' },
  { value: 'tesorero', label: 'Tesorero' },
  { value: 'consulta', label: 'Solo consulta' },
];

const ALL = ['view', 'create', 'edit', 'delete'];
const RW = ['view', 'create', 'edit'];
const RO = ['view'];

const MATRIX = {
  admin: {
    '*': ALL,
  },
  pastor: {
    '*': ALL,
    usuarios: [],
  },
  secretario: {
    '*': RO,
    miembros: RW,
    cuerpos: RW,
    asistencias: RW,
    asistencia_detalle: RW,
    servicios: RW,
    documentos_miembros: RW,
    actas_reuniones: RW,
    actas_asambleas: RW,
    documentos: RW,
    certificados: RW,
    credenciales: RW,
    solicitudes: RW,
    inventarios: RW,
    ayudas_sociales: RW,
    tesoreria: [],
    cuentas_tesoreria: [],
    traspasos: [],
    usuarios: [],
  },
  tesorero: {
    '*': RO,
    tesoreria: ALL,
    cuentas_tesoreria: ALL,
    traspasos: ALL,
    ayudas_sociales: ALL,
    inventarios: RW,
    usuarios: [],
  },
  consulta: {
    '*': RO,
    tesoreria: [],
    cuentas_tesoreria: [],
    traspasos: [],
    usuarios: [],
  },
};

const ACCIONES = [
  { value: 'view', label: 'Ver' },
  { value: 'create', label: 'Crear' },
  { value: 'edit', label: 'Editar' },
  { value: 'delete', label: 'Eliminar' },
];

/** Permisos que otorga un rol sobre un módulo. */
function permisosDelRol(rol, moduleName) {
  const perms = MATRIX[rol];
  if (!perms) return [];
  const especifico = perms[moduleName];
  return especifico !== undefined ? especifico : perms['*'] || [];
}

/** Permisos personalizados de un usuario, si tiene. */
function permisosPropios(usuario) {
  if (!usuario || !usuario.permisos) return null;
  try {
    const p = typeof usuario.permisos === 'string' ? JSON.parse(usuario.permisos) : usuario.permisos;
    return p && typeof p === 'object' ? p : null;
  } catch (e) {
    return null;
  }
}

/**
 * ¿Puede ejecutar la acción sobre el módulo?
 *
 * Acepta el usuario completo (con sus permisos personalizados) o solo el
 * nombre del rol. Los permisos personalizados reemplazan a los del rol
 * únicamente en los módulos donde estén definidos; en el resto sigue
 * mandando el rol.
 */
function can(usuarioOrRol, moduleName, action) {
  const esUsuario = usuarioOrRol && typeof usuarioOrRol === 'object';
  const rol = esUsuario ? usuarioOrRol.rol : usuarioOrRol;

  if (esUsuario) {
    const propios = permisosPropios(usuarioOrRol);
    if (propios && Array.isArray(propios[moduleName])) {
      return propios[moduleName].includes(action);
    }
  }
  return permisosDelRol(rol, moduleName).includes(action);
}

module.exports = { ROLES, ACCIONES, MATRIX, can, permisosDelRol, permisosPropios };
