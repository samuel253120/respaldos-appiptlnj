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
 *   · los certificados, POR IGLESIA, y salen «CERT-001-2026»;
 *   · la oficina de partes lleva DOS libros por iglesia —lo que entra y lo que
 *     sale—, y salen «REC-001-2026» y «EMI-001-2026». Son dos series y no una
 *     porque son dos libros: en una oficina de partes el correlativo de
 *     entrada y el de salida corren por separado, y mezclarlos haría imposible
 *     decir «el oficio 45 que enviamos».
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
  documentos_recibidos: 'documento_recibido_prefijo',
  documentos_emitidos: 'documento_emitido_prefijo',
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
  /*
   * Los dos libros de la oficina de partes. Comparten tabla y se separan por
   * el flujo: es la misma ficha de documento, contada en dos correlativos.
   */
  documentos_recibidos: {
    tabla: 'documentos',
    campo: 'numero',
    acotadaPor: 'iglesia_id',
    ademasDonde: { campo: 'flujo', vale: 'Recibido' },
    arma: (n, anio, prefijo) => `${prefijo}${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio, prefijo) => leerNumero(valor, anio, prefijo),
  },
  documentos_emitidos: {
    tabla: 'documentos',
    campo: 'numero',
    acotadaPor: 'iglesia_id',
    ademasDonde: { campo: 'flujo', vale: 'Emitido' },
    arma: (n, anio, prefijo) => `${prefijo}${String(n).padStart(3, '0')}-${anio}`,
    lee: (valor, anio, prefijo) => leerNumero(valor, anio, prefijo),
  },
};

/**
 * Parte «PREFIJO123-2026» en sus dos mitades: el 123 y el año.
 *
 * Vive suelta porque hay dos preguntas distintas que necesitan el mismo
 * formato: «¿qué número es éste, si es del año que me importa?» —lo de abajo,
 * para proponer el siguiente— y «¿de qué número y de qué año es?», que es lo
 * que necesita el libro para saber si falta alguno entre medio. Escrito dos
 * veces, el día que el formato cambiara cambiaría en una sola.
 *
 * El prefijo se compara sin distinguir mayúsculas y se escapa antes de meterlo
 * en la expresión: alguien puede escribir «ACTA (N.º)» como prefijo, y un
 * paréntesis suelto adentro de una expresión regular la rompe o —peor— la
 * cambia de significado sin avisar.
 */

/**
 * Lee «PREFIJO123-2026» y devuelve 123, o null si no sigue ese formato.
 *
 * El prefijo se compara sin distinguir mayúsculas y se escapa antes de meterlo
 * en la expresión: alguien puede escribir «ACTA (N.º)» como prefijo, y un
 * paréntesis suelto adentro de una expresión regular la rompe o —peor— la
 * cambia de significado sin avisar.
 */
function partirNumero(valor, prefijo) {
  const escapado = String(prefijo || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(`^${escapado}(\\d{1,6})-(\\d{4})$`, 'i');
  const m = patron.exec(String(valor || '').trim());
  return m ? { n: Number(m[1]), anio: m[2] } : null;
}

function leerNumero(valor, anio, prefijo) {
  const partes = partirNumero(valor, prefijo);
  return partes && partes.anio === String(anio) ? partes.n : null;
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
  /*
   * Una serie puede acotarse ADEMÁS por otra columna: la oficina de partes
   * lleva dos libros en la misma tabla, y lo que entra no numera lo que sale.
   */
  const mas = serie.ademasDonde;
  const donde = mas ? ` AND "${mas.campo}" = ?` : '';
  const conQue = mas ? [acotado, mas.vale] : [acotado];

  let filas;
  try {
    filas = db
      .prepare(`SELECT "${serie.campo}" AS valor FROM "${serie.tabla}" WHERE "${serie.acotadaPor}" = ?${donde}`)
      .all(...conQue);
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

module.exports = { proximoNumero, anioDe, prefijoDe, leerNumero, partirNumero, SERIES };
