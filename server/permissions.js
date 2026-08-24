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

/**
 * Los datos de salud de la ficha de un miembro —enfermedades, alergias,
 * indicaciones médicas, nota importante— no son un módulo: son una parte de
 * Miembros que no todos tienen por qué leer. Se controlan con esta entrada
 * reservada, para no inventar un mecanismo aparte por un solo caso.
 *
 * Tiene que estar escrita rol por rol, sin depender del comodín '*': si no,
 * cualquiera que pueda ver algo la heredaría, que es justo lo que se está
 * corrigiendo. Ver server/sensibles.js.
 */
const SALUD = 'miembros_salud';

/**
 * Las llaves del sistema: lo que se puede permitir y no es un módulo.
 *
 * El editor de permisos mostraba los treinta y dos módulos y nada más, así que
 * había cosas que el sistema sí comprueba y que no se podían ni ver ni ajustar
 * desde ahí:
 *
 *   · los DATOS DE SALUD de una ficha ya se controlaban con `miembros_salud`,
 *     pero como no aparecía en la lista no había manera de dárselos a una
 *     secretaria concreta ni de quitárselos a un pastor concreto. Se cumplía
 *     una regla que nadie podía leer ni cambiar;
 *
 *   · la CONFIGURACIÓN, los RESPALDOS y el TRASPASO desde el sistema anterior
 *     no eran permisos de ninguna clase: estaban escritos como «solo si el rol
 *     es admin». Eso obligaba a hacer administrador general a quien solo tenía
 *     que bajarse el respaldo una vez al mes.
 *
 * Ahora son llaves como cualquier otra y se ajustan en el mismo lugar. Los
 * valores por defecto de abajo dejan las tres exactamente donde estaban —solo
 * el administrador—, así que nada cambia mientras nadie las conceda a
 * propósito. Lo que cambia es que ahora se puede.
 *
 * Cada llave dice qué acciones tienen sentido para ella: «eliminar la
 * configuración» no significa nada, y ofrecerlo sería ruido.
 */
