/**
 * Que una fecha sea una fecha, y que además tenga sentido.
 *
 * El motor tiene un tipo `date` y cuarenta y nueve campos lo usan. No había
 * una sola comprobación: ni de que lo que llegara fuera una fecha, ni de que
 * cayera en un rango razonable, ni de que se llevara bien con las otras fechas
 * de la misma ficha. Se comprobó lo que eso permitía guardar:
 *
 *   nacido en 2099 ......................  aceptado
 *   nacido en 1820 ......................  aceptado
 *   nacimiento el 30 de febrero .........  aceptado y guardado
 *   fecha = «texto que no es fecha» .....  guardado tal cual, en una columna de fecha
 *   bautizado en 2030 ...................  aceptado
 *   ingresó veinte años antes de nacer ..  aceptado
 *
 * Las últimas tres son las que más importan, porque el calendario del
 * navegador sí las deja escribir: no hacen falta mañas, basta equivocarse.
 *
 * Y la consecuencia peor es silenciosa. La edad de un miembro se calcula de su
 * fecha de nacimiento y se descarta si no da un número entre 0 y 130. Si
 * alguien escribe 2106 en vez de 2016, la ficha se guarda pero la edad queda
 * en blanco: esa persona desaparece de los cumpleaños y de cualquier conteo
 * por edad, y en «Datos por completar» tampoco sale, porque el campo está
 * lleno. Se pierde sin que nada avise.
 *
 * Las reglas, que valen para los cuarenta y nueve campos de una vez:
 *
 *   1. Tiene que ser una fecha de verdad. Un 30 de febrero no existe, y un
 *      texto cualquiera tampoco es una fecha por guardarse en esa columna.
 *
 *   2. No antes de 1900. Nada de lo que este sistema anota es más viejo.
 *
 *   3. No después de hoy —porque casi toda fecha acá anota algo que ya
 *      ocurrió—, salvo los campos que declaran `futuro: true`: la actividad
 *      que se programa para el domingo, la credencial que vence en unos años,
 *      el período de una directiva que todavía no termina. A esos igual se les
 *      pone techo, veinte años, que es lo que hace que un 2099 se note.
 *
 *   4. Las fechas de una misma ficha se respetan entre ellas, cuando el campo
 *      declara `noAntesDe`: nadie se bautiza antes de nacer, ni un período
 *      termina antes de empezar.
 */

/** Nada de lo que este sistema anota es más viejo que esto. */
const PISO = '1900-01-01';

/**
 * Cuánto puede adelantarse un campo que sí admite futuro. Veinte años deja
 * pasar cualquier plazo real —una credencial, un período, un reglamento— y
 * sigue atajando el año mal escrito, que es de lo que se trata.
 */
const TOPE_FUTURO_ANIOS = 20;

/** El día de hoy en la zona del servidor, como YYYY-MM-DD. */
function hoy() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** La misma fecha corrida unos años, para poder comparar sin restar a mano. */
function dentroDeAnios(anios) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + anios);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * La parte de fecha de lo que llegue, o null si no es una fecha.
 *
 * Se exige el formato del sistema y además que la fecha exista de verdad: un
 * 2010-02-30 tiene la forma correcta y no es un día. La comprobación es
 * armarla y ver si vuelve a decir lo mismo —febrero 30 vuelve como marzo 2—,
 * que es la manera de preguntarlo sin escribir el calendario a mano.
 */
function normalizar(valor) {
  const texto = String(valor == null ? '' : valor).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  const vuelve =
    fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
  return vuelve ? texto : null;
}

/** Una fecha como se lee en Chile: 2026-08-23 → 23-08-2026. */
const comoSeLee = (iso) => String(iso).split('-').reverse().join('-');

/**
 * ¿La fecha que llega tiene sentido para este campo?
 *
 * Devuelve el aviso escrito para quien lo lea, o null si está bien. El aviso
 * dice qué se esperaba y no solo que está mal: quien escribió 2106 sin querer
 * necesita ver que el problema es el año.
 */
function revisar(campo, valor) {
  const fecha = normalizar(valor);
  if (!fecha) {
    return (
      `El campo "${campo.label}" no trae una fecha válida` +
      (String(valor).trim() ? ` ("${String(valor).trim().slice(0, 30)}")` : '') +
      '. Elíjala en el calendario.'
    );
  }

  if (fecha < PISO) {
    return `El campo "${campo.label}" dice ${comoSeLee(fecha)}. Revise el año: no se anotan fechas anteriores a 1900.`;
  }

  if (campo.futuro) {
    const techo = dentroDeAnios(TOPE_FUTURO_ANIOS);
    if (fecha > techo) {
      return (
        `El campo "${campo.label}" dice ${comoSeLee(fecha)}, que es más de ${TOPE_FUTURO_ANIOS} años adelante. ` +
        'Revise el año.'
      );
    }
    return null;
  }

  if (fecha > hoy()) {
    return (
      `El campo "${campo.label}" dice ${comoSeLee(fecha)}, que todavía no llega. ` +
      'Revise el año: acá se anota lo que ya ocurrió.'
    );
  }

  return null;
}

/**
 * ¿Las fechas de esta ficha se llevan bien entre ellas?
 *
 * Se mira contra la ficha COMO VA A QUEDAR —lo que llega encima de lo que ya
 * estaba—, no contra lo guardado: si alguien corrige el nacimiento y el
 * bautismo en el mismo guardado, lo que hay que revisar es el resultado, no
 * una mezcla del antes y el después.
 */
function revisarCoherencia(def, datos, existing) {
  const completo = { ...(existing || {}), ...datos };
  const etiqueta = (nombre) => {
    const f = def.fields.find((x) => x.name === nombre);
    return f ? f.label : nombre;
  };

  for (const campo of def.fields) {
    if (campo.type !== 'date' || !campo.noAntesDe) continue;
    const esta = normalizar(completo[campo.name]);
    const antes = normalizar(completo[campo.noAntesDe]);
    if (!esta || !antes) continue;
    if (esta < antes) {
      return (
        `"${campo.label}" (${comoSeLee(esta)}) no puede ser anterior a ` +
        `"${etiqueta(campo.noAntesDe)}" (${comoSeLee(antes)}).`
      );
    }
  }
  return null;
}

module.exports = { revisar, revisarCoherencia, normalizar, comoSeLee, hoy, PISO, TOPE_FUTURO_ANIOS };
