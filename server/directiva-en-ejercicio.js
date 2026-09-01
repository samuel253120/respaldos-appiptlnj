/**
 * Qué directiva dirige un cuerpo HOY, y por qué eso no puede ser un campo.
 *
 * El estado de una directiva era una casilla con dos opciones que alguien
 * elegía a mano —«Vigente» o «Finalizada»— y las fechas de inicio y término
 * eran otros dos campos al lado, sin nada que los relacionara. Medido sobre un
 * mismo cuerpo, en el mismo momento:
 *
 *   período 2018 – 2019, terminó el 31-12-2019 ..... decía «Vigente»
 *   período 2027 – 2028, asume el 01-03-2027 ....... decía «Vigente», y era LA vigente
 *   período 2026 – 2027, el que corre hoy .......... decía «Finalizada»
 *
 * Y lo peor no era la vencida. Al registrar la directiva ELECTA para asumir el
 * año que viene, la regla de «una sola vigente por cuerpo» finalizaba en
 * silencio a la que estaba gobernando: la organización quedaba, en el sistema,
 * sin directiva en ejercicio por haber anotado bien su próxima elección.
 *
 * LA SITUACIÓN SE CALCULA, NO SE GUARDA, por la razón que decide siempre en
 * este sistema: es un dato que CAMBIA SOLO CON EL PASO DEL TIEMPO. Una
 * directiva empieza a ejercer un lunes sin que nadie guarde nada, y termina un
 * 31 de diciembre sin que nadie guarde nada. Un valor guardado envejece entre
 * dos guardados; uno calculado, no. Es la misma razón por la que el saldo de
 * una caja sale de sus movimientos y no de una columna, y por la que la
 * situación de una credencial sale de su fecha de vencimiento.
 *
 * LA FECHA DE TÉRMINO ES LA HERRAMIENTA, y por eso se sigue editando. Los
 * períodos se extienden y se acortan a cada rato —una directiva sigue medio año
 * más porque la elección se atrasó; otra termina antes porque se disolvió—, y
 * eso se hace corriendo esa fecha, que es exactamente lo que pasó. Cerrar una
 * directiva es ponerle el día en que terminó, no marcar una casilla que no dice
 * cuándo.
 *
 * QUÉ QUEDA DEL CAMPO GUARDADO. Sigue existiendo y sigue sirviendo para
 * filtrar, pero ya no decide: «Finalizada» CIERRA —alguien la dio por cerrada y
 * eso se respeta, aunque su período siga corriendo— y «Vigente» NO ABRE, que es
 * la mitad que faltaba. Una directiva marcada «Vigente» cuyo término pasó está
 * terminada, y punto. Es la misma forma que ya tenía la situación de una
 * credencial (ver server/modules/credenciales.js), y por eso no hubo que
 * cambiarle el valor guardado a ninguna fila.
 */
const { hoy } = require('./fechas');

/** El valor guardado que CIERRA una directiva sin importar sus fechas. */
const CERRADA = 'Finalizada';

/**
 * Las cuatro situaciones en que puede estar una directiva, y de qué color se
 * pintan. El nivel lo lee `nivelClase` en public/app.js, que reconoce palabras.
 */
const SITUACIONES = {
  ELECTA: 'Electa',
  EJERCE: 'En ejercicio',
  REEMPLAZADA: 'Reemplazada',
  TERMINADA: 'Terminada',
  CERRADA: 'Finalizada',
};

/*
 * «En ejercicio» va en verde y «Reemplazada» en amarillo, que es un aviso y no
 * un error: la directiva existió, lo que falta es la fecha en que terminó.
 * «Electa» y «Terminada» son estados normales de la vida de un cuerpo y van sin
 * color, para que el verde signifique una sola cosa en la pantalla.
 */
const NIVEL = {
  [SITUACIONES.EJERCE]: 'Vigente',
  [SITUACIONES.REEMPLAZADA]: 'Observada',
  [SITUACIONES.ELECTA]: '',
  [SITUACIONES.TERMINADA]: '',
  [SITUACIONES.CERRADA]: '',
};

/**
 * La condición SQL de «no está cerrada a mano».
 *
 * En nulo cuenta como no cerrada, igual que en todo el resto del sistema: la
 * ausencia de una palabra no es una decisión que alguien haya tomado.
 */
const noCerrada = (alias = 'directivas') =>
  `(${alias}.estado IS NULL OR ${alias}.estado <> '${CERRADA}')`;

/**
 * La directiva que dirige el cuerpo hoy, o null.
 *
 * Ya empezó, no ha terminado y no está cerrada. Si hay varias que cumplen eso
 * —dos períodos que se pisan, o dos sin fecha de término, que es como las deja
 * la importación del sistema anterior— manda LA QUE EMPEZÓ ÚLTIMO: una
 * directiva nueva releva a la anterior aunque nadie le haya cerrado el período.
 * Sin ese desempate, un cuerpo con dos directivas abiertas tendría dos en
 * ejercicio, que es justamente lo que esto viene a impedir.
 */
