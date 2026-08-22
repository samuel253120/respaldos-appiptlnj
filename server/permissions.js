/**
 * Roles y matriz de permisos.
 *
 * Acciones posibles por módulo: view, create, edit, delete.
 * '*' como nombre de módulo aplica a todos los módulos.
 *
 * ADMINISTRABLE: para ajustar qué puede hacer cada rol, editar esta matriz.
 * Para agregar un rol nuevo, añadirlo a ROLES y darle sus permisos aquí;
 * aparecerá automáticamente en el formulario de usuarios.
 *
 * El rol es el piso. Encima van los PERFILES DE PERMISOS —que se crean y se
 * editan desde el propio sistema, en su módulo— y encima de todo, las
 * excepciones de cada persona. Ver can() más abajo.
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
    perfiles_permisos: [],
  },
  secretario: {
    '*': RO,
    miembros: RW,
    cuerpos: RW,
    integrantes_cuerpo: RW,
    evaluaciones_integrantes: RW,
    asistencias: RW,
    asistencia_detalle: RW,
    servicios: RW,
    documentos_miembros: RW,
    documentos_iglesias: RW,
    documentos_pastores: RW,
    historial_iglesias: RW,
    historial_pastores: RW,
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
    cuotas_cuerpo: [],
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: [],
  },
  tesorero: {
    '*': RO,
    tesoreria: ALL,
    cuentas_tesoreria: ALL,
    traspasos: ALL,
    cuotas_cuerpo: ALL,
    ayudas_sociales: ALL,
    inventarios: RW,
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: RO, // puede revisarlo, no escribirlo
  },
  consulta: {
    '*': RO,
    tesoreria: [],
    cuentas_tesoreria: [],
    traspasos: [],
    cuotas_cuerpo: [],
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: [],
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

/** Lee una tabla de permisos guardada como JSON, sin reventar. */
function leerTabla(valor) {
  if (!valor) return null;
  try {
    const p = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return p && typeof p === 'object' ? p : null;
  } catch (e) {
    return null;
  }
}

/** Permisos propios de un usuario: sus excepciones, si tiene. */
function permisosPropios(usuario) {
  return usuario ? leerTabla(usuario.permisos) : null;
}

/**
 * Los permisos del perfil que tenga asignado, si tiene.
 *
 * Se lee de la base en el momento, no de una copia guardada en el usuario:
 * de eso se trata que el perfil quede enlazado, que al cambiarlo cambien
 * todos los que lo tienen puesto.
 */
function permisosDelPerfil(usuario) {
  if (!usuario || !usuario.perfil_id) return null;
  // Tardío: db carga los módulos, y los módulos usan este archivo
  const { db } = require('./db');
  const perfil = db.prepare('SELECT permisos FROM perfiles_permisos WHERE id = ?').get(usuario.perfil_id);
  return perfil ? leerTabla(perfil.permisos) : null;
}

/**
 * ¿Puede ejecutar la acción sobre el módulo?
 *
 * Acepta el usuario completo o solo el nombre del rol. De lo más particular
 * a lo más general, gana el primero que diga algo sobre ese módulo:
 *
 *   1. las excepciones de esta persona
 *   2. el perfil que tenga asignado
 *   3. su rol
 *
 * Cada escalón manda solo en los módulos donde diga algo; en los demás pasa
 * la decisión al siguiente.
 */
function can(usuarioOrRol, moduleName, action) {
  const esUsuario = usuarioOrRol && typeof usuarioOrRol === 'object';
  const rol = esUsuario ? usuarioOrRol.rol : usuarioOrRol;

  if (esUsuario) {
    for (const tabla of [permisosPropios(usuarioOrRol), permisosDelPerfil(usuarioOrRol)]) {
      if (tabla && Array.isArray(tabla[moduleName])) return tabla[moduleName].includes(action);
    }
  }
  return permisosDelRol(rol, moduleName).includes(action);
}

/**
 * Lo que le queda a un usuario en cada módulo, ya resuelto. Lo usa el editor
 * para mostrar de dónde sale cada permiso.
 */
function permisosEfectivos(usuario, modulos) {
  const propios = permisosPropios(usuario) || {};
  const delPerfil = permisosDelPerfil(usuario) || {};
  const salida = {};
  for (const nombre of modulos) {
    if (Array.isArray(propios[nombre])) salida[nombre] = { acciones: propios[nombre], origen: 'excepcion' };
    else if (Array.isArray(delPerfil[nombre])) salida[nombre] = { acciones: delPerfil[nombre], origen: 'perfil' };
    else salida[nombre] = { acciones: permisosDelRol(usuario.rol, nombre), origen: 'rol' };
  }
  return salida;
}

module.exports = {
  ROLES, ACCIONES, MATRIX,
  can, permisosDelRol, permisosPropios, permisosDelPerfil, permisosEfectivos,
};
