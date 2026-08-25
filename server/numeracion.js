/**
 * El número que le toca a la próxima acta.
 *
 * POR QUÉ. El número de acta se escribía a mano, cada vez. Eso tiene dos
 * problemas que se notan al tercer mes: hay que ir a mirar cuál fue la última
 * para saber cuál sigue, y basta una distracción para repetir un número o
 * saltarse uno. En un libro de actas, la numeración es lo que ordena el
 * archivo: si se rompe, después nadie sabe si falta un acta o si el número
 * simplemente no se usó.
 *
 * ES UNA PROPUESTA, NO UNA IMPOSICIÓN. El sistema propone el que sigue y la
 * persona lo puede cambiar: hay actas que llegan con su número ya puesto —una
 * que se levantó en papel hace dos meses—, y hay libros que empiezan en otro
 * número porque vienen de antes. El campo se deja escribir, siempre.
 *
 * CÓMO SE CUENTA. Por serie y por año, que es como se numera un libro de
 * actas: el 001 vuelve a empezar cada enero.
 *
 *   · las actas de reunión se numeran POR CUERPO —el coro lleva su libro y las
 *     dorcas el suyo—, y salen «001-2026»;
 *   · las de asamblea, POR IGLESIA, y salen «AS-001-2026».
 *
 * De lo que ya está guardado se miran solo los números que siguen el formato:
 * si alguien numeró a su manera —«Acta de marzo»—, no se cuenta ni estorba, y
 * la propuesta empieza en 001. Como se puede cambiar, no hay nada que romper.
 */
const { db } = require('./db');

/** Las series que el sistema numera solo. */
const SERIES = {
  actas_reuniones: {
    tabla: 'actas_reuniones',
    campo: 'numero_acta',
    acotadaPor: 'cuerpo_id', // cada cuerpo lleva su propio libro
    // «001-2026»
    arma: (n, anio) => `${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio) => {
      const m = /^(\d{1,6})-(\d{4})$/.exec(String(valor || '').trim());
      return m && m[2] === String(anio) ? Number(m[1]) : null;
    },
  },
  actas_asambleas: {
    tabla: 'actas_asambleas',
    campo: 'numero_acta',
    acotadaPor: 'iglesia_id', // la asamblea es de la congregación entera
    // «AS-001-2026»
    arma: (n, anio) => `AS-${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio) => {
      const m = /^AS-(\d{1,6})-(\d{4})$/i.exec(String(valor || '').trim());
      return m && m[2] === String(anio) ? Number(m[1]) : null;
    },
  },
};

/** El año que corresponde: el de la fecha del acta, o el de hoy. */
function anioDe(fecha) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(fecha || ''));
  if (m) return Number(m[1]);
  return new Date().getFullYear();
}

/**
 * Qué número propone el sistema para la próxima acta de esa serie.
 *
 * `dentroDe` es el cuerpo o la iglesia según la serie. Sin él no se propone
 * nada: no se sabe de qué libro se está hablando, y proponer «001» sería
 * inventar. La pantalla vuelve a preguntar en cuanto se elige el cuerpo.
 */
function proximoNumero(cual, dentroDe, fecha) {
  const serie = SERIES[cual];
  if (!serie) return null;
  const acotado = Number(dentroDe) || 0;
  if (!acotado) return null;

  const anio = anioDe(fecha);
  let filas;
  try {
    filas = db
      .prepare(`SELECT "${serie.campo}" AS valor FROM "${serie.tabla}" WHERE "${serie.acotadaPor}" = ?`)
      .all(acotado);
  } catch (e) {
    return null; // una tabla que todavía no está no puede impedir crear un acta
  }

  let mayor = 0;
  for (const fila of filas) {
    const n = serie.lee(fila.valor, anio);
    if (n !== null && n > mayor) mayor = n;
  }
  return serie.arma(mayor + 1, anio);
}

module.exports = { proximoNumero, anioDe, SERIES };
