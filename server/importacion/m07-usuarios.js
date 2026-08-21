/**
 * Módulo 7 · Usuarios del sistema.
 *
 * Las 8 cuentas del sistema anterior, con dos decisiones tomadas con la
 * iglesia:
 *
 *  - **La contraseña.** No se importa ninguna: cada cuenta entra con la
 *    contraseña inicial del sistema y, al entrar, tiene que cambiarla por una
 *    suya. (El origen traía las contraseñas escritas en texto plano; con más
 *    razón no se traen.)
 *  - **Lo que puede hacer cada uno.** El sistema anterior guardaba los
 *    permisos por persona, no solo por rol: hay un "Administrador" que en
 *    realidad solo veía miembros y grupos. Se respeta lo que cada uno tenía:
 *    el rol se elige por el más parecido y los permisos se escriben uno por
 *    uno, módulo por módulo, de modo que nadie quede con más de lo que tenía.
 *    Todo eso queda editable en Usuarios.
 *
 * Al que era superadministrador y al pastor se les deja su rol completo —
 * administrador y pastor—, que es lo que tenían.
 */
const { db } = require('../db');
const { importarModulo, guardar, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const rut = require('../rut');
const claves = require('../claves');
const bcrypt = require('bcryptjs');
const { allModules } = require('../registry');

/** El rol de acá que más se parece al de allá. */
const ROL = {
  superadmin: 'admin',
  'Super Administrador': 'admin',
  Administrador: 'secretario',
  Pastor: 'pastor',
  'Líder de Grupo': 'consulta',
  Secretario: 'secretario',
  'Secretario de Cuerpo': 'consulta',
};

/** A quién se le respeta el rol completo, sin escribirle permiso por permiso. */
const CON_ROL_COMPLETO = ['superadmin', 'Pastor'];

/**
 * Qué módulo de acá toca cada permiso de allá, y con qué acción.
 * Lo que no está en esta tabla no existía o no tiene equivalente (exportar,
 * importar, ver el panel: acá no son permisos aparte).
 */
const PERMISO = {
  members_view: [['miembros', 'view'], ['documentos_miembros', 'view']],
  members_create: [['miembros', 'create']],
  members_edit: [['miembros', 'edit'], ['documentos_miembros', 'create']],
  members_delete: [['miembros', 'delete']],
  members_suspend: [['miembros', 'edit']],
  members_edit_type: [['miembros', 'edit']],
  members_view_medical: [['miembros', 'view']],

  timeline_view: [['bitacora', 'view']],
  timeline_create: [['bitacora', 'create']],
  timeline_edit: [['bitacora', 'edit']],
  timeline_delete: [['bitacora', 'delete']],

  groups_view: [['cuerpos', 'view'], ['directivas', 'view']],
  groups_create: [['cuerpos', 'create']],
  groups_edit: [['cuerpos', 'edit']],
  groups_delete: [['cuerpos', 'delete']],
  groups_members_manage: [['cuerpos', 'edit']],
  bodies_view: [['cuerpos', 'view']],
  bodies_manage_members: [['cuerpos', 'edit']],
  bodies_write_minutes: [['actas_reuniones', 'view'], ['actas_reuniones', 'create'], ['actas_reuniones', 'edit']],
  bodies_view_minutes: [['actas_reuniones', 'view']],
  bodies_delete_minutes: [['actas_reuniones', 'delete']],
  bodies_manage_inventory: [['inventarios', 'view'], ['inventarios', 'create'], ['inventarios', 'edit']],
  bodies_view_inventory: [['inventarios', 'view']],
  bodies_manage_treasury: [['tesoreria', 'view'], ['tesoreria', 'create'], ['tesoreria', 'edit'], ['cuentas_tesoreria', 'view']],

  attendance_view: [['asistencias', 'view'], ['asistencia_detalle', 'view']],
  attendance_create: [['asistencias', 'create'], ['asistencia_detalle', 'create']],
  attendance_edit: [['asistencias', 'edit'], ['asistencia_detalle', 'edit']],
  attendance_delete: [['asistencias', 'delete'], ['asistencia_detalle', 'delete']],
  attendance_register_edit: [['asistencia_detalle', 'edit']],
  attendance_reports: [['asistencias', 'view']],
  events_view: [['asistencias', 'view']],
  events_create: [['asistencias', 'create']],
  events_edit: [['asistencias', 'edit']],
  events_delete: [['asistencias', 'delete']],

  services_view: [['servicios', 'view']],
  services_create: [['servicios', 'create']],
  services_create_service: [['servicios', 'create']],
  services_edit: [['servicios', 'edit']],
  services_edit_observations: [['servicios', 'edit']],
  services_delete: [['servicios', 'delete']],
  services_view_history: [['servicios', 'view']],

  requests_view: [['solicitudes', 'view']],
  requests_create: [['solicitudes', 'create']],
  requests_edit: [['solicitudes', 'edit']],
  requests_approve: [['solicitudes', 'edit']],
  requests_reassign: [['solicitudes', 'edit']],
  requests_delete: [['solicitudes', 'delete']],
  requests_documents: [['documentos', 'view']],

  treasury_view: [['tesoreria', 'view'], ['cuentas_tesoreria', 'view']],
  treasury_create: [['tesoreria', 'create']],
  treasury_edit: [['tesoreria', 'edit']],
  treasury_delete: [['tesoreria', 'delete']],
  treasury_general_edit: [['cuentas_tesoreria', 'edit']],

  inventory_view: [['inventarios', 'view']],
  inventory_create: [['inventarios', 'create']],
  inventory_edit: [['inventarios', 'edit']],
  inventory_delete: [['inventarios', 'delete']],

  documents_view: [['documentos', 'view'], ['actas_reuniones', 'view'], ['actas_asambleas', 'view']],
  documents_create: [['documentos', 'create']],
  documents_edit: [['documentos', 'edit']],
  documents_delete: [['documentos', 'delete']],
  documents_emit_certificates: [['certificados', 'view'], ['certificados', 'create'], ['credenciales', 'view'], ['credenciales', 'create']],

  social_aid_view: [['ayudas_sociales', 'view']],
  social_aid_create: [['ayudas_sociales', 'create']],
  social_aid_edit: [['ayudas_sociales', 'edit']],
};

/** Los permisos de una persona, módulo por módulo y sin dejar ninguno suelto. */
function permisosDe(usuario) {
  const mapa = {};
  for (const m of allModules()) mapa[m.name] = [];
  mapa.iglesias = ['view']; // todos ven la iglesia en la que trabajan

  for (const codigo of usuario.permissions || []) {
    for (const [modulo, accion] of PERMISO[codigo] || []) {
      if (!mapa[modulo]) mapa[modulo] = [];
      if (!mapa[modulo].includes(accion)) mapa[modulo].push(accion);
    }
  }
  // Ver es condición para lo demás: quien puede crear o editar, puede ver
  for (const [modulo, acciones] of Object.entries(mapa)) {
    if (acciones.length && !acciones.includes('view')) acciones.unshift('view');
  }
  return mapa;
}

module.exports = function importarUsuarios(origen, { lote, prueba, iglesiaId }) {
  const filas = origen.users || [];

  return importarModulo({ nombre: 'usuarios', filas, lote, prueba }, (ayuda) => {
    let creados = 0, actualizados = 0, enlazados = 0, conPermisosPropios = 0;
    const inicial = claves.inicial();
    const porRol = {};

    filas.forEach((u, i) => {
      if (!ayuda.exigir(u.rut, 'usuario sin RUT', i, u)) return;
      if (!rut.validar(u.rut)) {
        ayuda.problema(i, `RUT de usuario inválido: ${u.rut}`, u);
        return;
      }
      const suRut = rut.canonico(u.rut);
      const rol = ROL[u.role] || 'consulta';
      porRol[rol] = (porRol[rol] || 0) + 1;

      // Su ficha de miembro, cuando la tiene: se reconocen por el RUT
      const miembro = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(suRut);
      if (miembro) enlazados++;

      const propios = CON_ROL_COMPLETO.includes(u.role) ? null : permisosDe(u);
      if (propios) conPermisosPropios++;

      const datos = {
        rut: suRut,
        nombre: texto(u.fullName) || suRut,
        email: texto(u.email),
        rol,
        activo: u.active === false ? 0 : 1,
        iglesia_id: iglesiaId,
        miembro_id: miembro ? miembro.id : null,
        permisos: propios ? JSON.stringify(propios) : null,
        created_at: marcaDeTiempo(u._created_at || u.createdAt),
        updated_at: marcaDeTiempo(u._updated_at || u.updatedAt),
      };

      // Nunca se importa una contraseña: entra con la inicial y la cambia
      const existente = equivalencias.resolver('users', u.id)
        || (db.prepare('SELECT id FROM usuarios WHERE rut = ?').get(suRut) || {}).id;
      if (!existente) {
        datos.password = bcrypt.hashSync(inicial, 10);
        datos.password_origen = 'inicial';
        datos.debe_cambiar_password = 1;
      }

      // Si ya existía una cuenta con ese RUT (la del administrador, por
      // ejemplo), se reconoce y se deja anotada en vez de crear otra
      if (existente && !equivalencias.resolver('users', u.id)) {
        equivalencias.registrar('users', u.id, 'usuarios', existente, lote);
      }

      const { nueva } = guardar({
        moduloOrigen: 'users', idOrigen: u.id, tabla: 'usuarios', datos, lote,
      });
      nueva ? creados++ : actualizados++;
    });

    return {
      creados, actualizados, enlazados_a_su_ficha: enlazados,
      con_permisos_propios: conPermisosPropios,
      por_rol: Object.entries(porRol).map(([r, n]) => `${r}: ${n}`).join(', '),
      contrasena: 'la inicial del sistema, con cambio obligatorio al entrar',
    };
  });
};