const LLAVES = [
  {
    name: SALUD,
    label: 'Datos de salud de las fichas',
    group: 'Datos reservados',
    acciones: ['view'],
    // De fábrica la tienen el administrador y el pastor: son quienes responden
    // por la gente de la iglesia. Al resto se le concede a mano si hace falta.
    defecto: ['admin', 'pastor'],
    ayuda:
      'Las enfermedades, las alergias, las indicaciones médicas y la nota importante de la ficha ' +
      'de un miembro. Quien no lo tenga ve la ficha completa menos eso, y se le avisa que hay algo ' +
      'que no está viendo.',
  },
  {
    name: 'sistema_configuracion',
    label: 'Configuración del sistema',
    group: 'Sistema',
    acciones: ['view', 'edit'],
    defecto: ['admin'],
    ayuda:
      'La pantalla de Configuración: la identidad de la institución, el porcentaje de las ofrendas, ' +
      'el modo mantenimiento, el largo de las contraseñas. Incluye ver en qué se usa el disco y ' +
      'revisar los datos que quedaron colgando de borrados antiguos.',
  },
  {
    name: 'sistema_respaldo',
    label: 'Respaldos del sistema',
    group: 'Sistema',
    acciones: ['view', 'create'],
    defecto: ['admin'],
    ayuda:
      'Ver cuándo fue la última copia y bajarse el respaldo completo, que lleva la base entera y ' +
      'todos los documentos. Quien lo tenga puede sacar del servidor una copia de todo, así que ' +
      'conviene dárselo a poca gente.',
  },
  {
    name: 'sistema_importacion',
    label: 'Traspaso desde el sistema anterior',
    group: 'Sistema',
    acciones: ['view', 'create'],
    defecto: ['admin'],
    ayuda:
      'El traspaso masivo de datos del sistema antiguo. Escribe de una vez en casi todos los ' +
      'módulos, así que se maneja igual que el respaldo: poca gente.',
  },

  /*
   * Las tres que siguen son de la otra clase: vienen dadas a TODOS y existen
   * para poder QUITÁRSELAS a alguien. Son cosas que hasta ahora hacía cualquiera
   * que pudiera abrir la ficha o el listado, y que no siempre corresponden. Al
   * venir concedidas de fábrica, nada cambia mientras nadie las quite a
   * propósito; lo que cambia es que ahora se pueden quitar.
   */
  {
    name: 'miembros_contacto',
    label: 'Datos de contacto de las fichas',
    group: 'Datos reservados',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'El teléfono, el correo y la dirección de los miembros y de los pastores. Quien no lo tenga ' +
      've la ficha completa menos eso, tampoco lo baja en la planilla y tampoco puede dar con una ' +
      'persona buscando por su número. Sirve para quien tiene que consultar el registro sin ' +
      'llevarse los datos de contacto de la congregación.',
  },
  {
    name: 'datos_planilla',
    label: 'Bajar listados a planilla',
    group: 'Sacar datos',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'El botón que baja un listado completo a Excel. Ver a una persona en pantalla y bajarse las ' +
      'ciento setenta y nueve fichas con sus teléfonos y direcciones no son lo mismo: esto separa ' +
      'las dos cosas. Quien no lo tenga sigue viendo y buscando en pantalla como siempre.',
  },
  /*
   * La tesorería no es una sola: hay dos, y hasta ahora eran el mismo permiso.
   *
   * La corporación y cada iglesia llevan su tesorería general; cada cuerpo o
   * grupo lleva la suya, con sus cuentas, sus movimientos y las cuotas de sus
   * integrantes. Eran un solo módulo, así que dar «Tesorería» daba las dos: no
   * había manera de dejar que la tesorera de un cuerpo llevara la plata de su
   * cuerpo sin abrirle también el libro de la iglesia, ni al revés.
   *
   * Con estas dos llaves se separan. Lo que acota a QUÉ cuerpo alcanza sigue
   * siendo, como siempre, los cuerpos asignados en la ficha del usuario: esto
   * dice de qué NIVEL puede ver la plata, y aquello sobre cuál.
   */
  {
    name: 'tesoreria_general',
    label: 'Tesorería de la iglesia y la corporación',
    group: 'Finanzas',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Las cuentas y los movimientos de la corporación y de cada iglesia local, y los traspasos ' +
      'entre ellas. Quien no la tenga puede llevar la tesorería de su cuerpo sin ver el libro de ' +
      'la iglesia.',
  },
  {
    name: 'tesoreria_cuerpo',
    label: 'Tesorería de los cuerpos y grupos',
    group: 'Finanzas',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Las cuentas propias de cada cuerpo o grupo, sus movimientos y las cuotas de sus ' +
      'integrantes. Quien no la tenga lleva la tesorería de la iglesia sin entrar en la plata de ' +
      'los cuerpos. Sobre cuáles alcanza lo siguen diciendo los cuerpos asignados en su ficha.',
  },
  /**
   * La credencial la firma el Pastor Presidente, no el sistema.
   *
   * De ahí que emitir y revocar no vayan con el permiso de «editar
   * credenciales» (punto 12.2). Preparar el borrador de una credencial es
   * trabajo de oficina y se le puede dar a quien lleva la iglesia; ponerle el
   * número de serie y entregarla —o anularla después— es una decisión de la
   * corporación, y esas dos son las que no se deshacen: el número no se
   * reutiliza nunca, y una credencial revocada deja de valer en el momento
   * para cualquiera que escanee su código.
   *
   * Por eso son dos llaves y no una: hay quien tiene que poder emitir sin
   * poder anular lo que ya anda circulando.
   */
  {
    name: 'credencial_emitir',
    label: 'Emitir credenciales pastorales',
    group: 'Credenciales',
    acciones: ['view'],
    defecto: ['admin'],
    ayuda:
      'Poner en vigencia una credencial: el sistema le asigna su número de serie —que no se ' +
      'reutiliza nunca— y congela los datos que salen impresos. Quien no la tenga puede preparar el ' +
      'borrador y dejarlo listo, pero no entregarlo. De fábrica es solo del administrador, porque la ' +
      'credencial la firma el Pastor Presidente.',
  },
  {
    name: 'credencial_revocar',
    label: 'Revocar credenciales pastorales',
    group: 'Credenciales',
    acciones: ['view'],
    defecto: ['admin'],
    ayuda:
      'Anular una credencial ya entregada por pérdida, robo o cese del cargo. Desde ese momento, ' +
      'quien escanee su código QR verá que no es válida. Exige escribir el motivo y queda en el ' +
      'registro de cambios. De fábrica es solo del administrador.',
  },
  {
    name: 'usuarios_clave',
    label: 'Restablecer contraseñas de otros',
    group: 'Sistema',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Devolver la cuenta de otra persona a su contraseña inicial y habilitarle la recuperación. ' +
      'Es la llave que permite entrar como esa persona, así que puede convenir que no la tenga ' +
      'todo el que puede corregir un nombre mal escrito. Solo hace algo en quien además pueda ' +
      'editar Usuarios.',
  },
];

