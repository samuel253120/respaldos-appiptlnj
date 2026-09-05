/**
 * Las contraseñas del sistema: cómo se entregan, cómo se cambian y cómo se
 * recuperan.
 *
 * Tres reglas que el sistema hace cumplir en todas partes:
 *
 * 1. **Nunca se guarda una contraseña en claro.** Se guarda su huella
 *    (bcrypt), que sirve para comprobarla pero no para leerla. Por eso el
 *    sistema no puede mostrarle a nadie —tampoco al administrador— la
 *    contraseña que una persona eligió: en su lugar se restablece.
 * 2. **Una contraseña que otro conoce no es suya.** La que entrega el
 *    administrador —la inicial del sistema o una que escriba— obliga a
 *    cambiarla en el primer ingreso.
 * 3. **Siempre hay una salida.** Quien la olvide la recupera con su pregunta
 *    secreta, o el administrador se la restablece a la inicial.
 */
const bcrypt = require('bcryptjs');
const cifrado = require('./cifrado');
const { db } = require('./db');
const ajustes = require('./ajustes');
const fechas = require('./fechas');

/** Cuántos intentos fallidos de recuperación se toleran antes de bloquearla. */
const INTENTOS_MAXIMOS = 5;

/**
 * Cuánto dura ese bloqueo antes de levantarse solo.
 *
 * ANTES NO SE LEVANTABA: quedaba puesto hasta que un administrador lo quitara a
 * mano. Y esa puerta la abre cualquiera sin sesión, así que quien supiera el
 * RUT de la tesorera podía errar seis respuestas seguidas y dejarle la
 * recuperación cerrada; ella se enteraba el día que la necesitaba. Medido en la
 * v1.316.0. En Chile un RUT no es un secreto.
 *
 * El sistema ya había resuelto exactamente este problema en la puerta de
 * entrada, y su portero lo explica: «alguien podría errar cinco veces adrede
 * sobre un RUT ajeno para dejar a esa persona afuera. Que sean minutos y no
 * horas hace que esa maña moleste poco y que el ataque por fuerza bruta siga
 * sin servir». Acá se aplica lo mismo, con la misma cuenta configurable —cuatro
 * veces la espera larga de la entrada— así que sigue siendo un solo número el
 * que la iglesia ajusta.
 *
 * El desbloqueo a mano del administrador se queda: sirve para quien no quiere
 * esperar.
 */
function minutosDeBloqueo() {
  return ajustes.numero('acceso_espera_minutos', 1, 120) * 4;
}

/**
 * La contraseña inicial que definió el administrador.
 *
 * El valor de reserva es el mismo que declara el ajuste, y desde la v1.419.0
 * pasa la regla de `revisarClave`: el que había —«Iglesia2026»— no la pasaba,
 * porque lleva dentro siete letras del nombre de la congregación (ver el
 * comentario del ajuste en server/ajustes.js).
 *
 * Lo que esté escrito se respeta tal cual, aunque sea flojo: el sistema no
 * puede cambiarle en silencio al administrador una clave que ya repartió. La
 * regla se aplica al GUARDARLA, que es donde se puede avisar.
 */
const INICIAL_DE_RESERVA = 'Primera.Entrada';

function inicial() {
  return (ajustes.obtener('password_inicial') || INICIAL_DE_RESERVA).trim() || INICIAL_DE_RESERVA;
}

/** Largo mínimo exigido a una contraseña propia. */
function largoMinimo() {
  return ajustes.numero('password_minimo', 8, 40);
}

/**
 * Las contraseñas que se prueban primero.
 *
 * No es una lista de las «más usadas del mundo» —esas son cientos de miles y
 * no caben acá—: son las que alguien escribe cuando el sistema le exige una y
 * quiere salir del paso. Puestas a mano, en español y pensando en dónde se usa
 * esto. Si alguna vez hace falta más, se agrega una línea.
 */
const LAS_DE_SIEMPRE = [
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345',
  'password', 'contrasena', 'contraseña', 'clave', 'claveclave', 'qwerty',
  'qwertyui', 'asdfghjk', 'abc123', 'abcd1234', '111111', '000000', '123123',
  'admin', 'administrador', 'usuario', 'iglesia', 'iglesia1', 'iglesia123',
  'jesus', 'jesucristo', 'amen', 'dios', 'diosesamor', 'pastor', 'hermano',
  'secretaria', 'tesorero', 'chile', 'santiago',
];

