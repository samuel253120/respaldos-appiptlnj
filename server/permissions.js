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
   * Cerrar una deuda no es lo mismo que anotarla.
   *
   * Anotar que la iglesia debe es trabajo de todos los días, y lo hace quien
   * lleva la tesorería del nivel que corresponda. Declarar que YA NO SE DEBE
   * —darla por pagada o por condonada— cierra el asunto: después de eso la
   * deuda deja de contarse, deja de avisar y deja de aparecer entre lo que hay
   * que pagar. Es la misma separación que ya hay entre corregir un registro y
   * eliminarlo.
   */
  {
    name: 'deudas_cerrar',
    label: 'Cerrar deudas y compromisos',
    group: 'Finanzas',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Dar una deuda por Pagada o por Condonada. Quien no la tenga puede anotarla, corregirla y '
      + 'registrar sus pagos, pero no declarar que ya no se debe. Sirve donde quien lleva el detalle '
      + 'y quien responde por la caja no son la misma persona.',
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
    name: 'sistema_mantenimiento',
    label: 'Dejar el sistema en mantenimiento',
    group: 'Sistema',
    // Una sola acción, como en «restablecer contraseñas de otros»: la llave se
    // tiene o no se tiene. Separar ver de cambiar no diría nada acá.
    acciones: ['view'],
    defecto: ['admin'],
    ayuda:
      'Encender y apagar el modo mantenimiento, que deja a TODA la iglesia fuera del sistema hasta que ' +
      'alguien lo desactive. Vivía dentro del permiso de configuración, así que quien podía corregir el ' +
      'teléfono de la iglesia podía también cerrarle la puerta a todo el mundo. Separado, la configuración ' +
      'se puede delegar sin entregar esa llave.',
  },
  {
    name: 'miembros_identidad',
    label: 'RUT y fecha de nacimiento de las fichas',
    group: 'Datos reservados',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'El RUT y la fecha de nacimiento de los miembros, los pastores y las personas que no son de la ' +
      'iglesia. Son los dos datos con que se suplanta a alguien, y hasta ahora los veía cualquiera que ' +
      'pudiera abrir una ficha. Quien no lo tenga ve la ficha completa menos eso, no lo baja en la ' +
      'planilla y tampoco puede dar con una persona buscando por su RUT. La ficha propia se ve entera ' +
      'siempre.',
  },
  {
    name: 'datos_impresion',
    label: 'Imprimir fichas y documentos',
    group: 'Sacar datos',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'El botón de imprimir de las fichas, los listados y los informes, y las pantallas de impresión. Se ' +
      'separa por lo mismo que bajar la planilla: mirar una ficha en pantalla y salir con ella impresa ' +
      'bajo el brazo no son la misma cosa. Quien no lo tenga sigue viendo y buscando en pantalla como ' +
      'siempre. OJO CON LO QUE ESTA LLAVE NO PUEDE: la hoja se arma en el navegador con datos que esa ' +
      'persona ya está viendo, así que quitarla saca el camino normal de imprimir, pero no impide que ' +
      'alguien decidido use la impresión del propio navegador. Para que un dato no salga impreso, lo que ' +
      'corresponde es no dejar que lo vea.',
  },
  {
    name: 'avisos_enviar',
    label: 'Enviar mensajes a los usuarios',
    group: 'Sistema',
    acciones: ['view'],
    defecto: ['admin'],
    ayuda:
      'Escribir un mensaje y mandárselo a las personas que usan el sistema: llega a su campanita y, '
      + 'si lo tienen encendido, también a su teléfono. Solo se puede mandar a quien uno ya alcanza en '
      + 'Usuarios, así que esta llave no amplía a quién se ve. Queda constancia de cada envío —quién lo '
      + 'mandó, a cuántos y qué decía— y de cuántos lo leyeron.',
  },
  {
    name: 'solicitudes_tramitar',
    label: 'Trasladar y cerrar solicitudes de otros',
    group: 'Sistema',
    acciones: ['view'],
    defecto: ['admin'],
    ayuda:
      'Mover una solicitud a otro responsable, o darla por cerrada, cuando uno no es quien la tiene a ' +
      'cargo. Quien es el responsable actual siempre puede hacerlo con las suyas, tenga o no esta llave: ' +
      'esto es para quien coordina y necesita destrabar las de los demás sin ser administrador.',
  },
  {
    name: 'miembros_foto',
    label: 'Fotografías de las personas',
    group: 'Datos reservados',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'La fotografía de la ficha de un miembro, un pastor o un no miembro. Quien no la tenga ve la ' +
      'ficha completa con las iniciales en lugar de la foto. Sirve para quien administra datos —una ' +
      'planilla de cuotas, una lista de asistencia— y no necesita ver las caras de la congregación.',
  },
  {
    name: 'tesoreria_montos',
    label: 'Montos del dinero',
    group: 'Tesorería',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Las cantidades: los montos de cada movimiento, los saldos de las cuentas y los totales de los ' +
      'informes. Quien no la tenga ve QUÉ se movió y CUÁNDO —la fecha, el concepto, la categoría—, ' +
      'pero no cuánto. Es para quien lleva el registro de lo que entra y sale sin tener por qué saber ' +
      'las cifras de la iglesia.',
  },
  {
    name: 'datos_borrar',
    label: 'Eliminar registros',
    group: 'Sistema',
    acciones: ['view'],
    defecto: 'todos',
    ayuda:
      'Va POR ENCIMA del permiso de eliminar de cada módulo: quien no la tenga no borra nada, aunque ' +
      'en algún módulo figure que sí puede. Sirve para separar dos cosas que hasta ahora iban juntas: ' +
      'corregir un dato mal escrito, que se hace todos los días, y hacer desaparecer un registro, que ' +
      'casi nunca corresponde. Quitarla no impide trabajar; impide equivocarse de manera definitiva.',
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
    personas_solicitud: RW,
    documentos_solicitudes: RW,
    historial_solicitudes: RW,
    inventarios: RW,
    ayudas_sociales: RW,
    no_miembros: RW,
    tesoreria: [],
    deudas: [],
    cuentas_tesoreria: [],
    categorias_tesoreria: [],
    traspasos: [],
    cuotas_cuerpo: [],
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: [],
    /*
     * Las listas que la iglesia mantiene: quien pasa lista y lleva las actas
     * necesita poder agregar un tipo de actividad o un motivo de ausencia en el
     * momento, o termina anotando todo como «Otro motivo» —que es no anotar—.
     * Los formatos de certificado NO: cambiarlos altera cómo se imprimen todos
     * los certificados de la iglesia, incluidos los ya emitidos.
     */
    tipos_actividad: RW,
    motivos_ausencia: RW,
    formatos_certificado: RO,
  },
  tesorero: {
    '*': RO,
    ...llavesDeFabrica('tesorero'),
    credenciales: [], // punto 12.3
    tesoreria: ALL,
    deudas: ALL,
    cuentas_tesoreria: ALL,
    categorias_tesoreria: ALL,
    traspasos: ALL,
    cuotas_cuerpo: ALL,
    ayudas_sociales: ALL,
    no_miembros: ALL,
    inventarios: RW,
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: RO, // puede revisarlo, no escribirlo
    // Las listas de la iglesia no son de tesorería: las mira, no las mantiene
    tipos_actividad: RO,
    motivos_ausencia: RO,
    formatos_certificado: RO,
  },
  consulta: {
    '*': RO,
    ...llavesDeFabrica('consulta'),
    credenciales: [], // punto 12.3
    /*
     * LO DE LA GENTE EN SITUACIÓN VULNERABLE NO ES DE CONSULTA GENERAL.
     *
     * Las fichas de No Miembros son de gente en situación vulnerable y las
     * lleva quien administra las ayudas. Quien solo consulta no entra.
     *
     * Acá decía además que «le basta con el nombre que aparece en la ayuda que
     * esté mirando», y eso describía algo distinto de lo que pasaba: la puerta
     * se cerraba de un lado y quedaba abierta del otro. Medido con un usuario
     * de rol consulta recién creado, contra el sistema andando:
     *
     *   listar No Miembros / abrir una ficha .....  403 · 403
     *   listar Ayudas Sociales ...................  200, las seis
     *   abrir una ayuda con sus notas ............  200 — «está en tratamiento
     *                                                oncológico»
     *   bajar la boleta adjunta ..................  200
     *   el historial completo de una señora ......  200 · 5 ayudas, $123.000
     *   el informe, con nombre y apellido ........  200
     *   bajarlo todo en planilla, notas incluidas   200 · 6 filas
     *
     * Ver un nombre de paso no es poder listar a todas las personas que la
     * iglesia ayudó, leer por qué, cuánto se les dio y qué se anotó de su
     * salud, y llevárselo en un archivo que ya no vuelve. Así que la ayuda
     * social se cierra por la misma razón por la que se cerró No Miembros, y
     * las dos quedan juntas para que nadie abra una sin ver la otra.
     *
     * Quien de verdad la necesite la recibe por su nombre: en Usuarios,
     * «Excepciones para esta persona» le devuelve el módulo sin abrírselo al
     * resto del rol.
     */
    no_miembros: [],
    ayudas_sociales: [],
    tesoreria: [],
    deudas: [],
    cuentas_tesoreria: [],
    categorias_tesoreria: [],
    traspasos: [],
    cuotas_cuerpo: [],
    usuarios: [],
    perfiles_permisos: [],
    registro_cambios: [],
    // Quien consulta no mantiene ninguna de las listas de la iglesia
    tipos_actividad: RO,
    motivos_ausencia: RO,
    formatos_certificado: RO,
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
 * Lo que esta persona puede hacer en un módulo, como se lo dice la descripción
 * del sistema a la pantalla.
 *
 * No es solo la matriz de permisos: es la matriz Y lo que el módulo admite. Un
 * módulo que se escribe solo —el Registro de Cambios— le contesta 400 a
 * cualquiera, y la pantalla igual le ofrecía al administrador «Nuevo cambio
 * registrado», «Importar» y el lápiz y el tarro de basura de cada fila, porque
 * miraba únicamente sus permisos. Un botón que promete algo que el sistema se
 * niega a hacer por diseño no enseña nada: contesta con un error después de
 * apretarlo.
 *
 * Vive acá y no dentro de la ruta que arma esa descripción para que se pueda
 * comprobar sin levantar el servidor, que es lo mismo que se hizo con la
 * descripción de un campo (ver server/meta-liviana.js).
 */
function loQuePuedeHacerEn(def, usuario) {
  const seEscribeSolo = !!def.soloLectura;
  return {
    view: can(usuario, def.name, 'view'),
    create: !seEscribeSolo && can(usuario, def.name, 'create'),
    edit: !seEscribeSolo && can(usuario, def.name, 'edit'),
    delete: !seEscribeSolo && can(usuario, def.name, 'delete'),
  };
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
      name: m.name, label: m.label, group: m.group, acciones,
      // Un módulo puede explicar qué significa concederlo. Hace falta donde el
      // nombre no alcanza: «Formatos de Certificado» no dice que cambiarlos
      // altera cómo se imprimen los certificados YA emitidos.
      ayuda: m.ayudaPermiso || null,
      esLlave: false,
    })),
    ...LLAVES.map((l) => ({
      name: l.name, label: l.label, group: l.group, acciones: l.acciones, ayuda: l.ayuda, esLlave: true,
    })),
  ];
}

