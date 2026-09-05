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

/**
 * El instante de ahora en la zona del sistema, como «YYYY-MM-DD HH:MM:SS».
 *
 * Es el mismo formato y el mismo reloj que `datetime('now','localtime')` de
 * SQLite, que es con lo que este sistema estampa sus 46 fechas: los dos
 * preguntan la hora local del proceso, y la zona la deja puesta
 * `zona-horaria.aplicar()` al arrancar y al guardarla.
 *
 * NO SE USA `toISOString()`, que es lo que había en el sitio que hizo falta
 * esto. Esa función devuelve SIEMPRE la hora universal, sin mirar la zona
 * configurada: en Chile, entre las 20:00 y la medianoche, estampa el día
 * siguiente. Es el mismo error que ya se corrigió en la fecha de vencimiento
 * de las credenciales (v1.304.0), y por eso el arreglo vive acá y no en el
 * archivo que lo necesitaba: para que el próximo lo tenga a mano.
 *
 * Las partes se sacan todas del MISMO instante, y no llamando a `hoy()` por
 * un lado y a la hora por el otro: entre las dos llamadas puede cambiar el
 * día, y quedaría una fecha de ayer con la hora de hoy.
 */
function ahora() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} `
    + `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
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

  /*
   * UNA FECHA QUE LA FICHA YA NO TIENE NO SE COMPARA CON NADA.
   *
   * Un campo puede existir solo en algunos casos —«Fecha de retiro» solo cuando
   * el estado es «Retirado», «Fecha de cierre» solo cuando la cuenta está
   * cerrada— y cuando su condición deja de cumplirse el módulo lo borra. Pero
   * esta comprobación corre ANTES que el gancho del módulo, así que veía el
   * valor viejo y lo comparaba igual.
   *
   * Eso dejaba callejones sin salida: la ficha se negaba a guardarse por una
   * fecha QUE LA PANTALLA YA NO MUESTRA —al cambiar el estado, esa sección
   * desaparece del formulario: no se ve, no se puede borrar y no se manda—, y
   * entonces el aviso salía en rojo al pie sin nada que corregir arriba.
   * Comprobado en el navegador y por la API en la v1.396.0, con dos módulos
   * distintos:
   *
   *   vuelve al cuerpo quien se retiró ....  400  "Fecha de retiro" (30-06-2025)
   *                                              no puede ser anterior a
   *                                              "Fecha de ingreso" (01-03-2026)
   *   se reabre una cuenta cerrada .......   400  "Fecha de cierre" (15-03-2022)
   *                                              no puede ser anterior a
   *                                              "Fecha de apertura" (01-06-2023)
   *
   * El primero era el peor, porque no había otra puerta: crearle una ficha
   * nueva se rechaza —«ya tiene su ficha en este cuerpo. Ábrala en vez de crear
   * otra», que es la manera correcta, y lo explica el propio sistema en
   * server/directiva.js: la ficha se reusa para que su historial quede en un
   * solo lugar—, y abrir la que estaba contestaba lo de arriba. Lo notable es
   * que el sistema SÍ sabe devolver a alguien a un cuerpo: la regla de la
   * directiva reabre la ficha por su cuenta, con un UPDATE que no pasa por acá.
   * O sea que lo hacía solo y una persona no podía.
   *
   * No es un caso raro ni de un módulo: de los 23 pares con `noAntesDe`, 11
   * comparan un campo condicionado, en seis módulos —cuentas de tesorería,
   * cuerpos, deudas, integrantes de cuerpo, inventario y miembros—, y en dos de
   * ellos el condicionado es aquel CONTRA el que se compara (la fecha de
   * recepción del inventario), que es por lo que se miran los dos lados.
   *
   * Se salta la comparación cuando una de las dos fechas SE VA: tiene condición
   * (`showIf`), la condición ya no se cumple —la misma regla `seAplica` con la
   * que el motor decide no exigir un obligatorio que no viene al caso, en
   * server/crud.js— y ADEMÁS no viene en este guardado, o sea que su único
   * valor es el que quedó de antes y el módulo está por borrarlo.
   *
   * Las tres condiciones importan, y la última se aprendió rompiéndolo: sin
   * ella, una fila que manda las dos fechas y NO manda el campo que las
   * gobierna —una planilla de inventario sin la columna «Régimen»— se dejaba de
   * revisar, porque no saber qué dice el que manda se parece a que diga que no.
   * Una fecha que llega en el guardado se ve y se puede corregir: esa se
   * compara siempre. La que se salta es la que nadie mandó y nadie puede tocar.
   *
   * No es un permiso para dejar fechas incoherentes: es que una fecha que la
   * ficha va a dejar de tener no tiene con qué ser incoherente. Mientras las
   * dos estén a la vista, se siguen exigiendo igual.
   */
  const { seAplica } = require('./crud');
  const seVa = (nombre) => {
    const f = def.fields.find((x) => x.name === nombre);
    if (!f) return false;                           // un `noAntesDe` mal escrito no revienta
    if (datos[nombre] !== undefined) return false;  // si la mandan, se compara
    // Un campo sin `showIf` siempre aplica, así que esto da false: una fecha
    // que la ficha lleva siempre no se va a ninguna parte.
    return !seAplica(f, datos, existing, def.fields);
  };

  for (const campo of def.fields) {
    if (campo.type !== 'date' || !campo.noAntesDe) continue;
    if (seVa(campo.name) || seVa(campo.noAntesDe)) continue;
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

module.exports = { revisar, revisarCoherencia, normalizar, comoSeLee, hoy, ahora, PISO, TOPE_FUTURO_ANIOS };