/** Sin tildes, sin mayúsculas y sin espacios: «Iglesia 123» y «iglesia123» son la misma idea. */
const aPelo = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Devuelve el problema con una contraseña, o null si sirve.
 *
 * Antes lo único que se exigía era el largo, y con eso pasaban «123456»,
 * «password» y —lo que más importa— **el propio RUT de la persona**, que es lo
 * primero que probaría cualquiera que tenga la lista de usuarios delante.
 *
 * `quien` es la persona a la que se le está poniendo: su RUT y su nombre no
 * pueden ser su contraseña. Es la regla que más sirve y la más barata.
 */
function revisarClave(clave, quien) {
  const texto = String(clave || '');
  const minimo = largoMinimo();
  if (texto.length < minimo) return `La contraseña debe tener al menos ${minimo} caracteres`;

  const limpia = aPelo(texto);
  if (!limpia) return 'La contraseña no puede ser solo espacios o signos';

  if (LAS_DE_SIEMPRE.includes(limpia)) {
    return 'Esa contraseña es de las primeras que probaría cualquiera. Elija otra.';
  }
  if (/^(.)\1+$/.test(limpia)) return 'Una contraseña de un solo carácter repetido no protege nada. Elija otra.';

  // Lo que esta persona tiene a mano, que es lo que de verdad se escribe
  const suyo = [];
  if (quien && quien.rut) suyo.push({ que: 'su RUT', valor: String(quien.rut).split('-')[0] });
  if (quien && quien.nombre) {
    for (const parte of String(quien.nombre).split(/\s+/)) {
      if (aPelo(parte).length >= 4) suyo.push({ que: 'su nombre', valor: parte });
    }
  }
  /**
   * El nombre de la iglesia va por palabras y no entero: nadie escribe
   * «Iglesia Pentecostal Triunfante La Nueva Jerusalén» de contraseña, escribe
   * un pedazo reconocible.
   *
   * Y solo las palabras largas. Con siete letras se quedan las que identifican
   * —Pentecostal, Triunfante, Jerusalén— y se van las corrientes: «La»,
   * «Nueva». Es la diferencia entre atajar la contraseña obvia y rechazarle a
   * alguien «LaNuevaCasa9», que no tiene nada que ver con la iglesia.
   */
  for (const parte of String(ajustes.obtener('iglesia_nombre') || '').split(/\s+/)) {
    if (aPelo(parte).length >= 7) suyo.push({ que: 'parte del nombre de la iglesia', valor: parte });
  }

  for (const { que, valor } of suyo) {
    const v = aPelo(valor);
    if (!v) continue;
    // Se mira en las dos direcciones. La primera atrapa «margarita2026»; la
    // segunda, la contraseña que es un trozo de algo más largo —«iglesia
    // pentecostal» dentro del nombre completo de la congregación—.
    const dentroDeLaClave = limpia.includes(v);
    const laClaveEstaDentro = limpia.length >= 6 && v.includes(limpia);
    if (limpia === v || dentroDeLaClave || laClaveEstaDentro) {
      return `La contraseña no puede ser ${que}: es lo primero que probaría cualquiera. Elija otra.`;
    }
  }
  return null;
}

/** Nombre anterior de la comprobación, por si algo afuera todavía lo usa. */
const revisarLargo = revisarClave;

/**
 * Deja una contraseña puesta en una cuenta.
 *
 * `origen` dice de dónde salió, que es lo único que después se puede contar
 * de ella: 'inicial' (la del sistema, que el administrador conoce),
 * 'definida' (una que escribió el administrador) o 'usuario' (la eligió su
 * dueño, y entonces nadie más la conoce).
 *
 * Cambiar la contraseña **cierra las sesiones que estuvieran abiertas**. Antes
 * no: quien hubiera entrado con la contraseña vieja seguía adentro hasta que
 * su pase caducara solo, que puede ser un mes según cómo esté configurado. Si
 * a alguien le robaron la clave, cambiarla no lo sacaba. Ahora se anota desde
 * cuándo valen los pases de esta cuenta, y los entregados antes dejan de
 * servir en la siguiente petición.
 *
 * Vale para los tres orígenes, a propósito: que el administrador restablezca
 * la contraseña de alguien es justamente el caso en que hay que echar de la
 * sesión a quien esté usando la cuenta.
 */