/**
 * TODO lo que una ficha de usuario concede, ya resuelto, en una lista plana.
 *
 * Cada entrada es «módulo:acción». Sirve para comparar dos fichas y saber qué
 * gana la persona con un cambio, que es lo que hace falta para no dejar que
 * nadie conceda lo que él mismo no tiene.
 *
 * Se resuelve con las mismas tres capas de siempre —la excepción, el perfil y
 * el rol— porque lo que importa no es en cuál de las tres está escrito, sino
 * qué puede hacer la persona al final.
 */
function loQueConcede(usuario) {
  const salida = new Set();
  for (const cosa of todoLoQueSePuedePermitir()) {
    for (const accion of cosa.acciones) {
      if (can(usuario, cosa.name, accion)) salida.add(`${cosa.name}:${accion}`);
    }
  }
  return salida;
}

/**
 * Lo que la segunda ficha da y la primera no.
 *
 * Devuelve la lista de «módulo:acción» que se GANAN con el cambio. Lo que se
 * pierde no se mira: quitarle permisos a alguien no es escalar, y quien
 * administra cuentas tiene que poder hacerlo.
 */
function loQueSeGana(antes, despues) {
  const tenia = loQueConcede(antes);
  return [...loQueConcede(despues)].filter((x) => !tenia.has(x));
}

/** Cómo se llama un permiso cuando hay que nombrarlo en un aviso. */
function nombreDelPermiso(clave) {
  const [modulo, accion] = String(clave).split(':');
  const cosa = todoLoQueSePuedePermitir().find((c) => c.name === modulo);
  const laAccion = ACCIONES.find((a) => a.value === accion);
  return `${(cosa && cosa.label) || modulo} · ${(laAccion && laAccion.label) || accion}`;
}

module.exports = {
  ROLES, ACCIONES, MATRIX, SALUD, LLAVES, llavesDeFabrica, todoLoQueSePuedePermitir,
  loQuePuedeHacerEn,
  can, permisosDelRol, permisosPropios, permisosDelPerfil, permisosEfectivos,
  loQueConcede, loQueSeGana, nombreDelPermiso,
};