/**
 * Lo que un rol trae de fábrica en las llaves.
 *
 * Cada llave lo dice de sí misma —`defecto`—, en vez de estar repartido rol por
 * rol en la matriz: así, al agregar una llave nueva, no hay que acordarse de
 * tocar los cinco roles, que es exactamente la clase de olvido que deja un
 * permiso concedido sin querer.
 *
 * Tiene que quedar escrito rol por rol y no depender del comodín '*': si se
 * heredaran de él, cualquiera que pueda ver algo se llevaría también las
 * llaves, que es justo lo que se corrigió en su día con los datos de salud.
 */
function llavesDeFabrica(rol) {
  const salida = {};
  for (const l of LLAVES) {
    const tiene = l.defecto === 'todos' || (Array.isArray(l.defecto) && l.defecto.includes(rol));
    salida[l.name] = tiene ? l.acciones : [];
  }
  return salida;
}

const ALL = ['view', 'create', 'edit', 'delete'];
const RW = ['view', 'create', 'edit'];
const RO = ['view'];

const MATRIX = {
  admin: {
    '*': ALL,
    ...llavesDeFabrica('admin'), // las tiene todas
  },
  pastor: {
    '*': ALL,
    // Ve los datos de salud; no toca la configuración ni los respaldos
    ...llavesDeFabrica('pastor'),
    usuarios: [],
    perfiles_permisos: [],
    /**
     * Las credenciales de su iglesia: las ve, y nada más (punto 12.2).
     *
     * Preparar el borrador de una credencial se le concede a mano en su ficha
     * cuando corresponde. No viene de fábrica porque un borrador que después
     * no se puede emitir es trabajo perdido, y porque la decisión de a quién
     * se le extiende una credencial es de la corporación.
     */
    credenciales: RO,
  },
  secretario: {
    '*': RO,
    ...llavesDeFabrica('secretario'),
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
    // El punto 12.3 es explícito: fuera del administrador y del pastor de la
    // iglesia, nadie entra al módulo de credenciales
    credenciales: [],
    solicitudes: RW,
    inventarios: RW,
    ayudas_sociales: RW,
    tesoreria: [],
    cuentas_tesoreria: [],
    categorias_tesoreria: [],
    traspasos: [],
    cuotas_cuerpo: [],
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: [],
  },
  tesorero: {
    '*': RO,
    ...llavesDeFabrica('tesorero'),
    credenciales: [], // punto 12.3
    tesoreria: ALL,
    cuentas_tesoreria: ALL,
    categorias_tesoreria: ALL,
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
    ...llavesDeFabrica('consulta'),
    credenciales: [], // punto 12.3
    tesoreria: [],
    cuentas_tesoreria: [],
    categorias_tesoreria: [],
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

/**
 * Todo lo que se puede permitir, en una sola lista: los módulos y las llaves
 * del sistema. Es lo que consume el editor, para que lo que se ve ahí sea
 * exactamente lo que el sistema comprueba, sin nada escondido.
 */
function todoLoQueSePuedePermitir() {
  const { allModules } = require('./registry');
  const acciones = ACCIONES.map((a) => a.value);
  return [
    ...allModules().map((m) => ({
      name: m.name, label: m.label, group: m.group, acciones, ayuda: null, esLlave: false,
    })),
    ...LLAVES.map((l) => ({
      name: l.name, label: l.label, group: l.group, acciones: l.acciones, ayuda: l.ayuda, esLlave: true,
    })),
  ];
}

module.exports = {
  ROLES, ACCIONES, MATRIX, SALUD, LLAVES, llavesDeFabrica, todoLoQueSePuedePermitir,
  can, permisosDelRol, permisosPropios, permisosDelPerfil, permisosEfectivos,
};