/**
 * Cifrar una contraseña cuesta cerca de una décima de segundo de puro cálculo,
 * y el servidor atiende de a una cosa: hecho de corrido, ese cálculo deja
 * esperando a TODOS los que estén usando el sistema en ese momento, no solo a
 * quien está guardando. Por eso acá se hace de forma asíncrona, igual que la
 * comprobación al entrar (ver el comentario de `atender` en server/auth.js).
 *
 * Lo lento es a propósito y no se toca: una contraseña que se cifra rápido se
 * adivina rápido. Lo que se arregla es que ese rato no lo pague el resto.
 */
/**
 * TOCAR UNA CONTRASEÑA DEJA SU LÍNEA.
 *
 * La plata deja rastro —la v1.410.0 se ocupó de que hasta el cobro de una cuota
 * por la planilla dejara el suyo— y las llaves no dejaban casi ninguno, porque
 * las contraseñas se cambian con un UPDATE directo desde acá, que no pasa por
 * el motor. MEDIDO en la v1.416.0, líneas en el Registro de Cambios:
 *
 *   el administrador restablece la contraseña de alguien ....  0
 *   la persona cambia la suya ..............................  0
 *   alguien la recupera con la pregunta secreta ............  0
 *   el administrador escribe una contraseña en la ficha ....  1
 *
 * Esa única línea decía «Origen de la contraseña: inicial → definida», y
 * apareció de refilón porque cambió esa columna: sobre una cuenta que ya
 * tuviera origen «definida», no habría aparecido ninguna.
 *
 * Restablecerle la contraseña a otra persona es la manera limpia de apoderarse
 * de su cuenta desde dentro, y era justamente la que no dejaba nada escrito. Si
 * mañana hay que preguntar «¿quién le cambió la clave a la tesorera, y cuándo?»,
 * el sistema tiene que poder contestar.
 *
 * NO SE ANOTA LA CONTRASEÑA, ni la vieja ni la nueva: se anota QUÉ pasó, QUIÉN
 * lo hizo y SOBRE QUIÉN. Lo demás no se puede contar aunque se quisiera —el
 * sistema guarda solo la huella— y no hace falta para responder la pregunta.
 */
function comoSeCuenta(origen, deSuDueno, porLaPregunta) {
  if (porLaPregunta) return 'Recuperó su contraseña con su pregunta secreta';
  if (origen === 'inicial') return 'Le restableció la contraseña a la inicial del sistema';
  if (origen === 'definida') return 'Le escribió una contraseña nueva';
  return deSuDueno ? 'Cambió su propia contraseña' : 'Le puso una contraseña nueva a esta cuenta';
}

function dejarConstanciaDeLaClave(usuarioId, origen, quien, porLaPregunta) {
  try {
    const bitacora = require('./bitacora');
    const { getModule } = require('./registry');
    const fila = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
    if (!fila) return;
    const deSuDueno = !!quien && Number(quien.id) === Number(usuarioId);
    bitacora.anotarCambio({
      def: getModule('usuarios'),
      accion: 'Contraseña',
      fila,
      detalle: comoSeCuenta(origen, deSuDueno, porLaPregunta),
      usuario: quien || null,
    });
  } catch (e) {
    // Que no se pueda anotar no puede impedir que alguien recupere su cuenta
    console.error('No se pudo anotar el cambio de contraseña:', e.message);
  }
}

/**
 * `quien` es quien está haciendo el cambio —para poder anotarlo—, y
 * `porLaPregunta` distingue la recuperación desde la pantalla de acceso, donde
 * no hay sesión y quien lo hace es el propio dueño.
 */
