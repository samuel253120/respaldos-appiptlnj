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
    actas_reuniones: RW,
    actas_asambleas: RW,
    documentos: RW,
    certificados: RW,
    credenciales: RW,
    solicitudes: RW,
    inventarios: RW,
    ayudas_sociales: RW,
    tesoreria: [],
    usuarios: [],
  },
  tesorero: {
    '*': RO,
    tesoreria: ALL,
    ayudas_sociales: ALL,
    inventarios: RW,
    usuarios: [],
  },
  consulta: {
    '*': RO,
    tesoreria: [],
    usuarios: [],
  },
};

/** ¿Puede el rol ejecutar la acción sobre el módulo? */
function can(role, moduleName, action) {
  const perms = MATRIX[role];
  if (!perms) return false;
  const specific = perms[moduleName];
  const actions = specific !== undefined ? specific : perms['*'] || [];
  return actions.includes(action);
}

module.exports = { ROLES, MATRIX, can };
