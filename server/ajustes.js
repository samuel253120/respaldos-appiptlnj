/**
 * Ajustes del sistema: definición, lectura y escritura de las opciones
 * globales (tabla `configuracion`).
 *
 * Este archivo no depende de Express ni de la autenticación, para que
 * cualquier parte del servidor pueda consultar una opción sin crear
 * dependencias circulares. La interfaz web se atiende en configuracion.js.
 *
 * PARA AGREGAR UNA OPCIÓN: añadirla a OPCIONES y queda disponible en la
 * pantalla de configuración, con su tipo de campo y su valor por defecto.
 */
const { db } = require('./db');

// Si no se puede crear (volumen lleno o de solo lectura), se anota y se sigue:
// el sistema tiene que levantar aunque los ajustes queden con sus valores por
// defecto, para poder entrar a ver qué pasa.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    actualizado_por INTEGER
  )`);
} catch (e) {
  console.error(`⚠️  No se pudo preparar la tabla de configuración: ${e.message}`);
}

const OPCIONES = [
  {
    grupo: 'Mantenimiento',
    items: [
      {
        clave: 'mantenimiento_activo', label: 'Sistema en mantenimiento', tipo: 'boolean', defecto: '0',
        publica: true,
        ayuda: 'Mientras esté activo, solo puede ingresar quien tenga permiso para cambiar esta configuración. El resto verá el aviso de abajo.',
      },
      {
        clave: 'mantenimiento_mensaje', label: 'Aviso que verán los usuarios', tipo: 'textarea',
        defecto: 'El sistema está en mantenimiento. Volveremos en unos minutos.',
        publica: true,
      },
    ],
  },
  {
    grupo: 'Identidad',
    items: [
      {
        clave: 'iglesia_nombre', label: 'Nombre de la institución', tipo: 'text', publica: true,
        defecto: 'Iglesia Pentecostal Triunfante La Nueva Jerusalén',
        ayuda: 'El nombre oficial, tal como debe salir en los certificados, en las credenciales y en todo lo que se imprime.',
      },
      {
        clave: 'iglesia_lema', label: 'Lema', tipo: 'text', defecto: '', publica: true,
        ayuda: 'Va bajo el nombre. Si se deja en blanco, no aparece en ninguna parte.',
      },
      {
        clave: 'iglesia_logo', label: 'Logo', tipo: 'imagen', defecto: '', publica: true,
        ayuda:
          'El emblema que va en la pantalla de acceso, en el menú, arriba de todo lo que se imprime y en la ' +
          'credencial pastoral —ahí sale tres veces: arriba del anverso, arriba del reverso y como marca de ' +
          'agua detrás de los datos—. Mientras no se suba uno, se usa el que trae el sistema. Conviene una ' +
          'imagen cuadrada y con fondo transparente (PNG).',
      },
      {
        clave: 'iglesia_rut', label: 'RUT o personalidad jurídica', tipo: 'text', defecto: '',
        ayuda: 'Va al pie de los certificados y las credenciales, junto a los datos de contacto. En blanco, no aparece.',
      },
      {
        clave: 'iglesia_direccion', label: 'Dirección', tipo: 'text', defecto: '',
        ayuda: 'La casa central o la sede de la corporación. Va al pie de lo que se imprime.',
      },
      {
        clave: 'iglesia_telefono', label: 'Teléfono', tipo: 'text', defecto: '',
      },
      {
        clave: 'iglesia_email', label: 'Correo electrónico', tipo: 'text', defecto: '',
      },
      {
        clave: 'iglesia_web', label: 'Sitio web', tipo: 'text', defecto: '',
      },
    ],
  },
  {
    grupo: 'Organización',
    items: [
      {
        clave: 'cuerpo_oficiales', label: 'Cuerpo de oficiales', tipo: 'text', defecto: 'Oficiales',
        ayuda:
          'Nombre del cuerpo cuyos integrantes pueden ser designados oficial supervisor(a) de los demás ' +
          'cuerpos. Mientras ese cuerpo no exista o no tenga integrantes, se puede elegir a cualquier miembro.',
      },
      {
        clave: 'cuerpos_meses_prueba', label: 'Meses de prueba al entrar a un cuerpo', tipo: 'number', defecto: '3', min: 0, max: 60,
        ayuda:
          'Cuánto dura el período de prueba de quien entra a un cuerpo, antes de evaluar su informe para pasar ' +
          'a integrante oficial. Cada cuerpo puede fijar los suyos en su ficha.',
      },
      {
        clave: 'cuota_registra_tesoreria', label: 'Registrar las cuotas en tesorería', tipo: 'boolean', defecto: '1',
        ayuda:
          'Cada cuota que se marca como pagada entra como ingreso a la tesorería del propio cuerpo. Apáguelo si ' +
          'prefiere que el tesorero del cuerpo las ingrese a mano.',
      },
      {
        clave: 'ofrenda_porcentaje_fondo', label: 'Porcentaje de la ofrenda que aporta a la corporación',
        tipo: 'number', defecto: '10', min: 0, max: 100,
        ayuda:
          'En el Registro de Servicios, la ofrenda entra completa a la tesorería de la iglesia y de ahí sale ' +
          'este porcentaje como aporte para la corporación, que entra a su «Fondo para la corporación».',
      },
      {
        clave: 'ofrenda_registra_tesoreria', label: 'Registrar la ofrenda en tesorería', tipo: 'boolean', defecto: '1',
        ayuda:
          'Al guardar un servicio con ofrenda, el sistema anota tres movimientos: el ingreso de la ofrenda ' +
          'completa en la tesorería de la iglesia, el egreso del aporte a la corporación de esa misma cuenta ' +
          'y el ingreso de ese aporte en su «Fondo para la corporación». Apáguelo si prefiere ingresar las ' +
          'ofrendas a mano en Tesorería.',
      },
    ],
  },
  {
    grupo: 'Acceso',
    items: [
      {
        clave: 'password_inicial', label: 'Contraseña inicial', tipo: 'text', defecto: 'Iglesia2026',
        ayuda:
          'La que se le entrega a cada cuenta nueva y la que restablece el administrador cuando alguien ' +
          'olvida la suya. Al entrar con ella, el sistema obliga a cambiarla por una propia.',
      },
      {
        clave: 'password_minimo', label: 'Largo mínimo de la contraseña', tipo: 'number', defecto: '8', min: 8, max: 40,
        ayuda: 'Cuántos caracteres debe tener, como mínimo, la contraseña que elija cada persona (entre 8 y 40). '
          + 'Además, el sistema no acepta las contraseñas de siempre («123456», «iglesia») ni el propio RUT o nombre de la persona.',
      },
      {
        clave: 'acceso_intentos', label: 'Errores de contraseña antes de cerrar la puerta', tipo: 'number',
        defecto: '5', min: 3, max: 20,
        ayuda:
          'Tras esa cantidad de errores seguidos sobre una misma cuenta, el sistema no acepta más intentos ' +
          'por un rato, y ese rato crece si insisten. Es lo que hace inútil probar contraseñas a máquina. ' +
          'Bajarlo aprieta más; subirlo da más margen a quien se equivoca de verdad.',
      },
      {
        clave: 'recuperacion_activa', label: 'Permitir recuperar la contraseña con una pregunta', tipo: 'boolean', defecto: '1',
        publica: true,
        ayuda:
          'Cada persona define una pregunta secreta desde «Mi cuenta»; si olvida su contraseña, la responde ' +
          'en la pantalla de acceso y elige una nueva. Apagado, solo el administrador puede restablecerla.',
      },
    ],
  },
  {
    grupo: 'Respaldos',
    items: [
      {
        clave: 'respaldo_automatico', label: 'Hacer una copia todas las noches', tipo: 'boolean', defecto: '1',
        ayuda:
          'El sistema guarda solo una copia diaria de la base, comprimida, junto a los datos. Protege de los ' +
          'errores —algo que se borró, un mes mal cargado—, pero no del disco: para eso hay que bajar el ' +
          'respaldo completo y guardarlo en otra parte.',
      },
      {
        clave: 'respaldo_hora', label: 'A qué hora se hace', tipo: 'number', defecto: '3', min: 0, max: 23,
        ayuda:
          'Hora del día (0 a 23) a partir de la cual se hace la copia. Conviene una en que nadie esté ' +
          'trabajando. Si el sistema estuvo apagado a esa hora, la hace en cuanto vuelve.',
      },
      {
        clave: 'respaldo_conservar', label: 'Cuántas copias se guardan', tipo: 'number', defecto: '7', min: 2, max: 60,
        ayuda:
          'Las más viejas se van borrando solas. Con 7 se puede volver a cualquier día de la última semana ' +
          '(entre 2 y 60).',
      },
      {
        clave: 'respaldo_recordar_dias', label: 'Recordar bajar el respaldo cada tantos días', tipo: 'number',
        defecto: '30', min: 7, max: 180,
        ayuda:
          'La copia de todas las noches queda en el mismo disco que los datos, así que no sirve si se pierde ' +
          'el servidor. Pasado este tiempo sin que nadie baje el respaldo completo, el sistema lo recuerda en ' +
          'la pantalla de configuración.',
      },
    ],
  },
  {
    grupo: 'Recursos de la credencial',
    items: [
      {
        clave: 'credencial_sello', label: 'Sello oficial', tipo: 'imagen', defecto: '',
        ayuda:
          'El sello de la corporación. Va dos veces en la credencial: completo en el reverso, y cruzando la ' +
          'fotografía del anverso como marca de seguridad. Conviene un PNG con fondo transparente. Sin él no ' +
          'se puede emitir ni imprimir.',
      },
      {
        clave: 'credencial_firma', label: 'Firma del Pastor Presidente', tipo: 'imagen', defecto: '',
        ayuda:
          'Va sobre la línea de firma del reverso. Conviene un PNG con fondo transparente, recortado justo a ' +
          'la firma. Sin ella no se puede emitir ni imprimir.',
      },
      {
        clave: 'credencial_qr_modo', label: 'Modo del código QR', tipo: 'select', defecto: 'linea',
        opciones: [
          { valor: 'linea', label: 'Verificación en línea (recomendado)' },
          { valor: 'sinconexion', label: 'Datos sin conexión' },
        ],
        ayuda:
          'En línea: el QR lleva una dirección corta que abre la página de verificación de este sistema y ' +
          'muestra el estado de la credencial al día. Sin conexión: el QR lleva los datos del titular escritos ' +
          'adentro, para cuando en el lugar donde se verifica no hay internet; ahí el código no puede saber si ' +
          'la credencial fue revocada después de imprimirse.',
      },
      {
        clave: 'credencial_intentos_por_minuto', label: 'Verificaciones erradas por minuto desde una misma conexión',
        tipo: 'number', defecto: '20', min: 5, max: 300,
        ayuda:
          'La página de verificación es pública y no pide sesión. Este tope evita que alguien pruebe números ' +
          'de serie al azar para averiguar qué credenciales existen. Solo cuentan los intentos que NO calzan: ' +
          'quien escanea credenciales de verdad puede verificar todas las que quiera, porque no hay nada que ' +
          'pueda averiguar probando lo que ya tiene en la mano.',
      },
    ],
  },
  {
    grupo: 'Límites y espacio',
    items: [
      {
        clave: 'archivo_tope_mb', label: 'Tamaño máximo de un archivo (MB)', tipo: 'number',
        defecto: '15', min: 1, max: 50,
        ayuda:
          'Lo que puede pesar un documento o una foto que se sube. Las fotos se reducen antes de enviarlas ' +
          '(ver más abajo), así que este tope lo topan sobre todo los escaneos y los PDF. Subirlo llena el ' +
          'disco más rápido.',
      },
      {
        clave: 'planilla_tope_filas', label: 'Filas máximas de una planilla', tipo: 'number',
        defecto: '20000', min: 100, max: 100000,
        ayuda:
          'Cuántas filas puede traer, como mucho, un listado bajado a Excel. No es una limitación real —una ' +
          'iglesia no llega— sino un freno para que un pedido enorme no deje al servidor sin memoria.',
      },
      {
        clave: 'disco_aviso_mb', label: 'Avisar cuando queden menos de (MB)', tipo: 'number',
        defecto: '100', min: 20, max: 5000,
        ayuda:
          'Con menos espacio libre que esto, el sistema avisa en la pantalla de configuración antes de que ' +
          'empiece a no poder guardar. Conviene dejarlo holgado: agrandar el disco a último minuto obliga a ' +
          'reiniciar el servidor.',
      },
    ],
  },
  {
    grupo: 'Preferencias',
    items: [
      {
        clave: 'moneda_simbolo', label: 'Símbolo de moneda', tipo: 'text', defecto: '$',
        ayuda: 'Se usa al mostrar montos en tesorería, ayudas sociales e inventarios.',
      },
      {
        clave: 'registros_por_pagina', label: 'Registros por página', tipo: 'number', defecto: '25', min: 10, max: 200,
        ayuda: 'Cantidad de filas que muestran los listados (entre 10 y 200).',
      },
      {
        clave: 'sesion_horas', label: 'Duración de la sesión (horas)', tipo: 'number', defecto: '12', min: 1, max: 720,
        ayuda: 'Tras ese tiempo sin renovar, se pide iniciar sesión nuevamente.',
      },
      {
        clave: 'imagen_lado_maximo', label: 'Tamaño máximo de las imágenes (píxeles)', tipo: 'number', defecto: '1600', min: 600, max: 4000,
        ayuda:
          'Al subir una foto (de un miembro, de un documento), el sistema la reduce hasta ese lado mayor ' +
          'antes de enviarla: carga mucho más rápido y se ve igual. Entre 600 y 4000.',
      },
      {
        clave: 'imagen_calidad', label: 'Calidad de las imágenes (%)', tipo: 'number', defecto: '88', min: 40, max: 100,
        ayuda: 'Qué tanto detalle conserva la foto reducida. 88 conserva la calidad a simple vista; 100 no comprime.',
      },
      {
        clave: 'cumpleanos_cantidad', label: 'Cumpleaños que muestra el panel', tipo: 'number', defecto: '4', min: 1, max: 20,
        ayuda: 'Cuántos miembros próximos a cumplir años aparecen en la pantalla de inicio (entre 1 y 20).',
      },
      {
        clave: 'bitacora_automatica', label: 'Registrar automáticamente en la bitácora', tipo: 'boolean', defecto: '1',
        ayuda: 'Anota por sí solo los cambios de datos de miembros, ingresos a cuerpos, solicitudes, ayudas y certificados.',
      },
    ],
  },
];

const PLANOS = OPCIONES.flatMap((g) => g.items);
const POR_CLAVE = Object.fromEntries(PLANOS.map((o) => [o.clave, o]));

/** Valor actual de una opción (o su valor por defecto). */
function obtener(clave) {
  const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  if (fila && fila.valor !== null && fila.valor !== undefined) return fila.valor;
  return POR_CLAVE[clave] ? POR_CLAVE[clave].defecto : null;
}

/** Igual que obtener(), pero para opciones de Sí/No. */
function activo(clave) {
  return String(obtener(clave)) === '1';
}

/** Número con límites, para opciones numéricas. */
function numero(clave, minimo, maximo) {
  const n = Number(obtener(clave));
  if (!Number.isFinite(n)) return Number(POR_CLAVE[clave].defecto);
  return Math.min(maximo, Math.max(minimo, n));
}

function todas() {
  return Object.fromEntries(PLANOS.map((o) => [o.clave, obtener(o.clave)]));
}

function guardar(clave, valor, usuarioId) {
  if (!POR_CLAVE[clave]) return;
  db.prepare(
    `INSERT INTO configuracion (clave, valor, actualizado_por) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,
       actualizado_en = datetime('now','localtime'), actualizado_por = excluded.actualizado_por`
  ).run(clave, String(valor), usuarioId || null);
}

module.exports = { OPCIONES, POR_CLAVE, obtener, activo, numero, todas, guardar };
