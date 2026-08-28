/**
 * Libros de la Biblia, Reina-Valera 1960.
 *
 * Se usan como opciones en los campos que citan un pasaje (el salmo leído,
 * el mensaje predicado, etc.). Están en el orden del canon, primero el
 * Antiguo Testamento y después el Nuevo.
 */
const ANTIGUO_TESTAMENTO = [
  'Génesis', 'Éxodo', 'Levítico', 'Números', 'Deuteronomio',
  'Josué', 'Jueces', 'Rut', '1 Samuel', '2 Samuel',
  '1 Reyes', '2 Reyes', '1 Crónicas', '2 Crónicas', 'Esdras',
  'Nehemías', 'Ester', 'Job', 'Salmos', 'Proverbios',
  'Eclesiastés', 'Cantares', 'Isaías', 'Jeremías', 'Lamentaciones',
  'Ezequiel', 'Daniel', 'Oseas', 'Joel', 'Amós',
  'Abdías', 'Jonás', 'Miqueas', 'Nahúm', 'Habacuc',
  'Sofonías', 'Hageo', 'Zacarías', 'Malaquías',
];

const NUEVO_TESTAMENTO = [
  'Mateo', 'Marcos', 'Lucas', 'Juan', 'Hechos',
  'Romanos', '1 Corintios', '2 Corintios', 'Gálatas', 'Efesios',
  'Filipenses', 'Colosenses', '1 Tesalonicenses', '2 Tesalonicenses', '1 Timoteo',
  '2 Timoteo', 'Tito', 'Filemón', 'Hebreos', 'Santiago',
  '1 Pedro', '2 Pedro', '1 Juan', '2 Juan', '3 Juan',
  'Judas', 'Apocalipsis',
];

const LIBROS = [...ANTIGUO_TESTAMENTO, ...NUEVO_TESTAMENTO];

/**
 * Cuántos capítulos tiene cada libro.
 *
 * El libro se elige de una lista, pero el capítulo y el versículo eran números
 * libres: se guardaba «Judas 40:900-999» —Judas tiene UN capítulo— y después se
 * leía así en el listado y salía impreso en la hoja del servicio.
 *
 * Son sesenta y seis números y sirven para preguntar, no para bloquear: quien
 * escribió el 40 sin querer lo corrige, y a quien de verdad quiso escribirlo no
 * se le discute.
 *
 * Van los de la Reina-Valera 1960, que es la que usa la iglesia: Joel tiene 3
 * capítulos y Malaquías 4, que es como los divide esta versión y no como los
 * divide el texto hebreo.
 */
const CAPITULOS = {
  'Génesis': 50, 'Éxodo': 40, 'Levítico': 27, 'Números': 36, 'Deuteronomio': 34,
  'Josué': 24, 'Jueces': 21, 'Rut': 4, '1 Samuel': 31, '2 Samuel': 24,
  '1 Reyes': 22, '2 Reyes': 25, '1 Crónicas': 29, '2 Crónicas': 36, 'Esdras': 10,
  'Nehemías': 13, 'Ester': 10, 'Job': 42, 'Salmos': 150, 'Proverbios': 31,
  'Eclesiastés': 12, 'Cantares': 8, 'Isaías': 66, 'Jeremías': 52, 'Lamentaciones': 5,
  'Ezequiel': 48, 'Daniel': 12, 'Oseas': 14, 'Joel': 3, 'Amós': 9,
  'Abdías': 1, 'Jonás': 4, 'Miqueas': 7, 'Nahúm': 3, 'Habacuc': 3,
  'Sofonías': 3, 'Hageo': 2, 'Zacarías': 14, 'Malaquías': 4,

  'Mateo': 28, 'Marcos': 16, 'Lucas': 24, 'Juan': 21, 'Hechos': 28,
  'Romanos': 16, '1 Corintios': 16, '2 Corintios': 13, 'Gálatas': 6, 'Efesios': 6,
  'Filipenses': 4, 'Colosenses': 4, '1 Tesalonicenses': 5, '2 Tesalonicenses': 3, '1 Timoteo': 6,
  '2 Timoteo': 4, 'Tito': 3, 'Filemón': 1, 'Hebreos': 13, 'Santiago': 5,
  '1 Pedro': 5, '2 Pedro': 3, '1 Juan': 5, '2 Juan': 1, '3 Juan': 1,
  'Judas': 1, 'Apocalipsis': 22,
};

/**
 * El capítulo más largo de toda la Biblia es el Salmo 119, con 176 versículos.
 *
 * Cuántos versículos tiene CADA capítulo son mil ciento ochenta y nueve números,
 * y no hacen falta para atajar el dedo que resbaló: con el más largo de todos
 * basta para que «900» no pase callado, y no se corre el riesgo de discutirle un
 * versículo de verdad a alguien por una tabla mal copiada.
 */
const VERSICULOS_DEL_CAPITULO_MAS_LARGO = 176;

/**
 * Qué tiene de imposible este pasaje, dicho en una frase, o null si no tiene
 * nada. No es un rechazo: es lo que se le pregunta a quien lo escribió.
 */
function loQueNoCalza(libro, capitulo, versiculoInicial, versiculoFinal) {
  if (!libro || !CAPITULOS[libro]) return null;
  const cuantos = CAPITULOS[libro];
  const numero = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const cap = numero(capitulo);
  if (cap !== null && Number.isFinite(cap)) {
    if (cap < 1) return `Acá dice el capítulo ${cap}, y los capítulos empiezan en el 1.`;
    if (cap > cuantos) {
      return `${libro} tiene ${cuantos === 1 ? 'un solo capítulo' : `${cuantos} capítulos`}, `
        + `y acá dice el ${cap}.`;
    }
  }

  for (const v of [numero(versiculoInicial), numero(versiculoFinal)]) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < 1) return `Acá dice el versículo ${v}, y los versículos empiezan en el 1.`;
    if (v > VERSICULOS_DEL_CAPITULO_MAS_LARGO) {
      return `Ningún capítulo de la Biblia tiene ${v} versículos: el más largo es el Salmo 119, `
        + `con ${VERSICULOS_DEL_CAPITULO_MAS_LARGO}.`;
    }
  }
  return null;
}

/**
 * Arma la cita de un pasaje: "Salmos 23:1-6", "Juan 3:16", "Romanos 8".
 * Devuelve cadena vacía si no hay libro.
 */
function cita(libro, capitulo, versiculoInicial, versiculoFinal) {
  if (!libro) return '';
  let texto = String(libro);
  if (capitulo == null || capitulo === '') return texto;
  texto += ` ${capitulo}`;
  if (versiculoInicial == null || versiculoInicial === '') return texto;
  texto += `:${versiculoInicial}`;
  if (versiculoFinal != null && versiculoFinal !== '' && Number(versiculoFinal) !== Number(versiculoInicial)) {
    texto += `-${versiculoFinal}`;
  }
  return texto;
}

module.exports = {
  LIBROS, ANTIGUO_TESTAMENTO, NUEVO_TESTAMENTO, cita,
  CAPITULOS, VERSICULOS_DEL_CAPITULO_MAS_LARGO, loQueNoCalza,
};
