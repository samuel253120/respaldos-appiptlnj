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
        clave: 'documento_pie_texto', label: 'Línea extra al pie de los documentos impresos', tipo: 'textarea',
        defecto: '',
        ayuda:
          'Se imprime debajo del contacto en certificados, informes y listados. Sirve para una leyenda legal, ' +
          'el número de personalidad jurídica o cualquier cosa que deba figurar en todo lo que sale firmado. ' +
          'Vacío, no se imprime nada.',
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
        clave: 'asistencia_actividad_defecto', label: 'Actividad que viene elegida al pasar lista',
        tipo: 'select', defecto: 'Servicio General',
        /*
         * SE PREGUNTA CADA VEZ, no una sola al arrancar (hallazgo CO-05).
         *
         * Acá había una propiedad corriente, no un `get`, así que la lista se
         * armaba UNA VEZ al cargar este archivo y se quedaba con la foto del
         * arranque. Los tipos de actividad, en cambio, son datos que la iglesia
         * mantiene desde su propia pantalla.
         *
         * Medido en la v1.423.0: se creó «Vigilia de Año Nuevo», se volvió a
         * abrir Configuración, y el desplegable seguía ofreciendo los doce de
         * antes. Peor todavía, la comprobación del guardado usaba ESA MISMA
         * lista congelada, así que elegir el tipo nuevo no daba error: se
         * descartaba, y el servidor contestaba que sí. Hasta el próximo
         * reinicio del servidor, la actividad nueva no se podía dejar puesta.
         *
         * El ajuste de al lado —«Categoría que compone la directiva»— ya usaba
         * un `get` por esta misma razón: eran dos maneras distintas en el mismo
         * archivo, y una de las dos estaba mal.
         */
        get opciones() {
          return require('./actividades').losQueSeUsan().map((t) => ({ valor: t, label: t }));
        },
        ayuda: 'La que aparece marcada al crear una actividad nueva. Conviene poner la que más se repite.',
      },
      {
        clave: 'asistencia_marca_inicial', label: 'Cómo viene marcada una lista recién abierta',
        tipo: 'select', defecto: 'Sin marcar',
        opciones: [
          { valor: 'Sin marcar', label: 'Sin marcar a nadie (recomendado)' },
          { valor: 'Presente', label: 'Con todos como presentes' },
        ],
        ayuda:
          'Con todos como presentes se pasa lista más rápido donde casi nadie falta: solo hay que marcar a ' +
          'los que no vinieron. Ojo con el otro lado: si alguien abre la lista y guarda sin mirarla, quedan ' +
          'todos presentes. Nada se guarda hasta apretar Guardar, y solo se propone en listas donde todavía ' +
          'no hay ni una marca puesta.',
      },
      {
        clave: 'asistencia_faltas_seguidas', label: 'Avisar cuando alguien lleve tantas faltas seguidas',
        tipo: 'number', defecto: '4', min: 0, max: 52,
        ayuda:
          'Cuántas actividades seguidas puede faltar alguien antes de que el sistema avise a quien lleva ' +
          'su cuerpo. Se cuentan las actividades en que no estuvo presente, de la más reciente hacia atrás, ' +
          'y las que están sin marcar no cuentan ni cortan la cuenta: nadie faltó a una lista que no se pasó. ' +
          'El aviso dice cuántas de esas faltas fueron justificadas, que no es el mismo caso. En 0 no se avisa.',
      },
      {
        clave: 'acta_reunion_prefijo', label: 'Prefijo del número de las actas de reunión', tipo: 'text',
        defecto: '',
        ayuda:
          'Lo que va antes del número que el sistema propone al levantar un acta de cuerpo. En blanco, ' +
          'propone «001-2026»; poniendo «ACTA-» propone «ACTA-001-2026». Lo propuesto se puede cambiar ' +
          'siempre, y lo ya guardado no se toca.',
      },
      {
        clave: 'acta_asamblea_prefijo', label: 'Prefijo del número de las actas de asamblea', tipo: 'text',
        defecto: 'AS-',
        ayuda: 'Lo mismo para las asambleas. De fábrica «AS-», que propone «AS-001-2026».',
      },
      {
        clave: 'certificado_prefijo', label: 'Prefijo del número de los certificados', tipo: 'text',
        defecto: 'CERT-',
        ayuda:
          'Lo mismo para los certificados, que se numeran por iglesia. De fábrica «CERT-», que propone ' +
          '«CERT-001-2026». Antes el número se escribía entero a mano, y en un documento que se firma y se ' +
          'entrega dos números repetidos son dos papeles que dicen ser el mismo.',
      },
      {
        clave: 'solicitud_prefijo', label: 'Prefijo del número de las solicitudes', tipo: 'text',
        defecto: 'SOL-',
        ayuda:
          'Las solicitudes se numeran por iglesia y por año, y el número lleva el código de la iglesia para ' +
          'que se sepa de cuál es: de fábrica «SOL-», que da «SOL-CENTRAL-0001-2026». Cambiar el prefijo ' +
          'empieza una serie nueva y no toca los números ya emitidos.',
      },
      {
        clave: 'documento_recibido_prefijo', label: 'Prefijo de los documentos recibidos', tipo: 'text',
        defecto: 'REC-',
        ayuda:
          'La oficina de partes lleva dos libros por iglesia. Este es el de lo que entra: de fábrica «REC-», ' +
          'que propone «REC-001-2026». Se reinicia cada año.',
      },
      {
        clave: 'documento_emitido_prefijo', label: 'Prefijo de los documentos emitidos', tipo: 'text',
        defecto: 'EMI-',
        ayuda: 'El libro de lo que sale. De fábrica «EMI-», que propone «EMI-001-2026».',
      },
      {
        clave: 'directiva_categoria', label: 'Categoría que compone la directiva', tipo: 'select',
        // Las del propio módulo de miembros, para que no se desincronicen
        get opciones() {
          return require('./modules/miembros').TIPOS_DE_MIEMBRO.map((t) => ({ valor: t, label: t }));
        },
        defecto: 'Miembro Líder',
        ayuda:
          'Quien esté en esta categoría entra solo al cuerpo marcado como directiva de su iglesia, y al ' +
          'dejarla sale solo. Estaba fija en «Miembro Líder» dentro del programa. Cambiarla NO mueve a nadie ' +
          'en el momento: la regla corre al guardar la ficha de cada persona, así que los cambios se van ' +
          'aplicando a medida que se guardan las fichas.',
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
        clave: 'egreso_pide_comprobante_desde', label: 'Preguntar por el comprobante de un egreso desde',
        tipo: 'number', defecto: '100000', min: 0, max: 100000000,
        ayuda:
          'Al guardar un egreso de este monto o más sin adjuntarle la boleta o el comprobante de la ' +
          'transferencia, el sistema lo pregunta antes de guardar. No lo impide: hay gastos chicos y ' +
          'urgentes que se documentan después. En cero, no pregunta nunca.',
      },
      {
        clave: 'ayuda_pregunta_al_entregar', label: 'Preguntar por lo que falta al entregar una ayuda',
        tipo: 'boolean', defecto: '1',
        ayuda:
          'Al marcar una ayuda como entregada sin decir cuánto valía, sin el respaldo de la entrega o ' +
          'sin quién la aprobó, el sistema lo pregunta antes de guardar. No lo impide: hay entregas ' +
          'que se documentan después. Sin el monto, eso sí, el informe la suma como $ 0, que se lee ' +
          'como que no valía nada.',
      },
      {
        clave: 'ayuda_registra_tesoreria', label: 'Registrar las ayudas sociales en tesorería',
        tipo: 'boolean', defecto: '1',
        ayuda:
          'Al marcar una ayuda como entregada hay que decir de dónde salió. Si salió de una cuenta de ' +
          'tesorería, el sistema anota ahí el egreso; si fue en especie —mercadería donada, ropa—, no ' +
          'anota nada. Apáguelo si prefiere que la tesorera los ingrese a mano: la pregunta de dónde ' +
          'salió se sigue haciendo, porque es lo que deja constancia de si la iglesia puso la plata.',
      },
      {
        clave: 'ofrenda_registra_tesoreria', label: 'Registrar la ofrenda en tesorería', tipo: 'boolean', defecto: '1',
        ayuda:
          'Al guardar un servicio con ofrenda, el sistema anota tres movimientos: el ingreso de la ofrenda ' +
          'completa en la tesorería de la iglesia, el egreso del aporte a la corporación de esa misma cuenta ' +
          'y el ingreso de ese aporte en su «Fondo para la corporación». Apáguelo si prefiere ingresar las ' +
          'ofrendas a mano en Tesorería.',
      },
      {
        clave: 'inventario_aviso_devolucion_dias',
        label: 'Avisar de lo prestado que hay que devolver, con esta anticipación (días)',
        tipo: 'number', defecto: '15', min: 1, max: 365,
        ayuda:
          'Un artículo del inventario anotado como «Prestado» con fecha de devolución aparece en el ' +
          'panel cuando falten estos días. Lo que ya se pasó de la fecha sale igual, diciendo hace ' +
          'cuánto. Lo prestado sin fecha no avisa: no hay plazo que se pueda pasar.',
      },
      {
        clave: 'inventario_clausula_deposito',
        label: 'Cláusula de responsabilidad de los bienes en depósito',
        tipo: 'textarea',
        /*
         * Es un texto que alguien firma, así que su redacción es de quien lo
         * firma y no del código: acá está solo con el que llega el sistema, y
         * cambiarlo no toca nada más. Sale tal cual en la hoja de depósito que
         * se imprime desde la ficha del artículo.
         */
        defecto:
          'El bien descrito en esta hoja se deja en dependencias de la iglesia por voluntad de su ' +
          'dueño y para su sola comodidad, conservando éste su dominio sobre él. La iglesia lo ' +
          'guardará con el mismo cuidado con que guarda lo propio, pero NO ASUME RESPONSABILIDAD ' +
          'ALGUNA por su daño, deterioro, destrucción, robo o pérdida, cualquiera sea la causa. El ' +
          'dueño podrá retirarlo cuando lo estime conveniente, y la iglesia podrá pedirle que lo ' +
          'retire avisándole con antelación razonable. Quien firma declara haber leído y aceptado ' +
          'lo anterior.',
        ayuda:
          'El texto que sale en la hoja de depósito, para firmar en dos copias. Escríbalo como la ' +
          'corporación quiera que quede: se imprime tal cual. No se aplica a lo PRESTADO, donde la ' +
          'iglesia sí responde por lo que le prestaron.',
      },
    ],
  },
  {
    grupo: 'Acceso',
    items: [
      {
        /*
         * LA CONTRASEÑA QUE EL SISTEMA ENTREGA PASA POR LA MISMA REGLA QUE LA
         * QUE UNO ELIGE (hallazgo AU-03).
         *
         * Era un texto corriente, sin ninguna comprobación, y es el único lugar
         * donde nacen casi todas las contraseñas del sistema: cada cuenta nueva
         * y cada restablecimiento. Medido en la v1.416.0, la misma clave por
         * las dos puertas: «123456», «clave», «aaaaaaaa» y hasta «a» se
         * rechazaban como contraseña propia y se guardaban sin chistar como
         * inicial de todo el sistema.
         *
         * Y el valor de fábrica cambió, porque el que había NO PASABA su propia
         * regla: «Iglesia2026» lleva dentro «Iglesia», que son siete letras del
         * nombre de la congregación, y es lo primero que probaría cualquiera
         * que sepa de qué iglesia se trata. Las instalaciones que nunca lo
         * tocaron pasan a entregar la nueva; la que esté escrita se respeta,
         * porque el sistema no puede cambiarle en silencio al administrador una
         * clave que ya repartió.
         */
        clave: 'password_inicial', label: 'Contraseña inicial', tipo: 'text', defecto: 'Primera.Entrada',
        revisaComoClave: true,
        /*
         * ES SECRETA: no viaja a quien solo puede MIRAR (hallazgo CO-07).
         *
         * La pantalla de configuración devolvía las setenta opciones con su
         * valor, y ésta es la contraseña con que nace cada cuenta nueva y con la
         * que queda cada cuenta restablecida. Medido en la v1.423.0 con una
         * cuenta que solo tenía permiso de VER la configuración: no podía
         * guardarla (403), no podía restablecerle la contraseña a nadie (403), y
         * leía «Primera.Entrada» en claro. Quien la sepa y vea que se creó una
         * cuenta puede entrar antes que su dueño, y en esa primera entrada
         * cambiar la contraseña no pide la anterior.
         *
         * Esta misma marca es la que hace que su valor tampoco se escriba en el
         * Registro de Cambios: antes eran dos listas separadas —una acá y otra
         * en server/configuracion.js— y acordarse de las dos el día que exista
         * una segunda opción secreta era cuestión de suerte.
         */
        secreta: true,
        ayuda:
          'La que se le entrega a cada cuenta nueva y la que restablece el administrador cuando alguien ' +
          'olvida la suya. Al entrar con ella, el sistema obliga a cambiarla por una propia. Pasa por las ' +
          'mismas reglas que una contraseña cualquiera: el largo mínimo, nada de las de siempre y nada ' +
          'que salga del nombre de la iglesia.',
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
        clave: 'acceso_espera_minutos', label: 'Cuánto queda cerrada la puerta, como máximo (minutos)',
        tipo: 'number', defecto: '15', min: 1, max: 120,
        ayuda:
          'La espera más larga, la que se aplica cuando ya insistieron mucho. Las dos anteriores salen de ' +
          'esta —un tercio y una quinceava parte—, así que con el valor de fábrica queda la escala de ' +
          'siempre: 1, 5 y 15 minutos. Subirla aprieta a quien prueba contraseñas a máquina; bajarla ' +
          'perdona antes a quien de verdad se equivocó.',
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
        /*
         * PIDE EL PERMISO DE LAS CREDENCIALES PARA VERSE (hallazgo CO-03).
         *
         * El logo se ve en todas partes —la pantalla de acceso, el menú, el
         * encabezado de todo lo que se imprime— y por eso se entrega a quien
         * tenga sesión, y hasta sin ella. El sello y la firma no: solo salen en
         * la credencial, y son justamente las dos piezas que hacen difícil
         * fabricar una falsa. La especificación usa el sello DOS veces, y una
         * de ellas cruzando la fotografía como marca de seguridad.
         *
         * Medido en la v1.423.0 con una cuenta de tesorera, sin permisos
         * propios: «/api/credenciales» le contestaba 403 —no puede ni ver el
         * listado— y «/api/configuracion/recurso/sello» y «/recurso/firma» le
         * contestaban 200 con las imágenes. Quien no puede ver una credencial
         * no tiene por qué recibir las piezas con que se arma.
         */
        soloConPermiso: 'credenciales',
        ayuda:
          'El sello de la corporación. Va dos veces en la credencial: completo en el reverso, y cruzando la ' +
          'fotografía del anverso como marca de seguridad. Conviene un PNG con fondo transparente. Sin él no ' +
          'se puede emitir ni imprimir.',
      },
      {
        clave: 'credencial_firma', label: 'Firma del Pastor Presidente', tipo: 'imagen', defecto: '',
        soloConPermiso: 'credenciales',   // igual que el sello: ver el comentario de arriba
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
        clave: 'credencial_vigencia_anios', label: 'Años que dura una credencial', tipo: 'number',
        defecto: '2', min: 1, max: 20,
        ayuda:
          'Al escribir la fecha de entrega, el formulario PROPONE el vencimiento sumando estos años. Es una ' +
          'propuesta a la vista, que se puede corregir antes de guardar: el sistema no pone fechas por su ' +
          'cuenta en un documento que alguien firma.',
      },
      {
        clave: 'credencial_aviso_dias', label: 'Avisar que una credencial vence con tantos días de anticipación',
        tipo: 'number', defecto: '60', min: 7, max: 365,
        ayuda:
          'Desde cuántos días antes del vencimiento una credencial pasa a figurar «Por vencer», tanto en su ' +
          'listado como en el aviso del panel. Es el tiempo que se da para alcanzar a emitir la nueva.',
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
        clave: 'archivos_dias_gracia', label: 'Días que se guarda un archivo suelto', tipo: 'number',
        defecto: '7', min: 1, max: 90,
        ayuda:
          'Un archivo que se sube y cuyo formulario nunca se guarda queda sin pertenecer a ninguna ficha. ' +
          'Pasados estos días, la limpieza nocturna lo saca. No conviene bajarlo mucho: entre que alguien ' +
          'sube un documento y guarda la ficha puede dejar la pantalla abierta y volver al otro día.',
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
    grupo: 'Hora y fecha',
    items: [
      {
        clave: 'zona_horaria', label: 'Zona horaria de la institución', tipo: 'select',
        defecto: 'America/Santiago',
        opciones: require('./zonas').LAS_ZONAS.map((z) => ({ valor: z.valor, label: z.label })),
        ayuda:
          'Con qué hora se anota TODO lo que registra el sistema: la fecha de una asistencia, la de un ' +
          'movimiento de tesorería, la hora de cada cambio en el registro. Un servidor en internet trabaja ' +
          'en hora universal si no se le dice otra cosa, y en Chile eso son tres o cuatro horas de más: lo ' +
          'que pase después de las 20:00 quedaría anotado al día siguiente. Se aplica al momento, sin ' +
          'reiniciar. Las fechas ya guardadas no se cambian.',
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
        clave: 'buscador_por_modulo', label: 'Resultados del buscador por sección', tipo: 'number',
        defecto: '5', min: 1, max: 30,
        ayuda:
          'Cuántos resultados muestra el buscador general de cada sección —miembros, tesorería, actas—. ' +
          'Subirlo ayuda cuando se busca por apellidos repetidos; bajarlo deja el panel más corto.',
      },
      {
        clave: 'buscador_total', label: 'Resultados del buscador en total', tipo: 'number',
        defecto: '40', min: 5, max: 200,
        ayuda: 'El tope de todo lo que muestra el buscador general de una vez, sumando todas las secciones.',
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
  /*
   * Acá vivía «Cuántas actas al año se esperan de un cuerpo». Se sacó en la
   * v1.427.0 porque la tarjeta del panel de la que salía —la que decía qué
   * cuerpos dejaron de anotar y desde cuándo— la quitó la corporación en la
   * v1.393.0, y el ajuste se quedó solo, con su explicación entera describiendo
   * un aviso que ya no existe. Nadie lo leía: cambiarlo no movía nada, y su
   * ayuda hacía perder el tiempo a quien la leyera buscando por qué (CO-04).
   */
  {
    grupo: 'Avisos',
    items: [
      {
        clave: 'avisos_hora', label: 'Hora del resumen del día', tipo: 'number', defecto: '8', min: 0, max: 23,
        ayuda:
          'A partir de esta hora el sistema revisa lo de todos los días —credenciales por vencer, cumpleaños, ' +
          'cuotas al debe— y deja un solo aviso con todo. Lo urgente, como una solicitud que le trasladan, ' +
          'avisa en el momento y no espera a esta hora.',
      },
      {
        clave: 'avisos_revisar_minutos', label: 'Cada cuántos minutos revisa el sistema si hay algo que avisar',
        tipo: 'number', defecto: '30', min: 5, max: 180,
        ayuda:
          'Cada tanto el sistema se asoma a ver si hay credenciales por vencer, cumpleaños o cuotas al debe. ' +
          'No conviene bajarlo mucho: no hace que los avisos lleguen antes —el resumen sale a la hora que se ' +
          'fije más arriba— y solo agrega trabajo al servidor.',
      },
      {
        clave: 'avisos_solicitud_dias', label: 'Avisar una solicitud sin respuesta a los tantos días', tipo: 'number',
        defecto: '7', min: 1, max: 120,
        ayuda: 'Días que puede llevar abierta una solicitud a cargo de alguien antes de que el sistema se lo recuerde.',
      },
      {
        clave: 'avisos_ayuda_dias', label: 'Avisar de una ayuda pedida y no entregada a los tantos días',
        tipo: 'number', defecto: '7', min: 1, max: 120,
        ayuda:
          'Días que puede llevar una ayuda en «Solicitada» o «Aprobada» antes de que el sistema lo '
          + 'recuerde a quien administra las ayudas. Se cuenta desde la fecha de la ayuda, que es '
          + 'cuando se pidió.',
      },
      {
        clave: 'avisos_plazo_documento_dias',
        label: 'Avisar del plazo de un documento recibido con tantos días de anticipación',
        tipo: 'number', defecto: '7', min: 1, max: 90,
        ayuda:
          'Días de anticipación con que el sistema avisa de que se cumple el plazo para responder un '
          + 'documento de la oficina de partes. Es el único plazo que no pone la institución: lo pone '
          + 'quien manda el oficio. Lo que ya se pasó avisa igual, diciendo hace cuánto. '
          + 'No confundir con el de más abajo, que es el del carnet de una persona.',
      },
      {
        clave: 'avisos_documento_dias', label: 'Avisar de un documento por vencer con tantos días de anticipación',
        tipo: 'number', defecto: '30', min: 1, max: 365,
        ayuda:
          'Días de anticipación con que el sistema avisa de un documento de la carpeta de alguien que está por '
          + 'vencer —el carnet, sobre todo—. Lo que ya venció avisa igual, diciendo hace cuánto.',
      },
      {
        clave: 'directiva_aviso_dias', label: 'Avisar que una directiva termina con tantos días de anticipación',
        tipo: 'number', defecto: '60', min: 7, max: 365,
        ayuda:
          'Días de anticipación con que el panel avisa de que la directiva de un cuerpo está por terminar '
          + 'su período. Elegir una directiva toma semanas —hay que convocar, elegir y levantar el acta— '
          + 'así que conviene enterarse antes y no el día. Los cuerpos que YA se quedaron sin directiva '
          + 'salen en ese mismo aviso, no importa cuánto haga.',
      },
      {
        clave: 'mensajes_por_hora', label: 'Cuántos mensajes puede mandar una persona por hora',
        tipo: 'number', defecto: '10', min: 1, max: 200,
        ayuda:
          'El aviso de un mensaje escrito a mano no se puede apagar en la campanita —es donde queda la ' +
          'constancia de que llegó—, así que mandarlos seguidos llena una campanita que nadie puede ' +
          'silenciar. Solo cuentan los que salieron: uno rechazado, o la pregunta de antes de mandarlo a ' +
          'mucha gente, no gastan nada.',
      },
      {
        clave: 'avisos_guardar_dias', label: 'Borrar los avisos leídos a los tantos días', tipo: 'number',
        defecto: '90', min: 7, max: 730,
        ayuda:
          'Un aviso leído ya cumplió: lo que pasó queda en el registro de cambios y en el historial de cada ficha. ' +
          'Guardarlos para siempre haría crecer la base sin que nadie los mire.',
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

/**
 * ¿Este archivo es de la institución? Y si lo es, ¿qué permiso pide para verse?
 *
 * Vive acá porque lo preguntan DOS puertas distintas —la que entrega el sello y
 * la firma desde la configuración, y la que entrega cualquier archivo subido
 * (server/archivos.js)— y porque este archivo no depende de Express ni de la
 * autenticación, así que las dos pueden llamarlo sin darle vueltas.
 *
 * Dos maneras de contestar habrían sido dos verdades: cerrar una de las puertas
 * y dejar la otra abierta es no haber cerrado nada.
 *
 * Devuelve `null` si el archivo no es de la institución. Si lo es, devuelve
 * `{ clave, permiso }`, y `permiso` es null cuando basta con tener sesión
 * —el logo, que se ve en todas partes—.
 */
function elArchivoDeLaInstitucion(archivo) {
  let fila;
  try {
    fila = db.prepare('SELECT clave FROM configuracion WHERE valor = ? LIMIT 1').get(archivo);
  } catch (e) {
    /*
     * Ante la duda, se contesta que NO es de la institución, y quien pregunta
     * no lo entrega. Es el modo de fallo dado vuelta respecto de la pregunta
     * que hace la barrida nocturna —«¿lo usa alguien?»—, que ante la duda
     * contesta que sí para no borrar nada por error. Compartir una sola de las
     * dos funciones dejaría que un problema al consultar la base abriera el
     * archivo a todo el mundo, o borrara el logo: cada pregunta tiene que
     * fallar hacia su propio lado prudente.
     */
    return null;
  }
  if (!fila) return null;
  const opcion = POR_CLAVE[fila.clave];
  if (!opcion || opcion.tipo !== 'imagen') return null;
  return { clave: fila.clave, permiso: opcion.soloConPermiso || null };
}

module.exports = {
  OPCIONES, POR_CLAVE, obtener, activo, numero, todas, guardar, elArchivoDeLaInstitucion,
};
