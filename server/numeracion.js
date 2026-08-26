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
 *   · las de asamblea, POR IGLESIA, y salen «AS-001-2026»;
 *   · los certificados, POR IGLESIA, y salen «CERT-001-2026».
 *
 * El certificado se sumó después, y por el mismo motivo que las actas: su
 * número se escribía a mano, y es un documento que se firma y se entrega. Dos
 * certificados con el mismo número son dos papeles en circulación que dicen
 * ser el mismo.
 *
 * De lo que ya está guardado se miran solo los números que siguen el formato:
 * si alguien numeró a su manera —«Acta de marzo»—, no se cuenta ni estorba, y
 * la propuesta empieza en 001. Como se puede cambiar, no hay nada que romper.
 */
const { db } = require('./db');

/**
 * El prefijo que la iglesia haya puesto para esta serie.
 *
 * Se lee en cada propuesta y no al arrancar: es un ajuste de la pantalla de
 * configuración y tiene que valer en cuanto se cambia.
 */
const CLAVE_DEL_PREFIJO = {
  actas_reuniones: 'acta_reunion_prefijo',
  actas_asambleas: 'acta_asamblea_prefijo',
  certificados: 'certificado_prefijo',
};

function prefijoDe(cual) {
  const clave = CLAVE_DEL_PREFIJO[cual] || 'acta_reunion_prefijo';
  return String(require('./ajustes').obtener(clave) || '').trim();
}

/** Las series que el sistema numera solo. */
const SERIES = {
  actas_reuniones: {
    tabla: 'actas_reuniones',
    campo: 'numero_acta',
    acotadaPor: 'cuerpo_id', // cada cuerpo lleva su propio libro
    // «001-2026», o con el prefijo que la iglesia haya configurado
    arma: (n, anio, prefijo) => `${prefijo}${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio, prefijo) => leerNumero(valor, anio, prefijo),
  },
  actas_asambleas: {
    tabla: 'actas_asambleas',
    campo: 'numero_acta',
    acotadaPor: 'iglesia_id', // la asamblea es de la congregación entera
    // «AS-001-2026» de fábrica, y el prefijo se puede cambiar
    arma: (n, anio, prefijo) => `${prefijo}${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio, prefijo) => leerNumero(valor, anio, prefijo),
  },
  certificados: {
    tabla: 'certificados',
    campo: 'numero',
    // Por iglesia, que es como el módulo exige que no se repita
    acotadaPor: 'iglesia_id',
    // «CERT-001-2026» de fábrica, y el prefijo se puede cambiar
    arma: (n, anio, prefijo) => `${prefijo}${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio, prefijo) => leerNumero(valor, anio, prefijo),
  },
};

/**
 * Lee «PREFIJO123-2026» y devuelve 123, o null si no sigue ese formato.
 *
 * El prefijo se compara sin distinguir mayúsculas y se escapa antes de meterlo
 * en la expresión: alguien puede escribir «ACTA (N.º)» como prefijo, y un
 * paréntesis suelto adentro de una expresión regular la rompe o —peor— la
 * cambia de significado sin avisar.
 */
function leerNumero(valor, anio, prefijo) {
  const escapado = String(prefijo || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(`^${escapado}(\\d{1,6})-(\\d{4})$`, 'i');
  const m = patron.exec(String(valor || '').trim());
  return m && m[2] === String(anio) ? Number(m[1]) : null;
}

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
  const prefijo = prefijoDe(cual);
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
    const n = serie.lee(fila.valor, anio, prefijo);
    if (n !== null && n > mayor) mayor = n;
  }
  return serie.arma(mayor + 1, anio, prefijo);
}

module.exports = { proximoNumero, anioDe, prefijoDe, leerNumero, SERIES };
