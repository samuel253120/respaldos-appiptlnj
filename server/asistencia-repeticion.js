/**
 * LAS ACTIVIDADES QUE SE REPITEN.
 *
 * El servicio del domingo, el estudio del miércoles y el ensayo del sábado son
 * los mismos todas las semanas, con los mismos cuerpos y a la misma hora. Se
 * creaban a mano, de a una: más de 150 al año para una iglesia con tres
 * reuniones semanales, cada una con su diálogo, su fecha y sus cuerpos
 * marcados de nuevo.
 *
 * Acá vive el cálculo: dada una fecha de partida, una regla y una fecha de
 * término, qué días caen. Es aritmética pura y sin base de datos, para poder
 * comprobarla sola.
 *
 * NO SE ARMA UNA «SERIE». Cada fecha da una actividad independiente, que
 * después se edita o se borra por separado sin que las demás se enteren: es lo
 * que pasa de verdad —se cambia el lugar de un domingo, se suspende otro— y
 * una serie con dueño obligaría a explicar en cada pantalla si el cambio es de
 * una o de todas.
 */

/** Las reglas que se ofrecen, con el nombre que se lee en pantalla. */
const REGLAS = [
  { valor: 'semanal', label: 'Cada semana' },
  { valor: 'quincenal', label: 'Cada dos semanas' },
  { valor: 'mensual_semana', label: 'Cada mes, el mismo día de la semana' },
  { valor: 'mensual_dia', label: 'Cada mes, el mismo día del mes' },
];

/**
 * Cuántas se crean como mucho de una vez.
 *
 * Con 200 caben cuatro años de una reunión semanal. El tope no está para
 * ahorrar espacio: está para que una fecha mal escrita —el año 2926 en vez del
 * 2026— no llene el calendario de mil actividades que después hay que borrar
 * una por una.
 */
const TOPE = 200;

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** La fecha como número de día, sin husos de por medio. */
function aDia(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function aTexto(ms) {
  const f = new Date(ms);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`;
}
const DIA = 86400000;

/** Cuántos días tiene ese mes (mes de 1 a 12). */
const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * «El segundo domingo del mes»: qué día cae en ese mes.
 * Devuelve null cuando el mes no llega a tener esa cuenta —hay meses sin quinto
 * domingo— y ese mes se salta, en vez de correrse al primero del siguiente.
 */
function elMismoDiaDeLaSemana(anio, mes, diaSemana, cual) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();
  const primeroQueCalza = 1 + ((diaSemana - primero + 7) % 7);
  const dia = primeroQueCalza + (cual - 1) * 7;
  return dia <= diasDelMes(anio, mes) ? aTexto(Date.UTC(anio, mes - 1, dia)) : null;
}

/**
 * Las fechas en que se repite, SIN la de partida.
 *
 * `desde` es el día de la actividad que ya existe, así que no vuelve a salir:
 * lo que se devuelve son las que hay que crear. Vacío si la regla no se
 * reconoce o si `hasta` no llega ni al primer salto.
 */
function fechasQueSiguen(desde, regla, hasta) {
  if (!esFecha(desde) || !esFecha(hasta)) return [];
  const fin = aDia(hasta);
  const inicio = aDia(desde);
  if (fin <= inicio) return [];

  const salen = [];
  const anotar = (iso) => {
    if (!iso) return;
    const d = aDia(iso);
    if (d > inicio && d <= fin) salen.push(iso);
  };

  if (regla === 'semanal' || regla === 'quincenal') {
    const salto = (regla === 'semanal' ? 7 : 14) * DIA;
    for (let d = inicio + salto; d <= fin && salen.length < TOPE; d += salto) salen.push(aTexto(d));
    return salen;
  }

  const [anio, mes, dia] = desde.split('-').map(Number);

  if (regla === 'mensual_dia') {
    /*
     * El mismo número de día. Un mes que no llega a ese número se salta: quien
     * pidió «el 31» no quiso decir «el 28 de febrero», y correrlo al día que
     * más se le parezca es inventarle una reunión a la iglesia.
     */
    for (let i = 1; salen.length < TOPE; i++) {
      const m = mes - 1 + i;
      const a = anio + Math.floor(m / 12);
      const mm = (m % 12) + 1;
      if (Date.UTC(a, mm - 1, 1) > fin) break;
      if (dia <= diasDelMes(a, mm)) anotar(aTexto(Date.UTC(a, mm - 1, dia)));
    }
    return salen;
  }

  if (regla === 'mensual_semana') {
    const diaSemana = new Date(inicio).getUTCDay();
    const cual = Math.floor((dia - 1) / 7) + 1;   // el primero, el segundo…
    for (let i = 1; salen.length < TOPE; i++) {
      const m = mes - 1 + i;
      const a = anio + Math.floor(m / 12);
      const mm = (m % 12) + 1;
      if (Date.UTC(a, mm - 1, 1) > fin) break;
      anotar(elMismoDiaDeLaSemana(a, mm, diaSemana, cual));
    }
    return salen;
  }

  return [];
}

/** Cómo se dice la repetición en una frase, para el aviso y para el registro. */
function comoSeLee(desde, regla, hasta) {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const cual = ['', 'primer', 'segundo', 'tercer', 'cuarto', 'quinto'];
  if (!esFecha(desde)) return '';
  const dia = new Date(aDia(desde)).getUTCDay();
  const cuantos = Math.floor((Number(desde.split('-')[2]) - 1) / 7) + 1;
  // Solo «domingo» y «sábado» toman ese plural; los demás ya vienen en -s
  const enPlural = DIAS[dia] + (dia === 0 || dia === 6 ? 's' : '');
  const nombre = {
    semanal: `todos los ${enPlural}`,
    quincenal: `un ${DIAS[dia]} por medio`,
    mensual_semana: `el ${cual[cuantos] || ''} ${DIAS[dia]} de cada mes`.replace('  ', ' ').trim(),
    mensual_dia: `el ${Number(desde.split('-')[2])} de cada mes`,
  }[regla];
  return nombre || '';
}

module.exports = { REGLAS, TOPE, fechasQueSiguen, comoSeLee };