async function establecer(usuarioId, clave, origen, quien, porLaPregunta) {
  const propia = origen === 'usuario';
  const cifrada = await cifrado.cifrar(clave);
  db.prepare(
    `UPDATE usuarios
        SET password = ?, password_origen = ?, debe_cambiar_password = ?,
            password_cambiada_en = ?, sesiones_desde = ?,
            sesiones_gen = COALESCE(sesiones_gen, 0) + 1, recuperacion_intentos = 0,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(
    cifrada,
    origen,
    propia ? 0 : 1,
    /*
     * Con el reloj de la iglesia, no con el universal.
     *
     * Acá decía `new Date().toISOString()`, que devuelve SIEMPRE la hora
     * universal y no mira la zona horaria configurada. MEDIDO con el reloj en
     * las 21:30 del lunes 24 de agosto en Chile: se guardaba «2026-08-25
     * 01:30:00», y la pantalla de la cuenta le decía al administrador «La
     * cambió su dueño el 2026-08-25» —mañana— por algo que había pasado
     * anoche. Y en la misma sentencia, dos líneas más abajo, `updated_at` se
     * estampa con `datetime('now','localtime')`: la misma fila quedaba con dos
     * relojes distintos.
     *
     * Es el mismo error de la fecha de vencimiento de las credenciales
     * (v1.304.0). `fechas.ahora()` pregunta con los métodos locales, que sí
     * obedecen la zona que el sistema deja puesta al arrancar.
     */
    propia ? fechas.ahora() : null,
    Math.floor(Date.now() / 1000),
    usuarioId
  );
  dejarConstanciaDeLaClave(usuarioId, origen, quien, porLaPregunta);
}

/**
 * LO QUE FALTA CUANDO LA CONTRASEÑA LA ESCRIBE EL MOTOR.
 *
 * Hay un tercer camino, además de `establecer` y `restablecer`: el
 * administrador escribe una contraseña en la ficha del usuario. Ese lo cifra el
 * propio módulo en su gancho de guardado, porque el motor está a punto de
 * escribir la fila entera, así que no pasa por acá y se saltaba las dos cosas
 * que `establecer` hace además de cifrar.
 *
 * MEDIDO en la v1.416.0, sobre una cuenta con la sesión abierta y esperando un
 * segundo y medio para que el corte no quedara en el mismo segundo:
 *
 *   restablecer desde el botón .....  401  la sesión se cerró
 *   escribirla en la ficha .........  200  la sesión siguió abierta
 *
 * Y la cabecera de este archivo dice, sobre cerrar las sesiones: «Vale para los
 * tres orígenes, a propósito: que el administrador restablezca la contraseña de
 * alguien es justamente el caso en que hay que echar de la sesión a quien esté
 * usando la cuenta». Valía para dos de los tres.
 */
function laEscribioElMotor(usuarioId, origen, quien) {
  db.prepare(
    `UPDATE usuarios SET sesiones_desde = ?, sesiones_gen = COALESCE(sesiones_gen, 0) + 1,
            recuperacion_intentos = 0, recuperacion_bloqueada_en = NULL WHERE id = ?`
  ).run(Math.floor(Date.now() / 1000), usuarioId);
  dejarConstanciaDeLaClave(usuarioId, origen, quien);
}

/** Restablece la cuenta a la contraseña inicial y devuelve cuál es. */
async function restablecer(usuarioId, quien) {
  const clave = inicial();
  await establecer(usuarioId, clave, 'inicial', quien);
  return clave;
}

/**
 * Cómo está la contraseña de una cuenta, para contárselo al administrador
 * sin revelar lo que no se puede revelar.
 */
function estado(usuario) {
  if (!usuario) return null;
  const origen = usuario.password_origen || (usuario.password ? 'usuario' : null);
  if (origen === 'inicial') {
    return {
      origen,
      texto: 'Tiene la contraseña inicial del sistema',
      clave: inicial(), // se puede mostrar: es la que el administrador definió para todos
      nivel: 'medio',
      detalle: 'Todavía no ha entrado a cambiarla por una suya.',
    };
  }
  if (origen === 'definida') {
    return {
      origen,
      texto: 'Tiene una contraseña puesta por el administrador',
      clave: null,
      nivel: 'medio',
      detalle: 'Es la que se escribió al crear o editar la cuenta. El sistema no la guarda en claro, así que no puede mostrarla: si se perdió, restablézcala.',
    };
  }
  return {
    origen: 'usuario',
    texto: usuario.password_cambiada_en
      ? `La cambió su dueño el ${String(usuario.password_cambiada_en).slice(0, 10)}`
      : 'La eligió su dueño',
    clave: null,
    nivel: 'ok',
    detalle: 'El sistema guarda solo su huella, no la contraseña: nadie puede leerla, tampoco el administrador. Si la olvidó, recupérela con su pregunta o restablézcala.',
  };
}

/** Cómo está la recuperación por pregunta secreta de una cuenta. */
function estadoRecuperacion(usuario) {
  const llevados = Number(usuario.recuperacion_intentos || 0);
  const desde = Number(usuario.recuperacion_bloqueada_en || 0);
  const minutos = minutosDeBloqueo();
  // Se levanta solo pasado el rato, como la puerta de entrada
  const faltan = desde ? Math.ceil((desde + minutos * 60000 - Date.now()) / 60000) : 0;
  const bloqueada = llevados >= INTENTOS_MAXIMOS && faltan > 0;
  /*
   * Los que cuentan HOY. Si hubo un bloqueo y ya se levantó, la cuenta empieza
   * de nuevo; si no, son los que lleva. De acá sale el «le quedan N intentos»
   * que se le dice a quien está recuperando su contraseña, así que tiene que
   * ser el número de verdad y no uno redondeado: quien va por el cuarto
   * necesita saber que le queda uno.
   */
  const intentos = desde && !bloqueada ? 0 : llevados;
  return {
    activa: ajustes.activo('recuperacion_activa'),
    tiene_pregunta: !!usuario.pregunta_secreta,
    pregunta: usuario.pregunta_secreta || null,
    bloqueada,
    minutos_restantes: bloqueada ? faltan : 0,
    aviso_bloqueo: bloqueada
      ? `La recuperación quedó cerrada por los intentos seguidos. Vuelva a intentarlo en ${faltan} `
        + `minuto${faltan === 1 ? '' : 's'}, o pida al administrador que la habilite ahora.`
      : null,
    intentos,
    maximo: INTENTOS_MAXIMOS,
  };
}

/** Guarda la pregunta y la respuesta de recuperación (la respuesta, cifrada). */
async function guardarPregunta(usuarioId, pregunta, respuesta) {
  const limpia = String(respuesta || '').trim();
  if (!String(pregunta || '').trim()) return 'Escriba la pregunta.';
  if (limpia.length < 3) return 'La respuesta es demasiado corta.';
  const cifrada = await cifrado.cifrar(normalizar(limpia));
  db.prepare(
    `UPDATE usuarios SET pregunta_secreta = ?, respuesta_secreta = ?, recuperacion_intentos = 0,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(String(pregunta).trim(), cifrada, usuarioId);
  return null;
}

/** Quita la pregunta de recuperación de una cuenta. */
function quitarPregunta(usuarioId) {
  db.prepare(
    `UPDATE usuarios SET pregunta_secreta = NULL, respuesta_secreta = NULL, recuperacion_intentos = 0 WHERE id = ?`
  ).run(usuarioId);
}

/**
 * La respuesta se compara sin distinguir mayúsculas, tildes ni espacios de
 * más: quien la escribió hace un año no tiene por qué acordarse de cómo la
 * escribió exactamente.
 */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿La respuesta es la correcta? Lleva la cuenta de los intentos fallidos. */
async function respuestaCorrecta(usuario, respuesta) {
  if (!usuario.respuesta_secreta) return false;
  const acierta = await cifrado.coincide(normalizar(respuesta), usuario.respuesta_secreta);
  /*
   * Los intentos se suman como siempre, con UNA excepción: si esta cuenta tuvo
   * un bloqueo y ya se levantó solo, la cuenta empieza de nuevo. Sin eso, un
   * error suelto al mes siguiente la cerraría en el acto, porque el contador
   * seguiría en cinco.
   *
   * Y no al revés: mientras no haya habido bloqueo, los intentos se acumulan
   * normalmente. Descontarlos siempre dejaría la cuenta sin poder cerrarse
   * nunca, y entonces la respuesta secreta se podría probar sin límite.
   */
  const lleva = acierta ? 0 : estadoRecuperacion(usuario).intentos + 1;
  db.prepare('UPDATE usuarios SET recuperacion_intentos = ?, recuperacion_bloqueada_en = ? WHERE id = ?')
    .run(lleva, lleva >= INTENTOS_MAXIMOS ? Date.now() : null, usuario.id);
  return acierta;
}

/** Vuelve a habilitar la recuperación de una cuenta bloqueada por intentos. */
function desbloquearRecuperacion(usuarioId) {
  db.prepare('UPDATE usuarios SET recuperacion_intentos = 0, recuperacion_bloqueada_en = NULL WHERE id = ?')
    .run(usuarioId);
}

module.exports = {
  INTENTOS_MAXIMOS, minutosDeBloqueo, inicial, INICIAL_DE_RESERVA, largoMinimo, revisarClave, revisarLargo, establecer, restablecer,
  estado, estadoRecuperacion, guardarPregunta, quitarPregunta, respuestaCorrecta,
  desbloquearRecuperacion, normalizar, comoSeCuenta, laEscribioElMotor,
};