function laQueEjerce(db, cuerpoId, cuando = hoy()) {
  if (!cuerpoId) return null;
  return db
    .prepare(
      `SELECT * FROM directivas
        WHERE cuerpo_id = ? AND ${noCerrada()}
          AND fecha_inicio IS NOT NULL AND fecha_inicio <= ?
          AND (fecha_termino IS NULL OR fecha_termino >= ?)
        ORDER BY fecha_inicio DESC, id DESC
        LIMIT 1`
    )
    .get(cuerpoId, cuando, cuando) || null;
}

/**
 * En qué situación está ESTA directiva.
 *
 * `recuerdo` es el mapa que el motor pasa a los calculados de un listado: sin
 * él, pintar la columna de cien filas del mismo cuerpo haría cien veces la
 * misma consulta.
 */
function situacionDe(fila, { db, recuerdo } = {}, cuando = hoy()) {
  if (!fila) return '';
  if (fila.estado === CERRADA) return SITUACIONES.CERRADA;
  if (!fila.fecha_inicio) return '';           // sin fecha no hay nada que decir
  if (fila.fecha_inicio > cuando) return SITUACIONES.ELECTA;
  if (fila.fecha_termino && fila.fecha_termino < cuando) return SITUACIONES.TERMINADA;
  if (!db) return SITUACIONES.EJERCE;          // sin base no se puede desempatar

  const clave = `directiva-ejerce:${fila.cuerpo_id}:${cuando}`;
  let quien;
  if (recuerdo && recuerdo.has(clave)) quien = recuerdo.get(clave);
  else {
    quien = laQueEjerce(db, fila.cuerpo_id, cuando);
    if (recuerdo) recuerdo.set(clave, quien);
  }
  return quien && Number(quien.id) === Number(fila.id)
    ? SITUACIONES.EJERCE
    : SITUACIONES.REEMPLAZADA;
}

/** El calculado que ve la pantalla: su texto y su color. */
const insigniaDeSituacion = (fila, opciones) => {
  const texto = situacionDe(fila, opciones);
  return texto ? { texto, nivel: NIVEL[texto] || '' } : '';
};

/** ¿Los períodos de estas dos directivas se pisan aunque sea un día? */
function seTraslapan(a, b) {
  if (!a.fecha_inicio || !b.fecha_inicio) return false;
  const terminaA = a.fecha_termino || '9999-12-31';
  const terminaB = b.fecha_termino || '9999-12-31';
  return a.fecha_inicio <= terminaB && b.fecha_inicio <= terminaA;
}

/** «01-03-2027» → «28-02-2027»: el día antes, para poder proponerlo. */
function elDiaAntes(fecha) {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

const comoSeLee = (f) => (f ? f.split('-').reverse().join('-') : '');

/**
 * Las otras directivas del mismo cuerpo cuyo período se pisa con ésta.
 *
 * No se mira solo el día de hoy: una directiva electa para marzo que se pisa
 * nueve meses con la que está gobernando es el caso que hay que atajar, y hoy
 * todavía no se pisan.
 */
function lasQueSePisan(db, fila, id) {
  if (fila.estado === CERRADA || !fila.fecha_inicio) return [];
  return db
    .prepare(`SELECT * FROM directivas WHERE cuerpo_id = ? AND id <> ? AND ${noCerrada()}`)
    .all(fila.cuerpo_id, id || 0)
    .filter((otra) => seTraslapan(fila, otra));
}

/**
 * El aviso, que dice qué fecha poner en vez de arreglarlo por su cuenta.
 *
 * Antes esto no se preguntaba: se marcaba «Finalizada» a las demás en silencio.
 * Corregirle la fecha de término a la anterior es una decisión con
 * consecuencias —desde ese día deja de ser la directiva del cuerpo— y la sabe
 * quien está guardando, no el sistema: puede que las dos convivan a propósito
 * mientras se hace la entrega.
 */
function avisoDeTraslape(fila, otras) {
  const cual = otras[0];
  const propuesta = fila.fecha_inicio > (cual.fecha_inicio || '')
    ? `Si «${cual.periodo || 'la anterior'}» termina cuando ésta asume, póngale de fecha de término el ${comoSeLee(elDiaAntes(fila.fecha_inicio))}.`
    : `Si ésta termina cuando asume «${cual.periodo || 'la otra'}», póngale de fecha de término el ${comoSeLee(elDiaAntes(cual.fecha_inicio))}.`;
  const cuantas = otras.length > 1 ? ` (y ${otras.length - 1} más)` : '';
  return (
    `El período de «${cual.periodo || 'otra directiva'}»${cuantas} —del ${comoSeLee(cual.fecha_inicio)} ` +
    `${cual.fecha_termino ? `al ${comoSeLee(cual.fecha_termino)}` : 'y sin fecha de término'}— se pisa con éste. ` +
    `${propuesta} Si las guarda así, el cuerpo tendrá dos directivas con el período corriendo y la anterior ` +
    'aparecerá como «Reemplazada» hasta que se le corrija la fecha.'
  );
}

module.exports = {
  CERRADA, SITUACIONES, NIVEL, noCerrada,
  laQueEjerce, situacionDe, insigniaDeSituacion,
  seTraslapan, lasQueSePisan, avisoDeTraslape, elDiaAntes,
};
